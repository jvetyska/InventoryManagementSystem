/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
const logger = require("../library/logger")("microwarehouse-api:mw_api_random_inventory_checks");

const moment = require("moment");
let logInformation = [];

function _groupByKey(array, key) {
    return array
        .reduce((hash, obj) => {
            if (obj[key] === undefined) return hash;
            return Object.assign(hash, { [obj[key]]:( hash[obj[key]] || [] ).concat(obj)});
        }, {});
}

function ShuffleArray(array) {
    let counter = array.length;
    let temp, index;

    while (counter > 0) {
        index = Math.floor(Math.random() * counter); // Pick a random index...
        temp = array[--counter]; // ...and swap the last element with it
        array[counter] = array[index];
        array[index] = temp;
    }

    return array;
}

// ReferenceID is an optional parameter
async function CreateTaskGroup(locationId, hoursToComplete, referenceID = null) {
    // Due date will be now (in UTC) plus hoursToComplete from inventory_count_schedule rounded up to the nearest whole hour
    let dateDue = moment().utc().add(hoursToComplete + 1, "hour").startOf("hour").format();

    let results;
    let sql = "INSERT INTO task_group (SourceLocation, TargetLocation, DateDue, Priority, Type, ReferenceID) VALUES ?";
    let args = [[[
        locationId, // SourceLocation
        locationId, // TargetLocation
        dateDue,    // DateDue
        "Standard", // Priority
        "Inventory", // Type
        referenceID // ReferenceID
    ]]];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        throw error;
    }

    return results["insertId"];
}

// ReferenceID is an optional parameter
async function CreateTasks(locationId, taskGroupId, tasks, referenceID = null) {
    if (!tasks.length) {
        return; // No tasks to create
    }

    /* Variable        | Obj prop    | Store            | Warehouse
     * ----------------+-------------+------------------+----------
     * TaskGroupID     | -           | taskGroupId      | taskGroupId
     * Keycode         | keycode     | keycode          | NULL
     * Quantity        | quantity    | Inventory count  | 0
     * SourceContainer | containerId | Retail Zone Name | Container ID
     * TargetContainer | -           | locationId       | locationId */
    let newCreatedTasks = 0;
    let sql = `
        INSERT INTO task
            (TaskGroupID, Keycode, Quantity, SourceContainer, TargetContainer, SecondarySort, Type, isRandom, ReferenceID)
        VALUES ?`;
    let taskArgs = [];

    for (let task of tasks) {
        let keycode = task["keycode"];
        let quantity = task["quantity"];
        let sourceContainer = task["containerId"];
        let secondarySort = task["secondarySort"];
        let isRandom = task["isRandom"];
        let targetContainer = locationId;

        taskArgs.push([
            taskGroupId,     // TaskGroupId
            keycode,         // Keycode
            quantity,        // Quantity
            sourceContainer, // SourceContainer
            targetContainer, // TargetContainer
            secondarySort,   // SecondarySort
            "Inventory",     // Type
            isRandom,         // isRandom
            referenceID
        ]);

        newCreatedTasks++;
    }

    // Only insert new tasks into the database if we actually have some queued up
    if (taskArgs.length) {
        try {
            await pool.query(sql, [taskArgs]);
        } catch (error) {
            throw error;
        }
    }

    logInformation.push({
        "locationId": locationId,
        "newCreated": newCreatedTasks
    });

    console.log(`${locationId} new created tasks: ${newCreatedTasks}`);
}

async function GetTasksForStore(sql, args, isRandom) {
    let tasks = [];
    let results;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        throw error;
    }

    for (let result of results) {
        let keycode       = result["Keycode"];
        let containerId   = result["ContainerID"];
        let quantity      = result["Quantity"];
        let secondarySort = result["SecondarySort"];
        let isFoH         = result["isFoH"];

        // If a product's Retail_Zone_Name doesn't exist (stored as ContainerID), set it to "Not Available"
        if (containerId == "" || containerId == "null" || containerId == null) {
            containerId = "Not Available";
        }

        tasks.push({
            "keycode": keycode,         // Keycode in the store that will be checked
            "containerId": containerId, // Name of the section in the store
            "quantity": quantity,       // How much inventory we suspect to appear at that location
            "secondarySort": secondarySort,
            "isFoH": isFoH,
            "isRandom": isRandom
        });
    }

    return tasks;
}

