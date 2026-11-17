const logger = require("/opt/nodejs/logger.js")('kmart-external:system-inventory-checks');
const db = require("/opt/nodejs/wmsDB.js");
const moment = require("moment-timezone");
const { axios, https } = require("/opt/nodejs/xray.js");
const defaultSettings = require("./defaultSettings");
const getConfig = require("/opt/nodejs/config.js");
const { sortTaskData, SortEnum } = require("/opt/nodejs/sortUtil.js");
let pool, slackURL, config;
let settings;

const BackfillTaskDeleteInterval = 12;

async function _GetAnkoInventory (backfillScheduleID) {
    logger.startTrace('_GetAnkoInventory');
    let sql, args, results;
    let keycodeDictionary = {};

    sql = `
        SELECT
            DISTINCT sis.Keycode
        FROM store_inventory_snapshot sis
        WHERE sis.BackfillScheduleID = ? AND sis.DateCreated > NOW() - INTERVAL ${BackfillTaskDeleteInterval} HOUR`;
    args = [backfillScheduleID, backfillScheduleID, backfillScheduleID];

    try {
        logger.trace('_GetAnkoInventory:pool.query');
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_GetAnkoInventory:pool.query');
        throw new Error(` Error Occured while getting Inventory data from Anko DB`);
    }

    if (!results.length) {
        logger.error('No Inventory Data available from ANKO DB', '_GetAnkoInventory:pool.query');
        throw new Error("No Inventory Data available from ANKO DB");
    }

    for (let result of results) {
        let keycode = result["Keycode"];

        // Creating a dictioary for easy lookup, value isn't used
        keycodeDictionary[keycode] = true;
    }
    logger.endTrace('_GetAnkoInventory');
    return keycodeDictionary;
}

async function _GetLocationDetails (backfillScheduleID) {
    logger.startTrace('_GetLocationDetails');
    let sql, args, results;

    sql = `
        SELECT
            sbs.LocationID,
            loc.Timezone,
            sbs.keycodesToCheck,
            sbs.hoursToComplete,
            loc.maxInventoryTaskUnits,
            GROUP_CONCAT(ld.DepartmentID) as kmartDepartmentIDs
        FROM store_backfill_schedule sbs
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        INNER JOIN location_department ld ON loc.ID = ld.LocationID
        WHERE
            sbs.ID = ?
            AND sbs.InventoryCheckType = 'system'`;
    args = [backfillScheduleID];

    try {
        logger.trace('_GetLocationDetails:pool.query');
        [results] = await pool.query(sql, args);
        results = results[0];
    } catch (error) {
        logger.error(error, '_GetLocationDetails:pool.query');
        throw new Error(`Error Occured while getting Inventory data from Anko DB`);
    }

    if (!results.LocationID) {
        const error = `Location Data not available for Backfill Schedule ${backfillScheduleID}`;
        logger.error(error, '_GetLocationDetails:pool.query');
        throw new Error(error);
    }
    logger.endTrace('_GetLocationDetails');
    return results;
}

