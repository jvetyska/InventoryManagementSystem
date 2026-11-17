const db = require("/opt/nodejs/wmsDB.js");
const { AWS } = require("/opt/nodejs/xray.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require('/opt/nodejs/logger')('task-management-system-stepfunction:task-management-scheduler');

let pool;

// See this for stuff we can get in Step Function
// https://docs.aws.amazon.com/step-functions/latest/dg/input-output-contextobject.html
exports.handler = async () => {
    logger.startTrace('handler');
    try {
        pool = await db.getPool();
        await main();
    } catch (error) {
        logger.error(error, '');

        throw error;
    }
    logger.endTrace('handler');
};

async function main() {
    logger.startTrace('main');
    await checkSchedulesStarting();
    await checkStocktakesFinished();
    await checkRFIDExceptionsFinished();
    logger.endTrace('main');
}

async function checkSchedulesStarting() {
    logger.startTrace('checkSchedulesStarting');
    let sql, results;


    sql = `
        SELECT
            sbs.ID AS backfillScheduleID,
            sbs.LocationID,
            IF(sbs.InventoryCheckType = 'system', 1, 0) AS hasExternalInventoryUpdate,
            its.Hour,
            its.Minute,
            # Format Date for Step Function Name
            DATE_FORMAT(CONVERT_TZ(NOW(), 'UTC', loc.Timezone), '%Y-%m-%d') AS localDate,
            CONVERT_TZ(NOW(), 'UTC', loc.Timezone) AS localDateTime,
            CAST(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS DATETIME) + INTERVAL its.Hour HOUR + INTERVAL its.Minute MINUTE AS scheduleTime
        FROM inventory_take_schedule its
        INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleId = sbs.ID
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        # JOIN tms to check to see if we have already started a step function invocation for this schedule today
        LEFT JOIN task_management_system tms ON sbs.ID = tms.BackfillScheduleID
            AND DATE(CONVERT_TZ(tms.DateCreated, 'UTC', loc.Timezone)) = DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone))
        WHERE
            sbs.IsEnabled = 1
            AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)
            # If tms joined, means step function has already been started for this schedule today so filter the row
            AND tms.Name IS NULL
        GROUP BY sbs.ID
        # Make sure it is past the start time of the schedule
        HAVING localDateTime > scheduleTime`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error(error, '');
        throw error;
    }
    logger.info('Results', 'checkSchedulesStarting', {results});
    for (let result of results) {
        const backfillScheduleID = result["backfillScheduleID"];
        const locationID = result["LocationID"];
        const hasExternalInventoryUpdate = result["hasExternalInventoryUpdate"] == true;
        const localDate = result["localDate"];
        const executionName = `Schedule_${locationID}_${backfillScheduleID}_${localDate}`;

        await startExecution(executionName, backfillScheduleID, hasExternalInventoryUpdate);
    }
    logger.endTrace('checkSchedulesStarting');
}

async function checkStocktakesFinished() {
    logger.startTrace('checkStocktakesFinished');
    let sql, args, results;

    sql = `
        SELECT
            tms.Name,
            tms.TaskToken,
            tms.BackfillScheduleID,
            sbs.InventoryCheckType,
            IF(COUNT(DISTINCT its.ID) = SUM(IF(tg.ID IS NOT NULL OR bph.ID IS NOT NULL, 1, 0)), 1, 0)
                AS wereStocktakesCompleted,
            # Getting Backfill generation duedate with 1 hour buffer
            CONVERT(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), DATETIME)
                + INTERVAL (sbs.Hour + 1) HOUR + INTERVAL sbs.Minute MINUTE AS dueDate,
            CONVERT_TZ(NOW(), 'UTC', loc.Timezone) AS localDateTime
        FROM task_management_system tms
        INNER JOIN store_backfill_schedule sbs ON tms.BackfillScheduleID = sbs.ID
        INNER JOIN inventory_take_schedule its ON sbs.ID = its.BackfillScheduleID
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        LEFT JOIN task_group tg ON
            tg.ReferenceID = its.ID
            AND tg.Type = 'BackfillCount'
            AND tg.DateCreated > NOW() - INTERVAL 12 HOUR
            AND tg.DateCompleted IS NOT NULL
        LEFT JOIN (
            SELECT
                bph.ID,
                bph.InventoryTakeScheduleID
            FROM bot_process_history bph
            WHERE
                bph.Status = 'RunDataReady'
                AND bph.isRunAccepted = 1
                AND bph.DateCreated > NOW() - INTERVAL 12 HOUR
            GROUP by bph.InventoryTakeScheduleID
        ) bph ON bph.InventoryTakeScheduleID = its.ID
        WHERE
            tms.Status = 'WaitingForStocktakes'
            AND tms.DateCreated > NOW() - INTERVAL 12 HOUR
        GROUP BY tms.Name
        HAVING wereStocktakesCompleted = 1 OR localDateTime > dueDate;`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error(error, '');
        throw error;
    }
    logger.info('Results', 'checkStocktakesFinished', {results});
    if (!results.length) {
        return;
    }

    let executionsResumed = [];
    let executionsPastDueDate = [];
    let executionsFailed = [];

    for (let result of results) {
        const backfillScheduleID = result["BackfillScheduleID"];
        const executionName = result["Name"];
        const taskToken = result["TaskToken"];
        const wereStocktakesCompleted = result["wereStocktakesCompleted"];
        const inventoryCheckType = result["InventoryCheckType"];

        // If the stocktakes were completed, try to resume them
        // Otherwise we will update the execution as being failed since it is passed its DueDate
        if (wereStocktakesCompleted) {
            const input = {
                "backfillScheduleID": backfillScheduleID,
                "rfidExceptionType": inventoryCheckType
            };

            try {
                await resumeExecution(taskToken, input, executionName);
                executionsResumed.push(executionName);
            } catch (error) {
                logger.error(error, '');
                executionsFailed.push(executionName);
            }
        } else {
            try {
                await failExecution(taskToken, executionName);
                executionsPastDueDate.push(executionName);
            } catch (error) {
                logger.error(error, '');
                executionsFailed.push(executionName);
            }

        }
    }

    sql = "";
    args = [];
    logger.info('executionsResumed', 'checkStocktakesFinished', {executionsResumed});
    if (executionsResumed.length) {
        sql += `
            UPDATE task_management_system
            SET Status = 'StocktakesFinished'
            WHERE Name IN (?)
            ;`;
        args.push(executionsResumed);
    }
    logger.info('executionsFailed', 'checkStocktakesFinished', {executionsFailed});
    if (executionsFailed.length) {
        sql += `
            UPDATE task_management_system
            SET Status = 'Error'
            WHERE Name IN (?)
            ;`;
        args.push(executionsFailed);
    }
    logger.info('executionsPastDueDate', 'checkStocktakesFinished', {executionsPastDueDate});
    if (executionsPastDueDate.length) {
        sql += `
            UPDATE task_management_system
            SET Status = 'StocktakesNeverFinished'
            WHERE Name IN (?)
            ;`;
        args.push(executionsPastDueDate);
    }

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '');
        throw error;
    }
    logger.endTrace('checkStocktakesFinished');
}

