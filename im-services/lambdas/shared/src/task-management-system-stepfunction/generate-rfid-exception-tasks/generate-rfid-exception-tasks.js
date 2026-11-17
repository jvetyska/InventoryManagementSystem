const db = require("/opt/nodejs/wmsDB.js");
const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const moment = require("moment");
const defaultSettings = require("./defaultSettings");
const { sortTaskData, SortEnum } = require("/opt/nodejs/sortUtil.js");
let pool, settings;
const logger = require('/opt/nodejs/logger')('task-management-system-stepfunction:generate-rfid-exception-tasks');

const BackfillTaskDeleteInterval = 12;

exports.handler = async (event) => {
    logger.startTrace('handler');
    try {
        logger.info('event', 'handler', {event});

        logger.trace('handler:db.getPool')
        pool = await db.getPool();
        logger.trace('handler:main')
        await main(event);
    } catch (error) {
        logger.error(error, 'handler');
        throw error;
    }

    logger.endTrace('handler');
    return event.Input;
};

async function main(event) {
    logger.startTrace('main');
    const input = event.Input;
    const backfillScheduleID = input.backfillScheduleID;
    const type = event.Type;
    settings = await getSettings();
    // By default sort tasks by Total RFID Quantity of Keycode in ascending order
    const sortBy = settings.inventoryTasksSort || SortEnum.TOTAL_RFID_QUANTITY_ASC;
    logger.info(backfillScheduleID, type);
    if (type === "system") {
        logger.info(`Generating system tasks for schedule ${backfillScheduleID}`, 'main');

        const inventoryData = await getDataForRFIDExceptionTasks(backfillScheduleID);
        const locationDetails = await getLocationDetails(backfillScheduleID);

        // Generate the inventory system type task
        await generateRFIDExceptionTasks(inventoryData, locationDetails, backfillScheduleID, sortBy);
    } else if (type === "standard") {
        logger.info(`Generating standard tasks for schedule ${backfillScheduleID}`, 'main');

        await createStandardRFIDExceptionTasks(backfillScheduleID);
    }
    logger.endTrace('handler');
}

async function createStandardRFIDExceptionTasks(backfillScheduleID) {
    logger.startTrace('createStandardRFIDExceptionTasks');
    const body = {
        storeBackfillScheduleID: backfillScheduleID
    };

    try {
        // After backfill replenishment has been generated, generate inventory standard type tasks
        let apiResults = await wmsAPI.Post("create_backfill_random_inventory_checks", body);
        console.debug(apiResults.message);
    } catch (error) {
        logger.error(error, 'createStandardRFIDExceptionTasks');
        throw error;
    }
    logger.endTrace('createStandardRFIDExceptionTasks');
}

async function getDataForRFIDExceptionTasks(backfillScheduleID) {
    logger.startTrace('getDataForRFIDExceptionTasks');
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
            AND sis.DateCompleted IS NULL
            AND IFNULL(sis.QuantityExternalStart, 0) = IFNULL(sis.QuantityExternalEnd, 0)`;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "getDataForRFIDExceptionTasks:_getInventoryTaskData");
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

    logger.endTrace('getDataForRFIDExceptionTasks');
    return inventoryDataObject;
}

async function getLocationDetails(backfillScheduleID) {
    logger.startTrace('getLocationDetails');
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
        [results] = await pool.query(sql, args);
        results = results[0];
    } catch (error) {
        logger.error(error, 'getLocationDetails:_GetAnkoInventory');
        throw new Error(`Error Occured while getting Inventory data from Anko DB`);
    }

    if (!results.LocationID) {
        throw new Error(`Location Data not available for Backfill Schedule ${backfillScheduleID}`);
    }

    logger.endTrace('getLocationDetails');
    return results;
}

async function generateRFIDExceptionTasks(inventoryData, locationDetails, backfillScheduleID, sortBy) {
    logger.startTrace('generateRFIDExceptionTasks');
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
                        Keycode: parseInt(keycode, 10),
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
        sql = `
            UPDATE store_inventory_snapshot
                SET IsOverThreshold = 1
            WHERE
                BackfillScheduleID = ?
                AND Keycode IN ?
                AND DateCompleted IS NULL
            ;
        `;
        args = [backfillScheduleID, [isOverThresholdKeycodes]];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error(`Update IsOverThreshold Flag. ${error}`, 'generateRFIDExceptionTasks:_generateInventoryTask');
            throw new Error(`Unable to generate task`);
        }

        logger.info(`Updates ${results.affectedRows} with IsOverThreshold value = 1`);
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
        return array.reduce((hash, obj) => {
            if(obj[key] === undefined) return hash;
            return Object.assign(hash, { [obj[key]]:( hash[obj[key]] || [] ).concat(obj)});
          }, {});
    }

    let containerTasks = groupByKey(getKeycodesToCheckTaskData, 'ContainerID');

    let taskGroupIDs = [];

    for (let group in containerTasks) {
        if (containerTasks[group].length) {
            for (let i = 0; i < containerTasks[group].length; i += maxInventoryTaskUnits) {
                let taskGroupId = await CreateTaskGroup(LocationID, hoursToComplete, backfillScheduleID);
                taskGroupIDs.push(taskGroupId);
                // There is a max inventory task batch size for FHBH inventory tasks so split tasks into groups
                let tasks = containerTasks[group].slice(i, i + maxInventoryTaskUnits);
                await CreateTasks(LocationID, taskGroupId, tasks, backfillScheduleID);
            }
        }
    }

    // update the taskID column in store_inventory_sanpshot table
    if (taskGroupIDs.length) {
        sql = `
            UPDATE store_inventory_snapshot sis
            INNER JOIN (
                SELECT t.Keycode, t.ID, t.SourceContainer
                FROM task t
                INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
                WHERE tg.ID IN ?
                AND t.ReferenceID = ?
                AND t.Type = 'Inventory'
            ) ta ON
				sis.BackfillScheduleID = ?
				AND ta.Keycode = sis.keycode
				AND ta.SourceContainer = sis.ContainerID
                AND sis.DateCompleted IS NULL
            SET sis.TaskID = ta.ID
            ;
        `;
        args = [[taskGroupIDs], backfillScheduleID, backfillScheduleID];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error(error, 'generateRFIDExceptionTasks_generateInventoryTask:UpdateTaskID');
            throw new Error(`Unable to generate task`);
        }
    }
    logger.endTrace('generateRFIDExceptionTasks');
}

async function CreateTaskGroup(locationId, hoursToComplete, referenceID) {
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
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'CreateTaskGroup');
        throw new Error(`Unable to generate task group for location : ${locationId} for BackFillScheduleID: ${referenceID}`);
    }

    logger.endTrace('CreateTaskGroup');
    return results["insertId"];
}

async function CreateTasks(locationId, taskGroupId, tasks, referenceID) {
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
            await pool.query(sql, [taskArgs]);
        } catch (error) {
            logger.error(error, 'CreateTasks');
            throw new Error(`Unable to generate task for location: ${locationId} for BackFillScheduleID: ${referenceID}`);
        }
    }

    logger.info(`${locationId} new created tasks: ${newCreatedTasks} on ${moment().utc().format()}`);
    logger.endTrace('CreateTasks');
}

async function getSettings() {
    logger.startTrace('getSettings');
    let sql, results;

    sql = "SELECT * FROM system_settings";

    try {
        [results] = await pool.query(sql);
    } catch (err) {
        logger.info(err);
        throw err;
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