async function CreateSuspiciousTasksForItemsNotSoldRecently(locationId, keycodeCount) {
    /* For each store, find all items that are virtually in stock and meets these two checks:
     * 1. Was NOT updated in the last 30 days (check DateUpdated in the inventory table)
     * 2. Did NOT sell in the last 30 days */
    let args = [locationId, locationId, locationId];
    let sql = `
        SELECT
            a.Keycode,
            CONCAT(p.Retail_Zone_ID, pd.Name, p.Class_Name) AS ContainerID,
            a.Quantity
        FROM (
            # Get unique store/keycode inventory with the most recent time it was updated
            SELECT Store, Keycode, Quantity, LatestUpdate FROM (
                SELECT ContainerID AS Store, Keycode, COUNT(*) AS Quantity, MAX(DateUpdated) AS LatestUpdate
                FROM inventory i
                WHERE ContainerID = ?
                GROUP BY ContainerID, Keycode
                ORDER BY Store ASC
            ) AS i
            # Only select inventory that hasn't been updated in 30 days
            WHERE i.LatestUpdate < DATE_SUB(NOW(), INTERVAL 30 DAY)
        ) AS a
        LEFT JOIN (
            # Get unique store/keycode sales that have occurred in the last 30 days
            SELECT Location AS Store, Keycode
            FROM sale_transaction
            WHERE Location = ? AND Date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY Location, Keycode
            ORDER BY Location ASC
        ) AS b ON a.Store = b.Store AND a.Keycode = b.Keycode
        # Exclude B from A to get store/keycode inventory that are virtually available, but likely not physically available
        LEFT JOIN (
            # If a like task has been created within 7 days
            SELECT Keycode
            FROM task
            WHERE DateCreated >= (CURDATE() - INTERVAL 7 DAY)
            AND Type = 'Inventory'
            AND TargetContainer = ?
        ) AS t ON t.Keycode = a.Keycode
        INNER JOIN product p ON p.Keycode = a.Keycode
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        WHERE b.Store IS NULL AND b.Keycode IS NULL # Exclude B from A
        AND t.Keycode IS NULL
        GROUP BY a.Keycode
        ORDER BY RAND()
        LIMIT ${keycodeCount}`;

    try {
        return await GetTasksForStore(sql, args, 0);
    } catch (error) {
        throw error;
    }
}

async function CheckOutOfStockProductsInStore(locationId, keycodeCount) {
    /* Select up to 50 random products in the store that satisfy these conditions:
     * 1. In the last day for items that went OOS, get the earliest time they went OOS
     * 2. In the last day for all items, get the latest time there was a sale
     * 3. Inner join the above two results and see if there are sales for a product that happened after it went OOS */
    let args = [locationId, locationId, locationId];
    let sql  = `
        SELECT
            p.Keycode,
            CONCAT(p.Retail_Zone_ID, pd.Name, p.Class_Name) AS ContainerID,
            0 AS Quantity # The product was suspected to be out of stock, so this will be zero
        FROM (
            # In the last day for items that went OOS, get the earliest time they went OOS
            SELECT
                MIN(Date) AS Date,
                Keycode
            FROM sale_transaction
            WHERE
                Date > (CURDATE() - INTERVAL 2 DAY)
                AND Location = ?
                AND InventoryOOS = 1
            GROUP BY Keycode
        ) AS a
        INNER JOIN (
            # In the last day for all items, get the latest time there was a sale
            SELECT
                MAX(Date) AS Date,
                Keycode
            FROM sale_transaction
            WHERE
                Date > (CURDATE() - INTERVAL 2 DAY)
                AND Location = ?
            GROUP BY Keycode
        ) AS b ON b.Keycode = a.Keycode
        LEFT JOIN (
            # If a like task has been created within 7 days
            SELECT Keycode
            FROM task
            WHERE DateCreated >= (CURDATE() - INTERVAL 7 DAY)
            AND Type = 'Inventory'
            AND TargetContainer = ?
        ) AS t ON t.Keycode = a.Keycode
        INNER JOIN product p ON p.Keycode = a.Keycode
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        WHERE a.Date < b.Date AND t.Keycode IS NULL
        GROUP BY p.Keycode
        ORDER BY RAND()
        LIMIT ${keycodeCount}`;

    try {
        return await GetTasksForStore(sql, args, 0);
    } catch (error) {
        throw error;
    }
}

