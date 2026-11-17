/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const apiRequest = require("../library/apiRequest");
const helpers = require("../library/helperFn");
const authHelper = require("../library/authHelper");
// const csvtojson = require("csvtojson");
// const json2csv = require("json2csv");
const csvConverter = require("json-2-csv");
const moment = require("moment-timezone");
const fs = require("fs");
const settings = require("../config/settings");
const logger = require("../library/logger")("microwarehouse-api:mw_api_replenish_order");

exports.replenish_order = async function(req, res) {
    let forced = (req.body.forced == "true" || req.body.forced == 1) ? true : false;
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let roID = moment.utc().valueOf();
    let sql, args, results, message, DateDue;

    // First attempt to lock in this process:
    sql = `
        UPDATE process_lock
        SET DateLocked = NOW()
        WHERE
            ProcessName = 'replenish_order'
            AND (DateLocked is null OR DateLocked < DATE_ADD(NOW(), INTERVAL -40 MINUTE))`;
    try {
        if (!forced) {
            // Don't update the lock when forcing a replenishment run
            [results] = await pool.query(sql);
        }
    } catch (error) {
        logger.error("replenish_order lock", {error});
        res.status(500).json({"message": "Error occured attempting to create a lock for replenish order."});
        return;
    }

    // Return response right away to prevent Lambda retry. Must return 200, cannot timeout with 504
    if (forced || results.affectedRows) {
        message = "Replenishment order job started...";
        console.log(moment().format(), message);
        res.status(200).json({"message": message});
    } else { // When locked, Return message and cancel execution
        message = "Replenishment Order job cannot start at this time. Please wait for the next hour.";
        console.log(moment().format(), message);
        res.status(200).json({"message": message});
        return;
    }

    /*********************************************************
     *  All Replenishment queries use replenish_schedule as starting point!
     * - UtcHour     = Hour of day based on local time, converted to UTC - to be compared against Current UTC hour.
     * - LocalDate   = Local Date for FactorCalendar use
     * - WarehouseID = Warehouse for this store.
     * NOTE: Need to do the complex date conversion to account for DST and those Days and Times when time changes.
     *********************************************************

    /* SQL query explanation:
     * Step 0: str - Get store details and associated Warehouse based on current hour and replenish_schedule.
     * Step 1: wrh - Add total warehouse quantity of items per warehouses in str.
     * Step 2: sales - In the sale_transaction table, get the sum of quantity ordered in the past 7 days.
     *         - Calculate Average daily sales, mix in InventoryOOS
     * Step 3: inv - Add current inventory levels per store
     * Step 4: ro - Add current replenish_order levels for products
     * Step 5: p - get more product details.
     * Step 6: cal - get replenish_order_calendar factor
     * Step 7: bl - remove all product that is currently on the product_blacklist
     */
    try {
        // Close all old replenish orders that do not have associated tasks.
        sql = `
            CALL ${config.sql_database_for_sp}.close_ro_without_tasks()
            ;
            CALL ${config.sql_database_for_sp}.replenish_order_generate()`;
        [results] = await pool.query(sql);

        // Stored procedures return 2 results: [TextRow, ResultSetHeader], so 2 SP returns 4 results. Therefore, we only care about indices 0 and 2
        console.log(`replenish_order_case: ${results[0][0].closedReplenish} replenish orders without tasks closed.`);
        results = results[2];
    } catch (error) {
        logger.error("replenish_order SQL:", {error});
        return;
    }

    logger.info("Replenishment order - Processing", {totalRows: results.length});
    // Calculate the amount to replenish, and if that number is greater than the amount in our inventory, INSERT/UPDATE into the replenish_order table
    args = [];
    for (let obj of results) {
        // We do NOT want to put rows into replenish_order that are from the ONLINE-STR location (at least for now, this may change in the future)
        if (obj["Location"] == "ONLINE-STR") {
            continue;
        }
        let ReplenishAmount;
        let Location = obj["Location"];
        let WarehouseID = obj["WarehouseID"];
        let Keycode = obj["Keycode"];
        let AWS = parseFloat(obj["AWS"]) || 0; // AWS = Average Weekly Sales
        let InventoryOOS = parseInt(obj["invOOS"]) || 0; // either 0 or 1
        let AverageDailySales = parseFloat(obj["AverageDailySales"]) || 0.01; // Has to be greter than 0. New items can start at 0.1
        let TargetInventory = parseInt(obj["TargetInventory"]) || 0;
        let QuantityOrdered = parseInt(obj["QuantityOrdered"]) || 0;
        let factor = parseFloat(obj["factor"]) || 1;
        let wrhTotalQty = parseInt(obj["wrhTotalQty"]) || 0;
        let mdu = parseInt(obj["MDU"]) || 0;
        let isExtAisle = parseInt(obj["isExtAisle"]) || 0;
        let DaysOfCoverage = parseFloat(obj["DaysOfCoverage"]) || 2; // Default 2 Days of coverage for daily sales
        let Priority = 1; // 1=Standard, 2=Fasttrack
        if (isExtAisle) {
            ReplenishAmount = mdu; // Replenish up to mdu
            ReplenishAmount -= QuantityOrdered; // Subtract already ordered
        } else {
            ReplenishAmount = AverageDailySales * DaysOfCoverage;
            // Inventory OOS handling - If OOS occured, double the order.
            if (InventoryOOS == 1) {
                ReplenishAmount *= settings.replenish.factor_OOS;
                Priority = 2;
            }
            // Multiply the replenishment amount by any bonus factor that we might have for this particular Location/Barcode combination
            ReplenishAmount = Math.ceil(ReplenishAmount * factor);

            // Now, compare the calculated Replenish Amount with MDU and use greater value.
            if (mdu && mdu > ReplenishAmount) {
                ReplenishAmount = mdu;
            }
            // And subtract quantity from any outstanding replenish_order.
            ReplenishAmount -= QuantityOrdered;
        }
        /* Only push an object into the replenishment array if it needs to be replenished
         * (meaning we currently have less items in the inventory than the required replenishment amount)
         * Once the array has been populated, it will be looped for each object and an SQL query will be fired off for each one */
        if (TargetInventory < ReplenishAmount) {
            let Quantity = ReplenishAmount - TargetInventory;

            if (Priority == 2) {
                DateDue = locationsETA[Location]["Fasttrack"]["DatePickETA"];
            } else {
                DateDue = locationsETA[Location]["Standard"]["DatePickETA"];
            }

            args.push([
                roID,
                Keycode,
                WarehouseID,
                Location,
                AWS,
                mdu,
                TargetInventory,
                Quantity,
                null,
                wrhTotalQty,
                Priority,
                DateDue,
                null
            ]);
        }
    }

    if (args.length) {
        // INSERT if the row doesn't exist yet
        sql = `
            INSERT IGNORE INTO replenish_order (ID, Keycode, SourceLocation, TargetLocation, AWS, MDU, TargetInventory, Quantity, QuantityFilled, SourceInventory, Priority, DateDue, DateFulfilled)
            VALUES ?`;
        try {
            [results] = await pool.query(sql, [args]);
        } catch (error) {
            logger.error("replenish_order", {error});
            return;
        }
        let message = `Replenishment order generated successfully. ${args.length} rows inserted with ID ${roID}.`;
        console.log(moment().format(), message);
    } else {
        let message = "Replenishment order processed - no new rows inserted.";
        console.log(moment().format(), message);
    }
};

exports.generate_replenish_order_csv = async function(req, res) {
    var filePath = "public/replenish_order.csv";
    var sql = `
        SELECT t.Keycode, t.Quantity, t.SourceContainer, tg.TargetLocation, p.Product_Name
        FROM task t
        INNER JOIN task_group tg ON tg.ID = t.TaskgroupID AND tg.DateFulfilled is null
        LEFT JOIN product p ON p.Keycode = t.Keycode
        WHERE tg.Type = 'Pick' AND t.DateFulfilled IS NULL and t.DateCompleted is null
        ORDER BY TargetLocation, SourceContainer`;
    var results;
    try {
        [results] = await ro_pool.query(sql);
        let data = await csvConverter.json2csvAsync(results, {emptyFieldValue: ""});
        fs.writeFileSync(filePath, data);
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }
    console.log("CSV file created/updated: " + filePath);
    res.status(200).json({"message": "OK"});
};

exports.replenish_order_to_task = async function(req, res) {
    let locations = req.body["locations"] || null;
    let isManual = (req.body.isManual == "true" || req.body.isManual == 1) ? true : false;
    let source = req.body.source || null;
    let name = req.body.name || null;
    let replenID = req.body.replenID || null;
    let sql, args = [], results, message;

    // First attempt to lock in this process:
    sql = `
        UPDATE process_lock
        SET DateLocked = NOW()
        WHERE
        ProcessName = 'replenish_order_to_task'
        AND (DateLocked IS NULL OR DateLocked < DATE_ADD(NOW(), INTERVAL -40 MINUTE))`;
    try {
        // When locations are provided, don't update lock
        if (!locations) {
            [results] = await pool.query(sql);
        }
    } catch (error) {
        logger.error("replenish_order_to_task lock", {error});
        res.status(500).json({"message": "Error occured attempting to create a lock for replenish order to task."});
        return;
    }

    // Return response right away to prevent Lambda re-try. Must return 200, cannot timeout with 504
    if (locations || results.affectedRows) {
        message = "Replenishment order to task job started...";
        console.log(moment().format(), message);
        res.status(200).json({"message": message});
    } else { // When locked, Return message and cancel execution
        message = "Replenishment Order to Task job cannot start at this time. Please wait for the next hour.";
        console.log(moment().format(), message);
        res.status(200).json({"message": message});
        return;
    }

    if (Array.isArray(locations)) {
        args = [locations.join(","), isManual, replenID];
    } else if (locations) {
        args = [locations, isManual, replenID];
    } else {
        args = [null, isManual, replenID];
    }

    try {
        [results] = await pool.query(`CALL ${config.sql_database_for_sp}.replenish_order_to_task(?, ?, ?)`, args);
        console.log(results);
        results = results[0]; // Stored procedure returns same as multi-statement sql!
    } catch (error) {
        logger.error("replenish_order_to_task:", {error});
        return;
    }


    console.log(moment().format(), "Replenish Order to tasks - Initial results: ", results.length);

    results.push({}); // Add extra row for better processing.
    let prevTargetLocation = results[0]["TargetLocation"];
    let perStoreArray = [];

    for (let result of results) {
        // Quantity is: New replenishment order Quantity - existing tasks Quantity, if any
        let quantity = parseInt(result.Quantity) - parseInt(result.taskQty);

        // IF New store location starts or Last row, PROCESS RESULTS for this location.
        if (prevTargetLocation != result.TargetLocation) {
            // Use perStoreArray and insert into temp table
            sql = `
                CREATE TEMPORARY TABLE IF NOT EXISTS temp_ro LIKE replenish_order
                ;
                TRUNCATE temp_ro
                ;
                INSERT INTO temp_ro (RowID, Keycode, SourceLocation, TargetLocation, Quantity) VALUES ?
                ;
                SELECT ro.RowID, ro.Keycode, SourceLocation, ro.TargetLocation, ro.Quantity, i.ID AS ContainerID, i.Type, i.Priority, i.wrhQuantity
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
                    WHERE
                        c.LocationID = ?
                        AND TaskID IS NULL
                        AND ct.isBoH = 1 AND ct.BackfillEnabled = 1
                    GROUP BY i.Keycode, c.ID
                ) AS i ON i.Keycode = ro.Keycode
                ORDER BY ro.TargetLocation, ro.RowID, i.Priority, i.wrhQuantity ASC
                ;`;
            args = [perStoreArray, perStoreArray[0][2]];
            let wrhResults;
            try {
                [wrhResults] = await pool.query(sql, args);
                wrhResults = wrhResults[3]; // Need the 4th (index 3) result set only, which is the SELECT
            } catch (error) {
                logger.error("replenish_order_to_task - temp_ro:", {error});
                return;
            }

            // PARSE the data create insert array for tasks and inventory reservation:
            let pickList = [];
            let currProduct = null;
            let currQuantity = 0;

            for (let row of wrhResults) {
                /* Example for row:
                 * RowID, Keycode,  SourceLocation, TargetLocation, Quantity, ContainerID,     Type,  Priority, wrhQuantity
                 * 1,     42543015, "LYN1-WRH",     "LYN2-STR",     5,        "LYN1-001-02-A", "SHL", 1,        2
                 * 2,     42709244, "LYN1-WRH",     "LYN2-STR",     7,        "LYN1-001-03-A", "SHL", 1,        3
                 *
                 * Example for pickList:
                 *     Keycode,  RowID, Quantity, SourceContainer, Type
                 * [ [ 42543015, 1,     3,        "LYN1-001-01-A", "Pick" ],
                 *   [ 42709244, 2,     3,        "LYN1-001-02-A", "Pick" ] ]
                 */
                if (row.Keycode !== currProduct) {
                    // New product, reset currQuantity
                    currProduct = row.Keycode;
                    currQuantity = row.Quantity;
                }

                // Skip rows if we have satisfied product demand, until the next product
                if (currQuantity <= 0) {
                    continue;
                }

                if (row.wrhQuantity >= currQuantity) {
                    // If this container can satisfy the rest of our desired quantity
                    pickList.push([row.Keycode, row.RowID, currQuantity, row.ContainerID, "Pick"]);
                    currQuantity = 0;
                } else {
                    // If this container can only satisfy some of our remaining desired quantity
                    pickList.push([row.Keycode, row.RowID, row.wrhQuantity, row.ContainerID, "Pick"]);
                    currQuantity -= row.wrhQuantity;
                }
            }
            if (pickList.length) { // Only create tasks if pickList is populated!
                args = [pickList];
                sql = `INSERT INTO task (Keycode, RowID, Quantity, SourceContainer, Type) VALUES ?`;
                let taskResults;
                try {
                    [taskResults] = await pool.query(sql, args);
                } catch (error) {
                    logger.error("replenish_order_to_task - task creation:", {error});
                    return;
                }
                let taskID = parseInt(taskResults.insertId); // First task ID:

                // RESERVE INVENTORY
                sql = []; args = [];
                for (let i in pickList) {
                    i = parseInt(i); // Ensure that i is an integer to prevent string concatenation
                    // TODO: Update this SQL because both the inventory AND task now use Keycode
                    // We don’t care what the barcode is, if multiple barcodes belong to the same keycode, we don’t care for them individually
                    sql.push("UPDATE inventory SET TaskID = ? WHERE ContainerID = ? and Keycode = ? AND TaskID IS NULL LIMIT ?");
                    args.push([taskID + i, pickList[i][3], pickList[i][0], pickList[i][2]]);
                }
                try {
                    await helpers.largeSQLQuery(sql, args);
                } catch (error) {
                    logger.error("reserving inventory", {error});
                }
                console.log(moment().format(), `REPLENISH ORDER for ${prevTargetLocation} - ${pickList.length} Pick tasks created, starting with ID: ${taskID}.`);
            }
            // Cleanup:
            perStoreArray = [];
        }

        // ADD ROW INTO ARRAY (if not empty)
        if (result.TargetLocation) {
            // If the warehouse's total quantity is < of the total demand, then we need to recalculate the requested quantity
            if (result.wrhTotalQty < result.totalDemand) {
                // totalDemand by all replenish orders. wrhTotalQty is max we can allocate
                // 1. Divide: wrhTotalQuty / totalDemand, get a factor.
                // 2. Round each result, OPTIONALLY - save rounding difference and deduct it if set.
                let factor = result.wrhTotalQty / result.totalDemand;
                quantity = Math.ceil(quantity * factor);
            }

            // Keycode needs to be stored in this array because all tasks are now based on Keycode
            perStoreArray.push([result.RowID, result.Keycode, result.SourceLocation, result.TargetLocation, quantity]);
            prevTargetLocation = result.TargetLocation;
        }
    }

    // At the end, group all tasks created.
    try {
        await apiRequest.get(req, "taskgroup/group_pick_tasks", { source: source, name: name });
    } catch (error) {
        logger.error("grouping pick tasks", {error});
    }

    console.log(moment().format(), "Replenishment Order to Task creation is Complete!");
};

