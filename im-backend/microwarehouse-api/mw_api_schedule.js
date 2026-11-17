const inventoryBotHelpers = require("../library/inventoryBotAPIHelper");
const logger = require("../library/logger")("microwarehouse-api:mw_api_schedule");

exports.get_schedule = async function(req, res) {
    let scheduleID = req.query.ScheduleID || null;
    let sql, args, results, apiResults, scheduleResults, backfillResults, inventoryCheckResults, stocktakeResults;

    if (!scheduleID) {
        res.status(400).json({"message": "ScheduleID is required"});
        return;
    }

    args = [scheduleID, scheduleID, scheduleID, scheduleID];
    sql = `
        SELECT * FROM schedule WHERE ID = ?
        ;
        SELECT * from schedule_backfill	WHERE ScheduleID = ?
        ;
        SELECT * from schedule_inventory_check WHERE ScheduleID = ?
        ;
        SELECT * from schedule_stocktake WHERE ScheduleID = ?
        ;`;

    try {
        [results] = await pool.query(sql, args);
        scheduleResults = results[0];
        backfillResults = results[1];
        inventoryCheckResults = results[2];
        stocktakeResults = results[3];
    } catch (error) {
        logger.error("get_schedule:", {error});
        res.status(500).json({"message": `ERROR: Unable to get schedule ${scheduleID}`});
        return;
    }

    if (!scheduleResults.length) {
        res.status(404).json({"message": `Schedule with ID ${scheduleID} was not found`});
        return;
    }

    scheduleResults = scheduleResults[0];
    backfillResults = backfillResults[0];
    inventoryCheckResults = inventoryCheckResults[0];

    apiResults = {
        "ID": scheduleResults["ID"],
        "LocationID": scheduleResults["LocationID"],
        "Hour": scheduleResults["Hour"],
        "Minute": scheduleResults["Minute"],
        "Name": scheduleResults["Name"],
        "Sun": scheduleResults["Sun"],
        "Mon": scheduleResults["Mon"],
        "Tue": scheduleResults["Tue"],
        "Wed": scheduleResults["Wed"],
        "Thu": scheduleResults["Thu"],
        "Fri": scheduleResults["Fri"],
        "Sat": scheduleResults["Sat"],
        "isActive": scheduleResults["isActive"]
    };

    if (backfillResults) {
        apiResults["BackfillSchedule"] = {
            "ID": backfillResults["ID"]
        };
    }

    if (inventoryCheckResults) {
        apiResults["InventoryCheckResults"] = {
            "ID": inventoryCheckResults["ID"],
            "Type": inventoryCheckResults["Type"],
            "KeycodesToCheck": inventoryCheckResults["KeycodesToCheck"],
            "hoursToComplete": inventoryCheckResults["hoursToComplete"],
            "isCurrentAdjustmentCancele": inventoryCheckResults["isCurrentAdjustmentCancele"]
        };
    }

    // May be more than one stocktake for each schedule so logic is a bit different
    if (stocktakeResults.length) {
        apiResults["StocktakeResults"] = [];

        for (let stocktake of stocktakeResults) {
            apiResults["StocktakeResults"].push({
                "ID": stocktake["ID"],
                "Type": stocktake["Type"],
                "InventoryBotID": stocktake["InventoryBotID"],
                "InventoryBotArea": stocktake["InventoryBotArea"],
                "ContainerID": stocktake["ContainerID"],
                "MinsToComplete": stocktake["MinsToComplete"]
            });
        }
    }

    res.status(200).json({"data": apiResults});
};