async function CreateRandomTasksForStore(locationId, keycodeCount) {
    // A very simple SQL query that gets up to {keycodeCount} random products in the store
    let args = [locationId, locationId];
    let sql = `
        SELECT
            i.Keycode,
            i.ContainerID,
            # Set NULLs to empty strings, because CONCAT returns NULL if any field contains NULL
            CONCAT (
                IFNULL(pc.Priority, ''),
                IFNULL(p.Retail_Zone_ID, ''),
                IFNULL(pd.Name, ''),
                IFNULL(p.Class_Name, '')
            ) AS SecondarySort,
            COUNT(*) AS Quantity
        FROM inventory i
        LEFT JOIN (
            # If a duplicate task was created within 7 days from now
            SELECT Keycode
            FROM task
            WHERE DateCompleted >= (CURDATE() - INTERVAL 7 DAY)
            AND Type = 'Inventory'
            AND TargetContainer = ?
        ) AS t ON t.Keycode = i.Keycode
        INNER JOIN product p ON p.Keycode = i.Keycode
        INNER JOIN product_code pc ON pc.ProductCode = p.Product_Status
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        WHERE i.ContainerID = ? AND t.Keycode IS NULL
        GROUP BY i.Keycode
        ORDER BY RAND()
        ${keycodeCount}`;

    try {
        return await GetTasksForStore(sql, args, 1);
    } catch (error) {
        throw error;
    }
}

async function CreateRandomTasksForWarehouse(locationId, distributionCenter, keycodeCount) {
    /* Get ${keycodeCount} random containers for this warehouse. If this warehouse is a distribution
     * center (it has an ID set for the column DCLocationID in the database), then the
     * random containers to get will have the type "RSV" for reserve containers. If the
     * warehouse is NOT a distribution center (NULL value for the column DCLocationID),
     * then the random containers to get will have the type "SHL" for shelves */
    let sql, args, results, table, codeType, containerType;
    let tasks = [];

    /* Distribution centers use reserve containers and "Barcode" while looking
     * in the table inventory_case, while regular warehouses use shelf containers
     * and "Keycode" while looking in the inventory table */
    if (distributionCenter) {
        table = "inventory_case";
        codeType = "Barcode";
        containerType = "RSV";
    } else {
        table = "inventory";
        codeType = "Keycode";
        containerType = "SHL";
    }

    args = [containerType, locationId, locationId];
    sql = `
        SELECT
            ContainerID,
            COUNT(*) AS UniqueBarcodes
        FROM (
            SELECT i.ContainerID, i.${codeType}
            FROM ${table} i
            INNER JOIN container c ON c.ID = i.ContainerID
            WHERE c.Type = ? AND c.LocationID = ?
            GROUP BY i.ContainerID, i.${codeType}
            ORDER BY i.ContainerID
        ) AS c
        LEFT JOIN (
            # If a like task has been created within 7 days
            SELECT SourceContainer
            FROM task
            WHERE DateCompleted >= (CURDATE() - INTERVAL 7 DAY)
            AND Type = 'Inventory'
            AND TargetContainer = ?
        ) AS t ON t.SourceContainer = c.ContainerID
        WHERE t.SourceContainer IS NULL
        GROUP BY ContainerID
        ORDER BY RAND()
        LIMIT ${keycodeCount}`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        return {"error": `Error in creating random inventory checks: ${error}`};
    }

    /* Get the approximate amount of total unique barcodes that we want to count. Once this value
     * is met or exceeded, the for loop below will break out, completing the task population */
    let maxUniqueBarcodes = settings.inventoryChecks.maxUniqueBarcodes;

    for (let container of results) {
        /* A container object will look like one of the two below objects:
         *
         * {ContainerID: "LYN1-74-01A01", UniqueBarcodes: 8}
         * {ContainerID: "LYN1-04-05F01", UniqueBarcodes: 3} */
        let containerId    = container["ContainerID"];
        let uniqueBarcodes = container["UniqueBarcodes"];

        tasks.push({
            "keycode": null,            // Keycode is only for store inventory checks
            "containerId": containerId, // ID of the container to check in the warehouse
            "quantity": 0,              // Warehouse inventory checks always have 0 for quantity
            "isRandom": 1
        });

        /* Reduce the maxUniqueBarcodes by how many unique barcodes were in this shelf
         * container and stop processing additional tasks if it drops to zero or below */
        maxUniqueBarcodes -= uniqueBarcodes;
        if (maxUniqueBarcodes <= 0) {
            break;
        }
    }

    return tasks;
}

