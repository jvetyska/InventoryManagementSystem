const TAG = "upload-images-to-s3";
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { AWS } = require("/opt/nodejs/xray.js");
const slack = require("/opt/nodejs/slack.js");
const logger = require("/opt/nodejs/logger.js")(TAG);
const sqlQueries = require("./sqlQueries");
const mssql = require("mssql");
let pool, SLACK_ERRORS, SLACK_NOTIFICATIONS, config, sqlServerConnPool, slackReportingURL, IPS_DB, PIMS_DB, sqlConfig, sqs, sqsURL, s3, s3BucketName, imagesBucketName, familyTreeMap;

async function setup() {
    const fnName = "setup";
    try {
        logger.startTrace(fnName);
        pool = await db.getPool();
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slack_channel_errors;
        SLACK_NOTIFICATIONS = config.slack_channel_notifications;
        slackReportingURL = config.slackReportingURL;
        imagesBucketName = config.bucket.imageSync;
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

async function downloadImagesFromIPS(keycodeList) {
    const fnName = "downloadImagesFromIPS";
    return new Promise (async (resolve, reject) => {
        try {
            logger.startTrace(fnName);
            mssql.connect(sqlConfig, async (err) => {
                if(err) {
                    reject(err);
                }
                const request = new mssql.Request()
                const subSectionBlockName = "mssql.connect()";
                request.stream = true;
                let rowsToProcess = [];
                let sqlQuery = await sqlQueries.getImagesForAllKeycodes(keycodeList);
                request.query(sqlQuery);
                request.on('recordset', async (columns) => {
                });
                request.on('row', async (row) => {
                    /*****
                        * This is how the data looks like for the images
                        *{
                            *    Keycode: 17782104,
                            *    IMAGE: <Buffer ff d8 ff e0 00 10 4a 46 49 46 00 01 01 00 00 48 00 48 00 00 ff db 00 43 00 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 ... 27976 more bytes>
                            *}
                    *****/
                    rowsToProcess.push(row);
                    if (rowsToProcess.length >= 100) {
                        request.pause();
                        logger.info(`${TAG}:${fnName}:${subSectionBlockName}` , ` pausing stream to upload to S3`);
                        await uploadImagesToS3();
                    }
                });
                request.on("rowsaffected", async (rowCount) => {
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}` , `${rowCount} rows affected`);
                });
                request.on("error", async (err) => {
                    logger.error(`${TAG}:${fnName}:${subSectionBlockName}:request.on('error')` ,error);
                    await slack.report(TAG, SLACK_ERRORS, 500, err.message);
                    reject(err);
                });
                request.on("done", async (result) => {
                    await uploadImagesToS3();
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}`, " Streaming rows done!");
                    resolve(true);
                });
                async function uploadImagesToS3() {
                    const localFnName = "uploadImagesToS3";
                    logger.startTrace(localFnName);
                    for(let row of rowsToProcess) {
                        let imageBuffer = Buffer.from(row.IMAGE, "hex");
                        let key = `product/${row.Keycode}.jpg`;
                        let s3Data = {
                            Bucket: imagesBucketName,
                            Key: key,
                            Body: imageBuffer,
                            ContentType: "image/jpeg"
                        };
                        await s3.upload(s3Data).promise();
                        logger.info(`${TAG}:${fnName}:${subSectionBlockName}:${localFnName}`, ` Uploaded ${key}`);
                    }
                    rowsToProcess = [];
                    request.resume();
                    logger.endTrace(localFnName);
                }
            });
            mssql.on("error", async (err) => {
                logger.error(`${TAG}:${fnName}:mssql.on('error')` ,err);
                await slack.report(TAG, SLACK_ERRORS, 500, err.message);
                reject(err);
            });
            logger.endTrace(fnName);
        } catch (err) {
            throw err;
        }
    });

}
async function updateImageHashes(keycodeImageHashMap) {
    const fnName = "updateImageHashes";
    try {
        logger.startTrace(fnName);
        logger.info(`${TAG}:${fnName}`, " execution started");
        let mainArr = [];
        for(const [keycode, imageHash] of Object.entries(keycodeImageHashMap)) {
            let arr = [];
            arr.push(keycode);
            arr.push(imageHash);
            mainArr.push(arr);
        }
        await pool.query(sqlQueries.getUpdateAllImageHashQuery(), [mainArr]);
        logger.info(`${TAG}:${fnName}`, " imageHashes updated");
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}
exports.handler = async (event) => {
    const fnName = "handler";
    try {
        logger.startTrace(fnName);
        logger.info(`${TAG}:${fnName}`, " executed");
        await setup();
        let keycodeImageHashMap = JSON.parse(event.Records[0].body);
        let keycodeList = Object.keys(keycodeImageHashMap);
        logger.info(`${TAG}:${fnName}`, " keycodes to update images received");
        await downloadImagesFromIPS(keycodeList);
        logger.info(`${TAG}:${fnName}`, " downloaded images from IPS");
        await updateImageHashes(keycodeImageHashMap);
        logger.info(`${TAG}:${fnName}`, ` updated imageHashes for ${keycodeList.length} images`);
        await slack.report(TAG, SLACK_NOTIFICATIONS, 200, ` updated imageHashes for ${keycodeList.length} images`);
        logger.endTrace(fnName);
        return {"statusCode": 200};
    } catch (err) {
        logger.error(TAG, err.message);
        await slack.report(TAG, SLACK_ERRORS, 500, err.message);
        return {"statusCode": 500, "error": err.message};
    }
};
