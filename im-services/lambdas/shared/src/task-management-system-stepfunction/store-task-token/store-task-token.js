const db = require("/opt/nodejs/wmsDB.js");
const { AWS } = require("/opt/nodejs/xray.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require('/opt/nodejs/logger')('task-management-system-stepfunction:store-task-token');
let pool;

exports.handler = async (event) => {
    logger.startTrace('handler');
    try {
        logger.trace('handler:db.getPool');
        pool = await db.getPool();
        logger.trace('handler:main');
        await main(event);
    } catch (error) {
        logger.error(error, 'handler');
        await failExecution(event.TaskToken);
        throw error;
    }
    logger.endTrace('handler');
};

async function main (event) {
    logger.startTrace('main');
    let sql, args;
    let status, backfillScheduleID, stepFunctionName, taskToken;

    taskToken = event.TaskToken;
    status = event.status;
    stepFunctionName = event.executionID.match(/StepFunction\:(.*)/)[1];
    backfillScheduleID = event.Input.backfillScheduleID;

    sql = `
        INSERT INTO task_management_system (Name, BackfillScheduleID, Status, TaskToken)
        VALUES (?)
        ON DUPLICATE KEY UPDATE
            Status = VALUES(Status),
            TaskToken = VALUES(TaskToken);`;
    args = [[stepFunctionName, backfillScheduleID, status, taskToken]];

    try {
        logger.trace('main:pool.query');
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'main.pool.query');
        throw error;
    }
    logger.endTrace('main');
}

async function failExecution (taskToken) {
    logger.startTrace('failExecution');    
    const params = {
        "taskToken": taskToken
    };
    logger.trace('failExecution:stepfunctions.sendTaskFailure');
    await stepfunctions.sendTaskFailure(params).promise();
}