async function CreateRandomTasksForFHBH(locationId, keycodeCount) {
    let args = [locationId, locationId];
    let sql = `
        SELECT * FROM (
            SELECT
                i.Keycode,
                i.ContainerID,
                # Container is either in FoH or BOH so if it is not FoH, it is BoH
                IF(c.Type IN('STR', 'MOD'), 1, 0) AS isFoH,
                COUNT(*) AS Quantity,
                loc.maxInventoryTaskUnits,
                # Set NULLs to empty strings, because CONCAT returns NULL if any field contains NULL
                CONCAT (
                    IFNULL(pc.Priority, ''),
                    IFNULL(pd.Name, ''),
                    ' ',
                    IFNULL(p.Class_Name, ''),
                    ' ',
                    IFNULL(p.Sub_Class_Name, '')
                ) AS SecondarySort
            FROM inventory i
            INNER JOIN container c ON i.ContainerID = c.ID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            INNER JOIN location loc ON c.LocationID = loc.ID
            INNER JOIN product p ON p.Keycode = i.Keycode
            INNER JOIN product_code pc ON pc.ProductCode = p.Product_Status
            INNER JOIN product_department pd ON p.DepartmentID = pd.ID
            LEFT JOIN (
                # If a duplicate task was completed within 7 days from now
                SELECT Keycode
                FROM task
                WHERE DateCompleted >= (NOW() - INTERVAL 7 DAY)
                AND Type = 'Inventory'
                AND TargetContainer = ?
            ) AS t ON t.Keycode = i.Keycode
            WHERE
                ct.BackfillEnabled = 1
                AND c.LocationID = ?
                AND t.Keycode IS NULL
            GROUP BY i.Keycode, i.ContainerID
            HAVING maxInventoryTaskUnits >= Quantity
            ORDER BY RAND()
            LIMIT ${keycodeCount}
        ) keycodes
        ORDER BY keycodes.SecondarySort`;

    try {
        return await GetTasksForStore(sql, args, 1);
    } catch (error) {
        throw error;
    }
}

