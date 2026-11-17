const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { AWS, axios } = require("/opt/nodejs/xray.js");
const inventoryBotAPIHelper = require("/opt/nodejs/inventoryBotHelper.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const helper = require("/opt/nodejs/helper.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require("/opt/nodejs/logger.js")("validate-and-invoke-state-machine"); 

let slackURL, config, pool, settings;
/* This lambda is trigger by SQS, Incoming event body example
    "body": {
        "runName":"tory3",
        "status": "RunDataReady",
        "inventoryBotID": 1,
        "taskConfig":"",
        "isManualRun": false
    }
*/

exports.handler = async (event) => {
    logger.startTrace("handler");
    let input;
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        pool = await wmsDB.getPool();
        settings = await helper.getSettings();
        slackURL = config.slackHookErrors;
        input = event.Records[0].body;

        if (typeof(input) === "string") {
            input = JSON.parse(input);
        }
        logger.info("Input Body", `handler:input`, input);

        if (!input) {
            logger.error("No Input, Ending validate and invoke state Machine Lambda", "handler");
            throw new Error(`validate and invoke state Machine Lambda: Missing Input Body`);
        }

        if (!Object.prototype.hasOwnProperty.call(input, "runName") 
            || !Object.prototype.hasOwnProperty.call(input, "status")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryBotID")
        ) {
            throw new Error(`validate and invoke state Machine Lambda: 
                Missing RunName, Status or InventoryBotID`);
        }

        logger.info(`Validating webhook data for Tory: ${input.inventoryBotID} 
            run: ${input.runName} with status ${input.status}
        `, `handler`);

        await validateInput(input);
    } catch (error) {
        logger.error("EXIT", "handler", {error: error, input: input});
        let logString = ":no_entry: `validate-and-invoke-tory-state-machine`\n";
        logString += `validate-and-invoke-tory-state-machine Lambda failed for Tory: ${input.inventoryBotID}
            with status: ${input.status} and RunName: ${input.runName} in ENV: ${process.env.NODE_ENV}`;
        await axios.post(slackURL, {"text": logString});
    }
    logger.endTrace("handler");
};

