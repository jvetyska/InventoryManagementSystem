const RFIDTagManager = require("anko-rfid-tags-manager");
const { axios } = require("./xray");
const logging = require("./logging");
const helpers = require("./helperFn");
const settings = require("../config/settings");
const kafkaHelpers = require("./kafkaHelpers");
const logger = require("./logger")("rfidDataHelper");

const v8 = require("v8");


async function parseProductTags (epc) {
    // logger.startTrace("rfidDataHelper:parseProductTags");
    let barcode = await RFIDTagManager.sgtin96.parse96BitEPC(epc);
    // logger.endTrace("rfidDataHelper:parseProductTags");
    return barcode;
}

async function parseModCodes(epc) {
    logger.startTrace("rfidDataHelper:parseModCodes");
    let modcode = await RFIDTagManager.sgln96.parse96BitEPC(epc);
    logger.endTrace("rfidDataHelper:parseModCodes");
    return modcode;
}

async function sanitizeDataLine(rawData, botID, areaName, mapBoundaries, barcodeToKeycode, inventoryName, mapEdges) {
    // ID MinRSSI MaxRSSI MeanRSSI Count X Y Z FirstSeen Certainty
    // 3036-37AD-004D-2602-540B-E4C1 -67 -64 -64.5 2 4.2107 -6.00457 1.85 2020-Jun-19 21:42:12.826701 0.17

    // logger.info("mapBoundary: ", mapBoundaries);
    logger.startTrace("rfidDataHelper:sanitizeDataLine");
    let parsedData = {};
    let filteredEPCs = [];
    for (let line of rawData) {
        const regex_for_sgtin96 = /^30/g;

        let rawTag = line.split(" "); // breaking up the space
        rawTag[0] = rawTag[0].replace(/-/g, ""); // removing the dashes in the 12Byte EPC
        let containerID = null;

        const epc = rawTag[0];
        const minRSSI = rawTag[1];
        const maxRSSI = rawTag[2];
        const meanRSSI = rawTag[3];
        const readCount = rawTag[4];
        let xPosition = rawTag[5];
        let yPosition = rawTag[6];
        let zPosition = rawTag[7];
        const certainty = rawTag[10];

        // If the tag read doesn't start with 30, it isn't one of our valid tags
        if (!line.match(regex_for_sgtin96)) {
            filteredEPCs.push([epc, null, xPosition, yPosition, zPosition, certainty, areaName, inventoryName, botID, "Invalid Tag"]);
            continue;
        }

        // If inventory is not in any boundary, default container inventory in the AreaContainerID
        containerID = mapBoundaries[0].AreaContainerID;

        const mapLeft = mapEdges.mapLeft;
        const mapRight = mapEdges.mapRight;
        const mapBottom = mapEdges.mapBottom;
        const mapTop = mapEdges.mapTop;

        // Adjust position if point lies outside location map
        xPosition = adjustXPosition(xPosition, mapLeft, mapRight);
        yPosition = adjustYPosition(yPosition, mapTop, mapBottom);

        // If there are no boundaries in the inventory_bot_area, don't check the boundaries
        if (mapBoundaries[0].X1 != null) {
            for (let i in mapBoundaries) {
                let {X1, X2, Y1, Y2, BoundaryContainerID} = mapBoundaries[i];
                if (isInsideRect(X1, Y1, X2, Y2, parseFloat(xPosition), parseFloat(yPosition))) {
                    containerID = BoundaryContainerID;
                }
            }
        }

        // logger.info(`rfidDataHelper:sanitizeDataLine:parseProductTags`);
        let { barcode } = await parseProductTags(epc); // parsing SGTIN96 to get barcode
        let keycode = barcodeToKeycode[barcode];

        // If the containerID found for the inventory is undefined, it was placed in an exclude boundary so don't add it
        if (!containerID) {
            filteredEPCs.push([epc, barcode, xPosition, yPosition, zPosition, certainty, areaName, inventoryName, botID, "Exclude Boundary"]);
            continue;
        }

        if (!keycode) {
            filteredEPCs.push([epc, barcode, xPosition, yPosition, zPosition, certainty, areaName, inventoryName, botID, "No Keycode Mapping"]);
            continue;
        }

        parsedData[epc] = {
            "containerID": containerID,
            "barcode": barcode,
            "keycode": keycode,
            "xPosition": xPosition,
            "yPosition": yPosition,
            "zPosition": zPosition,
            "certainty": certainty,
            "minRSSI": minRSSI,
            "maxRSSI": maxRSSI,
            "meanRSSI": meanRSSI,
            "readCount": readCount,
            "botID": botID,
            "areaName": areaName,
            "runName": inventoryName
        };
    }

    let sql, args;

    sql = `
        INSERT INTO filtered_epc_tags (TagID, Barcode, XPosition, YPosition, ZPosition, Certainty, MapAreaID, RunName, InventoryBotID, Reason) VALUES ?
        ;
        # Update Reasons for those where we don't have a keycode mapping due to the department not being included
        UPDATE filtered_epc_tags fet
        INNER JOIN product_barcode pb ON fet.Barcode = pb.Barcode
        SET Reason = 'Filtered Department'
        WHERE fet.InventoryBotID = ? AND fet.RunName = ? AND fet.Reason = 'No Keycode Mapping'`;
    args = [filteredEPCs, botID, inventoryName];

    try {
        logger.info("rfidDataHelper:sanitizeDataLine:pool.query");
        logger.info("HEAP STATISTICS", "rfidDataHelper:sanitizeDataLine:pool.query", v8.getHeapStatistics());
        await pool.query(sql, args);
        logger.info(`Filtered ${filteredEPCs.length} Tags from Inventory Bot Run ${inventoryName}`, "rfidDataHelper:sanitizeDataLine:pool.query");
    } catch (error) {
        logger.error(`failed to insert filtered epc tags. ${error}`, "rfidDataHelper:sanitizeDataLine:pool.query");
    }

    logger.endTrace("rfidDataHelper:sanitizeDataLine");
    return parsedData;
}