async function CreateInventoryTasksForLocation(locationID, type, hasFHBH, distributionCenter, keycodeCount, hoursToComplete, maxInventoryTaskGroupSize) {
    if (hasFHBH) {
        let randomTasks = await CreateRandomTasksForFHBH(locationID, keycodeCount);



        let containerTasks = _groupByKey(randomTasks, "containerId");

        for (let group in containerTasks) {
            if (containerTasks[group].length) {
                for (let i = 0; i < containerTasks[group].length; i += maxInventoryTaskGroupSize) {
                    let taskGroupId = await CreateTaskGroup(locationID, hoursToComplete);

                    // There is a max inventory task batch size for FHBH inventory tasks so split tasks into groups
                    let tasks = containerTasks[group].slice(i, i + maxInventoryTaskGroupSize);
                    await CreateTasks(locationID, taskGroupId, tasks);
                }
            }
        }


    } else if (type == "WRH") {
        try {
            // Create random tasks
            // We are temporarily disabling random inventory checks for warehouses
            let taskGroupId = await CreateTaskGroup(locationID, hoursToComplete);
            let randomTasks = await CreateRandomTasksForWarehouse(locationID, distributionCenter, keycodeCount);
            await CreateTasks(locationID, taskGroupId, randomTasks);
        } catch (error) {
            logger.info("create_random_inventory_checks ERROR:", {error});
            throw error;
        }
    } else if (type == "STR") {
        try {
            // Define an array that will hold all suspicious tasks, in which a maxmimum of 50 suspicious tasks will be chosen if there are more than 50
            let suspiciousBucket = [];

            // Create one single task group that will hold all of the tasks that'll be generated for this store (random AND suspicious)
            let taskGroupId = await CreateTaskGroup(locationID, hoursToComplete);

            // Create random tasks
            // We are temporarily disabling random inventory checks for stores
            // let randomTasks = await CreateRandomTasksForStore(locationId, keycodeCount);

            // Get suspicious tasks; we might add additional suspicious checks later on in the future
            // We are temporarily disabling CreateSuspiciousTasksForItemsNotSoldRecently
            // suspiciousBucket = suspiciousBucket.concat(await CreateSuspiciousTasksForItemsNotSoldRecently(locationId, keycodeCount));
            suspiciousBucket = suspiciousBucket.concat(await CheckOutOfStockProductsInStore(locationID, keycodeCount));

            // If there are more than a total of MaximumSuspiciousTasks (currently 50) in our suspicious bucket,
            if (suspiciousBucket.length > keycodeCount) {
                suspiciousBucket = ShuffleArray(suspiciousBucket);
                suspiciousBucket.splice(keycodeCount, suspiciousBucket.length - keycodeCount);
            }

            // Combine all of the random and suspicious tasks into one single tasks object
            // let tasks = randomTasks.concat(suspiciousBucket);
            let tasks = suspiciousBucket; // Currently we are only generating tasks from CheckOutOfStockProductsInStore

            // De-dupe any tasks that exist by first sorting the array of objects by keycode, and then splicing dupes
            tasks = tasks.sort((a, b) => (a.keycode > b.keycode) ? 1 : ((b.keycode > a.keycode) ? -1 : 0));
            for (let i = 0; i < tasks.length - 1; i++) {
                if (tasks[i]["keycode"] == tasks[i+1]["keycode"]) {
                    tasks.splice(i, 1);
                }
            }

            await CreateTasks(locationID, taskGroupId, tasks);
        } catch (error) {
            logger.info("create_random_inventory_checks ERROR:", {error});
            throw error;
        }
    } else {
        throw new Error("ERROR: Store type is not valid");
    }
}

exports.create_random_inventory_checks = async function(req, res) {
    logger.info("Creating suspicious and random inventory checks");
    logInformation = []; // Reset logInformation

    let args, results, deleteResults;
    let sql = `
        SELECT
            loc.ID,
            loc.inventoryTaskGroupSize,
            sbs.KeycodeCount,
            sbs.HoursToComplete,
            HOUR(CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL sbs.Hour HOUR), loc.Timezone, 'UTC')) AS UtcHour,
            hasFHBH,
            c.Type,
            IF(c.Type = 'WRH' AND loc.DCLocationID IS NULL, 1, 0) AS isDC # location is a DC if it in a WRH and does not have a DCLocationID
        FROM location loc
        INNER JOIN inventory_count_schedule sbs ON sbs.LocationID = loc.ID
        INNER JOIN container c ON c.ID = loc.ID
        WHERE loc.IsOpen = 1 AND sbs.Hour != -1
        HAVING UtcHour = HOUR(NOW())`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        res.status(500).json({"error": "Server error while attempting to create Inventory Tasks"});
        return;
    }

    if (results.length === 0) {
        logger.info("There are no inventory checks to create");
        res.status(200).json({"data": "There are no inventory checks to create"});
        return;
    }

    let locations = results.map(l => l.ID);

    sql = `
        DELETE FROM task
        WHERE
            Type = 'Inventory' AND
            TargetContainer IN (?) AND
            DateCompleted IS NULL AND
            isRandom = 1`;

    args = [locations];

    try {
        [deleteResults] = await pool.query(sql, args);
        console.log(`Deleted ${deleteResults.affectedRows} old inventory tasks`);
    } catch (error) {
        logger.info("create_random_inventory_checks ERROR:", {error});
        res.status(500).json({"error": "Server error while attempting to create Inventory Tasks"});
        return;
    }


    for (let location of results) {
        let locationId = location["ID"];
        let type = location["Type"];
        let hasFHBH = location["hasFHBH"];
        let distributionCenter = location["isDC"];
        let keycodeCount = location["KeycodeCount"];
        let hoursToComplete = location["HoursToComplete"];
        let maxInventoryTaskGroupSize = location["inventoryTaskGroupSize"];

        try {
            await CreateInventoryTasksForLocation(locationId, type, hasFHBH, distributionCenter, keycodeCount, hoursToComplete, maxInventoryTaskGroupSize);
        } catch (error) {
            logger.info("create_random_inventory_checks ERROR:", {error});
            res.status(500).json({"error": "Server error while attempting to create Inventory Tasks"});
            return;
        }
    }

    logger.info("Completed creating suspicious and random inventory checks");
    res.status(200).json({"data": logInformation});
};