async function _GetKmartInventory (locationID, timezone, departments) {
    logger.startTrace('_GetKmartInventory');
    const kmartSOHURL = config.KmartSOHAPIURL;
    // kmart has STR_ID = 1001 OR 1154, so get the Store code from locationID
    const locationCode = locationID.slice(0, locationID.indexOf("-"));
    const departmentIDList = departments.split(",");
    let keycodeDictionary = {};
    let results;

    // Kmart's SSL Cert isn't accepted without this
    const agent = new https.Agent({
        rejectUnauthorized: false
    });

    // First get SOH and Manifest dates with the SOH by Department API
    for (let departmentID of departmentIDList) {
        const options = {
            "httpsAgent": agent,
            "params": {
                "storeID": locationCode,
                "department": departmentID
            }
        };

        try {
            logger.trace('_GetKmartInventory:SOH');
            results = await axios.get(kmartSOHURL, options);
            results = results.data.SOH;
        } catch (error) {
            logger.error('failed to call the kmart SOH by Department API', '_GetKmartInventory:SOH');
            throw error;
        }

        for (let data of results) {
            let lastReceiptDate = data.LastReceiptDate || null;

            // lastReceipDate may be empty string
            if (lastReceiptDate) {
                // The date format from Kmart is "Feb 26 2021  2:51PM" which isn't standard so have to tell moment how to parse it
                lastReceiptDate = moment(lastReceiptDate, "MMM DD YYYY  h:mma").tz(timezone).format();
            }

            keycodeDictionary[data.Keycode] = {
                Quantity: data.StockOnHand,
                LastReceiptDate: lastReceiptDate
            };
        }
    }

    /* Sample object that will be returned:
     *   kmartKeycodeDictionary: {
     *     '5621682': {
     *       Quantity: 1503,
     *       LastReceiptDate: ""
     *     },
     *     '6225544': {
     *       Quantity: 152,
     *       LastReceiptDate, ""
     *     }
     *   }
     */
    logger.endTrace('_GetKmartInventory');
    return keycodeDictionary;
}

async function _InsertKmartInventorySnapshot (locationID, kmartKeycodeDictionary, backfillScheduleID) {
    logger.startTrace('_InsertKmartInventorySnapshot');
    let sql, args;
    const ScheduleType = "ScheduleEnd";
    let insertArgs = [];

    for (let keycode in kmartKeycodeDictionary) {
        let kmartQuantity = kmartKeycodeDictionary[keycode].Quantity;
        let dateManifest = kmartKeycodeDictionary[keycode].LastReceiptDate || null;

        insertArgs.push([locationID, keycode, kmartQuantity, dateManifest, backfillScheduleID, ScheduleType]);
    }

    sql = `
        # To keep this table lean and quick, delete any old snapshots for this backfill schedule
        DELETE FROM kmart_inventory_snapshot WHERE BackfillScheduleID = ? AND SnapshotType = '${ScheduleType}'
        ;
        INSERT INTO kmart_inventory_snapshot (LocationID, Keycode, Quantity, DateKmartManifest, BackfillScheduleID, SnapshotType) VALUES ?;`;
    args = [backfillScheduleID, insertArgs];

    try {
        logger.trace('_InsertKmartInventorySnapshot:pool.query');
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_InsertKmartInventorySnapshot:pool.query');
        throw new Error(`Unable to insert Kmart inventory snapshot data into ANKO DB`);
    }
    logger.endTrace('_InsertKmartInventorySnapshot');
}

