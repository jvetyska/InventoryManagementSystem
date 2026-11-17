/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const apiRequest = require("../library/apiRequest");
const authHelper = require("../library/authHelper");
const helper = require("../library/helperFn");
const moment = require("moment-timezone");
const inventoryBotHelpers = require("../library/inventoryBotAPIHelper");
const inventoryBotScheduleType = "InventoryBot";
const logger = require("../library/logger")("microwarehouse-api:mw_api_backfill");

exports.get_backfill_schedule = async function(req, res) {
    let locationID = req.query.LocationID || null;
    let sql, args, results;
    if (!locationID) {
        res.status(400).json({"message": "LocationID is required"});
        return;
    }

    args = [locationID];
    sql = `
    SELECT sbc.*, iks.ID as inventoryTakeScheduleID, iks.BackfillScheduleID, iks.Type,
            iks.Hour as inventoryTakeScheduleHour, iks.Minute as inventoryTakeScheduleMinute, iks.InventoryBotID, iks.InventoryBotArea,
            IFNULL(iba.ContainerID, iks.ContainerID) AS ContainerID, ib.Name as InventoryBotName, ib.ID as InventoryBotID, boundaries.Containers AS BoundaryContainers,
            iks.MinsToComplete as inventoryRunMin
        FROM store_backfill_schedule sbc
        LEFT JOIN inventory_take_schedule iks ON sbc.ID = iks.BackfillScheduleID
        LEFT JOIN inventory_bot_area iba ON iks.InventoryBotArea = iba.Area AND iks.InventoryBotID = iba.InventoryBotID
        LEFT JOIN inventory_bot ib ON iks.InventoryBotID = ib.ID
        LEFT JOIN (
            # Get Containers from boundaries which will be included in the backfill
            SELECT
                ibb.Map,
                ibb.LocationID,
                GROUP_CONCAT(DISTINCT ContainerID) AS Containers
            FROM inventory_bot_boundary ibb
            INNER JOIN container c ON ibb.ContainerID = c.ID
            INNER JOIN container_type ct ON ct.ID = c.Type
            WHERE ct.BackfillEnabled = 1 AND ibb.ContainerID IS NOT NULL
            GROUP BY ibb.Map, ibb.LocationID
        ) boundaries ON boundaries.Map = ib.DefaultMap AND boundaries.LocationID = ib.LocationID
        WHERE sbc.LocationID = ?`;

    try {
        [results] = await ro_pool.query(sql, args);

    } catch (error) {
        logger.error("get_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to get the backfill schedule for location: ${locationID}`});
        return;
    }

    let backfillDictionary = {};

    for (let schedule of results) {
        let boundaryContainers = [];
        if (schedule.BoundaryContainers) {
            boundaryContainers = schedule.BoundaryContainers.split(",");
        }

        const stockTakeObj = {
            ID: schedule.inventoryTakeScheduleID,
            BackFillScheduleID: schedule.BackFillScheduleID,
            Type: schedule.Type,
            Hour: schedule.inventoryTakeScheduleHour,
            Minute: schedule.inventoryTakeScheduleMinute,
            ContainerID: schedule.ContainerID,
            InventoryBotID: schedule.InventoryBotID,
            InventoryBotName: schedule.InventoryBotName,
            InventoryBotArea: schedule.InventoryBotArea,
            InventoryRunMin: schedule.inventoryRunMin
        };

        if (backfillDictionary[schedule.ID]) {
            backfillDictionary[schedule.ID].inventoryTakeSchedule.push(stockTakeObj);
            backfillDictionary[schedule.ID].boundaryContainers = backfillDictionary[schedule.ID].boundaryContainers.concat(boundaryContainers);
        } else {
            let inventoryTakeSchedule = [];
            if (schedule.inventoryTakeScheduleID) {
                inventoryTakeSchedule.push(stockTakeObj);
            }

            backfillDictionary[schedule.ID] = {
                ID: schedule.ID,
                Sun: schedule.Sun,
                Mon: schedule.Mon,
                Tue: schedule.Tue,
                Wed: schedule.Wed,
                Thu: schedule.Thu,
                Fri: schedule.Fri,
                Sat: schedule.Sat,
                Hour: schedule.Hour,
                Minute: schedule.Minute || 0,
                Name: schedule.Name,
                IsEnabled: schedule.IsEnabled,
                InventoryCheckType: schedule.InventoryCheckType,
                keycodesToCheck: schedule.keycodesToCheck,
                hoursToComplete: schedule.hoursToComplete,
                isCurrentAdjustmentCanceled: schedule.isCurrentAdjustmentCanceled,
                inventoryTakeSchedule: inventoryTakeSchedule,
                boundaryContainers: boundaryContainers
            };
        }
    }

    res.status(200).json({"data": Object.values(backfillDictionary)});
};

exports.get_all_inventory_tasks = async function(req, res) {
    let sql, results, data;

    sql = `SELECT * FROM store_backfill_schedule WHERE IsEnabled = true;`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (err) {
        logger.error("get_all_inventory_tasks:", {err});
        res.status(500).json({"message": `Unable to get the inventory tasks`});
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

exports.add_backfill_schedule = async function(req, res) {
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
    // let inventoryCheckType = req.body.inventoryCheckType || null;
    // let keycodesToCheck = req.body.keycodesToCheck || null;
    // let hoursToComplete = req.body.hoursToComplete || null;
    let sql, args, results, message;

    if (!locationID || !(hour >= 0) || !(minute >= 0)) {
        res.status(400).json({"message": "LocationID, Hour, Minute are required"});
        return;
    }

    sql = `INSERT INTO store_backfill_schedule (LocationID, Hour, Minute, IsEnabled, Name, Sun, Mon, Tue, Wed, Thu, Fri, Sat) VALUES (?) ;`;
    args = [[locationID, hour, minute, isEnabled, name, sunday, monday, tuesday, wednesday, thursday, friday, saturday]];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("add_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to add the backfill schedule for location: ${locationID}`});
        return;
    }

    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to add the backfill schedule for location: ${locationID}`});
        return;
    }

    message = `Backfill Replenishment Schedule added for ${locationID}. `;

    res.json({"message": message });
};

exports.update_backfill_schedule = async function(req, res) {
    let ID = req.body.ID || null;
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

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    sql = `
        UPDATE store_backfill_schedule SET
            IsEnabled = ?,
            Name = ?,
            Sun = ?, Mon = ?, Tue = ?, Wed = ?, Thu = ?, Fri = ?, Sat = ?
            WHERE ID = ?
        ;
        SELECT DISTINCT InventoryBotID, InventoryBotArea
        FROM store_backfill_schedule sbs
        INNER JOIN inventory_take_schedule its ON sbs.ID = its.BackfillScheduleID
        WHERE its.Type = 'InventoryBot'
            AND sbs.ID = ?`;

    args = [isEnabled, name, sunday, monday, tuesday, wednesday, thursday, friday, saturday, ID, ID];



    try {
        [results] = await pool.query(sql, args);
        updateResults = results[0];
        selectResults = results[1];
    } catch (error) {
        logger.error("update_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to update the backfill schedule`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!updateResults.affectedRows) {
        res.status(404).json({"message": `Unable to update the backfill schedule`});
        return;
    }

    message = `Backfill Replenishment Schedule updated.`;

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

    res.json({"message": message});
};

exports.update_inventory_check = async function(req, res) {
    let ID = req.body.ID || null;
    let inventoryCheckType = req.body.inventoryCheckType || null;
    let keycodesToCheck = req.body.keycodesToCheck || null;
    let hoursToComplete = req.body.hoursToComplete || null;

    let sql, args, results;


    sql = `UPDATE store_backfill_schedule SET
    InventoryCheckType = ?, keycodesToCheck = ?, hoursToComplete = ?
    WHERE ID = ?`;

    args = [inventoryCheckType, keycodesToCheck, hoursToComplete, ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_check:", {error});
        res.status(500).json({"message": `Unable to update the RFID Exceptions`});
        return;
    }

    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to update the RFID Exceptions`});
        return;
    }

    res.status(200).json({"message": `RFID Exceptions Updated`});

};

exports.delete_backfill_schedule = async function(req, res) {
    let ID = req.query.ID || null;
    let sql, args, results, message;

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    // Check if all stock takes have been deleted

    sql = `SELECT * from inventory_take_schedule WHERE BackfillScheduleID = ?;`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the backfill schedule`});
        return;
    }

    if (results.length) {
        res.status(400).json({"message": "All Inventory Stock Takes must be deleted before deleting schedule"});
        return;
    }

    sql = `DELETE from store_backfill_schedule WHERE ID = ?`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the backfill schedule`});
        return;
    }
    // If there are no affected rows, that means we didn't update anything
    if (!results.affectedRows) {
        logger.info("No rows updated");
        res.status(404).json({"message": `Unable to delete the backfill schedule`});
        return;
    }

    message = `Backfill Replenishment Schedule deleted.`;

    res.json({"message": message });
};

async function _update_backfill_schedule(ID) {
    let results, sql, args;
    sql = `SELECT * FROM inventory_take_schedule WHERE BackfillScheduleID = ?`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("_update_backfill_schedule:", {error});
        throw error;
    }

    let maxhour = 0;
    let maxmin = 0;

    for (let take of results) {
        let hour = +take.Hour;
        let min = +take.Minute;
        let add = +take.MinsToComplete;
        let addhours = Math.floor(add / 60);
        hour += + addhours;
        min += (add - (addhours * 60));
        if (min >= 60) {
            // handle min overflow
            min = min - 60;
            hour = hour + 1;
        }
        if (hour >= maxhour) {
            if (hour > maxhour) {
                maxmin = min;
            } else if (min > maxmin) {
                maxmin = min;
            }
            maxhour = hour;
        }

    }

    sql = `UPDATE store_backfill_schedule SET
    Hour = ?, Minute = ?
    WHERE ID = ?`;

    args = [maxhour, maxmin, ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("_update_backfill_schedule:", {error});
        throw error;
    }
}

exports.get_inventory_take_schedule = async function(req, res) {
    let backfillScheduleId = req.query.BackFillScheduleID || null;
    let sql, args, results;

    if (!backfillScheduleId) {
        res.status(400).json({"message": "backfillScheduleId is required"});
        return;
    }

    sql = `SELECT * FROM inventory_take_schedule WHERE BackFillScheduleID = ?`;
    args = [backfillScheduleId];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to get the inventory take schedule for backfill schedule: ${backfillScheduleId}`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.add_inventory_take_schedule = async function(req, res) {
    let backfillScheduleId = req.body.BackFillScheduleID || null;
    let type = req.body.Type || "InventoryBot";
    let inventoryBotID = req.body.InventoryBotID || null;
    let inventoryBotArea = req.body.InventoryBotArea || null;
    let hour = req.body.Hour;
    let minute = req.body.Minute;
    let minsToComplete = req.body.minsToComplete;
    let containerID = req.body.ContainerID || null;
    let sql, args, results, containerResults, backfillScheduleResults;
    let insertResults, inventoryTaskResults;

    if (!backfillScheduleId || !(hour >= 0) || !(minute >= 0) || !containerID) {
        res.status(400).json({"message": "BackfillScheduleId, hour, minute, containerID are required"});
        return;
    }

    // Validate Container
    sql = `
        SELECT LocationID FROM container WHERE ID = ?
        ;
        SELECT LocationID FROM store_backfill_schedule WHERE ID = ?`;
    args = [containerID, backfillScheduleId];

    try {
        [results] = await pool.query(sql, args);
        containerResults = results[0];
        backfillScheduleResults = results[1];
    } catch (error) {
        logger.error("add_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to add inventory take schedule.`});
        return;
    }

    if (!containerResults.length) {
        res.status(400).json({"message": `Container Does not Exist.`});
        return;
    }

    // If this is an Invnetory Bot take, we won't set ContainerID as it will be retrieved from inventory_bot_area
    if (type === "InventoryBot") {
        containerID = null;
    } else {
        // If the type is not InventoryBot, make sure the container provided is in the same location as the backfill schedule
        const containerLocation = containerResults[0].LocationID;
        const backfillScheduleLocation = backfillScheduleResults[0].LocationID;

        if (containerLocation !== backfillScheduleLocation) {
            res.status(400).json({"message": `Container ${containerID} is not in the same Location as the Backfill Schedule.`});
            return;
        }
    }

    sql = `INSERT INTO inventory_take_schedule (BackfillScheduleID, Type, InventoryBotID, InventoryBotArea, Hour, Minute, ContainerID, MinsToComplete) VALUES (?);`;
    args = [[backfillScheduleId, type, inventoryBotID, inventoryBotArea, hour, minute, containerID, minsToComplete]];

    try {
        [results] = await pool.query(sql, args);

    } catch (error) {
        logger.error("add_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to add inventory take schedule.`});
        return;
    }

    if (!results.affectedRows) {
        res.status(404).json({"message": `Unable to add inventory take schedule.`});
        return;
    }

    try {
        await _update_backfill_schedule(backfillScheduleId);
    } catch (error) {
        logger.error("add_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to update the Inventory Schedule`});
        return;
    }



    if (type === inventoryBotScheduleType) {
        try {
            await inventoryBotHelpers.syncInventoryBotSchedule(req, inventoryBotID, inventoryBotArea);
        } catch (error) {
            logger.error("add_inventory_take_schedule:", {error});
            res.status(500).json({"message": `Unable to add inventory take schedule.`});
            return;
        }
    }

    res.json({"message": `Backfill Replenishment Schedule added.` });
};

exports.update_inventory_take_schedule = async function(req, res) {
    let ID = req.body.ID || null;
    let type = req.body.Type || "InventoryBot";
    let inventoryBotID = req.body.InventoryBotID || null;
    let inventoryBotArea = req.body.InventoryBotArea || null;
    let hour = req.body.Hour;
    let minute = req.body.Minute;
    let containerID = req.body.ContainerID || null;
    let minsToComplete = req.body.minsToComplete;

    let sql, args, results, containerResults, backfillScheduleResults, selectResults, updateResults;

    if (!ID || !(hour >= 0) || !(minute >= 0)  || !containerID) {
        res.status(400).json({"message": "ID, hour, minute, containerID are required"});
        return;
    }

    // Validate Container
    sql = `
        SELECT LocationID FROM container WHERE ID = ?
        ;
        SELECT sbs.LocationID
        FROM store_backfill_schedule sbs
        INNER JOIN inventory_take_schedule its ON sbs.ID = its.BackfillScheduleID
        WHERE its.ID = ?`;
    args = [containerID, ID];

    try {
        [results] = await pool.query(sql, args);
        containerResults = results[0];
        backfillScheduleResults = results[1];
    } catch (error) {
        logger.error("add_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to add inventory take schedule.`});
        return;
    }

    if (!containerResults.length) {
        res.status(400).json({"message": `Container Does not Exist.`});
        return;
    }

    // If this is an Invnetory Bot take, we won't set ContainerID as it will be retrieved from inventory_bot_area
    if (type === "InventoryBot") {
        containerID = null;
    } else {
        // If the type is not InventoryBot, make sure the container provided is in the same location as the backfill schedule
        const containerLocation = containerResults[0].LocationID;
        const backfillScheduleLocation = backfillScheduleResults[0].LocationID;

        if (containerLocation !== backfillScheduleLocation) {
            res.status(400).json({"message": `Container ${containerID} is not in the same Location as the Backfill Schedule.`});
            return;
        }
    }

    sql = `
        SELECT BackfillScheduleID, Type, InventoryBotID, InventoryBotArea FROM inventory_take_schedule WHERE ID = ?
        ;
        UPDATE inventory_take_schedule SET
            Type = ?,
            Hour = ?,
            Minute = ?,
            ContainerID = ?,
            InventoryBotID = ?,
            InventoryBotArea = ?,
            MinsToComplete = ?
            WHERE ID = ?
        ;`;
    args = [ID, type, hour, minute, containerID, inventoryBotID, inventoryBotArea, minsToComplete, ID];


    try {
        [results] = await pool.query(sql, args);
        selectResults = results[0];
        updateResults = results[1];
    } catch (error) {
        logger.error("update_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to update the inventory take schedule for ID: ${ID}`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!updateResults.affectedRows) {
        res.status(404).json({"message": `Unable to update the inventory take schedule for ID: ${ID}`});
        return;
    }

    try {
        await _update_backfill_schedule(selectResults[0].BackfillScheduleID);
    } catch (error) {
        logger.error("update_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to update the Inventory Schedule`});
        return;
    }

    let oldType = selectResults[0].Type;
    let oldInventoryBotID = selectResults[0].InventoryBotID;
    let oldInventoryBotArea = selectResults[0].InventoryBotArea;

    try {
        // Update old bot and area is the old Type was InventoryBot
        if (oldType === inventoryBotScheduleType) {
            await inventoryBotHelpers.syncInventoryBotSchedule(req, oldInventoryBotID, oldInventoryBotArea);
        }

        // If the new type is InventoryBot and the botID or Area has changed, update new bot
        if (type === inventoryBotScheduleType) {
            await inventoryBotHelpers.syncInventoryBotSchedule(req, inventoryBotID, inventoryBotArea);
        }
    } catch (error) {
        logger.error("update_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to update the inventory take schedule for ID: ${ID}`});
        return;
    }

    res.json({"message": `Inventory take Schedule updated for ID: ${ID}.`});
};

exports.delete_inventory_take_schedule = async function(req, res) {
    let ID = req.query.ID || null;
    let sql, args, results, selectResults, deleteResults;

    if (!ID) {
        res.status(400).json({"message": "ID is required"});
        return;
    }

    sql = `
    SELECT * FROM inventory_take_schedule WHERE ID = ?
    ;
    DELETE FROM inventory_take_schedule WHERE ID = ?`;
    args = [ID, ID];

    try {
        [results] = await pool.query(sql, args);
        selectResults = results[0];
        deleteResults = results[1];
    } catch (error) {
        logger.error("delete_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to delete the inventory take schedule for ID :${ID}`});
        return;
    }

    // If there are no affected rows, that means we didn't update anything
    if (!deleteResults.affectedRows) {
        logger.info("No rows updated");
        res.status(404).json({"message": `Unable to delete the inventory take schedule for ID ${ID}`});
        return;
    }

    // If the delete had affected rows, we also selected the row
    selectResults = selectResults[0];

    try {
        await _update_backfill_schedule(selectResults.BackfillScheduleID);
    } catch (error) {
        logger.error("add_inventory_take_schedule:", {error});
        res.status(500).json({"message": `Unable to update the Inventory Schedule`});
        return;
    }

    let scheduleType = selectResults.Type;

    if (scheduleType === inventoryBotScheduleType) {
        let inventoryBotID = selectResults.InventoryBotID;
        let inventoryBotArea = selectResults.InventoryBotArea;
        try {
            await inventoryBotHelpers.syncInventoryBotSchedule(req, inventoryBotID, inventoryBotArea);
        } catch (error) {
            logger.error("delete_inventory_take_schedule:", {error});
            res.status(500).json({"message": `Unable to delete the inventory take schedule for ID :${ID}`});
            return;
        }
    }

    res.json({"message": `Inventory take Schedule deleted for ID: ${ID}.`});
};

exports.backfill_update_count_task = async function(req, res) {
    let taskID     = req.body.taskID || null;
    let products   = req.body.products || null;
    let process    = req.body.process || "-";
    let productMap = {};
    let locationID, containerID, sql, args, results, body;

    if (!taskID || !products) {
        res.status(400).json({"message": "You must provide a taskID, and products"});
        return;
    }

    if (!Array.isArray(products)) {
        res.status(400).json({"message": "The products must be an array of barcodes"});
        return;
    }

    args = [taskID];
    sql = `
        SELECT SourceContainer, TargetContainer
        FROM task
        WHERE ID = ? AND Type = 'BackfillCount'`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("backfill_update_count_task:", {error});
        res.status(500).json({"message": "There was an error updating the backfill count task, please contact your system administrator"});
        return;
    }

    if (results.length === 0) {
        res.status(400).json({"message": "That task was not found"});
        return;
    }

    locationID  = results[0]["SourceContainer"];
    containerID = results[0]["TargetContainer"];

    for (let product of products) {
        if (product in productMap) {
            productMap[product]++;
        } else {
            productMap[product] = 1;
        }
    }

    try {
        body = {
            container: containerID,
            task_id: taskID,
            process: process
        };

        results = await apiRequest.delete(req, "delete_inventory_bulk", body);
    } catch (error) {
        logger.error("backfill_update_count_task:", {error});
        res.status(500).json({"message": "There was an error updating the backfill count task, please contact your system administrator"});
        return;
    }

    for (let product in productMap) {
        body = {
            // "keycode": keycode,
            barcode: product,
            container: containerID,
            quantity: productMap[product],
            process: process
        };

        try {
            await apiRequest.post(req, "create_inventory", body);
        } catch (error) {
            logger.error("backfill_update_count_task:", {error});
            res.status(500).json({"message": "There was an error updating the backfill count task, please contact your system administrator"});
            return;
        }
    }

    // Complete the task
    body = {
        task_id: taskID,
        process: process
    };

    try {
        await apiRequest.put(req, "task/complete", body);
    } catch (error) {
        logger.error("backfill_update_count_task:", {error});
        res.status(500).json({"message": "There was an error updating the backfill count task, please contact your system administrator"});
        return;
    }

    // Send the response to the client now since the possibility of generating backfill replenishment isn't something the user cares about at this time
    res.status(200).json({"message": `${products.length} products from the RFID scan have been recorded`});

    // Check to see if we have just completed the last stock take for this location. If this is true, then we can call the backfill generate right away
    args = [locationID];
    sql = `
        SELECT COUNT(*) PendingJobs
        FROM task_group
        WHERE
            Type = 'BackfillCount'
            AND DateCompleted IS NULL
            AND SourceLocation = ?`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("backfill_update_count_task:", {error});
        res.status(500).json({"message": "There was an error updating the backfill count task, please contact your system administrator"});
        return;
    }

    if (results[0]["PendingJobs"] === 0) {
        try {
            await apiRequest.post(req, "generate_backfill_replenishment");
        } catch (error) {
            logger.error("backfill_update_count_task:", {error});
        }
    }
};

exports.generate_backfill_replenishment = async function(req, res) {
    /* This API...
     * 1. Will normally be called from a Lambda function that is set to run on minutes 1, 16,31, and 46 of each hour
     * 2. May also be called manually from the UI if we want to generate backfill replenishment past the due date
     * 3. Will only focus on generating the tasks, while the Lambda calculates which location should have backfill replenishments generated
     */
    let ID = req.body.storeBackfillScheduleID || null;
    let resBackfill;       // Results for the stored procedure: replenish_order_generate_backfill()
    let createdTaskGroups; // How many task groups have been created
    let currentQuantityCount = 0;
    let previousCartType = null;
    let previousPriority = null;
    let previousSourceContainer = null;
    let previousLocationID = null;
    let previousSecondaryColour = null;
    let previousStyleID = null;
    let taskCollection = []; // Holds arrays of TaskIDs in order to keep track of which Task should be assigned to which Task Group
    let taskTemp = [];       // Holds a group of tasks that will be added to taskCollection the next time any one of these change: locationId, cartType
    let taskMap = {};        // Keeps track of how many products still need to be allocated for a certain store
    let sql, args, results, locationID;
    let BackfillTaskDeleteInterval = 12; // Interval in HOUR, Allow to create new backfill type task and update the task older than (now() - INTERVAL BackfillTaskDeleteInterval HOUR)

    if (!ID) {
        res.status(400).json({"message": "storeBackfillScheduleID is required"});
        return;
    }

    // Get the Task_group that are still open with type = 'Backfill' and ReferenceID = storeBackfillScheduleID and older than BackfillTaskDeleteInterval Hour.
    // If any task group exits we will not create new task and return the response with status 200.
    sql = `SELECT * FROM task_group
            WHERE ReferenceID = ?
            AND Type = 'Backfill'
            AND DateCreated >= NOW() - INTERVAL ? HOUR`;

    args = [ID, BackfillTaskDeleteInterval];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("generate_backfill_replenishment (SELECT TASK_GROUP):", {error});
        res.status(500).json({"message": `Unable to select task group existed for store backfill schedule ID`});
        return;
    }

    if (results.length > 0) {
        let message = `Backfill Task Exists for Store Backfill Schedule ID: ${ID}, Not creating new backfill task`;
        console.debug(message);
        res.status(200).json({"message": message});
        return;
    }

    // Calculate the default due date
    let now = moment().utc();                         // Get the current time...
    now.add(1, "hours").startOf("hour").format("H");  // ...round to next hour...
    now.add(settings.dueDate.offsetDefault, "hours"); // ...add the default offset...
    let defaultDueDate = now.format();                // ...format it

    // Calculate the due dates for schedule
    let calcnow = moment().utc(); // Get Current time
    let minutesToAdd = 60 * settings.dueDate.offsetBackfill; // Calculate the Backfill Offset
    calcnow.add(minutesToAdd, "minutes").add(1, "hours").startOf("hour"); // Add the offsett and round to next of hour
    let backfillHour = calcnow.format("H"); // Get Hour
    let dueDates = {};

    // Complete the task and task_group before creating the new one for given backfillScheduleID
    // Create a new stored procedure that takes in location and only gives out data related to that single location
    sql = `CALL ${config.sql_database_for_sp}.replenish_order_generate_backfill(?)`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
        logger.info("TASK COMPLETED:", {tasksUpdated: results[0][0].tasksUpdated});
        logger.info("TASK GROUP COMPLETED:", {taskGroupsCompleted: results[0][0].taskGroupsCompleted});
        resBackfill = results[1];

        if (resBackfill.length === 0) {
            let message = `There were no tasks to create for Store Backfill Schedule ID: ${ID}`;
            console.debug(message);
            res.status(200).json({"message": message});
            return;
        }

        locationID = resBackfill[0].LocationID;
        console.debug(`Created: ${resBackfill.length} new tasks for location ${locationID}`);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `Unable to select tasks that will be created for backfill replenishment generation`});
        return;
    }

    sql = `INSERT INTO task (Keycode, Quantity, SourceContainer, SecondarySort, Type, ReferenceID) VALUES ?`;
    args = [];

    /* The results returned from replenish_order_generate_backfill are ordered by the Store's Keycode and then ContainerID
     * The LocationID will be the same across all rows because the stored procedure accepts a store_backfill_schedule ID,
     * and the data shared between a backfill schedule ID will always be contained to the same store
     * Example:
     *
     * LocationID | SourceContainer | Keycode  | SecondarySort                                  | StockBOH | StockWanted
     * TST1-STR   | TST1-BOH-A1     | 27115060 | WMS FOOTWEAR DISCONTINUED K/DS                 | 5        | 1
     * TST1-STR   | TST1-BOH-A1     | 27115077 | WMS FOOTWEAR DISCONTINUED K/DS                 | 5        | 1
     * TST1-STR   | TST1-BOH-A1     | 27115084 | WMS FOOTWEAR DISCONTINUED K/DS                 | 10       | 1
     * TST1-STR   | TST1-BOH-A1     | 27115091 | WMS FOOTWEAR DISCONTINUED K/DS                 | 10       | 2
     * TST1-STR   | TST1-BOH-A2     | 41100837 | JWLRY/WATCH/SGLASS JEWELLERY EARRING           | 5        | 1
     * TST1-STR   | TST1-BOH-A2     | 41200674 | WMS HOSIERY/SOCKS PANTYHOSE SUPPORT AND SHAPIN | 5        | 2
     * TST1-STR   | TST1-BOH-A2     | 41300350 | HANDBAGS & ACC HANDBAGS CROSSBODY              | 5        | 2
     * TST1-STR   | TST1-BOH-A2     | 41400340 | RECREATION & BIKES TEAM SPORTS INDOOR SPORTS   | 5        | 2
     * TST1-STR   | TST1-BOH-A2     | 41600399 | PERSONAL CARE HAIR ACCESSORIES BRUSHES         | 5        | 2
     */

    for (let row of resBackfill) {
        let locationId      = row["LocationID"];
        let sourceContainer = row["SourceContainer"];
        let keycode         = row["Keycode"];
        let stockBOH        = row["StockBOH"];
        let stockWanted     = row["StockWanted"];
        let secondarySort   = row["SecondarySort"];
        let referenceID     = row["ReferenceID"];
        let quantity;

        // Store the store's location ID if it doesn't exist yet
        if (!(locationId in taskMap)) {
            taskMap[locationId] = {};
        }

        // Retrieve the current amount of stock wanted if was saved from earlier
        if (keycode in taskMap[locationId]) {
            stockWanted = taskMap[locationId][keycode];
        } else {
            // Store the initial "Stock Wanted" for the current keycode if it hasn't been recorded yet
            taskMap[locationId][keycode] = stockWanted;
        }

        // Continue on since we don't need any more of this product
        if (stockWanted === 0) {
            continue;
        }

        // If there's LESS stock than what's wanted in the current container...
        if (stockBOH < stockWanted) {
            quantity = stockBOH; // We can only take what exists
        } else {
            quantity = stockWanted; // We can safely take all that's wanted
        }

        // Update the amount of stock that we want for this particular keycode in this store
        taskMap[locationId][keycode] = stockWanted - quantity;

        args.push([
            keycode,
            quantity,
            sourceContainer,
            secondarySort,
            "Backfill",
            referenceID              // ID of store_inventory_snapshot AS ReferenceID
        ]);
    }

    if (!args.length) {
        res.status(200).json({"message": `No backfill tasks to create for location ${locationID}`});
        return;
    }

    // Create the tasks
    try {
        [results] = await pool.query(sql, [args]);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `Unable to generate tasks for backfill replenishment`});
        return;
    }

    /* Now that the tasks have been created, we need to SELECT them in a very specific order such that they can be correctly grouped
     * 1. LocationID     : The store's ID is the highest level of sorting
     * 2. SourceContainer: This will be which BOH container the task is in the store (BOH-1, BOH-2, etc)
     * 3. Department_Name: The specific section of the BOH container, and also important to make sure Apparel/TableLines is correctly sorted
     * 4. RangeActual    : Used with Fixture_Code below
     * 5. Fixture_Code   : Used with RangeActual in order to seperate task groups on if they are "Apparel" or "TableLines"
     */
    let insertID = results["insertId"];
    let tasksInserted = results["affectedRows"];
    let lastInsertID = insertID + tasksInserted;
    args = [insertID, lastInsertID, insertID, lastInsertID];
    sql = `
        SELECT
            t.ID,
            t.Keycode,
            t.Quantity,
            # Fixture_Code MUST be R respectively for the cart's type to be Apparel. Otherwise it's TableLines
            IF(pa.Fixture_Code = 'R', 'Apparel', 'TableLines') AS CartType,
            c.LocationID,
            t.SourceContainer,
            # Fasttrack is there is 0 FoH inventory, otherwise Standard Priority
            IF((otherSizes.Style_ID IS NOT NULL AND otherSizes.minStockFOH = 0) OR IFNULL(inv.StockFOH, 0) = 0, 'Fasttrack', 'Standard') AS Priority,
            p.Style_ID,
            p.Secondary_Colour
        FROM task t
        INNER JOIN container c ON c.ID = t.SourceContainer
        INNER JOIN product p ON p.Keycode = t.Keycode
        LEFT JOIN product_attr pa on pa.Keycode = p.Keycode
        LEFT JOIN (
            SELECT c.LocationID, Keycode, COUNT(*) AS StockFOH
            FROM inventory i
            INNER JOIN container c ON c.ID = i.ContainerID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            WHERE ct.BackfillEnabled = 1 AND ct.isFoH = 1 AND TaskID IS NULL
            GROUP BY c.LocationID, Keycode
        ) AS inv ON inv.LocationID = c.LocationID AND inv.Keycode = t.Keycode
        # If any task is created where store's inventory is 0, all tasks with the same Secondary_Colour and Style_ID will have Fasttrack priority
        # In otherwords, if task for one size of an apparal product is Fasttrack, all other sizes are fasttrack
        LEFT JOIN (
            SELECT
                p.Style_ID,
                p.Secondary_Colour,
                MIN(IFNULL(inv.StockFOH, 0)) AS minStockFOH
            FROM task t
            INNER JOIN container c ON c.ID = t.SourceContainer
            INNER JOIN product p ON t.Keycode = p.Keycode
            LEFT JOIN (
                SELECT c.LocationID, Keycode, COUNT(*) AS StockFOH
                FROM inventory i
                INNER JOIN container c ON c.ID = i.ContainerID
                INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
                WHERE ct.BackfillEnabled = 1 AND ct.isFoH = 1 AND TaskID IS NULL
                GROUP BY c.LocationID, Keycode
            ) AS inv ON inv.LocationID = c.LocationID AND inv.Keycode = t.Keycode
            WHERE
                p.Style_ID IS NOT NULL
                AND p.Style_ID != 0
                AND t.ID >= ?
                AND t.ID < ?
            GROUP BY p.Style_ID, p.Secondary_Colour
        ) AS otherSizes ON p.Style_ID = otherSizes.Style_ID AND p.Secondary_Colour = otherSizes.Secondary_Colour
        WHERE # Only retrieve the rows that are within the specified range which were just INSERTed
            t.ID >= ?
            AND t.ID < ?
        ORDER BY
            c.LocationID DESC,
            t.SourceContainer ASC,
            Priority ASC,
            CartType DESC,
            t.SecondarySort DESC,
            p.Style_ID DESC,
            p.Secondary_Colour DESC,
            t.Keycode DESC`;

    try {
        [resBackfill] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Unable to generate tasks for backfill replenishment"});
        return;
    }

    // Now that we have that results of the task backfill, the task groups can be created
    sql = `INSERT INTO task_group (SourceLocation, TargetLocation, DateDue, Priority, Type, CartType, ReferenceID) VALUES ?`;
    args = [];

    // Go through all of the tasks that have just been INSERTed via the stored procedure: replenish_order_generate_backfill()
    for (let task of resBackfill) {
        let id              = task["ID"];
        let locationId      = task["LocationID"];
        let sourceContainer = task["SourceContainer"];
        let cartType        = task["CartType"];
        let quantity        = task["Quantity"];
        let priority        = task["Priority"];
        let styleID         = task["Style_ID"];
        let secondaryColour = task["Secondary_Colour"];

        // Create a new task group if the total quantity is over the unit threshold
        // If the styleID and secondaryColour are the same (keycode is different size of same product), ignore the unit threshold and stay in the same task group
        let isOverUnitThreshold = currentQuantityCount >= settings.task.groupSizeBackfill && (styleID !== previousStyleID || secondaryColour !== previousSecondaryColour);

        // Create a new task group if the sourceContainer, department name, cart type, or priority changes
        // These properties have been ORDER BY'ed in the stored procedure to prevent it from "jumping around"
        if (locationId !== previousLocationID || sourceContainer !== previousSourceContainer || cartType !== previousCartType || priority !== previousPriority || isOverUnitThreshold) {
            previousLocationID = locationId;
            previousSourceContainer = sourceContainer;
            previousCartType = cartType;
            previousPriority = priority;

            currentQuantityCount = quantity;
            args.push([
                locationId, // SourceLocation
                locationId, // TargetLocation
                dueDates[locationId] ? dueDates[locationId] : defaultDueDate, // DateDue
                priority,   // Priority
                "Backfill", // Type
                cartType,   // CartType
                ID          // ID of store_backfill_schedule AS ReferenceID
            ]);

            // This will skip the first run of this loop when taskTemp is empty
            if (taskTemp.length) {
                taskCollection.push(taskTemp);
                taskTemp = []; // Empty the temporary array to record task IDs for the next task group
            }
        } else {
            currentQuantityCount += quantity;
            // Set previous for styleID and secondaryColour here or the logic for ignoring max task_group size doesn't work
            previousStyleID = styleID;
            previousSecondaryColour = secondaryColour;
        }

        taskTemp.push(id);
    }

    taskCollection.push(taskTemp); // Push the final taskTemp into taskCollection
    let firstTaskGroupId;
    let currentTaskGroupId;

    // Create the task groups and get the first task group ID
    try {
        [results] = await pool.query(sql, [args]);
        createdTaskGroups = results["affectedRows"];
        firstTaskGroupId = results["insertId"];
        console.log(`Created: ${createdTaskGroups} new task groups`);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `Unable to cleanup tasks for generating backfill replenishment`});
        return;
    }

    // All that's left to do is update TaskGroupID in the task table with their respective values
    currentTaskGroupId = firstTaskGroupId;
    sql = "";
    args = [];

    for (let tasks of taskCollection) {
        sql += `UPDATE task SET TaskGroupID = ? WHERE ID IN ?;`;
        args.push(currentTaskGroupId++, [tasks]);
    }

    // Update the tasks with their respective Task Group IDs
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Unable to cleanup tasks for generating backfill replenishment"});
        return;
    }

    res.status(200).json({"message": `Backfill replenishment has generated ${createdTaskGroups} task groups and ${resBackfill.length} tasks`});
};

