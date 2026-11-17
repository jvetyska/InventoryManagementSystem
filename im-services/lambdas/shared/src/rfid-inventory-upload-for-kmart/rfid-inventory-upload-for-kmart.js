"use strict";
const wmsDB = require("/opt/nodejs/wmsDB.js");
const { axios, AWS } = require("/opt/nodejs/xray.js");
const { parse } = require("json2csv");
const moment = require("moment-timezone");
const proxy = require("proxy-agent");
const s3 = new AWS.S3({ signatureVersion: "v4" });
const logger = require('/opt/nodejs/logger.js')('rfid-inventory-upload-for-kmart'); 

const getConfig = require("/opt/nodejs/config.js");
let REGION, SNS_ARN, SLACK_NOTIFICATIONS, SLACK_ERRORS, VARIANCE_THRESHOLD, SEND_EMAIL, config;

let SNS = new AWS.SNS({apiVersion: "2010-03-31"});
const SES = new AWS.SES();
let pool;

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        REGION = config.region;
        SNS_ARN = config.storeBackfillScheduleCsvSnsTopicArn;
        SLACK_NOTIFICATIONS = config.slackHookNotifications;
        SLACK_ERRORS = config.slackHookErrors;
        VARIANCE_THRESHOLD = config.varianceThresholdCSV;
        SEND_EMAIL = config.sendEmailInsteadOfS3Upload || false;
        pool = await wmsDB.getPool();
        await main();
    } catch (error) {
        console.log(error);
        try {
            let slackMessage = `*Inventory Upload CSV *\n`;
            slackMessage += `:x: Failed: There was an error uploading CSV file for kmart internal \n`;
            slackMessage += "```" + error + "```";
            await axios.post(SLACK_NOTIFICATIONS, {text: slackMessage});
        } catch (error) {
            logger.info('Failed to post Error message to Slack', {error});
        }
        return;
    }
    return "Done Successfully";
};

const main = async () => {

    // We will upload files for two conditions
    // 1: Upload when stock takes are done for keycodes within threshold
    // 2: Upload when system tasks are done or their DueDate is passed
    try {
        await UploadFilesForCompletedSchedule();
        await UploadFilesForTasks();
    } catch (error) {
        console.log(error);
        await sendSlackError();
    }
};