async function _InsertKmartOnlyKeycodes (ankoKeycodeDictionary, kmartKeycodeDictionary, backfillScheduleID, locationID) {
    logger.startTrace('_InsertKmartOnlyKeycodes');
    let sql, args, results;
    let insertSnapshotArgs = [];
    let kmartKeycodeList = Object.keys(kmartKeycodeDictionary);

    // find out what are the keycode only exits in kmart.
    let onlyInKmart = kmartKeycodeList.filter((keycode) => !Object.prototype.hasOwnProperty.call(ankoKeycodeDictionary, keycode));

    const snapshotDate = moment().utc().format();

    // Only run INSERT into store_inventory_snapshot if we have Keycodes only in Kmart IPS, otherwise only run UPDATEs
    if (!onlyInKmart.length) {
        logger.info('EXIT', '_InsertKmartOnlyKeycodes:onlyInKmart');
        return;
    }

    // Need to filter any keycodes with Department/Class filtering
    sql = `
        SELECT p.Keycode
        FROM product p
        LEFT JOIN location_department ld ON ld.DepartmentID = p.DepartmentID AND ld.ClassName = p.Class_Name AND ld.LocationID = ?
        LEFT JOIN location_department ld2 ON ld2.DepartmentID = p.DepartmentID AND ld2.ClassName IS NULL AND ld2.LocationID = ?
        WHERE
            p.Keycode IN (?)
            AND (ld.LocationID IS NOT NULL OR ld2.LocationID IS NOT NULL)
            AND IFNULL(p.Blacklisted, FALSE) IS FALSE
            AND IFNULL(p.isRecall, FALSE) IS FALSE`;
    args = [locationID, locationID, onlyInKmart];

    try {
        logger.trace('_InsertKmartOnlyKeycodes:pool.query:filterKeycodes');
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_InsertKmartOnlyKeycodes:pool.query:filterKeycodes');
        throw new Error(`Unable to insert Kmart only inventory rows into store_inventory_snapshot`);
    }

    const keycodeList = results.map(row => row.Keycode);

    for (let keycode of keycodeList) {
        let ankoKeycodeMapping = ankoKeycodeDictionary[keycode];

        // If we are missing the ANKO Keycode mapping, that means the Keycode is only in Kmart IPS DB and not in RFID inventory
        // So we need to insert the Keycdoe into store_inventory_snapshot since it wouldn't have inserted based on RFID inventory
        if (!ankoKeycodeMapping) {
            insertSnapshotArgs.push([locationID, locationID, backfillScheduleID, keycode, 0, snapshotDate, 0]);
        }
    }

    // Only run INSERT into store_inventory_snapshot if we have Keycodes only in Kmart IPS, otherwise only run UPDATEs
    if (!insertSnapshotArgs.length) {
        logger.info('EXIT', '_InsertKmartOnlyKeycodes:insertSnapshotArgs');
        return;
    }

    sql = `INSERT INTO store_inventory_snapshot (LocationID, ContainerID, BackfillScheduleID, Keycode, Quantity, DateSnapshot, IsOverThreshold) VALUES ?;`;
    args = [insertSnapshotArgs];

    try {
        logger.trace('_InsertKmartOnlyKeycodes:pool.query:store_inventory_snapshot');
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_InsertKmartOnlyKeycodes:pool.query:store_inventory_snapshot');
        throw new Error(`Unable to insert Kmart only inventory rows into store_inventory_snapshot`);
    }
    logger.endTrace('_InsertKmartOnlyKeycodes');
}

async function _UpdateStoreInventorySnapshot (backfillScheduleID) {
    logger.startTrace('_UpdateStoreInventorySnapshot');
    let sql, args;

    // Need to update existing store_inventory_snapshot rows with Kmart Inventory Data
    // Get the data from kmart snapshot at start of schedule and end
    sql = `
        UPDATE store_inventory_snapshot sis
        INNER JOIN location loc ON sis.LocationID = loc.ID
        INNER JOIN kmart_inventory_snapshot kisScheduleStart ON
            sis.BackfillScheduleID = kisScheduleStart.BackfillScheduleID AND
            sis.Keycode = kisScheduleStart.Keycode AND
            kisScheduleStart.SnapshotType = 'ScheduleStart'
        INNER JOIN kmart_inventory_snapshot kisScheduleEnd ON
            sis.BackfillScheduleID = kisScheduleEnd.BackfillScheduleID AND
            sis.Keycode = kisScheduleEnd.Keycode AND
            kisScheduleEnd.SnapshotType = 'ScheduleEnd'
        SET
            sis.QuantityExternalStart = kisScheduleStart.Quantity,
            sis.QuantityExternalEnd = kisScheduleEnd.Quantity,
            sis.DateExternalStart = kisScheduleStart.DateCreated,
            sis.DateExternalEnd = kisScheduleEnd.DateCreated,
            # sis has a recent manifest if the manifest date is within the last day
            sis.HasRecentManifest = IF(CONVERT_TZ(NOW(), 'UTC', loc.Timezone) - INTERVAL 1 DAY < kisScheduleEnd.DateKmartManifest, 1, 0)
        WHERE
            sis.DateCompleted IS NULL
            AND sis.DateCreated > NOW() - INTERVAL ${BackfillTaskDeleteInterval} HOUR
            AND sis.BackfillScheduleID = ?;`;
    args = [backfillScheduleID];

    try {
        logger.trace('_UpdateStoreInventorySnapshot:pool.query');
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_UpdateStoreInventorySnapshot:pool.query');
        throw new Error(`Unable to generate inventory shapshot for BackFillScheduleID: ${backfillScheduleID}`);
    }
    logger.endTrace('_UpdateStoreInventorySnapshot');
}

