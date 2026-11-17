const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const moment = require("moment-timezone");
const { parse } = require("json2csv");
const { AWS } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger')('task-management-system-stepfunction:upload-inventory-file-to-ips');

const stepfunctions = new AWS.StepFunctions();
let SNS = new AWS.SNS({apiVersion: "2010-03-31"});
const SES = new AWS.SES();
const s3 = new AWS.S3({ signatureVersion: "v4" });

let pool, config, SNS_ARN;
const SEND_EMAIL = false;

exports.handler = async (event) => {
    logger.startTrace('handler');
    let taskToken, input, type, backfillScheduleID;

    try {
        let eventBody = event.Records[0].body;

        if (typeof(eventBody) === "string") {
            eventBody = JSON.parse(eventBody);
        }

        logger.info('body', 'handler', { eventBody});

        taskToken = eventBody.TaskToken;

        input = eventBody.Input;
        backfillScheduleID = input["backfillScheduleID"];
        type = eventBody.Type;

        pool = await db.getPool();
        config = await getConfig.getConfig(process.env.NODE_ENV);

        SNS_ARN = config.storeBackfillScheduleCsvSnsTopicArn;

        let isValidSchedule = await ValidateSchedule(backfillScheduleID);

        if (!isValidSchedule) {
            throw new Error(`ERROR: No valid store_inventory_snapshot rows for Backfill Schedule ${backfillScheduleID}`);
        }

        if (type === "StocktakesFinished") {
            await GenerateAndUploadScheduleCompletedCSV(backfillScheduleID);
        } else if (type === "RFIDExceptionTasksFinished") {
            await GenerateAndUploadTasksCSV(backfillScheduleID);
        } else {
            throw new Error();
        }

        await resumeExecution(taskToken, input);
    } catch (error) {
        logger.error(error, 'handler');
        await failExecution(taskToken);
        throw error;
    }
    logger.endTrace('handler');
};

async function ValidateSchedule(backfillScheduleID) {
    logger.startTrace('ValidateSchedule');
    let sql, args, results;

    sql = `
        SELECT
            DISTINCT sis.BackfillScheduleID
        FROM store_inventory_snapshot sis
        WHERE
            sis.BackfillScheduleID = ? AND
            sis.DateCompleted IS NULL AND
            # Only send IPS update file if the both IPS reads have been done
            sis.QuantityExternalStart IS NOT NULL AND
            sis.QuantityExternalEnd IS NOT NULL
        LIMIT 1`;

    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'ValidateSchedule');
        throw error;
    }

    logger.endTrace('ValidateSchedule');
    return results.length ? true : false;
}

async function GenerateAndUploadScheduleCompletedCSV(backfillScheduleID) {
    logger.startTrace('GenerateAndUploadScheduleCompletedCSV');
    logger.info('Generating .csv for Backfill Schedule Completed ID:', 'GenerateAndUploadScheduleCompletedCSV', { backfillScheduleID});
    let qualifiedKeycodes = [];
    let sql, args, results;

    sql = `
        SELECT
            sbs.LocationID,
            sbs.isCurrentAdjustmentCanceled,
            loc.Timezone
        FROM store_backfill_schedule sbs
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        WHERE sbs.ID = ?`;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'GenerateAndUploadScheduleCompletedCSV');
        throw new Error(`Error in getting the RFID and user counts`);
    }

    if (!results.length) {
        throw new Error();
    }

    results = results[0];

    const locationID = results["LocationID"];
    const isCurrentAdjustmentCanceled = results["isCurrentAdjustmentCanceled"];
    const timezone = results["Timezone"];

    if (isCurrentAdjustmentCanceled) {
        await SkipAdjustment(backfillScheduleID);
        return;
    }

    // Get the RFID count and user counts as we'll need to compare them
    sql = `
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
                # Why are we using APN from product table and not product_barcode
                p.APN,
                sis.Keycode,
                IFNULL(sis.Quantity, 0) AS RFIDCount,
                IFNULL(sis.QuantityExternalEnd, 0) AS QuantityExternalEnd,
                DATE_FORMAT(CONVERT_TZ(sis.DateSnapshot, 'UTC', loc.Timezone), '%Y-%m-%d %H:%i:%s') AS SnapShot_DateTime
            FROM store_inventory_snapshot sis
            INNER JOIN location loc ON loc.ID = sis.LocationID
            INNER JOIN container c ON c.ID = sis.ContainerID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
            INNER JOIN product p ON sis.Keycode = p.Keycode
            WHERE
                sis.BackfillScheduleID = ?
                AND sis.DateCompleted IS NULL
                AND IFNULL(sis.HasRecentManifest, 0) = 0
                AND sis.TaskID IS NULL
                AND IFNULL(sis.IsOverThreshold, 0) = 0
                AND ct.isSystemInv
                AND IFNULL(sis.QuantityExternalStart, 0) = IFNULL(sis.QuantityExternalEnd, 0)
            GROUP BY sis.ID
        ) AS a
        GROUP BY a.Keycode
        # Only select rows with all tasks completed and a total RFID to Count difference of 1 or less
        HAVING isUnderMinCountVariance = 0
        `;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'GenerateAndUploadScheduleCompletedCSV');
        throw new Error(`Error in getting the RFID and user counts`);
    }

    for (let row of results) {
        qualifiedKeycodes.push(row["KD"]);
    }

    await cleanupDBForCompletedSchedule(backfillScheduleID, qualifiedKeycodes);

    // If there were results, utilize json2csv's parse() method in order to turn it into a valid .csv format
    if (results.length) {
        await UploadCSV(results, backfillScheduleID, locationID, timezone, false);
    } else {
        logger.info('No Keycodes found for IPS Update CSV for schedule complete on schedule ${backfillScheduleID}', '');

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
    logger.endTrace('GenerateAndUploadScheduleCompletedCSV');
}

