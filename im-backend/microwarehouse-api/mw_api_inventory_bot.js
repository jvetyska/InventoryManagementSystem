const stream = require("stream");
const moment = require("moment");
const apiRequest = require("../library/apiRequest");
const inventoryBotAPIHelper = require("../library/inventoryBotAPIHelper");
const rfidDataHelper = require("../library/rfidDataHelper");
const helper = require("../library/helperFn");
const sizeOf = require("image-size");
const csvConverter = require("json-2-csv");
const { AWS } = require("../library/xray");
const sqs = new AWS.SQS({apiVersion: "2012-11-05", region: config.aws_region});
const logger = require("../library/logger")("mw_api_inventory_bot");

const v8 = require("v8");

exports.inventory_bot_for_location = async function(req, res) {
    logger.startTrace("inventory_bot_for_location");
    const LocationID = req.query.locationID;
    const debugFlag = req.query.debugFlag || false; // Debug RFID Map calls this api, to make debug map independent of tory api set this flag to true

    // 5 second timeout for IB status checks
    const ibTimeout = 5 * 1000;
    let sql, args, results, URI, apiResults, inventoryBotIP;

    if (!LocationID) {
        logger.error(`locationID is a required parameter!`, "inventory_bot_for_location");
        res.status(400).json({"message": "locationID is a required parameter!"});
        return;
    }

    sql = `
        SELECT
            ib.*,
            ibm.MapUrl, ibm.MapHeight, ibm.MapWidth, ibm.CellSize, ibm.OffSetX, ibm.OffSetY,
            loc.Timezone
        FROM inventory_bot ib
        INNER JOIN location loc ON ib.LocationID = loc.ID
        LEFT JOIN inventory_bot_map ibm ON ibm.ID = ib.MapID
        WHERE ib.LocationID = ?
        GROUP BY ib.ID
        ;
        SELECT
            iba.InventoryBotID,
            iba.Area,
            iba.ContainerID,
            iba.MaxRunDurationMinutes,
            sb.Name,
            sb.Sun, sb.Mon, sb.Tue, sb.Wed, sb.Thu, sb.Fri, sb.Sat,
            sb.Hour,
            sb.Minute
        FROM inventory_bot ib
        INNER JOIN inventory_bot_area iba ON ib.ID = iba.InventoryBotID AND iba.Map = ib.DefaultMap
        LEFT JOIN (
            SELECT
                ibs.InventoryBotID,
                ibs.InventoryBotArea,
                sb.Name,
                sb.Sun, sb.Mon, sb.Tue, sb.Wed, sb.Thu, sb.Fri, sb.Sat,
                ibs.Hour,
                ibs.Minute
            FROM inventory_take_schedule ibs
            LEFT JOIN store_backfill_schedule sb ON sb.ID = ibs.BackfillScheduleID
            WHERE IsEnabled = true
        ) as sb ON sb.InventoryBotArea = iba.Area AND sb.InventoryBotID = ib.ID
        WHERE ib.LocationID = ?`;
    args = [LocationID, LocationID];

    try {
        logger.trace(`inventory_bot_for_location:inventoryBotResults:ro_pool.query`, {sql, args});
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("inventory_bot_get_available", "inventory_bot_for_location", {error: error});
        res.status(500).json({"message": `Error while attempting to get inventory bots.`});
        return;
    }

    let inventoryBotResults = results[0];
    let inventoryBotScheduleResults = results[1];

    // Debug RFID Map calls this api, to make debug map independent of tory api return the response as we don't need extra info for debug map
    if (debugFlag) {
        logger.trace("inventory_bot_for_location:inventoryBotResults", {data:inventoryBotResults});
        res.status(200).json({"data": inventoryBotResults});
        return;
    }

    // For each inventory bot in results, call the robot's API to
    for (let result of inventoryBotResults) {
        inventoryBotIP = result.IPAddress;
        if (!inventoryBotIP) {
            logger.debug("!inventoryBotIP", "inventory_bot_for_location:inventoryBotResults");
            continue;
        }

        try {
            logger.trace(`inventory_bot_for_location:inventoryBotResults:inventoryBotResults`);
            const options = {
                "timeout": ibTimeout
            };

            URI = `${inventoryBotIP}/v1/getStatus`;
            apiResults = await inventoryBotAPIHelper.get(URI, {}, options);
        } catch (error) {
            // If a robot doesn't respond, just continue to the next robot
            logger.error(error, `inventory_bot_for_location:inventoryBotResults:get_inventory_bot_status`);
        }

        if (apiResults) {
            result.MotorStatus = apiResults.MotorStatus.Status;
            result.BatteryCharge = apiResults.Battery.LifePercent;
            result.IsCharging = apiResults.Battery.Charging;

            // Overwriting these values
            result.Status = apiResults.RuntimeStatus.RuntimeStatus;
            result.PositionX = apiResults.RobotPose.Pose.X;
            result.PositionY = apiResults.RobotPose.Pose.Y;
        } else {
            result.Status = "unknown";
        }

        result.Areas = {};

        // Get schedule results for this bot
        let filteredScheduleResults = inventoryBotScheduleResults.filter(s => s.InventoryBotID === result.ID);
        for (let scheduleResult of filteredScheduleResults) {
            let {
                Area, ContainerID, MaxRunDurationMinutes,
                Name, Sun, Mon, Tue, Wed, Thu, Fri, Sat, Hour, Minute
            } = scheduleResult;

            const schedule = {
                name: Name,
                days: [Sun, Mon, Tue, Wed, Thu, Fri, Sat],
                hour: Hour,
                min: Minute
            };

            // If Area Does not Exist add Area to Result
            if (!result.Areas[Area]) {
                result.Areas[Area] = {
                    ContainerID: ContainerID,
                    MaxRunDurationMinutes: MaxRunDurationMinutes,
                    Schedule: []
                };
            }

            // If Schedule is set add Schedule to Area
            if (Hour) {
                result.Areas[Area].Schedule.push(schedule);
            }
        }
        logger.trace("inventory_bot_for_location:apiResults", {data: result});
    }

    logger.endTrace("inventory_bot_for_location");
    res.status(200).json({"data": inventoryBotResults});
};

