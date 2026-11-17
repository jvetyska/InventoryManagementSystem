const db = require("/opt/nodejs/wmsDB.js");
const { AWS } = require("/opt/nodejs/xray.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require('/opt/nodejs/logger')('task-management-system-stepfunction:generate-store-inventory-snapshot');

// Number of hours a Kmart Date Manifest may be that we don't consider the keycode for Backfill or IPS adjustment
const maxDateManifestHours = 24;

let pool;

exports.handler = async (event) => {
    logger.startTrace('handler');
    let taskToken, input;

    try {
        let eventBody = event.Records[0].body;

        if (typeof(eventBody) === "string") {
            eventBody = JSON.parse(eventBody);
        }

        logger.debug('Event Body', 'handler', {data: eventBody});

        taskToken = eventBody.TaskToken;

        input = eventBody.Input;
        let backfillScheduleID = input["backfillScheduleID"];

        pool = await db.getPool();
        // Create an store_inventory_snapshot rows from RFID inventory
        logger.trace('handler:generateStoreInventorySnapshot');
        await generateStoreInventorySnapshot(backfillScheduleID);
        // Then create store_inventory_snapshot rows for Keycodes which only exists in Kmarts IPS DB
        await generateKmartOnlyInventorySnapshot(backfillScheduleID);

        logger.trace('handler:resumeExecution');
        await resumeExecution(taskToken, input);
    } catch (error) {
        logger.error(error, 'handler');
        await failExecution(taskToken);

        throw error;
    }
    logger.endTrace('handler');
};

async function generateStoreInventorySnapshot (backfillScheduleID) {
    logger.startTrace('generateStoreInventorySnapshot');
    let sql, args, results;

    console.log(`generateStoreInventorySnapshot creating store_inventory_snapshot for schedule ${backfillScheduleID}`);
    // Starting transaction and setting isolation level to READ COMMITTED on this transaction
    // This is to avoid having a long lock on the inventory table
    sql = `
        START TRANSACTION
        ;
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
        ;
        # Complete any old snapshot rows so old rows don't linger
        UPDATE store_inventory_snapshot
        SET DateCompleted = NOW()
        WHERE BackfillScheduleID = ? AND DateCompleted IS NULL
        ;
        INSERT INTO store_inventory_snapshot (LocationID, ContainerID, BackfillScheduleID, Keycode, Quantity, QuantityBackfill,
            DateSnapshot, QuantityExternalStart, QuantityExternalEnd, DateExternalStart, DateExternalEnd, HasRecentManifest)
        SELECT
            c.LocationID,
            i.ContainerID,
            sbs.ID AS BackfillScheduleID,
            i.Keycode,
            COUNT(*) AS Quantity,
            # Inventory is eligible for Backfill when rfid tag is in same location as last read and there is not a recent Kmart Manifest date
            SUM(IF(i.isSameLocation AND IF(kmartSnapshotEnd.DateKmartManifest > NOW() - INTERVAL ${maxDateManifestHours} HOUR, 0, 1), 1, 0)) AS QuantityBackfill,
            CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL c.MinHourMinute MINUTE), loc.Timezone, 'UTC') AS DateSnapshot,
            kmartSnapshotStart.Quantity,
            kmartSnapshotEnd.Quantity,
            kmartSnapshotStart.DateCreated,
            kmartSnapshotEnd.DateCreated,
            IF(kmartSnapshotEnd.DateKmartManifest > NOW() - INTERVAL ${maxDateManifestHours} HOUR, 1, 0) AS HasRecentManifest
        FROM inventory i
        INNER JOIN store_backfill_schedule sbs ON sbs.ID = ?
        INNER JOIN (
            SELECT
                c.ID as ContainerID,
                c.LocationID,
                MIN((its.Hour * 60) + its.Minute) as MinHourMinute
            FROM (
                # Get Containers from the boundaries
                SELECT ibb.ContainerID, its.ID AS InventoryTakeScheduleID
                FROM inventory_take_schedule its
                INNER JOIN inventory_bot ib ON its.InventoryBotID = ib.ID
                INNER JOIN inventory_bot_boundary ibb ON ibb.LocationID = ib.LocationID AND ibb.Map = ib.DefaultMap
                WHERE its.BackfillScheduleID = ?
                AND its.Type = 'InventoryBot'
            UNION
                # Get Containers from the areas
                SELECT IFNULL(iba.ContainerID, its.ContainerID) AS ContainerID, its.ID AS InventoryTakeScheduleID
                FROM inventory_take_schedule its
                LEFT JOIN inventory_bot_area iba ON its.InventoryBotArea = iba.Area AND its.InventoryBotID = iba.InventoryBotID
                WHERE its.BackfillScheduleID = ?
				AND its.Type = 'InventoryBot'
            UNION
                SELECT its.ContainerID, its.ID AS InventoryTakeScheduleID
                FROM inventory_take_schedule its
                WHERE its.BackfillScheduleID = ?
                AND its.Type = 'Manual'
            ) containers
            INNER JOIN container c ON c.ID = containers.ContainerID
            INNER JOIN inventory_take_schedule its ON its.ID = containers.InventoryTakeScheduleID
            WHERE c.Type IN ('STR', 'SHL', 'RSV', 'RCV', 'MOD')
            GROUP BY containers.ContainerID
        ) as c on c.ContainerID = i.ContainerID
        INNER JOIN location loc ON c.LocationID = loc.ID
        LEFT JOIN kmart_inventory_snapshot kmartSnapshotStart ON
            kmartSnapshotStart.BackfillScheduleID = sbs.ID
            AND kmartSnapshotStart.Keycode = i.Keycode
            AND kmartSnapshotStart.SnapshotType = 'ScheduleStart'
            AND kmartSnapshotStart.DateCreated > NOW() - INTERVAL 12 HOUR
        LEFT JOIN kmart_inventory_snapshot kmartSnapshotEnd ON
            kmartSnapshotEnd.BackfillScheduleID = sbs.ID
            AND kmartSnapshotEnd.Keycode = i.Keycode
            AND kmartSnapshotEnd.SnapshotType = 'ScheduleEnd'
            AND kmartSnapshotEnd.DateCreated > NOW() - INTERVAL 12 HOUR
        GROUP BY i.Keycode, i.ContainerID
        ;
        SELECT
            IF(SUM(IF(ct.isFoH, 1, 0)) > 0, 1, 0) AS didGenerateFoHSnapshot,
            sis.DateSnapshot
        FROM store_inventory_snapshot sis
        INNER JOIN container c ON sis.ContainerID = c.ID
        INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
        WHERE sis.BackfillScheduleID = ? AND sis.DateCompleted IS NULL
        ;
        COMMIT
        ;`;

    args = [backfillScheduleID, backfillScheduleID, backfillScheduleID, backfillScheduleID, backfillScheduleID, backfillScheduleID];

    try {
        logger.trace('generateStoreInventorySnapshot:pool.query');
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'generateStoreInventorySnapshot:pool.query');
        throw error;
    }

    console.log(`generateStoreInventorySnapshot finished creating store_inventory_snapshot for schedule ${backfillScheduleID}`);

    results = results[4][0];
    const didGenerateFoHSnapshot = results.didGenerateFoHSnapshot;
    const dateSnapshot = results.DateSnapshot;

    // If this backfill schedule didn't generate FOH inventory
    // We need to insert rows for FOH inventory for the keycodes we added
    // This is so Backfill Generation has an inventory snapshot for FOH data so it can create correct tasks
    if (!didGenerateFoHSnapshot) {
        console.log(`generateStoreInventorySnapshot creating FOH ONLY store_inventory_snapshot for schedule ${backfillScheduleID}`);

        // Starting transaction and setting isolation level to READ COMMITTED on this transaction
        // This is to avoid having a long lock on the inventory table
        sql = `
            START TRANSACTION
            ;
            SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
            ;
            INSERT INTO store_inventory_snapshot (LocationID, ContainerID, BackfillScheduleID, Keycode, Quantity, QuantityBackfill,
                DateSnapshot, QuantityExternalStart, QuantityExternalEnd, DateExternalStart, DateExternalEnd, HasRecentManifest)
            SELECT
                c.LocationID,
                i.ContainerID,
                sbs.ID AS BackfillScheduleID,
                i.Keycode,
                COUNT(*) AS Quantity,
                # Inventory is eligible for Backfill when rfid tag is in same location as last read and there is not a recent Kmart Manifest date
                SUM(IF(i.isSameLocation AND IF(kmartSnapshotEnd.DateKmartManifest > NOW() - INTERVAL ${maxDateManifestHours} HOUR, 0, 1), 1, 0)) AS QuantityBackfill,
                ? AS DateSnapshot,
                kmartSnapshotStart.Quantity,
                kmartSnapshotEnd.Quantity,
                kmartSnapshotStart.DateCreated,
                kmartSnapshotEnd.DateCreated,
                IF(kmartSnapshotEnd.DateKmartManifest > NOW() - INTERVAL ${maxDateManifestHours} HOUR, 1, 0) AS HasRecentManifest
            FROM inventory i
            INNER JOIN store_backfill_schedule sbs ON sbs.ID = ?
            INNER JOIN location loc ON sbs.LocationID = loc.ID
            INNER JOIN (
                SELECT
                    c.ID as ContainerID,
                    c.LocationID
                FROM store_backfill_schedule sbs
                INNER JOIN container c ON c.LocationID = sbs.LocationID
                INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
                WHERE sbs.ID = ? AND ct.isFoH AND ct.BackfillEnabled
            ) as c on c.ContainerID = i.ContainerID
            INNER JOIN (
                SELECT
                    DISTINCT Keycode
                FROM store_inventory_snapshot
                WHERE BackfillScheduleID = ? AND DateCompleted IS NULL
            ) AS eligibleKeycodes ON eligibleKeycodes.Keycode = i.Keycode
            LEFT JOIN kmart_inventory_snapshot kmartSnapshotStart ON
                kmartSnapshotStart.BackfillScheduleID = sbs.ID
                AND kmartSnapshotStart.Keycode = i.Keycode
                AND kmartSnapshotStart.SnapshotType = 'ScheduleStart'
                AND kmartSnapshotStart.DateCreated > NOW() - INTERVAL 12 HOUR
            LEFT JOIN kmart_inventory_snapshot kmartSnapshotEnd ON
                kmartSnapshotEnd.BackfillScheduleID = sbs.ID
                AND kmartSnapshotEnd.Keycode = i.Keycode
                AND kmartSnapshotEnd.SnapshotType = 'ScheduleEnd'
                AND kmartSnapshotEnd.DateCreated > NOW() - INTERVAL 12 HOUR
            GROUP BY i.Keycode, i.ContainerID
            ;
            COMMIT
            ;`;
            args = [dateSnapshot, backfillScheduleID, backfillScheduleID, backfillScheduleID];

        try {
            logger.trace('generateStoreInventorySnapshot:pool.query:dateSnapshot');
            await pool.query(sql, args);
        } catch (error) {
            logger.error(error, 'generateStoreInventorySnapshot:pool.query:dateSnapshot');
            throw error;
        }

        console.log(`generateStoreInventorySnapshot finished creating FOH ONLY store_inventory_snapshot for schedule ${backfillScheduleID}`);
    }
    logger.endTrace('generateStoreInventorySnapshot');
}