async function GenerateAndUploadTasksCSV(backfillScheduleID) {
    logger.startTrace('GenerateAndUploadTasksCSV');
    logger.info('Generating .csv for Backfill Schedule ID Tasks Completed:', 'GenerateAndUploadTasksCSV', { backfillScheduleID});
    let qualifiedKeycodes = [];
    let sql, args, results;

    sql = `
        SELECT
            sbs.LocationID,
            sbs.isCurrentAdjustmentCanceled,
            loc.Timezone
        FROM store_backfill_schedule sbs
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        WHERE sbs.ID = ?`;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '');
        throw new Error(`Error in getting the RFID and user counts`);
    }

    if (!results.length) {
        throw new Error();
    }

    results = results[0];

    const locationID = results["LocationID"];
    const isCurrentAdjustmentCanceled = results["isCurrentAdjustmentCanceled"];
    const timezone = results["Timezone"];

    if (isCurrentAdjustmentCanceled) {
        await SkipAdjustment(backfillScheduleID);
        return;
    }

    // Get the RFID count and user counts as we'll need to compare them
    sql = `
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
                AND sis.DateCompleted IS NULL
                AND IFNULL(sis.HasRecentManifest, 0) = 0
                AND sis.TaskID IS NOT NULL
                AND ct.isSystemInv
            GROUP BY sis.ID
        ) AS a
        GROUP BY a.Keycode
        # Only select rows with all tasks completed and a total RFID to Count difference of 1 or less
        HAVING
            ABS(Qty_Total - sumQuantityCounted) <= 1
            AND anyTasksNotCompleted = 0
        `;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '');
        throw new Error(`Error in getting the RFID and user counts`);
    }

    for (let row of results) {
        qualifiedKeycodes.push(row["KD"]);
    }

    await cleanupDBForTasks(backfillScheduleID, qualifiedKeycodes);

    if (results.length) {
        await UploadCSV(results, backfillScheduleID, locationID, timezone, true);
    } else {
        logger.info('No Keycodes found for IPS Update CSV for tasks on schedule ${backfillScheduleID}', '');

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
    logger.endTrace('GenerateAndUploadTasksCSV');
}

async function cleanupDBForCompletedSchedule(backfillScheduleID, qualifiedKeycodes) {
    logger.startTrace('cleanupDBForCompletedSchedule');
    let sql, args;
    sql = "";
    args = [];
    logger.info('Cleaning up DB for completed schedule ${backfillScheduleID}', '');

    // cleanup by performing these steps:
    // 1. Set ExternalInventoryAdjust to true for the keycodes that were a part of the .csv
    // 2. Set the store_inventory_snapshot for this BackfillScheduleID as Completed

    // Only UPDATE store_inventory_snapshot rows with ExternalInventoryAdjust if the Keycode list was provided
    if (qualifiedKeycodes && qualifiedKeycodes.length) {
        sql += `
            UPDATE store_inventory_snapshot
            SET ExternalInventoryAdjust = 1
            WHERE
                BackfillScheduleID = ?
                AND DateCompleted IS NULL
                AND Keycode IN (?)
            ;`;
        args.push(backfillScheduleID, qualifiedKeycodes);
    }
    sql += `
        UPDATE store_inventory_snapshot
        SET DateCompleted = NOW()
        WHERE
            BackfillScheduleID = ?
            AND DateCompleted IS NULL
            AND TaskID IS NULL
        ;`;
    args.push(backfillScheduleID);

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'cleanupDBForCompletedSchedule');
        throw new Error(`Error in SQL when performing cleanup`);
    }
    logger.endTrace('cleanupDBForCompletedSchedule');
}

