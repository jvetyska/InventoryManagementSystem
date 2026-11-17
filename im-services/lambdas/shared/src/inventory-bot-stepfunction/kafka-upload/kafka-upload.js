const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const kafkaHelpers = require("/opt/nodejs/kafkaHelpers.js");
const logger = require("/opt/nodejs/logger.js")("kafka-upload"); 

/**
 * INPUT EVENT:
 * {
        Input: {
            status: "RunDataReady",
            inventoryName: "2010-20-20",
            inventoryBotID: "12",
            mapAreaName: "TetsingPre",
            location: "testingPre",
            executionName: "26_2021-08-22_12-59-00_RunDataReady"
            isUpdateInventory: true,
            updatedInventory: true,
            locationID: "2001-STR",
            rfidInventoryHistoryInsertDate: "2021-10-10T12:12:12"
        }
    }

    Expected Output:
    {
        status: "RunDataReady",
        inventoryName: "2010-20-20",
        inventoryBotID: "12",
        mapAreaName: "TetsingPre",
        location: "testingPre",
        isUpdateInventory: true,
        updatedInventory: true,
        locationID: "2001-STR",
        rfidInventoryHistoryInsertDate: "2021-10-10T12:12:12"
    }
    
 */
let config, pool;
exports.handler = async (event) => {
    logger.startTrace("handler");
    let input;
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        pool = await wmsDB.getPool();
        logger.info("Input Body", `handler:input`, event);

        if (!event || !event.Input) {
            logger.error("No Input, Ending Kafka Upload Lambda", "handler");
            throw new Error(`Kafka Upload Lambda: Missing Input Body`);
        }
        input = event.Input;

        if (Object.prototype.hasOwnProperty.call(input, "updatedInventory") && !input.updatedInventory) {
            logger.info(`Not doing Kafka Upload for Tory: ${input.inventoryBotID} 
                run: ${input.inventoryName} with status ${input.status}
            `, "handler");
            return input;
        }

        if (!Object.prototype.hasOwnProperty.call(input, "locationID")
            || !Object.prototype.hasOwnProperty.call(input, "rfidInventoryHistoryInsertDate")
        ) {
            throw new Error(`Missing locationID or rfidInventoryHistoryInsertDate`);
        }

        logger.info(`Kafka Upload for Tory: ${input.inventoryBotID} 
            run: ${input.inventoryName} with status ${input.status}
        `, "handler");

        await insertRFIDHistoryToKafka(input.locationID, input.rfidInventoryHistoryInsertDate);
        logger.endTrace("handler");
        return input;
    } catch (error) {
        logger.error("EXIT", "handler", {error: error, input: input});
        throw (`Data upload to kafka failed ${error}`);
    }
};

const insertRFIDHistoryToKafka = async (locationID, dateCreated) => {
    logger.startTrace("insertRFIDHistoryToKafka");
    // If this environment does not have kafka config, we will not add
    if (!config.kafka) {
        return;
    }

    logger.info(`Adding inventory_rfid_history data to kafka for
        location ${locationID}`, "insertRFIDHistoryToKafka");

    const rfidInventoryHistoryTopic = config.kafka.rfidInventoryHistoryTopic;
    let sql, args, results;

    sql = `
        SELECT
            irh.ID,
            irh.ContainerID,
            c.LocationID,
            irh.Keycode,
            irh.ProductID,
            irh.DateCreated,
            irh.DateUpdated,
            irh.TagID,
            irh.XPosition,
            irh.YPosition,
            irh.ZPosition,
            irh.Certainty,
            irh.MinRSSI,
            irh.MaxRSSI,
            irh.MeanRSSI,
            irh.ReadCount,
            irh.InventoryBotID,
            irh.MapAreaID,
            irh.RunName,
            irh.IsRemoved,
            irh.isSameLocation
        FROM inventory_rfid_history irh
        INNER JOIN container c ON irh.ContainerID = c.ID
        WHERE c.LocationID = ? AND irh.DateCreated = ?`;
    args = [locationID, dateCreated];

    try {
        logger.trace("insertRFIDHistoryToKafka:pool:query:getDatatoUpload");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "insertRFIDHistoryToKafka:getDatatoUpload");
        throw new Error(`Kafka Upload Lambda insertRFIDHistoryToKafka Function
            Failed to select inventory_rfid_history data for location: ${locationID}`);
    }

    try {
        logger.trace("insertRFIDHistoryToKafka:rfidInventoryHistoryTopic");
        await kafkaHelpers.uploadToKafkaTopic(rfidInventoryHistoryTopic, results);
    } catch (error) {
        logger.error(error,"insertRFIDHistoryToKafka:UploadToKafka");
        throw new Error(`Kafka Upload Lambda insertRFIDHistoryToKafka Function
            Failed to upload data to kafka for location: ${locationID}`);
    }

    logger.endTrace("insertRFIDHistoryToKafka");
};