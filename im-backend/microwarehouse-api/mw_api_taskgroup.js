/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

let apiRequest = require("../library/apiRequest");
let helpers = require("../library/helperFn");
let authHelper = require("../library/authHelper");
let moment = require("moment");
const logger = require("../library/logger")("microwarehouse-api:mw_api_taskgroup");

exports.taskgroup_create = async function(req, res) {
    let source_location = req.body.source_location || null;
    let target_location = req.body.target_location || null;
    let due_date = req.body.due_date || null;
    let priority = req.body.priority || 1;
    let type = req.body.type || null;
    let cart_type = req.body.cart_type || null;
    let reference_id = req.body.reference_id || null;
    let sql, args, results, insertId;

    if (source_location == null || source_location == "" || target_location == null || target_location == "") {
        res.status(400).json({"message": "source_location and target_location are required!"});
        return;
    }

    try {
        args = [source_location, target_location, due_date, priority, type, cart_type, reference_id];
        sql  = "INSERT INTO task_group (SourceLocation, TargetLocation, DateDue, Priority, Type, CartType, ReferenceID) VALUES (?)";

        try {
            results = await pool.query(sql, [args]);
        } catch (error) {
            logger.error("taskgroup_create:", {error});
            res.status(500).json("Unable to create a new Task Group");
            return;
        }

        insertId = results[0]["insertId"];
        res.status(200).json({"message":`Taskgroup successfully created with ID: ${insertId}`, "data": insertId});
    } catch (error) {
        logger.info("taskgroup_create ERROR:", {error});
        res.status(400).json({"message": "Unable to create a new Task Group"});
    }
};