async function _getDataForInventoryTasks (backfillScheduleID) {
    logger.startTrace('_getDataForInventoryTasks');
    let sql, args, results;
    let inventoryDataObject = {};

    sql = `
        SELECT
            sis.Keycode,
            sis.ContainerID,
            IFNULL(sis.Quantity, 0) AS Quantity,
            IFNULL(sis.QuantityExternalStart, 0) AS QuantityExternalStart,
            IFNULL(sis.QuantityExternalEnd, 0) AS QuantityExternalEnd,
            sis.HasRecentManifest,
            # Container is either in FoH or BOH so if it is not FoH, it is BoH
            IF(ct.isFOH, 1, 0) AS isFoH,
            IF(ct.BackfillEnabled, 1, 0) AS isBackfillEnabled,
            c.LocationID,
            CONCAT(
				IFNULL(p.Business_Unit_RBU_Name, ''), ' ',
                IFNULL(pa.Fixture_Code, ''), ' ',
                IFNULL(pd.Name, ''), ' ',
                IFNULL(p.Class_Name, ''), ' ',
                IFNULL(p.Style_ID, ''), ' ',
                IFNULL(p.Secondary_Colour, ''), ' ',
                IFNULL(p.Keycode, '')
			) AS SecondarySort,
            p.Cost_Price_Aus
        FROM store_inventory_snapshot sis
        INNER JOIN container c ON sis.ContainerID = c.ID
        INNER JOIN container_type ct ON c.Type = ct.ID AND c.SubType <=> ct.SubType
        INNER JOIN product p ON p.Keycode = sis.Keycode
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        INNER JOIN product_attr pa ON pa.Keycode = p.Keycode
        WHERE
            sis.BackfillScheduleID = ?
            AND sis.DateCreated > NOW() - INTERVAL ${BackfillTaskDeleteInterval} HOUR
            AND sis.DateCompleted IS NULL`;
    args = [backfillScheduleID];

    try {
        logger.trace('_getDataForInventoryTasks:pool.query');
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_getInventoryTaskData:pool.query');
        throw error;
    }

    for (let result of results) {
        let keycode = result["Keycode"];
        let containerID = result["ContainerID"];
        let rfidQuantity = result["Quantity"];

        if (!inventoryDataObject[keycode]) {
            inventoryDataObject[keycode] = {
                "Keycode": keycode,
                "QuantityExternalStart": result["QuantityExternalStart"],
                "QuantityExternalEnd": result["QuantityExternalEnd"],
                "HasRecentManifest": result["HasRecentManifest"],
                "isBackfillEnabled": result["isBackfillEnabled"],
                "LocationID": result["LocationID"],
                "SecondarySort": result["SecondarySort"],
                "Cost": result["Cost_Price_Aus"],
                // Initialize result for inventory by container
                "TotalRFIDQuantity": 0,
                "InventoryDetails": []
            };
        }

        // Set isBackfillEnabled to false if any containers with this keycode are not backfill enabled
        if (inventoryDataObject[keycode]["isBackfillEnabled"] && !result["isBackfillEnabled"]) {
            inventoryDataObject[keycode]["isBackfillEnabled"] = result["isBackfillEnabled"];
        }

        inventoryDataObject[keycode].TotalRFIDQuantity += rfidQuantity;
        inventoryDataObject[keycode].InventoryDetails.push({
            "ContainerID": containerID,
            "RFIDQuantity": rfidQuantity,
            "isFoH": result["isFoH"]
        });
    }
    logger.endTrace('_getDataForInventoryTasks');
    return inventoryDataObject;
}

