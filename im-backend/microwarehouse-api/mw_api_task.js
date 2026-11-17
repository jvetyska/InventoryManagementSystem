/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const apiRequest = require("../library/apiRequest");
const authHelper = require("../library/authHelper");
const moment = require("moment");
const logging = require("../library/logging");
const logger = require("../library/logger")("microwarehouse-api:mw_api_task");

exports.get_info = async function(req, res) {
    let result;
    let taskId = req.query.task_id;
    let args   = [taskId];
    let sql    = `
        SELECT Keycode, Quantity, QuantityFilled, SourceContainer, TargetContainer, isRestricted
        FROM task
        WHERE ID = ?`;

    try {
        [result] = await ro_pool.query(sql, args);

        if (result.length == 0) {
            res.status(404).json({"message": "Task ID not found"});
            return;
        }

        res.status(200).json({"data": result[0]});
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
    }
};

// Get next task. Mark taskgroup as complete when there are no more tasks. This is only to be used for pick tasks
exports.get_next = async function(req, res) {
    let taskgroupId = req.query.taskgroupId || null;
    let sql, args, results, resultsCase, user, currentTask, error_message, isManager, tasks, subtype, keycode, barcode;
    let sqlInventory = `t.Keycode = t1.Keycode`;
    let sqlInventoryCase = `(t.Barcode = t1.Barcode OR t.ProductID = t1.ProductID)`;
    let notFoundOrComplete = true;
    let isInventoryCheck = false;
    let sqlWildCard = null;
    let sqlFilter = "";

    if (!taskgroupId) {
        res.status(400).json({"message": "taskgroupId is required"});
        return;
    }

    // Check if User has claimed task
    user = authHelper.parseRole(req);
    if (user.isAdmin || user.isWmanager || user.isSmanager || user.roles.indexOf("w_troubleshoot") >= 0) {
        isManager = true; // User has elevated permission and is allowed to receive restricted tasks
    } else {
        isManager = false;
        sqlFilter += " AND t.isRestricted = 0";
    }

    // Does this change if User is Admin/Manager?
    sql = `
        UPDATE task_group
        SET AssignedUserID = ?, DateUserAssigned = NOW()
        WHERE ID = ?
        AND (
            (DateUserAssigned <= DATE_ADD(NOW(), INTERVAL -30 MINUTE) OR DateUserAssigned IS NULL)
            OR AssignedUserID = ?
        )`;
    args = [user.id, taskgroupId, user.id];

    // Factor this out later
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        error_message = `An error occured when trying to get the next task for batch ${taskgroupId}`;
        res.status(500).json({"message": error_message});
        return;
    }

    if (results.affectedRows == 0) {
        // Get User Name
        let userData = null;
        sql = `
            SELECT u.FirstName, u.LastName
            FROM task_group tg
            LEFT JOIN user u
            ON tg.AssignedUserID = u.ID
            WHERE tg.ID = ?`;
        args = [taskgroupId];

        try {
            [userData] = await ro_pool.query(sql, args);
        } catch (error) {
            console.log(error);
            error_message = `An error occured when trying to get the next task for batch ${taskgroupId}`;
            res.status(500).json({"message": error_message});
            return;
        }
        res.status(400).json({"message": `This Batch is already being worked on by ${userData[0].FirstName} ${userData[0].LastName}`, "isManager": isManager});
        return;
    }

    // Here is where the problem could start

    while (notFoundOrComplete) {
        try {
            // Perform both and we will decide which type it is based on the results
            [results] = await pool.query(`CALL ${config.sql_database_for_sp}.get_next(?);`, [taskgroupId]);
            [resultsCase] = await pool.query(`CALL ${config.sql_database_for_sp}.get_next_case(?);`, [taskgroupId]);
            console.log(results);

            // Set keycode and barcode if they exist in the results. Otherwise set them to null
            // Note that it's impossible for both of these to be a non-null value, because
            // regular items DO NOT have a Barcode, and cases DO NOT have a Keycode
            keycode = (results[0].length     ? results[0][0]["Keycode"]     : null);
            barcode = (resultsCase[0].length ? resultsCase[0][0]["Barcode"] : null);
            subtype = null;

            if (results[0].length && ["Inventory", "Reprice"].indexOf(results[0][0]["Type"]) > -1) {
                // An else-if condition to check if this is an inventory-checking task.
                // If this is an inventory-checking task, it will be noted in both
                // results[0] and resultsCase[0], but we'll just check results[0]
                results = results[0]; // Stored Procedure always returns an array
                isInventoryCheck = true;
            } else if (resultsCase[0].length && ["BackfillCount"].indexOf(resultsCase[0][0]["Type"]) > -1) {
                // BackfillCount tasks will only be generated in the stored procedure: get_next_case()
                results = resultsCase[0]; // Stored Procedure always returns an array
                isInventoryCheck = true;
            } else if (keycode) {
                results = results[0]; // Stored Procedure always returns an array
                subtype = "item"; // Record the subtype for later in case there's no inventory and we need to call no_more_items()
                results[0]["Subtype"] = subtype; // Set the subtype into the results for the frontend
                sqlWildCard = sqlInventory;
            } else if (barcode) {
                results = resultsCase[0]; // Stored Procedure always returns an array
                subtype = "case"; // Record the subtype for later in case there's no inventory and we need to call no_more_items()
                results[0]["Subtype"] = subtype; // Set the subtype into the results for the frontend
                sqlWildCard = sqlInventoryCase;
            }
        } catch (error) {
            logger.info("task/get_next ERROR: ", {error});
            res.status(500).json({"message": "Error occured while retrieving next task"});
            return;
        }

        // A defined subtype means that there are results
        if (subtype || isInventoryCheck) {
            currentTask = results[0];

            // Backfill tasks may have their results returned immediately
            if (currentTask.Type === "Backfill") {
                res.status(200).json({"data": results});
                notFoundOrComplete = false;
            } else if (currentTask.AvailableQuantity == 0 && !isInventoryCheck) {
                // There's no inventory at the location
                sql = `
                    SELECT
                        t.*,
                        sc.Type AS ContainerType,
                        tg.SourceLocation AS WrhLocation,
                        tc.Type AS LocationType,
                        tg.DateCompleted,
                        tg.Type AS tgType
                    FROM (
                        SELECT * FROM task WHERE ID = ?
                    ) AS t1
                    LEFT JOIN task t ON t.TaskGroupID = t1.TaskGroupID AND t.SourceContainer = t1.SourceContainer AND ${sqlWildCard}
                    LEFT JOIN container tc ON tc.ID = t.TargetContainer
                    LEFT JOIN container sc ON sc.ID = t.SourceContainer
                    INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
                    WHERE t.DateCompleted IS NULL
                    ${sqlFilter}`;
                args = [currentTask.ID];

                try {
                    [tasks] = await ro_pool.query(sql, args);
                } catch (error) {
                    res.status(400).json({"message": error});
                    return;
                }

                let task = tasks[0];
                let TaskData = {
                    TaskID: currentTask.ID,
                    SourceContainer: task["SourceContainer"],
                    TargetContainer: task["TargetContainer"],
                    ContainerType: task["ContainerType"],
                    WrhLocation: task["WrhLocation"],
                    Quantity: task["Quantity"],
                    QuantityFilled: parseInt(task["QuantityFilled"]) || 0,
                    LocationType: task["LocationType"],
                    RowID: task["RowID"],
                    Type: task["type"] || task["tgType"],
                    TaskGroupID: task.TaskGroupID,
                    ReferenceID: task.ReferenceID,
                    isBackup: task.isBackup,
                    taskCount: results.length,
                    dateCompleted: null,
                    isRestricted: task.isRestricted
                };

                // Depending on the task's subtype, we need to add certain properties to TaskData
                if (subtype == "item") {
                    TaskData["Keycode"] = task["Keycode"];
                    TaskData["ProductIDs"] = task["ProductIDs"];
                    await no_more_items(req, null, TaskData, 0, subtype); // System user is set because User did not call no more items
                } else { // case
                    // Eventually we will no longer use ProductID, but for now we need to accept either Barcode or ProductID; whichever one it has
                    if ("Barcode" in task) {
                        TaskData["ProductID"] = task["Barcode"]; // ProductID must be set for handling this however
                    } else if ("ProductID" in task) {
                        TaskData["ProductID"] = task["ProductID"];
                    }
                    await no_more_items(req, null, TaskData, 0, subtype); // System user is set because User did not call no more items
                }
            } else {
                res.status(200).json({"data": results});
                notFoundOrComplete = false;
            }
        } else {
            // Subtype was null, so that means there are no results
            // Set DateCompleted of the task_group to the current time if there are no more results/tasks
            let dateCompleted = moment.utc().format();
            notFoundOrComplete = false;
            sql  = `UPDATE task_group SET DateCompleted = ? WHERE ID = ? AND DateCompleted IS NULL`;
            args = [dateCompleted, taskgroupId];

            try {
                [results] = await pool.query(sql, args);
                error_message = `No more tasks are available for taskgroup: ${taskgroupId}`;
                res.status(404).json({"message": error_message});
            } catch (error) {
                error_message = `No more tasks are available for taskgroup: ${taskgroupId}, but couldn't update taskgroup`;
                res.status(400).json({"message": error_message});
            }
        }
    }
};