exports.group_pick_tasks = async function(req, res) {
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let types = [
        "CasePick",
        "Pick"
    ];

    // Optional Inputs?
    let name = req.query.name || null;
    let source = req.query.source || "Auto";

    for (let type of types) {
        // Tasks have now been created with taskGroupID = null
        // We'll call this method that will assign tasks to proper groups
        // Assignment is done based on locations and Group size.
        // We also create new task_groups everytime this method is called
        let sql, args, results;

        // First select all tasks in the proper order
        args = [type];
        sql = `
            SELECT
                DISTINCT t.ID,
                ro.RowID,
                ro.SourceLocation,
                ro.TargetLocation,
                t.SourceContainer,
                c.isApparel,
                lg.GroupID AS LocationGroup,
                ct.Priority AS SrcPriority,
                ro.DateDue,
                IFNULL(t.Priority, ro.Priority) AS Priority,
                t.Quantity
            FROM task t
            LEFT JOIN replenish_order ro ON ro.RowID = t.RowID
            INNER JOIN container c ON c.ID = t.SourceContainer
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType = c.SubType
            LEFT JOIN product p ON p.Keycode = t.Keycode
            LEFT JOIN location_group lg ON lg.Retail_Zone_ID = p.Retail_Zone_ID
            WHERE t.Type = ? AND t.TaskGroupID IS NULL
            ORDER BY
                ro.Priority DESC,
                ro.SourceLocation ASC,
                ro.TargetLocation ASC,
                c.isApparel ASC,
                lg.GroupID ASC,
                c.Priority ASC,
                t.SourceContainer ASC`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("group_pick_tasks:", {error});
            res.status(500).json({"message": "Group Pick Tasks request failed."});
            return;
        }

        if (results.length == 0) {
            continue; // No new tasks needed to be grouped for this current type
        }

        let unitCount = 0;
        let groupSize = settings.task.groupSizePick;
        let threshold = settings.task.groupSizeThreshold;
        let currSourceLocation = results[0]["SourceLocation"];
        let currTargetLocation = results[0]["TargetLocation"];
        let currPriority = results[0]["Priority"] || "Standard";
        let currDueDate = results[0]["DateDue"];
        let currSrcPriority = results[0]["SrcPriority"];
        let currIsApparel = results[0]["isApparel"];
        let currLocationGroup = results[0]["LocationGroup"];

        let task, taskIdList = [], createGroup, Priority, isReserve;
        results[results.length] = {}; // Add extra empty item into the array.
        let lastIndex = results.length - 1;

        for (let i in results) {
            task = results[i];
            Priority = task.Priority || "Standard"; //'Standard','Fasttrack'
            createGroup = false;

            // Create a new group if...
            if (i == lastIndex) {
                // ...this is the last index of the array
                createGroup = true;
            } else if (Priority != currPriority) {
                // ...the priority changes
                createGroup = true;
            } else if (task.SourceLocation != currSourceLocation || task.TargetLocation != currTargetLocation) {
                // ...the SourceLocation or TargetLocation changes
                createGroup = true;
            } else if (task.SrcPriority != currSrcPriority) {
                // ...the SrcPriority changes
                createGroup = true;
            } else if (unitCount >= groupSize || (unitCount + task.Quantity >= groupSize + threshold)) {
                // ...the unitCount reaches groupSize
                createGroup = true;
            } else if (task.isApparel != currIsApparel) {
                // ...the container's isApparel changes
                createGroup = true;
            } else if (task.LocationGroup != currLocationGroup) {
                // ...the product's location group changes
                createGroup = true;
            }

            if (createGroup) {
                isReserve = currSrcPriority > 1 ? true : false; // IF Container Priority is 2+, set isReserve to TRUE.
                // make sure currDueDate is not in the past (it's based on RO, so it can happen)

                if (moment(currDueDate).isBefore(moment())) {
                    if (currPriority == "Fasttrack") {
                        currDueDate = locationsETA[currTargetLocation]["Fasttrack"]["DatePickETA"];
                    } else {
                        currDueDate = locationsETA[currTargetLocation]["Standard"]["DatePickETA"];
                    }
                }
                args = [currSourceLocation, currTargetLocation, currDueDate, currPriority, type, currIsApparel , isReserve, name, source, taskIdList];
                sql  = `
                    INSERT INTO task_group (SourceLocation, TargetLocation, DateDue, Priority, Type, CartType, isReserve, name, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                    UPDATE task SET TaskGroupID = LAST_INSERT_ID() WHERE ID IN (?);
                `;
                try {
                    await pool.query(sql, args);
                } catch (error) {
                    logger.error("group pick tasks:", {error});
                    res.status(500).json({"message": "Unable to group tasks."});
                    return;
                }

                // reset values:
                unitCount = 0;
                taskIdList = [];
                currSourceLocation = task.SourceLocation;
                currTargetLocation = task.TargetLocation;
                currPriority = task.Priority;
                currDueDate = task.DateDue;
                currSrcPriority = task.SrcPriority;
                currIsApparel = task.isApparel;
                currLocationGroup = task.LocationGroup;
            }
            taskIdList.push(task.ID);

            if (task.Barcode) {
                task.Quantity += task.Quantity * 4;
            } else {
                unitCount += task.Quantity;
            }
        }
    }

    res.status(200).json({"message":"Pick Tasks grouped successfully."});
};

