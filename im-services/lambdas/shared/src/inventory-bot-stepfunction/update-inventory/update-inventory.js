const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS } = require("/opt/nodejs/xray.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const helper = require("/opt/nodejs/helper.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require("/opt/nodejs/logger.js")("update-inventory");

/**
 * Expecting SQS InputBody as:
 *  "body": {
        "Input": {
            "status": "RunDataReady", // status
            "inventoryName": "2010-02-01", //runName
            "inventoryBotID": "1001", //inventoryBotID
            "mapAreaName": "Testing", //taskConfig
            "location": "Testing", // DefaultMap
            "executionName": "26_2021-08-22_12-59-00_RunDataReady"
            "isUpdateInventory": true, // Are we updating inventory flag
            "locationID": "2001-STR" // Store ID
        },
        "TaskToken": "abcd"
    }

    Expected Output: 
    {
        status: "RunDataReady",
        inventoryName: "2010-20-20",
        inventoryBotID: "12",
        mapAreaName: "TetsingPre",
        location: "testingPre",
        executionName: "26_2021-08-22_12-59-00_RunDataReady"
        isUpdateInventory: true,
        locationID: "2001-STR",
        updatedInventory:true,
        rfidInventoryHistoryInsertDate: "2021-10-10T12:12:12"
    };
 */

let config, pool, settings;
exports.handler = async (event) => {
    logger.startTrace("handler");
    let input, taskToken;
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        pool = await wmsDB.getPool();
        settings = await helper.getSettings();
        let eventBody = event.Records[0].body;

        if (typeof(eventBody) === "string") {
            eventBody = JSON.parse(eventBody);
        }
        logger.info("Input Body", `handler:input`, eventBody);
        if (!eventBody || !eventBody.Input) {
            logger.error("No Input, Ending Update Inventory Lambda", "handler");
            throw new Error(`Update Inventory Tory Data Lambda: Missing Input Body`);
        }

        input = eventBody.Input;
        taskToken = eventBody.TaskToken;
        if (!Object.prototype.hasOwnProperty.call(input, "isUpdateInventory") 
            || !input.isUpdateInventory
            || !Object.prototype.hasOwnProperty.call(input, "locationID")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryBotID")
            || !Object.prototype.hasOwnProperty.call(input, "mapAreaName")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryName")
            || !Object.prototype.hasOwnProperty.call(input, "status")
            || !Object.prototype.hasOwnProperty.call(input, "location")
            || !Object.prototype.hasOwnProperty.call(input, "executionName")
        ) {
            throw new Error(`Missing executionName, inventoryName, Status, location,
                inventoryName, mapAreaName, locationID, isUpdateInventory or InventoryBotID`);
        }

        logger.info(`Updating Inventory with Tory: ${input.inventoryBotID} 
            run: ${input.inventoryName} with status ${input.status}
        `, "handler");
        let responseBody = await updateInventory(input);
        let output = Object.assign(input, responseBody);

        await awsApiHelper.sendTaskSuccessAndResumeExecution(taskToken, output);
        logger.info("Output Body", "handler:output", output);
    } catch (error) {
        logger.error("EXIT", "handler", {error: error, input: input});
        let cause = error;
        let errorData =  "Updating Inventory Tory Data Lambda failed"; 
        await awsApiHelper.sendTaskFailureAndStopExecution(taskToken, cause.message, errorData);
    }
    logger.endTrace("handler");
};