exports.fulfill_replenish_order = async function(req, res) {
    let from = req.body.source_container;
    let to = req.body.target_container;
    let isBackfillFlag = (req.body.backfill_flag == "true" || req.body.backfill_flag == 1) ? true : false;
    let locationMatch = false;
    let rowsUpdatedTask = 0;
    let sql, args, error_message, results, message, rowsUpdatedRO;

    // Print the entire inventory table, but ONLY for warehouses that are NOT Australia
    console.log(moment().format(), `fulfill_replenish_order CALLED - sourceContainer: ${from}, targetLocation: ${to}.`);

    // Ensure that parameters are passed in
    if (!from || !to) {
        console.log(`Required params not passed to fulfill_replenish_order: from=${from}, to=${to}.`);
        res.status(400).json({"message": "Required parameters Source and Target container need to be provided."});
        return;
    }

    // Get all products from the specified container for both the inventory and inventory_case tables
    sql = `
        SELECT ContainerID, Keycode, TaskID
        FROM inventory
        WHERE ContainerID = ?
        ;
        SELECT ContainerID, Barcode, TaskID
        FROM inventory_case
        WHERE ContainerID = ?`;
    args = [from, from];

    try {
        [results] = await pool.query(sql, args);
        console.table(results[0]);
        console.table(results[1]);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error occured while attempting to fulfill replenishment order."});
        return;
    }

    // ** STEP 1 **
    // Validate that the Destination matches! Very important.
    sql = `
        SELECT DISTINCT tg.TargetLocation, target.LocationID
        FROM task t
        LEFT JOIN task_group tg ON tg.ID = t.TaskGroupID
        INNER JOIN (
            SELECT TaskID, ContainerID FROM inventory WHERE TaskID IS NOT NULL AND ContainerID = ?
            UNION
            SELECT TaskID, ContainerID FROM inventory_case WHERE TaskID IS NOT NULL AND ContainerID = ?
        ) AS i ON t.ID = i.TaskID
        LEFT JOIN (
            SELECT LocationID FROM container WHERE ID = ? AND Type IN ('STR', 'RCV')
        ) AS target ON tg.TargetLocation = LocationID`;
    args = [from, from, to];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error occured while attempting to fulfill replenishment order."});
        return;
    }

    if (results.length == 0) { // If there are no results, That is OK, manual picks don't have any tasks.
        error_message = `No related replenishment order found for ${from} and destination ${to}.`;
        console.log(error_message);
        res.status(200).json({"message": error_message});
        return;
    }

    if (results[0]["TargetLocation"] === "ONLINE-STR") {
        error_message = "No related replenishment orders for Online Orders";
        res.status(200).json({"message": error_message});
        return;
    }

    for (let result of results) {
        if (result.LocationID != null) {
            locationMatch = true;
            break;
        }
    }

    if (!locationMatch) {
        // If there is result but TargetLocation doesn't match 'to', that means wrong location has been entered.
        error_message = `Incorrect Target Location has been entered for ${from}! Destination is: ${results[0]["TargetLocation"]}`;
        res.status(400).json({"message": error_message});
        return;
    }

    // ** STEP 2 **
    // Update tasks which inventory is on this cart or which were picked but are not on any cart.
    // Only update quantity for items that are also on another cart.

    // Update Quantity Filled and FullfilledOn for All related replenish Orders
    // 1. Select all RowIDs for tasks that are completed (for open ROs)
    // 2. Set Incomplete where RowID is associated with task that is not complete yet.
    // 3. Only update DateFulfilled when Incomplete is null.

    // Finally, clean up all Task Groups where all the tasks are Fulfilled.
    args = [from, from, from];
    if (isBackfillFlag) {
        sql = `
        SELECT ID, Keycode, TargetContainer, QuantityFilled, QtyDelivered, ContainerID, Type, SUM(Qty_Oth_Crt) AS QtyOtherCart, SUM(Qty) AS Qty
        FROM (
            SELECT
                t.ID,
                t.Keycode,
                t.TargetContainer,
                t.QuantityFilled,
                IFNULL(t.QuantityDelivered, 0) AS QtyDelivered,
                i.ContainerID,
                c.Type,
                SUM(IF(i.ContainerID != ? AND c.Type IN ('CRT', 'TOT'), 1, 0)) AS Qty_Oth_Crt,
                COUNT(i.ContainerID) AS Qty
            FROM (
                SELECT DISTINCT t.ID
                FROM task t
                INNER JOIN inventory_case i ON t.ID = i.TaskID
                WHERE i.ContainerID = ? AND t.Type = 'Backfill'
                UNION
                SELECT DISTINCT t.ID
                FROM task t
                INNER JOIN inventory i ON t.ID = i.TaskID
                WHERE i.ContainerID = ? AND t.Type = 'Backfill'
            ) AS tg
            INNER JOIN task t ON t.ID = tg.ID
            LEFT JOIN (
                SELECT ContainerID, TaskID, Keycode, NULL AS Barcode FROM inventory
                UNION ALL
                SELECT ContainerID, TaskID, NULL AS Keycode, Barcode FROM inventory_case
            ) AS i ON t.ID = i.TaskID AND (t.Keycode = i.Keycode OR t.ProductID = i.Barcode)
            LEFT JOIN container c ON i.ContainerID = c.ID
            WHERE t.DateCompleted IS NOT NULL AND t.DateFulfilled IS NULL
            GROUP BY i.ContainerID, t.ID
        ) AS t
        GROUP BY t.ID
        HAVING Qty > QtyOtherCart OR QtyOtherCart = 0`;
    } else {
        sql = `
        SELECT ID, Keycode, TargetContainer, QuantityFilled, QtyDelivered, ContainerID, Type, SUM(Qty_Oth_Crt) AS QtyOtherCart, SUM(Qty) AS Qty
        FROM (
            SELECT
                t.ID,
                t.Keycode,
                t.TargetContainer,
                t.QuantityFilled,
                IFNULL(t.QuantityDelivered, 0) AS QtyDelivered,
                i.ContainerID,
                c.Type,
                SUM(IF(i.ContainerID != ? AND c.Type IN ('CRT', 'TOT'), 1, 0)) AS Qty_Oth_Crt,
                COUNT(i.ContainerID) AS Qty
            FROM (
                SELECT DISTINCT ro.ID
                FROM task t
                INNER JOIN inventory_case i ON t.ID = i.TaskID
                INNER JOIN replenish_order ro ON ro.RowID = t.RowID
                WHERE i.ContainerID = ? AND t.Type = 'Pick'
                UNION
                SELECT DISTINCT ro.ID
                FROM task t
                INNER JOIN inventory i ON t.ID = i.TaskID
                INNER JOIN replenish_order ro ON ro.RowID = t.RowID
                WHERE i.ContainerID = ? AND t.Type IN ('Pick','CrossDock')
            ) AS tg
            INNER JOIN replenish_order ro ON tg.ID = ro.ID
            INNER JOIN task t ON t.RowID = ro.RowID
            LEFT JOIN (
                SELECT ContainerID, TaskID, Keycode, NULL AS Barcode FROM inventory
                UNION ALL
                SELECT ContainerID, TaskID, NULL AS Keycode, Barcode FROM inventory_case
            ) AS i ON t.ID = i.TaskID AND (t.Keycode = i.Keycode OR t.ProductID = i.Barcode)
            LEFT JOIN container c ON i.ContainerID = c.ID
            WHERE t.DateCompleted IS NOT NULL AND t.DateFulfilled IS NULL
            GROUP BY i.ContainerID, t.ID
        ) AS t
        GROUP BY t.ID
        HAVING Qty > QtyOtherCart OR QtyOtherCart = 0`;
    }

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
    }

    let updateSql = "";
    args = [];

    if (results.length == 0) {
        res.status(200).json({"message": "There are no tasks related to replenish orders that need fulfilling"});
        return;
    }

    for (let result of results) {
        let id = parseInt(result["ID"]);
        let qty = parseInt(result["Qty"]);
        let qtyDelivered = parseInt(result["QtyDelivered"]);
        let qtyOtherCart = parseInt(result["QtyOtherCart"]);
        let quantityFilled = parseInt(result["QuantityFilled"]);

        // Because DateFulfilled is either NOW() or NULL, there's no need to set it by arguments. Just set it directly here in the sql
        // For QuantityDelivered, the value of the quantity calculation can also be set in the SQL
        updateSql += `
            UPDATE task
            SET
                DateFulfilled = ${(qtyOtherCart == 0 || (qtyDelivered - qtyOtherCart + qty >= quantityFilled)) ? "'" + moment().format() + "'" : "NULL"},
                QuantityDelivered = ${qtyDelivered - qtyOtherCart + qty}
            WHERE ID = ?; `;
        args.push(id);
    }

    try {
        [results] = await pool.query(updateSql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "An error has occurred while fulfilling a replenish order; please contact your system administrator"});
        return;
    }

    // "results" will be an array of objects most of the time
    if (Array.isArray(results)) {
        for (let row of results) {
            rowsUpdatedTask += row.affectedRows;
        }
    } else {
        // Very rarely there will only be one result (in which case there will NOT be an array). If that's the case then we need to handle "results" slightly differently otherwise an error will occur
        rowsUpdatedTask += results.affectedRows;
    }

    // Select all of the data that will need to be updated
    sql = `
        SELECT ro.RowID, ro.QtyDelivered, COUNT(t.ID) AS OpenTasks
        FROM (
            SELECT ro.RowID, SUM(t.QuantityDelivered) AS QtyDelivered
            FROM replenish_order ro
            INNER JOIN task t ON ro.RowID = t.RowID AND t.Type IN ('Pick', 'CrossDock')
            WHERE ro.DateFulfilled IS NULL AND t.DateCompleted IS NOT NULL AND (t.DateFulfilled IS NOT NULL OR (t.QuantityDelivered IS NOT NULL AND t.QuantityDelivered > 0))
            GROUP BY ro.RowID
        ) AS ro
        LEFT JOIN task t ON t.RowID = ro.RowID AND t.Type = 'Pick' AND t.DateFulfilled IS NULL
        GROUP BY ro.RowID
        UNION
        SELECT ro2.RowID, SUM(b.Quantity * IFNULL(t.QuantityDelivered, 0)) AS QuantityDelivered, IFNULL(up.UnPickedQuantity, 0) AS OpenTasks
        FROM replenish_order ro
        INNER JOIN task t ON t.RowID = ro.RowID AND t.Type IN ('Pick', 'CasePick', 'CrossDock') AND t.DateFulfilled is not NULL
        INNER JOIN case_barcode b ON b.Barcode = t.ProductID
        INNER JOIN replenish_order ro2 ON ro2.ID = ro.ID AND ro2.Keycode = b.Keycode
        LEFT JOIN (
            SELECT ro2.*, SUM(b.Quantity * t.Quantity) AS UnPickedQuantity FROM replenish_order ro
            INNER JOIN task t ON t.RowID = ro.RowID AND t.Type IN ('Pick', 'CasePick', 'CrossDock') AND t.DateFulfilled is NULL
            INNER JOIN case_barcode b ON b.Barcode = t.ProductID
            INNER JOIN replenish_order ro2 ON ro2.ID = ro.ID AND ro2.Keycode = b.Keycode
            WHERE ro.DateFulfilled IS NULL
            GROUP BY ro2.RowID
        ) AS up ON up.RowID = ro2.RowID
        WHERE ro.DateFulfilled IS NULL
        GROUP BY ro2.RowID`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "An error has occurred while fulfilling a replenish order; please contact your system administrator"});
        return;
    }

    // Store the number of rows that will be updated in replenish_order, and reset the SQL
    rowsUpdatedRO = results.length;
    sql = "";

    // One query execution for each row that needs to be updated
    for (let row of results) {
        sql += `
            UPDATE replenish_order
            SET
                QuantityFilled=${row.QtyDelivered},
                DateFulfilled=${(row.OpenTasks == 0 ? "NOW()" : "NULL")}
            WHERE RowID=${row.RowID};`;
    }

    // It's possible that there won't be an SQL query to execute (this happens when a backfill is bulk-stowed)
    if (sql.length) {
        try {
            [results] = await pool.query(sql);
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": "An error has occurred while fulfilling a replenish order; please contact your system administrator"});
            return;
        }
    }

    // Finally, update task_group and count the quantity from inventory
    args = [from, from];
    sql = `
        UPDATE task_group tg
        LEFT JOIN (
            SELECT DISTINCT TaskGroupID
            FROM task
            WHERE
                Type IN ('Pick', 'CasePick', 'CrossDock', 'Backfill')
                AND DateCompleted IS NOT NULL
                AND DateFulfilled IS NULL
        ) AS tx ON tg.ID = tx.TaskGroupID
        SET DateFulfilled = NOW()
        WHERE
            tg.DateCompleted IS NOT NULL
            AND tg.DateFulfilled IS NULL
            AND tg.Type IN ('Pick', 'CasePick', 'CrossDock', 'Backfill')
            AND tx.TaskGroupID IS NULL
        ;
        SELECT COUNT(*) AS qty FROM (SELECT ID FROM inventory WHERE containerID = ? UNION SELECT ID FROM inventory_case WHERE containerID = ?) AS c`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("fulfill_replenish_order", {error});
        res.status(500).json({"message": "An error has occurred while fulfilling a replenish order; please contact your system administrator"});
        return;
    }

    message = `Replenishment fulfilled. ${results[1][0].qty} items from ${from} to ${to}`;
    console.log(message, `Rows updated: replenish_order: ${rowsUpdatedRO}, task: ${rowsUpdatedTask}`);
    res.status(200).json({"message": message});
};