async function checkRFIDExceptionsFinished() {
    logger.startTrace('checkRFIDExceptionsFinished');
    let sql, args, results;

    sql = `
        SELECT
            tms.Name,
            tms.TaskToken,
            tms.BackfillScheduleID,
            sbs.ID AS BackfillScheduleID,
            count(t.ID) as NotCompletedTasks,
            IF(MAX(tg.DateDue) < NOW(), 1, 0) AS PastDue
        FROM task_management_system tms
        INNER JOIN store_backfill_schedule sbs ON tms.BackfillScheduleID = sbs.ID
        INNER JOIN location loc ON loc.ID = sbs.LocationID
        # Join task groups which are not fulfilled in this task_group
        INNER JOIN task_group tg ON tg.ReferenceID = sbs.ID AND tg.DateFulfilled IS NULL AND tg.Type = 'Inventory'
        # Join task table to get any task which is not completed
        LEFT JOIN task t on t.TaskGroupID = tg.ID AND t.DateCompleted IS NULL
        WHERE
            # It's a currently-enabled "system" type that hasn't been fulfilled yet
            tms.Status = 'WaitingForRFIDExceptionTasks'
            # Only consider recent runs with a buffer to be extra sure we aren't updating day old runs
            AND tms.DateUpdated > NOW() - INTERVAL (sbs.HoursToComplete + 2) HOUR
        GROUP BY tms.Name
        HAVING NotCompletedTasks = 0
        OR PastDue = 1
        ;`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error(error, '');
        throw error;
    }
    logger.info('Result', 'checkRFIDExceptionsFinished', {results});
    if (!results.length) {
        return;
    }

    let executionsResumed = [];
    let executionsFailed = [];

    for (let result of results) {
        const backfillScheduleID = result["BackfillScheduleID"];
        const executionName = result["Name"];
        const taskToken = result["TaskToken"];

        const input = {
            "backfillScheduleID": backfillScheduleID
        };

        try {
            await resumeExecution(taskToken, input, executionName);
            executionsResumed.push(executionName);
        } catch (error) {
            logger.error(error, '');
            executionsFailed.push(executionName);
        }
    }

    sql = "";
    args = [];
    logger.info('executionsResumed', 'checkRFIDExceptionsFinished', {executionsResumed});
    if (executionsResumed.length) {
        sql += `
            UPDATE task_management_system
            SET Status = 'RFIDExceptionsFinished'
            WHERE Name IN (?)
            ;`;
        args.push(executionsResumed);
    }
    logger.info('executionsFailed', 'checkRFIDExceptionsFinished', {executionsFailed});
    if (executionsFailed.length) {
        sql += `
            UPDATE task_management_system
            SET Status = 'Error'
            WHERE Name IN (?)
            ;`;
        args.push(executionsFailed);
    }

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, '');
        throw error;
    }
    logger.endTrace('checkRFIDExceptionsFinished');
}

async function startExecution(executionName, backfillScheduleID, hasExternalInventoryUpdate = false) {
    logger.startTrace('startExecution');
    const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;
    const input = {
        "backfillScheduleID": backfillScheduleID,
        "hasExternalInventoryUpdate": hasExternalInventoryUpdate
    };

    const params = {
        stateMachineArn: STEP_FUNCTION_ARN,
        name: executionName,
        input: JSON.stringify(input)
    };

    logger.trace('startExecution:stepfunctions.startExecution', {executionName});
    await stepfunctions.startExecution(params).promise();
    logger.endTrace('startExecution');
}

async function resumeExecution(taskToken, input, executionName) {
    logger.startTrace('resumeExecution');
    const params = {
        "taskToken": taskToken,
        "output": JSON.stringify(input)
    };

    logger.trace('resumeExecution:stepfunctions.sendTaskSuccess', {executionName});
    await stepfunctions.sendTaskSuccess(params).promise();
    logger.endTrace('resumeExecution');
}

async function failExecution(taskToken, executionName) {
    logger.startTrace('failExecution');
    const params = {
        "taskToken": taskToken
    };

    logger.trace('resumeExecution:stepfunctions.sendTaskFailure', {executionName});
    await stepfunctions.sendTaskFailure(params).promise();
    logger.endTrace('failExecution');
}