exports.group_inventory_tasks = async function(req, res) {
    logger.info("START: group_inventory_tasks");
    let isRestricted = req.query.restricted;
    let message = "Group Inventory Tasks has completed\n";
    let totalTaskGroups = 0;

    let sql, args, results;
    // Normalize input values:
    if (isRestricted == 1 || isRestricted == "true") {
        isRestricted = 1;
    } else {
        isRestricted = 0;
    }
    // First we need to delete all duplicate tasks (it's not that easy to check for dups at creation time)
    args = []; //[isRestricted]; // ignore restriction for now, we are not using it at the moment.
    sql  = `
    DELETE t1 FROM task t1
    INNER JOIN task t2 ON (t1.Keycode = t2.Keycode OR t2.Keycode is null) AND t1.SourceContainer = t2.SourceContainer AND t1.TargetContainer = t2.TargetContainer
    WHERE t1.ID < t2.ID AND t1.Type = 'Inventory' AND t1.TaskGroupID is null
    `;
    // AND t1.isRestricted = ?

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("group_inventory_tasks:", {error});
        res.status(400).json({"message": "Group Inventory Tasks request failed."});
        return;
    }
    // We will be creating task groups (if they don't exist) per location and current DueDate
    let dueDate = moment().add(settings.dueDate.offsetInventory, "hour").format();

    // First select all distinct Target Locations
    args = [isRestricted];
    sql = `
        SELECT TargetContainer
        FROM task t
        WHERE TaskGroupID IS NULL
        AND Type = 'Inventory'
        AND isRestricted = ?
        GROUP BY TargetContainer`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("group_inventory_tasks:", {error});
        res.status(400).json({"message": "Group Inventory Tasks request failed."});
    }

    // For each unique target location, create task group(s), assigning up to 40 tasks per group
    for (let row of results) {
        let location = row["TargetContainer"];
        let taskGroupCounter = 0;
        let quantityRemaining;

        do {
            let insertId, results2;

            args = [location, location, dueDate, isRestricted];
            sql  = `
                INSERT INTO task_group (SourceLocation, TargetLocation, DateDue, Priority, Type, DateCreated, isRestricted)
                VALUES (?, ?, ?, 'Standard', 'Inventory', NOW(), ?)`;

            // Create a new task group, getting its ID
            try {
                [results2] = await pool.query(sql, args);
                insertId = results2["insertId"];
                taskGroupCounter++;
                totalTaskGroups++;
            } catch (error) {
                logger.error("group_inventory_tasks:", {error});
                res.status(400).json({"message": "Group Inventory Tasks request failed."});
            }

            args = [insertId, location, isRestricted, location, isRestricted];
            sql  = `
                UPDATE task t
                SET TaskGroupID = ?
                WHERE TaskGroupID IS NULL
                AND Type = 'Inventory'
                AND TargetContainer = ?
                AND isRestricted = ?
                LIMIT 40
                ;
                SELECT COUNT(*) AS QuantityRemaining
                FROM task
                WHERE TaskGroupID IS NULL
                AND Type = 'Inventory'
                AND TargetContainer = ?
                AND isRestricted = ?`;

            // Update up to 40 tasks for the Task Group ID. We also need to get the remaining tasks that need to be assigned for this target location
            try {
                [results2] = await pool.query(sql, args);
                quantityRemaining = results2[1][0]["QuantityRemaining"];
            } catch (error) {
                logger.error("group_inventory_tasks:", {error});
                res.status(400).json({"message": "Group Inventory Tasks request failed."});
            }
        } while (quantityRemaining > 0); // Continue on if there are still tasks that need to be assigned

        message += `${taskGroupCounter} task groups created for ${location}\n`;
    }

    message += `${totalTaskGroups} total task groups created`;
    res.status(200).json({"message": message});
    logger.info("END: group_inventory_tasks");
};