exports.csv_to_replenish_order = async function(req, res) {
    let sql, args, message, data, results, dateDue;
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let ignoreExistingOrders = (req.body.ignoreExistingOrders == "true") || false; // Passed as a string, so convert to a boolean
    let productList = [];
    let sql_union = [];

    // Reject if a file was NOT uploaded
    if (req.file == undefined) {
        message = "Nothing was selected to upload; please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }

    let file = req.file;
    let input = file["buffer"].toString("utf-8").replace(/[\r\n]+/g, "\n");
    let user = authHelper.parseRole(req);

    let file_name_for_s3 = `Replenish_Order_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBackupBucket = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3:", {file_name_for_s3});
    helpers.uploadFileToS3(csvBackupBucket, file_name_for_s3, file["buffer"]);

    data = await csvConverter.csv2jsonAsync(input);

    // var data = await csvtojson({"checkColumn": true}).fromFile(file.path); //.fromString(input);
    // data = await csvtojson({"checkColumn": true}).fromString(input);
    // data = await csvtojson({"checkColumn": true}).fromFile(file.path); //.fromString(input);
    // fs.unlink(file["path"], function() {logger.info("file deleted");});

    if (data.length == 0) {
        res.status(200).json({"message": "No data was found in the .csv file. Please check it and make sure it's valid."});
        return;
    }

    const csvRowCount = data.length;
    try {
        data = _prepareCSVobject(data);
    } catch (error) {
        logger.error("CSV Parse", {error});
        res.status(400).json({"message": error.message});
        return;
    }

    for (let i in data) {
        productList.push(i);
    }

    if (!productList.length) {
        res.status(400).json({"message": "No Keycode with positive quantity for any store was found in the .csv file."});
        return;
    }

    // Prepare DATA to be used as bases for the sql query.
    // Basically join via UNION all the product/Location combinations.
    args = [];
    for (let keycode in data) {
        // For each store value per keycode
        for (let i in data[keycode]) {
            let store = data[keycode][i].store;
            let qty = data[keycode][i].quantity;
            let source_location = data[keycode][i].source_location;
            args.push(keycode);
            args.push(store);
            args.push(source_location);
            args.push(qty);
            sql_union.push(`SELECT ? AS Keycode, ? AS Location, ? AS SourceLocation, ? AS Quantity`);
        }
    }

    // Select all Product and Location and Quantity from csv as a base data.
    // Mix in warehouse inventory levels,
    // Mix in existing replenish_order quantity,
    // Exclude items in blacklist.
    // Currently no need to check if locations allow replenishment as replenishment is limited to the csv values.
    // IMPORTANT: .csv to replenish order might need an overhaul in the above code if we change it from Product ID to Keycode
    sql = `
        SELECT p.Keycode, p.Location, p.Quantity, p.WarehouseID, loc.ID AS TargetLocation, IFNULL(ro.Demand, 0) AS Demand, IFNULL(ci.wrhTotalQty, 0) AS wrhTotalQty
        FROM (
            SELECT Keycode, Location, SourceLocation as WarehouseID, Quantity FROM (
                ${sql_union.join(" UNION ")}
            ) AS uni
        ) AS p
        INNER JOIN location AS loc ON loc.ID = p.Location
        INNER JOIN product AS prod ON prod.Keycode = p.Keycode
        LEFT JOIN (
            SELECT a.LocationID, a.Keycode, SUM(a.wrhTotalQty) as wrhTotalQty FROM (
                SELECT c.LocationID, i.Keycode, COUNT(*) AS wrhTotalQty
                FROM inventory i
                LEFT JOIN container c ON c.ID = i.ContainerID
                LEFT JOIN container cp ON cp.ID = c.LocationID
                INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
                WHERE cp.Type = 'WRH' AND ct.isBoH = 1 AND ct.BackfillEnabled = 1
                GROUP BY c.LocationID, i.Keycode
                UNION ALL
                SELECT c.LocationID, b.Keycode, SUM(b.Quantity) AS wrhTotalQty
                FROM inventory_case i
                INNER JOIN case_barcode b on b.Barcode = i.Barcode
                LEFT JOIN container c ON c.ID = i.ContainerID
                LEFT JOIN container cp ON cp.ID = c.LocationID
                WHERE cp.Type = 'WRH' AND c.Type ='RSV'
                GROUP BY c.LocationID, b.Keycode
            ) as a
            GROUP BY LocationID, Keycode
        ) AS ci ON p.Keycode = ci.Keycode AND p.WarehouseID = ci.LocationID
        LEFT JOIN (
            SELECT Keycode, SourceLocation, TargetLocation, SUM(Quantity) AS Demand
            FROM replenish_order
            WHERE DateFulfilled IS NULL
            GROUP BY SourceLocation, TargetLocation, Keycode
        ) ro ON ro.Keycode = p.Keycode AND ro.TargetLocation = p.Location AND ro.SourceLocation = p.WarehouseID
        LEFT JOIN product_blacklist bl ON bl.Keycode = p.Keycode AND bl.LocationID = p.Location
        WHERE bl.Keycode IS NULL # Exclude BlackList
            AND prod.US_Overall_Test_Result_CONFIRMED IN ('RELEASE','SELL THROUGH')
        ORDER BY ci.Keycode`;

    try {
        [results]  = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }

    /* Sample results:
     * Keycode,  WarehouseID, Location, Quantity, Demand, wrhTotalQty, NOT USED: TargetLocation
     * 42555858, LYN1-WRH,    BEL1-STR, 5,        0,      16,          NOT USED: BEL1-STR
     * 42244462, LYN1-WRH,    LYN2-STR, 12,       0,      21,          NOT USED: LYN2-STR
     */
    let insertArgs = [];
    let roID = moment.utc().valueOf();
    let locations = []; // Restricted list of locations based on this set
    let SourceLocation;
    // For each csv file data row:
    for (let row in results) {
        let keycode   = results[row]["Keycode"];
        let warehouse = results[row]["WarehouseID"];
        let store     = results[row]["Location"];
        let qty       = results[row]["Quantity"]    || 0;
        let demand    = results[row]["Demand"]      || 0;
        let srcInv    = results[row]["wrhTotalQty"] || 0;

        dateDue = locationsETA[warehouse]["Standard"]["DatePickETA"];
        locations.push(store);
        SourceLocation = warehouse;

        // If we are not ignoring existing orders, lower requested quantity by oustanding replenish_order demand
        if (!ignoreExistingOrders) {
            qty -= demand;
        }

        if (qty > 0) {
            insertArgs.push([
                roID,      // ID
                keycode,   // Keycode
                warehouse, // SourceLocation
                store,     // TargetLocation
                qty,       // Quantity
                srcInv,    // SourceInventory
                1,         // Priority
                dateDue,   // DateDue
                "Manual"   // OrderType
            ]);
        }
    }

    locations = [...new Set(locations)]; // Remove all duplicate values by using Set()
    message = `${csvRowCount} rows of the CSV file successfully processed, `;

    if (!insertArgs.length) {
        // There are no new rows to be inserted
        message += "resulting in NO new items being added to Replenishment order.";
    } else {
        sql = `
            INSERT IGNORE INTO replenish_order (ID, Keycode, SourceLocation, TargetLocation, Quantity, SourceInventory, Priority, DateDue, OrderType)
            VALUES ?`;
        let insResults;
        try {
            [insResults]  = await pool.query(sql, [insertArgs]);
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": error});
            return;
        }
        logger.info("Rows inserted: ", {insResults});
        let rowCount = insResults.affectedRows;
        message += `and ${rowCount} new items were added to Replenishment order.`;
    }

    let locationResults;
    sql = `
        SELECT ID, IF(isDC, 'DC', IF(isWRH, 'WRH', IF(isSTR, 'STR', 'ISERROR'))) as Type FROM (
            SELECT
            ID,
            IF(WarehouseID IS NULL AND DCLocationID IS NULL, true, false) as isDC,
            IF(WarehouseID IS NULL AND DCLocationID IS NOT NULL, true, false) as isWRH,
            IF(WarehouseID IS NOT NULL AND DCLocationID IS NULL, true, false) as isSTR
            FROM location
        ) as loc
        `;
    try {
        [locationResults] = await pool.query(sql);
    } catch (error) {
        res.status(400).json({"message": error});
        return;
    }
    let locationMap = {}; // creating a location map for easy access
    /**
     *  Sample result
     *  {
     *      'AUS1-WRH': 'DC',
     *      'BEL1-STR': 'STR',
     *      'BUR1-STR': 'STR',
     *      'TET1-WRH': 'ISERROR' , if location has both warehouseID and DCLocationID
     *  }
     */

    for (let l of locationResults) {
        locationMap[l.ID] = l.Type;
    }

    let strlocations = [];
    let wrhlocations = [];

    if (locationMap[SourceLocation] === "ISERROR") { // throw Error if location has WarehouseID & DCLocationID
        res.status(400).json({"message": `${SourceLocation} has WarehouseID & DCLocationID, please contact your system administrator`});
        return;
    } else if (locationMap[SourceLocation] === "DC") {
        wrhlocations = [...wrhlocations, ...locations];
    } else if (locationMap[SourceLocation] === "WRH") {
        strlocations = [...strlocations, ...locations];
    }

    if (strlocations.length) {
        try {
            await apiRequest.post(req, "replenish_order_to_task", {"locations": strlocations, "isManual": true, "replenID": roID, source: "Manual"});
        } catch (error) {
            res.status(400).json({"message": message + " Task creation failed."});
            return;
        }
    }

    if (wrhlocations.length) {
        try {
            await apiRequest.post(req, "replenish_case_to_task", {"locations": wrhlocations, "isManual": true, "replenID": roID, source: "Manual"});
        } catch (error) {
            res.status(400).json({"message": message + " Task creation failed."});
            return;
        }
    }


    res.status(200).json({"message": message});
};

exports.csv_to_case_order = async function(req, res) {
    let sql, args, message, data, results, dateDue;
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let productList = [];
    let sql_union = [];

    // Reject if a file was NOT uploaded
    if (req.file == undefined) {
        message = "Nothing was selected to upload; please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }

    let file = req.file;
    let input = file["buffer"].toString("utf-8").replace(/[\r\n]+/g, "\n");

    let user = authHelper.parseRole(req);

    let file_name_for_s3 = `Replenish_Order_CASE_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBackupBucket = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3:", {file_name_for_s3});
    helpers.uploadFileToS3(csvBackupBucket, file_name_for_s3, file["buffer"]);

    data = await csvConverter.csv2jsonAsync(input);

    // var data = await csvtojson({"checkColumn": true}).fromFile(file.path); //.fromString(input);
    // data = await csvtojson({"checkColumn": true}).fromString(input);
    // data = await csvtojson({"checkColumn": true}).fromFile(file.path); //.fromString(input);
    // fs.unlink(file["path"], function() {logger.info("file deleted");});

    if (data.length == 0) {
        res.status(200).json({"message": "No data was found in the .csv file. Please check it and make sure it's valid."});
        return;
    }

    const csvRowCount = data.length;
    //data = _prepareCSVobject(data);

    for (let i in data) {
        if (data[i].keycode  && data[i].quantity) {
            productList.push(i);
        }
    }

    if (!productList.length) {
        res.status(400).json({"message": "No Keycode with positive quantity was found in the .csv file."});
        return;
    }

    // Prepare DATA to be used as bases for the sql query.
    // Basically join via UNION all the product/Location combinations.
    args = [];
    for (let row in data) {
        console.log(data[row]);
        args.push(data[row].keycode);
        args.push("LYN1-WRH");
        args.push(data[row].quantity);
        sql_union.push(`SELECT ? AS Keycode, ? AS Location, ? AS Quantity`);
    }

    // Select all Product and Location and Quantity from csv as a base data.
    // Mix in warehouse inventory levels,
    // Mix in existing replenish_order quantity,
    // Exclude items in blacklist.
    // Currently no need to check if locations allow replenishment as replenishment is limited to the csv values.
    // IMPORTANT: .csv to replenish order might need an overhaul in the above code if we change it from Product ID to Keycode
    sql = `
        SELECT p.Keycode, p.Location, p.Quantity, wrh_info.DCLocationID as WarehouseID, wrh_info.ID AS TargetLocation, IFNULL(ro.Demand, 0) AS Demand, IFNULL(ci.wrhTotalQty, 0) AS wrhTotalQty
        FROM (
            SELECT Keycode, Location, Quantity FROM (
                ${sql_union.join(" UNION ")}
            ) AS uni
        ) AS p
        INNER JOIN location AS wrh_info ON wrh_info.ID = p.Location
        LEFT JOIN (
            SELECT c.LocationID, b.Keycode, SUM(b.Quantity) AS wrhTotalQty
            FROM inventory_case i
            LEFT JOIN case_barcode b on b.Barcode = i.Barcode
            LEFT JOIN container c ON c.ID = i.ContainerID
            WHERE c.Type = 'RSV' AND i.TaskID is null
            GROUP BY b.Keycode
        ) AS ci ON p.Keycode = ci.Keycode AND wrh_info.DCLocationID = ci.LocationID
        LEFT JOIN (
            SELECT Keycode, SourceLocation, TargetLocation, SUM(Quantity) AS Demand
            FROM replenish_order
            WHERE DateFulfilled IS NULL
            GROUP BY SourceLocation, TargetLocation, Keycode
        ) ro ON ro.Keycode = p.Keycode AND ro.TargetLocation = p.Location AND ro.SourceLocation = wrh_info.DCLocationID
        ORDER BY ci.Keycode`;

    try {
        [results]  = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }

    /* Sample results:
     * Keycode,  WarehouseID, Location, Quantity, Demand, wrhTotalQty, NOT USED: TargetLocation
     * 42555858, LYN1-WRH,    BEL1-STR, 5,        0,      16,          NOT USED: BEL1-STR
     * 42244462, LYN1-WRH,    LYN2-STR, 12,       0,      21,          NOT USED: LYN2-STR
     */
    let insertArgs = [];
    let roID = moment.utc().valueOf();
    let locations = []; // Restricted list of locations based on this set

    // For each csv file data row:
    for (let row in results) {
        let keycode   = results[row]["Keycode"];
        let warehouse = results[row]["WarehouseID"];
        let store     = results[row]["Location"];
        let qty       = results[row]["Quantity"]    || 0;
        let demand    = results[row]["Demand"]      || 0;
        let srcInv    = results[row]["wrhTotalQty"] || 0;

        dateDue = locationsETA[store]["Standard"]["DatePickETA"];
        locations.push(store);
        qty -= demand; // Lower requested quantity by oustanding replenish_order demand

        if (qty > 0) {
            insertArgs.push([
                roID,      // ID
                keycode,   // Keycode
                warehouse, // SourceLocation
                store,     // TargetLocation
                qty,       // Quantity
                srcInv,    // SourceInventory
                1,         // Priority
                dateDue,   // DateDue
                "Manual"   // OrderType
            ]);
        }
    }


    locations = [...new Set(locations)]; // Remove all duplicate values by using Set()
    message = `${csvRowCount} rows of the CSV file successfully processed, `;

    if (!insertArgs.length) {
        // There are no new rows to be inserted
        message += "resulting in NO new items being added to Replenishment order.";
    } else {
        sql = `
            INSERT IGNORE INTO replenish_order (ID, Keycode, SourceLocation, TargetLocation, Quantity, SourceInventory, Priority, DateDue, OrderType)
            VALUES ?`;
        let insResults;
        try {
            [insResults]  = await pool.query(sql, [insertArgs]);
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": error});
            return;
        }
        logger.info("Rows inserted: ", {insResults});
        let rowCount = insResults.affectedRows;
        message += `and ${rowCount} new items were added to Replenishment order.`;
    }

    try {
        await apiRequest.post(req, "replenish_case_to_task", {"locations": locations});
    } catch (error) {
        res.status(400).json({"message": message + " Task creation failed."});
        return;
    }

    res.status(200).json({"message": message});
};

exports.get_replenish_factor_calendar = async function(req, res) {
    let LocationID = req.query["LocationID"];
    let sql, args, results, error_message;

    if (LocationID == null) {
        res.status(400).json({"message": "Location must be provided!"});
        return;
    }

    sql = `
        SELECT cal.Date, cal.Factor
        FROM location loc
        LEFT JOIN replenish_factor_calendar cal ON loc.ID = cal.LocationID
        WHERE loc.ID = ?
        AND cal.Date >= DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL -1 MONTH)
        AND cal.Date <= DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL 1 MONTH)
        ORDER BY cal.Date`;
    args = [LocationID];
    try {
        [results] = await ro_pool.query(sql, args);
        res.status(200).json({"data": results});
    } catch (error) {
        logger.info("get_replenish_factor ERROR: ", {error});
        error_message = `Error while retrieving Replenishment factor calendar for location: ${location}.`;
        res.status(400).json({"message": error_message});
    }
};

exports.update_replenish_factor_calendar = async function(req, res) {
    var date = req.body["date"] || "";
    var factor = req.body["factor"] || 1;
    var location = req.body["location"];

    let sql, args, results, error_message;

    if (date === "" || !moment(date, "YYYY-MM-DD", true).isValid()) {
        res.status(400).json({"status": "ERROR", "message": "Date needs to be set to a valid format: YYYY-MM-DD"});
        return;
    }

    sql = `INSERT INTO replenish_factor_calendar (Date, LocationID, Factor) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE Factor = VALUES(Factor)`;
    args = [date, location, factor];
    try {
        [results] = await pool.query(sql, args);
        if (results.affectedRows) { // always 1 for updates and inserts
            let message;
            if (results.insertId) { // insertId > 0 when row was inserted, 0 for updates
                message = `Factor of ${factor} added for ${location} on ${date}.`;
            } else {
                message = `Factor updated to ${factor} for ${location} on ${date}.`;
            }
            res.json({"status": "OK", "message": message});
        } else {
            error_message = `Unable to insert new record for date: ${date} and location: ${location}.`;
            res.status(400).json({"status": "ERROR", error_message});
        }
    } catch (error) {
        logger.error("", {error});
        error_message = `Error while inserting new record for date: ${date} and location: ${location}.`;
        res.status(400).json({"status": "ERROR", "message": error_message});
    }
};

exports.get_replenish_schedule = async function(req, res) {
    let locationID = req.query["location"] || null;
    let sql, args, results, hoursArray = [], data = {};

    if (locationID == null) {
        res.status(400).json({"message": "Location is required!"});
        return;
    }

    sql = `SELECT LocationID, Hour FROM replenish_schedule WHERE LocationID = ?`;
    args = [locationID];
    try {
        [results] = await ro_pool.query(sql, args);
        for (let i in results) {
            hoursArray.push(results[i]["Hour"]);
        }
        data.location = locationID;
        data.hours = hoursArray;
    } catch (error) {
        logger.info("get_replenish_schedule ERROR: ", {error});
        res.status(400).json({"message": "Incorrect Location provided!"});
        return;
    }
    res.json({"status": "OK", "data": data});

};

exports.update_replenish_schedule = async function(req, res) {
    let locationID = req.body["location"] || null;
    let hours = req.body["hours"] || ""; // array of hours in the day in UTC.

    let sql, args, sqlArray = [], hoursArray = [], results, message;
    if (locationID == null) {
        res.status(400).json({"message": "Location is required!"});
        return;
    }
    if (hours && typeof hours == "string") { // IF only one value is submitted, it's a string. Array is object.
        hoursArray.push(hours);
    } else {
        hoursArray = hours;
    }
    // validate location
    sql = `SELECT ID FROM container WHERE ID = ?`;
    args = [locationID];
    try {
        [results] = await pool.query(sql, args);
        if (results.length && results[0]["ID"]) {
            locationID = results[0]["ID"]; // set locatin to the correct format.
        } else {
            res.status(400).json({"message": "Incorrect Location provided!"});
            return;
        }
    } catch (error) {
        logger.info("update_replenish_schedule ERROR: ", {error});
        res.status(400).json({"message": "Incorrect Location provided!"});
        return;
    }

    sqlArray.push("DELETE FROM replenish_schedule WHERE LocationID = ?;");
    args = [locationID];
    for (let i in hoursArray) {
        sqlArray.push("INSERT INTO replenish_schedule (LocationID, Hour) VALUES (?);");
        args.push([locationID, hoursArray[i]]);
    }
    sql = sqlArray.join("\n");
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("update_replenish_schedule ERROR: ", {error});
        res.status(400).json({"message": "Updating Replenishment schedule failed!"});
        return;
    }
    if (hoursArray.length) {
        message = `Replenishment Schedule updated for ${locationID} to hours: ${hoursArray.join(", ")}.`;
    } else {
        message = `Replenishment Schedule removed for ${locationID}.`;
    }
    res.json({"message": message});
};