async function _generateInventoryTask(inventoryData, locationDetails, backfillScheduleID, sortBy) {
    logger.startTrace('_generateInventoryTask');
    let sql, args, results;

    let taskGenerationData = [];
    let isOverThresholdKeycodes = [];

    const { keycodesToCheck, maxInventoryTaskUnits, hoursToComplete, LocationID} = locationDetails;

    for (let keycode of Object.keys(inventoryData)) {
        const row = inventoryData[keycode];

        const rfidQty = row["TotalRFIDQuantity"];
        const kmartQtyStart = row["QuantityExternalStart"];
        const kmartQtyEnd = row["QuantityExternalEnd"];
        const deltaQty = Math.abs(rfidQty - kmartQtyEnd);

        const secondarySort = row["SecondarySort"];
        const hasRecentManifest = row["HasRecentManifest"];
        const isBackfillEnabled = row["isBackfillEnabled"];

        const cost = row["Cost"];
        const ankoCost = rfidQty * cost;
        const kmartCost = kmartQtyEnd * cost;
        const deltaCost = Math.abs(ankoCost - kmartCost);

        let aboveTheThreshold = false;

        let rfidLessThanSystemDeltaQty1 = settings.inventoryChecks.rfidLessThanSystemDeltaQty1;
        let rfidLessThanSystemKmartOrRfidQty1 = settings.inventoryChecks.rfidLessThanSystemKmartOrRfidQty1;
        let rfidLessThanSystemDeltaQty2 = settings.inventoryChecks.rfidLessThanSystemDeltaQty2;
        let rfidLessThanSystemKmartOrRfidQty2 = settings.inventoryChecks.rfidLessThanSystemKmartOrRfidQty2;
        let rfidLessThanSystemPrice = settings.inventoryChecks.rfidLessThanSystemPrice;
        let rfidGreaterThanSystemDeltaQty1 = settings.inventoryChecks.rfidGreaterThanSystemDeltaQty1;
        let rfidGreaterThanSystemKmartOrRfidQty1 = settings.inventoryChecks.rfidGreaterThanSystemKmartOrRfidQty1;
        let rfidGreaterThanSystemPrice = settings.inventoryChecks.rfidGreaterThanSystemPrice;

        if (rfidQty < kmartQtyEnd) {
            if ( ( deltaQty > rfidLessThanSystemDeltaQty1  && (rfidQty < rfidLessThanSystemKmartOrRfidQty1 || kmartQtyEnd < rfidLessThanSystemKmartOrRfidQty1) )
                || ( deltaQty > rfidLessThanSystemDeltaQty2 && (rfidQty > rfidLessThanSystemKmartOrRfidQty2 || kmartQtyEnd > rfidLessThanSystemKmartOrRfidQty2) )
                || (deltaCost > rfidLessThanSystemPrice) ) {
                aboveTheThreshold = true;
            }
        } else if (rfidQty > kmartQtyEnd) {
            if ( (deltaQty > rfidGreaterThanSystemDeltaQty1  && (rfidQty > rfidGreaterThanSystemKmartOrRfidQty1 || kmartQtyEnd > rfidGreaterThanSystemKmartOrRfidQty1) )
                || (deltaCost > rfidGreaterThanSystemPrice) ) {
                aboveTheThreshold = true;
            }
        }


        if (aboveTheThreshold) {
            isOverThresholdKeycodes.push(keycode);

            // If this keycode has a recent manifest date, we will update IsOverThreshold but do not create inventory tasks
            if (hasRecentManifest) {
                continue;
            }

            // If RFID found inventory for this keycode, we will create tasks for each Container it was found in
            if (rfidQty > 0) {
                // If this keycode has inventory in a non backfill enabled container, skip the keycode
                if (!isBackfillEnabled) {
                    continue;
                }

                for (let containerInventory of row["InventoryDetails"]) {
                    taskGenerationData.push({
                        Keycode: parseInt(keycode),
                        ContainerID: containerInventory["ContainerID"],
                        isFoH: containerInventory["isFoH"],
                        LocationID: LocationID,
                        Quantity: containerInventory["RFIDQuantity"],
                        TotalRFIDQuantity: rfidQty,
                        DeltaQuantity: deltaQty,
                        SecondarySort: secondarySort
                    });
                }
            } else {
                taskGenerationData.push({
                    Keycode: parseInt(keycode),
                    ContainerID: LocationID,
                    isFoH: 1,
                    LocationID: LocationID,
                    Quantity: 0,
                    TotalRFIDQuantity: 0,
                    DeltaQuantity: deltaQty,
                    SecondarySort: secondarySort
                });
            }
        }
    }

    if (isOverThresholdKeycodes.length) {
        logger.debug(`_generateInventoryTask:isOverThresholdKeycodes`);
        sql = `
            UPDATE store_inventory_snapshot
                SET IsOverThreshold = 1
            WHERE
                BackfillScheduleID = ?
                AND Keycode IN ?
                AND DateCompleted IS NULL
                AND DateCreated > NOW() - INTERVAL ${BackfillTaskDeleteInterval} HOUR;
        `;
        args = [backfillScheduleID, [isOverThresholdKeycodes]];

        try {
            logger.trace('_generateInventoryTask:isOverThresholdKeycodes:pool.query');
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error('Update IsOverThreshold Flag', '_generateInventoryTask:isOverThresholdKeycodes:pool.query', error);
            throw new Error(`Unable to generate task`);
        }

        logger.info(`Updates ${results.affectedRows} with IsOverThreshold value = 1`, '_generateInventoryTask:isOverThresholdKeycodes');
    }

    // sorts keycodes for task generation from lowest RFID to highest RFID count
    taskGenerationData = sortTaskData(taskGenerationData, sortBy);

    // get the unique keycode = keycodesToCheck to create task
    let getKeycodesToCheckTaskData = [];
    let count = 0;
    let previousKeycode;
    for (let row of taskGenerationData) {
        if (row.Keycode !== previousKeycode) {
            previousKeycode = row.Keycode;

            count++;
            if (count > keycodesToCheck) {
                break;
            }
        }

        getKeycodesToCheckTaskData.push(row);
    }


    function groupByKey(array, key) {
        return array
            .reduce((hash, obj) => {
                if(obj[key] === undefined) return hash;
                return Object.assign(hash, { [obj[key]]:( hash[obj[key]] || [] ).concat(obj)})
            }, {})
    }

    let containerTasks = groupByKey(getKeycodesToCheckTaskData, 'ContainerID');

    let taskGroupIDs = [];

    for (let group in containerTasks) {
        if (containerTasks[group].length) {
            for (let i = 0; i < containerTasks[group].length; i += maxInventoryTaskUnits) {
                logger.trace('_generateInventoryTask:CreateTaskGroup');
                let taskGroupId = await CreateTaskGroup(LocationID, hoursToComplete, backfillScheduleID);
                taskGroupIDs.push(taskGroupId);
                // There is a max inventory task batch size for FHBH inventory tasks so split tasks into groups
                let tasks = containerTasks[group].slice(i, i + maxInventoryTaskUnits);
                logger.trace('_generateInventoryTask:CreateTasks');
                await CreateTasks(LocationID, taskGroupId, tasks, backfillScheduleID);
            }
        }
    }

    // update the taskID column in store_inventory_sanpshot table
    if (taskGroupIDs.length) {
        logger.trace('_generateInventoryTask:taskGroupIDs');
        sql = `
            UPDATE store_inventory_snapshot sis
            INNER JOIN (
                SELECT t.Keycode, t.ID, t.SourceContainer, tg.SourceLocation
                FROM task t
                INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
                WHERE tg.ID IN ?
                AND t.ReferenceID = ?
                AND t.Type = 'Inventory'
            ) ta ON ta.Keycode = sis.keycode AND ta.SourceContainer = sis.ContainerID AND sis.LocationID = ta.SourceLocation
            SET sis.TaskID = ta.ID
            WHERE
                sis.BackfillScheduleID = ?
                AND sis.DateCompleted IS NULL;
        `;
        args = [[taskGroupIDs], backfillScheduleID, backfillScheduleID];

        try {
            logger.trace('_generateInventoryTask:taskGroupIDs:pool.query');
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error(error, '_generateInventoryTask:taskGroupIDs:pool.query');
            throw new Error(`Unable to generate task`);
        }
    }
    logger.endTrace('_generateInventoryTask');
}