async function cleanupDBForTasks(backfillScheduleID, qualifiedKeycodes) {
    logger.startTrace('cleanupDBForTasks');
    let sql, args;
    sql = "";
    args = [];
    logger.info('Cleaning up DB for tasks schedule ${backfillScheduleID}', '');

    // cleanup by performing these steps:
    // 1. Set ExternalInventoryAdjust to true for the keycodes that were a part of the .csv
    // 2. Set the store_inventory_snapshot for this BackfillScheduleID as Completed
    // 3. Set all the associated Inventory tasks as Fulfilled
    // 4. Set all the associated Inventory task groups as Fulfilled

    // Only UPDATE store_inventory_snapshot rows with ExternalInventoryAdjust if the Keycode list was provided
    if (qualifiedKeycodes && qualifiedKeycodes.length) {
        sql += `
            UPDATE store_inventory_snapshot
            SET ExternalInventoryAdjust = 1
            WHERE BackfillScheduleID = ?
                AND DateCompleted IS NULL
                AND Keycode IN (?)
            ;`;
        args.push(backfillScheduleID, qualifiedKeycodes);
    }

    sql += `
        UPDATE store_inventory_snapshot
        SET DateCompleted = NOW()
        WHERE
            BackfillScheduleID = ?
            AND DateCompleted IS NULL
            ;`;
    args.push(backfillScheduleID);

    sql += `
        UPDATE task
        SET DateFulfilled = NOW()
        WHERE DateFulfilled IS NULL AND Type = 'Inventory' AND ReferenceID = ?
        ;
        UPDATE task_group
        SET DateFulfilled = NOW()
        WHERE DateFulfilled IS NULL AND Type = 'Inventory' AND ReferenceID = ?
        ;`;
    args.push(backfillScheduleID, backfillScheduleID);

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '');
        throw new Error(`Error in SQL when performing cleanup`);
    }
    logger.endTrace('cleanupDBForTasks');
}

async function SkipAdjustment(backfillScheduleID) {
    logger.startTrace('SkipAdjustment');
    let sql, args;
    logger.info('Skipping Inventory Adjustment for Backfill Schedule ${backfillScheduleID}', '');

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
        logger.error(error, 'SkipAdjustment');
        throw new Error(`Error in SQL when resuming Backfill Schedule`);
    }
    logger.endTrace('SkipAdjustment');
}

async function UploadCSV(inventoryRows, backfillScheduleID, storeName, timezone, isTaskUpload = false) {
    logger.startTrace('UploadCSV');
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
            BackfillScheduleID = ?
            AND DateCompleted = (SELECT MAX(DateCompleted) FROM store_inventory_snapshot WHERE BackfillScheduleID = ?)
            AND IF(TaskID IS NOT NULL, 1, 0) = ?`;
    let args = [backfillScheduleID, backfillScheduleID, isTaskUpload];

    let resultsDebug;

    try {
        [resultsDebug] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'UploadCSV');
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
            logger.error(error, '');
            throw new Error(`Error in uploading the .csv file to S3 and sending the email`);
        }
    }
    logger.endTrace('UploadCSV');
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

            try {
                SNS.publish(snsParams, function(err, data) {
                    if (err) {
                        logger.error(err, 'sendSnsTopic');
                        throw new Error(err);
                    }
                    if (verbose) {
                        logger.info('Successfully sent the message\n', 'sendSnsTopic', { data});
                    }

                    resolve(data);
                });
            } catch (err) {
                reject(err);
            }
        } catch (err) {
            logger.error(err, 'sendSnsTopic');
            reject(err);
        }
    });
}

async function SendEmailWithAttachments(emailData, files = []) {
    logger.startTrace('SendEmailWithAttachments');
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
        logger.info('Email', 'SendEmailWithAttachments', {email});
    } catch (error) {
        logger.error(`Unable to send an email. ${error}`, 'SendEmailWithAttachments');
    }
    logger.endTrace('SendEmailWithAttachments');
}

const PutFileToS3 = async (fileName, fileData, s3BucketName) => {
    logger.startTrace('PutFileToS3');

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
        logger.info('File uploaded to S3:', 'PutFileToS3', { putFile});
        logger.endTrace('PutFileToS3');
        return putFile.Location;
    } catch (error) {
        logger.error(`Failed to upload to s3 bucket: ${error}`, 'PutFileToS3');
        throw new Error(`Failed to upload to s3 bucket: ${error}`);
    }
};

async function resumeExecution(taskToken, output) {
    logger.startTrace('resumeExecution');
    const params = {
        "taskToken": taskToken,
        "output": JSON.stringify(output)
    };

    await stepfunctions.sendTaskSuccess(params).promise();
    logger.endTrace('resumeExecution');
}

async function failExecution(taskToken) {
    logger.startTrace('failExecution');
    const params = {
        "taskToken": taskToken
    };

    await stepfunctions.sendTaskFailure(params).promise();
    logger.endTrace('failExecution');
}
