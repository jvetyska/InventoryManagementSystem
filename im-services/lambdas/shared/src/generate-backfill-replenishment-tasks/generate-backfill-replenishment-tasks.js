const db = require("/opt/nodejs/wmsDB.js");
const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios } = require("/opt/nodejs/xray.js");
const logger = require("/opt/nodejs/logger.js")('generate-backfill-replenishment-tasks');

let pool, SLACK_ERRORS, config;
const BackfillTaskDeleteInterval = 12;

exports.handler = async (event) => {
    logger.startTrace('main');
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slackHookErrors;
        await main();
    } catch (error) {
        logger.error(error, 'handler');
        let message = ":no_entry: ERROR: generate-backfill-replenishment-tasks";
        message += `Error while generating backfill tasks and inventory check tasks in environment ${process.env.NODE_ENV}`;
        await axios.post(SLACK_ERRORS, {text: message});
    }
    logger.endTrace('handler');
};

async function main () {
    logger.startTrace('main');
    let sql, args, results, uniqueResults, apiResults;
    pool = await db.getPool();

    // This query will give a list of all the scheduled backfills that are due within the 12 hours
    sql = `
        SELECT
            sbs.ID AS BackfillScheduleID,
            sbs.InventoryCheckType,
            checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat) AS RunToday,
            DATE_ADD(CONVERT_TZ(NOW(), 'UTC', loc.Timezone), INTERVAL -30 MINUTE) as StartDateTime,
            DATE_ADD(CONVERT_TZ(NOW(), 'UTC', loc.Timezone), INTERVAL 12 HOUR) as EndDateTime,
            DATE_ADD(
                DATE_ADD(
                    DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)),
                    INTERVAL sbs.Minute MINUTE
                ),
                INTERVAL sbs.Hour HOUR
            ) as RunDateTime
        FROM store_backfill_schedule sbs
        INNER JOIN inventory_take_schedule its ON its.BackfillScheduleID = sbs.ID
        INNER JOIN location loc ON loc.ID = sbs.LocationID
        LEFT JOIN task_group tg ON tg.ReferenceID = sbs.ID AND tg.Type = 'Backfill' AND tg.DateCreated >= NOW() - INTERVAL ${BackfillTaskDeleteInterval} HOUR
        WHERE
            sbs.IsEnabled = 1
            # Make sure there are have not been backfill tasks created already
            AND tg.ID IS NULL
        HAVING
            RunToday = 1
            AND RunDateTime >= StartDateTime
            AND RunDateTime < EndDateTime`;

    try {
        logger.trace(`generate-backfill-replenishment-tasks:main:pool.query:scheduledBackfills`);
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error(error, 'main:pool.query:scheduledBackfills');
        throw error;
    }

    if (results.length === 0) {
        logger.info('There are no backfills scheduled for this time', 'main:pool.query:scheduledBackfills');
        return; // There are no backfills scheduled for this time
    }

    let firstResultObject = {};
    for (let data of results) {
        let backfillScheduleID = data.BackfillScheduleID;
        if (!firstResultObject[backfillScheduleID]) {
            firstResultObject[backfillScheduleID] = data.InventoryCheckType;
        }
    }
    /* There are three things we need to get:
     * 1. inventory_take_schedule IDs (all of them)
     * 2. inventory_take_schedule IDs that are associated with any inventory bot, regardless of the bot's status
     * 3. inventory_take_schedule IDs that are associated with an inventory bot that's currently available
     *
     * Requirements:
     * 1. Backfill schedules that DON'T have an inventory bot in their location are free to create backfill replenishment tasks
     * 2. If a location DOES have an inventory bot, then it MUST be available for backfill replenishment tasks to be created
     *
     * Locations that have inventory bots available MUST meet these additional requirements:
     * 1. Have had an inventory bot updated within the last 12 hours
     * 2. The bot's status is "RunDataReady"
     * 3. The bot has an InventoryTakeScheduleID
     * 4. The associated row in store_backfill_schedule is enabled
     * 5. The task is scheduled for today as calculated by the checkdate() function
     *
     * Example of rows before the final "HAVING" SQL at the end:
     * InventoryTakeScheduleID, HasInventoryBots, AvailableInventoryBots
     * 32,                      1,                1
     * 33,                      1,                0
     * 34,                      0,                0
     *
     * InventoryTakeScheduleID #32 can have tasks generated because it has inventory bots available
     * InventoryTakeScheduleID #33 can NOT have tasks generated because it has inventory bots, but none available
     * InventoryTakeScheduleID #34 can have tasks generated because it does NOT have any inventory bots at all
     * Given the three above statements, #33 will be removed from the results
     */
    sql = `
        SELECT
            a.BackfillScheduleID,
            a.InventoryCheckType,
            SUM(Ready) AS RowsReady,
            COUNT(*) AS RowsTotal
        FROM (
            SELECT
                sbs.ID AS BackfillScheduleID,
                sbs.InventoryCheckType,
                # 1. The schedule type is "Manual"
                # 2. The schedule type is "InventoryBot", and the status is "RunDataReady", and the bot was updated within the last 12 hours
                # 3. The run is accepted meaning it hits Run Quality and Tag Difference thresholds
                IF((its.Type = 'Manual' AND tg.DateCompleted IS NOT NULL) OR
                    (its.Type = 'InventoryBot' AND bph.Status = 'RunDataReady' AND bph.isRunAccepted = 1 AND bph.DateUpdated > NOW() - INTERVAL ${BackfillTaskDeleteInterval} HOUR)
                , 1, 0) AS Ready,
                checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat) AS RunToday
            FROM store_backfill_schedule sbs
            INNER JOIN location loc ON loc.ID = sbs.LocationID
            LEFT JOIN inventory_take_schedule its ON its.BackfillScheduleID = sbs.ID
            LEFT JOIN (
                SELECT
                    bph1.InventoryTakeScheduleID,
                    bph1.Status,
                    bph1.DateUpdated,
                    bph1.isRunAccepted
                FROM bot_process_history bph1
                INNER JOIN (
                    SELECT
                        InventoryTakeScheduleID,
                        MAX(DateCreated) AS DC
                    FROM bot_process_history
                    WHERE InventoryTakeScheduleID IS NOT NULL
                    GROUP BY InventoryTakeScheduleID
                ) AS bph0 ON bph0.InventoryTakeScheduleID = bph1.InventoryTakeScheduleID AND bph0.DC = bph1.DateCreated
            ) bph ON bph.InventoryTakeScheduleID = its.ID
            LEFT JOIN task_group tg ON tg.ReferenceID = its.ID AND tg.Type = 'BackfillCount'
            WHERE sbs.IsEnabled = 1 AND its.ID IS NOT NULL # Only rows that are enabled and have an associated inventory_take_schedule ID
            HAVING RunToday = 1                            # Only rows that we are supposed to run today
            ORDER BY sbs.LocationID DESC, sbs.ID DESC
        ) AS a
        GROUP BY BackfillScheduleID
        HAVING RowsReady = RowsTotal`;

    try {
        logger.trace('main:pool.query:generateTasks');
        [results] = await pool.query(sql);
        logger.info(results);
    } catch (error) {
        logger.error(error, 'main:pool.query:generateTasks');
        throw error;
    }

    let secondResultObject = {};
    for (let data of results) {
        let backfillScheduleID = data.BackfillScheduleID;
        if (!secondResultObject[backfillScheduleID]) {
            secondResultObject[backfillScheduleID] = data.InventoryCheckType;
        }
    }

    /* Get the intersection of the two arrays from the SQL results. We may be able to combine the
     * two SQLs into one larger one, but keeping it as two seperate queries for simplicity for now.
     * For example, if the first SQL query gave us BackfillScheduleIDs of [1, 2, 3] and if the
     * second SQL query gave us BackfillScheduleIDs of [2, 3, 4] then the final results would
     * be just two BackfillScheduleIDs [2, 3] */
    results = Object.keys(firstResultObject).filter(value => Object.keys(secondResultObject).includes(value));
    uniqueResults = [...new Set(results)];

    if (uniqueResults.length === 0) {
        // There are no inventory take schedule IDs that have been SELECTed in both the first and second SQL queries
        return;
    }

    for (let storeBackfillScheduleID of uniqueResults) {
        let body = {
            storeBackfillScheduleID: storeBackfillScheduleID
        };

        try {
            logger.trace(`generate-backfill-replenishment-tasks:main:_insertStoreInventorySnapshot`);
            await _insertStoreInventorySnapshot(storeBackfillScheduleID);
        } catch (error) {
            logger.error(error, 'main:_insertStoreInventorySnapshot');
            throw error;
        }

        try {
            // After tasks have been cleaned up, generate backfill replenishment
            apiResults = await wmsAPI.Post("generate_backfill_replenishment", body);
            logger.debug(apiResults.message, 'main:wmsAPI.generate_backfill_replenishment');
        } catch (error) {
            logger.error(error, 'main:wmsAPI.generate_backfill_replenishment');
            throw error;
        }

        if (secondResultObject[storeBackfillScheduleID] === "standard") {
            try {
                // After backfill replenishment has been generated, generate inventory standard type tasks
                apiResults = await wmsAPI.Post("create_backfill_random_inventory_checks", body);
                logger.debug(apiResults.message, 'main:wmsAPI.create_backfill_random_inventory_checks');
            } catch (error) {
                logger.error(error, 'main:wmsAPI.create_backfill_random_inventory_checks');
                throw error;
            }
        }

        if (secondResultObject[storeBackfillScheduleID] === "system" && config.SystemInventoryTaskURL != "") {
            try {
                // After backfill replenishment has been generated, generate inventory system type tasks
                logger.trace('main:SystemInventoryTask', {shedule: storeBackfillScheduleID});
                // Probably need to catch and ignore timeout error here
                await axios.post(config.SystemInventoryTaskURL, body);
            } catch (error) {
                logger.error(`unable to generate Task for backfillScheduleID ${storeBackfillScheduleID}`, 'main:SystemInventoryTask');
                throw new Error(`unable to generate Task for backfillScheduleID ${storeBackfillScheduleID}`);
            }
        }
    }
    logger.endTrace('main');
}