async function convertRawData(rawData, barcodeToKeycode) {
    // ID MinRSSI MaxRSSI MeanRSSI Count X Y Z FirstSeen Certainty
    // 3036-37AD-004D-2602-540B-E4C1 -67 -64 -64.5 2 4.2107 -6.00457 1.85 2020-Jun-19 21:42:12.826701 0.17

    // logger.info("mapBoundary: ", mapBoundary);
    logger.startTrace("rfidDataHelper:convertRawData");
    let parsedData = [];
    for (let line of rawData) {
        let regex_for_sgtin96 = /^30/g;
        let jsonCSVObject = {};
        if (line.match(regex_for_sgtin96)) {
            // do some logic here
            let rawData = line.split(" ");
            rawData[0] = rawData[0].replace(/-/g, "");
            let epc = rawData[0];
            logger.trace(`rfidDataHelper:convertRawData:parseProductTags`);
            let { barcode } = await parseProductTags(epc);
            let keycode = barcodeToKeycode[barcode];

            jsonCSVObject = {
                "epc": rawData[0],
                "barcode": barcode,
                "keycode": keycode,
                "X": rawData[5],
                "Y": rawData[6],
                "Z": rawData[7],
                "Certainty": rawData[10]
            };
            parsedData.push(jsonCSVObject);
        }
    }
    logger.endTrace("rfidDataHelper:convertRawData");
    return parsedData;
}