exports.get_delivery_schedule = async function(req, res) {
    let locationID = req.query["location"] || null;
    let sql, args, results, hoursArray = [], data = {};

    if (locationID == null) {
        res.status(400).json({"message": "Location is required!"});
        return;
    }

    sql = `SELECT LocationID, Hour FROM delivery_schedule WHERE LocationID = ?`;
    args = [locationID];
    try {
        [results] = await ro_pool.query(sql, args);
        for (let i in results) {
            hoursArray.push(results[i]["Hour"]);
        }
        data.location = locationID;
        data.hours = hoursArray;
    } catch (error) {
        logger.info("update_delivery_schedule ERROR: ", {error});
        res.status(400).json({"message": "Incorrect Location provided!"});
        return;
    }
    res.json({"status": "OK", "data": data});

};

exports.update_delivery_schedule = async function(req, res) {
    let locationID = req.body["location"] || null;
    let hours = req.body["hours"] || ""; // array of hours in the day in UTC.

    let sql, args, sqlArray = [], hoursArray = [], results, message;
    if (locationID == null) {
        res.status(400).json({"message": "Location is required!"});
        return;
    }
    if (hours && typeof hours == "string") { // IF only one value is submitted, it's a string. Array is object.
        hoursArray.push(hours);
    } else {
        hoursArray = hours;
    }
    // validate location
    sql = `SELECT ID FROM container WHERE ID = ?`;
    args = [locationID];
    try {
        [results] = await pool.query(sql, args);
        if (results.length && results[0]["ID"]) {
            locationID = results[0]["ID"]; // set locatin to the correct format.
        } else {
            res.status(400).json({"message": "Incorrect Location provided!"});
            return;
        }
    } catch (error) {
        logger.info("update_delivery_schedule ERROR: ", {error});
        res.status(400).json({"message": "Incorrect Location provided!"});
        return;
    }

    sqlArray.push("DELETE FROM delivery_schedule WHERE LocationID = ?;");
    args = [locationID];
    for (let i in hoursArray) {
        sqlArray.push("INSERT INTO delivery_schedule (LocationID, Hour) VALUES (?);");
        args.push([locationID, hoursArray[i]]);
    }
    sql = sqlArray.join("\n");
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("update_delivery_schedule ERROR: ", {error});
        res.status(400).json({"message": "Updating Delivery schedule failed!"});
        return;
    }
    if (hoursArray.length) {
        message = `Delivery Schedule updated for ${locationID} to hours: ${hoursArray.join(", ")}.`;
    } else {
        message = `Delivery Schedule removed for ${locationID}.`;
    }
    res.json({"message": message});
};

exports.close_inactive_replenish_orders = async function(req, res) {
    // Close all tasks first that are not completed and are on the blacklist or are older than 2 days.
    // Close all old ROs with no tasks (older than 2 hours), with fulfilled tasks
    // Close task_groups where all tasks are fulfilled
    // Clear inventory for tasks that don't exist or are completed or fulfilled.
    logger.info("STARTING close_inactive_replenish_orders - close inactive ROs, tasks and task_groups...");

    let sql = `CALL ${config.sql_database_for_sp}.blacklist_update_cleanup;`;
    let message = [], results;
    try {
        // Despite this being a GET API, the stored procedure performs updates, so we can't use the RO database
        [results] = await pool.query(sql);
        results = results[0][0]; // Get the first row.
        message.push(`Closed: ${results.tasksUpdated} Tasks, ${results.replenEmptyUpdated} Empty ROs, ${results.replenUpdated} ROs, ${results.tgsUpdated} TGs.`);
        message.push(`Freed: ${results.inventoryUpdated} units of inventory.`);
        console.log(message.join("\n"));
        res.json({"status": "OK", "message": message});
    } catch (error) {
        logger.info("close_inactive_replenish_orders ERROR: ", {error});
        res.status(400).json({"message": "Error occured while attempting to close inactive Replenishment Orders."});
    }
};

