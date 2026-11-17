const apiRequest = require("../library/apiRequest");
const helpers = require("../library/helperFn");
const moment = require("moment-timezone");
const logger = require("../library/logger")("microwarehouse-api:mw_api_cross_dock");

exports.cross_dock_get_locations = async function(req, res) {
    let sourceContainer = req.query["SourceContainer"] || null; // Required
    let data = [];
    let sql, args, results, validation;

    if (!sourceContainer) {
        res.status(400).json({"message": "SourceContainer must be provided"});
        return;
    }

    // The first query is to validate that the container exists, and that it also has a type of RCV.
    // The second query gets stores that are assigned to this warehouse which also have Cross Dock
    // enabled. In addition to this, also get the first TaskID for each destination
    args = [sourceContainer, sourceContainer, sourceContainer];
    sql = `
        SELECT Type FROM container WHERE ID = ?
        ;
        SELECT
            DISTINCT tg.TargetLocation AS ID,
            c.Type
        FROM inventory i
        INNER JOIN task t ON t.ID = i.TaskID
        INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
        INNER JOIN container c ON c.ID = tg.TargetLocation
        WHERE i.ContainerID = ?
        UNION
        SELECT LocationID, 'WRH' AS ID FROM container WHERE ID = ?`;

    try {
        [results] = await ro_pool.query(sql, args);
        validation = results[0];
        results = results[1];
    } catch (error) {
        logger.error("cross_dock_get_locations:", {error});
        res.status(500).json({"message": "Unable to get locations for Cross Dock"});
        return;
    }

    if (!(validation.length && validation[0]["Type"] === "RCV")) {
        res.status(400).json({"message": "That container ID is not valid"});
        return;
    }

    for (let row of results) {
        data.push({
            "ID": row["ID"],
            "Type": row["Type"]
        });
    }

    res.status(200).json({"data": data});
};

exports.cross_dock_get_task = async function(req, res) {
    let sourceContainer = req.query["SourceContainer"] || null;
    let barcode = req.query["Barcode"] || null;
    let taskId = req.query["TaskID"] || null;
    let sql, args, results, validation, keycode, locationId, quantity, data;

    if (!(sourceContainer && barcode || taskId)) {
        res.status(400).json({"message": "Either a source container and barcode must be provided, or a task ID"});
        return;
    }

    // Get the keycode if a barcode/SKU was provided
    try {
        args = [barcode, barcode];
        sql = `SELECT Keycode FROM product_barcode WHERE Barcode = ? OR Keycode = ?`;
        [results] = await ro_pool.query(sql, args);

        if (!results.length) {
            res.status(400).json({"message": "Invalid keycode"});
            return;
        } else {
            keycode = results[0]["Keycode"];
        }
    } catch (error) {
        logger.error("cross_dock_get_task:", {error});
        res.status(500).json({"message": "Unable to get tasks for Cross Dock"});
        return;
    }

    // If the user didn't provide a Task ID, then we'll try to get one from the source container and keycode
    if (!taskId) {
        args = [sourceContainer, sourceContainer, keycode];
        sql = `
            SELECT Type FROM container WHERE ID = ?
            ;
            SELECT
                IFNULL(tg.TargetLocation, c.LocationID) AS LocationID, # Inventory without a task ID is overage, and goes to the warehouse
                IFNULL(t.Quantity, COUNT(*)) - IFNULL(t.QuantityFilled, 0) AS Quantity,
                i.TaskID
            FROM inventory i
            INNER JOIN container c ON c.ID = i.ContainerID # Get the Warehouse ID of the container
            LEFT JOIN task t ON t.ID = i.TaskID
            LEFT JOIN task_group tg ON tg.ID = t.TaskGroupID
                WHERE i.ContainerID = ? AND i.Keycode = ?
            GROUP BY i.TaskID
            ORDER BY -i.TaskID DESC # The negative sign makes NULL go last`;

        try {
            [results] = await ro_pool.query(sql, args);
            validation = results[0];
            results = results[1];
        } catch (error) {
            logger.error("cross_dock_get_task:", {error});
            res.status(500).json({"message": "Unable to get tasks for Cross Dock"});
            return;
        }

        if (!(validation.length && validation[0]["Type"] === "RCV")) {
            res.status(400).json({"message": "That container ID is not valid"});
            return;
        }

        // If there were no results, return 200 OK with no data
        if (!results.length) {
            res.status(200).json({"data": null});
            return;
        }

        // If no Task ID was found, return 200 OK with no data
        if (results[0]["TaskID"] === null) {
            res.status(200).json({"data": null});
            return;
        }

        // If still no task ID was found, this is OK and is overage, so it'll go to the warehouse
        locationId = results[0]["LocationID"];
        quantity = results[0]["Quantity"];
        taskId = results[0]["TaskID"];
    } else {
        // If the user provided a task ID, get the target location and the quantity
        args = [taskId];
        sql = `
            SELECT
                tg.TargetLocation AS LocationID,
                t.Quantity - IFNULL(t.QuantityFilled, 0) AS Quantity
            FROM task t
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            WHERE t.ID = ?`;

        try {
            [results] = await ro_pool.query(sql, args);
        } catch (error) {
            logger.error("cross_dock_get_task:", {error});
            res.status(500).json({"message": "Unable to get tasks for Cross Dock"});
            return;
        }

        if (!results.length) {
            // The task ID doesn't exist, but this is OK so just send it as a 200 with no data
            res.status(200).json({"data": null});
            return;
        }

        locationId = results[0]["LocationID"];
        quantity = results[0]["Quantity"];
    }

    data = {
        "LocationID": locationId,
        "Quantity": quantity,
        "TaskID": taskId
    };

    res.status(200).json({"data": data});
};