async function CreateTaskGroup (locationId, hoursToComplete, referenceID) {
    logger.startTrace('CreateTaskGroup');
    // Due date will be now (in UTC) plus hoursToComplete from store_backfill_schedule rounded up to the nearest whole hour
    let dateDue = moment().utc().add(hoursToComplete + 1, "hour").startOf("hour").format();
    let results;
    let sql = "INSERT INTO task_group (SourceLocation, TargetLocation, DateDue, Priority, Type, ReferenceID) VALUES ?";
    let args = [[[
        locationId, // SourceLocation
        locationId, // TargetLocation
        dateDue,    // DateDue
        "Fasttrack", // Priority
        "Inventory", // Type
        referenceID // backfill schedule ID
    ]]];

    try {
        logger.trace('CreateTaskGroup:pool.query');
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'CreateTaskGroup:pool.query');
        throw new Error(`Unable to generate task group for location : ${locationId} for BackFillScheduleID: ${referenceID}`);
    }
    logger.endTrace('CreateTaskGroup');
    return results["insertId"];
}

async function CreateTasks (locationId, taskGroupId, tasks, referenceID) {
    logger.startTrace('CreateTasks');
    if (!tasks.length) {
        return; // No tasks to create
    }

    let newCreatedTasks = 0;
    let sql = "INSERT INTO task (TaskGroupID, Keycode, Quantity, SourceContainer, TargetContainer, SecondarySort, Type, isRandom, ReferenceID) VALUES ?";
    let taskArgs = [];

    for (let task of tasks) {
        let keycode = task["Keycode"];
        let quantity = task["Quantity"];
        let sourceContainer = task["ContainerID"];
        let secondarySort = task["SecondarySort"];
        let isRandom = 0;
        let targetContainer = locationId;

        taskArgs.push([
            taskGroupId,     // TaskGroupId
            keycode,         // Keycode
            quantity,        // Quantity
            sourceContainer, // SourceContainer
            targetContainer, // TargetContainer
            secondarySort,   // SecondarySort
            "Inventory",     // Type
            isRandom,        // isRandom
            referenceID // BackfillScheduleID
        ]);

        newCreatedTasks++;
    }

    if (taskArgs.length) {
        try {
            logger.trace('CreateTasks:pool.query');
            await pool.query(sql, [taskArgs]);
        } catch (error) {
            logger.error(error, 'CreateTasks:pool.query');
            throw new Error(`Unable to generate task for location: ${locationId} for BackFillScheduleID: ${referenceID}`);
        }
    }
    logger.info(`${locationId} new created tasks: ${newCreatedTasks} on ${moment().utc().format()}`, 'CreateTasks');
    logger.endTrace('CreateTasks');
}

