/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
const { axios, AWS } = require("/opt/nodejs/xray.js");
const moment = require("moment");
const getConfig = require("/opt/nodejs/config.js");
const logger = require('/opt/nodejs/logger.js')('combine-daily-logs'); 

async function GetLogs() {
    let environment = process.env.NODE_ENV;
    let daysAgo     = 0;
    let config = await getConfig.getConfig(process.env.NODE_ENV);
    // get the region, slackChannel, bucket etc from config.json file in layers
    const region = config.region;
    AWS.config.update({region: region});
    const s3 = new AWS.S3();
    const loggingBucket = config.bucket.logging;
    const maxKeys = config.bucket.maxKeys;
    const logNotificationURL = config.logNotification;

    if (process.env.DAYS_AGO) {
        daysAgo = parseInt(process.env.DAYS_AGO);
    }

    let params;
    let body = "";
    // Because this job gets called five minutes after the hour, subtract ten minutes from
    // the current time to get all of yesterday's logs if it just rolled over midnight
    let day  = moment.utc().subtract(10, "minutes").format("YYYY/MM/DD");
    let day2 = moment.utc().subtract(10, "minutes").format("MMMM D, YYYY");
    let prefix = `${environment}-firehose/` + day;
    let slackLog = `Latest log file for \`${day2}\` (UTC)\n`;

    if (daysAgo < 0) {
        return {"statusCode": 500, "body": "The 'daysAgo' MUST NOT be a negative number"};
    }

    // Get all files in the bucket that start with the defined prefix
    let logfiles = [];
    let first    = true;
    let token    = null;

    while (first || token) {
        first = false;

        params = {
            "Bucket"           : loggingBucket,
            "MaxKeys"          : maxKeys,
            "Prefix"           : prefix,
            "ContinuationToken": token
        };

        let response = await s3.listObjectsV2(params).promise();
        let files = response.Contents;
        token     = response.NextContinuationToken || null;

        for (let file of files) {
            logfiles.push(file["Key"]);
        }
    }

    // Read all logfiles that exist in today's collection and append their contents to the one single body
    let fileName = prefix.replace(/\//g, "-");
    let filePath = `/tmp/${fileName}`;
    let logfilesRead = 0;

    // for (key of logfiles) {
    for (let i = 0; i < logfiles.length; i++) {
        let key = logfiles[i];

        params = {
            "Bucket": loggingBucket,
            "Key"   : key
        };

        let r = await s3.getObject(params).promise();
        let str = r.Body.toString("utf-8");
        body += str;
        console.log(`[${++logfilesRead}/${logfiles.length}] File read`);
    }

    // Upload the body to S3
    params = {
        "Bucket": loggingBucket,
        "Key"   : `${environment}-full/${fileName}`,
        "Body"  : body,
        "ACL"   : "public-read"
    };

    let file = await s3.upload(params).promise();
    slackLog += file.Location;
    await axios.post(logNotificationURL, {"text": slackLog});
    return {"statusCode": 200, "body": file.Location};
}

exports.handler = async (event) => {
    return await GetLogs();
};