async function UploadFilesForCompletedSchedule() {
    let sql, args, results;

    /* Backfill schedules must meet ALL of these requirements:
     * 1. It's enabled
     * 2. It's a "system" inventory check type
     * 3. It's set to run today
     * 4. It's run has finished today
     *
     * Any keycodes under threshold that still require an IPS update will be updated immediately following stocktakes finishing
     */
    sql = `
        SELECT
            sbs.ID,
            sbs.LocationID,
            loc.Timezone,
            sbs.isCurrentAdjustmentCanceled
        FROM store_backfill_schedule sbs
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        INNER JOIN store_inventory_snapshot sis ON
            sbs.ID = sis.BackfillScheduleID AND
            sis.DateCompleted IS NULL AND
            sis.TaskID IS NULL AND
            # Only update if the both IPS reads have been done
            sis.QuantityExternalStart IS NOT NULL AND
            sis.QuantityExternalEnd IS NOT NULL
        WHERE
            # It's a currently-enabled "system" type that hasn't been fulfilled yet
            sbs.IsEnabled = 1
            AND sbs.InventoryCheckType = 'system'
        GROUP BY sbs.ID
        ORDER BY sbs.LocationID DESC, sbs.ID DESC
        `;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in SQL when getting backfill schedule data`);
    }

    // For each result (ID of store_backfill_schedule), call a function on that ID to generate the CSV
    for (let row of results) {
        const backfillScheduleID = row["ID"];
        const locationID = row["LocationID"];
        const isCurrentAdjustmentCanceled = row["isCurrentAdjustmentCanceled"];
        const timezone = row["Timezone"];

        if (isCurrentAdjustmentCanceled) {
            await SkipAdjustment(backfillScheduleID);
            continue;
        }

        await GenerateAndUploadScheduleCompletedCSV(backfillScheduleID, locationID, timezone);
    }
}

async function UploadFilesForTasks() {
    let sql, args, results;

    /* Backfill schedules must meet ALL of these requirements:
     * 1. It's enabled
     * 2. It's a "system" inventory check type
     * 3. The tasks have NOT been Fulfilled yet (fulfilled tasks are old and not relevant)
     * 4. It's set to run today
     *
     * In addition, they must meet ANY ONE of these requirements:
     * 1. PastDue = 1                 (Emma says we're good to generate .csv regardless of missed inventory checks)
     * 2. Completed = TotalTaskGroups (100% completion for the backfill schedule)
     *
     * Any keycodes above threshold with completed tasks will be updated if they are within discrepancy
     * */
    sql = `
        SELECT
            sbs.ID,
            sbs.LocationID,
            loc.Timezone,
            sbs.isCurrentAdjustmentCanceled,
            SUM(IF(tg.DateCompleted IS NOT NULL, 1, 0)) AS Completed,
            COUNT(*) AS TotalTaskGroups,
            IF(MAX(tg.DateDue) < NOW(), 1, 0) AS PastDue
        FROM store_backfill_schedule sbs
        INNER JOIN location loc ON loc.ID = sbs.LocationID
        INNER JOIN task_group tg ON tg.ReferenceID = sbs.ID AND tg.Type = 'Inventory'
        # Join just to make sure there are valid rows for update
        INNER JOIN (
            SELECT
                BackfillScheduleID
            FROM store_inventory_snapshot sis
            WHERE
                sis.DateCompleted IS NULL AND
                sis.TaskID IS NOT NULL AND
                # Only update if the both IPS reads have been done
                sis.QuantityExternalStart IS NOT NULL AND
                sis.QuantityExternalEnd IS NOT NULL
            GROUP BY sis.BackfillScheduleID
        ) sis ON sbs.ID = sis.BackfillScheduleID
        WHERE
            # It's a currently-enabled "system" type that hasn't been fulfilled yet
            sbs.IsEnabled = 1
            AND sbs.InventoryCheckType = 'system'
            AND tg.DateFulfilled IS NULL
        GROUP BY sbs.ID
        HAVING
            # Generate CSV regardless of missed inventory checks
            PastDue = 1
            # 100% of the task groups were completed
            OR Completed = TotalTaskGroups
        ORDER BY sbs.LocationID DESC, sbs.ID DESC`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in SQL when getting backfill schedule data`);
    }

    // For each result (ID of store_backfill_schedule), call a function on that ID to generate the CSV
    for (let row of results) {
        const backfillScheduleID = row["ID"];
        const locationID = row["LocationID"];
        const isCurrentAdjustmentCanceled = row["isCurrentAdjustmentCanceled"];
        const timezone = row["Timezone"];

        if (isCurrentAdjustmentCanceled) {
            await SkipAdjustment(backfillScheduleID);
            continue;
        }

        await GenerateAndUploadTasksCSV(backfillScheduleID, locationID, timezone);
    }
}

async function cleanupDBForCompletedSchedule(backfillScheduleID, qualifiedKeycodes) {
    let sql, args;
    sql = "";
    args = [];
    console.log(`Cleaning up DB for completed schedule ${backfillScheduleID}`);

    // cleanup by performing these steps:
    // 1. Set ExternalInventoryAdjust to true for the keycodes that were a part of the .csv
    // 2. Set the store_inventory_snapshot for this BackfillScheduleID as Completed

    // Only UPDATE store_inventory_snapshot rows with ExternalInventoryAdjust if the Keycode list was provided
    if (qualifiedKeycodes && qualifiedKeycodes.length) {
        sql += `
            UPDATE store_inventory_snapshot SET ExternalInventoryAdjust = 1 WHERE BackfillScheduleID IN (?) AND Keycode IN (?) AND DateCompleted IS NULL
            ;`;
        args.push(backfillScheduleID, qualifiedKeycodes);
    }
    sql += `
        UPDATE store_inventory_snapshot
        SET DateCompleted = NOW()
        WHERE BackfillScheduleID IN (?) AND DateCompleted IS NULL AND TaskID IS NULL;`;
    args.push(backfillScheduleID);

    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in SQL when performing cleanup`);
    }
}

async function cleanupDBForTasks(backfillScheduleID, qualifiedKeycodes) {
    let sql, args;
    sql = "";
    args = [];
    console.log(`Cleaning up DB for tasks schedule ${backfillScheduleID}`);

    // cleanup by performing these steps:
    // 1. Set ExternalInventoryAdjust to true for the keycodes that were a part of the .csv
    // 2. Set the store_inventory_snapshot for this BackfillScheduleID as Completed
    // 3. Set all the associated Inventory tasks as Fulfilled
    // 4. Set all the associated Inventory task groups as Fulfilled

    // Only UPDATE store_inventory_snapshot rows with ExternalInventoryAdjust if the Keycode list was provided
    if (qualifiedKeycodes && qualifiedKeycodes.length) {
        sql += `
            UPDATE store_inventory_snapshot SET ExternalInventoryAdjust = 1 WHERE BackfillScheduleID IN (?) AND Keycode IN (?) AND DateCompleted IS NULL
            ;`;
        args.push(backfillScheduleID, qualifiedKeycodes);
    }

    sql += `
        UPDATE store_inventory_snapshot
        SET DateCompleted = NOW()
        WHERE BackfillScheduleID IN (?) AND DateCompleted IS NULL;`;
    args.push(backfillScheduleID);

    sql += `
        UPDATE task
        SET DateFulfilled = NOW()
        WHERE DateFulfilled IS NULL AND Type = 'Inventory' AND ReferenceID IN (?)
        ;
        UPDATE task_group
        SET DateFulfilled = NOW()
        WHERE DateFulfilled IS NULL AND Type = 'Inventory' AND ReferenceID IN (?)
        ;`;
    args.push(backfillScheduleID, backfillScheduleID);

    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in SQL when performing cleanup`);
    }
}

