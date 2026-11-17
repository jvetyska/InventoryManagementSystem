const wmsDB = require("/opt/nodejs/wmsDB.js");
const { AWS } = require("/opt/nodejs/xray.js");
const inventoryBotAPIHelper = require("/opt/nodejs/inventoryBotHelper.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const RFIDTagManager = require("anko-rfid-tags-manager");
const helper = require("/opt/nodejs/helper.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require("/opt/nodejs/logger.js")("preprocessing-tory-data");

/**
 * Expecting SQS InputBody as:
 *  "body": {
        "Input": {
            "status": "RunDataReady",
            "inventoryName": "2021-08-20_15-12-00",
            "inventoryBotID": 26,
            "mapAreaName": "foh_taskconfig_torylab",
            "location": "engineeringlab",
            "executionName": "26_2021-08-22_12-59-00_RunDataReady"
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
        locationID: "2001-STR"
    };
 */
let pool, settings;
exports.handler = async (event) => {
    logger.startTrace("handler");
    let input, taskToken;
    try {
        pool = await wmsDB.getPool();
        settings = await helper.getSettings();
        let eventBody = event.Records[0].body;

        if (typeof(eventBody) === "string") {
            eventBody = JSON.parse(eventBody);
        }
        logger.info("Input Body", "handler:input", eventBody);

        if (!eventBody || !eventBody.Input) {
            logger.error("No Input, Ending Preprocessing Lambda", "handler");
            throw new Error(`Preprocessing Tory Data Lambda: Missing Input Body`);
        }

        input = eventBody.Input;
        taskToken = eventBody.TaskToken;
        if (!Object.prototype.hasOwnProperty.call(input, "inventoryName") 
            || !Object.prototype.hasOwnProperty.call(input, "status")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryBotID")
            || !Object.prototype.hasOwnProperty.call(input, "mapAreaName") 
            || !Object.prototype.hasOwnProperty.call(input, "location")
            || !Object.prototype.hasOwnProperty.call(input, "executionName")
        ) {
            throw new Error(`Missing executionName, inventoryName, Status, mapAreaName,
                location or InventoryBotID`);
        }

        logger.trace(`PreProcessing Tory: ${input.inventoryBotID} 
                        run: ${input.inventoryName} with status ${input.status}
                    `, "handler");
        let responseBody = await main(input);
        let output = Object.assign(input, responseBody);

        await awsApiHelper.sendTaskSuccessAndResumeExecution(taskToken, output);
        logger.info("Output Body", "handler:output", output);
    } catch (error) {
        logger.error("EXIT", "handler", {error: error, input: input});
        let cause = error;
        let errorData =  "Preprocessing Tory Data Lambda failed";
        await awsApiHelper.sendTaskFailureAndStopExecution(taskToken, cause.message, errorData);
    }
    logger.endTrace("handler");
};

const main = async (body) => {
    logger.startTrace("main");
    const { inventoryName, inventoryBotID, mapAreaName, location } = body;
    let sql, args, results, URI, apiResults, inventoryBotIP;

    let isMessageAlreadyProcessed = await checkDuplicateMessage(body);
    if (isMessageAlreadyProcessed) {
        logger.info("Message already processed", "main", body);
        return { isUpdateInventory: false };
    }

    apiResults = await inventoryBotAPIHelper.getInventoryBotInfo(inventoryBotID);
    inventoryBotIP = apiResults.IPAddress;
    let rawData = [];
    let parsedData = [];
    let barcodeToKeycode = {};
    let containerToBoundary = {};

    try {
        URI = `${inventoryBotIP}/v1/getInventoryDataFile`;
        const getInventoryDataFileApiTimeout = settings.inventoryBot.getInventoryDataFileTimeout;
        const options = {
            "timeout": getInventoryDataFileApiTimeout
        };
        if (location && inventoryName) {
            URI = `${inventoryBotIP}/v1/getInventoryDataFile?location=${location}&inventory=${inventoryName}`;
        }
        logger.trace("main:tory:api:getInventoryDataFile");
        apiResults = await inventoryBotAPIHelper.get(URI, null, options);
        rawData = apiResults.split("\n");
    } catch (error) {
        logger.error(error, "main:tory:api:getInventoryDataFile");
        throw new Error(`Error while attempting to get inventory bot data File 
            for bot: ${inventoryBotID} run:${inventoryName} location: ${location}`);
    }

    logger.info(`Downloaded inventory file for Bot ${inventoryBotID} and Run ${inventoryName}`, "main");

    if (!rawData.length) {
        logger.error("Tory API getInventoryDataFile return empty", "main:tory:api:getInventoryDataFile");
        throw new Error(`Tory API getInventoryDataFile return empty
            for bot: ${inventoryBotID} run:${inventoryName} location: ${location}`);
    }

    sql = `
        SELECT
            ib.LocationID,
            iba.ContainerID AS AreaContainerID,
            ibb.ContainerID AS BoundaryContainerID,
            ibb.Point1X,
            ibb.Point1Y,
            ibb.Point2X,
            ibb.Point2Y,
            # Calculate metric edges of location map
            ibm.CellSize * -ibm.OffSetX AS MapLeft,
            (ibm.MapWidth - ibm.OffSetX) * ibm.CellSize AS MapRight,
            ibm.OffSetY * -ibm.CellSize AS MapBottom,
            (ibm.MapHeight - ibm.OffSetY) * ibm.CellSize AS MapTop
        FROM inventory_bot ib
        INNER JOIN inventory_bot_area iba ON ib.ID = iba.InventoryBotID
        INNER JOIN inventory_bot_map ibm ON ibm.InventoryBotID = iba.InventoryBotID AND ibm.Type = 'Location'
        LEFT JOIN inventory_bot_boundary ibb ON ib.LocationID = ibb.LocationID AND ib.DefaultMap = ibb.Map
        WHERE iba.Area = ?
        AND ib.ID = ?;`;

    args = [mapAreaName, inventoryBotID];
    try {
        logger.trace("main:pool:query:getAreaAndMapInfo");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "main:pool:query:getAreaAndMapInfo");
        throw new Error(`Unable to get Area and Map information
            for bot: ${inventoryBotID} Aread:${mapAreaName}`);
    }

    if (!results.length) {
        logger.error("Unable to get area and map info from DB", "main:pool:query:getAreaAndMapInfo");
        throw new Error(`Failed to get Area and Map data from DB 
            for Inventory Bot ${inventoryBotID} Run ${mapAreaName}`);
    }

    const locationID = results[0].LocationID;
    const mapEdges = {
        "mapLeft": results[0].MapLeft,
        "mapRight": results[0].MapRight,
        "mapBottom": results[0].MapBottom,
        "mapTop": results[0].MapTop
    };

    let i = 0;
    for (let data of results) {
        containerToBoundary[i++] = {
            "X1": data.Point1X,
            "X2": data.Point2X,
            "Y1": data.Point1Y,
            "Y2": data.Point2Y,
            "AreaContainerID": data.AreaContainerID,
            "BoundaryContainerID": data.BoundaryContainerID
        };
    }

    logger.info(`Starting sanitizing inventory file for Bot ${inventoryBotID} and Run ${inventoryName}`, "main:sanitizing");
    // Select product_barcode mappings which are in the departments of location_department for the IBs location and are not blacklisted
    sql = `
        SELECT
            pb.Keycode,
            pb.Barcode
        FROM inventory_bot ib
        INNER JOIN location_department ld ON ib.LocationID = ld.LocationID
        INNER JOIN product p ON ld.DepartmentID = p.DepartmentID AND (ld.ClassName IS NULL OR ld.ClassName = p.Class_Name)
        INNER JOIN product_barcode pb ON p.Keycode = pb.Keycode
        WHERE ib.ID = ?
            AND IFNULL(p.Blacklisted, FALSE) IS FALSE
            AND IFNULL(p.isRecall, FALSE) IS FALSE`;
    args = [inventoryBotID];

    try {
        logger.trace("main:pool:query:getKeycodeBarcodeMapping");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "main:pool:query:getKeycodeBarcodeMapping");
        throw new Error(`Unable to get Keycode Barcode Mapping for Bot: ${inventoryBotID}`);
    }
    for (let item of results) {
        barcodeToKeycode[item.Barcode] = item.Keycode;
    }

    parsedData = await sanitizeDataLine(rawData, inventoryBotID, mapAreaName, containerToBoundary, barcodeToKeycode, inventoryName, mapEdges);
    logger.info(`Finished sanitizing inventory file for Bot ${inventoryBotID} and Run ${inventoryName}`, "main:sanitizing");

    if (!(Object.keys(parsedData)).length) {
        logger.error("Empty Data After sanitizing", "main:sanitizing");
        throw new Error(`No Data return After sanitizing
            for bot: ${inventoryBotID} run:${inventoryName} location: ${location}`);
    }
    await checkReadCertainty(parsedData, inventoryBotID, inventoryName, locationID);
    logger.info(`Finished parsing data for Bot ${inventoryBotID} and Run ${inventoryName}`, "main:sanitizing");

    const isUpdateInventory = await shouldUpdateInventory(inventoryName, inventoryBotID);
    logger.endTrace("main");
    return { 
        isUpdateInventory, locationID
    } ;
};

