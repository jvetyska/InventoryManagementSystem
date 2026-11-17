const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { AWS } = require("/opt/nodejs/xray.js");
const helper = require("/opt/nodejs/helper.js");
const s3 = new AWS.S3({ signatureVersion: "v4" });
const inventoryBotAPIHelper = require("/opt/nodejs/inventoryBotHelper.js");
const sizeOf = require("image-size");
const logger = require("/opt/nodejs/logger.js")("upload-tory-map"); 

/**
 *  Input:
 *  {
        Input: {
            "status": "RunDataReady", // status
            "inventoryName": "2010-02-01", //runName
            "inventoryBotID": "1001", //inventoryBotID
            "mapAreaName": "Testing", //taskConfig
            "location": "Testing", // DefaultMap
            "executionName": "26_2021-08-22_12-59-00_RunDataReady"
            "isUpdateInventory": true, // Are we updating inventory flag
            "locationID": "2001-STR", // Store ID
            "rfidInventoryHistoryInsertDate": "2021-10-10T12:12:12"
        }
    }
 */
let config, pool, settings;
exports.handler = async (event) => {
    logger.startTrace("handler");
    let input;
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        settings = await helper.getSettings();
        pool = await wmsDB.getPool();

        logger.info("Input Body", `handler:input`, event);

        if (!event || !event.Input) {
            logger.error("No Input, Ending Upload Tory Map Lambda", "handler");
            throw new Error(`Upload Tory Map Lambda: Missing Input Body`);
        }
        input = event.Input;

        if (!Object.prototype.hasOwnProperty.call(input, "inventoryBotID")
            || !Object.prototype.hasOwnProperty.call(input,  "location")
            || !Object.prototype.hasOwnProperty.call(input, "mapAreaName")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryName")
            || !Object.prototype.hasOwnProperty.call(input, "status")
            || !Object.prototype.hasOwnProperty.call(input, "executionName")
        ) {
            throw new Error(`Missing executionName, inventoryName, Status, location, mapAreaName or InventoryBotID`);
        }

        logger.info(`Upload Tory Map for Tory: ${input.inventoryBotID} 
            run: ${input.inventoryName} with status ${input.status}
        `, "handler");

        await uploadMapToS3(input.inventoryBotID, input.inventoryName, input.mapAreaName);

        let botProcessSystemStatus = Object.prototype.hasOwnProperty.call(input, "error") ? "Failed" : "Success";
        await updateBotProcessSystem(input.executionName, botProcessSystemStatus);

        logger.endTrace("handler");
        return input;
    } catch (error) {
        await updateBotProcessSystem(input.executionName, "Failed");
        logger.error("EXIT", "handler", {error: error, input: input});
        throw (`Tory Map uploading failed ${error}`);
    }
};