exports.get_schedules_for_location = async function(req, res) {
    let locationID = req.query.LocationID || null;
    let sql, args, results;

    if (!locationID) {
        res.status(400).json({"message": "LocationID is required"});
        return;
    }

    args = [locationID];
    sql = `
        SELECT
            s.*,
            IF(sb.ID, 1, 0) AS hasBackfillSchedule,
            IF(sic.ID, 1, 0) AS hasInventoryCheckSchedule,
            IF(ss.ID, 1, 0) AS hasStocktakeSchedule
        FROM schedule s
        LEFT JOIN schedule_backfill	sb ON sb.ScheduleID = s.ID
        LEFT JOIN schedule_inventory_check sic ON sic.ScheduleID = s.ID
        LEFT JOIN schedule_stocktake ss ON ss.ScheduleID = s.ID
        WHERE s.LocationID = ?
        GROUP BY s.ID`;

    try {
        [results] = await pool.query(sql, args);

    } catch (error) {
        logger.error("get_schedules_for_location:", {error});
        res.status(500).json({"message": `Unable to get the schedules for location: ${locationID}`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.get_all_schedules = async function(req, res) {
    let sql, results, data;

    sql = `
        SELECT
            s.*,
            IF(sb.ID, 1, 0) AS hasBackfillSchedule,
            IF(sic.ID, 1, 0) AS hasInventoryCheckSchedule,
            IF(ss.ID, 1, 0) AS hasStocktakeSchedule
        FROM schedule s
        LEFT JOIN schedule_backfill	sb ON sb.ScheduleID = s.ID
        LEFT JOIN schedule_inventory_check sic ON sic.ScheduleID = s.ID
        LEFT JOIN schedule_stocktake ss ON ss.ScheduleID = s.ID
        GROUP BY s.ID`;

    try {
        [results] = await pool.query(sql);
    } catch (err) {
        logger.error("get_all_schedules:", {err});
        res.status(500).json({"message": `Unable to get all schedules`});
        return;
    }

    data = {};

    for (let result of results) {
        if (result.LocationID in data) {
            data[result.LocationID].push(result);
        } else {
            data[result.LocationID] = [result];
        }
    }

    res.status(200).json({"data": data});
};

exports.upsert_schedule = async function(req, res) {
    let ID = req.body.ID || null;
    let locationID = req.body.LocationID || null;
    let hour = req.body.Hour;
    let minute = req.body.Minute;
    let name = req.body.Name || null;
    let isEnabled = req.body.IsEnabled === "true" || req.body.IsEnabled === true;
    let sunday = req.body.Sun === "true" || req.body.Sun === true;
    let monday = req.body.Mon === "true" || req.body.Mon === true;
    let tuesday = req.body.Tue === "true" || req.body.Tue === true;
    let wednesday = req.body.Wed === "true" || req.body.Wed === true;
    let thursday = req.body.Thu === "true" || req.body.Thu === true;
    let friday = req.body.Fri === "true" || req.body.Fri === true;
    let saturday = req.body.Sat === "true" || req.body.Sat === true;

    let sql, args, results, updateResults, selectResults, message;

    if (!(hour >= 0) || !(minute >= 0)) {
        res.status(400).json({"message": "LocationID, Hour, Minute, ID are required"});
        return;
    }

    if (ID) {
        sql = `
            UPDATE schedule
            SET
                Hour = ?,
                Minute = ?,
                isEnabled = ?,
                Name = ?,
                Sun = ?, Mon = ?, Tue = ?, Wed = ?, Thu = ?, Fri = ?, Sat = ?,
                isEnabled
            WHERE ID = ?
            ;
            SELECT DISTINCT ss.InventoryBotID, ss.InventoryBotArea
            FROM schedule s
            INNER JOIN stocktake_schedule ss ON s.ID = ss.ScheduleID
            WHERE ss.Type = 'InventoryBot'
                s.ID = ?`;

        args = [hour, minute, isEnabled, name, sunday, monday, tuesday, wednesday, thursday, friday, saturday, isEnabled, ID, ID];
    } else {
        sql = `INSERT INTO schedule (LocationID, Hour, Minute, Name, Sun, Mon, Tue, Wed, Thu, Fri, Sat, isEnabled) VALUES (?);`;
        args = [[locationID, hour, minute, name, sunday, monday, tuesday, wednesday, thursday, friday, saturday, isEnabled]];
    }

    try {
        [results] = await pool.query(sql, args);
        updateResults = results[0];
        selectResults = results[1];
    } catch (error) {
        logger.error("update_schedule:", {error});
        res.status(500).json({"message": `Unable to update the schedule`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!updateResults.affectedRows) {
        res.status(404).json({"message": `Unable to update the schedule`});
        return;
    }

    message = `Schedule updated.`;

    res.json({"message": message});

    // Don't need to do anything if this is insert
    if (!ID) {
        return;
    }

    for (let result of selectResults) {
        let inventoryBotID = result.InventoryBotID;
        let inventoryBotArea = result.InventoryBotArea;

        try {
            await inventoryBotHelpers.syncInventoryBotSchedule(req, inventoryBotID, inventoryBotArea);
        } catch (error) {
            logger.error("update_backfill_schedule:", {error});
            res.status(500).json({"message": `Unable to update the backfill schedule`});
            return;
        }
    }
};

exports.delete_schedule = async function(req, res) {
    let ID = req.query.ID || null;
    let sql, args, results, message;

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    // Probably need some validation here, idk

    sql = `DELETE from schedule WHERE ID = ?`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the schedule`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to delete the schedule`});
        return;
    }

    message = `Schedule deleted.`;

    res.json({"message": message});
};

exports.insert_backfill_schedule = async function(req, res) {
    let scheduleID = req.body.ScheduleID || null;
    let sql, args, results, message;

    if (!scheduleID) {
        res.status(400).json({"message": "ScheduleID is required"});
        return;
    }

    sql = `INSERT INTO schedule_backfill (ScheduleID) VALUES (?);`;
    args = [[scheduleID]];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("insert_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to add the Backfill Schedule`});
        return;
    }

    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to add the Backfill Schedule`});
        return;
    }

    message = `Backfill Schedule.`;

    res.json({"message": message});
};

exports.upsert_stocktake_schedule = async function(req, res) {
    let ID = req.body.ID || null;
    let scheduleID = req.body.ScheduleID || null;
    let type = req.body.Type || null;
    let inventoryBotID = req.body.InventoryBotID || null;
    let inventoryBotArea = req.body.InventoryBotArea || null;
    let containerID = req.body.ContainerID || null;
    let minsToComplete = req.body.MinsToComplete || null;
    let sql, args, results, message;

    if (!type) {
        res.status(400).json({"message": "ID and Type are required"});
        return;
    }

    if (ID) {
        sql = `
            UPDATE schedule_stocktake
            SET
                Type = ?,
                InventoryBotID = ?,
                InventoryBotArea = ?,
                ContainerI = ?,
                MinsToComplete = ?
            WHERE ID = ?`;
        args = [type, inventoryBotID, inventoryBotArea, containerID, minsToComplete, ID];
    } else {
        sql = `INSERT INTO schedule_stocktake (ScheduleID, Type, InventoryBotID, InventoryBotArea, ContainerID, MinsToComplete) VALUES (?);`;
        args = [[scheduleID, type, inventoryBotID, inventoryBotArea, containerID, minsToComplete]];
    }

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_stocktake_schedule:", {error});
        res.status(500).json({"message": `Unable to update the Stocktake Schedule`});
        return;
    }

    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to update the Stocktake Schedule`});
        return;
    }

    message = `Stocktake Schedule updated.`;

    res.json({"message": message});
};