exports.group_cross_dock_tasks = async function(req, res) {
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let sql, args, results;

    // Select all ungrouped CrossDocks tasks, ordering them as such
    sql = `
        SELECT
            DISTINCT t.ID,
            ro.RowID,
            ro.SourceLocation,
            ro.TargetLocation,
            t.SourceContainer,
            c.isApparel,
            lg.GroupID AS LocationGroup,
            ct.Priority AS SrcPriority,
            ro.DateDue,
            IFNULL(t.Priority, ro.Priority) AS Priority,
            t.Quantity
        FROM task t
        INNER JOIN container c ON c.ID = t.SourceContainer
        INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType = c.SubType
        LEFT JOIN replenish_order ro ON ro.RowID = t.RowID
        LEFT JOIN product p ON p.Keycode = t.Keycode
        LEFT JOIN location_group lg ON lg.Retail_Zone_ID = p.Retail_Zone_ID
        WHERE t.Type = 'CrossDock' AND t.TaskGroupID IS NULL
        ORDER BY
            ro.Priority DESC,
            ro.SourceLocation ASC,
            ro.TargetLocation ASC,
            c.isApparel ASC,
            lg.GroupID ASC,
            c.Priority ASC,
            t.SourceContainer ASC`;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("group_cross_dock_tasks:", {error});
        res.status(500).json({"message": "Unable to group Cross Dock tasks"});
        return;
    }

    if (results.length == 0) {
        res.status(200).json({"message": "There are currently no Cross Dock tasks to group"});
        return;
    }

    let unitCount = 0;
    let groupSize = settings.task.groupSizePick;
    let threshold = settings.task.groupSizeThreshold;
    let currSourceLocation = results[0]["SourceLocation"];
    let currTargetLocation = results[0]["TargetLocation"];
    let currPriority = "CrossDock";
    let currDueDate = results[0]["DateDue"];
    let currSrcPriority = results[0]["SrcPriority"];
    let currIsApparel = results[0]["isApparel"];
    let currLocationGroup = results[0]["LocationGroup"];
    let taskIdList = [];
    let task, createGroup, Priority, isReserve;

    // Record the last index and add an extra empty item into the array
    results[results.length] = {};
    let lastIndex = results.length - 1;

    for (let i in results) {
        task = results[i];
        Priority = task.Priority || "CrossDock";
        createGroup = false;

        // Create a new group if...
        if (i == lastIndex) {
            createGroup = true; // ...this is the last index of the array
        } else if (Priority != currPriority) {
            createGroup = true; // ...the priority changes
        } else if (task.SourceLocation != currSourceLocation || task.TargetLocation != currTargetLocation) {
            createGroup = true; // ...the SourceLocation or TargetLocation changes
        } else if (task.SrcPriority != currSrcPriority) {
            createGroup = true; // ...the SrcPriority changes
        } else if (unitCount >= groupSize || (unitCount + task.Quantity >= groupSize + threshold)) {
            createGroup = true; // ...the unitCount reaches groupSize
        } else if (task.isApparel != currIsApparel) {
            createGroup = true; // ...the container's isApparel changes
        } else if (task.LocationGroup != currLocationGroup) {
            createGroup = true; // ...the product's location group changes
        }

        if (createGroup) {
            isReserve = currSrcPriority > 1 ? true : false; // Set isReserve to TRUE if the container's priority is 2+

            // Ensure currDueDate isn't in the past (this is possible because it's based on RO)
            if (moment(currDueDate).isBefore(moment())) {
                if (currPriority == "Fasttrack") {
                    currDueDate = locationsETA[currTargetLocation]["Fasttrack"]["DatePickETA"];
                } else {
                    currDueDate = locationsETA[currTargetLocation]["Standard"]["DatePickETA"];
                }
            }

            args = [currSourceLocation, currTargetLocation, currDueDate, "CrossDock", "CrossDock", currIsApparel, isReserve, "Auto", taskIdList];
            sql  = `
                INSERT INTO task_group
                (SourceLocation, TargetLocation, DateDue, Priority, Type, CartType, isReserve, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                UPDATE task SET TaskGroupID = LAST_INSERT_ID() WHERE ID IN (?)`;

            try {
                await pool.query(sql, args);
            } catch (error) {
                logger.error("group_cross_dock_tasks:", {error});
                res.status(500).json({"message": "Unable to group Cross Dock tasks"});
                return;
            }

            // Reset the variables for the next task group
            unitCount = 0;
            taskIdList = [];
            currSourceLocation = task.SourceLocation;
            currTargetLocation = task.TargetLocation;
            currPriority = task.Priority;
            currDueDate = task.DateDue;
            currSrcPriority = task.SrcPriority;
            currIsApparel = task.isApparel;
            currLocationGroup = task.LocationGroup;
        }

        taskIdList.push(task.ID);

        if (task.Barcode) {
            task.Quantity += task.Quantity * 4;
        } else {
            unitCount += task.Quantity;
        }
    }

    res.status(200).json({"message": "Cross Dock tasks grouped successfully"});
};