exports.get_backfill_requirements = async function(req, res) {
    let locationID = req.query.LocationID || null;
    let sql, args, results;

    if (!locationID) {
        res.status(400).json({"message": "LocationID, Hour, and Day are required"});
        return;
    }

    sql = `
        SELECT
            br.LocationID,
            # Scheduled time for Inventory Take
            its.Hour AS takeHour,
            its.Minute AS takeMinute,
            br.Name,
            br.ID as scheduleID,
            # Scheduled time for Backfilling
            br.Hour AS BackfillHour,
            br.Minute AS BackfillMinute,
            its.Type AS TakeType,
            IFNULL(iba.ContainerID, its.ContainerID) AS ContainerID,
            ib.Name AS InventoryBotName,
            its.InventoryBotArea,
            t.ID as taskID,
            t.TaskGroupID,
            t.DateCompleted,
            tg.AssignedUserID,
            bh.status
        FROM (
            SELECT
                sbs.ID,
                sbs.Name,
                sbs.LocationID,
                sbs.Hour,
                sbs.Minute,
                loc.Timezone
            FROM store_backfill_schedule sbs
            INNER JOIN location loc ON loc.ID = sbs.LocationID
            INNER JOIN inventory_take_schedule its ON its.BackfillScheduleID = sbs.ID
            WHERE LocationID = ?
            AND checkdate(loc.Timezone, Sun, Mon, Tue, Wed, Thu, Fri, Sat) = TRUE
            AND sbs.IsEnabled = TRUE
            # HourAndMin is a function that checks if the provided time is GREATER/LESS than the current time
            AND HourAndMin(loc.timezone, sbs.Hour, sbs.Minute, 'GREATER')
            AND HourAndMin(loc.timezone, its.Hour, its.Minute, 'LESS')
            GROUP BY sbs.ID
            ORDER BY sbs.Hour ASC, sbs.Minute ASC
        ) AS br # Backfill Run
        INNER JOIN inventory_take_schedule its ON its.BackfillScheduleID = br.ID
        # Only Inventory Take tasks that are a part of this will be sent to the UI
        LEFT JOIN task t ON t.ReferenceID = its.ID AND t.type = 'BackfillCount'
        LEFT JOIN task_group tg ON tg.ID = t.TaskGroupID
        LEFT JOIN inventory_bot ib ON its.InventoryBotID = ib.ID
        LEFT JOIN inventory_bot_area iba ON its.InventoryBotArea = iba.Area AND its.InventoryBotID = iba.InventoryBotID
        LEFT JOIN bot_process_history bh ON its.ID = bh.InventoryTakeScheduleID
        AND DATE(CONVERT_TZ(NOW(), 'UTC', br.Timezone)) = DATE(CONVERT_TZ(bh.DateUpdated, 'UTC', br.Timezone));`;
    args = [locationID];

    try {
        [results] = await ro_pool.query(sql, args);

    } catch (error) {
        logger.error("get_backfill_schedule:", {error});
        res.status(500).json({"message": `Unable to get the backfill requirements for location: ${locationID}`});
        return;
    }

    let data = [];

    let currSchedule = 0;
    let currHour = 0;
    let currMin = 0;
    let currName = "";
    let curr = [];

    for (let result of results) {
        if (result.scheduleID != currSchedule) {
            if (curr.length) {
                data.push({
                    hour: currHour,
                    minute: currMin,
                    name: currName,
                    inventorytasks: curr
                });
            }
            currSchedule = result.scheduleID;
            currHour = result.BackfillHour;
            currMin = result.BackfillMinute;
            currName = result.Name;
            curr = [result];
        } else {
            curr.push(result);
        }
    }
    if (curr.length) {
        data.push({
            hour: currHour,
            minute: currMin,
            name: currName,
            inventorytasks: curr
        });
    }

    res.status(200).json({"data": data});
};

