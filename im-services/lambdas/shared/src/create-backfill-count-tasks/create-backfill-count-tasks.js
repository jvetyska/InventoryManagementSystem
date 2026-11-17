const db = require("/opt/nodejs/wmsDB.js");
const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const getConfig = require("/opt/nodejs/config.js");
const moment = require("moment-timezone");
const { axios } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('create-backfill-count-tasks'); 

let pool, SLACK_ERRORS, config;
const LAMBDA_INTERVAL = 15; // 15 minutes

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        SLACK_ERRORS = config.slackHookErrors;
        await main();
    } catch (error) {
        console.log(error);
        await sendNotification();
        throw error;
    }
};


const main = async () => {
    pool = await db.getPool();

    let AllReferenceID = [];
    let sql, args, results, apiResults, taskGroupId;

    /* Cleanup and delete old backfill stock take tasks before we generate new ones
     * Delete tasks/task groups if they pass the due date of their associated backfill */
    sql = `
        SELECT
            its.ID,
            checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat) AS RunToday,
            # Get the "minute-of-day" for this schedule, and for the current time
            # Getting the time the job will end, with a 1 hour buffer for backfill task creation
            its.Hour * 60 + its.Minute + its.MinsToComplete + 60 AS TimeJobEnds,
            (
                HOUR(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) * 60 +
                MINUTE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone))
            ) AS TimeNow
        FROM inventory_take_schedule its
        INNER JOIN store_backfill_schedule sbs ON sbs.ID = its.BackfillScheduleID
        INNER JOIN location loc ON loc.ID = sbs.LocationID
        WHERE
            its.Type = 'Manual'
            AND sbs.IsEnabled = 1
        HAVING
            RunToday = 1
            AND TimeNow > TimeJobEnds`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        return;
    }

    AllReferenceID = results.map((obj) => obj["ID"]);

    if (AllReferenceID.length) {
        args = [AllReferenceID, AllReferenceID];
        sql = `
            DELETE FROM task_group WHERE Type = 'BackfillCount' AND ReferenceID IN (?)
            ;
            DELETE FROM task WHERE Type = 'BackfillCount' AND ReferenceID IN (?)`;

        try {
            await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            return;
        }
    }

    // Get all of the containers that we should create stock take tasks for at this current point in time
    sql = `
        SELECT
            its.ID AS InventoryTakeScheduleID,
            its.BackfillScheduleID,
            its.Type,
            its.Hour,
            its.Minute,
            its.ContainerID,
            sbs.LocationID,
            checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat) AS RunToday,
            loc.Timezone,
            DATE_FORMAT(DATE_ADD(NOW(), INTERVAL its.MinsToComplete MINUTE),'%Y-%m-%d %H:00:00') as dueDate,
            # Get the "minute-of-day" for the schedules, and for the current time -1 minute, and for +LAMBDA_INTERVAL minutes in the future
            its.Hour * 60 + its.Minute AS TimeJob,
            its.Hour * 60 + its.Minute + its.MinsToComplete AS TimeJobEnds,
            (
                HOUR(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) * 60 +
                MINUTE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone))
            ) AS TimeNow,
            tg.ID
        FROM inventory_take_schedule its
        INNER JOIN store_backfill_schedule sbs ON sbs.ID = its.BackfillScheduleID
        INNER JOIN location loc ON loc.ID = sbs.LocationID
        LEFT JOIN task_group tg ON tg.ReferenceID = its.ID AND tg.Type = 'BackfillCount'
        WHERE
            its.Type = 'Manual'
            AND sbs.IsEnabled = 1
            AND tg.ID IS NULL
        HAVING
            RunToday = 1
            AND TimeNow > TimeJob
            AND TimeJobEnds > TimeNow`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        return;
    }

    if (results.length === 0) {
        return; // There are no backfills scheduled for this time
    }

    /* Create one task group (with one task each) for each ContainerID provided in the manual count schedule
     * Unlike most other types of tasks, each task for a handheld stock take will get its own task group */
    for (let row of results) {
        let body, taskResults;
        let id = row.InventoryTakeScheduleID;
        let storeId = row.LocationID;
        let containerId = row.ContainerID;
        let dueDate = row.dueDate;

        try {
            body = {
                source_location: storeId,
                target_location: containerId,
                due_date: dueDate,
                priority: "Standard",
                type: "BackfillCount",
                reference_id: id
            };

            apiResults = await wmsAPI.Post(`taskgroup/create/`, body);
            taskGroupId = apiResults.data;
        } catch (error) {
            console.log(error);
            return;
        }

        /* We're unable to do an wmsAPI.Post() here and must INSERT tasks directly
         * because the API won't allow us to create a task without a keycode or barcode,
         * and we aren't creating tasks with keycodes or barcodes in this case */
        sql = `INSERT INTO task (TaskGroupID, SourceContainer, TargetContainer, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)`;
        args = [
            taskGroupId,     // TaskGroupID
            storeId,         // SourceContainer
            containerId,     // TargetContainer
            "BackfillCount", // Type
            id               // ReferenceID
        ];

        try {
            [taskResults] = await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            return;
        }
    }
};

const sendNotification = async () => {
    try {
        let slackMessage = `* Create Backfill Count Tasks *\n`;
        slackMessage += `:x: Failed: There was an error Creating Backfill Count Tasks in environment ${process.env.NODE_ENV}`;
        await axios.post(SLACK_ERRORS, {text: slackMessage});
    } catch (error) {
        logger.info('Failed to post Error message to Slack', {error});
        throw error;
    }
};