exports.cross_dock_update_task = async function(req, res) {
    let sourceContainer = req.body["SourceContainer"] || null; // Required
    let targetContainer = req.body["TargetContainer"] || null; // Required
    let barcode = req.body["Barcode"]; // Required
    let quantity = req.body["Quantity"] || null; // Required
    let taskId = req.body["TaskID"] || null; // Optional
    let sql, args, results, keycode;

    if (!sourceContainer || !targetContainer || !barcode || !quantity) {
        res.status(400).json({"message": "SourceContainer, TargetContainer, Barcode, and Quantity must be provided"});
        return;
    }

    // Get the keycode if a barcode/SKU was provided
    try {
        args = [barcode, barcode];
        sql = `SELECT Keycode FROM product_barcode WHERE Barcode = ? OR Keycode = ?`;
        [results] = await pool.query(sql, args);

        if (!results.length) {
            res.status(400).json({"message": "Invalid keycode"});
            return;
        } else {
            keycode = results[0]["Keycode"];
        }
    } catch (error) {
        logger.error("cross_dock_get_task:", {error});
        res.status(500).json({"message": "Unable to get tasks for Cross Dock"});
        return;
    }

    // Verify that sourceContainer is a valid RCV container, and targetContainer is a valid CRT container
    // validate the destination matches the task (cart parent location is the same as task destination)
    args = [sourceContainer, targetContainer];
    sql = `
        SELECT Type FROM container WHERE ID = ?
        ;
        SELECT Type FROM container WHERE ID = ?`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        res.status(500).json({"message": "Unable to update the task"});
        return;
    }

    if (!(results[0].length && results[0][0]["Type"] === "RCV" &&
          results[1].length && results[1][0]["Type"] === "CRT")) {
        res.status(400).json({"message": "The source container and/or target container are not valid"});
        return;
    }

    if (taskId) {
        args = [taskId];
        sql = `SELECT Quantity - IFNULL(QuantityFilled, 0) AS QuantityRequired FROM task WHERE ID = ?`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            res.status(500).json({"message": "Unable to update the task"});
            return;
        }

        // If there is no found task, just set it to NULL and continue on as normal
        if (!results.length) {
            taskId = null;
        } else {
            // Since a task exists, it will need to be updated
            if (quantity > results[0]["QuantityRequired"]) {
                res.status(400).json({"message": "Too many products were entered"});
                return;
            }

            sql = "";
            args = [];

            // Increment QuantityFilled
            args = [quantity, targetContainer, taskId];
            sql = `
                UPDATE task
                SET
                    QuantityFilled = IFNULL(QuantityFilled, 0) + ?,
                    TargetContainer = ?
                WHERE ID = ?`;

            // Set DateCompleted to now if we have met the required quantity
            if (quantity == results[0]["QuantityRequired"]) {
                args.push(taskId);
                sql += `; UPDATE task SET DateCompleted = NOW() WHERE ID = ?`;
            }

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                res.status(500).json({"message": "Unable to update the task"});
                return;
            }
        }
    }

    // Move the inventory, allowing overages from the RCV container to the CRT
    try {
        await apiRequest.put(req, "move_inventory", {
            "source_container": sourceContainer,
            "target_container": targetContainer,
            "keycode": keycode,
            "quantity": quantity,
            "task_id": taskId,
            "allowOverage": true,
            "process": "cross_dock_update_task"
        });
    } catch (error) {
        let status = error.status;
        let message = error.message;
        res.status(status).json({"message": message});
        return;
    }

    res.status(200).json({"message": `${quantity}x of ${barcode} has been moved from ${sourceContainer} to ${targetContainer}`});
};

