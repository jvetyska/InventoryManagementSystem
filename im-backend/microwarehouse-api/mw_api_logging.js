/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const moment = require("moment");
const authHelper = require("../library/authHelper");
const logging = require("../library/logging");
const helper = require("../library/helperFn");
const csvConverter = require("json-2-csv");
const { AWS, axios } = require("../library/xray");
AWS.config.update({ region: config.aws_region });
const UUID = require("uuid/v4");
const zlib = require("zlib");
const s3 = new AWS.S3({apiVersion: "2006-03-01"});
const firehose = new AWS.Firehose();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const BUCKET = config.s3_bucket.logging;
const MAX_KEYS = 1000; // 1,000 is the maximum amount AWS allows us to retrieve with one call
const logger = require("../library/logger")("microwarehouse-api:mw_api_logging");

const UnzipS3File = (key, bucket) => {
    return new Promise(async (resolve, reject) => {
        let options = {
            Bucket: bucket,
            Key: key
        };

        s3.getObject(options, function(error, res) {
            if (error) {
                return reject(error);
            } else {
                resolve(zlib.unzipSync(res.Body).toString());
            }
        });
    });
};

exports.record_inventory_history = async function(req, res) {
    // First, Find the location for which you can take inventory snapshots.  Insert the location into scheduled_job table if it doesn't exits.
    // Second, clean up records older than 62 days for now.
    // Third, Insert inventory for locations.
    // Forth, To keep track when we took last snapshot, Update the scheduled_job table with LocationID and BackupDate

    let sql, args, results, message;
    sql = `
        SELECT now() as currentTimeStamp, GROUP_CONCAT(ID) as LocationIDs
        FROM (
            select loc.ID,
            CONVERT_TZ(NOW(), 'UTC', loc.Timezone) as ConvertToLocalTime,
            # add the last LastRunDate + 1 day, compare with current time to find out should we take backup for this location or not.
            CONVERT_TZ(DATE_ADD(sj.LastRunDate, INTERVAL 1 DAY), 'UTC', loc.Timezone) as LastRunDate
            FROM location loc
            LEFT JOIN scheduled_job sj ON loc.ID = sj.LocationID AND sj.JobName = 'inventory_history_backup'
            # check for null, if we are taking backup for the first time and location doesn't exits in scheduled_job table
            HAVING LastRunDate IS NULL OR ConvertToLocalTime > LastRunDate
        ) as A;

        # If we are running location backup for first time, record the location in scheduled_job table
        INSERT INTO scheduled_job(LocationID, LastRunDate, JobName)
        Select ID, now(), 'inventory_history_backup' as JobName FROM location
        WHERE NOT EXISTS (SELECT LocationID from scheduled_job sj
                            WHERE sj.LocationID = location.ID AND sj.JobName = 'inventory_history_backup'
                        );
    `;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error("record_inventory_history: ", {error});
        res.status(200).json({"message": "Error Occurred. Returning 200 so that Lambda does not retry."});
    }

    if (!results[0][0].LocationIDs) {
        res.status(200).json({"message": "No location available to take inventory backup right now."});
        return;
    }

    let locations = results[0][0].LocationIDs;
    let LastRunDate = results[0][0].currentTimeStamp;

    sql = `
        DELETE FROM inventory_history WHERE Date < NOW() - INTERVAL 62 DAY
        ;
        INSERT IGNORE INTO inventory_history (Date, LocationID, ContainerID, Keycode, Quantity)
        SELECT DATE(Now()) AS Date, c.LocationID, i.ContainerID, i.Keycode, COUNT(*) AS Quantity
        FROM inventory i
        INNER JOIN container c ON i.ContainerID = c.ID AND c.Type IN ('SHL', 'RSV', 'CRT', 'RCV', 'OTH', 'STR')
        INNER JOIN location loc ON loc.ID = c.LocationID AND loc.IsOpen = 1
        WHERE FIND_IN_SET( c.LocationID, ?)
        GROUP BY c.LocationID, i.Keycode, i.ContainerID
        ORDER BY c.LocationID, i.Keycode, i.ContainerID
        ;
        UPDATE scheduled_job SET LastRunDate = ? where FIND_IN_SET( LocationID, ?);
    `;
    args = [locations, LastRunDate, locations];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("record_inventory_history: ", {error});
        res.status(200).json({"message": "Error Occurred. Returning 200 so that Lambda does not retry."});
    }

    message = `Recording ${results[1].affectedRows} inventory, for location ${locations}, Updated backup date for ${results[2].affectedRows} location.`;
    console.log(moment().format(), message);
    res.status(200).json({"message": message});
};