exports.add_inventory_bot = async function (req, res) {
    logger.startTrace("add_inventory_bot");
    const LocationID = req.body.locationID; // Required
    const IPAddress = req.body.ipAddress;

    // 10 second timeout for IB status checks
    const ibTimeout = 10 * 1000;
    let sql, args, robotName, status, results, apiResults;

    // Make sure required params are given
    if (!LocationID) {
        logger.error(`locationID is a required parameter!`, "add_inventory_bot");
        res.status(400).json({"message": `locationID is a required parameter!`});
        return;
    }

    // Next, call getStatus API to get RobotName and Status as well as make sure IPAddress is valid
    try {
        logger.trace("add_inventory_bot:getStatusApi");
        const options = {
            "timeout": ibTimeout
        };

        const URI = `${IPAddress}/v1/getStatus`;
        apiResults = await inventoryBotAPIHelper.get(URI, {}, options);

        if (!apiResults) {
            logger.info(`no results`, "add_inventory_bot:getStatusApi");
            res.status(400).json({"message": `Unable to connect to inventory bot with given IPAddress.`});
            return;
        }
    } catch (error) {
        logger.error(error, "add_inventory_bot:getStatusApi");
        res.status(400).json({"message": `Unable to connect to inventory bot with given IPAddress.`});
        return;
    }

    robotName = apiResults.Name.RobotName;
    status = apiResults.RuntimeStatus.RuntimeStatus;
    sql = `INSERT INTO inventory_bot (Name, LocationID, Status, IPAddress) VALUES (?)`;
    args = [[robotName, LocationID, status, IPAddress]];

    try {
        logger.trace("add_inventory_bot:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "add_inventory_bot:pool.query");
        res.status(500).json({"message": `Error while attempting to insert inventory bot.`});
        return;
    }

    // If there are no affected rows, that means we didn't insert
    if (!results.affectedRows) {
        logger.error(`no affected rows`, "add_inventory_bot:pool.query");
        res.status(400).json({"message": `Failed to insert inventory bot.`});
        return;
    }

    res.status(200).json({ "InventoryBotID": results.insertId });
    logger.trace("add_inventory_bot:pool.query", {InventoryBotID:results.insertId});
    await _uploadMapToS3(results.insertId);

    try {
        logger.trace("add_inventory_bot:webhook_subscribeToEvent");
        const URI = `${IPAddress}/v1/webhook_subscribeToEvent`;

        // Need to serialize params for urlencoded body
        let params = new URLSearchParams();
        params.append("Event", "RunStatus");
        params.append("URL", config.inventory_bot_webhook_api);
        await inventoryBotAPIHelper.post(URI, params);

        // Need to serialize params for urlencoded body
        params = new URLSearchParams();
        params.append("Event", "RunFinished");
        params.append("URL", config.inventory_bot_webhook_api);
        await inventoryBotAPIHelper.post(URI, params);
    } catch (error) {
        logger.error(error, `add_inventory_bot:webhook_subscribeToEvent`);
    }
    logger.endTrace("add_inventory_bot");
};

exports.update_inventory_bot = async function (req, res) {
    logger.startTrace("update_inventory_bot");
    const ID = req.params.id;
    const IPAddress = req.body.ipAddress || null;   // Required
    const LocationID = req.body.locationID || null; // Required
    const DefaultMap = req.body.defaultMap || null; // Optional
    const Name = req.body.name || null;             // Optional
    let sql, args, results;

    if (!IPAddress && !LocationID) {
        logger.error(`IPAddresss and Location are required`, "update_inventory_bot");
        res.status(400).json({"message": `IPAddresss and Location are required.`});
        return;
    }

    if (DefaultMap || Name) {
        sql = `
            UPDATE inventory_bot SET
                IPAddress = ?,
                DefaultMap = ?,
                MapID = NULL,
                Name = ?,
                LocationID = ?
            WHERE ID = ?`;
        args = [IPAddress, DefaultMap, Name, LocationID, ID];
    } else {
        sql = `
            UPDATE inventory_bot SET
                IPAddress = ?,
                LocationID = ?
            WHERE ID = ?`;
        args = [IPAddress, LocationID, ID];
    }

    try {
        logger.trace("update_inventory_bot:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, `update_inventory_bot:pool.query`);
        res.status(500).json({"message": `Error while attempting to update inventory bot.`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        logger.error(`no affected rows. Inventory Bot with ID ${ID} not found`, "update_inventory_bot:pool.query");
        res.status(404).json({"message": `Inventory Bot with ID ${ID} not found`});
        return;
    }

    if (DefaultMap) {
        await _uploadMapToS3(ID);
    }
    logger.endTrace("update_inventory_bot");
    res.status(200).json({"message": "Inventory Bot Updated Successfully!"});
};

exports.get_inventory_bot_status = async function (req, res) {
    logger.startTrace("get_inventory_bot_status");
    const ID = req.params.id;
    let sql, args, results, apiResults, inventoryBotIP;

    // First get information about the robot from WMS DB
    sql = `SELECT * FROM inventory_bot WHERE ID = ?`;
    args = [ID];

    try {
        logger.trace("get_inventory_bot_status:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error(error, "get_inventory_bot_status:ro_pool.query");
        res.status(500).json({"message": `Error while attempting to get inventory bot status.`});
        return;
    }

    if (!results.length) {
        logger.error(`Inventory Bot with ID ${ID} not found`, "get_inventory_bot_status:ro_pool.query");
        res.status(404).json({"message": `inventory bot with id ${ID} not found`});
        return;
    }

    results = results[0];
    inventoryBotIP = results.IPAddress;

    // Next, call getStatus API to get info from robot
    try {
        logger.trace("get_inventory_bot_status:getStatus");
        const URI = `${inventoryBotIP}/v1/getStatus`;
        apiResults = await inventoryBotAPIHelper.get(URI);
    } catch (error) {
        logger.error(error, "get_inventory_bot_status:getStatus");
        res.status(500).json({"message": `Error while attempting to get inventory bot status.`});
        return;
    }

    results.MotorStatus = apiResults.MotorStatus.Status;
    results.BatteryCharge = apiResults.Battery.LifePercent;
    results.IsCharging = apiResults.Battery.Charging;

    // Overwriting these values
    results.Status = apiResults.RuntimeStatus.RuntimeStatus;
    results.PositionX = apiResults.RobotPose.Pose.X;
    results.PositionY = apiResults.RobotPose.Pose.Y;

    // InventoryName doesn't exist when bot is not running
    if (apiResults.InventoryName) {
        results.ActiveRunName = apiResults.InventoryName.Inventory;
    }

    if (apiResults.DockingStatus) {
        results.DockingStatus = apiResults.DockingStatus.DockingStatus;
    }

    if (apiResults.RuntimeStatus) {
        results.RuntimeStatus = apiResults.RuntimeStatus.RuntimeStatus;
    }
    logger.endTrace("get_inventory_bot_status");
    res.status(200).json({"data": results});
};

exports.get_inventory_bot_areas = async function (req, res) {
    logger.startTrace("get_inventory_bot_areas");
    const ID = req.params.id;
    let results, sql, args;

    sql = `
        SELECT iba.Area from inventory_bot_area iba
        INNER JOIN inventory_bot ib ON iba.InventoryBotID = ib.ID AND iba.Map = ib.DefaultMap
        WHERE ib.ID = ?`;
    args = [ID];

    try {
        logger.trace("get_inventory_bot_areas:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error(error, "get_inventory_bot_areas:ro_pool.query");
        res.status(400).json({"message": `Error while attempting to get inventory bot areas.`});
        return;
    }
    logger.endTrace("get_inventory_bot_areas");
    res.status(200).json({"data": results.map(({ Area }) => Area)});
};

exports.get_inventory_bot_areas_by_location = async function (req, res) {
    logger.startTrace("get_inventory_bot_areas_by_location");
    let locationID = req.params.location || null;
    let sql, args, results;
    if (!locationID) {
        logger.error(`LocationID is required`, "get_inventory_bot_areas_by_location");
        res.status(400).json({"message": "LocationID is required"});
        return;
    }

    sql = `SELECT ib.ID, ib.Name, iba.Area, iba.ContainerID, iba.MaxRunDurationMinutes
        FROM inventory_bot ib
        INNER join inventory_bot_area iba
        on ib.DefaultMap = iba.Map and ib.ID = iba.InventoryBotID
        WHERE ib.LocationID = ?;`;
    args = [locationID];

    try {
        logger.trace("get_inventory_bot_areas_by_location:ro_pool.query");
        [results] = await ro_pool.query(sql, args);

    } catch (error) {
        logger.error(error, "get_inventory_bot_areas_by_location:ro_pool.query");
        res.status(500).json({"message": `Unable to get the inventory_bots for location: ${locationID}`});
        return;
    }
    logger.endTrace("get_inventory_bot_areas_by_location");
    res.status(200).json({"data": results});
};

exports.get_inventory_bot_maps = async function (req, res) {
    logger.startTrace("get_inventory_bot_maps");
    const ID = req.params.id;
    let apiResults;

    try {
        logger.trace("get_inventory_bot_maps:_getInventoryBotInfo");
        let inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/getAvailableLocations`;
        logger.trace("get_inventory_bot_maps:getAvailableLocations");
        apiResults = await inventoryBotAPIHelper.get(URI);
    } catch (error) {
        logger.error(`Error while attempting to get inventory bot locations.`, "get_inventory_bot_maps:api");
        res.status(400).json({"message": `Error while attempting to get inventory bot locations.`});
        return;
    }
    logger.endTrace("get_inventory_bot_maps");
    res.status(200).json({"data": apiResults.Locations});
};

exports.inventory_bot_get_map_metadata = async function (req, res) {
    logger.startTrace("inventory_bot_get_map_metadata");
    const ID = req.params.id;
    let sql, args, results, apiResponse;

    sql = `SELECT * FROM inventory_bot_map WHERE InventoryBotID = ? AND Type = 'Location'`;
    args = [ID];

    try {
        logger.trace("inventory_bot_get_map_metadata:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_get_map_metadata:ro_pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to get inventory bot data.`});
        return;
    }

    if (!results.length) {
        logger.error(`No location map found for inventory bot ${ID}`, "inventory_bot_get_map_metadata:ro_pool.query");
        res.status(400).json({"message": `No location map found for inventory bot ${ID}.`});
    }

    results = results[0];

    apiResponse = {
        "CellSize": results.CellSize,
        "OffsetX": results.OffSetX,
        "OffsetY": results.OffSetY
    };

    logger.endTrace("inventory_bot_get_map_metadata");
    res.status(200).json({"data": apiResponse});
};

exports.get_inventory_bot_location_details = async function(req, res) {
    logger.startTrace("get_inventory_bot_location_details");
    const ID = req.params.id;
    const Location = req.query.location;
    let apiResults;

    if (!Location) {
        logger.error("EXIT", "get_inventory_bot_location_details", {error: `location is a required parameter!`});
        res.status(400).json({"message": "location is a required parameter!"});
        return;
    }

    try {
        logger.trace("get_inventory_bot_location_details:_getInventoryBotInfo");
        let inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/getLocationDetails`;
        const params = {
            "location": Location
        };

        logger.trace("get_inventory_bot_location_details:inventoryBotAPIHelper:getLocationDetails");
        apiResults = await inventoryBotAPIHelper.get(URI, params);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_location_details:inventoryBotAPIHelper:getLocationDetails", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot locations.`});
        return;
    }

    logger.endTrace("get_inventory_bot_location_details");
    res.status(200).json({"data": apiResults});
};

exports.delete_inventory_bot = async function(req, res) {
    logger.startTrace("delete_inventory_bot");
    const ID = req.params.id;
    let sql, args, results;

    sql = `DELETE FROM inventory_bot WHERE ID = ?`;
    args = [ID];

    try {
        logger.trace("delete_inventory_bot:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "delete_inventory_bot:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to delete inventory bot.`});
        return;
    }

    if (!results.affectedRows) {
        logger.error("EXIT", "delete_inventory_bot:pool.query", {error: `inventory bot with id ${ID} not found`});
        res.status(404).json({"message": `inventory bot with id ${ID} not found`});
        return;
    }

    logger.endTrace("delete_inventory_bot");
    res.status(200).json({"message": "Inventory Bot Deleted Successfully!"});
};

exports.update_process_status = async function(req, res) {
    logger.startTrace("update_process_status");
    const ID = req.params.id;
    const Status = req.body.status;     // required
    const RunName = req.body.runName;   // required
    let taskConfig = req.body.taskConfig || "";     // optional
    let isManualRun = req.body.isManualRun || false;    // optional
    let sql, args, results, statusResults, apiResults, inventoryBotIP, scanArea, botProcessHistoryID;
    let defaultMap, batteryPct, isCharging, runQualityPct, EPCsCounted, completedWaypoints, inventoryTakeID, oldStatus, runFailureReason, runDuration;

    if (!Status || !RunName) {
        logger.error("EXIT", "update_process_status", {error: `status and runName are required parameters!`});
        res.status(400).json({"message": "status and runName are required parameters!"});
        return;
    }

    logger.info(`${_getDateTime()} Updating bot_process for Bot ${ID} Run ${RunName} to status ${Status}`, "update_process_status");

    // Get's inventory bot information as well as check to see if the run already has a row in bot_process_history
    sql = `
        SELECT
            ib.DefaultMap,
            ib.IPAddress,
            bph.ID AS botProcessHistoryID,
            bph.InventoryTakeScheduleID,
            bp.TaskConfig,
            bph.Status
        FROM inventory_bot ib
        LEFT JOIN bot_process bp ON ib.ID = bp.InventoryBotID AND bp.RunName = ?
        LEFT JOIN bot_process_history bph ON ib.ID = bph.InventoryBotID AND bph.Name = ?
        WHERE ib.ID = ?`;
    args = [RunName, RunName, ID];

    try {
        logger.trace("update_process_status:pool.query:inventory_bot");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "update_process_status:pool.query:inventory_bot", {error: error});
        res.status(500).json({"message": `Error while attempting to update process status.`});
        return;
    }

    if (!results.length) {
        logger.error("EXIT", "update_process_status:pool.query:inventory_bot", {error: `Inventory Bot with ID ${ID} not found`});
        res.status(404).json({"message": `Inventory Bot with ID ${ID} not found`});
        return;
    }

    results = results[0];
    defaultMap = results.DefaultMap;
    inventoryBotIP = results.IPAddress;
    botProcessHistoryID = results.botProcessHistoryID;
    inventoryTakeID = results.InventoryTakeScheduleID;
    oldStatus = results.Status;

    if (results.TaskConfig) {
        taskConfig = results.TaskConfig;
    }

    // If the old status is the same as the new status, we don't want to update
    // Note that if we update, even with no columns changed, the DateUpdated will still change automatically
    // DateUpdated changing may cause backfill generation to run again which is bad
    if (oldStatus === Status) {
        logger.debug("EXIT", "update_process_status", {error: `Bot Process status was already set to ${Status}`});
        res.status(500).json({"message": `Bot Process status was already set to ${Status}.`});
        return;
    }

    // If there is no taskConfig and status is Running, that means this is a new run
    // Therefore, try to look up taskConfig from inventory_bot_schedule
    if (!taskConfig || !inventoryTakeID) {
        sql = `
            SELECT
                its.ID AS InventoryTakeID,
                its.InventoryBotArea,
                its.Hour,
                HOUR(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS curHour
            FROM inventory_take_schedule its
            INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleID = sbs.ID
            INNER JOIN inventory_bot ib ON its.InventoryBotID = ib.ID
            INNER JOIN location loc ON ib.LocationID = loc.ID
            WHERE ib.ID = ?
                AND sbs.IsEnabled
                AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)
            HAVING its.Hour BETWEEN curHour - 12 AND curHour
            ORDER BY its.HOUR DESC
            LIMIT 1`;
        args = [ID];

        try {
            logger.trace("update_process_status:pool.query:taskConfig");
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("EXIT", "update_process_status:pool.query:taskConfig", {error: error});
            res.status(500).json({ "message": `Error while attempting to update process status.` });
            return;
        }

        if (results.length) {
            if (!taskConfig) {
                taskConfig = results[0].InventoryBotArea;
            }

            if (!inventoryTakeID) {
                inventoryTakeID = results[0].InventoryTakeID;
            }
        }
    }

    // If the Run Data is ready, we can get run information from the getInventoryInformation API
    if (["RunDataReady", "Interrupted"].includes(Status)) {
        try {
            const params = {
                "location": defaultMap,
                "inventory": RunName
            };

            const URI = `${inventoryBotIP}/v1/getInventoryInformation`;
            logger.trace("update_process_status:inventoryBotAPIHelper:getInventoryInformation");
            apiResults = await inventoryBotAPIHelper.get(URI, params);
        } catch (error) {
            // Only want to abort run processing if run is supposed to be ready
            if (Status === "RunDataReady") {
                logger.error("EXIT", "update_process_status:inventoryBotAPIHelper:getInventoryInformation", {error: error});

                const errorMessage = `Unknown error during Inventory Bot Run Processing`;

                await inventoryBotAPIHelper.reportInventoryBotError(ID, errorMessage);

                res.status(500).json({"message": `Error while attempting to update process status.`});
                return;
            }
        }

        // If getInventoryInformation doesn't return a valid response, just don't include the statistics in the process log
        if (apiResults) {
            // This will only be included if the run failed
            runFailureReason = apiResults.InterruptRunReason;

            if (apiResults.Statistics) {
                scanArea = apiResults.Statistics.ScanArea;
                EPCsCounted = apiResults.Statistics.DistinctTags;
                runDuration = apiResults.Statistics.Duration;

                // Run duration comes in miliseconds so convert to seconds
                if (runDuration) {
                    runDuration = Math.floor(runDuration / 1000);
                }
            }

            if (apiResults.RunQuality) {
                runQualityPct = apiResults.RunQuality.CurrentSuccessRate * 100;
                completedWaypoints = apiResults.RunQuality.ReachedWaypointCounter;
            }

            if (apiResults.TaskScheduleItem) {
                // TaskConfig comes in the following format: KmartMockBOH.tasks.xml
                // Strip out file '.tasks.xml' ending
                taskConfig = apiResults.TaskScheduleItem.TaskConfig;
                taskConfig = taskConfig.replace(/.tasks.xml/, "");
            }
        }
    }

    // If this run is set to RunDataReady and the quality is bad, report the error
    if (Status === "RunDataReady" && runQualityPct && (runQualityPct / 100) < settings.inventoryBot.inventoryBotRunQualityThreshold) {
        logger.trace("update_process_status:update_failure_reason");
        await apiRequest.put(req, `/inventory_bot/${ID}/update_failure_reason`, {
            "RunName": RunName,
            "Reason": "Low Run Quality",
            "ReasonType": "Auto"
        });

        let errorMessage = `Inventory Bot Run ${RunName} had a low run quality\n`;
        errorMessage += `Run Quality: ${runQualityPct}%`;
        inventoryBotAPIHelper.reportInventoryBotError(ID, errorMessage);
    }

    if (!taskConfig) {
        let taskConfigError = `Error while attempting to update process status. Could not get taskConfig`;
        logger.error("EXIT", "update_process_status:inventoryBotAPIHelper:getInventoryInformation", {error: taskConfigError});
        res.status(500).json({"message": taskConfigError});
        return;
    }

    sql = "";
    args = [];

    // Insert or update depending on if there is already a row in bot_process_history
    if (!botProcessHistoryID) {
        sql += `INSERT IGNORE INTO bot_process_history (Name, InventoryBotID, Location, ScanArea, TaskConfig, Status, IsManual, InventoryTakeScheduleID, NumTagsRead, RunQualityPct, RunDuration, FailureReason, FailureReasonType)
            VALUES (?);`;
        args.push([RunName, ID, defaultMap, scanArea, taskConfig, Status, isManualRun, inventoryTakeID, EPCsCounted, runQualityPct, runDuration, runFailureReason, "Auto"]);
    } else {
        sql += `
            UPDATE bot_process_history
            SET
                Status = ?,
                ScanArea = ?,
                TaskConfig = ?,
                InventoryTakeScheduleID = ?,
                NumTagsRead = ?,
                RunQualityPct = ?,
                RunDuration = ?,
                FailureReason = ?,
                FailureReasonType = ?
            WHERE Name = ? AND InventoryBotID = ? AND Status != ?;`;
        args.push(Status, scanArea, taskConfig, inventoryTakeID, EPCsCounted, runQualityPct, runDuration, runFailureReason, "Auto", RunName, ID, Status);
    }

    sql += `
        INSERT INTO bot_process_status (BotProcessHistoryID, Status, BatteryPct, IsCharging, RunQualityPct, CompletedWaypoints, EPCsCounted)
        SELECT bp.ID, ?, ?, ?, ?, ?, ?
        FROM bot_process_history bp
        WHERE
            bp.Name = ? AND
            bp.InventoryBotID = ?
        ;
        UPDATE bot_process
        SET Status = ?, RunName = ?
        WHERE InventoryBotID = ? AND TaskConfig = ? AND Map = ?`;
    args.push(Status, batteryPct, isCharging, runQualityPct, completedWaypoints, EPCsCounted, RunName, ID, Status, RunName, ID, taskConfig, defaultMap);

    try {
        logger.trace("update_process_status:pool.query:bot_process_history");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "update_process_status:pool.query:bot_process_history", {error: error});
        res.status(500).json({ "message": `Error while attempting to update process status.` });
        return;
    }

    // ALL Run data processing needs to be done after this to ensure there are not race conidition issues
    if (!results[0].affectedRows) {
        logger.error("EXIT", "update_process_status:pool.query:bot_process_history", {error: `Bot Process status was already set to ${Status}`});
        res.status(500).json({"message": `Bot Process status was already set to ${Status}.`});
        return;
    }

    logger.info(`${_getDateTime()} Finished updating bot_process for Bot ${ID} Run ${RunName} to status ${Status}`, "update_process_status");

    // When a run is finished, upload the run map to S3 and run code to update inventory
    if (Status === "RunDataReady") {
        logger.trace("update_process_status:RunDataReady");
        try {
            await apiRequest.get(req, "/inventory_bot/get_data", {
                "id": ID,
                "mapAreaName": taskConfig,
                "location": defaultMap,
                "inventoryName": RunName
            });

            await _uploadMapToS3(ID, RunName, taskConfig);

            sql = `
                SELECT * FROM inventory_bot_area iba
                INNER JOIN container c ON iba.ContainerID = c.ID
                WHERE iba.Area = ? AND c.Type = 'STR'`;
            args = [taskConfig];

            [results] = await pool.query(sql, args);

            if (results.length) {
                await _generateMapMetadata(ID, taskConfig);
            }
        } catch (error) {
            logger.debug("EXIT", "update_process_status:RunDataReady", {error: error});

            const errorMessage = `Unknown error during Inventory Bot Run Processing`;
            await inventoryBotAPIHelper.reportInventoryBotError(ID, errorMessage);

            res.status(500).json({"message": `Error while attempting to update process status.`});
            return;
        }
    } else if (Status === "Interrupted") {
        logger.trace("update_process_status:Interrupted");
        // If the run was Interupted, report the error
        let errorMessage = `Inventory Bot Run ${RunName} has been Interrupted.\n`;
        inventoryBotAPIHelper.reportInventoryBotError(ID, errorMessage);

        inventoryBotAPIHelper.createInterruptedNotification(req, ID);

        // The Evaluation Map is not ready to download immediately on change so just sleep for 15 seconds
        const secondsToDelay = 25;
        await new Promise(resolve => setTimeout(resolve, secondsToDelay * 1000));

        try {
            await _uploadMapToS3(ID, RunName, taskConfig);
        } catch (error) {
            logger.error(error, "update_process_status:Interrupted:_uploadMapToS3");
        }
    }

    logger.endTrace("update_process_status");
    res.status(200).json({ "message": "Success!" });
};

exports.get_inventory_bot_process_details = async function(req, res) {
    logger.startTrace("get_inventory_bot_process_details");
    const InventoryBotID = req.params.inventoryBotID;
    const ProcessName = req.query.name;     // required
    let apiResults, inventoryBotInfo;

    if (!ProcessName) {
        logger.error("EXIT", "get_inventory_bot_process_details", {error: `ProcessName is a required parameters`});
        res.status(400).json({"message": `ProcessName is a required parameters!`});
        return;
    }

    try {
        logger.trace("get_inventory_bot_process_details:_getInventoryBotInfo");
        inventoryBotInfo = await _getInventoryBotInfo(InventoryBotID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/getInventoryInformation`;
        const params = {
            "location": inventoryBotInfo.DefaultMap,
            "inventory": ProcessName
        };

        apiResults = await inventoryBotAPIHelper.get(URI, params);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_process_details:_getInventoryBotInfo", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot process details.`});
        return;
    }
    logger.endTrace("get_inventory_bot_process_details");

    res.status(200).json({"data": apiResults});
};

exports.update_inventory_bot_schedule = async function(req, res) {
    logger.startTrace("update_inventory_bot_schedule");
    const ID = req.params.id;
    // Schedule is array days each with an array of hours
    // Timezone is that of the robot
    // 0(Sunday) to 6(Saturday)
    // [
    //      0:[{"time": 23:12:00, "maxRunDurationMinutes": 120}, {"time": 4:12:00, "maxRunDurationMinutes": 120}],
    //      1:[], 2:[], 3:[], 4:[], 5:[{"time": 23:12:00, "maxRunDurationMinutes": 180}], 6:[]
    // ]
    const Schedule = req.body.schedule;     // required
    const TaskConfig = req.body.taskConfig;     // required
    let inventoryBotIP, apiResults, URI, sql, args, results, defaultMap;

    // Make sure required params are sent
    if (!Schedule || !TaskConfig) {
        logger.error("EXIT", "update_inventory_bot_schedule", {error: `schedule and taskConfig are required parameters!`});
        res.status(400).json({"message": `schedule and taskConfig are required parameters!`});
        return;
    }

    let flattenArray = [].concat.apply([], Schedule);
    for (let element of flattenArray) {
        let time = element.time;
        let splitIntoArray = time.split(":");
        if (splitIntoArray.length !== 3) {
            logger.error("EXIT", "update_inventory_bot_schedule", {error: `schedule values are not in correct format`});
            res.status(400).json({"message": `schedule values are not in correct format`});
            return;
        }

        if ((parseInt(splitIntoArray[0]) < 0 || parseInt(splitIntoArray[0]) > 23)
            || (parseInt(splitIntoArray[1]) < 0 || parseInt(splitIntoArray[1]) > 59)
            || (parseInt(splitIntoArray[2]) < 0 || parseInt(splitIntoArray[2]) > 59)) {
            logger.error("EXIT", "update_inventory_bot_schedule", {error: `schedule values are not in correct format`});
            res.status(400).json({"message": `schedule values are not in correct format`});
            return;
        }
    }

    // Schedule must be an array and 7 length for each day of the week
    if (!Array.isArray(Schedule) || Schedule.length != 7) {
        logger.error("EXIT", "update_inventory_bot_schedule", {error: `schedule must be an array with length 7!`});
        res.status(400).json({"message": `schedule must be an array with length 7!`});
        return;
    }

    sql = `
        SELECT ib.IPAddress, ib.DefaultMap
        FROM inventory_bot ib
        INNER JOIN inventory_bot_area iba ON ib.ID = iba.InventoryBotID
        WHERE ib.ID = ? and iba.Area = ?`;
    args = [ID, TaskConfig];

    try {
        logger.trace("update_inventory_bot_schedule:pool.query");
        [results] = await pool.query(sql, args);
        inventoryBotIP = results[0].IPAddress;
        URI = `${inventoryBotIP}/v1/getSchedule`;
        logger.trace("update_inventory_bot_schedule:api:getSchedule");
        apiResults = await inventoryBotAPIHelper.get(URI);
    } catch (error) {
        logger.error(`update_inventory_bot_schedule:exit erorr:${error}`);
        res.status(400).json({"message": `Error updating schedule for Inventory Bot ${ID}.`});
        return;
    }

    defaultMap = results[0].DefaultMap;
    if (!defaultMap) {
        logger.error("EXIT", "update_inventory_bot_schedule:pool.query", {error: `Inventory must have a Default Map set before updating schedule!`});
        res.status(400).json({"message": `Inventory must have a Default Map set before updating schedule!`});
        return;
    }

    let oldRobotSchedule = apiResults.Schedule;
    URI = `${inventoryBotIP}/v1/deleteScheduleItem`;

    for (let scheduleItem of oldRobotSchedule) {
        let matchingDay = Schedule[scheduleItem.Weekday];
        let oldTaskConfig = scheduleItem.TaskConfig;
        if (oldTaskConfig) {
            // Task config from the getScheduleItems API adds a .tasks.xml extension which would be a problem here
            oldTaskConfig = oldTaskConfig.replace(".tasks.xml", "");
        }

        let doesTaskConfigMatch = TaskConfig == oldTaskConfig;

        let doesScheduleMatch = !matchingDay.find(i => {
            let time = i.time;
            let maxRunDuration = i.maxRunDurationMinutes * 60;
            let hourMinuteSecond = time.split(":");
            if (hourMinuteSecond[0] == scheduleItem.StartTime.Hour && hourMinuteSecond[1] == scheduleItem.StartTime.Minute && scheduleItem.RunDuration == maxRunDuration) {
                return true;
            } else {
                return false;
            }
        });

        // If the schedule item has the same location, scanArea, and taskConfig
        // And if the new schedule doesn't include the hour, delete the item
        // Will also delete if the schedule has no TaskConfig as this is an invalid row
        if ((doesTaskConfigMatch && doesScheduleMatch) || !oldTaskConfig) {
            try {
                // Need to serialize params for urlencoded body
                const params = new URLSearchParams();
                params.append("Index", scheduleItem.Index);
                logger.trace("update_inventory_bot_schedule:matchFlag");
                await inventoryBotAPIHelper.post(URI, params);
            } catch (error) {
                logger.error("EXIT", "update_inventory_bot_schedule:matchFlag", {error: error});
                res.status(400).json({"message": `Error updating schedule for Inventory Bot ${ID}.`});
                return;
            }

            // TORY apis work via a changing list index
            // Need to adjust indexes after deleting a schedule item
            for (let i = scheduleItem.Index; i < oldRobotSchedule.length; i++) {
                oldRobotSchedule[i].Index -= 1;
            }
        }
    }

    URI = `${inventoryBotIP}/v1/setScheduleItem`;

    // For each day and hour in the new schedule
    for (let day in Schedule) {
        for (let row of Schedule[day]) {
            let time = row.time;
            // Convert Minutes to seconds
            let maxRunDurationSeconds = row.maxRunDurationMinutes * 60;

            let hourMinuteSecond = time.split(":");
            let newScheduleExits = !oldRobotSchedule.find(i => {
                if (day == i.Weekday && hourMinuteSecond[0] == i.StartTime.Hour && hourMinuteSecond[1] == i.StartTime.Minute
                    && i.RunDuration == maxRunDurationSeconds) {
                    return true;
                } else {
                    return false;
                }
            });
            // If the new schedule has a day/hour that is not in the old schedule, add it
            if (newScheduleExits) {
                try {
                    // Need to serialize params for urlencoded body
                    const params = new URLSearchParams();
                    params.append("Weekday", day);
                    params.append("StartHour", hourMinuteSecond[0]);
                    params.append("StartMinute", hourMinuteSecond[1]);
                    params.append("Location", defaultMap);
                    params.append("TaskConfig", TaskConfig);
                    params.append("Duration", maxRunDurationSeconds);
                    logger.trace("update_inventory_bot_schedule:setScheduleItem");
                    await inventoryBotAPIHelper.post(URI, params);
                } catch (error) {
                    logger.error("EXIT", "update_inventory_bot_schedule:setScheduleItem", {error: error});
                    logger.error("update_inventory_bot_schedule", error);
                    res.status(400).json({"message": `Error updating schedule for Inventory Bot ${ID}.`});
                    return;
                }
            }
        }
    }

    res.status(200).json({"message": "Schedule updated Sucessfully!"});

    logger.info(`update_inventory_bot_schedule for Inventory Bot ${ID} and TaskConfig ${TaskConfig}`, "update_inventory_bot_schedule");
    logger.debug("New Schedule", {Schedule});
    logger.debug("New Inventory Bot Schedule", { botSchedule: apiResults.Schedule });
    logger.endTrace("update_inventory_bot_schedule");
};

exports.inventory_bot_start = async function(req, res) {
    logger.startTrace("inventory_bot_start");
    const ID = req.params.id;
    const TaskConfig = req.body.taskConfig;     // required
    let inventoryBotInfo;

    if (!TaskConfig) {
        logger.error("EXIT", "inventory_bot_start", {error: `TaskConfig is a required parameters!`});
        res.status(400).json({"message": `TaskConfig is a required parameters!`});
        return;
    }

    try {
        logger.trace(`inventory_bot_start:_getInventoryBotInfo`);
        inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/startRun`;

        // Need to serialize params for urlencoded body
        const params = new URLSearchParams();
        params.append("TaskConfig", TaskConfig);

        logger.trace(`inventory_bot_start:startRun`);
        await inventoryBotAPIHelper.post(URI, params);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_start:startRun", {error: error});
        res.status(400).json({"message": `Error while attempting to start inventory bot.`});
        return;
    }

    res.status(200).json({"message": "Success!"});

    let statusResult, runName;
    try {
        logger.trace(`inventory_bot_start:getStatus`);
        statusResult = await inventoryBotAPIHelper.get(`${inventoryBotInfo.IPAddress}/v1/getStatus`);
        runName = statusResult.InventoryName.Inventory;
    } catch (error) {
        logger.error("EXIT", "inventory_bot_start:getStatus", {error: error});
        return;
    }

    const body = {
        "runName": runName,
        "status": "Running",
        "taskConfig": TaskConfig,
        "isManualRun": true
    };

    try {
        logger.trace(`inventory_bot_start:process_status`);
        await apiRequest.post(req, `inventory_bot/${ID}/process_status`, body);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_start:process_status", {error});
        return;
    }
    logger.endTrace("inventory_bot_start");
};

exports.inventory_bot_stop = async function(req, res) {
    logger.startTrace("inventory_bot_stop");
    const ID = req.params.id;
    let inventoryBotInfo;

    try {
        logger.trace(`inventory_bot_stop:stopRun`);
        inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/stopRun`;
        await inventoryBotAPIHelper.post(URI);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_stop:stopRun", {error: error});
        res.status(400).json({"message": `Error while attempting to start inventory bot.`});
        return;
    }

    logger.endTrace("inventory_bot_stop");
    res.status(200).json({"message": "Success!"});
};

exports.inventory_bot_to_charger = async function(req, res) {
    logger.startTrace("inventory_bot_to_charger");
    const ID = req.params.id;
    let inventoryBotInfo;

    try {
        inventoryBotInfo = await _getInventoryBotInfo(ID);
        logger.trace("inventory_bot_to_charger:abortRunAndDockOn");
        const URI = `${inventoryBotInfo.IPAddress}/v1/abortRunAndDockOn`;
        await inventoryBotAPIHelper.post(URI);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_to_charger:abortRunAndDockOn", {error: error});
        res.status(400).json({"message": `Error while attempting to send Inventory Bot to charger.`});
        return;
    }

    logger.endTrace("inventory_bot_to_charger");
    res.status(200).json({"message": "Success!"});
};

exports.inventory_bot_get_map = async function(req, res) {
    logger.startTrace("inventory_bot_get_map");
    const ID = req.params.id;
    let readStream, apiResults, inventoryBotInfo;
    // Need this option to forward the image
    let options = {
        responseType: "arraybuffer"
    };

    try {
        inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/getMap`;
        logger.trace(`inventory_bot_get_map:getMap`);
        apiResults = await inventoryBotAPIHelper.get(URI, null, options);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_get_map:getMap", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot data.`});
        return;
    }

    let date = moment().format("MM-DD-YYYY");
    let fileName = `${date}_inventory_bot_${ID}_map.png`;

    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "image/png");
    logger.endTrace("inventory_bot_get_map");
    readStream = new stream.PassThrough();
    readStream.end(apiResults);
    readStream.pipe(res);
};