exports.update_store_inventory_snapshot = async function(req, res) {
    let keycode = req.body.keycode || null;
    let container = req.body.container || null;
    let physicalQuantity = parseInt(req.body.physicalQuantity);
    let referenceID = req.body.referenceID || null;
    let reason = req.body.reason || null;
    let customReason = req.body.customReason || null;
    let sql, args;

    if (!keycode || !container || !referenceID || isNaN(physicalQuantity)) {
        res.status(400).json({"message": "keycode, container, physicalQuantity, and referenceID are required"});
        return;
    }

    args = [physicalQuantity, reason, customReason, referenceID, container, keycode];
    sql = `
        UPDATE IGNORE store_inventory_snapshot
        # For now always setting QuantityAdjusted to the RFID Quantity
        SET QuantityCounted = ?,
            QuantityAdjusted = Quantity,
            AdjustmentReason = ?,
            AdjustmentReasonCustom = ?,
            DateCounted = NOW()
        WHERE
            BackfillScheduleID = ?
            AND ContainerID = ?
            AND Keycode = ?
            # The snapshot will not be completed and DateCompleted is part of the composite index
            AND DateCompleted IS NULL`;

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("update_store_inventory_snapshot", {error});
        res.status(500).json({"message": `Unable to record Inventory Count for keycode ${keycode}`});
        return;
    }

    const message = `Inventory Count of ${physicalQuantity} recorded for keycode ${keycode} in ${container}`;
    let response = {
        "message": message
    };
    res.status(200).json(response);
};