exports.task_create = async function(req, res) {
    var type = req.body.type;
    var barcode = req.body.barcode;
    var quantity = req.body.quantity || 1;
    var taskgroup_id = req.body.taskgroup_id || null;
    var source_container = req.body.source_container || null;
    var target_container = req.body.target_container || null;
    var is_restricted  = req.body.is_restricted || 0;

    let error_message, sql, args, results;

    if (type == null || type == "" || barcode == null || barcode == "") {
        error_message = "Type and barcode are required to create new task!";
        res.status(400).json({"message": error_message});
        return;
    }

    if (!source_container && !target_container) {
        error_message = "At least one container is required. Provide Source or Target container.";
        res.status(400).json({"message": error_message});
        return;
    }

    args = [taskgroup_id, quantity, source_container, target_container, type, is_restricted, barcode];
    sql  = `
        INSERT INTO task (TaskgroupID, Keycode, ProductID, Quantity, SourceContainer, TargetContainer, Type, isRestricted)
        SELECT
            Keycode,
            pb.Barcode AS ProductID,
            ? AS TaskgroupID,
            ? AS Quantity,
            ? AS SourceContainer,
            ? AS TargetContainer,
            ? AS Type,
            ? AS isRestricted
        FROM product p
        LEFT JOIN product_barcode pb ON pb.Keycode = p.Keycode
        WHERE pb.Barcode = ?`;

    try {
        [results] = await pool.query(sql, [args]);
        let task_id = results.insertId;
        if (task_id) {
            res.status(200).json({"message":`Task ${task_id} successfully created.`});
        } else {
            res.status(400).json({"message":`Task creation failed.`});
        }
    } catch (error) {
        logger.info("task_create ERROR: ", {error});
        res.status(400).json({"message": "Error occured. Task not created."});
    }
};

exports.skip_task = async function(req, res) {
    let task_id = parseInt(req.body.task_id) || null;

    if (task_id == null) {
        let error_message = "task_id is required!";
        res.status(400).json({"message": error_message});
        return;
    }

    let user = authHelper.parseRole(req);
    let args = [user.id, task_id];
    let sql  = `UPDATE task SET isSkipped = 1, AssignedUserID = ? WHERE ID = ? AND DateCompleted IS NULL`;
    let results, message;
    try {
        [results] = await pool.query(sql, args);
        if (results["affectedRows"] == 0) {
            message = `Task ${task_id} cannot be skipped or doesn't exist`;
        } else {
            message = `Task ${task_id} skipped.`;
        }
        res.status(200).json({"message": message});
    } catch (error) {
        logger.info("skip_task ERROR: ", {error});
        res.status(400).json({"message": "Error occurred while trying to skip a task."});
    }
};

// For individual item scan, update task progress
exports.update_task = async function(req, res) {
    let task_id = parseInt(req.query.task_id || req.body.task_id) || null;
    let quantity = parseInt(req.body.quantity || req.query.quantity) || 1;
    let source_container = req.query.source_container || req.body.source_container;
    let target_container = req.query.target_container || req.body.target_container;
    let process = req.query.process || req.body.process || "-";

    if (task_id == null) {
        var error_message = "task_id is required!";
        res.status(400).json({"message": error_message});
        return;
    }

    await _task_UpdateOrComplete(req, res, task_id, quantity, source_container, target_container, true, process);
};

// Execute API action based on the type and mark the task as complete.
exports.complete_task = async function(req, res) {
    let task_id = parseInt(req.query.task_id || req.body.task_id) || null;
    let quantity = req.query.quantity || req.body.quantity; //cannot parseInt here!
    let source_container = req.query.source_container || req.body.source_container;
    let target_container = req.query.target_container || req.body.target_container;
    let process = req.query.process || req.body.process || "-";
    let reason = req.query.reason || req.body.reason || null;
    let customReason = req.query.customReason || req.body.customReason || false;
    quantity = parseInt(quantity);

    if (task_id == null) {
        var error_message = "task_id is required!";
        res.status(400).json({"message": error_message});
        return;
    }

    await _task_UpdateOrComplete(req, res, task_id, quantity, source_container, target_container, false, process, reason, customReason);
};