exports.upsert_inventory_check_schedule = async function(req, res) {
    let ID = req.body.ID || null;
    let scheduleID = req.body.ScheduleID || null;
    let type = req.body.Type || null;
    let hoursToComplete = req.body.HoursToComplete || null;
    let keycodesToCheck = req.body.KeycodesToCheck || null;
    let sql, args, results, message;

    if (!type) {
        res.status(400).json({"message": "ID and Type are required"});
        return;
    }

    if (ID) {
        sql = `
            UPDATE schedule_inventory_take
            SET
                Type = ?,
                HoursToComplete = ?,
                KeycodesToCheck = ?
            WHERE ID = ?`;
        args = [type, hoursToComplete, keycodesToCheck, ID];
    } else {
        sql = `INSERT INTO schedule_inventory_check (ScheduleID, Type, hoursToComplete) VALUES (?);`;
        args = [[scheduleID, type, hoursToComplete]];
    }

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_check_schedule:", {error});
        res.status(500).json({"message": `Unable to update the Inventory Check Schedule`});
        return;
    }

    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to update the Inventory Check Schedule`});
        return;
    }

    message = `Inventory Check Schedule updated.`;

    res.json({"message": message});
};

exports.delete_backfill_schedule = async function(req, res) {
    let ID = req.query.ID || null;
    let sql, args, results, message;

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    sql = `DELETE from schedule_backfill WHERE ID = ?`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the Backfill Schedule`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to delete the Backfill Schedule`});
        return;
    }

    message = `Backfill Schedule deleted.`;

    res.json({"message": message});
};

exports.delete_stocktake_schedule = async function(req, res) {
    let ID = req.query.ID || null;
    let sql, args, results, message;

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    sql = `DELETE from schedule_stocktake WHERE ID = ?`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_stocktake_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the Stocktake Schedule`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to delete the Stocktake Schedule`});
        return;
    }

    message = `Stocktake Schedule deleted.`;

    res.json({"message": message});
};

exports.delete_inventory_check_schedule = async function(req, res) {
    let ID = req.query.ID || null;
    let sql, args, results, message;

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    sql = `DELETE from schedule_inventory_check WHERE ID = ?`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_inventory_check_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the Inventory Check Schedule`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to delete the Inventory Check Schedule`});
        return;
    }

    message = `Inventory Check Schedule deleted.`;

    res.json({"message": message});
};

exports.update_inventory_snapshot = async function(req, res) {
    let keycode = req.body.keycode || null;
    let container = req.body.container || null;
    let physicalQuantity = parseInt(req.body.physicalQuantity);
    let referenceID = req.body.referenceID || null;
    let reason = req.body.reason || null;
    let sql, args;

    if (!keycode || !container || !referenceID || isNaN(physicalQuantity)) {
        res.status(400).json({"message": "keycode, container, physicalQuantity, and referenceID are required"});
        return;
    }

    sql = `
         UPDATE IGNORE inventory_snapshot
         # For now always setting QuantityAdjusted to the RFID Quantity
         SET QuantityCounted = ?, QuantityAdjusted = Quantity, AdjustmentReason = ?, DateCounted = NOW()
         WHERE
             ScheduleID = ?
             AND ContainerID = ?
             AND Keycode = ?
             # The snapshot will not be completed and DateCompleted is part of the composite index
             AND DateCompleted IS NULL`;
    args = [physicalQuantity, reason, referenceID, container, keycode];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_snapshot", {error});
        res.status(500).json({"message": `Unable to record Inventory Count for keycode ${keycode}`});
        return;
    }

    const message = `Inventory Count of ${physicalQuantity} recorded for keycode ${keycode} in ${container}`;
    let response = {
        "message": message
    };

    res.status(200).json(response);
};

exports.update_inventory_adjustment = async function(req, res) {
    let scheduleID = req.body.ScheduleID;
    // If true, stop current inventory adjustment, if false, resume current inventory adjustment
    let stopCurrentInventoryAdjustment = req.body.StopCurrentInventoryAdjustment || false;
    let sql, args, results;

    if (!scheduleID) {
        res.status(400).json({"message": "ScheduleID is required"});
        return;
    }

    sql = `
        SELECT
            IF(sic.Type = 'system', 1, 0) AS isSystemInventoryCheck,
            IFNULL(snapshot.hasActiveInventoryAdjustment, 0) AS hasActiveInventoryAdjustment,
            s.Name
        FROM schedule s
        INNER JOIN schedule_inventory_check sic ON s.ID = sic.ScheduleID
        LEFT JOIN (
            SELECT DISTINCT
                sic.ID AS inventoryCheckScheduleID,
                IF(COUNT(*) > 0, 1, 0) AS hasActiveInventoryAdjustment
            FROM inventory_snapshot is
            INNER JOIN schedule s ON is.ScheduleID = s.ID
            INNER JOIN schedule_inventory_check sic ON s.ID = sic.ScheduleID
            WHERE sic.ID = ? AND is.DateCompleted IS NULL
        ) snapshot ON s.ID = snapshot.inventoryCheckScheduleID
        WHERE sic.ID = ?`;
    args = [scheduleID, scheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_adjustment:", {error});
        res.status(500).json({"message": `Unable to update current inventory adjustment`});
        return;
    }

    if (!results.length) {
        res.status(400).json({"message": `Schedule ${scheduleID} does not exist`});
        return;
    }

    let isSystemInventoryCheck = results[0].isSystemInventoryCheck;
    let hasActiveInventoryAdjustment = results[0].hasActiveInventoryAdjustment;
    let scheduleName = results[0].Name;

    if (!isSystemInventoryCheck) {
        res.status(400).json({"message": `Schedule ${scheduleName} is not enabled for System Inventory Adjustment`});
        return;
    }

    if (!hasActiveInventoryAdjustment) {
        res.status(400).json({"message": `Schedule ${scheduleName} does not have an active Inventory Adjustment`});
        return;
    }

    sql = `
         UPDATE schedule_inventory_check
         SET isCurrentAdjustmentCanceled = ?
         WHERE ID = ?`;
    args = [stopCurrentInventoryAdjustment, scheduleID];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_adjustment:", {error});
        res.status(500).json({"message": `Unable to update Inventory Adjustment ${scheduleName}`});
        return;
    }

    let message;
    if (stopCurrentInventoryAdjustment) {
        message = `Paused current Inventory Adjustment for Schedule ${scheduleName}`;
    } else {
        message = `Resumed current Inventory Adjustment for Schedule ${scheduleName}`;
    }

    let response = {
        "message": message
    };
    res.status(200).json(response);
};