async function generateKmartOnlyInventorySnapshot(backfillScheduleID) {
    let sql, args;

    console.log(`generateStoreInventorySnapshot creating KMART ONLY store_inventory_snapshot for schedule ${backfillScheduleID}`);
    sql = `
        START TRANSACTION
        ;
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
        ;
        INSERT INTO store_inventory_snapshot (LocationID, ContainerID, BackfillScheduleID, Keycode, Quantity, QuantityBackfill,
            DateSnapshot, QuantityExternalStart, QuantityExternalEnd, DateExternalStart, DateExternalEnd, HasRecentManifest)
        SELECT
            kmartEndingSnapshot.LocationID,
            kmartEndingSnapshot.LocationID AS ContainerID,
            kmartEndingSnapshot.BackfillScheduleID,
            kmartEndingSnapshot.Keycode,
            0 AS Quantity,
            0 AS QuantityBackfill,
            NOW() AS DateSnapshot,
            kmartStartingSnapshot.Quantity,
            kmartEndingSnapshot.Quantity,
            kmartStartingSnapshot.DateCreated,
            kmartEndingSnapshot.DateCreated,
            IF(kmartEndingSnapshot.DateKmartManifest > NOW() - INTERVAL ${maxDateManifestHours} HOUR, 1, 0) AS HasRecentManifest
        FROM kmart_inventory_snapshot kmartEndingSnapshot
        INNER JOIN location loc ON kmartEndingSnapshot.LocationID = loc.ID
        LEFT JOIN store_inventory_snapshot sis ON
            kmartEndingSnapshot.BackfillScheduleID = sis.BackfillScheduleID
            AND kmartEndingSnapshot.LocationID = sis.LocationID
            AND kmartEndingSnapshot.Keycode = sis.Keycode
            AND sis.DateCompleted IS NULL
        LEFT JOIN kmart_inventory_snapshot kmartStartingSnapshot ON
            kmartEndingSnapshot.BackfillScheduleID = kmartStartingSnapshot.BackfillScheduleID
            AND kmartEndingSnapshot.Keycode = kmartStartingSnapshot.Keycode
            AND kmartStartingSnapshot.SnapshotType = 'ScheduleStart'
            AND kmartStartingSnapshot.DateCreated > NOW() - INTERVAL 12 HOUR
        WHERE
            sis.ID IS NULL
            AND kmartEndingSnapshot.BackfillScheduleID = ?
            AND kmartEndingSnapshot.SnapshotType = 'ScheduleEnd'
            AND kmartEndingSnapshot.Quantity > 0
            AND kmartEndingSnapshot.DateCreated > NOW() - INTERVAL 12 HOUR
        ;
        COMMIT
        ;`;
    args = [backfillScheduleID];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error('generateKmartOnlyInventorySnapshot ', {error});
        throw new Error(`Unable to generate Kmart Only inventory shapshot for BackFillScheduleID: ${backfillScheduleID}`);
    }

    console.log(`generateStoreInventorySnapshot finished creating KMART ONLY store_inventory_snapshot for schedule ${backfillScheduleID}`);
}

async function resumeExecution(taskToken, output) {
    logger.endTrace('resumeExecution');
    const params = {
        "taskToken": taskToken,
        "output": JSON.stringify(output)
    };

    logger.trace('resumeExecution:stepfunctions.sendTaskSuccess');
    await stepfunctions.sendTaskSuccess(params).promise();
    logger.endTrace('resumeExecution');
}

async function failExecution(taskToken) {
    logger.endTrace('failExecution');
    const params = {
        "taskToken": taskToken,
        "output": `{}`
    };

    logger.trace('failExecution:stepfunctions.sendTaskFailure');
    await stepfunctions.sendTaskFailure(params).promise();
    logger.endTrace('failExecution');
}