async function _task_UpdateOrComplete(req, res, task_id, quantity, source_container, target_container, is_update, process, reason, customReason) {
    let sqlFilter = "", body, sql, args, results, result, error_message, message, status;
    // 1. get information about the task(s)
    // First, select the task in question
    // Second, select all duplicate tasks and task_group details.
    let user = authHelper.parseRole(req);
    if (user.isAdmin || user.isWmanager || user.isSmanager || user.roles.indexOf("w_troubleshoot") >= 0) {
        // User has elevated permission and is allowed to work on restricted tasks
    } else {
        sqlFilter += " AND t.isRestricted = 0";
    }

    // Get the subtype which will either be an "item" or "case". Currently this is only used in picking tasks
    let sql2 = `SELECT Keycode, Barcode, ProductID FROM task WHERE ID = ?`;
    let args2 = [task_id];
    let [results2] = await pool.query(sql2, args2);
    let subtype;
    if (results2.length) {
        let keycode = results2[0]["Keycode"];
        let barcode = results2[0]["Barcode"];
        let productId = results2[0]["ProductID"]; // productId can be removed once it's confirmed that no more ProductIds are being used
        if (keycode) {
            subtype = "item";
        } else if (barcode || productId) { // productId can be removed once it's confirmed that no more ProductIds are being used
            subtype = "case";
        }
    }

    // The IF(t1.Barcode IS NOT NULL, t.Barcode, t.ProductID) can be replaced
    // with "t.Barcode" once we ensure that ProductID is no longer used in the database
    sql = `
        SELECT t.*, sc.Type AS ContainerType, tc.Type AS LocationType, tg.SourceLocation AS WrhLocation, tg.DateCompleted, tg.Type AS tgType
        FROM (
            SELECT * FROM task WHERE ID = ?
        ) AS t1
        LEFT JOIN task t ON t.TaskGroupID = t1.TaskGroupID
        AND  (
            t.Type = 'BackfillCount'
            OR
            IF(t1.Keycode IS NOT NULL, t.Keycode, IF(t1.Barcode IS NOT NULL, t.Barcode, t.ProductID)) = IF(t1.Keycode IS NOT NULL, t1.Keycode, IF(t1.Barcode IS NOT NULL, t1.Barcode, t1.ProductID))
        )
        AND t.SourceContainer = t1.SourceContainer
        AND (t1.Type NOT IN ('Online') OR t1.TargetContainer = t.TargetContainer)
        LEFT JOIN container tc ON tc.ID = t.TargetContainer
        LEFT JOIN container sc ON sc.ID = t.SourceContainer
        INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
        WHERE t.DateCompleted IS NULL
        ${sqlFilter}`;
    args = [task_id];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        res.status(400).json({"message": error});
        return;
    }

    if (results.length == 0) {
        error_message = `Task: ${task_id} has already been completed or doesn't exist.`;
        res.status(400).json({"message": error_message});
        return;
    }

    // 2. Task exists and is not completed yet. Execute associated action based on Type.
    let task = results[0];
    let TaskData = {
        TaskID: task.ID,
        ProductID: task["Barcode"], // Case Barcodes
        Keycode: task["Keycode"],
        SourceContainer: source_container || task["SourceContainer"],
        TargetContainer: target_container || task["TargetContainer"],
        ContainerType: task["ContainerType"],
        WrhLocation: task["WrhLocation"],
        Quantity: task["Quantity"],
        QuantityFilled: parseInt(task["QuantityFilled"]) || 0,
        LocationType: task["LocationType"],
        RowID: task["RowID"],
        Type: task["type"] || task["tgType"],
        TaskGroupID: task.TaskGroupID,
        ReferenceID: task.ReferenceID,
        isBackup: task.isBackup,
        taskCount: results.length,
        dateCompleted: null,
        isRestricted: task.isRestricted
    };

    // If the task doesn't have a ProductID, but it has a Keycode, get any ProductID that maps to it
    if (!TaskData["ProductID"] && TaskData["Keycode"] && TaskData.Type == "Inventory") {
        sql = `SELECT Barcode FROM product_barcode WHERE Keycode = ?`;
        args = [TaskData["Keycode"]];

        try {
            [results] = await pool.query(sql, args);
            TaskData["ProductID"] = results[0]["Barcode"];
        } catch (error) {
            logger.error("in getting Keycode from ProductID: ", {error});
            res.status(400).send({"message": error});
            return;
        }
    }

    switch (TaskData.Type) {
    case "Backfill":
    case "CasePick":
    case "Pick": {
        console.log(`Executing ${TaskData.Type} transaction with subtype: ${subtype}`);
        if (subtype == "item") {
            let toUpdate = [];
            let filled = quantity;

            // Only move inventory for update and fully complete. If the "No More Items" button is
            // pressed, call the API /task/complete with 0 quantity and then mark all tasks as complete
            if (!is_update && (quantity == 0 || TaskData.QuantityFilled > 0)) {
                await no_more_items(req, res, TaskData, user.id, subtype);
                return;
            }

            // Get all tasks to fulfill Has same keycode and source container
            sql = `
                SELECT t.*
                FROM task t
                INNER JOIN task t1 on t1.Keycode = t.Keycode
                AND t1.SourceContainer = t.SourceContainer
                AND t1.TaskGroupID = t.TaskGroupID
                AND t1.ID = ?`;
            args = [TaskData.TaskID];

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                res.status(400).json({"message": error});
                return;
            }

            for (let result of results) {
                let alreadyFilled = 0;

                if (result.QuantityFilled == result.Quantity) {
                    continue;
                }

                if (result.QuantityFilled != null) {
                    alreadyFilled = result.QuantityFilled;
                }

                if (filled <= 0) {
                    continue;
                }

                let qty = filled;

                if ((result.Quantity - alreadyFilled) <= filled) {
                    qty = (result.Quantity - alreadyFilled);
                }

                toUpdate.push({
                    toMove: qty,
                    alreadyFilled: alreadyFilled,
                    Needed: result.Quantity,
                    TargetContainer: TaskData.TargetContainer,
                    dateCompleted:TaskData.dateCompleted,
                    UserID: user.id,
                    TaskID: result.ID
                });
                filled -= qty;
            }

            if (filled > 0) {
                toUpdate[toUpdate.length - 1].toMove += filled;
            }

            sql = "";
            args = [];
            status = "completed";
            let affected = 0;

            for (let update of toUpdate) {
                console.log(`Moving inventory for ${ update.toMove } items of ${TaskData.Keycode} to set Quantity Fulfilled to ${update.toMove + update.alreadyFilled} for task ${update.TaskID}.`);
                if (quantity > 0) {
                    body = {
                        keycode: TaskData.Keycode,
                        barcode: TaskData.ProductID,
                        source_container: TaskData.SourceContainer,
                        target_container: TaskData.TargetContainer,
                        quantity: update.toMove,
                        task_id: update.TaskID,
                        process: process
                    };
                    try {
                        await apiRequest.put(req, "move_inventory", body);
                        logger.info("Move_inventory success");
                    } catch (error) {
                        logger.info("Move_inventory error: ", {error: error.message});
                        res.status(400).send({"message": error.message});
                        return;
                    }
                }
                // figure out whether to update quantity filled or complete the task
                if (update.Needed <= update.toMove + update.alreadyFilled) {
                    update.dateCompleted = moment.utc().format();
                } else {
                    status = "updated";
                }

                // An another SQL query along with the arguments for this task
                sql += `UPDATE task SET QuantityFilled = ?, TargetContainer = ?, DateCompleted = ?, AssignedUserID = ? WHERE ID = ?;`;
                args.push(
                    update.toMove + update.alreadyFilled, // QuantityFilled
                    update.TargetContainer,               // TargetContainer
                    update.dateCompleted,                 // DateCompleted
                    update.UserID,                        // AssignedUserID
                    update.TaskID                         // ID
                );
            }

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                logger.info("There was an error updating the tasks");
                console.log(error);
            }

            /* The results will be an array of objects if it was a multi-line query.
             * If it was just a single query, then results will just be an object (no array)
             *
             * Example of an array of objects for a multi-line query:
             * [
             *     {
             *         affectedRows: 1
             *     },
             *     {
             *         affectedRows: 1
             *     }
             * ]
             *
             * Example of the object if the executed query was just a single line
             * {
             *     affectedRows: 1
             * }
             */
            if (Array.isArray(results)) {
                for (let result of results) {
                    affected += result.affectedRows;
                }
            } else {
                affected += results.affectedRows;
            }

            let numberToUpdate = toUpdate.length;

            if (affected == numberToUpdate) {
                logger.info(`Task: ${status}.`);
                if (status == "completed") {
                    message = `Pick completed for ${TaskData.Keycode} - ${TaskData.QuantityFilled} of ${TaskData.Quantity} moved to ${TaskData.TargetContainer}.`;
                } else {
                    message = `Pick updated for ${TaskData.Keycode} - ${TaskData.QuantityFilled} of ${TaskData.Quantity} moved to ${TaskData.TargetContainer}.`;
                }
                res.json({"status": status, "message": message});
            } else {
                error_message = `Completing task: ${toUpdate[affected - 1].TaskID} has failed.`;
                res.status(400).json({"message": error_message});
            }
        } else if (subtype == "case") {
            // Only move inventory for update and full complete. If No More Items button is pressed,
            // it calls /task/complete with 0 quantity. In that case, Mark all tasks as complete
            if (!is_update && (quantity == 0 || TaskData.QuantityFilled > 0)) {
                await no_more_items(req, res, TaskData, user.id, subtype);
                return;
            }

            // Doing only single task update or complete
            logger.info(`Moving inventory for ${quantity} items`);
            let quantityTodo = quantity;

            while (quantityTodo--) {
                body = {
                    "source_container": TaskData.SourceContainer,
                    "target_container": TaskData.TargetContainer,
                    "barcode": TaskData.ProductID,
                    "task_id": task_id,
                    "quantity": 1,
                    "process": "task_update_complete"
                };
                try {
                    await apiRequest.put(req, "move_inventory", body);
                } catch (error) {
                    logger.info("case/move_inventory error: ", {error: error.message});
                    res.status(400).send({"message": error.message});
                    return;
                }
            }

            // figure out whether to update quantity filled or complete the task
            status = "updated";
            logger.info("is_update:", {is_update});
            if (is_update) {
                TaskData.QuantityFilled++;
                if (TaskData.QuantityFilled >= TaskData.Quantity) {
                    is_update = false;
                }
            } else if (TaskData.QuantityFilled == 0) {
                // We are calling complete on new task, update full quantity
                TaskData.QuantityFilled = quantity;
                // we are calling complete method on a task partially filled,
                // quantity_filled is already set, we are not changing quantity.
            }

            if (!is_update) {
                TaskData.dateCompleted = moment.utc().format();
                // do not update status to completed if there are more duplicate tasks to do.
                if (TaskData.taskCount == 1) {
                    status = "completed";
                }
            }

            args = [TaskData.QuantityFilled, TaskData.TargetContainer, TaskData.dateCompleted, user.id, TaskData.TaskID];
            sql  = `
                UPDATE ankowhm.task
                SET QuantityFilled = ?, TargetContainer = ?, DateCompleted = ?, AssignedUserID = ?
                WHERE ID = ?`;

            try {
                [results] = await pool.query(sql, args);

                if (results.affectedRows == 1) {
                    logger.info(`Task: ${status}.`);
                    if (status == "completed") {
                        message = `Pick completed for ${TaskData.ProductID} - ${TaskData.QuantityFilled} of ${TaskData.Quantity} moved to ${TaskData.TargetContainer}.`;
                    } else {
                        message = `Pick updated for ${TaskData.ProductID} - ${TaskData.QuantityFilled} of ${TaskData.Quantity} moved to ${TaskData.TargetContainer}.`;
                    }
                    res.json({"status": status, "message": message});
                } else {
                    error_message = `Completing task: ${TaskData.TaskID} has failed.`;
                    res.status(400).json({"message": error_message});
                }
            } catch (error) {
                res.status(400).json({"message": error});
                return;
            }
        }

        break;
    }
    case "Inventory": {
        // Inventory task type - user will confirm inventory count at location and the inventory levels will be updated according to them
        logger.info("Executing Inventory Inspection transaction");

        // Important step, make sure we pass the correct container, Now we use secondarySort column for task, we can safely use SourceContainer
        let adjust_container = TaskData.SourceContainer;
        logging.log_inventory("UPDATE", TaskData.ProductID, TaskData.Keycode, quantity, adjust_container, adjust_container, user.id, null, "rfid-exception");

        try {
            if (TaskData.ReferenceID) {
                const body = {
                    "keycode": TaskData.Keycode,
                    "container": adjust_container,
                    "physicalQuantity": quantity,
                    "referenceID": TaskData.ReferenceID,
                    "reason": reason,
                    "customReason": customReason
                };

                result = await apiRequest.put(req, "update_store_inventory_snapshot", body);
            } else {
                const body = {
                    "barcode": TaskData.ProductID,
                    "container": adjust_container,
                    "quantity": quantity,
                    "task_id": TaskData.TaskID,
                    "restricted": TaskData.isRestricted,
                    "process": process,
                    "reason": reason
                };

                result = await apiRequest.put(req, "adjust_inventory", body);
            }

            sql  = `UPDATE task SET QuantityFilled = ?, DateCompleted = NOW(), AssignedUserID = ? WHERE ID = ?`;
            args = [quantity, user.id, TaskData.TaskID];
            await pool.query(sql, args);
            const message = result.message; //`Inventory of ${product_id} in ${target_container} is ${actual}.`;
            res.status(200).json({"message": message});
        } catch (error) {
            logger.info("task_complete_update Inventory ERROR: ", {error});
            res.status(error.status).json({"message": error.message});
        }

        break;
    }
    case "Reprice": {
        try {
            sql  = `UPDATE task SET DateCompleted = NOW(), AssignedUserID = ? WHERE ID = ?`;
            args = [ user.id, TaskData.TaskID];
            await pool.query(sql, args);
            message = `${TaskData.Keycode} has been Repriced`;
            res.status(200).json({"message": message});
        } catch (error) {
            logger.info("task_complete_update Reprice ERROR: ", {error});
            res.status(error.status).json({"message": error.message});
        }
        break;
    }
    case "BackfillCount": {
        // Backfill counting tasks are fairly straightforward since there are no keycodes/barcodes or quantities involved,
        // and every backfill counting task will always have exactly one single task in its task group
        sql  = `
            UPDATE task SET DateCompleted = NOW(), DateFulfilled = NOW(), AssignedUserID = ? WHERE ID = ?
            ;
            UPDATE task_group SET DateCompleted = NOW(), DateFulfilled = NOW(), AssignedUserID = ? WHERE ID = ?`;
        args = [user.id, TaskData.TaskID, user.id, TaskData.TaskGroupID];

        try {
            await pool.query(sql, args);
            res.status(200).json({"message": "BackfillCount task completed"});
        } catch (error) {
            logger.info("task_complete_update BackfillCount ERROR:", {error});
            res.status(error.status).json({"message": error.message});
        }

        logging.log_rfid_stock_take(quantity, TaskData.TargetContainer, user.id); // No need to await since we don't care when logging completes

        break;
    }
    default: {
        res.status(400).json({"message": "That task type isn't recognized; please contact your system administrator"});
    }}
}