exports.cross_dock_replenish_order = async function(req, res) {
    let containerId = req.body.ContainerID || null;
    let crossDockStores = [];
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let rowId = moment.utc().valueOf(); // The Row ID in replenish_order is the current unix timestamp
    let sql, args, results, dateDue;

    if (!containerId) {
        res.status(400).json({"message": "The RCV container ID must be provided"});
        return;
    }

    args = [containerId];
    sql = `
        SELECT l.ID
        FROM container c
        INNER JOIN location l ON l.WarehouseID = c.LocationID
        WHERE c.ID = ? AND l.isCrossDockEnabled = 1`;

    // Get the stores that have cross-dock enabled that are a part of this warehouse
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("cross_dock_replenish_order:", {error});
        res.status(500).json({"message": "Unable to get stores that are cross-dock enabled for this warehouse"});
        return;
    }

    for (let result of results) {
        crossDockStores.push(result["ID"]);
    }

    if (crossDockStores.length === 0) {
        res.status(400).json({"message": "There are no stores that are cross-dock enabled for this warehouse"});
        return;
    }

    args = [containerId];
    sql = `CALL ${config.sql_database_for_sp}.replenish_order_generate_cross_dock(?)`;

    try {
        [results] = await pool.query(sql, args);
        results = results[0]; // Take the 0th index since it's a stored procedure
    } catch (error) {
        logger.error("cross_dock_replenish_order:", {error});
        res.status(500).json({"message": "Unable to get the replenishment order for Cross-Dock"});
        return;
    }

    args = [];

    for (let row of results) {
        let storeId        = row["Location"];       // ID of the target store
        let warehouseId    = row["WarehouseID"];    // ID of the source warehouse
        let daysOfCoverage = row["DaysOfCoverage"]; // Days of coverage for the store
        let keycode        = row["Keycode"];        // Keycode of the product to be replenished
        let qtyTotal       = row["QtyTotal"];       // Quantity in the warehouse's RSV container
        let qtyOrdered     = row["QtyOrdered"];     // Quantity that has been requested through
        let qtyStore       = row["QtyStore"];       // Quantity of the product in the store
        let AWS            = row["AWS"];            // Average Weekly Sales
        let ADS            = row["ADS"];            // Daily Sales, must be greater than 0 so new items can start at 0.1
        let MDU            = row["MDU"];            // Minimum Display Units
        let isExtAisle     = row["isExtAisle"];     // Is Extended Aisle
        let OOS            = row["InventoryOOS"];   // If the store is out-of-stock (0 or 1)
        let factor         = row["Factor"];         // Factor from the table replenish_factor_calendar
        let priority       = 1;                     // 1 = Standard, 2 = Fasttrack
        let replenishAmount;

        if (isExtAisle) {
            replenishAmount = MDU;         // Replenish up to MDU
            replenishAmount -= qtyOrdered; // Subtract amount already ordered
        } else {
            replenishAmount = ADS * daysOfCoverage;

            // Inventory OOS handling, double the order if store is out of stock
            if (OOS == 1) {
                replenishAmount *= settings.replenish.factor_OOS;
                priority = 2;
            }

            // Multiply the replenishment amount by any bonus factor that we might have for this particular location/keycode combination
            replenishAmount = Math.ceil(replenishAmount * factor);

            // Use greater value of the MDU or Replenish Amount
            if (MDU && MDU > replenishAmount) {
                replenishAmount = MDU;
            }
            // And subtract quantity from any outstanding replenish_order.
            replenishAmount -= qtyOrdered;
        }

        // A row will only be inserted into replenishment_order
        // Only push an object into the replenishment array if it needs to be replenished
        // (meaning we currently have less items in the inventory than the required replenishment amount)
        // Once the array has been populated, it will be looped for each object and an SQL query will be fired off for each one
        if (qtyStore < replenishAmount) {
            let quantity = replenishAmount - qtyStore;

            if (priority == 2) {
                dateDue = locationsETA[storeId]["Fasttrack"]["DatePickETA"];
            } else {
                dateDue = locationsETA[storeId]["Standard"]["DatePickETA"];
            }

            args.push([
                rowId,       // ID
                keycode,     // Keycode
                warehouseId, // SourceLocation
                storeId,     // TargetLocation
                AWS,         // AWS
                MDU,         // MDU
                qtyStore,    // TargetInventory
                quantity,    // Quantity
                null,        // QuantityFilled
                qtyTotal,    // SourceInventory
                "CrossDock", // Priority
                dateDue,     // DateDue
                null,        // DateFulfilled
                "CrossDock"  // OrderType
            ]);
        }
    }

    if (args.length) {
        // INSERT if the row doesn't exist yet
        sql = `
            INSERT IGNORE INTO replenish_order
            (ID, Keycode, SourceLocation, TargetLocation, AWS, MDU, TargetInventory, Quantity, QuantityFilled, SourceInventory, Priority, DateDue, DateFulfilled, OrderType)
            VALUES ?`;
        try {
            [results] = await pool.query(sql, [args]);
        } catch (error) {
            logger.error("cross_dock_replenish_order:", {error});
            res.status(500).json({"message": "Unable to get the replenishment order for Cross-Dock"});
            return;
        }

        console.log(moment().format(), `Cross-Dock replenishment order processed. ${args.length} rows inserted with ID ${rowId}`);
    } else {
        console.log(moment().format(), "Cross-Dock replenishment order processed. No new rows inserted");
    }

    // Create Cross Dock tasks for this replenishment
    try {
        await apiRequest.post(req, "cross_dock/replenish_order_to_task", {"LocationID": containerId});
    } catch (error) {
        logger.error("grouping pick tasks", {error});
    }

    res.status(200).json({"message": "Cross-Dock replenishment has been processed"});
};