exports.get_debug_backfill_tasks = async function(req, res) {
    let locationID = req.query.locationID;
    let keycode = req.query.keycode;
    let sql, args, results;

    if (!locationID || !keycode) {
        res.status(400).json({"message": "locationID and keycode are required"});
        return;
    }

    sql = `
        SELECT
            t.Keycode,
            t.SourceContainer,
            sis.Quantity AS SourceContainerInventory,
            IFNULL(fohInventory.Quantity, 0) AS StoreInventory,
            calc_mdu(mdu.MDU, loc.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) as MDU,
            t.DateCreated AS DateTaskCreated,
            t.Quantity AS TaskQuantity,
            t.QuantityFilled,
            t.QuantityDelivered,
            t.DateCompleted,
            t.DateFulfilled
        FROM task t
        INNER JOIN container c ON t.SourceContainer = c.ID
        INNER JOIN location loc ON c.LocationID = loc.ID
        INNER JOIN store_inventory_snapshot sis ON t.ReferenceID = sis.ID
        LEFT JOIN product_attr pa ON pa.Keycode = t.Keycode
        # TEMP CHANGE TO AVOID TABLE CHANGES
        LEFT JOIN fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code
        AND f.LocationID = 'DEFAULT'
        # AND f.LocationID = loc.ID
        LEFT JOIN (
            SELECT
                sis.Keycode,
                sis.DateSnapshot,
                SUM(sis.Quantity) AS Quantity
            FROM store_inventory_snapshot sis
            INNER JOIN container c ON sis.ContainerID = c.ID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
            WHERE c.LocationID = ? AND sis.Keycode = ? AND ct.isFOH
            GROUP BY sis.Keycode, sis.DateSnapshot
        ) fohInventory ON sis.Keycode = fohInventory.Keycode AND sis.DateSnapshot = fohInventory.DateSnapshot
        LEFT JOIN product_mdu mdu ON t.Keycode = mdu.Keycode
        WHERE c.LocationID = ?  AND t.Keycode = ? AND t.Type = 'Backfill'
        ORDER BY t.DateCreated DESC`;
    args = [locationID, keycode, locationID, keycode];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_debug_backfill_tasks:", {error});
        res.status(500).json({"message": `Unable to get backfill debug tasks`});
        return;
    }

    if (results.length === 0) {
        res.status(400).json({"message": `No tasks for Keycode ${keycode} found`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.update_current_inventory_adjustment = async function(req, res) {
    let backfillScheduleID = req.body.BackfillScheduleID;
    // If true, stop current inventory adjustment, if false, resume current inventory adjustment
    let stopCurrentInventoryAdjustment = req.body.StopCurrentInventoryAdjustment || false;
    let sql, args, results;

    if (!backfillScheduleID) {
        res.status(400).json({"message": "backfillScheduleID is required"});
        return;
    }

    sql = `
        SELECT
            IF(sbs.InventoryCheckType = 'system', 1, 0) AS isSystemInventoryCheck,
            IFNULL(sis.hasActiveInventoryAdjustment, 0) AS hasActiveInventoryAdjustment,
            sbs.Name
        FROM store_backfill_schedule sbs
        LEFT JOIN (
            SELECT
                BackfillScheduleID,
                IF(COUNT(*) > 0, 1, 0) AS hasActiveInventoryAdjustment
            FROM store_inventory_snapshot
            WHERE BackfillScheduleID = ? AND DateCompleted IS NULL
        ) sis ON sbs.ID = sis.BackfillScheduleID
        WHERE sbs.ID = ?`;
    args = [backfillScheduleID, backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("get_debug_backfill_tasks:", {error});
        res.status(500).json({"message": `Unable to get backfill debug tasks`});
        return;
    }

    if (!results.length) {
        res.status(400).json({"message": `Store Backfill Schedule ${backfillScheduleID} does not exist`});
        return;
    }

    let isSystemInventoryCheck = results[0].isSystemInventoryCheck;
    let hasActiveInventoryAdjustment = results[0].hasActiveInventoryAdjustment;
    let backfillScheduleName = results[0].Name;

    if (!isSystemInventoryCheck) {
        res.status(400).json({"message": `Store Backfill Schedule ${backfillScheduleName} is not enabled for System Inventory Adjustment`});
        return;
    }

    if (!hasActiveInventoryAdjustment) {
        res.status(400).json({"message": `Store Backfill Schedule ${backfillScheduleName} does not have an active Inventory Adjustment`});
        return;
    }

    sql = `
        UPDATE store_backfill_schedule
        SET isCurrentAdjustmentCanceled = ?
        WHERE ID = ?`;
    args = [stopCurrentInventoryAdjustment, backfillScheduleID];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("get_debug_backfill_tasks:", {error});
        res.status(500).json({"message": `Unable to get backfill debug tasks`});
        return;
    }

    let message;
    if (stopCurrentInventoryAdjustment) {
        message = `Paused current Inventory Adjustment for Schedule ${backfillScheduleName}`;
    } else {
        message = `Resumed current Inventory Adjustment for Schedule ${backfillScheduleName}`;
    }

    let response = {
        "message": message
    };
    res.status(200).json(response);
};