exports.inventory_bot_retrieve_data = async function(req, res) {
    logger.startTrace("inventory_bot_retrieve_data");
    const ID = req.params.id;
    let readStream, apiResults, inventoryBotInfo;

    try {
        inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/getInventoryDataFile`;
        logger.trace(`inventory_bot_retrieve_data:getInventoryDataFile`);
        apiResults = await inventoryBotAPIHelper.get(URI);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_retrieve_data:getInventoryDataFile", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot data.`});
        return;
    }

    let date = moment().format("MM-DD-YYYY");
    let fileName = `${date}_inventory_bot_${ID}_data.csv`;

    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");
    logger.endTrace("inventory_bot_retrieve_data");
    readStream = new stream.PassThrough();
    readStream.end(apiResults.data);
    readStream.pipe(res);
};

exports.inventory_bot_upsert_area = async function(req, res) {
    logger.startTrace("inventory_bot_upsert_area");
    const InventoryBotID = req.params.id;     // Required
    const Area = req.body.area;     // Required
    const ContainerID = req.body.containerID;   // Required
    const MaxRunDurationMinutes = req.body.maxRunDurationMinutes;   // Required
    let sql, args, results, ibResults, containerResults;

    if (!Area || !ContainerID || !MaxRunDurationMinutes) {
        logger.error("EXIT", "inventory_bot_upsert_area", {error: `area, containerID, and maxRunDurationMinutes are required parameters!`});
        res.status(400).json({"message": `area, containerID, and maxRunDurationMinutes are required parameters!`});
        return;
    }

    // Select the LocationID of IB and Container to make sure they are the same
    sql = `
        SELECT LocationID FROM inventory_bot WHERE ID = ?
        ;
        SELECT LocationID FROM container WHERE ID = ?`;
    args = [InventoryBotID, ContainerID];

    try {
        logger.trace("inventory_bot_upsert_area:pool.query");
        [results] = await pool.query(sql, args);
        ibResults = results[0];
        containerResults = results[1];
    } catch (error) {
        logger.error("EXIT", "inventory_bot_upsert_area:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to upsert inventory bot area.`});
        return;
    }

    // Validate the IB and Container both exist and that they belong in the same location
    if (!ibResults.length) {
        logger.error("EXIT", "inventory_bot_upsert_area:pool.query", {error: `Inventory Bot ${InventoryBotID} does not exist.`});
        res.status(400).json({"message": `Inventory Bot ${InventoryBotID} does not exist.`});
        return;
    } else if (!containerResults.length) {
        logger.error("EXIT", "inventory_bot_upsert_area:pool.query", {error: `Container ${ContainerID} does not exist.`});
        res.status(400).json({"message": `Container ${ContainerID} does not exist.`});
        return;
    } else if (ibResults[0].LocationID !== containerResults[0].LocationID) {
        logger.error("EXIT", "inventory_bot_upsert_area:pool.query", {error: `Container ${ContainerID} is not in the same Location as the Inventory Bot.`});
        res.status(400).json({"message": `Container ${ContainerID} is not in the same Location as the Inventory Bot.`});
        return;
    }

    sql = `
        INSERT INTO inventory_bot_area (InventoryBotID, Area, ContainerID, Map, MaxRunDurationMinutes)
        SELECT ib.ID, ?, ?, ib.DefaultMap, ?
        FROM inventory_bot ib
        WHERE ib.ID = ?
        ON DUPLICATE KEY UPDATE
        ContainerID = VALUES(ContainerID),
        MaxRunDurationMinutes = Values(MaxRunDurationMinutes)
        ;
        INSERT IGNORE INTO bot_process (InventoryBotID, TaskConfig, Map)
        SELECT ?, ?, ib.DefaultMap
        FROM inventory_bot ib
        WHERE ib.ID = ?
    `;
    args = [Area, ContainerID, MaxRunDurationMinutes, InventoryBotID, InventoryBotID, Area, InventoryBotID];

    try {
        logger.trace(`inventory_bot_upsert_area:pool.query:upser`);
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_upsert_area:pool.query:upsert", {error: error});
        res.status(500).json({"message": `Error while attempting to upsert inventory bot area.`});
        return;
    }

    // If there are no affected rows, that means we didn't insert
    if (!results[0].affectedRows) {
        logger.error("EXIT", "inventory_bot_upsert_area:pool.query:upsert", {error: `Failed to upsert inventory bot area ${Area}.`});
        res.status(400).json({"message": `Failed to upsert inventory bot area ${Area}.`});
        return;
    } else {
        logger.trace(`inventory_bot_upsert_area:syncInventoryBotSchedule`);
        await inventoryBotAPIHelper.syncInventoryBotSchedule(req, InventoryBotID, Area);
    }

    logger.endTrace("inventory_bot_upsert_area");
    res.status(200).json({"message": `Successfully updated inventory bot area ${Area}!`});
};

exports.inventory_bot_delete_area = async function(req, res) {
    logger.startTrace("inventory_bot_delete_area");
    const InventoryBotID = req.params.id;     // Required
    const Area = req.query.area;     // Required
    let sql, args, results;

    if (!Area) {
        logger.error("EXIT", "inventory_bot_delete_area", {error: `area is a required parameter!`});
        res.status(400).json({"message": `area is a required parameter!`});
        return;
    }

    sql = `
        SELECT *
        FROM inventory_take_schedule
        WHERE InventoryBotID = ? AND InventoryBotArea = ?
    `;
    args = [InventoryBotID, Area];

    try {
        logger.trace("inventory_bot_delete_area:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_delete_area:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to delete inventory bot area.`});
        return;
    }

    if (results.length) {
        logger.error("EXIT", "inventory_bot_delete_area", {error: `Inventory Bot Area ${Area} has scheduled Inventory Takes. You must delete them first.`});
        res.status(400).json({"message": `Inventory Bot Area ${Area} has scheduled Inventory Takes. You must delete them first.`});
        return;
    }

    sql = `
        DELETE iba, bp
        FROM inventory_bot_area iba
        INNER JOIN bot_process bp ON iba.InventoryBotID = bp.InventoryBotID AND iba.Area = bp.TaskConfig
        WHERE iba.InventoryBotID = ? AND iba.Area = ?
    `;
    args = [InventoryBotID, Area];

    try {
        logger.trace("inventory_bot_delete_area:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_delete_area:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to delete inventory bot area.`});
        return;
    }

    // If there are no affected rows, that means we didn't insert
    if (!results.affectedRows) {
        logger.error("EXIT", "inventory_bot_delete_area:pool.query", {error: `Failed to delete inventory bot area ${Area}.`});
        res.status(400).json({"message": `Failed to delete inventory bot area ${Area}.`});
        return;
    }

    res.status(200).json({"message": `Successfully deleted inventory bot area ${Area}!`});
};

exports.get_inventory_bot_new_areas = async function(req, res) {
    logger.startTrace("get_inventory_bot_new_areas");
    const ID = req.params.id;     // Required
    let sql, args, results, dbResults, apiResults;
    if (!ID) {
        logger.error("EXIT", "get_inventory_bot_new_areas", {error: `ID is required parameter!`});
        res.status(400).json({"message": `ID is required parameter!`});
        return;
    }

    sql = `SELECT IPAddress, DefaultMap FROM inventory_bot WHERE ID = ?`;
    args = [ID];

    try {
        logger.trace("get_inventory_bot_new_areas:pool.query");
        [results] = await ro_pool.query(sql, args);
        let inventoryBotIP = results[0].IPAddress;
        let defaultMap = results[0].DefaultMap;
        if (!defaultMap) {
            logger.error("EXIT", "get_inventory_bot_new_areas:pool.query", {error: `Inventory must have a Default Map set before getting new areas!`});
            res.status(400).json({"message": `Inventory must have a Default Map set before getting new areas!`});
            return;
        }

        const params = {
            "location": defaultMap
        };
        const URI = `${inventoryBotIP}/v1/getLocationDetails`;
        logger.trace("get_inventory_bot_new_areas:getLocationDetails");
        const response = await inventoryBotAPIHelper.get(URI, params);
        apiResults = response.TaskConfigs;
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_new_areas:getLocationDetails", {error: error});
        res.status(500).json({"message": `Error while attempting to get areas for inventory bot ${ID}.`});
        return;
    }

    sql = `SELECT Area from inventory_bot_area where InventoryBotID = ?`;
    args = [ID];

    try {
        logger.trace("get_inventory_bot_new_areas:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
        dbResults = results.map(({ Area }) => Area);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_new_areas:ro_pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to get areas from DB for inventory bot ${ID}.`});
        return;
    }

    let newLocations = [];
    if (apiResults.length) {
        newLocations = apiResults.filter(location => !dbResults.includes(location));
    }

    logger.endTrace("get_inventory_bot_new_areas");
    res.status(200).json({"data": newLocations});
};

exports.get_inventory_bot_data = async function(req, res) {
    logger.startTrace("get_inventory_bot_data");
    let sql, args, results, URI, apiResults, inventoryBotIP;
    let inventoryBotID = req.query.id || null;
    let mapAreaName = req.query.mapAreaName || null;
    let location = req.query.location || null;
    let inventoryName = req.query.inventoryName || null;

    if (!inventoryBotID && !mapAreaName) {
        logger.error("EXIT", "get_inventory_bot_data", {error: `ID and AreaName are required parameters!`});
        res.status(400).json({"message": `ID and AreaName are required parameters!`});
        return;
    }

    if ((location || inventoryName) &&  !(location && inventoryName)) {
        logger.error("EXIT", "get_inventory_bot_data", {error: `location and inventoryName, both must be present`});
        res.status(400).json({"message": `location and inventoryName, both must be present`});
        return;
    }

    logger.info(`${_getDateTime()} Updating inventory for Bot ${inventoryBotID} and Run ${inventoryName}`, "get_inventory_bot_data");
    logger.info(`HEAP STATISTICS before inventory update`, v8.getHeapStatistics());

    apiResults = await _getInventoryBotInfo(inventoryBotID);
    inventoryBotIP = apiResults.IPAddress;
    let rawData = [];
    let parsedData = [];
    let barcodeToKeycode = {};
    let containerToBoundary = {};

    // Now we get the data from the inventory bot
    // Next, call getStatus API to get info from robot
    try {
        URI = `${inventoryBotIP}/v1/getInventoryDataFile`;
        const getInventoryDataFileTimeout = 300 * 1000;
        const options = {
            "timeout": getInventoryDataFileTimeout
        };

        if (location && inventoryName) {
            URI = `${inventoryBotIP}/v1/getInventoryDataFile?location=${location}&inventory=${inventoryName}`;
        }
        logger.trace("get_inventory_bot_data:getInventoryDataFile");
        apiResults = await inventoryBotAPIHelper.get(URI, null, options);
        rawData = apiResults.split("\n");
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_data:", {error: error});
        res.status(500).json({"message": `Error while attempting to get inventory bot status.`});
        return;
    }


    logger.info(`${_getDateTime()} Finished downloading inventory file for Bot ${inventoryBotID} and Run ${inventoryName}`, "get_inventory_bot_data");

    try {
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
        logger.trace("get_inventory_bot_data:pool.query");
        [results] = await ro_pool.query(sql, args);

        if (!results.length) {
            logger.error("EXIT", "get_inventory_bot_data:pool.query", {error: `Inventory Bot ${inventoryBotID} Run ${mapAreaName} failed to get Area and Map data from DB`});
            throw new Error(`Inventory Bot ${inventoryBotID} Run ${mapAreaName} failed to get Area and Map data from DB`);
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

        logger.info(`${_getDateTime()} Starting sanitizing inventory file for Bot ${inventoryBotID} and Run ${inventoryName}`, "get_inventory_bot_data");
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

        logger.trace("get_inventory_bot_data:pool.query:product");
        [results] = await ro_pool.query(sql, args);
        for (let item of results) {
            barcodeToKeycode[item.Barcode] = item.Keycode;
        }

        logger.info(`HEAP STATISTICS before sanitizing`, v8.getHeapStatistics());

        parsedData = await rfidDataHelper.sanitizeDataLine(rawData, inventoryBotID, mapAreaName, containerToBoundary, barcodeToKeycode, inventoryName, mapEdges);
        logger.info(`${_getDateTime()} Half way through sanitizing inventory file for Bot ${inventoryBotID} and Run ${inventoryName}`, "get_inventory_bot_data");
        parsedData = await rfidDataHelper.checkReadCertainty(parsedData, inventoryBotID, inventoryName, locationID);
        logger.info(`${_getDateTime()} Finished sanitizing inventory for Bot ${inventoryBotID} and Run ${inventoryName}`, "get_inventory_bot_data");

        const shouldUpdateInventory = await rfidDataHelper.shouldUpdateInventory(inventoryName, inventoryBotID);
        if (shouldUpdateInventory) {
            logger.trace("get_inventory_bot_data:updateInventory");
            await rfidDataHelper.updateInventory(locationID, "inventory-bot-run", inventoryBotID, mapAreaName, inventoryName);
            logger.info(`${_getDateTime()} Finished updating inventory for Bot ${inventoryBotID} and Run ${inventoryName}`, "get_inventory_bot_data");
        }
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_data:updateInventory", {error: error});
        res.status(500).json({"message": `Error while attempting to update inventory from inventory bot run.`});
        return;
    }

    logger.endTrace("get_inventory_bot_data");
    res.status(200).json({"message": "inventory adjusted" });
};

exports.get_inventory_bot_boundaries = async function(req, res) {
    logger.startTrace("get_inventory_bot_boundaries");
    const ID = req.params.id;
    const Map = req.query.map;

    let sql, args, results;

    if (!Map) {
        logger.error("EXIT", "get_inventory_bot_boundaries", {error: `map is a required parameter!`});
        res.status(400).json({"message": "map is a required parameter!"});
        return;
    }

    args = [ID, Map];

    sql = `
        SELECT ibb.*, c.Type, c.SubType
        FROM inventory_bot_boundary ibb
        INNER JOIN inventory_bot ib ON ibb.LocationID = ib.LocationID AND ibb.Map = ib.DefaultMap
        INNER JOIN container c on c.ID = ibb.ContainerID
        WHERE ib.ID = ? AND ib.DefaultMap = ?`;

    try {
        logger.trace("get_inventory_bot_boundaries:pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_boundaries:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to get inventory bot boundaries.`});
        return;
    }

    logger.endTrace("get_inventory_bot_boundaries");
    res.status(200).json({"data": results});
};

// EXAMPLE body for inventory_bot_create_boundary:
// {
//     "name": "great boundary",
//     "map": "lynnwood",
//     "containerID": "LYN2-STR",
//     "area": "store_hybridtraversal"
//     "boundaryPosition": {
//       "point1X": 24.4,
//       "point2X": 28,
//       "point1Y": 12.3,
//       "point2Y": 28.3
//     },
//     "mapPosition": {
//       "mapLeft": 10,
//       "mapTop": 12,
//       "mapHeight": 3,
//       "mapWidth": 4
//     }
// }
exports.inventory_bot_create_boundary = async function(req, res) {
    logger.startTrace("inventory_bot_create_boundary");
    const ID = req.params.id;
    const Name = req.body.name;
    const Map = req.body.map;
    const ContainerID = req.body.containerID || null;
    const boundaryPosition = req.body.boundaryPosition;
    const mapPosition = req.body.mapPosition;

    let sql, args, results, locationID, locationResults, containerResults;

    if (!Map || !Name || !boundaryPosition || !mapPosition) {
        logger.info(`map, name, boundaryPosition, and mapPosition are required parameters!`, "inventory_bot_create_boundary");
        res.status(400).json({"message": "map, name, boundaryPosition, and mapPosition are required parameters!"});
        return;
    }

    if (ContainerID) {
        logger.trace("inventory_bot_create_boundary:ContainerID");
        sql = `
            SELECT LocationID FROM inventory_bot WHERE ID = ?
            ;
            SELECT * FROM container WHERE ID = ?`;
        args = [ID, ContainerID];

        try {
            logger.trace("inventory_bot_create_boundary:pool.query");
            [results] = await pool.query(sql, args);
            locationResults = results[0];
            containerResults = results[1];
            locationID = locationResults[0].LocationID;
        } catch (error) {
            logger.error("EXIT", "inventory_bot_create_boundary:pool.query", {error: error});
            res.status(500).json({"message": `Error while attempting to create inventory bot boundary.`});
            return;
        }

        // Validation the container exists
        if (containerResults.length) {
            const container = containerResults[0];

            // Check the location of the existing container and the location of the Inventory Bot to make sure they match
            if (container.LocationID !== locationID) {
                logger.error("EXIT", "inventory_bot_create_boundary", {error: `Container ${ContainerID} does not belong to the same Location as the Inventory Bot`});
                res.status(400).json({"message": `Container ${ContainerID} does not belong to the same Location as the Inventory Bot`});
                return;
            }
        } else {
            logger.error("EXIT", "inventory_bot_create_boundary", {error: `Container ${ContainerID} does not exist`});
            res.status(400).json({"message": `Container ${ContainerID} does not exist`});
            return;
        }
    }

    sql = `INSERT INTO inventory_bot_boundary (Name, Map, ContainerID, LocationID, Point1X, Point2X, Point1Y, Point2Y, MapLeft, MapTop, MapHeight, MapWidth) VALUES (?)`;
    args = [[Name, Map, ContainerID, locationID, boundaryPosition.point1X, boundaryPosition.point2X, boundaryPosition.point1Y, boundaryPosition.point2Y, mapPosition.mapLeft, mapPosition.mapTop, mapPosition.mapHeight, mapPosition.mapWidth]];

    try {
        logger.trace("inventory_bot_create_boundary:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_create_boundary:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to create inventory bot boundary.`});
        return;
    }

    // If there are no affected rows, that means we didn't insert
    if (!results.affectedRows) {
        logger.error("EXIT", "inventory_bot_create_boundary:pool.query", {error: `Failed to insert inventory bot boundary.`});
        res.status(400).json({"message": `Failed to insert inventory bot boundary.`});
        return;
    }

    logger.endTrace("inventory_bot_create_boundary");
    res.status(200).json({"message": "Successfully created inventory bot boundary!", "ID": results.insertId});
};

// EXAMPLE body for inventory_bot_update_boundary:
// {
//     "name": "great boundary",
//     "map": "lynnwood",
//     "containerID": "LYN2-STR",
//     "area": "store_hybridtraversal"
//     "boundaryPosition": {
//       "point1X": 24.4,
//       "point2X": 28,
//       "point1Y": 12.3,
//       "point2Y": 28.3
//     },
//     "mapPosition": {
//       "mapLeft": 10,
//       "mapTop": 12,
//       "mapHeight": 3,
//       "mapWidth": 4
//     }
// }
exports.inventory_bot_update_boundary = async function(req, res) {
    logger.startTrace("inventory_bot_update_boundary");
    const ID = req.params.id;
    const Name = req.body.name;
    const ContainerID = req.body.containerID || null;
    const boundaryPosition = req.body.boundaryPosition;
    const mapPosition = req.body.mapPosition;

    let sql, args, results, locationResults, containerResults, locationID;

    if (!Name || !boundaryPosition || !mapPosition) {
        logger.error("EXIT", "inventory_bot_update_boundary", {error: `name, boundaryPosition, and mapPosition are required parameters!`});
        res.status(400).json({"message": "name, boundaryPosition, and mapPosition are required parameters!"});
        return;
    }

    if (ContainerID) {
        sql = `
            SELECT LocationID
            FROM inventory_bot_boundary
            WHERE ID = ?
            ;
            SELECT * FROM container WHERE ID = ?`;
        args = [ID, ContainerID];

        try {
            logger.trace("inventory_bot_update_boundary:pool.query");
            [results] = await pool.query(sql, args);
            locationResults = results[0];
            containerResults = results[1];
            locationID = locationResults[0].LocationID;
        } catch (error) {
            logger.error(error, "inventory_bot_update_boundary:pool.query");
            res.status(500).json({"message": `Error while attempting to update inventory bot boundary.`});
            return;
        }

        // Validation the container exists
        if (containerResults.length) {
            const container = containerResults[0];

            // Check the location of the existing container and the location of the Inventory Bot to make sure they match
            if (container.LocationID !== locationID) {
                logger.error("EXIT", "inventory_bot_update_boundary:pool.query", {error: `Container ${ContainerID} does not belong to the same Location as the Inventory Bot`});
                res.status(400).json({"message": `Container ${ContainerID} does not belong to the same Location as the Inventory Bot`});
                return;
            }
        } else {
            logger.debug("EXIT", "inventory_bot_update_boundary:pool.query", {error: `Container ${ContainerID} does not exist`});
            res.status(400).json({"message": `Container ${ContainerID} does not exist`});
            return;
        }
    }

    sql = `
        UPDATE inventory_bot_boundary
        SET
            Name = ?,
            ContainerID = ?,
            Point1X = ?,
            Point2X = ?,
            Point1Y = ?,
            Point2Y = ?,
            MapLeft = ?,
            MapTop = ?,
            MapHeight = ?,
            MapWidth = ?
        WHERE
            ID = ?`;
    args = [Name, ContainerID, boundaryPosition.point1X, boundaryPosition.point2X, boundaryPosition.point1Y, boundaryPosition.point2Y];
    args.push(mapPosition.mapLeft, mapPosition.mapTop, mapPosition.mapHeight, mapPosition.mapWidth, ID);

    try {
        logger.trace("inventory_bot_update_boundary:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_update_boundary:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to update inventory bot boundary.`});
        return;
    }

    // If there are no affected rows, that means we didn't update
    if (!results.affectedRows) {
        logger.debug("EXIT", "inventory_bot_update_boundary:pool.query:affectedRows", {error: `Failed to update inventory bot boundary`});
        res.status(400).json({"message": `Failed to update inventory bot boundary.`});
        return;
    }

    logger.endTrace("inventory_bot_update_boundary");
    res.status(200).json({"message": "Successfully updated inventory bot boundary!"});
};

exports.inventory_bot_delete_boundary = async function(req, res) {
    logger.startTrace("inventory_bot_delete_boundary");
    const ID = req.params.id;
    let sql, args, results;

    sql = `DELETE FROM inventory_bot_boundary WHERE ID = ?`;
    args = [ID];

    try {
        logger.trace("inventory_bot_delete_boundary:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_delete_boundary:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to delete inventory bot boundary.`});
        return;
    }

    if (!results.affectedRows) {
        logger.error("EXIT", "inventory_bot_delete_boundary", {error: `inventory bot boundary with id ${ID} not found`});
        res.status(404).json({"message": `inventory bot boundary with id ${ID} not found`});
        return;
    }

    logger.endTrace("inventory_bot_delete_boundary");
    res.status(200).json({"message": "Success!"});
};

exports.upload_inventory_bot_map = async function(req, res) {
    logger.startTrace("upload_inventory_bot_map");
    const ID = req.params.id; // Required
    const inventoryName = req.body.inventory;
    const taskConfig = req.body.taskConfig;

    try {
        logger.trace("upload_inventory_bot_map:_uploadMapToS3");
        await _uploadMapToS3(ID, inventoryName, taskConfig);
    } catch (error) {
        logger.error("EXIT", "upload_inventory_bot_map:_uploadMapToS3", {error: error});
        res.status(500).json({"message": `Error while attempting to uplaod map to s3 for inventory bot ${ID}`});
        return;
    }
    logger.endTrace("upload_inventory_bot_map");
    res.status(200).json({"message": "Successfully uploaded map to s3"});
};

exports.get_inventory_bot_location_map_s3 = async function(req, res) {
    logger.startTrace("get_inventory_bot_location_map_s3");
    const botID = req.params.id; // Required
    let sql, args, results;
    if (!botID) {
        logger.error("EXIT", "get_inventory_bot_location_map_s3", {error: "Inventory Bot ID is required!"});
        res.status(500).json({"message": `Inventory Bot ID is required!`});
        return;
    }

    sql = ` SELECT ibm.MapUrl, ibm.MapHeight, ibm.MapWidth
            FROM inventory_bot ib
            LEFT JOIN inventory_bot_map ibm ON ibm.ID = ib.MapID
            where ib.ID = ?`;
    args = [botID];

    try {
        logger.trace("get_inventory_bot_location_map_s3:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_location_map_s3:ro_pool.query", {error: error});
        res.status(500).json({"message": `unable to retrive data for inventory bot: ${botID}`});
        return;
    }

    if (!results.length) {
        logger.error("EXIT", "get_inventory_bot_location_map_s3:ro_pool.query", {error: `unable to retrive data for inventory bot: ${botID}`});
        res.status(500).json({"message": `unable to retrive data for inventory bot: ${botID}`});
        return;
    }

    logger.endTrace("get_inventory_bot_location_map_s3");
    res.status(200).json({"data": results[0]});
};

exports.get_inventory_bot_run_name = async function(req, res) {
    logger.startTrace("get_inventory_bot_run_name");
    const ID = req.params.id;
    const Area = req.query.areaName;
    let results, sql, args;

    if (!ID || !Area) {
        logger.error("EXIT", "get_inventory_bot_run_name", {error: `InventoryBotID and AreaName both are required.`});
        res.status(400).json({"message": `InventoryBotID and AreaName both are required.`});
        return;
    }
    sql = `
        SELECT Distinct RunName
        FROM inventory_rfid_history
        Where InventoryBotID = ? AND MapAreaID = ? AND RunName IS NOT NULL order by RunName desc
    `;
    args = [ID, Area];

    try {
        logger.trace("get_inventory_bot_run_name:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_run_name:ro_pool.query", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot distinct run name.`});
        return;
    }

    logger.endTrace("get_inventory_bot_run_name");
    res.status(200).json({"data": results.map(({ RunName }) => RunName)});
};

exports.get_inventory_bot_run_data = async function(req, res) {
    logger.startTrace("get_inventory_bot_run_data");
    const ID = req.params.id;
    const Area = req.query.areaName;
    const RunName = req.query.runName;
    const Keycode = req.query.keycode || null;
    const ProductID = req.query.barcode || null;
    let results, sql, args;

    if (!ID || !Area || !RunName) {
        logger.error("EXIT", "get_inventory_bot_run_data", {error: `nventoryBotID, RunName and AreaName are required.`});
        res.status(400).json({"message": `InventoryBotID, RunName and AreaName are required.`});
        return;
    }

    sql = `
        SELECT irh.*, p.Product_Name, pd.Name AS Department_Name, p.Class_Name, p.Image_primary, p.Item_Size, p.Style_ID, p.Secondary_Colour
        FROM inventory_rfid_history irh
        INNER JOIN product p ON irh.Keycode = p.Keycode
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        WHERE irh.InventoryBotID = ? AND irh.MapAreaID = ? AND irh.RunName = ?
    `;
    args = [ID, Area, RunName];

    if (Keycode) {
        sql += ` AND irh.Keycode = ?`;
        args.push(Keycode);
    }

    if (ProductID) {
        sql += ` AND irh.ProductID = ?`;
        args.push(ProductID);
    }

    try {
        logger.trace("get_inventory_bot_run_data:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_run_data:ro_pool.query", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot: ${ID} history data for RunName: ${RunName}, AreaName: ${Area}.`});
        return;
    }
    logger.endTrace("get_inventory_bot_run_data");
    res.status(200).json({"data": results});
};

exports.get_inventory_bot_map_metadata = async function(req, res) {
    logger.startTrace("get_inventory_bot_map_metadata");
    const MapID = req.query.mapID;
    let results, sql, args;

    if (!MapID) {
        logger.error("EXIT", "get_inventory_bot_map_metadata:ro_pool.query", {error: `mapID required.`});
        res.status(400).json({"message": `mapID required.`});
        return;
    }

    sql = `
        SELECT ibmm.*, pd.Name AS Department
        FROM inventory_bot_map_metadata ibmm
        INNER JOIN product_department pd ON ibmm.DepartmentID = pd.ID
        WHERE ibmm.MapID = ?`;
    args = [MapID];

    try {
        logger.trace("get_inventory_bot_map_metadata:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "get_inventory_bot_map_metadata:ro_pool.query", {error: error});
        res.status(400).json({"message": `Error while attempting to get inventory bot map metadata.`});
        return;
    }

    logger.endTrace("get_inventory_bot_map_metadata");
    res.status(200).json({"data": results});
};

exports.inventory_bot_webhook = async function(req, res) {
    /**
     * Webhook body sometimes comes in stringified so check and parse it
        {
            '{"Inventory":"2020-10-01_09-30-33","RobotName":"TORY-MetraLabs-059","Status":"Running"}': ''
        }

        For interrupted run:
        RunStatus Webhook: '{"Inventory":"2021-08-26_12-10-00","RobotName":"TORY-Demo","Status":"Interrupted","TaskConfig":""}': ''
        RunFinished Webhook: '{"Finished":true,"Inventory":"2021-08-26_12-10-00","RobotName":"TORY-Demo","RunStatus":"Interrupted","TaskConfig":""}': ''

        For Successful run:
        RunStatus Webhook: '{"Inventory":"2021-08-26_13-58-00","RobotName":"TORY-Demo","Status":"Finished","TaskConfig":""}': ''
        RunFinished Webhook: '{"Finished":true,"Inventory":"2021-08-26_13-58-00","RobotName":"TORY-Demo","RunStatus":"Finished","TaskConfig":""}': ''
     */

    logger.startTrace("inventory_bot_webhook");
    if (!req.body.Inventory) {
        logger.trace("inventory_bot_webhook:parsing", {body:req.body});
        req.body = JSON.parse(Object.keys(req.body)[0]);
    }

    let runName = req.body.Inventory;
    let status = req.body.Status;
    let robotName = req.body.RobotName;
    let isFinished = req.body.Finished;
    let runStatus = req.body.RunStatus;

    const RunFinishedStatus = "RunDataReady";
    const RunInterruptedStatus = "Interrupted";
    const RunInterruptedFinished = "InterruptedRunFinished";
    let sql, args, results, inventoryBotID;

    // Sometimes an Idle event is called without an inventory run name
    // We don't need to update anything for these events
    if (!runName || status === "Idle") {
        logger.error("EXIT", "inventory_bot_webhook:idle", {error: `status is idle or there is no run name`});
        res.status(400).json({"message": `ERROR: Inventory is a required parameter`});
        return;
    }

    sql = `SELECT ID FROM inventory_bot where Name = ?`;
    args = [robotName];

    try {
        logger.info(`Getting inventory bot ID for name ${robotName}`, "inventory_bot_webhook:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_webhook:pool.query", {error: error});
        res.status(500).json({"message": `ERROR inventory_bot_webhook: Failed to lookup bot`});
        return;
    }

    if (!results.length) {
        logger.error("EXIT", "inventory_bot_webhook:pool.query", {error: `No Inventory bot with name ${robotName}`});
        res.status(400).json({"message": `ERROR: No Inventory bot with name ${robotName}`});
        return;
    }

    inventoryBotID = results[0].ID;

    // If this is coming from the RunFinished webhook, detect and send a status
    if (status === RunInterruptedStatus && !isFinished) {
        status = RunInterruptedFinished;
    } else if (runStatus === RunInterruptedStatus && isFinished) {
        status = RunInterruptedStatus;
    } else if (isFinished) {
        status = RunFinishedStatus;
    }

    let sqsUrl;
    if (config.process_tory_webhook_data_sqs) {
        sqsUrl = config.process_tory_webhook_data_sqs;
    } else {
        logger.endTrace("inventory_bot_webhook:process_tory_webhook_data_sqs");
        res.status(200).json({"message": `No further processing required`});
        return;
    }
    let data = {
        status,
        inventoryBotID,
        runName
    };
    let sqsPayload = JSON.stringify(data);
    let params = {
        MessageBody: sqsPayload,
        QueueUrl: sqsUrl,
        DelaySeconds: 0
    };
    try {
        logger.trace("inventory_bot_webhook:sqs.sendMessage");
        await sqs.sendMessage(params).promise();
    } catch (error) {
        logger.error("EXIT", "inventory_bot_webhook:sqs.sendMessage", {error: error});
        res.status(500).json({"message": `Error while processing tory webhook data for Bot: ${inventoryBotID} for runName: ${runName} with status: ${status}`});
        return;
    }
    logger.endTrace("inventory_bot_webhook");
    res.status(200).json({"message": `Successfully added tory webhook data for processing!. Bot: ${inventoryBotID}, runName: ${runName}, status: ${status} `});
};

exports.update_inventory_bot_failure_reason = async function(req, res) {
    logger.startTrace("update_inventory_bot_failure_reason");
    const ID = req.params.id;
    const RunName = req.body.RunName || null;   // Required
    const Reason = req.body.Reason || null;   // Required
    const Comment = req.body.Comment || null; // Not Required
    const ReasonType = req.body.ReasonType || null; // Required
    let sql, args, results;

    if (!ID || !RunName || !Reason || !ReasonType) {
        logger.error("EXIT", "update_inventory_bot_failure_reason", {error: `ID, RunName, Reason and ReasonType are required.`});
        res.status(400).json({"message": `ID, RunName, Reason and ReasonType are required.`});
        return;
    }

    sql = `
        UPDATE bot_process_history
        SET
            FailureReason = ?,
            FailureComment = ?,
            FailureReasonType = ?
        WHERE InventoryBotID = ? AND Name = ?`;
    args = [Reason, Comment, ReasonType, ID, RunName];

    try {
        logger.trace("update_inventory_bot_failure_reason:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "update_inventory_bot_failure_reason:pool.query", {error: error});
        res.status(500).json({"message": `Error while attempting to update inventory bot.`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        logger.error("EXIT", "update_inventory_bot_failure_reason:pool.query", {error: `Inventory Bot with ID ${ID} not found`});
        res.status(404).json({"message": `Inventory Bot with ID ${ID} not found`});
        return;
    }

    logger.endTrace("update_inventory_bot_failure_reason");
    res.status(200).json({"message": "Inventory Bot Failure Reason Updated Successfully!"});
};

exports.inventory_bot_turn_off_brakes = async function(req, res) {
    logger.startTrace("inventory_bot_turn_off_brakes");
    const ID = req.params.id;

    const params = new URLSearchParams();
    params.append("Engaged", false);

    try {
        logger.trace("inventory_bot_turn_off_brakes:setBrakes");
        let inventoryBotInfo = await _getInventoryBotInfo(ID);
        const URI = `${inventoryBotInfo.IPAddress}/v1/setBrakes`;
        await inventoryBotAPIHelper.post(URI, params);
    } catch (error) {
        logger.error("EXIT", "inventory_bot_turn_off_brakes:setBrakes", {error: error});
        res.status(400).json({"message": `Error while attempting to turn on Inventory Bot brakes.`});
        return;
    }

    logger.endTrace("inventory_bot_turn_off_brakes");
    res.status(200).json({"message": "Success!"});
};

async function _getInventoryBotInfo(inventoryBotID) {
    logger.startTrace("_getInventoryBotInfo");
    let sql, args, results;
    sql = `SELECT IPAddress, DefaultMap, MapID FROM inventory_bot WHERE ID = ?`;
    args = [inventoryBotID];

    try {
        logger.trace("_getInventoryBotInfo:ro_pool.query");
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error(error, "_getInventoryBotInfo:ro_pool.query");
        throw new Error(`Error finding Inventory Bot ${inventoryBotID} data.`);
    }

    if (!results.length) {
        logger.error(`Inventory Bot ${inventoryBotID} not found`, "_getInventoryBotInfo:ro_pool.query");
        throw new Error(`Inventory Bot ${inventoryBotID} not found.`);
    }

    logger.endTrace("_getInventoryBotInfo");
    return results[0];
}

async function _uploadMapToS3(botID, inventoryName, taskConfig) {
    logger.startTrace("_uploadMapToS3");
    const locationMapBucketName = config.s3_bucket.wms_assets;
    const runMapBucketName = config.s3_bucket.bot_run_map;
    const locationMapBucketURL = config.StoreFilesWithDomain ? config.base_url : "" + config.s3_bucket.wms_assets_url;
    const runMapBucketURL = config.StoreFilesWithDomain ? config.base_url : "" + config.s3_bucket.bot_run_map_url;
    let locationMapkey = `bot-location/${botID}/locationMap.png`;
    let s3UploadOptions;
    let sql, args, locationHeight, locationWidth, runWidth, runHeight, CellSize, OffSetX, OffSetY;
    let getmapApiResults, getRunMapApiResults, getMapMetaDataResults, runMapkey, inventoryBotInfo;

    logger.debug(`${_getDateTime()} Uploading Map to S3 for Bot ${botID} and Run ${inventoryName}`);

    const getMapTimeout = 300 * 1000;

    try {
        // get the basic IPaddress and defaultMap for the Bot from DB
        inventoryBotInfo = await _getInventoryBotInfo(botID);

        const getLocationMapUrl = `${inventoryBotInfo.IPAddress}/v1/getMap`;
        const getRunEvaluationMapUrl = `${inventoryBotInfo.IPAddress}/v1/getRunEvaluationMap`;
        const getMapMetaDataUrl = `${inventoryBotInfo.IPAddress}/v1/getMapMetaData`;

        const params = {
            location: inventoryBotInfo.DefaultMap,
            inventory: inventoryName
        };
        const option = {
            "responseType": "arraybuffer",
            "timeout": getMapTimeout
        };

        // Only want to set
        if (config.isKmartEnvironment) {
            s3UploadOptions = {
                ACL: "public-read"
            };
        }

        // get the location map
        getmapApiResults = await inventoryBotAPIHelper.get(getLocationMapUrl, null, option);

        // upload location map to s3
        await helper.uploadFileToS3(locationMapBucketName, locationMapkey, getmapApiResults, false, s3UploadOptions);
        logger.debug(`${_getDateTime()} Finished uploading location map to S3 for Bot ${botID} and Run ${inventoryName}`);

        // get the map meta data
        getMapMetaDataResults = await inventoryBotAPIHelper.get(getMapMetaDataUrl);

        if (getMapMetaDataResults) {
            CellSize = getMapMetaDataResults.CellSize;
            OffSetX  = getMapMetaDataResults.Offset.X;
            OffSetY  = getMapMetaDataResults.Offset.Y;
        }

        // if inventoryName is provided than we can get the run evaluation map and upload to s3
        getRunMapApiResults = await inventoryBotAPIHelper.get(getRunEvaluationMapUrl, params, option);
        if (inventoryName && taskConfig) {

            runMapkey = `bot-run/${botID}/${taskConfig}_(${inventoryName}).png`;
            await helper.uploadFileToS3(runMapBucketName, runMapkey, getRunMapApiResults, false, s3UploadOptions);
            logger.info(`${_getDateTime()} Finished uploading run evaluation map to S3 for Bot ${botID} and Run ${inventoryName}`, "_uploadMapToS3");
        }
    } catch (error) {
        logger.error("EXIT", "_uploadMapToS3", {error: error});
        throw new Error(`Unable to get Map for inventory bot ID : ${botID}`);
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
        await pool.query(sql, args);
    } catch (error) {
        logger.error("EXIT", "_uploadMapToS3", {error: error});
        throw new Error(`Unable to update location Map Infomation for inventory bot ID : ${botID}`);
    }

    if (inventoryName) {
        sql = `SELECT * FROM bot_process_history WHERE InventoryBotID = ? AND Name = ?`;
        args = [botID, inventoryName];
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
                await pool.query(sql, args);
            } catch (error) {
                logger.error("EXIT", "_uploadMapToS3:", {error: error});
                throw new Error(`Unable to update run map Infomation for inventory bot ID : ${botID}`);
            }
        }
    }
    logger.endTrace("_uploadMapToS3");
}

async function _generateMapMetadata(inventoryBotID, area) {
    logger.startTrace("_generateMapMetadata");
    let sql, args, results;

    logger.info(`${_getDateTime()} Updating map metadata for Bot ${inventoryBotID} and Area ${area}`, "_generateMapMetadata");

    // Starting transaction and setting isolation level to READ COMMITTED on this transaction
    // This is to avoid having a long lock on the inventory table
    sql = `
        START TRANSACTION
        ;
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
        ;
        INSERT INTO inventory_bot_map_metadata (MapID, DepartmentID, XCenter, YCenter, XCenterImage, YCenterImage, Radius, RadiusImage, Point1X, Point2X, Point1Y, Point2Y, ImageLeft, ImageTop, ImageWidth, ImageHeight)
        SELECT
            v.MapID,
            v.DepartmentID,
            # Center and radius of circle
            v.XAverage AS XCenter,
            v.YAverage AS YCenter,
            FLOOR((v.XAverage / v.CellSize) + v.OffsetX) AS XCenterImage,
            FLOOR(-((v.YAverage / v.CellSize) - v.MapHeight + v.OffsetY)) AS YCenterImage,
            v.PositionStandardDeviation AS Radius,
            v.PositionStandardDeviation / v.CellSize AS RadiusImage,
            # Values of rectangle
            v.XLeft AS Point1X,
            v.XRight AS Point2X,
            v.YTop AS Point1Y,
            v.YBottom AS Point2Y,
            FLOOR((v.XLeft / v.CellSize) + v.OffsetX) AS LeftImage,
            FLOOR(-((v.YTop / v.CellSize) - v.MapHeight + v.OffsetY)) AS TopImage,
            FLOOR(((v.XRight / v.CellSize) + v.OffsetX) - ((v.XLeft / v.CellSize) + v.OffsetX)) AS WidthImage,
            FLOOR((-((v.YBottom / v.CellSize) - v.MapHeight + v.OffsetY)) + ((v.YTop / v.CellSize) - v.MapHeight + v.OffsetY)) AS HeightImage
        FROM (
            SELECT
                aggregates.ID AS InventoryBotID,
                aggregates.DepartmentID,
                aggregates.XAverage,
                aggregates.YAverage,
                aggregates.XAverage - (1 * aggregates.XStandardDeviation) AS XLeft,
                aggregates.XAverage + (1 * aggregates.XStandardDeviation) AS XRight,
                aggregates.YAverage + (1 * aggregates.YStandardDeviation) AS YTop,
                aggregates.YAverage - (1 * aggregates.YStandardDeviation) AS YBottom,
                ibm.ID AS MapID,
                ibm.MapHeight,
                ibm.CellSize,
                ibm.OffSetX,
                ibm.OffsetY,
                STD(SQRT(POW(aggregates.XAverage - i.XPosition, 2) + POW(aggregates.YAverage - i.YPosition, 2))) AS PositionStandardDeviation
            FROM (
                SELECT
                    ib.ID,
                    p.DepartmentID,
                    AVG(i.XPosition) AS XAverage,
                    AVG(i.YPosition) AS YAverage,
                    STD(i.XPosition) AS XStandardDeviation,
                    STD(i.YPosition) AS YStandardDeviation,
                    COUNT(i.ID) AS InventoryCount,
                    GROUP_CONCAT(DISTINCT containers.ContainerID) AS Containers
                FROM inventory_bot ib
                INNER JOIN (
                    SELECT ContainerID, InventoryBotID
                    FROM inventory_bot_area
                    WHERE Area = ? AND InventoryBotID = ?
                    UNION
                    SELECT DISTINCT ibb.ContainerID, ib.ID AS InventoryBotID
                    FROM inventory_bot_boundary ibb
                    INNER JOIN inventory_bot ib ON ibb.LocationID = ib.LocationID AND ibb.Map = ib.DefaultMap
                    WHERE ib.ID = ?
                ) containers ON containers.InventoryBotID = ib.ID
                INNER JOIN inventory i ON i.ContainerID = containers.ContainerID
                INNER JOIN product p ON i.Keycode = p.Keycode
                WHERE CAST(ib.ID AS UNSIGNED) = ?
                GROUP BY p.DepartmentID
                HAVING InventoryCount > 10
            ) aggregates
            INNER JOIN inventory_bot_map ibm ON aggregates.ID = ibm.InventoryBotID AND ibm.Type = 'Location'
            INNER JOIN inventory i ON i.ContainerID IN (Containers)
            INNER JOIN product p ON i.Keycode = p.Keycode AND p.DepartmentID = aggregates.DepartmentID
            GROUP BY aggregates.DepartmentID
        ) v
        ON DUPLICATE KEY UPDATE
        YCenter = VALUES(YCenter),
        XCenterImage = VALUES(XCenterImage),
        YCenterImage = VALUES(YCenterImage),
        Radius = VALUES(Radius),
        RadiusImage = VALUES(RadiusImage),
        Point1X = VALUES(Point1X),
        Point2X = VALUES(Point2X),
        Point1Y = VALUES(Point1Y),
        Point2Y = VALUES(Point2Y),
        ImageLeft = VALUES(ImageLeft),
        ImageTop = VALUES(ImageTop),
        ImageWidth = VALUES(ImageWidth),
        ImageHeight = VALUES(ImageHeight)
        ;
        COMMIT
        ;`;

    args = [area, inventoryBotID, area, inventoryBotID, inventoryBotID];

    try {
        logger.trace("_generateMapMetadata:pool.query");
        [results] = await helper.queryWithRetries(sql, args);
        logger.info(`inserted ${results[2].affectedRows} rows for Inventory Bot ${inventoryBotID}`, "_generateMapMetadata");
    } catch (error) {
        logger.error(error, "_generateMapMetadata:pool.query");
    }

    logger.info(`${_getDateTime()} Finished updating map metadata for Bot ${inventoryBotID} and Area ${area}`, "_generateMapMetadata");
    logger.endTrace("_generateMapMetadata");
}

async function _generateInventoryTasks(req, inventoryBotID) {
    let sql, args, results, locationID;

    sql = `
        SELECT ib.LocationID FROM inventory_bot ib
        INNER JOIN inventory_count_schedule ics ON ics.LocationID
        # If ics.Hour isn't one, this location's inventory count tasks are managed by a schedule
        WHERE ib.ID = ? AND ics.Hour = -1`;
    args = [inventoryBotID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error(error, "_generateInventoryTasks");
        return;
    }

    if (!results.length) {
        logger.info(`Inventory Bot ${inventoryBotID} Location is set to create Inventory Tasks with schedule`, "_generateInventoryTasks");
        return;
    }

    locationID = results[0].LocationID;

    try {
        await apiRequest.post(req, "/create_random_inventory_checks_for_location", {
            "LocationID": locationID
        });
    } catch (error) {
        logger.error(error, "_generateInventoryTasks");
        return;
    }

    logger.info(`${_getDateTime()} Finished generating inventory tasks for Inventory Bot ${inventoryBotID}`, "_generateInventoryTasks");
}

function _getDateTime() {
    return moment().format("YYYY-MM-DD HH:mm:ss");
}