async function _insertStoreInventorySnapshot (backfillScheduleID) {
    logger.startTrace('_insertStoreInventorySnapshot');
    let sql, args, results;

    // Starting transaction and setting isolation level to READ COMMITTED on this transaction
    // This is to avoid having a long lock on the inventory table
    sql = `
        # Complete any old snapshot rows so old rows don't linger
        UPDATE store_inventory_snapshot
        SET DateCompleted = NOW()
        WHERE BackfillScheduleID = ? AND DateCompleted IS NULL
        ;
        START TRANSACTION
        ;
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
        ;
        INSERT INTO store_inventory_snapshot (LocationID, ContainerID, BackfillScheduleID, Keycode, Quantity, QuantityBackfill, DateSnapshot)
        SELECT
            c.LocationID,
            i.ContainerID,
            ? AS BackfillScheduleID,
            i.Keycode,
            COUNT(*) AS Quantity,
            SUM(IF(i.isSameLocation, 1, 0)) AS QuantityBackfill,
            CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL c.MinHourMinute MINUTE), loc.Timezone, 'UTC') AS DateSnapshot
        FROM inventory i
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
        GROUP BY i.Keycode, i.ContainerID
        ;
        SELECT
            IF(SUM(IF(ct.isFoH, 1, 0)) > 0, 1, 0) AS didGenerateFoHSnapshot,
            sis.DateSnapshot
        FROM store_inventory_snapshot sis
        INNER JOIN container c ON sis.ContainerID = c.ID
        INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
        WHERE sis.DateCreated > NOW() - INTERVAL 1 MINUTE AND sis.BackfillScheduleID = ?
        ;
        COMMIT
        ;`;

    args = [backfillScheduleID, backfillScheduleID, backfillScheduleID, backfillScheduleID, backfillScheduleID, backfillScheduleID];

    try {
        logger.info(`generate-backfill-replenishment-tasks:_insertStoreInventorySnapshot:pool.query`);
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '_insertStoreInventorySnapshot:pool.query');
        throw error;
    }

    results = results[4][0];
    const didGenerateFoHSnapshot = results.didGenerateFoHSnapshot;
    const dateSnapshot = results.DateSnapshot;
    logger.trace('_insertStoreInventorySnapshot:pool.query', {didGenerateFoHSnapshot: didGenerateFoHSnapshot, dateSnapshot: dateSnapshot});
    // If this backfill schedule didn't generate FOH inventory
    // We need to insert rows for FOH inventory for the keycodes we added
    // This is so Backfill Generation has an inventory snapshot for FOH data so it can create correct tasks
    if (!didGenerateFoHSnapshot) {
        // Starting transaction and setting isolation level to READ COMMITTED on this transaction
        // This is to avoid having a long lock on the inventory table
        sql = `
            START TRANSACTION
            ;
            SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
            ;
            INSERT INTO store_inventory_snapshot (LocationID, ContainerID, BackfillScheduleID, Keycode, Quantity, QuantityBackfill, DateSnapshot)
            SELECT
                c.LocationID,
                i.ContainerID,
                ? AS BackfillScheduleID,
                i.Keycode,
                COUNT(*) AS Quantity,
                SUM(IF(i.isSameLocation, 1, 0)) AS QuantityBackfill,
                ? AS DateSnapshot
            FROM inventory i
            INNER JOIN (
                SELECT
                    c.ID as ContainerID,
                    c.LocationID
                FROM store_backfill_schedule sbs
                INNER JOIN location loc ON sbs.LocationID = loc.ID
                INNER JOIN container c ON c.LocationID = loc.ID
                INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
                WHERE sbs.ID = ? AND ct.isFoH AND ct.BackfillEnabled
            ) as c on c.ContainerID = i.ContainerID
            INNER JOIN (
                SELECT
                    DISTINCT Keycode
                FROM store_inventory_snapshot
                WHERE DateSnapshot = ?
            ) AS eligibleKeycodes ON eligibleKeycodes.Keycode = i.Keycode
            GROUP BY i.Keycode, i.ContainerID
            ;
            COMMIT
            ;`;
        args = [backfillScheduleID, dateSnapshot, backfillScheduleID, dateSnapshot];

        try {
            logger.trace('_insertStoreInventorySnapshot:pool.query:store_inventory_snapshot');
            await pool.query(sql, args);
        } catch (error) {
            logger.error(error, '_insertStoreInventorySnapshot:pool.query:store_inventory_snapshot');
            throw error;
        }
    }
    logger.endTrace('_insertStoreInventorySnapshot');
}