const updateInventory = async (body) => {
    logger.startTrace("updateInventory");
    const { locationID, inventoryBotID, mapAreaName, inventoryName } = body;
    const UIprocess = "inventory-bot-run";
    let sql, args, results, rfidInventoryHistoryInsertDate, botProcessUpdateRows, containersToDelete;
    let inventoryAdjustmentLogging = {};
    let taskResults;
    let oldInventoryTotalCount = 0, newInventoryTotalCount = 0;
    let oldInventoryResults, newInventoryResults;
    let inventoryMap = {};

    let isMessageAlreadyProcessed = await checkDuplicateMessage(body);
    if (isMessageAlreadyProcessed) {
        logger.info("Message already processed", "main", body);
        return { updatedInventory: false };
    }

    sql = `
        SELECT
            ria.ContainerID,
            ria.Keycode,
            COUNT(*) AS newInventoryCount
        FROM rfid_inventory_adjustment ria
        WHERE ria.IsRemoved = 0 AND ria.LocationID = ?
        GROUP BY ria.ContainerID, ria.Keycode
        ;
        SELECT
            i.ContainerID,
            i.Keycode,
            COUNT(*) AS oldInventoryCount
        FROM inventory i
        INNER JOIN (
            SELECT DISTINCT ria.ContainerID
            FROM rfid_inventory_adjustment ria
            WHERE ria.LocationID = ?
        ) containers ON i.ContainerID = containers.ContainerID
        GROUP BY i.ContainerID, i.Keycode
        ;
        SELECT
            i.Keycode,
            i.ContainerID,
            i.TaskID,
            COUNT(*) AS Quantity
        FROM inventory i
        INNER JOIN (
            SELECT DISTINCT ria.ContainerID
            FROM rfid_inventory_adjustment ria
            WHERE ria.LocationID = ?
        ) containers ON i.ContainerID = containers.ContainerID
        WHERE TaskID IS NOT NULL
        GROUP BY ContainerID, Keycode, TaskID`;
    args = [locationID, locationID, locationID];

    try {
        // New rows from TORY runs are added to the table "rfid_inventory_adjustment" just before this
        // method is called. Because even a potentially small amount of replica lag is possible and could
        // be a significant issue for this process, this SQL query will not be using the read-only pool.
        logger.trace("updateInventory:pool:query:getInventory");
        [results] = await pool.query(sql, args);
        newInventoryResults = results[0];
        oldInventoryResults = results[1];
        taskResults = results[2];
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:getInventory");
        throw new Error(`Unable to get inventory data for location: ${locationID}`);
    }

    for (let result of oldInventoryResults) {
        let containerID = result.ContainerID;
        let keycode = result.Keycode;
        let oldInventoryCount = result.oldInventoryCount;
        oldInventoryTotalCount += oldInventoryCount;

        if (!inventoryMap.hasOwnProperty(containerID)) {
            inventoryMap[containerID] = {};
        }

        if (!inventoryMap[containerID].hasOwnProperty(keycode)) {
            inventoryMap[containerID][keycode] = {};
        }

        inventoryMap[containerID][keycode].oldInventoryCount = oldInventoryCount;
    }

    for (let result of newInventoryResults) {
        let containerID = result.ContainerID;
        let keycode = result.Keycode;
        let newInventoryCount = result.newInventoryCount;
        newInventoryTotalCount += newInventoryCount;

        if (!inventoryMap.hasOwnProperty(containerID)) {
            inventoryMap[containerID] = {};
        }

        if (!inventoryMap[containerID].hasOwnProperty(keycode)) {
            inventoryMap[containerID][keycode] = {};
        }

        inventoryMap[containerID][keycode].newInventoryCount = newInventoryCount;
    }

    let inventoryDifference = newInventoryTotalCount / oldInventoryTotalCount;

    if (Math.abs(inventoryDifference - 1) > settings.inventoryBot.maxInventoryBotInventoryDifference) {
        // Grab inventoryBotID from the first inventoryData row at the right array index
        let errorMessage = `RFID Inventory processing for location ${locationID} had a high inventory difference compared to previously.\n`;
        errorMessage += `Old Inventory Count: ${oldInventoryTotalCount}\n`;
        errorMessage += `New Inventory Count: ${newInventoryTotalCount}`;

        try {
            logger.trace("updateInventory:inventoryDifferenceSlackReport");
            await axios.post(config.slack_channel_errors, {"text": errorMessage});
        } catch (error) {
            logger.info(error, "updateInventory:inventoryDifferenceSlackReport");
        }

        // If the inventory difference from yesterday is too big, stop inventory update
        if (oldInventoryTotalCount > newInventoryTotalCount) {
            logger.info(`OldInventoryTotalCount is greater than newInventoryTotalCount`, "updateInventory:inventoryDifference");
            return { updatedInventory: false };
        }
    }

    sql = `
        SELECT DISTINCT ria.ContainerID
        FROM rfid_inventory_adjustment ria
        WHERE ria.LocationID = ?
        ;`;
    args = [locationID];

    try {
        logger.trace("updateInventory:pool:query:getContainerID");
        [results] = await pool.query(sql, args);
        containersToDelete = results.map(r => r.ContainerID);
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:getContainerID");
        throw new Error(`Unable to select Containers to delete for location: ${locationID}`);
    }

    if (containersToDelete.length) {
        // For UPDATE and DELETE, READ COMMITTED will only take a lock on matched/affected rows
        sql = `
            START TRANSACTION
            ;
            SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
            ;
            DELETE FROM inventory WHERE ContainerID IN (?)
            ;
            COMMIT
            ;
        `;
        args = [containersToDelete];

        try {
            logger.trace("updateInventory:pool:query:deleteInventory");
            [results] = await wmsDB.queryWithRetries(sql, args);
        } catch (error) {
            logger.error(error, "updateInventory:pool:query:deleteInventory");
            throw new Error(`Failed to delete Inventory for location: ${locationID}`);
        }
    }

    sql = `
        INSERT INTO inventory (ContainerID, TagID, ProductID, Keycode, XPosition, YPosition, ZPosition, Certainty, isSameLocation, InventoryBotID)
            SELECT ria.ContainerID, ria.TagID, ria.Barcode, ria.Keycode, ria.XPosition, ria.YPosition, ria.ZPosition, ria.Certainty, ria.isSameLocation, ria.InventoryBotID
            FROM rfid_inventory_adjustment ria
            WHERE ria.LocationID = ? AND ria.IsRemoved = 0
        ON DUPLICATE KEY UPDATE
            XPosition = VALUES(XPosition),
            YPosition = VALUES(YPosition),
            ZPosition = VALUES(ZPosition),
            Certainty = VALUES(Certainty),
            ContainerID = Values(ContainerID),
            isSameLocation = VALUES(isSameLocation),
            InventoryBotID = VALUES(InventoryBotID)
        ;`;
    args = [locationID];

    try {
        logger.trace("updateInventory:pool:query:insertInventory");
        [results] = await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:insertInventory");
        throw new Error(`Failed to insert Inventory for location: ${locationID}`);
    }

    sql = `
        INSERT INTO inventory_rfid_history (ContainerID, Keycode, ProductID, TagID, XPosition, YPosition, ZPosition, Certainty,
            MinRSSI, MaxRSSI, MeanRSSI, ReadCount, InventoryBotID, MapAreaID, RunName, IsRemoved, isSameLocation)
        SELECT ria.ContainerID, ria.Keycode, ria.Barcode, ria.TagID, ria.XPosition, ria.YPosition, ria.ZPosition, ria.Certainty,
            ria.MinRSSI, ria.MaxRSSI, ria.MeanRSSI, ria.ReadCount, ria.InventoryBotID, ria.AreaName, ria.RunName, ria.IsRemoved, ria.isSameLocation
        FROM rfid_inventory_adjustment ria
        WHERE ria.LocationID = ?
        ;
        SELECT MAX(DateCreated) AS DateCreated
        FROM inventory_rfid_history irh
        WHERE InventoryBotID = ? AND MapAreaID = ? AND RunName = ?
        ;`;
    args = [locationID, inventoryBotID, mapAreaName, inventoryName];

    try {
        logger.trace("updateInventory:pool:query:insertRFIDInventoryHistory");
        [results] = await wmsDB.queryWithRetries(sql, args);
        rfidInventoryHistoryInsertDate = results[1][0].DateCreated;
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:insertRFIDInventoryHistory");
        throw new Error(`Failed to insert inventory_rfid_history for location: ${locationID} bot: ${inventoryBotID} Run: ${inventoryName}`);
    }

    sql = `
        # For the runs which we have updated invnetory, select IDs so we can update isRunAccepted to true meaning they are fine to upload to external inventory
        SELECT DISTINCT bph.ID
        FROM bot_process_history bph
        INNER JOIN rfid_inventory_adjustment ria ON bph.InventoryBotID = ria.InventoryBotID AND bph.Name = ria.RunName
        WHERE ria.LocationID = ?
        ;`;
    args = [locationID];

    try {
        logger.trace("updateInventory:pool:query:getBotProcessHistory");
        [results] = await wmsDB.queryWithRetries(sql, args);
        botProcessUpdateRows = results.map(bph => bph.ID);
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:getBotProcessHistory");
        throw new Error(`Failed to select bot Process History rows for location: ${locationID}`);
    }

    if (botProcessUpdateRows.length) {
        sql = `
            UPDATE bot_process_history
            SET isRunAccepted = 1
            WHERE ID IN (?)
            ;`;
        args = [botProcessUpdateRows];

        try {
            logger.trace("updateInventory:pool:query:updateBotProcessHistory");
            [results] = await wmsDB.queryWithRetries(sql, args);
        } catch (error) {
            logger.error(error, "updateInventory:pool:query:updateBotProcessHistory");
            throw new Error(`Failed to update bot Process History rows for location: ${locationID}`);
        }
    }

    sql = `
        DELETE ria
        FROM rfid_inventory_adjustment ria
        WHERE ria.LocationID = ?
        ;`;
    args = [locationID];

    try {
        logger.trace("updateInventory:pool:query:deleteRfidInventoryAdjustment");
        [results] = await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:deleteRfidInventoryAdjustment");
        throw new Error(`Failed to delete rfid_inventory_adjustment rows for location ${locationID}`);
    }

    sql = "";
    args = [];
    for (let result of taskResults) {
        let keycode = result["Keycode"];
        let containerID = result["ContainerID"];
        let taskId = result["TaskID"];
        let quantity = result["Quantity"];

        sql += `
            UPDATE inventory
            SET TaskID = ?
            WHERE ContainerID = ? AND Keycode = ?
            ORDER BY IsSuspicious ASC, TaskID ASC
            LIMIT ?
            ;`;
        args.push(taskId, containerID, keycode, quantity);
    }

    // Call the query for updating task IDs for the inventory if we have any to update
    if (args.length) {
        try {
            logger.trace("updateInventory:pool:query:updateInventoryWithTask");
            await pool.query(sql, args); // The appropiate SQL query for updating tasks was defined earlier
        } catch (error) {
            logger.error(error, "updateInventory:pool:query:updateInventoryWithTask");
            throw new Error(`Failed at updating inventory with taskIDs for location: ${locationID}`);
        }
    }

    // For each container we have updated
    for (let containerID of Object.keys(inventoryMap)) {
        // For each keycode in that container
        for (let keycode of Object.keys(inventoryMap[containerID])) {
            const newInventoryCount = inventoryMap[containerID][keycode].newInventoryCount || 0;
            const oldInventoryCount = inventoryMap[containerID][keycode].oldInventoryCount || 0;
            const inventoryDifference = newInventoryCount - oldInventoryCount;

            // The key will be the barcode if it's a product, or the case's barcode if it's a case
            inventoryAdjustmentLogging[keycode] = {
                "containerID": containerID,
                "oldQuantity": oldInventoryCount,       // The quantity that was expected in the database; this may or may not be correct
                "newQuantity": newInventoryCount,         // The actual quantity of items on the shelf that the user reported
                "delta": inventoryDifference // Delta; positive value if we had more items than we thought; negative if it's less
            };
            if (newInventoryCount > oldInventoryCount) {
                helper.log_inventory("INSERT", null, keycode, inventoryDifference, "-", containerID, "", "adjust_shelf_inventory", UIprocess);
            } else if (oldInventoryCount > newInventoryCount) {
                helper.log_inventory("DELETE", null, keycode, -inventoryDifference, containerID, "-", "", "adjust_shelf_inventory", UIprocess);
            }
        }
    }

    sql = "";
    args = [];
    // Log inventory adjustment details into the inventory_adjustment table. This happens for positive increase, negative decrease, or no change at all
    try {
        for (let keycode of Object.keys(inventoryAdjustmentLogging)) {
            let productInfo = inventoryAdjustmentLogging[keycode];

            args.push([
                productInfo["containerID"],     // ContainerID
                keycode,                        // Keycode
                productInfo["oldQuantity"],     // The quantity that was expected in the database; this may or may not be correct
                productInfo["newQuantity"],     // The actual quantity of items on the shelf that the user reported
                productInfo["delta"],           // Delta; positive value if we had more items than we thought; negative if it's less
                "inventory_bot"                 // IdentifierType
            ]);
        }

        if (args.length) {
            sql = "INSERT INTO inventory_adjustment (ContainerID, Keycode, ExpectedQty, ActualQty, Delta, IdentifierType) VALUES ?";
            logger.trace("updateInventory:pool:query:InsertInventoryAdjustment");
            await pool.query(sql, [args]);
        }
    } catch (error) {
        logger.error(error, "updateInventory:pool:query:InsertInventoryAdjustment");
    }

    logger.endTrace("updateInventory");
    return {
        rfidInventoryHistoryInsertDate, updatedInventory: true
    };
};

// make sure SQS duplicate message are handled
const checkDuplicateMessage = async (data) => {
    logger.startTrace("checkDuplicateMessage");
    const { inventoryName, inventoryBotID, executionName } = data;
    let sql, args, results;
    sql = `
        SELECT * FROM process_tory_data_step_function 
            WHERE ExecutionName = ? AND status = 'InventoryUpdateDone'
        ;
        UPDATE process_tory_data_step_function SET status = 'InventoryUpdateDone'
            WHERE ExecutionName = ? 
        ;
    `;
    args = [executionName, executionName];

    try {
        logger.trace("checkDuplicateMessage:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "checkDuplicateMessage");
        throw new Error(`Already Processed this message for Bot:${inventoryBotID} Run: ${inventoryName}.`);
    }

    logger.endTrace("checkDuplicateMessage");
    return results[0].length > 0 ? true : false;
};