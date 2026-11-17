const TAG = "fetch-products-ips-db";
const db = require("/opt/nodejs/wmsDB.js");
const slack = require("/opt/nodejs/slack.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS, https } = require("/opt/nodejs/xray.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const logger = require("/opt/nodejs/logger.js")(`${TAG}`);
const mssql = require("mssql");
const sqlQueries = require("./sqlQueries");
let pool, SLACK_ERRORS, SLACK_NOTIFICATIONS, config, sqlServerConnPool, slackReportingURL, IPS_DB, sqlConfig, sqs, sqsURL, s3, s3BucketName;
const CHUNK_SIZE = 10000;


async function setup() {
    const fnName = "setup";
    try {
        logger.startTrace(fnName);
        pool = await db.getPool();
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slack_channel_errors;
        SLACK_NOTIFICATIONS = config.slack_channel_notifications;
        slackReportingURL = config.slackReportingURL;
        sqsURL = config.persist_db_sqs_url;
        s3BucketName = config.bucket.productSync;
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
        IPS_DB = localConfig.IPS_DB;
        if(!IPS_DB) {
            throw new Error("Entry for IPS_DB not found in SecretsManager ");
        }
        const config = {
            user: IPS_DB.user,
            password: IPS_DB.password,
            server: IPS_DB.host,
            database: IPS_DB.database,
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

async function streamDataFromIPS() {
    const fnName = "streamDataFromIPS";
    return new Promise(async (resolve, reject) => {
        logger.startTrace(fnName);
        try {
            mssql.connect(sqlConfig, async (err) => {
                if(err) {
                    reject(err);
                }
                const request = new mssql.Request()
                const subSectionBlockName = "mssql.connect()";
                request.stream = true;
                let rowsToProcess = [];
                let date = new Date();
                let folder = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                let filePartition = 1;
                let sqlQuery = await sqlQueries.getProductsFromIPSQuery();
                request.query(sqlQuery);
                request.on("recordset", async (columns) => {
                });
                request.on("row", async (row) => {
                    rowsToProcess.push(row);
                    if (rowsToProcess.length >= CHUNK_SIZE) {
                        request.pause();
                        await uploadJSONToS3();
                    }
                });
                request.on("rowsaffected", async (rowCount) => {
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName} ${rowCount} rows affected`);
                });
                request.on("error", (err) => {
                    slack.report(TAG, SLACK_ERRORS, 500, err.message);
                });
                request.on("done", async (result) => {
                    await uploadJSONToS3()
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}`, " Streaming rows done!");
                    resolve(true);
                });
                async function addRowsToPersistDBQueue(s3Response) {
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}`, "adding messages to queue");
                    let params = {
                        MessageBody: JSON.stringify(s3Response),
                        QueueUrl: sqsURL
                    };
                    let res = await sqs.sendMessage(params).promise();
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}`, res);
                    rowsToProcess = [];
                    request.resume();
                }
                async function uploadJSONToS3() {
                    let filename = `${folder}/products-${filePartition++}.json`;
                    let s3DataPayload = {
                        "productData": rowsToProcess
                    };
                    let s3Data = {
                        Bucket: s3BucketName,
                        Key: filename,
                        Body: JSON.stringify(s3DataPayload),
                        ContentType: 'application/json'
                    }
                    let s3Response = await s3.upload(s3Data).promise();
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}`, s3Response.Location);
                    await awsApiHelper.sendSqsMessage(sqsURL, s3Response);
                    logger.info(`${TAG}:${fnName}:${subSectionBlockName}`, " messages pushed to sqs");
                    rowsToProcess = [];
                    request.resume();
                }
            });
            mssql.on("error", async (err) => {
                logger.error(`${TAG}:${fnName}`, err);
                await slack.report(TAG, SLACK_ERRORS, 500, err.message);
                reject(err);
            });
            logger.endTrace(fnName);
        } catch (err) {
            await slack.report(TAG, SLACK_ERRORS, 500, err.message);
            reject(err);
        }
    });
}

exports.handler = async (event) => {
    const fnName = "handler";
    logger.startTrace(fnName);
    logger.info(TAG, " executed");
    // let eventBody = event.Body || null;
    try {
        await setup();
        logger.info(slack);
        await streamDataFromIPS();
        await slack.report(TAG, SLACK_NOTIFICATIONS, 200, "success");
        logger.endTrace(fnName);
        return {"statusCode": 200};
    } catch (err) {
        logger.error(`${TAG}:${fnName}`, err);
        await slack.report(TAG, SLACK_ERRORS, 500, err.message);
        return {"statusCode": 500, "error": err.message};
    }
};