exports.cross_dock_replenish_order_to_task = async function(req, res) {
    let locationId = req.body.LocationID || null;
    let tasksCreated = 0;
    let sql, args, results;

    if (!locationId) {
        res.status(400).json({"message": "The location ID must be provided"});
        return;
    }

    // Verify that the location has Cross Dock enabled, and call the stored procedure
    args = [locationId, locationId];
    sql = `
        SELECT l.isCrossDockEnabled, l.ID
        FROM container c
        INNER JOIN location l ON l.ID = c.LocationID
        WHERE c.ID = ?
        ;
        CALL ${config.sql_database_for_sp}.replenish_order_cross_dock_to_task(?)`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("cross_dock_replenish_order_to_task:", {error});
        res.status(500).json({"message": "Unable to create tasks from Cross Dock replenishment"});
        return;
    }

    // Verify that the location has Cross Dock enabled
    if (results[0].length && results[0][0]["isCrossDockEnabled"] === 1) {
        results = results[1]; // Store the results of the stored procedure (index 1)
    } else {
        res.status(400).json({"message": "This location is not valid for performing a Cross Dock replenish order"});
        return;
    }

    results.push({}); // Add an empty object at the end so we easily know when we've completed the final iteration
    let prevTargetLocation = results[0]["TargetLocation"];
    let perStoreArray = [];

    for (let row of results) {
        let rowId          = row["RowID"];          // Row ID from the replenish order
        let keycode        = row["Keycode"];        // Keycode of the product to replenish
        let sourceLocation = row["SourceLocation"]; // ID of the warehouse
        let targetLocation = row["TargetLocation"]; // ID of the store to replenish
        let quantity       = row["Quantity"];       // Original quantity from the replenish order
        let totalDemand    = row["totalDemand"];    // The total demand across all stores
        let wrhTotalQty    = row["wrhTotalQty"];    // Amount of products available for replenishment in this warehouse
        let taskQty        = row["taskQty"];        // How many products are already assigned to tasks

        // The currently-requested quantity is the original replenish order quantity subtracted by the existing tasks' quantity
        let requestedQuantity = parseInt(quantity) - parseInt(taskQty);

        // Process the results for this location we switched stores, or if we processed the final row
        if (prevTargetLocation != targetLocation) {
            let wrhResults;
            args = [perStoreArray, perStoreArray[0][2]];
            sql = `
                CREATE TEMPORARY TABLE IF NOT EXISTS temp_ro LIKE replenish_order
                ;
                TRUNCATE temp_ro
                ;
                INSERT INTO temp_ro (RowID, Keycode, SourceLocation, TargetLocation, Quantity) VALUES ?
                ;
                SELECT
                    ro.RowID,
                    ro.Keycode,
                    SourceLocation,
                    ro.TargetLocation,
                    ro.Quantity,
                    i.ID AS ContainerID,
                    i.Type,
                    i.Priority,
                    i.wrhQuantity
                FROM temp_ro ro
                INNER JOIN (
                    SELECT
                        i.Keycode,
                        c.ID,
                        c.Type,
                        c.SubType,
                        c.ParentID,
                        c.LocationID,
                        c.isApparel,
                        ct.Priority,
                        COUNT(c.ID) AS wrhQuantity
                    FROM container c
                    INNER JOIN inventory i ON i.ContainerID = c.ID
                    INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType = c.SubType
                    WHERE c.LocationID = ? AND TaskID IS NULL AND c.Type IN ('RCV')
                    GROUP BY i.Keycode, c.ID
                ) AS i ON i.Keycode = ro.Keycode
                ORDER BY ro.TargetLocation, ro.RowID, i.Priority, i.wrhQuantity ASC`;

            try {
                [wrhResults] = await pool.query(sql, args);
                wrhResults = wrhResults[3]; // Get the SELECT result (index 3)
            } catch (error) {
                logger.error("cross_dock_replenish_order_to_task:", {error});
                return;
            }

            // Parse the data, pushing data into pickList which will insert new CrossDock tasks and reserve inventory
            let pickList = [];
            let currProduct = null;
            let currQuantity = 0;

            for (let row of wrhResults) {
                /* Example for row:
                 * RowID, Keycode,  SourceLocation, TargetLocation, Quantity, ContainerID,     Type,  Priority, wrhQuantity
                 * 1,     42543015, "LYN1-WRH",     "BUR1-STR",     5,        "LYN1-RCV-TST1", "RCV", 1,        2
                 * 2,     42709244, "LYN1-WRH",     "BUR1-STR",     7,        "LYN1-RCV-TST1", "RCV", 1,        3
                 *
                 * Example for pickList:
                 *     Keycode,  RowID, Quantity, SourceContainer, Type
                 * [ [ 42543015, 1,     3,        "LYN1-001-01-A", "CrossDock" ],
                 *   [ 42709244, 2,     3,        "LYN1-001-02-A", "CrossDock" ] ]
                 */
                if (row.Keycode !== currProduct) {
                    // Reset currQuantity if it's a new product
                    currProduct = row.Keycode;
                    currQuantity = row.Quantity;
                }

                // Skip rows if we satisfied the product demand
                if (currQuantity <= 0) {
                    continue;
                }

                if (row.wrhQuantity >= currQuantity) {
                    // If this container can satisfy the rest of our desired quantity
                    pickList.push([row.Keycode, row.RowID, currQuantity, row.ContainerID, "CrossDock"]);
                    currQuantity = 0;
                } else {
                    // If this container can only satisfy some of our remaining desired quantity
                    pickList.push([row.Keycode, row.RowID, row.wrhQuantity, row.ContainerID, "CrossDock"]);
                    currQuantity -= row.wrhQuantity;
                }
            }

            // Create tasks if the pickList has been populated
            if (pickList.length) {
                let sql, args, taskResults, taskID;
                args = [pickList];
                sql = `INSERT INTO task (Keycode, RowID, Quantity, SourceContainer, Type) VALUES ?`;
                tasksCreated++;

                try {
                    [taskResults] = await pool.query(sql, args);
                } catch (error) {
                    logger.error("replenish_order_to_task - task creation:", {error});
                    return;
                }

                taskID = parseInt(taskResults.insertId); // Save the first task ID
                sql = [];
                args = [];

                // Reserve the inventory in the RCV containers for the tasks
                for (let i in pickList) {
                    i = parseInt(i); // Prevent string concatenation
                    sql.push("UPDATE inventory SET TaskID = ? WHERE ContainerID = ? and Keycode = ? AND TaskID IS NULL LIMIT ?");
                    args.push([taskID + i, pickList[i][3], pickList[i][0], pickList[i][2]]);
                }

                try {
                    await helpers.largeSQLQuery(sql, args);
                } catch (error) {
                    logger.error("reserving inventory", {error});
                }

                console.log(moment().format(), `REPLENISH ORDER ${prevTargetLocation}: ${pickList.length} pick tasks created starting with ID: ${taskID}`);
            }

            perStoreArray = []; // Reset the array to use for the next store
        }

        // Add to the perStoreArray
        if (targetLocation) {
            // If the warehouse's total quantity is < of the total demand, then we need to recalculate the requested quantity
            if (wrhTotalQty < totalDemand) {
                // Scale the requested quantity down by multiplying it by the warehouse's total quantity by the total demand
                requestedQuantity = Math.ceil(requestedQuantity * (wrhTotalQty / totalDemand));
            }

            perStoreArray.push([rowId, keycode, sourceLocation, targetLocation, requestedQuantity]);
            prevTargetLocation = targetLocation;
        }
    }

    // Finally, group all tasks that have been created
    try {
        await apiRequest.get(req, "taskgroup/group_cross_dock_tasks");
    } catch (error) {
        logger.error("grouping pick tasks", {error});
    }

    let message = `${tasksCreated} Cross Dock tasks have been created from Replenishment Order`;
    console.log(moment().format(), message);
    res.status(200).json({"message": message});
};