function isBetween(numToCheck, numOne, numTwo) {
    const min = Math.min(numOne, numTwo);
    const max = Math.max(numOne, numTwo);

    return numToCheck >= min && numToCheck <= max;
}

async function getSettings () {
    logger.startTrace('getSettings');
    let sql, results;

    sql = "SELECT * FROM system_settings";

    try {
        logger.trace('getSettings:pool.query');
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error(error, 'getSettings:pool.query');
        throw error;
    }

    // Default Settings is retrived from the config file
    let updatedSettings = defaultSettings;
    for (let result of results) {
        if (updatedSettings[result.Category]) {
            if (updatedSettings[result.Category][result.Property]) {
                switch (result.Type) {
                case "Boolean":
                    if (result.Value === "true") {
                        updatedSettings[result.Category][result.Property] = true;
                    } else {
                        updatedSettings[result.Category][result.Property] = false;
                    }
                    break;
                case "Hours":
                case "Minutes":
                case "Days":
                case "Number":
                    updatedSettings[result.Category][result.Property] = +result.Value;
                    break;
                case "Text":
                    updatedSettings[result.Category][result.Property] = result.Value;
                    break;
                case "Array":
                    updatedSettings[result.Category][result.Property] = result.Value.split(",");
                    break;
                }
            }
        }
    }
    logger.endTrace('getSettings');
    return updatedSettings;
}