exports.get_available = async function(req, res) {
    let location = req.query.location || null;
    let type = req.query.type || null;
    let user = authHelper.parseRole(req);
    let sqlFilter = "";
    let sql, args, results;

    if (location == null || location == "") {
        res.status(400).json({"message": "location is required"});
        return;
    }

    if (type) {
        sqlFilter += " AND Type = ?";
        args = [location, type];
    } else {
        args = [location];
    }

    if (type === "Inventory") {
        sqlFilter += " AND DateDue > NOW()";
    }

    // If this user does NOT have elevated permissions, then they can only get tasks that are NOT restricted
    if (!(user.isAdmin || user.isWmanager || user.isSmanager || user.roles.indexOf("w_troubleshoot") >= 0)) {
        sqlFilter += " AND isRestricted = 0";
    }

    sql = `
        SELECT
            tg.*,
            t.tasks,
            t.units,
            t.SourceContainer
        FROM task_group tg
        INNER JOIN (
            SELECT
                TaskGroupID,
                COUNT(*) AS tasks,
                (SUM(Quantity) - IFNULL(SUM(QuantityFilled), 0)) AS units,
                # For backfill tasks, all tasks will have the same SourceContainer
                SourceContainer
            FROM task
            WHERE DateCompleted IS NULL
            GROUP BY TaskGroupID
        ) AS t ON t.TaskGroupID = tg.ID
        WHERE tg.DateCompleted IS NULL
        AND tg.SourceLocation = ?
        AND (
            tg.DateUserAssigned < DATE_ADD(NOW(), INTERVAL -30 MINUTE) OR
            tg.DateUserAssigned IS NULL
        )
        ${sqlFilter}
        ORDER BY tg.Priority DESC, tg.DateDue ASC, tg.ID ASC`;

    try {
        [results] = await ro_pool.query(sql, args);

        if (results.length) {
            res.status(200).json({"data": results});
        } else {
            res.status(204).json({"message": `No new tasks are available for your location: ${location}`});
        }
    } catch (error) {
        logger.info("get_available ERROR: ", {error});
        res.status(500).json({"message": "Unable to retrive available task groups"});
    }
};

exports.get_inprogress = async function(req, res) {
    let location = req.query.location || null;
    let type = req.query.type || null;
    let user = authHelper.parseRole(req);
    let sqlFilter = "";
    let sql, args, results, isManager;

    if (location == null || location == "") {
        res.status(400).json({"message": "location is required"});
        return;
    }

    if (type) {
        sqlFilter += " AND tg.Type = ?";
        args = [location, type];
    } else {
        args = [location];
    }

    // If this user does NOT have elevated permissions, then they can only get tasks that are NOT restricted
    if (!(user.isAdmin || user.isWmanager || user.isSmanager || user.roles.indexOf("w_troubleshoot") >= 0)) {
        sqlFilter += " AND tg.isRestricted = 0";
        isManager = false;
    } else {
        isManager = true;
    }

    sql = `
        SELECT
            tg.*,
            tc.tasks,
            tc.units,
            CONCAT_WS(' ', u.FirstName, u.LastName) AS Username,
            tc.SourceContainer
        FROM task_group tg
        INNER JOIN (
            SELECT
                TaskGroupID,
                COUNT(*) AS tasks,
                (SUM(Quantity) - IFNULL(SUM(QuantityFilled), 0)) AS units,
                # For backfill tasks, all tasks will have the same SourceContainer
                SourceContainer
            FROM task
            WHERE DateCompleted IS NULL
            GROUP BY TaskGroupID
        ) AS tc ON tc.TaskGroupID = tg.ID
        LEFT JOIN user u ON tg.AssignedUserID = u.ID
        WHERE tg.DateCompleted IS NULL AND tg.SourceLocation = ?
        AND tg.DateUserAssigned > DATE_ADD(NOW(), INTERVAL -30 MINUTE)
        ${sqlFilter}
        GROUP BY tg.ID
        ORDER BY tg.Priority DESC, tg.DateDue ASC, tg.ID ASC`;

    try {
        [results] = await ro_pool.query(sql, args);

        if (results.length) {
            res.status(200).json({"data": results, "isManager": isManager, "user": user.id});
        } else {
            res.status(204).json({"message": `No in-progress tasks are available for your location: ${location}`});
        }
    } catch (error) {
        logger.info("get_inprogress ERROR: ", {error});
        res.status(500).json({"message": "Unable to retrive in-progress task groups."});
    }
};