exports.get_logs = async function(req, res) {
    let params, i;
    let body = "";
    let daysAgo = parseInt(req.body.days_ago || 0);
    let prefix = moment.utc().subtract(daysAgo, "days").format("YYYY/MM/DD");

    if (daysAgo < 0) {
        res.status(400).json({"message": "days_ago MUST NOT be a negative number"});
        return;
    }

    // Get all files in the bucket that start with the defined prefix
    let objects = [];
    let first = true;
    let token = null;

    while (first || token) {
        first = false;

        params = {
            "Bucket"           : BUCKET,
            "MaxKeys"          : MAX_KEYS,
            "Prefix"           : prefix,
            "ContinuationToken": token
        };
        let response;
        try {
            response = await s3.listObjectsV2(params).promise();
        } catch (error) {
            logger.error("get_logs:", {error});
            res.status(500).json({"message": "unable to list s3 objects"});
            return;
        }

        let files = response.Contents;
        token     = response.NextContinuationToken;

        for (i in files) {
            objects.push(files[i]["Key"]);
        }
    }

    // Read all objects that were retrieved and store them to the body
    let fileName = prefix.replace(/\//g, "-");
    let filePath = `/tmp/${fileName}`;

    for (i in objects) {
        let key = objects[i];

        params = {
            "Bucket": BUCKET,
            "Key"   : key
        };

        let r;
        try {
            r = await UnzipS3File(key, BUCKET);
        } catch (error) {
            logger.error("get_logs:", {error});
            res.status(500).json({"message": "unable to list s3 objects"});
            return;
        }

        body += r;
    }

    let key = `${config.env_type}-full/${fileName}`;

    // Upload the body to S3
    params = {
        "Bucket"              : BUCKET,
        "Key"                 : key,
        "Body"                : body,
        "StorageClass"        : "STANDARD",
        "ACL"                 : "private",
        "ServerSideEncryption": "AES256"
    };

    try {
        let file = await s3.upload(params).promise();
        let signedUrl = s3.getSignedUrl("getObject", {Bucket: BUCKET, Key: key});
        const datePST = moment().utcOffset("-0800").format("MMMM D, YYYY");
        const text = `Daily log file for \`${datePST}\`\n${file.Location}`;
        axios.post(config.slack_channel_bot_testing, {"text": text});
        res.status(200).json({"message": signedUrl});
    } catch (error) {
        logger.error("get_logs:");
        console.log(error);
        res.status(500).json({"message": "unable to upload s3 objects"});
        return;
    }
};

exports.start_task = async function(req, res) {
    let task = req.body.task;
    let locationId = req.body.locationId;
    let timezone;
    if (locationTimezoneMap[locationId.split("-")[0]]) {
        timezone = locationTimezoneMap[locationId.split("-")[0]].timezone;
    } else {
        timezone = "UTC";
    }
    let date = moment().tz(timezone).format("YYYY-MM-DD");
    let dateStart = moment().tz(timezone).format("YYYY-MM-DD HH:mm:ss");
    let user = authHelper.parseRole(req);
    let tableName = config.dynamodb.task_log;

    if (!task || !timezone || !locationId) {
        let error_message = "Type, Timezone, and Location are required!";
        res.status(400).json({"message": error_message});
        return;
    }

    let body = {
        "LocationID": locationId,
        "TaskType": task,
        "UserID": user.id
    };

    try {
        await logging.log_task(locationId, body);
    } catch (error) {
        res.status(500).json({"error": error});
        return;
    }

    let item = {
        "Date": date,
        "UUID": UUID(),
        "DateStart": dateStart,
        "LocationID": locationId,
        "TaskType": task,
        "UserID": user.id
    };

    let params = {
        "TableName": tableName,
        "Item": item
    };

    try {
        await dynamodb.put(params).promise();
    } catch (error) {
        res.status(500).json({"error": error});
        return;
    }

    // Send the log to firehose
    let input = `- - - ${locationId} ${locationId} - ${user.id} - ${task}`;
    await log_to_firehose(input);

    let message = `Task ${task} has been started by ${user.id} at ${locationId}`;
    logger.info("TASK_START", {dateStart, task, locationId, userId: user.id});
    res.status(200).json({"message": message});
    return;
};

async function log_to_firehose(input) {
    // This method will be skipped if the firehose logs have been disabled
    if (!config.enable_firehose_logs) {
        return;
    }

    let dateTime = moment().format("YYYY-MM-DD HH:mm:ss");
    let content  = `${dateTime} ${input}`;
    let params = {
        "DeliveryStreamName": `${config.firehose_delivery_stream_name}`,
        "Record": {
            "Data": Buffer.from(`${content}\n`) // Must have a newline in order to seperate Firehose logs on AWS
        }
    };

    await firehose.putRecord(params).promise();
    return input;
}

exports.log_rfid_print = async function(req, res) {
    const Keycode = req.body.Keycode;
    const Barcode = req.body.Barcode;
    const Quantity = req.body.Quantity;
    const EPCs = req.body.EPCs;
    const Location = req.body.Location;

    if (!Keycode || !Barcode || !Quantity || !EPCs || !Location) {
        res.status(400).json({"message": "Keycode, Barcode, Quantity, EPCs, and Location are required parameters"});
        return;
    }

    const user = authHelper.parseRole(req);
    const userID = user.id;

    let sql, args;

    sql = `
        INSERT INTO rfid_printing_history (Keycode, Barcode, Quantity, EPCs, Username, UserID, LocationID)
        SELECT ?, ?, ?, ?, u.Username, u.ID, loc.ID
        FROM user u
        INNER JOIN location loc ON loc.ID = ?
        WHERE u.ID = ?`;
    args = [Keycode, Barcode, Quantity, EPCs, Location, userID];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("log_rfid_print", {error});
        res.status(500).json({"message": "Failed to log RFID print"});
        return;
    }

    let body = {
        "LocationID": Location,
        "TaskType": "RFIDPrint",
        "Quantity": Quantity,
        "UserID": user.id
    };

    try {
        await logging.log_task(Location, body);
    } catch (error) {
        res.status(500).json({"error": error});
        return;
    }


    res.status(200).json({"message": "Success"});
};