async function GenerateAndUploadScheduleCompletedCSV(backfillScheduleID, storeName, timezone) {
    logger.info('Generating .csv for Backfill Schedule Completed ID:', {backfillScheduleID});
    let qualifiedKeycodes = [];
    let results;

    // Get the RFID count and user counts as we'll need to compare them
    let sql = `
        SELECT
            a.Str_ID,
            a.APN,
            a.Keycode AS KD,
            SUM(IF(a.isFoH, a.RFIDCount, 0)) AS Qty_SalesFloor,
            SUM(IF(a.isBoH, a.RFIDCount, 0)) AS Qty_Stockroom,
            SUM(a.RFIDCount) AS Qty_Total,
            a.QuantityExternalEnd as Qty_IPS,
            a.SnapShot_DateTime,
            IF(ABS(SUM(a.RFIDCount) - a.QuantityExternalEnd) <=
                (SELECT Value FROM system_settings WHERE Property = 'minVarianceExternalAndRFID')
                , 1, 0) AS isUnderMinCountVariance
        FROM (
            SELECT
                SUBSTRING_INDEX(sis.LocationID, '-', 1) AS Str_ID,
                ct.isFoH,
                ct.isBoH,
                pb.Barcode AS APN,
                sis.Keycode,
                IFNULL(sis.Quantity, 0) AS RFIDCount,
                IFNULL(sis.QuantityExternalEnd, 0) AS QuantityExternalEnd,
                DATE_FORMAT(CONVERT_TZ(sis.DateSnapshot, 'UTC', loc.Timezone), '%Y-%m-%d %H:%i:%s') AS SnapShot_DateTime
            FROM store_inventory_snapshot sis
            INNER JOIN location loc ON loc.ID = sis.LocationID
            INNER JOIN container c ON c.ID = sis.ContainerID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
            INNER JOIN (
                SELECT Keycode, APN as Barcode FROM product GROUP BY Keycode
            ) AS pb ON pb.Keycode = sis.Keycode
            WHERE
                sis.BackfillScheduleID = ?
                AND IFNULL(sis.HasRecentManifest, 0) = 0
                AND sis.TaskID IS NULL
                AND sis.DateCompleted IS NULL
                AND IFNULL(sis.IsOverThreshold, 0) = 0
                AND ct.isSystemInv
            GROUP BY sis.ID
        ) AS a
        GROUP BY a.Keycode
        # Only select rows with all tasks completed and a total RFID to Count difference of 1 or less
        HAVING isUnderMinCountVariance = 0
        `;
    let args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in getting the RFID and user counts`);
    }

    for (let row of results) {
        qualifiedKeycodes.push(row["KD"]);
    }

    await cleanupDBForCompletedSchedule(backfillScheduleID, qualifiedKeycodes);

    // If there were results, utilize json2csv's parse() method in order to turn it into a valid .csv format
    if (results.length) {
        await UploadCSV(results, backfillScheduleID, storeName, timezone, false);
    } else {
        console.log(`No Keycodes found for IPS Update CSV for schedule complete on schedule ${backfillScheduleID}`);

        // If the option to send emails is enabled (instead of uploading to Lambda),
        // notify that the run was successful but there were no results
        if (SEND_EMAIL) {
            let dateTime = String(moment().format("YYYY-MM-DD HH-mm-ss"));
            let emailData = {
                from: "engineering@anko.com",
                to: "engineering@anko.com",
                subject: `Store Backfill Schedule ID: ${backfillScheduleID}  @ ${dateTime}`,
                body: `The Lambda successfully ran, but there were no results for the .csv file regarding Store Backfill Schedule: ${backfillScheduleID}`
            };

            await SendEmailWithAttachments(emailData);
        }
    }
}

async function GenerateAndUploadTasksCSV(backfillScheduleID, storeName, timezone) {
    logger.info('Generating .csv for Backfill Schedule ID Tasks Completed:', {backfillScheduleID});
    let qualifiedKeycodes = [];
    let results;

    // Get the RFID count and user counts as we'll need to compare them
    let sql = `
        SELECT
            a.Str_ID,
            a.APN,
            a.Keycode AS KD,
            SUM(IF(a.isFoH, a.RFIDCount, 0)) AS Qty_SalesFloor,
            SUM(IF(a.isBoH, a.RFIDCount, 0)) AS Qty_Stockroom,
            SUM(a.RFIDCount) AS Qty_Total,
            SUM(a.QuantityCounted) AS sumQuantityCounted,
            a.QuantityExternalEnd as Qty_IPS,
            a.SnapShot_DateTime,
            MAX(a.TaskNotCompleted) AS anyTasksNotCompleted
        FROM (
            SELECT
                SUBSTRING_INDEX(sis.LocationID, '-', 1) AS Str_ID,
                ct.isFoH,
                ct.isBoH,
                pb.Barcode AS APN,
                sis.Keycode,
                IFNULL(sis.Quantity, 0) AS RFIDCount,
                IF(sis.QuantityCounted IS NULL, 1, 0) AS TaskNotCompleted,
                sis.QuantityCounted,
                IFNULL(sis.QuantityExternalEnd, 0) AS QuantityExternalEnd,
                DATE_FORMAT(CONVERT_TZ(sis.DateSnapshot, 'UTC', loc.Timezone), '%Y-%m-%d %H:%i:%s') AS SnapShot_DateTime
            FROM store_inventory_snapshot sis
            INNER JOIN location loc ON loc.ID = sis.LocationID
            INNER JOIN container c ON c.ID = sis.ContainerID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
            INNER JOIN (
                SELECT Keycode, APN as Barcode FROM product GROUP BY Keycode
            ) AS pb ON pb.Keycode = sis.Keycode
            WHERE
                sis.BackfillScheduleID = ?
                AND IFNULL(sis.HasRecentManifest, 0) = 0
                AND sis.TaskID IS NOT NULL
                AND sis.DateCompleted IS NULL
                AND ct.isSystemInv
            GROUP BY sis.ID
        ) AS a
        GROUP BY a.Keycode
        # Only select rows with all tasks completed and a total RFID to Count difference of 1 or less
        HAVING
            ABS(Qty_Total - sumQuantityCounted) <= 1
            AND anyTasksNotCompleted = 0
        `;
    let args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in getting the RFID and user counts`);
    }

    for (let row of results) {
        qualifiedKeycodes.push(row["KD"]);
    }

    await cleanupDBForTasks(backfillScheduleID, qualifiedKeycodes);

    if (results.length) {
        await UploadCSV(results, backfillScheduleID, storeName, timezone, true);
    } else {
        console.log(`No Keycodes found for IPS Update CSV for tasks on schedule ${backfillScheduleID}`);

        // If the option to send emails is enabled (instead of uploading to Lambda),
        // notify that the run was successful but there were no results
        if (SEND_EMAIL) {
            let dateTime = String(moment().format("YYYY-MM-DD HH-mm-ss"));
            let emailData = {
                from: "engineering@anko.com",
                to: "engineering@anko.com",
                subject: `Store Backfill Schedule ID: ${backfillScheduleID}  @ ${dateTime}`,
                body: `The Lambda successfully ran, but there were no results for the .csv file regarding Store Backfill Schedule: ${backfillScheduleID}`
            };

            await SendEmailWithAttachments(emailData);
        }
    }
}