exports.taskgroup_unlock = async function(req, res) {
    let taskgroup_id = req.query.taskgroup_id;
    let sql, args, results, error_message;
    let sql_add = "";

    if (taskgroup_id == null || taskgroup_id == "") {
        error_message = "taskgroup_id is required!";
        res.status(400).json({"message": error_message});
        return;
    }

    let user = authHelper.parseRole(req);

    if (!user.isAdmin && !user.isWmanager && !user.isSmanager && !(user.roles.indexOf("w_troubleshoot") >= 0)) {
        sql_add = `AND AssignedUserID = ${user.id}`;
    }

    sql = `
        UPDATE task_group
        SET AssignedUserID = NULL, DateUserAssigned = NULL
        WHERE ID = ?
        ${sql_add}`;
    args = [taskgroup_id];

    try {
        [results] = await pool.query(sql,args);
    } catch (err) {
        console.log(err);
        let error_message = `A error occured while attempting to Open task for ID ${taskgroup_id}`;
        res.status(500).json({"message": error_message});
        return;
    }

    if (results.affectedRows === 0) {
        error_message = "A manager or the person working on the task is required to unlock!";
        res.status(401).json({"message": error_message});
    } else {
        res.status(200).json({"message":`Batch ${taskgroup_id} has been opened.`});
    }
};

exports.get_setup = async function(req, res) {
    let id = req.query.id;
    let sql, args, results, isManager;

    // Check if User has claimed task
    let user = authHelper.parseRole(req);

    if (user.isAdmin || user.isWmanager || user.isSmanager || user.roles.indexOf("w_troubleshoot") >= 0) {
        isManager = true; // User has elevated permission and is allowed to receive restricted tasks
    } else {
        isManager = false;
    }
    // Does this change if User is Admin/Manager?

    sql = `UPDATE task_group
        SET AssignedUserID = ?, DateUserAssigned = NOW()
        WHERE ID = ?
        AND ((DateUserAssigned <= DATE_ADD(NOW(), INTERVAL -30 MINUTE)
        OR DateUserAssigned is NULL) OR (AssignedUserID = ?))`;

    args = [user.id, id, user.id];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(`ERROR: GET Taskgroup setup failed for taskgroup ${id}`, error);
        res.status(500).json({"message": `Taskgroup setup failed for taskgroup ${id}`});
        return;
    }

    if (results.affectedRows === 0 ) {
        let userData;
        sql = `
            SELECT u.FirstName, u.LastName
            FROM task_group tg
            LEFT JOIN user u
            ON tg.AssignedUserID = u.ID
            WHERE tg.ID = ?`;
        args = [id];

        try {
            [userData] = await ro_pool.query(sql, args);
        } catch (error) {
            console.log(`ERROR: GET Taskgroup setup failed for taskgroup ${id}`, error);
            res.status(500).json({"message": `Taskgroup setup failed for taskgroup ${id}`});
            return;
        }

        res.status(400).json({"message": `This Batch is already being worked on by ${userData[0].FirstName} ${userData[0].LastName}`, "isManager": isManager});
        return;
    }

    args = [id];
    sql  = `
        SELECT ReferenceID FROM task
        WHERE TaskGroupID = ?
        AND Type = 'Online'
        AND TargetContainer IS NULL
        GROUP BY ReferenceID`;
    try {
        [results] = await ro_pool.query(sql, [args]);
    } catch (error) {
        logger.info("get_setup ERROR:", {error});
        res.status(400).json({"message": "Error occured. Unable to retrieve setup details.", "isAdmin": false});
        return;
    }

    if (results.length == 0) {
        res.status(404).json({"message": "No setup necessary."});
        return;
    }

    let orders = [];
    for (let row of results) {
        orders.push(row["ReferenceID"]);
    }

    let data = {
        "containerCount": results.length,
        "orders"        : orders,
        "isAdmin"       : isManager
    };

    res.status(200).json({"data": data});

};