exports.create_random_inventory_checks_for_location = async function(req, res) {
    let locationID = req.body.LocationID;   // required

    if (!locationID) {
        res.status(400).json({"message": "locationID is required"});
        return;
    }

    console.log(`Creating suspicious and random inventory checks for location ${locationID}`);
    logInformation = []; // Reset logInformation

    let args, results, locationResults;
    let sql = `

        SELECT
            sbs.KeycodeCount,
            sbs.HoursToComplete,
            loc.hasFHBH,
            loc.inventoryTaskGroupSize,
            c.Type,
            IF(c.Type = 'WRH' AND loc.DCLocationID IS NULL, 1, 0) AS isDC # location is a DC if it in a WRH and does not have a DCLocationID
        FROM location loc
        INNER JOIN inventory_count_schedule sbs ON sbs.LocationID = loc.ID
        INNER JOIN container c ON c.ID = loc.ID
        WHERE loc.IsOpen = 1 AND loc.ID = ?
        ;
        DELETE FROM task
        WHERE
            Type = 'Inventory' AND
            TargetContainer = ? AND
            DateCompleted IS NULL AND
            isRandom = 1`;
    args = [locationID, locationID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("create_random_inventory_checks_for_location ERROR:", {error});
        res.status(500).json({"error": "Server error while attempting to create Inventory Tasks for location"});
        return;
    }

    locationResults = results[0];

    if (!locationResults.length) {
        res.status(404).json({"message": "locationID not found"});
        return;
    }

    locationResults = locationResults[0];

    let type =  locationResults.Type;
    let hasFHBH =  locationResults.hasFHBH;
    let distributionCenter =  locationResults.isDC;
    let keycodeCount = locationResults.KeycodeCount;
    let hoursToComplete = locationResults.HoursToComplete;
    let inventoryTaskGroupSize = locationResults.inventoryTaskGroupSize;

    try {
        await CreateInventoryTasksForLocation(locationID, type, hasFHBH, distributionCenter, keycodeCount, hoursToComplete, inventoryTaskGroupSize);
    } catch (error) {
        logger.info("create_random_inventory_checks_for_location ERROR:", {error});
        res.status(500).json({"error": "Server error while attempting to create Inventory Tasks for location"});
        return;
    }

    logger.info("Completed creating suspicious and random inventory checks for location");
    res.status(200).json({"data": logInformation});
};

exports.get_inventory_count_schedule = async function(req, res) {
    let locationID = req.query.LocationID || null;
    let hoursArray = [];
    let data = {};
    let sql, args, results, validation, hours, keycodeCount, hoursToComplete;

    if (locationID === null) {
        res.status(400).json({"message": "LocationID is required"});
        return;
    }

    args = [locationID, locationID];
    sql = `
        SELECT ID FROM container WHERE ID = ?
        ;
        SELECT * FROM inventory_count_schedule WHERE LocationID = ?`;

    try {
        [results] = await ro_pool.query(sql, args);
        validation = results[0];
        hours = results[1];
    } catch (error) {
        logger.error("get_inventory_count_schedule:", {error});
        res.status(500).json({"message": "Unable to get the inventoryCount schedule"});
        return;
    }

    if (validation.length === 0) {
        res.status(400).json({"message": "That location doesn't exist"});
        return;
    }

    keycodeCount = hours[0].KeycodeCount;
    hoursToComplete = hours[0].HoursToComplete;

    for (let row of hours) {
        hoursArray.push(row["Hour"]);
    }

    data.location = locationID;
    data.hours = hoursArray;
    data.keycodeCount = keycodeCount;
    data.hoursToComplete = hoursToComplete;

    res.status(200).json({"data": data});
};