async function checkReadCertainty(parsedData, inventoryBotID, inventoryName, locationID) {
    logger.startTrace("rfidDataHelper:checkReadCertainty");
    let sql, args;

    let runInventoryArg = [];

    for (let epc of Object.keys(parsedData)) {
        const inventoryItem = parsedData[epc];
        const barcode = inventoryItem.barcode;
        const containerID = inventoryItem.containerID;
        const certainty = inventoryItem.certainty;
        const keycode = inventoryItem.keycode;
        const xPosition = inventoryItem.xPosition;
        const yPosition = inventoryItem.yPosition;
        const zPosition = inventoryItem.zPosition;
        const minRSSI = inventoryItem.minRSSI;
        const maxRSSI = inventoryItem.maxRSSI;
        const meanRSSI = inventoryItem.meanRSSI;
        const readCount = inventoryItem.readCount;
        const areaName = inventoryItem.areaName;
        const runName = inventoryItem.runName;

        runInventoryArg.push([epc, barcode, keycode, containerID, locationID, xPosition, yPosition, zPosition, certainty, minRSSI, maxRSSI, meanRSSI, readCount, inventoryBotID, areaName, runName]);
    }

    const maxInventoryUpdateHours = settings.inventoryBot.maxInventoryUpdateHours;
    const maxInventoryPositionDifference = settings.RFID.maxInventoryPositionDifference;

    sql = `
        # 0: Delete old inventory from the adjustment table to make sure data is fresh
        DELETE FROM rfid_inventory_adjustment
        WHERE
            LocationID = ?
            AND DateCreated < NOW() - INTERVAL ${maxInventoryUpdateHours} HOUR
        ;`;
    args = [locationID];

    try {
        await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error("checkReadCertainty Failed to delete old rows from rfid_inventory_adjustment", "rfidDataHelper:checkReadCertainty");
        throw error;
    }

    sql = `
        # 1: Insert the run tags into inventory adjustment table
        INSERT INTO rfid_inventory_adjustment (TagID, Barcode, Keycode, ContainerID, LocationID, XPosition, YPosition, ZPosition, Certainty, MinRSSI, MaxRSSI, MeanRSSI, ReadCount, InventoryBotID, AreaName, RunName)
        VALUES ?
        ;`;
    args = [runInventoryArg];

    try {
        await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error("checkReadCertainty Failed to insert rows into rfid_inventory_adjustment", "rfidDataHelper:checkReadCertainty");
        throw error;
    }

    sql = `
        # 2: Update run with tag statistics
        UPDATE bot_process_history bph
        INNER JOIN (
            SELECT
                RunName,
                InventoryBotID,
                AVG(Certainty) AS avgCertainty,
                COUNT(*) AS numTagsProcessed
            FROM rfid_inventory_adjustment
            WHERE InventoryBotID = ? AND RunName = ?
        ) runStatistics ON bph.Name = runStatistics.RunName AND bph.InventoryBotID = runStatistics.InventoryBotID
        SET
            bph.AverageCertainty = runStatistics.avgCertainty,
            bph.NumTagsProcessed = runStatistics.numTagsProcessed
        ;`;
    args = [inventoryBotID, inventoryName];

    try {
        await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error("checkReadCertainty Failed to update bph with Run Statistics", "rfidDataHelper:checkReadCertainty");
        throw error;
    }

    // For UPDATE and DELETE, READ COMMITTED will only take a lock on matched/affected rows
    sql = `
        START TRANSACTION
        ;
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
        ;
        # 3: Filter tags on Certainty
        UPDATE rfid_inventory_adjustment ria1
        INNER JOIN rfid_inventory_adjustment ria2 ON ria1.TagID = ria2.TagID AND ria1.ID != ria2.ID AND ria2.LocationID = ria1.LocationID
        SET ria1.IsRemoved = 1
        # Remove tags with lower certainty or newer tags with tied Certainty
        WHERE
            ria1.LocationID = ?
            AND (ria1.Certainty < ria2.Certainty OR (ria1.Certainty = ria2.Certainty AND ria1.DateCreated > ria2.DateCreated))
        ;
        COMMIT
        ;`;
    args = [locationID];

    try {
        await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error("checkReadCertainty Failed to update rfid_inventory_adjustment based on certainty", "rfidDataHelper:checkReadCertainty");
        throw error;
    }

    // For UPDATE and DELETE, READ COMMITTED will only take a lock on matched/affected rows
    sql = `
        START TRANSACTION
        ;
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
        ;
        # 4: Update tags based on if they are in the same location as the previous read
        UPDATE inventory i
        INNER JOIN rfid_inventory_adjustment ria ON ria.TagID = i.TagID AND ria.ContainerID = i.ContainerID
        SET ria.isSameLocation = TRUE
        WHERE
            ria.InventoryBotID = ? AND ria.RunName = ? AND
            ABS(ria.XPosition - i.XPosition) < ${maxInventoryPositionDifference} AND
            ABS(ria.YPosition - i.YPosition) < ${maxInventoryPositionDifference}
        ;
        COMMIT
        ;`;
    args = [inventoryBotID, inventoryName];

    try {
        await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(`Failed to update Inventory Bot Run Inventory based on certainty. ${error}`, "rfidDataHelper:checkReadCertainty:pool.query");
        throw error;
    }
    logger.endTrace("rfidDataHelper:checkReadCertainty");
}