exports.post_setup = async function(req, res) {
    let id = req.body.id;
    let container = req.body.container;
    let user = authHelper.parseRole(req);

    let sql, args, result, results;
    try {
        result = await apiRequest.get(req, "/taskgroup/setup", {"id": id});

        if (result.data.containerCount == 0) {
            res.status(404).json({"message": "No containers left"});
            return;
        }
    } catch (error) {
        res.status(error.status).json({"message": error.message});
        return;
    }

    let referenceId = result.data.orders[0]; // Assign to "container"

    /* Error checking for the container that the user provided us:
     * 1. The "container" MUST exist
     * 2. The "container" MUST have a Type of "TOT" (Tote)
     * 3. The same "container" MUST NOT be used for the same TaskGroupID
     */

    // The "container" MUST exist
    // The "container" MUST have a Type of "TOT" (Tote)
    sql = `
        SELECT Type FROM container WHERE ID = ?
        ;
        SELECT COUNT(*) AS count FROM task WHERE TaskGroupID = ? AND TargetContainer = ?`;
    args = [container, id, container];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(`ERROR: POST Taskgroup setup failed for container ${container} and taskgroup ${id}`, error);
        res.status(500).json({"message": `Taskgroup setup failed for container ${container}`});
        return;
    }

    let containerTypeResults = results[0];
    if (containerTypeResults.length == 0 || containerTypeResults[0]["Type"] != "TOT") {
        res.status(400).json({"message": `Either the container ${container} doesn't exist, or it is not a TOTE`});
        return;
    }

    let containerReuseResults = results[1];
    if (containerReuseResults[0]["count"] > 0) {
        res.status(400).json({"message": "You must not use the same container multiple times in the same TaskGroup. Please choose a different container."});
        return;
    }

    sql  = "UPDATE task SET TargetContainer = ?, AssignedUserID = ? WHERE ReferenceID = ?";
    args = [container, user.id, referenceId];

    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(`ERROR: POST Taskgroup setup failed for container ${container} and referenceID ${referenceId}`, error);
        res.status(500).json({"message": `Taskgroup setup failed for container ${container}`});
        return;
    }

    res.status(200).json({"message": `Tote ${container} assigned to order ${referenceId}.`});
};

exports.fulfill_task_group = async function(req, res) {
    let task_id = parseInt(req.body.task_id);
    let sql, args, message;

    if (!task_id) {
        res.status(400).json({"message": `Task ID is required`});
        return;
    }

    // For Now closing and not checking if the all tasks are done
    sql = `
        UPDATE task_group tg
        SET tg.DateFulfilled = NOW()
        WHERE tg.ID = (
                # Extract only the task group ID since the operand needs exactly one column
                SELECT TaskGroupID FROM (
                    # Count the fulfilled tasks, only SELECTing the task group ID if there are no null fulfilled tasks (100% fulfilled)
                    SELECT TaskGroupID, COUNT(*) AS FulfilledTasks
                    FROM task
                    WHERE TaskGroupID = (
                        SELECT TaskGroupID FROM task WHERE ID = ?
                    )
                    AND DateFulfilled IS NULL
                    HAVING FulfilledTasks = 0
                ) AS t
        )`;
    args = [task_id];

    try {
        var [result] = await pool.query(sql, args);
        if (result.affectedRows == 0) {
            console.debug(`Task Group still has unfulfilled tasks or has been already been fulfilled`);
            message = `Task Group still has unfulfilled tasks or has already been fulfilled`;
        } else {
            console.debug(`Task Group has been fulfilled since all tasks are fulfilled`);
            message = `Task Group has been fulfilled since all tasks are fulfilled`;
        }
        res.status(200).json({"message": message});
        return;
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }
};