exports.update_inventory_count_schedule = async function(req, res) {
    let locationID = req.body.LocationID || null;
    let keycodeCount = req.body.KeycodeCount || null;
    let hours = req.body.Hours || "";
    let hoursToComplete = req.body.HoursToComplete || null;
    let hoursArray = [];
    let sql, args, results, message, data;

    if (locationID === null || keycodeCount === null || hoursToComplete === null) {
        res.status(400).json({"message": "LocationID, KeycodeCount, and HoursToComplete are required"});
        return;
    }

    // If only one value is submitted, it's a string. Array is object
    if (hours && typeof hours === "string") {
        hoursArray = hours.split(",");
    } else {
        hoursArray = hours;
    }

    // Verify that the location exists
    sql = `SELECT ID FROM container WHERE ID = ?`;
    args = [locationID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_count_schedule:", {error});
        res.status(500).json({"message": "Unable to update the inventory count schedule"});
        return;
    }

    if (results.length === 0) {
        res.status(400).json({"message": "That location doesn't exist"});
        return;
    }

    sql = `DELETE FROM inventory_count_schedule WHERE LocationID = ?;`;
    args = [locationID];

    for (let hour of hoursArray) {
        sql += `INSERT INTO inventory_count_schedule (LocationID, Hour, KeycodeCount, HoursToComplete) VALUES (?);`;
        args.push([locationID, hour, keycodeCount, hoursToComplete]);
    }

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_inventory_count_schedule:", {error});
        res.status(500).json({"message": "Unable to update the inventory count schedule"});
        return;
    }

    if (hoursArray.length) {
        message = `Inventory Count Schedule updated for ${locationID}. Hours: ${hoursArray.join(", ")}`;
    } else {
        message = `Inventory Count Schedule removed for ${locationID}.`;
    }

    data = {
        "hours": hoursArray
    };

    res.json({"message": message, "data": data});
};