async function no_more_items(req, res, data, UserID, subtype) {
    let sql, args, results, message, tableToUpdate, keycodeOrBarcode;
    let quantityNeeded = data.Quantity - data.QuantityFilled;
    let storeRegex = /-STR/;

    // Don't create inventory task if source container is a store
    if (!storeRegex.test(data.SourceContainer) && data.Type !== "Backfill") {
        // Create task & task group for the inventory-checking task
        sql = `
            INSERT INTO task (Keycode, SourceContainer, TargetContainer, Type, ReferenceID)
            SELECT
                ? AS Keycode,
                ? AS SourceContainer,
                ? AS TargetContainer,
                'Inventory' AS Type,
                ? AS ReferenceID FROM DUAL
            WHERE NOT EXISTS (
                SELECT * FROM task
                WHERE Type = 'Inventory' AND SourceContainer = ? AND DateCompleted IS NULL
            )
            LIMIT 1`;
        args = [data.Keycode, data.SourceContainer, data.WrhLocation, UserID, data.SourceContainer];

        try {
            [results] = await pool.query(sql, args);
            if (results.affectedRows > 0) {
                // Immediately put the task into a task group after it's created
                console.log(`Created Inventory TASK for: ${data.SourceContainer}; New taskID = ${results.insertId}`);
                console.log(`Adding inventory task with id ${results.insertId} into a task group`);
                apiRequest.get(req, "/taskgroup/group_inventory_tasks");
            } else {
                logger.info("Inventory task is already created for source container:", {sourceContainer: data.SourceContainer});
            }
        } catch (error) {
            logger.info("Inventory counting task creation ERROR:", {error});
            res.status(400).json({"message": "Unable to create an inventory counting task, contact your system administrator"});
            return;
        }
    }

    /* Item:
     * When this method is called, we need to create tasks to count the inventory in the entire shelf in order
     * to make sure that the virtual inventory is correct. Only create a task if one doesn't already exist
     *
     * Case:
     * Because the user reported that no more cases were available for picking in the current task, that means
     * the physical inventory is inconsistent with our virtual inventory, and therefore a task to count the
     * actual inventory needs to be created so that the correct amount can be synced to our database
     *
     * If the user clicked on "No More Items" on a task that WASN'T a backup, try to
     * search for new inventory to replace the stuff that wasn't found as a backup task */

    if (subtype == "item" && !data.isBackup) {
        // SQL: Find the SHL and RSV with highest quantity. Set Quantity to desired quantity or less. Order by Quantity and Container Type (RSV = ASC, SHL = DESC). If found, insert task. If less then current location, set isSkipped = true
        if (data.Type == "Online") {
            // For online orders, we want to fulfill them at all cost, so find the units needed in another container if possible and create a task for it
            sql = `
                INSERT INTO task (TaskGroupID, Keycode, ProductID, RowID, Quantity, SourceContainer, TargetContainer, Type, isBackup, isSkipped, ReferenceID)
                SELECT
                    ? AS TaskGroupID, ? AS Keycode, ? AS ProductID, ? AS RowID, Quantity, i.ContainerID AS SourceContainer,
                    ? AS TargetContainer, ? AS Type, 1 AS isBackup, IF(? > i.ContainerID, TRUE, FALSE) AS isSkipped, ? AS ReferenceID
                FROM (
                    SELECT * FROM (
                        SELECT i.ContainerID, IF(? <= COUNT(*), ?, COUNT(*)) AS Quantity, c.Type AS ContainerType, IF(SUM(i.IsSuspicious) > 0, 1, 0) AS IsSuspicious
                        FROM inventory i
                        INNER JOIN container c ON c.ID = i.ContainerID
                        WHERE c.Type = 'RSV' AND i.ContainerID != ? AND i.Keycode = ? AND c.LocationID = ? AND i.TaskID IS NULL
                        GROUP BY ContainerID
                        ORDER BY Quantity DESC LIMIT 1
                    ) AS a
                    UNION
                    SELECT * FROM (
                        SELECT i.ContainerID, IF(? <= COUNT(*), ?, COUNT(*)) AS Quantity, c.Type AS ContainerType, IF(SUM(i.IsSuspicious) > 0, 1, 0) AS IsSuspicious
                        FROM inventory i
                        INNER JOIN container c ON c.ID = i.ContainerID
                        WHERE c.Type = 'SHL' AND i.ContainerID != ? AND i.Keycode = ? AND c.LocationID = ? AND i.TaskID IS NULL
                        GROUP BY ContainerID
                        ORDER BY Quantity DESC LIMIT 1
                    ) AS b
                    UNION
                    SELECT * FROM (
                        SELECT i.ContainerID, IF(? <= COUNT(*), ?, COUNT(*)) AS Quantity, c.Type AS ContainerType, IF(SUM(i.IsSuspicious) > 0, 1, 0) AS IsSuspicious
                        FROM inventory i
                        INNER JOIN container c ON c.ID = i.ContainerID
                        WHERE ContainerID = 'LYN2-STR' AND ContainerID != ? AND Keycode = ? AND i.TaskID IS NULL
                        GROUP BY ContainerID
                    ) AS c
                ) AS i
                ORDER BY IsSuspicious, Quantity DESC, ContainerType
                LIMIT 1`;
            args = [
                data.TaskGroupID, data.Keycode, data.ProductID, data.RowID, data.TargetContainer, data.Type, data.SourceContainer, data.ReferenceID,
                quantityNeeded, quantityNeeded, data.SourceContainer, data.Keycode, data.WrhLocation,
                quantityNeeded, quantityNeeded, data.SourceContainer, data.Keycode, data.WrhLocation,
                quantityNeeded, quantityNeeded, data.SourceContainer, data.Keycode
            ];
        } else {
            sql = `
                INSERT INTO task (TaskGroupID, Keycode, ProductID, RowID, Quantity, SourceContainer, TargetContainer, Type, isBackup, isSkipped, ReferenceID)
                SELECT
                    ? AS TaskGroupID, ? AS Keycode, ? AS ProductID, ? AS RowID, Quantity, i.ContainerID AS SourceContainer,
                    ? AS TargetContainer, ? AS Type, 1 AS isBackup, IF(? > i.ContainerID, TRUE, FALSE) AS isSkipped, ? AS ReferenceID
                FROM (
                    SELECT * FROM (
                        SELECT i.ContainerID, IF(? <= COUNT(*), ?, COUNT(*)) AS Quantity, c.Type AS ContainerType, IF(SUM(i.IsSuspicious) > 0, 1, 0) AS IsSuspicious
                        FROM inventory i
                        INNER JOIN container c ON c.ID = i.ContainerID
                        WHERE c.Type = 'RSV' AND i.ContainerID != ? AND i.Keycode = ? AND c.LocationID = ? AND i.TaskID IS NULL
                        GROUP BY ContainerID
                        ORDER BY Quantity DESC LIMIT 1
                    ) AS a
                    UNION
                    SELECT * FROM (
                        SELECT i.ContainerID, IF(? <= COUNT(*), ?, COUNT(*)) AS Quantity, c.Type AS ContainerType, IF(SUM(i.IsSuspicious) > 0, 1, 0) AS IsSuspicious
                        FROM inventory i
                        INNER JOIN container c ON c.ID = i.ContainerID
                        WHERE c.Type = 'SHL' AND i.ContainerID != ? AND i.Keycode = ? AND c.LocationID = ? AND i.TaskID IS NULL
                        GROUP BY ContainerID
                        ORDER BY Quantity DESC LIMIT 1
                    ) AS b
                ) AS i
                ORDER BY IsSuspicious, Quantity DESC, ContainerType ${data.ContainerType == "RSV"? "ASC" : "DESC"}
                LIMIT 1`;
            args = [
                data.TaskGroupID, data.Keycode, data.ProductID, data.RowID, data.TargetContainer, data.Type, data.SourceContainer, data.ReferenceID,
                quantityNeeded, quantityNeeded, data.SourceContainer, data.Keycode, data.WrhLocation,
                quantityNeeded, quantityNeeded, data.SourceContainer, data.Keycode, data.WrhLocation
            ];
        }

        try {
            [results] = await pool.query(sql, args);
            if (results.insertId) {
                console.log(`Created Backup task ${results.insertId} for item ${data.Keycode}`);
            } else {
                console.log(`Unable to find Backup for item ${data.Keycode}`);

                // If we were unable to find a backup container to fulfill this item, then we MUST set DateCompleted and DataFulfilled to NOW() for this task,
                // and QuantityFilled to 0 if it's NULL if the task is partially fullfilled we don't want to update the DateFulfilled, else update the DataFulfilled
                // Also make sure that the user's ID that clicked "No More Items" is set so we know who clicked the button
                if (data.QuantityFilled) {
                    sql = `UPDATE task SET QuantityFilled = COALESCE(QuantityFilled, 0), DateCompleted = NOW(), AssignedUserID = ? WHERE ID = ?`;
                    args = [UserID, data.TaskID];
                } else {
                    sql = `UPDATE task SET QuantityFilled = COALESCE(QuantityFilled, 0), DateCompleted = NOW(), AssignedUserID = ?, DateFulfilled = NOW() WHERE ID = ?`;
                    args = [UserID, data.TaskID];
                }

                try {
                    [results] = await pool.query(sql, args);
                } catch (error) {
                    logger.info("Backup task creation ERROR:", {error});
                    res.status(400).json({"message": "Unable to update DateCompleted/Fulfilled, contact your system administrator"});
                    return;
                }

                // Call fulfillTaskGroup which will fulfill the group if all tasks have been completed. This does nothing if it's not ready to be fulfilled, so it's safe to call
                await apiRequest.put(req, "taskgroup/fulfillTaskGroup", {"task_id": data.TaskID});
            }
        } catch (error) {
            logger.info("Backup task creation ERROR:", {error});
            res.status(400).json({"message": "Unable to create a backup task, contact your system administrator"});
            return;
        }
    }

    if (subtype == "case" && !data.isBackup) {
        // SQL: Find the SHL and RSV with highest quantity. Set Quantity to desired quantity or less. Order by Quantity and Container Type (RSV = ASC, SHL = DESC). If found, insert task. If less then current location, set isSkipped = true
        sql = `
            INSERT INTO task (TaskGroupID, Keycode, Barcode, RowID, Quantity, SourceContainer, TargetContainer, Type, isBackup, isSkipped, ReferenceID)
            SELECT
                ? AS TaskGroupID, ? AS Keycode, ? AS Barcode, ? AS RowID, Quantity, i.ContainerID AS SourceContainer,
                ? AS TargetContainer, ? AS Type, 1 AS isBackup, IF(? > i.ContainerID, TRUE, FALSE) AS isSkipped, ? AS ReferenceID
            FROM (
                SELECT * FROM (
                    SELECT ic.ContainerID, IF(? <= COUNT(*), ?, COUNT(*)) AS Quantity, c.Type AS ContainerType, IF(SUM(ic.IsSuspicious) > 0, 1, 0) AS IsSuspicious
                    FROM inventory_case ic
                    INNER JOIN container c ON c.ID = ic.ContainerID
                    WHERE c.Type = 'RSV' AND ic.ContainerID != ? AND ic.Barcode = ? AND ic.TaskID IS NULL
                    GROUP BY ContainerID
                    ORDER BY IsSuspicious, Quantity DESC
                    LIMIT 1
                ) AS b
            ) AS i`;
        args = [
            data.TaskGroupID, data.Keycode, data.ProductID, data.RowID, data.TargetContainer, data.Type, data.SourceContainer, data.ReferenceID,
            quantityNeeded, quantityNeeded, data.SourceContainer, data.ProductID
        ];

        try {
            [results] = await pool.query(sql, args);
            if (results.insertId) {
                console.log(`Created Backup task ${results.insertId} for item ${data.ProductID}`);
            } else {
                console.log(`Unable to find Backup for item ${data.ProductID}`);

                // If we were unable to find a backup container to fulfill this item, then we MUST set DateCompleted and DateCompleted to NOW() for this task, and QuantityFilled to 0 if it's NULL
                try {
                    [results] = await pool.query(`UPDATE task SET QuantityFilled = COALESCE(QuantityFilled, 0), DateCompleted = NOW(), DateFulfilled = NOW() WHERE ID = ?`, [data.TaskID]);
                } catch (error) {
                    logger.info("Backup task creation ERROR:", {error});
                    res.status(400).json({"message": "Unable to update DateCompleted/Fulfilled, contact your system administrator"});
                    return;
                }

                // Call fulfillTaskGroup which will fulfill the group if all tasks have been completed. This does nothing if it's not ready to be fulfilled, so it's safe to call
                await apiRequest.put(req, "taskgroup/fulfillTaskGroup", {"task_id": data.TaskID});
            }
        } catch (error) {
            logger.info("Backup task creation ERROR:", {error});
            res.status(400).json({"message": "Unable to create a backup task, contact your system administrator"});
            return;
        }
    }

    // Determine the final SQL + arguments to use depending on if we're dealing with a regular item, or a case
    if (subtype == "item") {
        tableToUpdate = "inventory";
        keycodeOrBarcode = "Keycode";
    } else if (subtype == "case") {
        tableToUpdate = "inventory_case";
        keycodeOrBarcode = "Barcode";
    }

    sql = `
        UPDATE ${tableToUpdate} AS i
        INNER JOIN (
            SELECT t.ID, t.SourceContainer, t.${keycodeOrBarcode}
            FROM (
                SELECT * FROM task
                WHERE ID = ?
            ) AS t1
            LEFT JOIN task t ON t.TaskGroupID = t1.TaskGroupID AND t.SourceContainer = t1.SourceContainer AND t.${keycodeOrBarcode} = t1.${keycodeOrBarcode}
            WHERE t.DateCompleted IS NULL
        ) AS tt ON tt.SourceContainer = i.ContainerID AND tt.${keycodeOrBarcode} = i.${keycodeOrBarcode}
        SET i.TaskID = NULL WHERE i.TaskID = tt.ID
        ;
        UPDATE ${tableToUpdate} AS i
        INNER JOIN (
            SELECT SourceContainer, ${keycodeOrBarcode} FROM task WHERE ID = ?
        ) AS t ON t.SourceContainer = i.ContainerID AND t.${keycodeOrBarcode} = i.${keycodeOrBarcode}
        SET IsSuspicious = 1
        ;
        UPDATE task AS ut
        INNER JOIN (
            SELECT t.ID, IFNULL(t.TargetContainer, ?) tgtContainer, IFNULL(t.QuantityFilled, 0) AS qtFilled, t.${keycodeOrBarcode}
            FROM (
                SELECT * FROM task
                WHERE ID = ?
            ) AS t1
            LEFT JOIN task t ON t.TaskGroupID = t1.TaskGroupID AND t.SourceContainer = t1.SourceContainer AND t.${keycodeOrBarcode} = t1.${keycodeOrBarcode}
            WHERE t.DateCompleted IS NULL
        ) tt ON tt.ID = ut.ID
        SET ut.QuantityFilled = tt.qtFilled, ut.TargetContainer = tt.tgtContainer, ut.dateCompleted = NOW(), ut.AssignedUserID = ?`;
    args = [data.TaskID, data.TaskID, data.TargetContainer, data.TaskID, UserID];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.info("Unable to update Tasks:", {error});
        res.status(400).json({"message": "Unable to update Tasks, contact your system administrator"});
        return;
    }

    console.log(`All related tasks completed along with task: ${data.TaskID}`);
    message = `Pick completed for ${(data.ProductID || data.Keycode)} - ${data.QuantityFilled} of ${data.Quantity} moved to ${data.TargetContainer}`;

    if (res) {
        res.status(200).json({"status": "completed", "message": message});
    }
}