async function SkipAdjustment(backfillScheduleID) {
    let sql, args;
    console.log(`Skipping Inventory Adjustment for Backfill Schedule ${backfillScheduleID}`);

    await cleanupDBForCompletedSchedule(backfillScheduleID);
    await cleanupDBForTasks(backfillScheduleID);

    sql = `
        UPDATE store_backfill_schedule
        SET isCurrentAdjustmentCanceled = 0
        WHERE ID = ?`;
    args = [backfillScheduleID];

    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in SQL when resuming Backfill Schedule`);
    }
}

async function UploadCSV(inventoryRows, backfillScheduleID, storeName, timezone, isTaskUpload = false) {
    const inventoryTableFields = ["Str_ID", "APN", "KD", "Qty_SalesFloor", "Qty_Stockroom", "Qty_Total", "SnapShot_DateTime", "Qty_IPS"];
    const inventoryOpts = { fields: inventoryTableFields };
    const dateTime = String(moment().tz(timezone).format("YYYY-MM-DD_HH-mm-ss"));
    const fileName = `inventory-${storeName}-${dateTime}.csv`;
    const fileData = parse(inventoryRows, inventoryOpts);


    // Because there were results and we'll be processing these rows, perform a query that will select all of the rows
    // to be processed in the store_inventory_snapshot table and upload it to our logging S3. This .csv will be shared
    // with the engineering team, Emma, and Brennan to assist in debugging purposes
    let sql = `
        SELECT
            LocationID,
            ContainerID,
            Keycode,
            Quantity,
            QuantityExternalStart,
            QuantityExternalEnd,
            QuantityCounted,
            QuantityAdjusted,
            AdjustmentReason,
            HasRecentManifest,
            ExternalInventoryAdjust,
            IsOverThreshold,
            TaskID,
            DateCounted,
            DateSnapshot,
            DateCreated,
            DateCompleted
        FROM store_inventory_snapshot
        WHERE
            DateCompleted = (SELECT MAX(DateCompleted) FROM store_inventory_snapshot WHERE BackfillScheduleID = ?)
            AND BackfillScheduleID = ?
            AND IF(TaskID IS NOT NULL, 1, 0) = ?`;
    let args = [backfillScheduleID, backfillScheduleID, isTaskUpload];

    let resultsDebug;

    try {
        [resultsDebug] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw new Error(`Error in getting data from the table "store_inventory_snapshot" for debugging`);
    }

    const inventoryTableFieldsDebug = [
        "LocationID",
        "ContainerID",
        "Keycode",
        "Quantity",
        "QuantityExternalStart",
        "QuantityExternalEnd",
        "QuantityCounted",
        "QuantityAdjusted",
        "AdjustmentReason",
        "HasRecentManifest",
        "ExternalInventoryAdjust",
        "IsOverThreshold",
        "TaskID",
        "DateCounted",
        "DateSnapshot",
        "DateCreated",
        "DateCompleted"
    ];
    const inventoryOptsDebug = { fields: inventoryTableFieldsDebug };
    const fileNameDebug = `inventory-debug-${storeName}-${dateTime}.csv`;
    const fileDataDebug = parse(resultsDebug, inventoryOptsDebug);

    if (SEND_EMAIL) {
        let emailData = {
            from: "engineering@anko.com",
            to: "engineering@anko.com",
            subject: `Store Backfill Schedule ID: ${backfillScheduleID}  @ ${dateTime}`,
            body: ".csv files attached below"
        };

        // Attach both the results and debug .csv files to the email
        let files = [{
            name: fileName,
            data: fileData
        }, {
            name: fileNameDebug,
            data: fileDataDebug
        }];

        await SendEmailWithAttachments(emailData, files);

    } else {
        try {
            // The PutFileToS3 function returns the URL of where to download the file after it's uploaded to S3
            let urlData  = await PutFileToS3(fileName, fileData, process.env.S3BUCKET);
            let urlDebug = await PutFileToS3(fileNameDebug, fileDataDebug, process.env.S3BUCKETFORDEBUG);

            // For working with the internal environment, send an SNS so that it causes an email to be sent
            let subject = `Store Backfill Schedule .csv for ID ${backfillScheduleID}`;
            let message = `
                Store Backfill Schedule .csv for ID ${backfillScheduleID}\n
                ${urlData}\n
                \n
                Debug file, a .csv of the table store_inventory_snapshot where DateCompleted IS NULL and BackfillScheduleID = ${backfillScheduleID}\n
                ${urlDebug}\n`;
            await sendSnsTopic(SNS_ARN, message, subject, true);
        } catch (error) {
            console.log(error);
            throw new Error(`Error in uploading the .csv file to S3 and sending the email`);
        }
    }
}

function sendSnsTopic(topicArn, message, subject, verbose = false, additionalParamaters = null) {
    return new Promise(async (resolve, reject) => {
        try {
            let snsParams = {
                Message: message,
                Subject: subject,
                TopicArn: topicArn
            };

            if (additionalParamaters) {
                snsParams = Object.assign(additionalParamaters, snsParams);
            }

            if (process.env.HTTPS_PROXY) {
                SNS = new AWS.SNS({apiVersion: "2010-03-31", region: REGION,
                    httpOptions: {
                        agent: proxy(process.env.HTTPS_PROXY)
                    }
                });
            }

            try {
                SNS.publish(snsParams, function(err, data) {
                    if (err) {
                        console.log(err);
                        throw new Error(err);
                    }
                    if (verbose) {
                        logger.info('Successfully sent the message\n', {data});
                    }
                    // SNS = new AWS.SNS({apiVersion: "2010-03-31", region: REGION});
                    resolve(data);
                });
            } catch (err) {
                reject(err);
            }
        } catch (err) {
            console.log(err);
            reject(err);
        }
    });
}

async function SendEmailWithAttachments(emailData, files = []) {
    let from    = emailData["from"];    // The email address that this is coming from
    let to      = emailData["to"];      // The email address that this is being sent to
    let subject = emailData["subject"]; // The subject of the email
    let body    = emailData["body"];    // Basic text displayed in the body of the email

    // For each file, update file data from buffer
    for (let i = 0; i < files.length; i++) {
        files[i]["data"] = Buffer.from(files[i]["data"]);
    }

    // Specify the basic mandatory portions of the raw email
    // This includes From, To, Subject, and MIME-Version which must all have a newline
    let data = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0\n`
    ].join("\n");

    /* If you wish to have a text body and an attachment, your first content type MUST be the following:
     * Multipart/Mixed; boundary="NextPart"
     * You can then use "NextPart" to seperate the text body and the attachment.
     * Content-Type is the only required parameter here. Content-Disposition and data are optional */
    let contentTypes = [
        {
            "Content-Type": `Content-type: Multipart/Mixed; boundary="NextPart"`
        },{
            "Content-Type": `Content-Type: text/plain`,
            "data": body
        }
    ];

    for (let file of files) {
        contentTypes.push({
            "Content-Type": `Content-Type: text/plain`,
            "Content-Disposition": `Content-Disposition: attachment; filename="${file["name"]}"`,
            "data": file["data"]
        });
    }

    // Loop through our content types, appending to data and adding newlines where necessary
    // If a particular newline isn't added, then the entire email will be malformed
    for (let obj of contentTypes) {
        if ("Content-Type" in obj) {
            data += obj["Content-Type"] + "\n";
        }

        if ("Content-Disposition" in obj) {
            data += obj["Content-Disposition"] + "\n";
        }

        // An extra newline MUST be added after Content-Type and Content-Disposition
        data += "\n";

        if ("data" in obj) {
            // TWO newlines MUST be added after any data
            data += obj["data"] + "\n\n";
        }

        // The final signature for a content type is --NextPart followed by a newline
        data += "--NextPart\n";
    }

    // You MUST remove the final character in data (which will be a newline), and replace it with two hyphens
    data = data.slice(0, -1) + "--";

    try {
        let email = await SES.sendRawEmail({RawMessage: {Data: data}}).promise();
        console.log(email);
    } catch (error) {
        logger.info('Unable to send an email', {error});
    }
}

const PutFileToS3 = async (fileName, fileData, s3BucketName) => {
    console.log(`Upload to S3 Bucket: ${s3BucketName}/${fileName}`);

    const s3Params = {
        Bucket: s3BucketName,
        Key: fileName,
        Body: fileData,
        ServerSideEncryption: "AES256",
        StorageClass: "STANDARD",
        ACL: process.env.ACLACCESS
    };

    try {
        const putFile = await s3.upload(s3Params).promise();
        logger.info('File uploaded to S3:', {putFile});
        return putFile.Location;
    } catch (error) {
        throw new Error(`Failed to upload to s3 bucket: ${error}`);
    }
};

async function sendSlackError() {
    let logString = ":no_entry: `rfid-inventory-upload-for-kmart`\n";
    logString += `Unknown error when trying to upload Inventory Files for Kmart IPS Update`;

    logger.error(logString);

    try {
        await axios.post(SLACK_ERRORS, {"text": logString});
    } catch (error) {
        console.log(error);
    }
}