exports.create_backfill_random_inventory_checks = async function(req, res) {
    logInformation = []; // Reset logInformation
    let backfillScheduleID = req.body.storeBackfillScheduleID;   // required
    console.log(`Creating Inventory task logs for Backfill Schedule ID ${backfillScheduleID}`);
    let sql, args, results, randomTasks;

    // Step 1: Get Inventory task information from schedule and check if inventory checks are enabled
    sql = `
        SELECT keycodesToCheck, InventoryCheckType, hoursToComplete, sbs.LocationID, loc.maxInventoryTaskUnits
        FROM store_backfill_schedule sbs
        INNER JOIN location loc on loc.ID = sbs.LocationID
        WHERE sbs.ID = ?;`;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (err) {
        logger.info("create_backfill_random_inventory_checks ERROR:", {err});
        res.status(500).json({"error": "Server error while attempting to create Inventory Tasks for backfill"});
        return;
    }

    let numKeycodes = results[0].keycodesToCheck;
    let hoursToComplete = results[0].hoursToComplete;
    let inventoryCheckType = results[0].InventoryCheckType;
    let LocationID = results[0].LocationID;
    let maxInventoryTaskGroupSize = results[0].maxInventoryTaskUnits;

    if (!inventoryCheckType) {
        console.log(`Inventory Check not enabled for Backfill Schedule ${backfillScheduleID}`);
        res.status(200).json({"message": `Inventory Check not enabled for Backfill Schedule ${backfillScheduleID}`});
        return;
    }

    // Step 2: Delete old tasks
    // Also Update task groups to completed if they have no unfinished tasks
    sql = `
        DELETE t
        FROM task t
        INNER JOIN task_group tg ON t.TaskGroupID = tg.ID
        WHERE
            tg.ReferenceID = ? AND
            t.Type = 'Inventory' AND
            t.DateCompleted IS NULL AND
            t.isRandom = 1
        ;
        UPDATE task_group tg
        LEFT JOIN task t ON tg.ID = t.TaskGroupID AND t.DateCompleted IS NULL
        SET tg.DateCompleted = NOW()
        WHERE t.ID IS NULL AND tg.DateCompleted IS NULL`;

    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
        let qtyDeleted = results.affectedRows;
        console.log(`create_backfill_random_inventory_checks deleted ${qtyDeleted} old tasks for Backfill Schedule ${backfillScheduleID}`);
    } catch (err) {
        logger.info("create_backfill_random_inventory_checks ERROR:", {err});
        res.status(500).json({"error": "Server error while attempting to create Inventory Tasks for backfill"});
        return;
    }

    // Step 3: Get Random keycodes from database for assocaited containers
    sql= `
        SELECT * FROM (
            SELECT
                i.Keycode,
                i.ContainerID,
                # Container is either in FoH or BOH so if it is not FoH, it is BoH
                IF(c.Type IN('STR', 'MOD'), 1, 0) AS isFoH,
                COUNT(*) AS Quantity,
                # Set NULLs to empty strings, because CONCAT returns NULL if any field contains NULL
                CONCAT(
                    IFNULL(p.Business_Unit_RBU_Name, ''), ' ',
                    IFNULL(pa.Fixture_Code, ''), ' ',
                    IFNULL(pd.Name, ''), ' ', IFNULL(p.Class_Name, ''), ' ',
                    IFNULL(p.Style_ID, ''), ' ', IFNULL(p.Secondary_Colour, ''), ' ',
                    IFNULL(p.Keycode, '')
                ) AS SecondarySort
            FROM inventory i
            INNER JOIN (
                SELECT
                    c.ID as ContainerID, c.Type
                FROM (
                    # Get Containers from the boundaries
                    SELECT ibb.ContainerID
                    FROM inventory_take_schedule its
                    INNER JOIN inventory_bot ib ON its.InventoryBotID = ib.ID
                    INNER JOIN inventory_bot_boundary ibb ON ibb.LocationID = ib.LocationID AND ibb.Map = ib.DefaultMap
                    WHERE its.BackfillScheduleID = ?
                    AND its.Type = 'InventoryBot'
                    UNION
                    # Get Containers from the areas
                    SELECT IFNULL(iba.ContainerID, its.ContainerID) AS ContainerID
                    FROM inventory_take_schedule its
                    LEFT JOIN inventory_bot_area iba ON its.InventoryBotArea = iba.Area AND its.InventoryBotID = iba.InventoryBotID
                    WHERE its.BackfillScheduleID = ?
                ) containers
                INNER JOIN container c ON c.ID = containers.ContainerID
                INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
                WHERE IFNULL(ct.BackfillEnabled, 0) = 1
            ) as c on c.ContainerID = i.ContainerID
            INNER JOIN product p ON p.Keycode = i.Keycode
            INNER JOIN product_code pc ON pc.ProductCode = p.Product_Status
            INNER JOIN product_department pd ON p.DepartmentID = pd.ID
            INNER JOIN product_attr pa ON pa.Keycode = p.Keycode
            GROUP BY i.Keycode, i.ContainerID
            ORDER BY RAND()
            LIMIT ?
        ) keycodes
        ORDER BY keycodes.SecondarySort;`;

    args = [backfillScheduleID, backfillScheduleID, numKeycodes];



    try {
        randomTasks = await GetTasksForStore(sql, args, 1);
    } catch (error) {
        throw error;
    }

    let containerTasks = _groupByKey(randomTasks, "containerId");

    for (let group in containerTasks) {
        if (containerTasks[group].length) {
            for (let i = 0; i < containerTasks[group].length; i += maxInventoryTaskGroupSize) {
                let taskGroupId = await CreateTaskGroup(LocationID, hoursToComplete);

                // There is a max inventory task batch size for FHBH inventory tasks so split tasks into groups
                let tasks = containerTasks[group].slice(i, i + maxInventoryTaskGroupSize);
                await CreateTasks(LocationID, taskGroupId, tasks);
            }
        }
    }

    res.status(200).json({"data": logInformation});
};
