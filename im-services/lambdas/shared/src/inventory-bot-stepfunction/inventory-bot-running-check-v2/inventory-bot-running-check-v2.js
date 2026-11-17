const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const logger = require("/opt/nodejs/logger.js")("state-machine:inventory-bot-schedule-check"); 
const errorMotorStatuses = ["EmergencyStop", "Error"];
const cannotReachStatus = "CannotReach";

let config;
exports.handler = async (event) => {
    logger.startTrace("handler");
    try {
        await main(event);
    } catch (error) {
        logger.error(error, "handler");
        return {
            "statusCode": 500
        };
    }
    logger.endTrace("handler");
    return {
        "statusCode": 200
    };
};

async function main(event) {
    logger.startTrace("main");
    let sql, results, apiResults;

    const pool = await wmsDB.getPool();
    config = await getConfig.getConfig(process.env.NODE_ENV);
    sql = `
        SELECT
            ib.ID AS InventoryBotID,
            bp.Status,
            bp.RunName
        FROM bot_process bp
        INNER JOIN inventory_bot ib ON bp.InventoryBotID = ib.ID
        WHERE bp.Status NOT IN ('RunDataReady', 'Interrupted', 'Error')
            AND bp.Map = ib.DefaultMap
            AND bp.RunName IS NOT NULL`;

    try {
        logger.trace("main:pool:query");
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error(error, "main:pool:query");
        throw error;
    }

    for (let result of results) {
        let inventoryBotID = result.InventoryBotID;
        let botProcessName = result.RunName;
        let oldStatus = result.Status;
        let runningStatus;
        let motorStatus;

        try {
            logger.trace("main:wms:api:inventoryBot:status");
            apiResults = await wmsAPI.Get(`inventory_bot/${inventoryBotID}/status`);
            if (apiResults) {
                runningStatus = apiResults.Status;
                motorStatus = apiResults.MotorStatus;

                if (apiResults.ActiveRunName) {
                    botProcessName = apiResults.ActiveRunName;
                }
            } else {
                runningStatus = cannotReachStatus;
            }
        } catch (error) {
            runningStatus = cannotReachStatus;
            logger.error(error, "main:wms:api:inventoryBot:status");
        }

        if (runningStatus === cannotReachStatus) {
            try {
                await updateProcessStatus(inventoryBotID, botProcessName, runningStatus);
            } catch (error) {
                logger.error(error, "main:updateProcessStatus");
            }

            continue;
        }

        // Check to see if the InventoryBot has finished the inventory run
        try {
            apiResults = await wmsAPI.Get(`inventory_bot/${inventoryBotID}/bot_process?name=${botProcessName}`);
        } catch (error) {
            logger.error(error, "main:wms:api:inventoryBot:botProcess");
            continue;
        }

        if (apiResults && apiResults.Name) {
            // If this run's map is not available yet, don't update process status yet.
            if (!apiResults.EvaluationMapAvailable) {
                logger.info(`Skipping inventory bot ${inventoryBotID} since its Run Evaluation Map is not ready yet`, "main");
                continue;
            }

            if (apiResults.InterruptRunReason) {
                // If there is an InterruptRunReason, then this run was Interrupted
                runningStatus = "Interrupted";
            } else {
                // If the name exists in the results then that means the run is done and RunData is ready
                runningStatus = "RunDataReady";
            }
        } else if (errorMotorStatuses.includes(motorStatus)) {
            runningStatus = motorStatus;
        }

        // By this point there is a Run, if the new status is Idle, update the run to Interrupted
        if (runningStatus === "Idle") {
            runningStatus = "Interrupted";
        }

        // If the status didn't change, continue and do nothing
        if (runningStatus === oldStatus) {
            logger.info(`Skipping inventory bot ${inventoryBotID} since its status has not changed from ${oldStatus}`, "main");
            continue;
        }

        try {
            await updateProcessStatus(inventoryBotID, botProcessName, runningStatus);
        } catch (error) {
            logger.error(error, "main");
            continue;
        }
    }
}

async function updateProcessStatus(inventoryBotID, runName, status) {
    logger.startTrace("updateProcessStatus");
    let sqsUrl;
    if (config.tory_webhook_data_sqs) {
        sqsUrl = config.tory_webhook_data_sqs;
    } else {
        logger.info(`No SQS setup to process tory status`);
        return;
    }
    let data = {
        status,
        inventoryBotID,
        runName
    };
    try {
        await awsApiHelper.sendSqsMessage(sqsUrl, data);
    } catch (error) {
        logger.error(`Error while sending SQS message to do tory data processing for Bot: ${inventoryBotID} 
            for runName: ${runName} with status: ${status}`, "updateProcessStatus:sendMessage", error);
    }
    logger.endTrace("updateProcessStatus");
}