const uploadMapToS3 = async (botID, inventoryName, taskConfig) => {
    logger.startTrace("uploadMapToS3");
    const locationMapBucketName = config.bucket.wms_assets;
    const runMapBucketName = config.bucket.bot_run_map;
    const locationMapBucketURL = config.StoreFilesWithDomain ? config.base_url : "" + config.bucket.wms_assets_url;
    const runMapBucketURL = config.StoreFilesWithDomain ? config.base_url : "" + config.bucket.bot_run_map_url;
    let locationMapkey = `bot-location/${botID}/locationMap.png`;
    let s3UploadOptions;
    let sql, args, locationHeight, locationWidth, runWidth, runHeight, CellSize, OffSetX, OffSetY;
    let getmapApiResults, getRunMapApiResults, getMapMetaDataResults, runMapkey, inventoryBotInfo;

    logger.info(`Uploading Map to S3 for Bot ${botID} and Run ${inventoryName}`, "uploadMapToS3");

    try {
        // get the basic IPaddress and defaultMap for the Bot from DB
        inventoryBotInfo = await inventoryBotAPIHelper.getInventoryBotInfo(botID);

        const getLocationMapUrl = `${inventoryBotInfo.IPAddress}/v1/getMap`;
        const getRunEvaluationMapUrl = `${inventoryBotInfo.IPAddress}/v1/getRunEvaluationMap`;
        const getMapMetaDataUrl = `${inventoryBotInfo.IPAddress}/v1/getMapMetaData`;

        const params = {
            location: inventoryBotInfo.DefaultMap,
            inventory: inventoryName
        };
        const getMapApiTimeout = settings.inventoryBot.getToryMapTimeout;
        const option = {
            "responseType": "arraybuffer",
            "timeout": getMapApiTimeout
        };

        // Only want to set
        if (!config.hamiltonEnvSslCert) {
            s3UploadOptions = {
                ACL: "public-read"
            };
        }

        logger.trace("uploadMapToS3:tory:api:getMap");
        // get the location map
        getmapApiResults = await inventoryBotAPIHelper.get(getLocationMapUrl, null, option);

        // upload location map to s3
        await uploadFileToS3(locationMapBucketName, locationMapkey, getmapApiResults, s3UploadOptions);
        logger.info(`Finished uploading location map to S3 for Bot ${botID}
            and Run ${inventoryName}`, "uploadMapToS3:LocationMapUploadtoS3");

        logger.trace("uploadMapToS3:tory:api:getMapMetaData");
        // get the map meta data
        getMapMetaDataResults = await inventoryBotAPIHelper.get(getMapMetaDataUrl);

        if (getMapMetaDataResults) {
            CellSize = getMapMetaDataResults.CellSize;
            OffSetX  = getMapMetaDataResults.Offset.X;
            OffSetY  = getMapMetaDataResults.Offset.Y;
        }

        logger.trace("uploadMapToS3:tory:api:getRunEvaluationMap");
        // if inventoryName is provided than we can get the run evaluation map and upload to s3
        getRunMapApiResults = await inventoryBotAPIHelper.get(getRunEvaluationMapUrl, params, option);
        if (inventoryName && taskConfig) {

            runMapkey = `bot-run/${botID}/${taskConfig}_(${inventoryName}).png`;
            await uploadFileToS3(runMapBucketName, runMapkey, getRunMapApiResults, s3UploadOptions);
            logger.info(`Finished uploading run evaluation map to S3 for Bot ${botID}
                and Run ${inventoryName}`, "uploadMapToS3:RunMapUploadtoS3");
        }
    } catch (error) {
        logger.error(`Map upload failed for Bot ${botID} and Run ${inventoryName}`, "uploadMapToS3", error);
        throw new Error(`Map upload failed for inventory bot ID : ${botID}`);
    }

    // Store the s3Url, height, width for location and runMap to DB
    const dimensions = await sizeOf(getmapApiResults);
    locationHeight = dimensions.height;
    locationWidth = dimensions.width;

    let locationMapUrl = `${locationMapBucketURL}/${locationMapkey}`;
    let runMapUrl = `${runMapBucketURL}/${runMapkey}`;

    if (!inventoryBotInfo.MapID) {
        sql = ` INSERT INTO inventory_bot_map(InventoryBotID, Type, MapUrl, MapHeight, MapWidth, CellSize, OffSetX, OffSetY)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ;
                UPDATE inventory_bot SET MapID = LAST_INSERT_ID() WHERE ID IN (?)
                ;
            `;
        args = [botID, "Location", locationMapUrl, locationHeight, locationWidth, CellSize, OffSetX, OffSetY, botID];

    } else {
        sql = ` UPDATE inventory_bot_map SET MapUrl = ?, MapHeight = ?, MapWidth = ?, CellSize = ?, OffSetX = ?, OffSetY = ?
                WHERE ID = ?
                ;
            `;
        args = [locationMapUrl, locationHeight, locationWidth, CellSize, OffSetX, OffSetY, inventoryBotInfo.MapID];
    }

    try {
        logger.trace("uploadMapToS3:pool:query:LocationMapUpdate");
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "uploadMapToS3:LocationMapUpdate");
        throw new Error(`DB Location Map Update failed for inventory bot ID : ${botID}`);
    }

    if (inventoryName) {
        sql = `SELECT * FROM bot_process_history WHERE InventoryBotID = ? AND Name = ?`;
        args = [botID, inventoryName];
        logger.trace("uploadMapToS3:pool:query:botProcessHistory");
        const [botProcessData] = await pool.query(sql, args);

        if (botProcessData.length) {
            const dimensions = await sizeOf(getRunMapApiResults);
            runHeight = dimensions.height;
            runWidth = dimensions.width;

            if (!botProcessData[0].MapID) {
                sql = ` INSERT INTO inventory_bot_map(InventoryBotID, Type, MapUrl, MapHeight, MapWidth, CellSize, OffSetX, OffSetY)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ;
                        UPDATE bot_process_history SET MapID = LAST_INSERT_ID() WHERE ID IN (?)
                        ;
                    `;
                args = [botID, "Run", runMapUrl, runHeight, runWidth, CellSize, OffSetX, OffSetY, botProcessData[0].ID];
            } else {
                sql = ` UPDATE inventory_bot_map SET MapUrl = ?, MapHeight = ?, MapWidth = ?, CellSize = ?, OffSetX = ?, OffSetY = ?
                        WHERE ID = ?
                        ;
                    `;
                args = [runMapUrl, runHeight, runWidth, CellSize, OffSetX, OffSetY, botProcessData[0].MapID];
            }
            try {
                logger.trace("uploadMapToS3:pool:query:RunMapUpdate");
                await pool.query(sql, args);
            } catch (error) {
                logger.error(error, "uploadMapToS3:RunMapUpdate");
                throw new Error(`DB Run Map Update failed for inventory bot ID : ${botID}`);
            }
        }
    }
    logger.endTrace("uploadMapToS3");
};

const uploadFileToS3 = async (bucketName, key, data, options) => {
    logger.startTrace("uploadFileToS3");
    let s3Params = {
        Bucket : bucketName,
        Key    : key,
        Body   : data
    };
    if (options) {
        s3Params = Object.assign(options, s3Params);
    }
    logger.info(`Upload s3 bucket: ${s3Params.Bucket}/${s3Params.Key}`, "uploadFileToS3:params");
    try {
        const putFile = await s3.upload(s3Params).promise();
        logger.info("S3 upload Success", "uploadFileToS3", putFile);
    } catch (error) {
        logger.error(error, "uploadFileToS3");
        throw new Error(`Tory map upload to s3 failed`);
    }
    logger.endTrace("uploadFileToS3");
};

const updateBotProcessSystem = async(executionName, botProcessSystemStatus) => {
    logger.startTrace("updateBotProcessSystem");
    let sql = `
        UPDATE process_tory_data_step_function
        SET Status = ?
        WHERE ExecutionName = ?;
    `;
    let args = [botProcessSystemStatus, executionName];

    try {
        logger.trace("updateBotProcessSystem:pool:query:updateBotProcessSystem");
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "updateBotProcessSystem");
        throw new Error(`Failed while updating process_tory_data_step_function table in DB
            for state Name: ${executionName}.`);
    }
    logger.endTrace("updateBotProcessSystem");
};