// make sure SQS duplicate message are handled
const checkDuplicateMessage = async (data) => {
    logger.startTrace("checkDuplicateMessage");
    const { inventoryName, inventoryBotID, executionName } = data;
    let sql, args, results;
    sql = `
        SELECT * FROM process_tory_data_step_function 
            WHERE ExecutionName = ? AND status = 'PreProcessDone'
        ;
        UPDATE process_tory_data_step_function SET status = 'PreProcessDone'
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

const sanitizeDataLine = async (rawData, botID, areaName, mapBoundaries, barcodeToKeycode, inventoryName, mapEdges) => {
    logger.startTrace("sanitizeDataLine");
    // ID MinRSSI MaxRSSI MeanRSSI Count X Y Z FirstSeen Certainty
    // 3036-37AD-004D-2602-540B-E4C1 -67 -64 -64.5 2 4.2107 -6.00457 1.85 2020-Jun-19 21:42:12.826701 0.17

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
        logger.trace("sanitizeDataLine:pool:query:insertFilteredEpcTags");
        await pool.query(sql, args);
        logger.info(`Filtered ${filteredEPCs.length} Tags from Inventory Bot Run ${inventoryName}`, "sanitizeDataLine:pool:query:insertFilteredEpcTags");
    } catch (error) {
        logger.error(error, "sanitizeDataLine:pool:query:insertFilteredEpcTags");
    }

    logger.endTrace("sanitizeDataLine");
    return parsedData;
};

const checkReadCertainty = async (parsedData, inventoryBotID, inventoryName, locationID) => {
    logger.startTrace("checkReadCertainty");
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
        logger.trace("checkReadCertainty:pool:query:deleteRfidInventoryAdjustment");
        await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "checkReadCertainty:pool:query:deleteRfidInventoryAdjustment");
        throw new Error(`Failed to delete rfid_inventory_adjustment for location: ${locationID}`);
    }

    sql = `
        # 1: Insert the run tags into inventory adjustment table
        INSERT INTO rfid_inventory_adjustment (TagID, Barcode, Keycode, ContainerID, LocationID, XPosition, YPosition, ZPosition, Certainty, MinRSSI, MaxRSSI, MeanRSSI, ReadCount, InventoryBotID, AreaName, RunName)
        VALUES ?
        ;`;
    args = [runInventoryArg];

    try {
        logger.trace("checkReadCertainty:pool:query:insertRfidInventoryAdjustment");
        await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "checkReadCertainty:pool:query:insertRfidInventoryAdjustment");
        throw new Error(`Failed to Insert rfid_inventory_adjustment for location: ${locationID}`);
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
        logger.trace("checkReadCertainty:pool:query:updateBotProcessHistory");
        await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "checkReadCertainty:pool:query:updateBotProcessHistory");
        throw new Error(`Failed to update bot_process_history for bot: ${inventoryBotID} Run: ${inventoryName}`);
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
        ;
    `;
    args = [locationID];

    try {
        logger.trace("checkReadCertainty:pool:query:updateRfidInventoryAdjustment");
        await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "checkReadCertainty:pool:query:updateRfidInventoryAdjustment");
        throw new Error(`Failed to update rfid_inventory_adjustment Update based on certainty for location: ${locationID}`);
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
        ;
    `;
    args = [inventoryBotID, inventoryName];

    try {
        logger.trace("checkReadCertainty:pool:query:updateInventorySameLocation");
        await wmsDB.queryWithRetries(sql, args);
    } catch (error) {
        logger.error(error, "checkReadCertainty:pool:query:updateInventorySameLocation");
        throw new Error(`Failed to update inventory with isSameLocation
            for bot: ${inventoryBotID} Run: ${inventoryName}`);
    }

    logger.endTrace("checkReadCertainty");
};

const shouldUpdateInventory = async (runName, inventoryBotID) => {
    logger.startTrace("shouldUpdateInventory");
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
        logger.trace("shouldUpdateInventory:pool:query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "shouldUpdateInventory:pool:query");
        throw new Error(`shouldUpdateInventory DB check failed for bot: ${inventoryBotID} run: ${runName}`);
    }

    const runsNotCompletedSuccesfully = results.filter(r => !r.hasCompletedRun);

    for (let run of runsNotCompletedSuccesfully) {
        logger.info(`Not updating inventory due to run ${run.InventoryBotID} ${run.InventoryBotArea}`, "shouldUpdateInventory");
    }

    // Should update inventory if there are rows but they all have compelted run
    const shouldUpdateInventory = runsNotCompletedSuccesfully.length === 0 && results.length > 0;
    logger.endTrace("shouldUpdateInventory");
    return shouldUpdateInventory;
};

// If the X Position lies outside the map, we will bring it in with a buffer
const adjustXPosition = (xPosition, mapLeft, mapRight) => {
    const xBorderBuffer = .5;
    let adjustedXPosition = xPosition;

    if (xPosition < mapLeft) {
        adjustedXPosition = mapLeft + xBorderBuffer;
    } else if (xPosition > mapRight) {
        adjustedXPosition = mapRight - xBorderBuffer;
    }

    return adjustedXPosition;
};

// If the Y Position lies outside the map, we will bring it in with a buffer
const adjustYPosition = (yPosition, mapTop, mapBottom) => {
    const yBorderBuffer = .5;
    let adjustedYPosition = yPosition;

    if (yPosition < mapBottom) {
        adjustedYPosition = mapBottom + yBorderBuffer;
    } else if (yPosition > mapTop) {
        adjustedYPosition = mapTop - yBorderBuffer;
    }

    return adjustedYPosition;
};

const isInsideRect = (x1, y1, x2, y2, x, y) => {
    // To avoid problems as to if X1 or Y1 is the larger of the numbers, simply get the max and min values
    let minX = Math.min(x1, x2);
    let maxX = Math.max(x1, x2);
    let minY = Math.min(y1, y2);
    let maxY = Math.max(y1, y2);

    return ((x >= minX && x <= maxX) && (y >= minY && y <= maxY));
};

const parseProductTags = async (epc) => {
    let barcode = await RFIDTagManager.sgtin96.parse96BitEPC(epc);
    return barcode;
};