async function updateInventory(locationID, UIprocess, inventoryBotID, mapAreaName, runName) {
    logger.startTrace("rfidDataHelper:updateInventory");
    let sql, args, results, rfidInventoryHistoryInsertDate, botProcessUpdateRows, containersToDelete;
    let inventoryAdjustmentLogging = {};
    let taskResults;
    let oldInventoryTotalCount = 0, newInventoryTotalCount = 0;
    let oldInventoryResults, newInventoryResults;
    let inventoryMap = {};

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
        logger.info(`rfidDataHelper:updateInventory:pool.query`);
        [results] = await pool.query(sql, args);
        newInventoryResults = results[0];
        oldInventoryResults = results[1];
        taskResults = results[2];
    } catch (error) {
        logger.error(error, `rfidDataHelper:updateInventory:pool.query`);
        throw error;
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
            logger.info(`rfidDataHelper:updateInventory:slack`);
            await axios.post(config.slack_channel_errors, {"text": errorMessage});
        } catch (error) {
            logger.error(`RFID Inventory Updated failed to send slack error ${error}`, "rfidDataHelper:updateInventory:slack");
        }

        // If the inventory difference from yesterday is too big, stop inventory update
        if (oldInventoryTotalCount > newInventoryTotalCount) {
            logger.info(`rfidDataHelper:updateInventory:exit:inventoryDifferenceTooBig`);
            return;
        }
    }

    sql = `
        SELECT DISTINCT ria.ContainerID
        FROM rfid_inventory_adjustment ria
        WHERE ria.LocationID = ?
        ;`;
    args = [locationID];

    try {
        [results] = await pool.query(sql, args);
        containersToDelete = results.map(r => r.ContainerID);
    } catch (error) {
        logger.error("updateInventory Failed to select Containers to delete", "rfidDataHelper:updateInventory");
        throw error;
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
            ;`;
        args = [containersToDelete];

        try {
            [results] = await helpers.queryWithRetries(sql, args);
        } catch (error) {
            logger.error("updateInventory Failed to delete Inventory", "rfidDataHelper:updateInventory");
            throw error;
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
        [results] = await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error("updateInventory Failed to update Inventory with IB data", "rfidDataHelper:updateInventory");
        throw error;
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
    args = [locationID, inventoryBotID, mapAreaName, runName];

    try {
        [results] = await helpers.queryWithRetries(sql, args);
        rfidInventoryHistoryInsertDate = results[1][0].DateCreated;
    } catch (error) {
        logger.error("updateInventory Failed to insert to inventory_rfid_history", "rfidDataHelper:updateInventory");
        throw error;
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
        [results] = await helpers.queryWithRetries(sql, args);
        botProcessUpdateRows = results.map(bph => bph.ID);
    } catch (error) {
        logger.error("updateInventory Failed to select bph rows to update", "rfidDataHelper:updateInventory");
        throw error;
    }

    if (botProcessUpdateRows.length) {
        sql = `
            UPDATE bot_process_history
            SET isRunAccepted = 1
            WHERE ID IN (?)
            ;`;
        args = [botProcessUpdateRows];

        try {
            [results] = await helpers.queryWithRetries(sql, args);
        } catch (error) {
            logger.error("updateInventory Failed to update bot_process_history rows", "rfidDataHelper:updateInventory");
            throw error;
        }
    }

    sql = `
        DELETE ria
        FROM rfid_inventory_adjustment ria
        WHERE ria.LocationID = ?
        ;`;
    args = [locationID];

    try {
        logger.info(`rfidDataHelper:updateInventory:pool.query:adjust_container_inventory`);
        [results] = await helpers.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, `rfidDataHelper:updateInventory:pool.query:adjust_container_inventory`);
        throw error;
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
            logger.info(`rfidDataHelper:updateInventory:pool.query:update_task_id`);
            await pool.query(sql, args); // The appropiate SQL query for updating tasks was defined earlier
        } catch (error) {
            logger.info(error, `rfidDataHelper:updateInventory:pool.query:update_task_id`);
            throw error;
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
                logger.info(`rfidDataHelper:updateInventory:log_inventory:adjust_shelf_inventory:insert UIprocess:${UIprocess}`);
                logging.log_inventory("INSERT", null, keycode, inventoryDifference, "-", containerID, "", "adjust_shelf_inventory", UIprocess);
            } else if (oldInventoryCount > newInventoryCount) {
                logger.info(`rfidDataHelper:updateInventory:log_inventory:adjust_shelf_inventory:delete UIprocess:${UIprocess}`);
                logging.log_inventory("DELETE", null, keycode, -inventoryDifference, containerID, "-", "", "adjust_shelf_inventory", UIprocess);
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
            logger.info(`rfidDataHelper:updateInventory:pool.query:adjustment`);
            await pool.query(sql, [args]);
        }
    } catch (error) {
        logger.error(error, `rfidDataHelper:updateInventory:pool.query:adjustment`);
    }
    logger.info(`rfidDataHelper:updateInventory:insertRFIDHistoryToKafka`);
    insertRFIDHistoryToKafka(locationID, rfidInventoryHistoryInsertDate);
    logger.endTrace("rfidDataHelper:updateInventory");
}

async function shouldUpdateInventory(runName, inventoryBotID) {
    logger.startTrace("rfidDataHelper:shouldUpdateInventory");
    let sql, args, results;
    const maxInventoryUpdateHours = settings.inventoryBot.maxInventoryUpdateHours;
    const inventoryBotRunQualityThreshold = settings.inventoryBot.inventoryBotRunQualityThreshold;

    sql = `
        SELECT
            its.InventoryBotID,
            its.InventoryBotArea,
            IF (bph.ID IS NULL, 0, 1) AS hasCompletedRun
        FROM inventory_take_schedule its
        INNER JOIN (
            SELECT sbs.*
            FROM bot_process_history bph
            INNER JOIN inventory_take_schedule its ON bph.InventoryTakeScheduleID = its.ID
            INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleID = sbs.ID
            WHERE bph.Name = ? AND bph.InventoryBotID = ?
        ) sbs ON its.BackfillScheduleID = sbs.ID
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        LEFT JOIN bot_process_history bph ON its.ID = bph.InventoryTakeScheduleID
            AND bph.DateUpdated > NOW() - INTERVAL ${maxInventoryUpdateHours} HOUR
            AND bph.Status = 'RunDataReady'
            # Runs must be above quality threshold to update
            AND bph.RunQualityPct > ${inventoryBotRunQualityThreshold}
        WHERE its.Type = 'InventoryBot'
            AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)`;
    args = [runName, inventoryBotID];

    try {
        logger.info(`rfidDataHelper:shouldUpdateInventory:ro_pool.query`);
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(`RFID shouldUpdateInventory DB check failed for run ${runName}`, "rfidDataHelper:shouldUpdateInventory:ro_pool.query", {error});
        throw new Error(`RFID shouldUpdateInventory DB check failed for run ${runName}`);
    }

    const runsNotCompletedSuccesfully = results.filter(r => !r.hasCompletedRun);

    for (let run of runsNotCompletedSuccesfully) {
        logger.info(`RFID shouldUpdateInventory not updating inventory due to run ${run.InventoryBotID} ${run.InventoryBotArea}`, "rfidDataHelper:shouldUpdateInventory:runsNotCompletedSuccesfully");
    }

    // Should update inventory if there are rows but they all have compelted run
    const shouldUpdateInventory = runsNotCompletedSuccesfully.length === 0 && results.length > 0;
    logger.endTrace("rfidDataHelper:shouldUpdateInventory");
    return shouldUpdateInventory;
}

async function insertRFIDHistoryToKafka(locationID, dateCreated) {
    logger.startTrace("rfidDataHelper:insertRFIDHistoryToKafka");
    // If this environment does not have kafka config, we will not add
    if (!config.kafka) {
        return;
    }

    logger.info(`Adding inventory_rfid_history data to kafka for location ${locationID}`, "rfidDataHelper:insertRFIDHistoryToKafka");

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
        logger.info(`rfidDataHelper:insertRFIDHistoryToKafka:pool.query`);
        [results] = await pool.query(sql, args);
    } catch (error) {
        // Don't want the rest of this process to fail on Sophia upload so just log error and return
        logger.error(error, "rfidDataHelper:insertRFIDHistoryToKafka:pool.query");
        return;
    }


    try {
        logger.info(`rfidDataHelper:insertRFIDHistoryToKafka:uploadToKafkaTopic`);
        await kafkaHelpers.uploadToKafkaTopic(rfidInventoryHistoryTopic, results);
    } catch (error) {
        // Don't want the rest of this process to fail on Sophia upload so just log error and return
        logger.error(error, "rfidDataHelper:insertRFIDHistoryToKafka:uploadToKafkaTopic");
        return;
    }

    logger.info(`Finished inserting inventory_rfid_history to KAFKA for location ${locationID}`, "rfidDataHelper:insertRFIDHistoryToKafka");
    logger.endTrace("rfidDataHelper:insertRFIDHistoryToKafka");
}

// If the X Position lies outside the map, we will bring it in with a buffer
function adjustXPosition(xPosition, mapLeft, mapRight) {
    // logger.startTrace("rfidDataHelper:adjustXPosition");
    const xBorderBuffer = .5;
    let adjustedXPosition = xPosition;

    if (xPosition < mapLeft) {
        adjustedXPosition = mapLeft + xBorderBuffer;
    } else if (xPosition > mapRight) {
        adjustedXPosition = mapRight - xBorderBuffer;
    }
    // logger.endTrace("rfidDataHelper:adjustXPosition");
    return adjustedXPosition;
}

// If the Y Position lies outside the map, we will bring it in with a buffer
function adjustYPosition(yPosition, mapTop, mapBottom) {
    // logger.startTrace("rfidDataHelper:adjustYPosition");
    const yBorderBuffer = .5;
    let adjustedYPosition = yPosition;

    if (yPosition < mapBottom) {
        adjustedYPosition = mapBottom + yBorderBuffer;
    } else if (yPosition > mapTop) {
        adjustedYPosition = mapTop - yBorderBuffer;
    }
    // logger.endTrace("rfidDataHelper:adjustYPosition");
    return adjustedYPosition;
}

function isInsideRect(x1, y1, x2, y2, x, y) {
    // logger.startTrace("rfidDataHelper:isInsideRect");
    // To avoid problems as to if X1 or Y1 is the larger of the numbers, simply get the max and min values
    let minX = Math.min(x1, x2);
    let maxX = Math.max(x1, x2);
    let minY = Math.min(y1, y2);
    let maxY = Math.max(y1, y2);
    // logger.endTrace("rfidDataHelper:isInsideRect");
    return ((x >= minX && x <= maxX) && (y >= minY && y <= maxY));
}

exports.parseProductTags = parseProductTags;
exports.parseModCodes = parseModCodes;
exports.sanitizeDataLine = sanitizeDataLine;
exports.convertRawData = convertRawData;
exports.checkReadCertainty = checkReadCertainty;
exports.updateInventory = updateInventory;
exports.shouldUpdateInventory = shouldUpdateInventory;