const validateInput = async (body) => {
    logger.startTrace("validateInput");
    const { status, runName, inventoryBotID } = body;
    let taskConfig = body.taskConfig || ""; // optional
    let isManualRun = body.isManualRun || false; // optional
    let sql, args, results, apiResults, inventoryBotIP, scanArea, botProcessHistoryID;
    let defaultMap, runQualityPct, EPCsCounted, completedWaypoints, inventoryTakeID, oldStatus, runFailureReason, runDuration;

    logger.info(`Processing for Bot ${inventoryBotID} Run ${runName} to status ${status}`,  "validateInput");

    // Get's inventory bot information as well as check to see if the run already has a row in bot_process_history
    sql = `
        SELECT
            ib.DefaultMap,
            ib.IPAddress,
            bph.ID AS botProcessHistoryID,
            bph.InventoryTakeScheduleID,
            bp.TaskConfig,
            bph.Status
        FROM inventory_bot ib
        LEFT JOIN bot_process bp ON ib.ID = bp.InventoryBotID AND bp.RunName = ?
        LEFT JOIN bot_process_history bph ON ib.ID = bph.InventoryBotID AND bph.Name = ?
        WHERE ib.ID = ?`;
    args = [runName, runName, inventoryBotID];

    try {
        logger.trace("validateInput:pool.query:botAndRunInformation");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "validateInput:pool:query:botAndRunInformation");
        throw new Error(`Error while getting inventory bot and run info
            for Bot: ${inventoryBotID} And Run: ${runName}.`);
    }

    if (!results.length) {
        logger.error(`Inventory Bot with ID ${inventoryBotID} not found`, "validateInput:pool:query:botAndRunInformation");
        throw new Error(`Inventory Bot with ID ${inventoryBotID} not found`);
    }

    results = results[0];
    defaultMap = results.DefaultMap;
    inventoryBotIP = results.IPAddress;
    botProcessHistoryID = results.botProcessHistoryID;
    inventoryTakeID = results.InventoryTakeScheduleID;
    oldStatus = results.Status;

    if (results.TaskConfig) {
        taskConfig = results.TaskConfig;
    }

    // If the old status is the same as the new status, we don't want to update
    // Note that if we update, even with no columns changed, the DateUpdated will still change automatically
    // DateUpdated changing may cause backfill generation to run again which is bad
    if (oldStatus === status) {
        logger.info(`Bot Process status was already set to ${status}
            for Bot: ${inventoryBotID}.`, "validateInput:sameStatus");
        return;
    }

    // If there is no taskConfig and status is Running, that means this is a new run
    // Therefore, try to look up taskConfig from inventory_bot_schedule
    if (!taskConfig || !inventoryTakeID) {
        sql = `
            SELECT
                its.ID AS InventoryTakeID,
                its.InventoryBotArea,
                its.Hour,
                HOUR(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS curHour
            FROM inventory_take_schedule its
            INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleID = sbs.ID
            INNER JOIN inventory_bot ib ON its.InventoryBotID = ib.ID
            INNER JOIN location loc ON ib.LocationID = loc.ID
            WHERE ib.ID = ?
                AND sbs.IsEnabled
                AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)
            HAVING its.Hour BETWEEN curHour - 12 AND curHour
            ORDER BY its.HOUR DESC
            LIMIT 1`;
        args = [inventoryBotID];

        try {
            logger.trace("validateInput:pool.query:getNewRunInformation");
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error(error, "validateInput:pool:query:getNewRunInformation");
            throw new Error(`Error while getting new run information for bot: ${inventoryBotID}`);
        }

        if (results.length) {
            if (!taskConfig) {
                taskConfig = results[0].InventoryBotArea;
            }

            if (!inventoryTakeID) {
                inventoryTakeID = results[0].InventoryTakeID;
            }
        }
    }

    // If the Run Data is ready, we can get run information from the getInventoryInformation API
    if (["RunDataReady", "Interrupted"].includes(status)) {
        try {
            const params = {
                "location": defaultMap,
                "inventory": runName
            };

            const URI = `${inventoryBotIP}/v1/getInventoryInformation`;
            logger.trace("validateInput:inventoryBotAPIHelper:getInventoryInformation");
            apiResults = await inventoryBotAPIHelper.get(URI, params);
        } catch (error) {
            logger.error(error, "validateInput:inventoryBotAPIHelper:getInventoryInformation");
            // Only want to abort run processing if run is supposed to be ready
            if (status === "RunDataReady") {
                logger.info(`Tory Api status: ${status}.`, "validateInput:inventoryBotAPIHelper:getInventoryInformation:RunDataReady");

                const errorMessage = `Unable to get Inventory Information from tory API for run: ${runName} status: ${status}`;
                await inventoryBotAPIHelper.reportInventoryBotError(inventoryBotID, errorMessage);

                throw new Error(`Unable to get inventory information from tory api for Run: ${runName} .`);
            }
        }

        // If getInventoryInformation doesn't return a valid response, just don't include the statistics in the process log
        if (apiResults) {
            // This will only be included if the run failed
            runFailureReason = apiResults.InterruptRunReason;

            if (apiResults.Statistics) {
                scanArea = apiResults.Statistics.ScanArea;
                EPCsCounted = apiResults.Statistics.DistinctTags;
                runDuration = apiResults.Statistics.Duration;

                // Run duration comes in miliseconds so convert to seconds
                if (runDuration) {
                    runDuration = Math.floor(runDuration / 1000);
                }
            }

            if (apiResults.RunQuality) {
                runQualityPct = apiResults.RunQuality.CurrentSuccessRate * 100;
                completedWaypoints = apiResults.RunQuality.ReachedWaypointCounter;
            }

            if (apiResults.TaskScheduleItem) {
                // TaskConfig comes in the following format: KmartMockBOH.tasks.xml
                // Strip out file '.tasks.xml' ending
                taskConfig = apiResults.TaskScheduleItem.TaskConfig;
                taskConfig = taskConfig.replace(/.tasks.xml/, "");
            }
        }
    }

    await checkRunQualityPctAndReportError(status, runQualityPct, inventoryBotID, runName);

    if (!taskConfig) {
        logger.error(`Did not find taskConfig for bot:${inventoryBotID} runName:${runName}`, "validateInput:NoTaskConfig");
        throw new Error(`Unable to get taskConfig for bot:${inventoryBotID} runName:${runName}`);
    }

    let updateBotProcessData = {
        botProcessHistoryID, runName, inventoryBotID, defaultMap, scanArea, taskConfig, status, isManualRun,
        inventoryTakeID, EPCsCounted, runQualityPct, runDuration, runFailureReason, completedWaypoints
    };
    await updateBotProcess(updateBotProcessData);

    /**
     *  We only need to start state machine if the status is Interrupted OR RunDataReady.
     */
    await checkStatusAndStartStateMachine(inventoryBotID, runName, status, taskConfig, defaultMap);

    logger.endTrace("validateInput");
};

const checkRunQualityPctAndReportError =  async (runStatus, runQualityPct, inventoryBotID, runName) => {
    logger.startTrace("checkRunQualityPctAndReportError");
    // If this run is set to RunDataReady and the quality is bad, report the error
    if (runStatus === "RunDataReady" && runQualityPct && (runQualityPct / 100) < settings.inventoryBot.inventoryBotRunQualityThreshold) {
        logger.info(`Tory status: ${runStatus} with runQualityPct: ${runQualityPct}, updating failure reason.`, "validateInput:update_failure_reason");
        await wmsAPI.put(`/inventory_bot/${inventoryBotID}/update_failure_reason`, {
            "RunName": runName,
            "Reason": "Low Run Quality",
            "ReasonType": "Auto"
        });

        let errorMessage = `Inventory Bot Run ${runName} had a low run quality\n`;
        errorMessage += `Run Quality: ${runQualityPct}%`;
        inventoryBotAPIHelper.reportInventoryBotError(inventoryBotID, errorMessage);
    }
    logger.endTrace("checkRunQualityPctAndReportError");
};

