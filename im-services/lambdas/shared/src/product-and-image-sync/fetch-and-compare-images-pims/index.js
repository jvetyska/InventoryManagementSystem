const TAG = "fetch-and-compare-images-pims";
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { AWS } = require("/opt/nodejs/xray.js");
const slack = require("/opt/nodejs/slack.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const logger = require("/opt/nodejs/logger.js")(TAG);
const sqlQueries = require("./sqlQueries");
const mssql = require("mssql");
let pool, SLACK_ERRORS, SLACK_NOTIFICATIONS, config, sqlServerConnPool, slackReportingURL, IPS_DB, PIMS_DB, sqlConfig, sqs, sqsURL, s3, s3BucketName, familyTreeMap;

const CHUNK_SIZE = 1000;

async function setup() {
    const fnName = "setup";
    try {
        logger.startTrace(fnName);
        pool = await db.getPool();
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slack_channel_errors;
        SLACK_NOTIFICATIONS = config.slack_channel_notifications;
        slackReportingURL = config.slackReportingURL;
        s3BucketName = config.bucket.productSync;
        sqsURL = config.upload_images_s3_sqs_url;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;
        sqs = new AWS.SQS({apiVersion: '2012-11-05'});
        s3 = new AWS.S3({apiVersion: "2006-03-01"});
        sqlConfig = await getSqlConfig(config);
        logger.info(`${TAG}:${fnName}`, "Setup Complete");
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}

async function getSqlConfig(localConfig) {
    const fnName = "getSqlConfig";
    try {
        logger.startTrace(fnName);
        PIMS_DB = localConfig.PIMS_DB;
        if(!PIMS_DB) {
            throw new Error("Entry for PIMS_DB not found in SecretsManager ");
        }
        const config = {
            user: PIMS_DB.user,
            password: PIMS_DB.password,
            server: PIMS_DB.host,
            database: PIMS_DB.database,
            options: {
                encrypt: false,
                trustServerCertificate: true
            },
            authentication: {
                type: "default"
            }
        };
        logger.endTrace(fnName);
        return config;
    } catch(err) {
        throw err;
    }
}

async function compareWithDataFromPIMS(oldImageData, keycodeList) {
    let chunkedArray = [];
    let newImageData = {};
    const fnName = "compareWithDataFromPIMS";
    try {
        logger.startTrace(fnName);
        let mspool = await mssql.connect(sqlConfig);
        let sqlQuery = await sqlQueries.getCurrentImageHashQuery(keycodeList);
        let results = await mspool.request().query(sqlQuery);
        logger.info(`${TAG}:${fnName}`, " fetched recordset from PIMS_DB");
        for(let rec of results.recordset) {
            let keycode = rec.Keycode;
            let newImageHash = rec.ImageHash.toString("hex");
            if(oldImageData[keycode] == newImageHash) {
                continue;
            }
            newImageData[keycode] = newImageHash;
            if(Object.keys(newImageData).length >= CHUNK_SIZE) {
                chunkedArray.push(newImageData);
                newImageData = {};
            }
        }
        if(Object.keys(newImageData).length > 0) {  chunkedArray.push(newImageData); }
        logger.info(`${TAG}:${fnName}`, ` ${chunkedArray.length * CHUNK_SIZE} images marked for update`);
        logger.endTrace(fnName);
        return chunkedArray;
    } catch (err) {
        throw err;
    }
}

async function getExistingImageData(keycodeList) {
    let oldImageData = {};
    const fnName = "getExistingImageData";
    try {
        logger.startTrace(fnName);
        logger.info(`${TAG}:${fnName}`, "getImageDataFromDB execution started" );
        let [results] = await pool.query(sqlQueries.getOldImageHashQuery(), [keycodeList]);
        logger.info(`${TAG}:${fnName}`, "fetched old imageHashes from our DB" );
        for(let rec of results) {
            oldImageData[rec.Keycode] = rec.ImageHash;
        }
        logger.info(`${TAG}:${fnName}`, `Fetched image data for ${keycodeList.length} keycodes`);
        logger.info(`${TAG}:${fnName}`, "getImageDataFromDB execution ended" );
        logger.endTrace(fnName);
        return oldImageData;
    } catch (err) {
        throw err;
    }
}

async function checkIfImagesChanged(productList) {
    const fnName = "checkIfImagesChanged";
    try {
        logger.startTrace(fnName);
        logger.info(`${TAG}:${fnName}`, " execution started");
        let keycodes = [];
        for(let product of productList) {
            keycodes.push(product.Keycode);
        }
        let oldImageData = await getExistingImageData(keycodes);
        logger.info(`${TAG}:${fnName}`, " fetched old imageHashes");
        let imagesToBeUpdatedChunked = await compareWithDataFromPIMS(oldImageData, keycodes);
        logger.info(`${TAG}:${fnName}`, " received list of Images to be updated");
        for(let batch of imagesToBeUpdatedChunked) {
            await awsApiHelper.sendSqsMessage(sqsURL, batch);
        }
        logger.info(`${TAG}:${fnName}`, " all messages pushed to the next SQS");
        logger.info(`${TAG}:${fnName}`, " execution ended");
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}
async function downloadJSONFromS3(body) {
    const fnName = "downloadJSONFromS3";
    try {
        logger.startTrace(fnName);
        let s3Response = JSON.parse(body);
        let s3Params = {
            Bucket: s3BucketName,
            Key: s3Response.Key,
        }
        logger.info(TAG, s3Params);
        let s3Object = await s3.getObject(s3Params).promise();
        let data = s3Object.Body.toString("utf8");
        let jsonData = JSON.parse(data);
        logger.info(`${TAG}:${fnName}`, " JSON downloaded from S3 bucket");
        await checkIfImagesChanged(jsonData.productData);
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}

exports.handler = async (event) => {
    const fnName = "handler";
    try {
        logger.startTrace(fnName);
        logger.info(`${TAG}:${fnName}`, " execution starting");
        await setup();
        logger.info(event);
        await downloadJSONFromS3(event.Records[0].body);
        await slack.report(TAG, SLACK_NOTIFICATIONS, 200, "success");
        logger.info(`${TAG}:${fnName}`, " execution ending");
        logger.endTrace(fnName);
        return {"statusCode": 200};
    } catch (err) {
        logger.error(`${TAG}:${fnName}`, err);
        await slack.report(TAG, SLACK_ERRORS, 500, err.message);
        return {"statusCode": 500, "error": err.message};
    }
};