exports.debug_get_task_by_taskGroup = async function(req, res) {
    const ID = req.query.taskGroupID || req.body.taskGroupID;
    let sql, args;
    if (results) {
        sql = `
        SELECT t.ID, t.TaskGroupID, t.Keycode, t.ProductID, t.RowID, t.Quantity, t.QuantityFilled, t.QuantityDelivered,
        t.SourceContainer, t.TargetContainer, t.Type, t.isRestricted, t.isSkipped, t.isBackup, t.isRandom, t.ReferenceID, t.AssignedUserID,
        t.DateCreated,
        t.DateCompleted,
        t.DateFulfilled,
        FROM task t
        WHERE t.TaskGroupID = ?`;
        args = [ID];
        try {
            var [results] = await ro_pool.query(sql, args);
            res.status(200).json({"data": results});
        } catch (error) {
            res.status(500).json({"message": `Error occured while attempting to get tasks for task_group ID: ${ID}.`});
        }
    }
};

exports.debug_get_task_by_ID = async function(req, res) {
    const ID = req.query.taskID || req.body.taskID;
    const location = req.query.locationID || req.body.locationID;
    let sql = `Select Timezone from location where ID = ?`;
    let args = [location];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        res.status(500).json({"message": `unable to get location timezone data: ${location}.`});
        return;
    }
    if (results) {
        sql = `
        SELECT t.ID, t.TaskGroupID, t.Keycode, t.ProductID, t.RowID, t.Quantity, t.QuantityFilled, t.QuantityDelivered,
        t.SourceContainer, t.TargetContainer, t.Type, t.isRestricted, t.isSkipped, t.isBackup, t.isRandom, t.ReferenceID, t.AssignedUserID,
        t.DateCreated,
        t.DateCompleted,
        t.DateFulfilled
        FROM task t
        WHERE t.ID = ?`;
        args = [ID];
        try {
            var [results] = await ro_pool.query(sql, args);
            if (results.length > 0) {
                res.status(200).json({"data": results});
            } else {
                res.status(500).json({"message": `No task were found for ID: ${ID}`});
            }
        } catch (error) {
            res.status(500).json({"message": `Error occured while attempting to get tasks with ID: ${ID}.`});
        }
    }
};