exports.replenish_order_case = async function(req, res) {
    let forced = (req.body.forced == "true" || req.body.forced == 1) ? true : false;
    let locationsETA = (await apiRequest.post(req, "locations_eta", {}))["data"];
    let now = moment().format();
    let sql, args, results, message, DateDue, warehouses;

    // First attempt to lock in this process:
    sql = `
        UPDATE process_lock
        SET DateLocked = NOW()
        WHERE
            ProcessName = 'replenish_order_case'
            AND (DateLocked is null OR DateLocked < DATE_ADD(NOW(), INTERVAL -40 MINUTE))`;
    try {
        if (!forced) {
            // Don't update the lock when forcing a replenishment run
            [results] = await pool.query(sql);
        }
    } catch (error) {
        logger.error("replenish_order_wrh lock", {error});
        res.status(500).json({"message": "Error occured attempting to create a lock for warehouse replenish order."});
        return;
    }

    // Return response right away to prevent Lambda retry. Must return 200, cannot timeout with 504
    if (forced || results.affectedRows) {
        message = "Warehouse replenishment order job started...";
        console.log(moment().format(), message);
        res.status(200).json({"message": message});
    } else { // When locked, Return message and cancel execution
        message = "Warehouse Replenishment Order job cannot start at this time. Please wait for the next hour.";
        console.log(moment().format(), message);
        res.status(200).json({"message": message});
        return;
    }

    // Close all old replenish orders that do not have associated tasks.
    sql = `CALL ${config.sql_database_for_sp}.close_ro_without_tasks();`;
    try {
        [results] = await pool.query(sql);
        console.log(`replenish_order_case: ${results[0][0].closedReplenish} replenish orders without tasks closed`);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    sql = `
        SELECT
            l.ID,
            l.DaysOfCoverage,
            l.DCLocationID,
            HOUR(CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', l.Timezone)), INTERVAL rs.Hour HOUR), l.Timezone, 'UTC')) AS UtcHour
        FROM location l
        INNER JOIN (
            SELECT DISTINCT LocationID FROM replenish_schedule
        ) AS s ON s.LocationID = l.ID
        INNER JOIN container c ON c.ID = l.ID
        INNER JOIN replenish_schedule rs ON rs.LocationID = c.ID
        WHERE c.type = 'WRH'
        HAVING UtcHour = HOUR(NOW());`;

    try {
        [warehouses] = await pool.query(sql);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    // Clean up old replenishment_log entries since the table gets very large
    sql = `DELETE FROM replenishment_log WHERE Date < NOW() - INTERVAL 1 WEEK`;
    try {
        await pool.query(sql);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    if (!warehouses.length) {
        let message = "No Warehouses scheduled to Replenish. Exiting...";
        console.log(moment().format(), message);
        return;
    }

    for (let warehouse of warehouses) {
        let wrhId = warehouse.ID;
        let wrhDOC = warehouse.DaysOfCoverage;
        let dc = warehouse.DCLocationID;
        let stores;

        sql = `
            SELECT l.ID, l.DaysOfCoverage, l.isReplenishedByMDU
            FROM location l
            INNER JOIN (
                SELECT DISTINCT LocationID FROM replenish_schedule
            ) AS s ON s.LocationID = l.ID
            INNER JOIN container c on c.ID = l.ID
            WHERE c.type = 'STR'
            AND l.WarehouseID = ?;`;
        args = [wrhId];

        try {
            [stores] = await pool.query(sql, args);
        } catch (error) {
            logger.error("replenish_order_case SQL:", {error});
            return;
        }

        for (let store of stores) {
            let strId = store.ID;
            let strDOC = store.DaysOfCoverage;
            let isMDU = store.isReplenishedByMDU;

            sql = `
                INSERT INTO
                    replenishment_log (Date, Keycode, Store, Warehouse, DC, AWS, MDU, StoreDOC, WarehouseDOC, StoreInventory, WarehouseInventory, StoreReplenishment, Complience)
                SELECT
                    ? as Date,
                    p.Keycode,
                    ? as Store,
                    ? as Warehouse,
                    ? as DC,
                    IFNULL(a.AWS, 0) as AWS,
                    calc_mdu(m.MDU, i.StoreDefaultMDU, m.PDU, m.DateStartPDU, m.DateEndPDU, f.MDU) as MDU,
                    ? as StoreDOC,
                    ? as WarehouseDOC,
                    IFNULL(i.inventory, 0) as StoreInventory,
                    IFNULL(inv.inventory + IF(IFNULL(t.qty, 0) < 0, 0, IFNULL(t.qty, 0)), 0) as WarehouseInventory,
                    calculate_need(?, ?, IFNULL(a.AWS,0), calc_mdu(m.MDU, i.StoreDefaultMDU, m.PDU, m.DateStartPDU, m.DateEndPDU, f.MDU), IFNULL(i.inventory,0)) as StoreReplenishment,
                    p.US_Overall_Test_Result_CONFIRMED as Complience
                FROM product p
                LEFT JOIN (
                    SELECT *
                    FROM product_mdu
                    WHERE LocationID = ?
                ) as m on p.Keycode = m.Keycode
                LEFT JOIN (
                    SELECT *
                    FROM product_aws
                    WHERE LocationID = ?
                ) as a on p.Keycode = a.Keycode
                LEFT JOIN (
                    SELECT i.Keycode, IFNULL(i.Qty, 0) AS inventory, loc.StoreDefaultMDU
                    FROM container c
                    INNER JOIN location loc ON loc.ID = c.ID
                    LEFT JOIN (
                        SELECT i.ContainerID, i.Keycode, count(*) AS Qty FROM inventory i
                        LEFT JOIN container c ON c.ID = i.ContainerID
                        WHERE c.Type = 'STR'
                        GROUP BY Keycode, i.ContainerID
                    ) AS i ON i.ContainerID = c.ID
                    WHERE c.ID = ?
                ) as i ON p.Keycode = i.Keycode
                LEFT JOIN (
                    SELECT true AS 'Black', p.keycode, locationid
                    FROM product_blacklist b
                    INNER JOIN product p
                    ON b.keycode = p.Keycode
                    WHERE locationid = ?
                ) as b on b.Keycode = p.Keycode
                LEFT JOIN (
                    SELECT c.LocationID AS Location, i.Keycode, count(*) AS inventory
                    FROM inventory i
                    INNER JOIN container c ON i.ContainerID = c.ID AND c.Type IN ('SHL','RSV', 'RCV', 'CRT')
                    WHERE i.TaskID is null
                    AND c.LocationID = ?
                    GROUP by c.LocationID, i.Keycode
                ) as inv ON inv.Keycode = p.Keycode
                LEFT JOIN (
                    SELECT ro.Keycode, (ifnull(sum(ro.quantity), 0) - ifnull(sum(ro.quantityfilled), 0)) as qty
                    FROM replenish_order ro
                    LEFT JOIN task
                    ON task.rowid = ro.rowid AND task.Type = 'Pick'
                    WHERE task.rowid IS NULL
                    AND ro.DateFulfilled IS NULL
                    AND ro.sourcelocation = ?
                    group by ro.Keycode
                ) as t on t.Keycode = p.Keycode
                LEFT JOIN product_attr pa on pa.Keycode = p.Keycode
                # TEMP CHANGE TO AVOID TABLE CHANGES
                LEFT JOIN fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code
                AND f.LocationID = 'DEFAULT'
                # AND  f.LocationID = ?
                # IF THE STORE IS REPLENISHED BY MDU AND MDU IS ZERO OR NULL WE DON'T WANT TO REPLENISH
                WHERE NOT (IFNULL(m.MDU,0) = 0 and ? is true)
                AND p.Sell_Price_Usd IS NOT null AND p.Sell_Price_Usd > 0
                AND b.Black is not true
                AND p.US_Overall_Test_Result_CONFIRMED in ('RELEASE','SELL THROUGH')
                AND p.In_US_Range = 1
                AND (pa.DateOnShowPlanned IS NOT NULL OR pa.DateOnShowActual IS NOT NULL)
                AND NOW() >= DATE_ADD(IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned), INTERVAL -10 DAY)
                AND (pa.DateOffShowActual is null OR NOW() <= pa.DateOffShowActual);`;

            args = [now, strId, wrhId, dc, strDOC, wrhDOC, wrhDOC, strDOC, strId, strId, strId, strId, wrhId, dc, isMDU];
            try {
                await pool.query(sql,args);
            } catch (error) {
                logger.error("replenish_order_case SQL:", {error});
                return;
            }
        }

        if (wrhId == "LYN1-WRH") {
            // Add ONLINE-STR Sales to the Replenishment
            sql = `
                INSERT INTO replenishment_log (Date, Keycode, Store, Warehouse, DC,StoreInventory, WarehouseInventory, StoreReplenishment, Complience)
                SELECT ? AS Date, p.Keycode, 'ONLINE-STR' AS Store, 'LYN1-WRH' AS Warehouse, 'FIF1-WRH' AS DC, 0 AS StoreInventory,
                    IFNULL(i.WarehouseInventory, 0) AS WarehouseInventory,
                    SUM(Quantity) AS StoreReplenishment,
                    p.US_Overall_Test_Result_CONFIRMED AS Complience
                FROM sale_transaction st
                INNER JOIN product p ON st.Keycode = p.Keycode
                LEFT JOIN (
                    SELECT i.Keycode, IFNULL(count(*), 0) AS WarehouseInventory
                    FROM inventory i
                    INNER JOIN container c ON c.ID = i.ContainerID AND c.Type IN ('SHL','RSV', 'RCV', 'CRT') AND c.Locationid = 'LYN1-WRH'
                    WHERE i.TaskID is null
                    GROUP by i.Keycode
                ) AS i ON i.Keycode = p.Keycode
                WHERE st.Date > date_add(NOW(), interval -1 day) AND location = 'ONLINE-STR' AND Quantity > 0
                GROUP BY p.Keycode`;
            args = [now];
            try {
                await pool.query(sql,args);
            } catch (error) {
                logger.error("replenish_order_case Online SQL:", {error});
                return;
            }
        }
    }

    // GET INCOMING REPLENISHMENT
    sql = `UPDATE replenishment_log r
        INNER JOIN (
            SELECT b.Keycode, SUM(t.Quantity * b.Quantity) AS incoming_replen, tg.TargetLocation
            FROM task t
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            INNER JOIN case_barcode b ON t.ProductID = b.Barcode
            WHERE t.Type IN ('Pick', 'CasePick') AND t.DateFulfilled IS NULL
            GROUP BY b.Keycode, tg.TargetLocation
        ) AS i ON i.Keycode = r.Keycode AND i.TargetLocation = r.warehouse
        SET r.IncomingReplenishment = i.incoming_replen
        WHERE Date = ?;`;
    args = [now];
    try {
        await pool.query(sql,args);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    // GET THE AVAILABLE INVENTORY
    sql = `UPDATE replenishment_log r
        INNER JOIN (
            SELECT b.Keycode, sum(b.Quantity) AS qty, LocationID
            FROM inventory_case ic
            INNER JOIN case_barcode b ON b.Barcode = ic.Barcode
            INNER JOIN container c ON ic.ContainerID = c.ID
            WHERE c.Type = 'RSV' and ic.TaskID IS NULL
            GROUP BY Keycode
            UNION ALL
            SELECT i.Keycode, count(*) AS qty, LocationID
            FROM inventory i
            INNER JOIN container c ON i.ContainerID = c.ID
            WHERE c.Type = 'RSV' and i.TaskID IS NULL
            GROUP BY Keycode
        ) AS i ON r.Keycode = i.Keycode
        SET r.DCInventory = i.qty
        WHERE r.DC = i.LocationID AND Date = ?;`;
    try {
        await pool.query(sql,args);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    // CALCULATE REPLENISHMENT FOR EACH KEYCODE FOR EACH WAREHOUSE
    sql = `UPDATE replenishment_log r
        INNER JOIN (
            SELECT CEIL(IF((StoreReplenishment - WarehouseInventory) < 0, 0, StoreReplenishment - WarehouseInventory)) - IncomingReplenishment AS WarehouseReplenishment, Keycode, Warehouse
            FROM (
                SELECT Keycode, Warehouse, SUM(StoreReplenishment) AS StoreReplenishment, WarehouseInventory, DCInventory, IncomingReplenishment
                FROM replenishment_log l
                WHERE l.Date = ?
                GROUP BY Warehouse,Keycode
            ) AS l
        ) AS l ON r.Warehouse = l.Warehouse AND r.Keycode = l.Keycode
        SET r.WarehouseReplenishment = l.WarehouseReplenishment
        WHERE r.Date = ?;`;
    args = [now, now];
    try {
        await pool.query(sql,args);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    DateDue = locationsETA["FIF1-WRH"]["Standard"]["DatePickETA"];
    args = [DateDue, now];
    sql = `
        INSERT IGNORE INTO replenish_order (ID, Keycode, SourceLocation, TargetLocation, TargetInventory, Quantity, QuantityFilled, SourceInventory, DateDue, DateFulfilled, ClusterWrhInventory)
        SELECT
            unix_timestamp() AS ID,
            r.Keycode,
            r.DC AS SourceLocation,
            r.Warehouse AS TargetLocation,
            SUM(r.StoreInventory) + r.WarehouseInventory AS TargetInventory,
            (r.WarehouseReplenishment * IFNULL(cal.Factor, 1)) AS Quantity,
            NULL AS QuantityFilled,
            r.DCInventory AS SourceInventory,
            ? AS DateDue,
            NULL AS DateFulfilled,
            r.WarehouseInventory
        FROM replenishment_log r
        LEFT JOIN (
            SELECT
                c.ID AS Location,
                DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS LocalDate
            FROM container c
            LEFT JOIN location loc ON loc.ID = c.ID
            WHERE c.Type = 'WRH'
        ) AS str ON str.Location = r.Warehouse
        LEFT JOIN replenish_factor_calendar cal ON cal.LocationID = str.Location AND cal.Date = str.LocalDate
        WHERE WarehouseReplenishment > 0 AND DCInventory > 0 AND r.Date = ?
        GROUP BY Warehouse, Keycode;`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("replenish_order_case SQL:", {error});
        return;
    }

    if (results.affectedRows != 0) {
        // INSERT if the row doesn't exist yet
        let message = `Replenishment order generated successfully. ${results.affectedRows} rows inserted.`;
        console.log(moment().format(), message);
    } else {
        let message = "Replenishment order processed - no new rows inserted.";
        console.log(moment().format(), message);
    }
};

exports.replenish_case_to_task = async function(req, res) {
    let inlocations = req.body["locations"];
    let isManual = (req.body.isManual == "true" || req.body.isManual == 1) ? true : false;
    let replenID = req.body["replenID"] || null;
    let source = req.body.source || null;
    let name = req.body.name || null;
    let locations = null;
    let sql, args, results;

    if (inlocations) {
        if (!Array.isArray(inlocations)) {
            locations = [inlocations];
        } else {
            locations = inlocations;
        }
    }

    if (!locations) {
        sql = `
            UPDATE process_lock
            SET DateLocked = NOW()
            WHERE
            ProcessName = 'replenish_case_to_task'
            AND (DateLocked IS NULL OR DateLocked < DATE_ADD(NOW(), INTERVAL -40 MINUTE))`;

        try {
            [results] = await pool.query(sql);
        } catch (error) {
            logger.error("replenish_case_to_task", {error});
            res.status(500).json({"message": "Could not update the process lock for replenish_case_to_task"});
            return;
        }

        /* For all warehouse locations at the current time, get the UTC hour from the replenish_schedule
         * Example: If it's 10:45am PST and this query is ran, then the result will look something like below
         *
         * ID      , UtcHour
         * LYN1-WRH, 18
         *
         * It's possible for no rows to be selected if this query is ran at a time where
         * no replenishments are scheduled, which in that case means nothing will happen
         */
        sql = `
            SELECT
                c.ID,
                HOUR(CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL rs.Hour HOUR), loc.Timezone, 'UTC')) AS UtcHour
            FROM container c
            INNER JOIN replenish_schedule rs ON rs.LocationID = c.ID
            LEFT JOIN location loc ON loc.ID = c.ID
            WHERE c.Type = 'WRH'
            HAVING UtcHour = Hour(Now())`;

        try {
            [results] = await pool.query(sql);
            locations = results.map(a => a["ID"]);
        } catch (error) {
            logger.error("replenish_case_to_task", {error});
            res.status(500).json({"message": "Could not retrieve the replenish schedule"});
            return;
        }
    }

    if (locations) {
        // Immediately send a response because this is a long-running task, and we need to prevent a Lambda retry. Must return 200 and cannot timeout with 504
        res.status(200).json({"message": "Replenishment order to task job started..."});
    } else {
        // Do not execute the replenishment to case if the process is currently locked
        res.status(200).json({"message": "Replenishment Case Order to Task job cannot start at this time. Please wait for the next hour"});
        return;
    }

    if (!isManual) {
        logger.info("Creating replenishment for cases needed for online orders");
        //await _onlineOrderToCaseTasks();
    }

    for (let location of locations) {
        logger.info("Creating replenishment for warehouse:", {location});
        await _replenishCaseToTask(location, isManual, replenID);
        logger.info("Replenishment complete for warehouse:", {location});
    }

    try {
        await apiRequest.get(req, "taskgroup/group_pick_tasks", { source: source, name: name });
    } catch (error) {
        logger.error("grouping casepick tasks", {error});
    }

    // Record logging information and upload it to our S3 bucket after all tasks for all locations have been grouped
    for (let location of locations) {
        let filename = moment().tz("America/Los_Angeles").format("YYYY-MM-DD_HH-mm-ss_") + location + ".csv";

        args = [location, location, location];
        sql = `
            SELECT
                b.Keycode,
                c.TotalDemand AS 'Desired Replenishment',
                IFNULL(a.TotalQuantity, 0) AS 'Replenishment Amount',
                IFNULL(a.CaseQuantities, 0) AS 'Case Quantities',
                b.OutOfStock AS 'Out of Stock'
            FROM (
                SELECT
                    keycodes.Keycode,
                    SUM(keycodes.TotalQuantity) AS TotalQuantity,
                    GROUP_CONCAT(DISTINCT keycodes.QuantityInCase) AS CaseQuantities
                FROM (
                    SELECT
                        cb.Keycode,
                        cb.Quantity AS QuantityInCase,
                        (cb.Quantity * SUM(t.Quantity)) AS TotalQuantity
                    FROM task_group tg
                    INNER JOIN task t ON t.TaskGroupID = tg.ID
                    INNER JOIN case_barcode cb ON cb.Barcode = t.Barcode
                    WHERE tg.TargetLocation = ? AND t.DateFulfilled IS NULL
                    GROUP BY cb.Keycode, cb.Barcode
                ) AS keycodes
                GROUP BY keycodes.Keycode
            ) AS a
            RIGHT JOIN (
                SELECT Keycode, IF(MIN(TargetInventory) = 0, TRUE, FALSE) AS OutOfStock
                FROM replenish_order
                WHERE DateFulfilled IS NULL AND TargetLocation = ?
                GROUP BY SourceLocation, TargetLocation, Keycode ORDER BY SUM(Quantity)
            ) AS b ON b.Keycode = a.Keycode
            INNER JOIN (
                SELECT Keycode, IF(SUM(Quantity) = 1, 2, SUM(Quantity)) AS TotalDemand
                FROM replenish_order
                WHERE DateFulfilled IS NULL AND TargetLocation = ?
                GROUP BY SourceLocation, TargetLocation, Keycode ORDER BY Keycode ASC
            ) AS c ON c.Keycode = b.Keycode
            ORDER BY b.Keycode ASC`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("Recording logging information in replenish_case_to_task", {error});
            return;
        }

        if (results.length) {
            let fileInput = await csvConverter.json2csvAsync(results, {emptyFieldValue: ""}) + "\n";
            let caseToTaskBucketName = config.s3_bucket.replenish_case_to_task;
            helpers.uploadFileToS3(caseToTaskBucketName, filename, fileInput);
        }
    }
};

exports.debug_get_replen_by_productId = async function(req, res) {
    const barcode = req.query.barcode || req.body.barcode;
    const location = req.query.locationID || req.body.locationID;
    let sql = `Select Timezone from location where ID = ?`;
    let args = [location];
    let results;
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        res.status(500).json({"message": `Unable to get location timezone data: ${location}.`});
        return;
    }
    if (results) {
        sql = `
        SELECT Keycode, SourceLocation, TargetLocation, AWS, MDU, TargetInventory, Quantity,
        QuantityFilled, SourceInventory, Priority, OrderType,
        DateCreated,
        DateDue,
        DateFulfilled,
        FROM replenish_order
        WHERE Keycode = ?
        Order By DateCreated DESC`;
        args = [barcode];
        try {
            [results] = await ro_pool.query(sql, args);
            if (results.length > 0) {
                res.status(200).json({"data": results});
            } else {
                res.status(500).json({"message": `No replenish order found for keycode: ${barcode}.`});
            }
        } catch (error) {
            res.status(500).json({"message": `No replenish order found for keycode: ${barcode}.`});
        }
    }
};

exports.debug_replenishment = async function(req, res) {
    let productID = req.query.ProductID || null;
    const locationID = req.query.LocationID || null;
    let sql, args, results, response = {};

    if (!productID) {
        res.status(400).json({"message": `You must provide ProductID! It can be a barcode or keycode.`});
        return;
    }

    if (!locationID) {
        res.status(400).json({"message": `Location is required`});
        return;
    }

    // API accepts keycode & barcode, so determine the keycode for barcode input
    sql = `SELECT Keycode from product_barcode where Barcode = ? OR Keycode = ? LIMIT 1;`;
    args = [productID, productID];

    try {
        [results] = await ro_pool.query(sql, args);
        if (!results.length) {
            res.status(400).json({"message": "You must provide ProductID! It can be a barcode or keycode."});
            return;
        } else {
            productID = results[0].Keycode;
        }
    } catch (error) {
        logger.info("debug_replenish_by_productId ERROR: ", {error});
        res.status(400).json({"message": "Incorrect ProductID provided!"});
        return;
    }

    sql = `
        SELECT ID, DaysOfCoverage, timezone, WarehouseID, DCLocationID, isReplenishedByMDU,
        CASE
            WHEN isDC = 1 THEN 'DC'
            WHEN isWRH = 1 THEN 'WRH'
            WHEN isSTR = 1 THEN 'STR'
            ELSE 'ISERROR'
        END AS Type
        FROM (
            SELECT
            ID, DaysOfCoverage, timezone, WarehouseID, DCLocationID, isReplenishedByMDU,
            IF(WarehouseID IS NULL AND DCLocationID IS NULL, true, false) as isDC,
            IF(WarehouseID IS NULL AND DCLocationID IS NOT NULL, true, false) as isWRH,
            IF(WarehouseID IS NOT NULL AND DCLocationID IS NULL, true, false) as isSTR
            FROM location
            WHERE ID = ?
        ) as loc
    `;
    args = [locationID];
    try {
        [results] = await ro_pool.query(sql, args);
        /**
         *  Sample result:
         *  ID          Type
         *  FIF1-WRH    DC
         *  LYN1-WRH    WRH
         *  LYN2-STR    STR
         */

        if (!results.length) {
            throw new Error("Incorrect Location");
        }

        // based on user's location, find out which replenishment model applies
        let resultData;
        let locationInfo = results[0];
        if (results[0].Type === "DC") {
            resultData = await _mccReplenishment(productID);
            response["MCC"] = resultData;
        } else if (results[0].Type === "WRH") {
            resultData = await _wrhReplenishment(productID, locationID);
            response["WRH"] = resultData;
        } else if (results[0].Type === "STR") {
            resultData = await _strReplenishment(productID, locationID, locationInfo );
            response["STR"] = resultData;
        }
    } catch (error) {
        logger.info("debug_replenish_by_productId ERROR: ", {error});
        res.status(400).json({"message": "Incorrect Location provided!"});
        return;
    }

    /**
     *  Sample response:
     *  Only 1 key will be returned based on the replenishment model
     * {
     *  MCC: [ [object], [object, ...]],
     *  STR: [ [object], [object, ...]],
     *  WRH: [ [object], [object, ...]]
     * }
     */
    res.status(200).json({"data": response});
};

async function _replenishCaseToTask(locations, isManual, replenID) {
    let FLEXIBLE_FACTOR = 0.5; // 50%
    let caseOrder = []; // A sorted array that will have the highest-prioritized cases to pick from at the start
    let collection = {}; // Which cases to create tasks for, and where those cases are located
    let want = {}; // This object tracks the case barcodes that we want to replenish
    let outOfStock = {}; // This object tracks which products are out of stock (OOS products will always take at least one case)
    let codeToRowId = {}; // This object maps keycodes and case barcodes to row IDs, which is useful when we create tasks for the cases and is needed to populate replenishment_task_connector
    let inventoryHave, caseHave; // These objects track the products or case barcodes that we have available for allocating to tasks
    let results1 = null, results2 = null; // Initialize these to null because we'll need to check if they are set later
    let keycodeCollection = [], barcodeCollection = [];
    let taskIDKeycode, sqlKeycodeTasks = [], argsKeycodeTasks = [];
    let taskIDBarcode, sqlBarcodeTasks = [], argsBarcodeTasks = [];
    let inventoryResults, caseResults, demand, codeToRowIdResults, wantArray, have;
    let sqlKeycode, sqlBarcode, argsKeycode, argsBarcode, results;

    try {
        [results] = await pool.query(`CALL ${config.sql_database_for_sp}.replenish_case_to_task(?, ?, ?)`, [locations, isManual, replenID]);
        /* The stored procedure returns four different SELECT queries:
         *   1. Get available products in the inventory table that can be assigned to a task
         *   2. Get available cases in inventory_case that can be assigned to a task
         *   3. Get the total demand of all keycodes that need to be fulfilled, and whether or not they are out of stock
         *   4. Get the data that maps keycodes and case barcodes to replenish order row IDs */
        inventoryResults = results[0];
        caseResults = results[1];
        demand = results[2];
        codeToRowIdResults = results[3];
    } catch (error) {
        logger.error("replenish_case_to_task:", {error});
        return;
    }

    for (let row of codeToRowIdResults) {
        let code = row["Code"]; // This will be either a case barcode or keycode
        let rowId = row["RowID"];
        if (code in codeToRowId) {
            codeToRowId[code].push(rowId);
        } else {
            codeToRowId[code] = [rowId];
        }
    }

    // Parse the demand array from MySQL to a mapping which contains the keycodes and quantities that we want
    for (let row of demand) {
        let keycode = row["Keycode"];
        let totalDemand = row["TotalDemand"];
        let isOutOfStock = row["OutOfStock"];

        /* Add the keycode to our outOfStock map if either of these conditions are true:
        /* 1. The database reports that this keycode is out of stock
        /* 2. The replenishment isn't enough to justify picking a case when we need one (ClusterWrhInventory is 0) */
        if (isOutOfStock || row["ClusterWrhInventory"] == 0) {
            outOfStock[keycode] = null;
        }

        // Record the amount that we want of this keycode into our "want" map
        want[keycode] = parseInt(totalDemand);

        /* Example of the want object after the data is populated:
         * { "10000002": 1,
         *   "10000003": 7,
         *   "10000004": 5,
         *   "10000005": 15,
         *   "10000006": 5,
         *   "10000007": 2,
         *   "10000009": 6 } */
    }

    // Get a simple array of all keycodes that we want
    wantArray = Object.getOwnPropertyNames(want);

    // Parse the caseResults array from MySQL to a caseData mapping
    have = _getFormattedCases(inventoryResults, caseResults, wantArray);
    inventoryHave = have["inventoryHave"];
    caseHave = have["caseHave"];

    // Populate caseOrder; the order in which cases will be inspected for picking
    caseOrder = _getCaseOrder(caseHave, wantArray);

    // Populate collection; an object that will determine what tasks will be created
    collection = _getCaseTasks(want, inventoryHave, caseHave, caseOrder, outOfStock, FLEXIBLE_FACTOR);

    /* Examples on how the data is structured across the different variables that are used
     *
     * EXAMPLE: caseResults
     * [{
     *     ContainerID: "FIF1-R30-077A",
     *     Barcode: "CS-0-37961022",
     *     CaseCount: 10,
     *     Keycodes: "37961022",
     *     Quantities: "2"
     * },{
     *     ...
     * }]
     *
     * EXAMPLE: demand
     * [{
     *     RowID: 471258,
     *     Keycode: 10000002,
     *     SourceLocation: "FIF1-WRH",
     *     TargetLocation: "LYN1-WRH",
     *     TotalDemand: "1"
     * },{
     *     ...
     * }]
     *
     * EXAMPLE: caseOrder
     * [{
     *     caseBarcode: "MX-1000000000",
     *     sortIndex: 1
     * },{
     *     caseBarcode: "CX-1000000000",
     *     sortIndex: 0.75
     * },{
     *     ...
     * }]
     *
     * EXAMPLE: have
     * {
     *     "CS-2-10000005": {
     *         keycodes: { "10000005": 2 },
     *         locations: [ "FIF1-RSV-TST1" ]
     *     },
     *     "MX-2000000000": {
     *         keycodes: { "10000004": 4, "10000006": 5 },
     *         locations: [ "FIF1-RSV-TST1", "FIF1-RSV-TST2" ]
     *     },
     *     "..." : {
     *         ...
     *     }
     * }
     *
     * EXAMPLE: want
     * {
     *     10000002: 1,
     *     10000003: 7,
     *     10000004: 5,
     *     ...
     * }
     *
     * EXAMPLE: codeToRowId
     * {
     *     "CS-2-10000005": 471261,
     *     "CS-4-10000005": 471261,
     *     "CS-5-10000009": 471394,
     *     "CX-1000000000": 471259,
     *     ...
     *  }
     *
     * EXAMPLE: collection
     * {
     *     "CX-1000000000": { "FIF1-RSV-TST1": 5 },
     *     "CX-1000000000": { "FIF1-RSV-TST2": 7 },
     *     "CS-4-10000005": { "FIF1-RSV-TST1": 2 },
     *     ...
     * } */

    if (Object.keys(collection).length == 0) {
        logger.info("There is nothing to replenish for warehouse:", {locations});
        return;
    }

    // Create tasks for cases
    sqlKeycode = `INSERT INTO task (Keycode,            RowID, Quantity, SourceContainer, Type) VALUES ?`;
    sqlBarcode = `INSERT INTO task (Barcode, ProductID, RowID, Quantity, SourceContainer, Type) VALUES ?`;
    argsKeycode = [];
    argsBarcode = [];

    /* Example of the object: collection
     * {
     *   "42563907":      { "FIF1-R31-051A": 5 },
     *   "42608318":      { "FIF1-R31-051A": 4 },
     *   "CS-0-42563907": { "FIF1-R31-051A": 2 },
     *   "CS-0-42608318": { "FIF1-R48-006A": 1 }
     * }
     *
     * The key will either be a Keycode or Case Barcode, and the value will always be an
     * object of ContainerIDs, with their value being the quantity that needs to be picked
     */

    for (let property in collection) {
        // An easy way to tell if the property is a "Keycode" or "Case Barcode" is to parse it as an
        // integer and compare that against what it was before being parsed. If it matches, then it's
        // a "Keycode". Otherwise, it's a "Case Barcode"
        let isKeycode = false;
        if (property == parseInt(property)) {
            isKeycode = true;
        }

        if (isKeycode) {
            // It's a "Keycode"
            for (let location in collection[property]) {
                let quantity = collection[property][location];
                let rowId = codeToRowId[property][0]; // This may have multiple row IDs, but we can just pick the first occurrence (0th index)
                keycodeCollection.push(property);
                argsKeycode.push([property, rowId, quantity, location, "Pick"]);
            }
        } else {
            // It's a "Case Barcode"
            for (let location in collection[property]) {
                let quantity = collection[property][location];
                let rowId = codeToRowId[property][0]; // This may have multiple row IDs, but we can just pick the first occurrence (0th index)
                barcodeCollection.push(property);
                argsBarcode.push([property, property, rowId, quantity, location, "Pick"]);
            }
        }
    }

    try {
        if (argsKeycode.length) {
            [results1] = await pool.query(sqlKeycode, [argsKeycode]);
        }

        if (argsBarcode.length) {
            [results2] = await pool.query(sqlBarcode, [argsBarcode]);
        }
    } catch (error) {
        logger.error("Unable to create tasks for replenish_case_to_task", {error});
        return;
    }

    // Reserve inventory for keycodes (if any results exist); inventory will be updated with the necessary task IDs
    if (results1) {
        taskIDKeycode = parseInt(results1.insertId);

        for (let row of argsKeycode) {
            // Example of row: [ "10000001", 55354, 2, "FIF1-RSV-TST1", "Pick" ]
            let keycode = row[0];
            let quantity = row[2];
            let containerId = row[3];
            sqlKeycodeTasks.push("UPDATE inventory SET TaskID = ? WHERE Keycode = ? AND ContainerID = ? AND TaskID IS NULL LIMIT ?");
            argsKeycodeTasks.push([taskIDKeycode++, keycode, containerId, quantity]);
        }

        try {
            await helpers.largeSQLQuery(sqlKeycodeTasks, argsKeycodeTasks);
        } catch (error) {
            logger.error("Reserving case inventory in replenish_case_to_task", {error});
            return;
        }
    }

    // Reserve inventory for case barcodes (if any results exist); inventory will be updated with the necessary task IDs
    if (results2) {
        taskIDBarcode = parseInt(results2.insertId);

        for (let row of argsBarcode) {
            // Example of row: [ "CS-0-10000004", "CS-0-10000004", 55355, 2, "FIF1-RSV-TST1", "Pick" ]
            let barcode = row[0];
            let quantity = row[3];
            let containerId = row[4];
            sqlBarcodeTasks.push("UPDATE inventory_case SET TaskID = ? WHERE Barcode = ? AND ContainerID = ? AND TaskID IS NULL LIMIT ?");
            argsBarcodeTasks.push([taskIDBarcode++, barcode, containerId, quantity]);
        }

        try {
            await helpers.largeSQLQuery(sqlBarcodeTasks, argsBarcodeTasks);
        } catch (error) {
            logger.error("Reserving case inventory in replenish_case_to_task", {error});
            return;
        }
    }
}

function _getCaseOrder(have, wantArray) {
    let caseOrder = [];
    // Populate caseOrder; the cases that will be inspected for picking
    for (let caseBarcode in have) {
        // Calculate the sortIndex which is a number from 0 to 1, representing anywhere from a 0% match to a 100% match
        let haveArray = Object.getOwnPropertyNames(have[caseBarcode]["keycodes"]);
        let matches = haveArray.filter(a => wantArray.includes(a)).length;
        let sortIndex = matches / haveArray.length;
        caseOrder.push({"caseBarcode": caseBarcode, "sortIndex": sortIndex});
    }

    // Sort caseOrder according to its sort index
    caseOrder.sort((a, b) => (a["sortIndex"] < b["sortIndex"]) ? 1 : -1);
    return caseOrder;
}

function _getFormattedCases(inventoryResults, caseResults, wantArray) {
    let inventoryHave = {}; // Tracks the products in the "inventory" table that we have available for allocating to tasks
    let caseHave = {}; // Tracks the case barcodes the "inventory_case" table that we have available for allocating to tasks

    // Populate: inventoryHave
    for (let productData of inventoryResults) {
        // Need to convert the keycode from number to string so that we can compare it against the elements in wantArray
        let keycode = productData["Keycode"].toString();
        let quantity = productData["Quantity"];
        let containerId = productData["ContainerID"];

        if (!(wantArray.includes(keycode))) {
            continue;
        }

        // If the current keycode isn't recorded, initialize a new keycode object in what we have
        if (!(keycode in inventoryHave)) {
            inventoryHave[keycode] = {
                "locations": []
            };
        }

        // Push the quantity of products that appear in the current containerId
        for (let i = 0; i < quantity; i++) {
            inventoryHave[keycode]["locations"].push(containerId);
        }
    }

    // Populate: caseHave
    for (let caseData of caseResults) {
        let barcode = caseData["Barcode"];
        let location = caseData["ContainerID"];
        let caseCount = caseData["CaseCount"];
        let keycodes = caseData["Keycodes"].split(",");
        let quantities = caseData["Quantities"].split(",");
        let commonKeycode = false;

        for (let i = 0; i < wantArray.length; i++) {
            if (keycodes.indexOf(wantArray[i]) > -1) {
                commonKeycode = true;
                break;
            }
        }

        // Skip adding this case into what we have if it doesn't share at least one common keycode with what we want
        if (!commonKeycode) {
            continue;
        }

        // If the current barcode isn't recorded, initialize a new barcode object in what we have
        if (!(barcode in caseHave)) {
            caseHave[barcode] = {
                "keycodes": {},
                "locations": []
            };

            // Record all keycodes and their quantities
            for (let i = 0; i < keycodes.length; i++) {
                let keycode = keycodes[i];
                let quantity = quantities[i];
                caseHave[barcode]["keycodes"][keycode] = parseInt(quantity);
            }
        }

        // Push a number of string locations equal to the case count
        for (let i = 0; i < caseCount; i++) {
            caseHave[barcode]["locations"].push(location);
        }
    }

    return {
        inventoryHave: inventoryHave,
        caseHave: caseHave
    };
}

function _getCaseTasks(want, inventoryHave, caseHave, caseOrder, outOfStock = {}, FLEXIBLE_FACTOR = 1) {
    let collection = {};

    // Loop through each unique keycode that we want
    for (let keycode in want) {
        // Continue onto the next keycode if the keycode we want has already been fulfilled from previous cases
        if (want[keycode] <= 0) {
            continue;
        }

        // Check the "inventory" first before checking cases
        if (keycode in inventoryHave) {
            let locations = inventoryHave[keycode]["locations"];
            let quantityAvailable = locations.length;
            let take = Math.min(quantityAvailable, parseInt(want[keycode]));
            let retrievedLocations = locations.splice(0, take);

            for (let i = 0; i < retrievedLocations.length; i++) {
                let location = retrievedLocations[i];

                // Record the case into our collection
                if (keycode in collection) {
                    if (location in collection[keycode]) {
                        collection[keycode][location]++;
                    } else {
                        collection[keycode][location] = 1;
                    }
                } else {
                    collection[keycode] = {};
                    collection[keycode][location] = 1;
                }
            }

            // Remove inventory we took from individual items from the amount we want.ß
            want[keycode] -= take;

            // Delete this keycode from what we have in the inventory if there are no more available locations to get from
            if (inventoryHave[keycode]["locations"].length == 0) {
                delete inventoryHave[keycode];
            }
        }

        // Continue onto the next keycode if the keycode we want has already been fulfilled from retrieving it from the inventory above
        if (want[keycode] <= 0) {
            continue;
        }

        // Loop through each case that is appropriate for picking, starting with the highest-matching ones first
        for (let i = 0; i < caseOrder.length; i++) {
            let row = caseOrder[i];
            let caseBarcode = row["caseBarcode"];
            let desiredQuantity = want[keycode];

            // Check if we actually have this case
            if (!(caseBarcode in caseHave)) {
                continue;
            }

            let availableQuantity = caseHave[caseBarcode]["keycodes"][keycode] || 0;
            let ratio = desiredQuantity / availableQuantity;

            // Claim the case for picking if it has keycodes available for replenishment
            if (availableQuantity > 0) {
                // Claim the case for picking if the ratio meets our determined percentage, or and the ratio meets our determined percentage or it's out of stock
                if ((keycode in outOfStock) || ratio >= FLEXIBLE_FACTOR) {
                    delete outOfStock[keycode]; // Delete the keycode from the object tracking our OOS products (this will do nothing if the keycode doesn't exist which is fine)
                } else {
                    continue;
                }

                let location = caseHave[caseBarcode]["locations"].shift(); // Remove an available location from the array of available locations

                // Record the case into our collection
                if (caseBarcode in collection) {
                    if (location in collection[caseBarcode]) {
                        collection[caseBarcode][location]++;
                    } else {
                        collection[caseBarcode][location] = 1;
                    }
                } else {
                    collection[caseBarcode] = {};
                    collection[caseBarcode][location] = 1;
                }

                // Subtract how many keycodes we still want by the quantity of each unique keycode in this case
                for (let keycode2 in caseHave[caseBarcode]["keycodes"]) {
                    let quantity2 = caseHave[caseBarcode]["keycodes"][keycode2];

                    if (keycode2 in want) {
                        want[keycode2] -= quantity2;
                    }
                }

                // Delete this case from what we have if there are no more available locations to get from
                if (caseHave[caseBarcode]["locations"].length == 0) {
                    delete caseHave[caseBarcode];
                    caseOrder.splice(i, 1);
                }

                i--; // Because we claimed a case, we need to go back a step in the caseOrder array in order to repeat the same type of case again
            }

            // Stop searching through cases if we no longer want any of the current keycode that we're looking for
            if (want[keycode] <= 0) {
                break;
            }
        }
    }

    return collection;
}

function _prepareCSVobject(csvObj) {

    let output = {};
    let storeArray, tempObj, hasStoreData, keycode, source_location, uniqueSourceLocationCheck;

    let csvColumns = Object.keys(csvObj[0]).map((column) => column.toUpperCase());

    if (!csvColumns.includes("SOURCE LOCATION")) {
        throw new Error("Source Location is required column");
    } else {
        uniqueSourceLocationCheck = csvObj[0]["Source Location"];
    }

    // Loop through the array
    for (let i in csvObj) {
        storeArray = [];
        hasStoreData = false;
        keycode = "";

        // Loop through the object properties
        for (let j in csvObj[i]) {
            let key = j.toUpperCase();
            let val = null;
            tempObj = {};


            if (key == "KEYCODE" && csvObj[i][j]) {
                keycode = csvObj[i][j];
            } else if (key === "SOURCE LOCATION") {
                if (csvObj[i][j]) {
                    source_location = csvObj[i][j];
                    if (source_location !== uniqueSourceLocationCheck) {
                        throw new Error("Source Location has to be same for all keycodes in file");
                    }
                    if (source_location.match(/-STR$/g)) {
                        throw new Error("Source Location can not be Store Location");
                    }
                } else {
                    throw new Error("For Every Keycode Source location in required");
                }
            } else if (key.match(/-STR$/g)) {
                val = parseInt(csvObj[i][j]);
                // value is quantity, if quantity is not number or it's 0, ignore it.
                if (val) {
                    hasStoreData = true;
                    tempObj.source_location = source_location;
                    tempObj.store = key;
                    tempObj.quantity = val;
                    storeArray.push(tempObj);
                }
            } else if (key.match(/-WRH$/g)) {
                val = parseInt(csvObj[i][j]);
                // value is quantity, if quantity is not number or it's 0, ignore it.
                if (val) {
                    hasStoreData = true;
                    tempObj.source_location = source_location;
                    tempObj.store = key;
                    tempObj.quantity = val;
                    storeArray.push(tempObj);
                }
            }
        }
        if (hasStoreData && keycode != "") {
            output[keycode] = storeArray;
        }
    }

    return output;
}

async function _mccReplenishment(productID) {
    let sql, args, results;
    sql = `
        SELECT
            p.Keycode,
            p.In_US_Range,
            IF(US_Overall_Test_Result_CONFIRMED IS NOT NULL AND US_Overall_Test_Result_CONFIRMED = 'RELEASE', true, false) AS isUSOverallStatus,
            IF( DateOnShowPlanned <= DATE_ADD(NOW(), INTERVAL 11 WEEK), true, false) AS isOnShow,
            IF((DateOffShowPlanned IS NULL OR DateOffShowPlanned >= DATE_ADD(NOW(), INTERVAL 11 WEEK)), true, false) AS offShow
        FROM product p
            INNER JOIN product_attr pa
            ON p.Keycode = pa.Keycode WHERE p.Keycode = ?`;
    args = [productID];
    try {
        [results] = await ro_pool.query(sql, args);
        return results;
    } catch (error) {
        logger.info("debug_replenish_by_productId _mccReplenishment ERROR: ", {error});
        return;
    }
}

async function _wrhReplenishment(productID, locationID) {
    let sql, args, results;
    sql = `
        Select
            p.US_Overall_Test_Result_CONFIRMED, p.Keycode, p.Sell_Price_Usd, p.In_US_Range,
            iv.WarehouseID, IFNULL(iv.wrhTotalQty, 0) as wrhTotalQty,
            pb.notBlackListedLocation, pb.Keycode as blacklistKeycode,
            pa.DateOnShowPlanned, pa.DateOnShowActual, pa.DateOffShowActual, mdu.MDU,
            IF((p.Sell_Price_Usd is not null AND p.Sell_Price_Usd > 0), true, false) as sellPriceCheck,
            IF(pb.notBlackListedLocation = 0, true, false) as blackListCheck,
            IF((pa.DateOnShowPlanned IS NOT NULL OR pa.DateOnShowActual IS NOT NULL), true, false) as dateShowExistsCheck,
            IF((NOW() >= DATE_ADD(IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned), INTERVAL -10 DAY) ), true, false) as dateShowStartCheck,
            IF((pa.DateOffShowActual is null OR NOW() <= pa.DateOffShowActual), true, false) as dateOffShowCheck,
            IF(p.US_Overall_Test_Result_CONFIRMED in ('RELEASE','SELL THROUGH'), true, false) as complianceCheck,
            IF((wrhTotalQty is not null AND wrhTotalQty > 0), true, false) as warehouseQtyCheck,
            IF((mdu.MDU = 0), true, false) as mduCheck
        FROM product p
        LEFT JOIN (
            SELECT i.Keycode, SUM(i.wrhTotalQty) AS wrhTotalQty, i.WarehouseID
            FROM (
                SELECT b.Keycode, sum(b.Quantity) AS wrhTotalQty, LocationID AS WarehouseID
                FROM inventory_case ic
                INNER JOIN case_barcode b ON b.Barcode = ic.Barcode
                INNER JOIN container c ON ic.ContainerID = c.ID
                WHERE c.Type = 'RSV' AND ic.TaskID IS NULL
                AND c.LocationID IN (SELECT DCLocationID from location where ID = ?)
                GROUP BY Keycode
                UNION ALL
                SELECT i.Keycode, count(*) as wrhTotalQty, c.LocationID
                FROM inventory i
                INNER JOIN container c ON i.ContainerID = c.ID
                WHERE c.Type = 'RSV' and i.TaskID IS NULL
                AND c.LocationID IN (SELECT DCLocationID from location where ID = ?)
                GROUP BY Keycode
            ) as i GROUP BY Keycode
        ) AS iv ON iv.Keycode = p.Keycode
        LEFT JOIN product_attr pa ON pa.Keycode = p.Keycode
        LEFT JOIN product_mdu mdu ON mdu.LocationID = ? AND mdu.Keycode = p.Keycode
        LEFT JOIN (
            SELECT IFNULL(pb.Keycode, ? ) as Keycode , count(*) as notBlackListedLocation
            FROM location l
            INNER JOIN container c ON c.ID = l.ID AND c.Type = 'STR' AND l.isOpen is true
            LEFT JOIN product_blacklist pb ON pb.LocationID = l.ID AND pb.Keycode = ?
            WHERE pb.locationID is null
        ) AS pb ON pb.Keycode = p.Keycode
        WHERE p.Keycode = ?
        ;
        SELECT
            ro.ID, ro.Keycode, ro.SourceLocation, ro.TargetLocation, ro.Quantity as replenishOrderQuantity, ro.AWS, ro.MDU, ro.TargetInventory, ro.OrderType,
            ro.QuantityFilled, ro.SourceInventory, ro.DateCreated, ro.DateDue, ro.DateFulfilled,
            ci.wrhQuantity, t.ID as taskId, t.TaskGroupID, t.taskQuantity, t.DateCompleted as TaskDateCompleted, t.DateFulfilled as TaskDateFulfilled
        FROM
        (
            SELECT * FROM replenish_order
            WHERE Keycode = ? AND TargetLocation = ? AND OrderType = 'Auto' ORDER BY DateCreated DESC LIMIT 1
        ) AS ro
        LEFT JOIN (
            SELECT b.Keycode, sum(b.Quantity) AS wrhQuantity, LocationID
            FROM inventory_case ic
            INNER JOIN case_barcode b ON b.Barcode = ic.Barcode
            INNER JOIN container c ON ic.ContainerID = c.ID
            WHERE c.Type = 'RSV' AND ic.TaskID IS NULL
            GROUP BY Keycode
        ) AS ci ON ro.SourceLocation = ci.LocationID AND ro.Keycode = ci.Keycode
        LEFT JOIN (
            SELECT
                ro.Keycode, (t.Quantity * b.Quantity) as taskQuantity,
                t.ID , t.TaskGroupID, t.DateCompleted, t.DateFulfilled
            FROM (
                SELECT * FROM replenish_order
                WHERE Keycode = ? AND TargetLocation = ? AND OrderType = 'Auto' ORDER BY DateCreated DESC LIMIT 1
            ) AS ro
            INNER JOIN replenish_order ro2 ON ro2.ID = ro.ID
            INNER JOIN task t ON t.RowID = ro2.rowID
            INNER JOIN case_barcode b ON b.barcode = t.barcode AND b.Keycode = ro.Keycode
        ) AS t ON t.Keycode = ro.Keycode;`;

    args = [locationID, locationID, locationID, productID, productID, productID, productID, locationID, productID, locationID];

    try {
        [results] = await ro_pool.query(sql, args);
        return results;
    } catch (error) {
        logger.info("debug_replenish_by_productId _wrhReplenishment ERROR: ", {error});
        return;
    }

}

async function _strReplenishment(productID, locationID, locationInfo) {
    let { DaysOfCoverage, timezone, WarehouseID, isReplenishedByMDU } = locationInfo;
    let sql, args, results;
    sql = `
        Select
            p.US_Overall_Test_Result_CONFIRMED, p.Keycode, p.Sell_Price_Usd, p.In_US_Range,
            ? as WarehouseID, ? as SourceLocation,  IFNULL(iv.wrhTotalQty, 0) as wrhTotalQty,IFNULL(iv.whrSuspiciousQty, 0) as whrSuspiciousQty, iv.wrhInventoryLastUpdated,
            pb.Keycode as blacklistKeycode, pa.DateOnShowPlanned, pa.DateOnShowActual, pa.DateOffShowActual,
            IFNULL(TRUNCATE(aws.AWS, 2), 0) as AWS,
            aws.AWS / 7 AS AverageDailySales, ro.QuantityOrdered, IFNULL(cal.Factor, 1) as factor,
            calc_mdu(mdu.MDU, striv.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) as MDU,
            IFNULL(striv.strInventory, 0) AS strInventory,
            striv.strInventoryLastUpdated AS strInventoryLastUpdated,
            IF((p.Sell_Price_Usd is not null AND p.Sell_Price_Usd > 0), true, false) as sellPriceCheck,
            IF(pb.Keycode is not null, true, false) as blackListCheck,
            IF((pa.DateOnShowPlanned IS NOT NULL OR pa.DateOnShowActual IS NOT NULL), true, false) as dateShowExistsCheck,
            IF((NOW() >= IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned) ), true, false) as dateShowStartCheck,
            IF((pa.DateOffShowActual is null OR NOW() <= pa.DateOffShowActual), true, false) as dateOffShowCheck,
            IF(p.US_Overall_Test_Result_CONFIRMED in ('RELEASE','SELL THROUGH'), true, false) as complianceCheck,
            IF((wrhTotalQty is not null AND wrhTotalQty > 0), true, false) as warehouseQtyCheck,
            IF((mdu.MDU = 0), true, false) as mduCheck
        FROM product p
        LEFT JOIN (
            SELECT cp.ID as WarehouseID, i.Keycode, count(*) AS wrhTotalQty,SUM(CASE WHEN IsSuspicious=1 THEN 1 ELSE 0 END) As whrSuspiciousQty, MAX(i.DateUpdated) AS wrhInventoryLastUpdated
            FROM inventory i
            LEFT JOIN container c ON c.ID = i.ContainerID
            LEFT JOIN container cp ON cp.ID = c.LocationID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            WHERE cp.Type = 'WRH' AND ct.isBoH = 1 AND ct.BackfillEnabled = 1
            AND cp.ID = ?
            AND i.TaskID IS NULL
            GROUP BY cp.ID, i.Keycode
        ) AS iv ON iv.Keycode = p.Keycode
        LEFT JOIN product_blacklist pb ON p.Keycode = pb.Keycode and pb.locationID = ?
        LEFT JOIN product_attr pa on pa.Keycode = p.Keycode
        # TEMP CHANGE TO AVOID TABLE CHANGES
        LEFT JOIN fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code
        AND f.LocationID = 'Default'
        # AND f.LocationID = ?
        LEFT JOIN product_mdu mdu ON mdu.LocationID = ? AND mdu.Keycode = p.Keycode
        LEFT JOIN product_aws aws ON aws.LocationID = ? AND aws.Keycode = p.Keycode
        LEFT JOIN (
            SELECT
                i.Keycode,
                IFNULL(i.Qty, 0) AS strInventory,
                i.inventoryLastUpdated AS strInventoryLastUpdated,
                loc.StoreDefaultMDU
            FROM container c
            INNER JOIN location loc on loc.ID = c.ID
            LEFT JOIN (
                SELECT i.ContainerID, i.Keycode, count(*) AS Qty, MAX(i.DateUpdated) AS inventoryLastUpdated
                FROM inventory i
                LEFT JOIN container c ON c.ID = i.ContainerID
                WHERE c.Type = 'STR'
                GROUP BY Keycode, i.ContainerID
            ) AS i ON i.ContainerID = c.ID
            WHERE c.ID = ?
        ) as striv ON p.Keycode = striv.Keycode
        LEFT JOIN (
            SELECT SourceLocation, TargetLocation, Keycode, sum(Quantity) - SUM(IFNULL(QuantityFilled, 0)) as QuantityOrdered
            FROM replenish_order
            WHERE DateFulfilled is null
            GROUP BY SourceLocation, TargetLocation, Keycode
        ) AS ro ON ro.TargetLocation = ? AND ro.SourceLocation = ? AND ro.Keycode = p.Keycode
        LEFT JOIN replenish_factor_calendar cal ON cal.LocationID = ? AND cal.Date = DATE(CONVERT_TZ(NOW(), 'UTC', ? ))
        WHERE p.Keycode = ?
        ;
        SELECT ro.ID, ro.Keycode, ro.SourceLocation, ro.TargetLocation, ro.Quantity as replenishOrderQuantity, ro.AWS, ro.MDU, ro.TargetInventory, ro.OrderType,
            ro.QuantityFilled, ro.SourceInventory, ci.wrhQuantity, t.ID as taskId, t.TaskGroupID, t.quantity as taskQuantity, t.DateCompleted as TaskDateCompleted, t.DateFulfilled as TaskDateFulfilled,
            ro.DateCreated, ro.DateDue, ro.DateFulfilled
        FROM
        (
            SELECT * FROM replenish_order
            WHERE Keycode = ? AND TargetLocation = ? AND OrderType = 'Auto' ORDER BY DateCreated DESC LIMIT 1
        ) as ro
        LEFT JOIN (
            SELECT c.LocationID, i.Keycode, COUNT(*) AS wrhQuantity
            FROM inventory i
            LEFT JOIN container c ON c.ID = i.ContainerID
            LEFT JOIN container cp ON cp.ID = c.LocationID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            WHERE cp.Type = 'WRH' AND ct.isBoH = 1 AND ct.BackfillEnabled = 1
            AND i.TaskID IS NULL
            GROUP BY c.LocationID, i.Keycode
        ) AS ci ON ro.SourceLocation = ci.LocationID AND ro.Keycode = ci.Keycode
        LEFT JOIN task t ON t.RowID = ro.RowID
        ;
        SELECT Date, Quantity
        FROM sale_transaction
        WHERE Location = ? AND Keycode = ? AND  Date >= (NOW() - INTERVAL 7 DAY)
        Order By Date desc;`;

    args = [ WarehouseID, locationID, WarehouseID, locationID, locationID, locationID, locationID, locationID, WarehouseID, locationID, timezone, productID, productID, locationID, locationID, productID];

    try {
        [results] = await ro_pool.query(sql, args);
        let productInfo = results[0];

        for (let obj of productInfo ) {
            let replenishAmount; // count how much str can replenish
            let mdu = parseInt(obj["MDU"]) || 0;
            let averageDailySales = parseFloat(obj["AverageDailySales"]) || 0.01;
            let strInventory = parseInt(obj["strInventory"]) || 0;
            let strInventoryLastUpdated = obj["strInventoryLastUpdated"];
            let wrhInventoryLastUpdated = obj["wrhInventoryLastUpdated"];
            let factor = parseFloat(obj["factor"]) || 1;
            let daysOfCoverage = parseFloat(DaysOfCoverage) || 2;
            let wrhTotalQty = parseInt(obj["wrhTotalQty"]) || 0;
            let salesBasedReplenishment = 0;
            let QuantityOrdered = parseInt(obj["QuantityOrdered"]) || 0;

            // Multiply the replenishment amount with daysOfCoverage(get from location table) for this particular location
            replenishAmount = averageDailySales * daysOfCoverage;

            // Multiply the replenishment amount by any bonus factor that we might have for this particular Location
            replenishAmount = Math.ceil(replenishAmount * factor);
            salesBasedReplenishment = replenishAmount;
            // compare the calculated Replenish Amount with MDU and use greater value.
            if (mdu && mdu > replenishAmount) {
                replenishAmount = mdu;
            }
            // if store is getting replenish by MDU, than we only replenish based on MDU regardless
            if (isReplenishedByMDU) {
                replenishAmount = mdu;
            }

            let nextReplenishCheck = "none";
            let nextReplenishAmount = 0;

            // calculate how much store need by substracting current store inventory, to determine replenishment partial, full, or none
            if (strInventory < replenishAmount) {
                nextReplenishAmount = replenishAmount - QuantityOrdered - strInventory;
            }

            if (wrhTotalQty > 0 && nextReplenishAmount > 0) {
                nextReplenishCheck = wrhTotalQty >= nextReplenishAmount ? "full" : "partial";
                nextReplenishAmount = wrhTotalQty >= nextReplenishAmount ? nextReplenishAmount : wrhTotalQty;
            }
            if (wrhTotalQty === 0) { // If the wrh Qty is 0, there will be no next replenishment
                nextReplenishAmount = 0;
            }

            obj.replenishAmount = replenishAmount;  // Actual Replenishment amount decide which is greater AWS OR MDU
            obj.nextReplenishCheck = nextReplenishCheck;
            obj.nextReplenishAmount = nextReplenishAmount;
            obj.daysOfCoverage = daysOfCoverage;
            obj.salesBasedReplenishment = salesBasedReplenishment;
            obj.isReplenishedByMDU = isReplenishedByMDU ? "Yes" : "No";
            obj.replenFactor = factor;
            obj.QuantityOrdered = QuantityOrdered;
            obj.strInventoryLastUpdated = strInventoryLastUpdated;
            obj.wrhInventoryLastUpdated = wrhInventoryLastUpdated;

        }
        return results;
    } catch (error) {
        logger.info("debug_replenish_by_productId _strReplenishment ERROR: ", {error});
        return;
    }

}