const updateBotProcess = async (updateBotProcessData) => {
    logger.startTrace("updateBotProcess");
    let sql = "";
    let args = [];
    let results;
    const { botProcessHistoryID, runName, inventoryBotID, defaultMap, scanArea, taskConfig,
        status, isManualRun, inventoryTakeID, EPCsCounted, runQualityPct, runDuration,
        runFailureReason, completedWaypoints
    } = updateBotProcessData;

    // Insert or update depending on if there is already a row in bot_process_history
    if (!botProcessHistoryID) {
        sql += `INSERT IGNORE INTO bot_process_history (Name, InventoryBotID, Location, ScanArea, TaskConfig, Status, IsManual, InventoryTakeScheduleID, NumTagsRead, RunQualityPct, RunDuration, FailureReason, FailureReasonType)
            VALUES (?);`;
        args.push([runName, inventoryBotID, defaultMap, scanArea, taskConfig, status, isManualRun, inventoryTakeID, EPCsCounted, runQualityPct, runDuration, runFailureReason, "Auto"]);
    } else {
        sql += `
            UPDATE bot_process_history
            SET
                Status = ?,
                ScanArea = ?,
                TaskConfig = ?,
                InventoryTakeScheduleID = ?,
                NumTagsRead = ?,
                RunQualityPct = ?,
                RunDuration = ?,
                FailureReason = ?,
                FailureReasonType = ?
            WHERE Name = ? AND InventoryBotID = ? AND Status != ?;`;
        args.push(status, scanArea, taskConfig, inventoryTakeID, EPCsCounted, runQualityPct, runDuration, runFailureReason, "Auto", runName, inventoryBotID, status);
    }

    sql += `
        INSERT INTO bot_process_status (BotProcessHistoryID, Status, RunQualityPct, CompletedWaypoints, EPCsCounted)
        SELECT bp.ID, ?, ?, ?, ?
        FROM bot_process_history bp
        WHERE
            bp.Name = ? AND
            bp.InventoryBotID = ?
        ;
        UPDATE bot_process
        SET Status = ?, RunName = ?
        WHERE InventoryBotID = ? AND TaskConfig = ? AND Map = ?`;
    args.push(status, runQualityPct, completedWaypoints, EPCsCounted, runName, inventoryBotID, status, runName, inventoryBotID, taskConfig, defaultMap);

    try {
        logger.trace("updateBotProcess:pool.query");
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "updateBotProcess:pool:query");
        throw new Error(`Error while attempting to update process status for Bot:${inventoryBotID} taskConfig: ${taskConfig}.`);
    }

    // ALL Run data processing needs to be done after this to ensure there are not race conidition issues
    if (!results[0].affectedRows) {
        logger.error(`Bot Process status was already set to ${status}
            for Bot:${inventoryBotID} Run: ${runName}.`, "validateInput:processStatusUpdate");
        throw new Error(`Bot Process status was already set to ${status} for Bot:${inventoryBotID} Run: ${runName}.`);
    }

    logger.info(`Finished updating bot_process for Bot ${inventoryBotID} Run ${runName}
        to status ${status}`, "updateBotProcess");
    logger.endTrace("updateBotProcess");
};

const checkStatusAndStartStateMachine = async (inventoryBotID, runName, status, taskConfig, defaultMap) => {
    logger.startTrace("checkStatusAndStartStateMachine");
    let sql, args, results;

    if (["RunDataReady", "Interrupted"].includes(status)) {
        //state machine execution name
        let executionName = `${inventoryBotID}_${runName}_${status}`;

        sql = `
            SELECT * FROM process_tory_data_step_function WHERE ExecutionName = ?
        `;
        args = [executionName];

        try {
            logger.trace("checkStatusAndStartStateMachine:pool.query:getProcessSystem");
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error(error, "checkStatusAndStartStateMachine:getProcessSystem");
            throw new Error(`Error while attempting to decide on starting the state machine 
                for Bot:${inventoryBotID} Run: ${runName}.`);
        }

        // if same execution name exits in table, we can't start step function.
        if (results.length) {
            logger.info(`State Machine with Name: ${inventoryBotID}_${runName}_${status}
                already exits.`, "checkStatusAndStartStateMachine:stateMachineExecutionAlreadyExists");
            return;
        }

        let stateMachineInput = {
            "status": status,
            "inventoryName": runName,
            "inventoryBotID": inventoryBotID,
            "mapAreaName": taskConfig,
            "location": defaultMap,
            "executionName": executionName
        };

        const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;
        await awsApiHelper.startStateMachineExeuction(STEP_FUNCTION_ARN, stateMachineInput, { name: executionName });

        sql = `
            INSERT INTO process_tory_data_step_function(ExecutionName, InventoryBotID, Status) Values (?);
        `;
        args = [[executionName, inventoryBotID, "Running"]];

        try {
            logger.trace("checkStatusAndStartStateMachine:pool.query:updateProcessSystem");
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error(error, "checkStatusAndStartStateMachine:updateProcessSystem");
            throw new Error(`Error while attempting to insert the bot process system 
                for Bot:${inventoryBotID} Run: ${runName}.`);
        }
    }
    logger.endTrace("checkStatusAndStartStateMachine");
};