async function sendError(backfillScheduleID) {
    logger.startTrace('sendError');
    let logString = ":no_entry: `system-inventory-checks`\n";
    logString += `Backfill Schedule ${backfillScheduleID} failed to create system inventory checks in environment ${process.env.NODE_ENV}`;

    logger.error(`Backfill Schedule ${backfillScheduleID} failed to create system inventory checks in environment ${process.env.NODE_ENV}`, 'sendError');

    try {
        logger.trace('sendError:slack');
        await axios.post(slackURL, {"text": logString});
    } catch (error) {
        logger.error(error, 'sendError:slack');
    }
    logger.endTrace('sendError');
}

exports.handler = async (event) => {
    logger.startTrace('handler');
    let message, backfillScheduleID;


    try {
        let eventBody = event.body;

        config = await getConfig.getConfig(process.env.NODE_ENV);
        slackURL = config.slackHookErrors;

        if (!eventBody.storeBackfillScheduleID) {
            eventBody = JSON.parse(event.body);
        }

        backfillScheduleID = eventBody.storeBackfillScheduleID;

        if (!backfillScheduleID) {
            message = "backfillScheduleID is required";
            logger.info(message, 'handler');
            return message;
        }

        pool = await db.getPool();
        settings = await getSettings();

        // By default sort tasks by Total RFID Quantity of Keycode in ascending order
        const sortBy = settings.inventoryTasksSort || SortEnum.TOTAL_RFID_QUANTITY_ASC;

        // Get the Anko Inventory
        const ankoKeycodeDictionary = await _GetAnkoInventory(backfillScheduleID);

        const locationDetails = await _GetLocationDetails(backfillScheduleID);
        const locationID = locationDetails["LocationID"];
        const timezone = locationDetails["Timezone"];
        const departments = locationDetails["kmartDepartmentIDs"];

        // Get the Kmart Inventory
        let kmartKeycodeDictionary = await _GetKmartInventory(locationID, timezone, departments);
        await _InsertKmartInventorySnapshot(locationID, kmartKeycodeDictionary, backfillScheduleID);

        // Insert rows into store_inventory_snapshot table where only Kmart has inventory
        await _InsertKmartOnlyKeycodes(ankoKeycodeDictionary, kmartKeycodeDictionary, backfillScheduleID, locationID);

        // Update store_inventory_snapshot table with Kmart data
        await _UpdateStoreInventorySnapshot(backfillScheduleID);

        // After processing the Anko and Kmart data into store_inventory_snapshot, select the data for inventory task generation
        const inventoryData = await _getDataForInventoryTasks(backfillScheduleID);

        // Generate the inventory system type task
        await _generateInventoryTask(inventoryData, locationDetails, backfillScheduleID, sortBy);
    } catch (error) {
        message = `Unable to generate the inventory task for BackfillScheduleID ${backfillScheduleID}`;
        logger.error(message, 'handler', error);
        await sendError(backfillScheduleID);

        return message;
    }

    logger.info(message, 'handler');
    logger.endTrace('handler');
    return {
        "statusCode": 200
    };
};