exports.close_task_group = async function(req, res) {
    let task_group_id = parseInt(req.body.task_group_id);
    let sql, args, results, message;

    if (!task_group_id) {
        res.status(400).json({"message": `Task Group ID is required!`});
        return;
    }
    logger.info("Starting...");

    let user = authHelper.parseRole(req);
    console.log(`User ${user.id} is closting Task Group ${task_group_id} and related tasks, RO, freeing inventory`);

    // For Now closing and not checking if the all tasks are done
    sql = `
    UPDATE replenish_order ro
    INNER JOIN task t ON t.RowID = ro.RowID AND t.TaskGroupID = ?
    SET ro.QuantityFilled = IFNULL(ro.QuantityFilled, 0), ro.DateFulfilled = NOW()
    WHERE ro.DateFulfilled is null
    ;
    UPDATE task
    SET DateCompleted = IFNULL(DateCompleted, NOW()), DateFulfilled = NOW(),
        QuantityFilled = IFNULL(QuantityFilled, 0), QuantityDelivered = IFNULL(QuantityDelivered, 0)
    WHERE TaskGroupID = ? AND Type IN ('Pick', 'CasePick')
    ;
    UPDATE task_group SET DateCompleted = NOW(), DateFulfilled=NOW() where ID = ? AND (Type = 'Pick' OR Type = 'CasePick')
    ;
    ## FREE reserved inventory for closed taskgroup.
    UPDATE inventory i
    INNER JOIN task t ON t.ID = i.TaskID
    SET i.TaskID = null
    WHERE i.TaskID is not null AND t.TaskGroupID = ? AND t.DateFulfilled is not null
    ;
    ## FREE Reserved Inventory for tasks that don't exist anymore
    UPDATE inventory i
    LEFT JOIN task t ON t.ID = i.TaskID
    SET i.TaskID = null
    WHERE i.TaskID is not null AND t.ID is null`;
    args = [task_group_id, task_group_id, task_group_id, task_group_id];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("close_task_group:", {error});
        res.status(500).json({"message": `Error occured while attempting to close task_group ${task_group_id}.`});
        return;
    }
    message = `CLOSED: ${results[0].affectedRows} Replenish Orders, ${results[1].affectedRows} Tasks, ${results[2].affectedRows} Task Group, `;
    message += `${results[3].affectedRows} Inventory freed.`;
    res.status(200).json({"message": message});
    console.log(message, `Plus ${results[4].affectedRows} Inventory Freed for tasks that don't exist.`);
};

exports.get_details = async function(req, res) {
    let ID = req.query.taskGroupID || req.body.taskGroupID;
    let location = req.query.locationID || req.body.locationID;

    if (!ID || !location) {
        let error_message = "taskGroupID and locationID are required!";
        res.status(400).json({"message": error_message});
    }

    let sql = `Select Timezone from location where ID = ?`;
    let args = [location];
    let results;
    let timezone;
    try {
        [results] = await ro_pool.query(sql, args);
        timezone = results[0].Timezone;
    } catch (error) {
        logger.error("taskgroup/get_details", {error});
        res.status(400).json({"message": `unable to get location timezone data: ${location}.`});
        return;
    }
    if (results) {
        sql = `
        SELECT tg.ID, tg.SourceLocation, tg.TargetLocation, tg.Priority,
        tg.Type, tg.ReferenceID, tg.isRestricted, tg.isReserve, tg.AssignedUserId, t.units, t.tasks, t.unitsLeft, tasksLeft,
        tg.DateDue,
        tg.DateCreated,
        tg.DateCompleted,
        tg.DateFulfilled,
        tg.DateUserAssigned,
        tg.CartType
        FROM task_group tg
        INNER JOIN (
            SELECT TaskGroupID, COUNT(*) AS tasks, SUM(Quantity) AS units,
            SUM(CASE WHEN DateCompleted IS NULL THEN (Quantity - IFNULL(QuantityFilled, 0)) ELSE 0 END) AS unitsLeft,
            SUM(CASE WHEN DateCompleted IS NULL THEN 1 ELSE 0 END) AS tasksLeft
            FROM task
            GROUP BY TaskGroupID
        ) AS t ON t.TaskGroupID = tg.ID
        WHERE ID = ?`;
        args = [ID];
        try {
            let [results] = await ro_pool.query(sql, args);
            if (results.length > 0) {
                res.status(200).json({"data": results});
            } else {
                res.status(400).json({"message": `No TaskGroup were found for task_group ID: ${ID}.`});
            }
        } catch (error) {
            logger.error("taskgroup/get_details", {error});
            res.status(500).json({"message": `Error occured while attempting to get task_group ID: ${ID}.`});
        }
    }
};
