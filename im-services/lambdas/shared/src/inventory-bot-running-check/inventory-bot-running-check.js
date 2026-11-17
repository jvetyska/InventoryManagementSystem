const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const wmsDB = require("/opt/nodejs/wmsDB.js");
const logger = require('/opt/nodejs/logger.js')('inventory-bot-running-check'); 

const errorMotorStatuses = ["EmergencyStop", "Error"];
const cannotReachStatus = "CannotReach";

exports.handler = async (event) => {
    try {
        await main(event);
    } catch (error) {
        console.log(error);
        return {
            "statusCode": 500
        };
    }

    return {
        "statusCode": 200
    };
};

async function main(event) {
    let sql, results, apiResults;

    const pool = await wmsDB.getPool();

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
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw error;
    }

    for (let result of results) {
        let inventoryBotID = result.InventoryBotID;
        let botProcessName = result.RunName;
        let oldStatus = result.Status;
        let runningStatus;
        let motorStatus;

        try {
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
            console.log(error);
        }

        if (runningStatus === cannotReachStatus) {
            try {
                await updatedProcessStatus(inventoryBotID, botProcessName, runningStatus);
            } catch (error) {
                console.log(error);
            }

            continue;
        }

        // Check to see if the InventoryBot has finished the inventory run
        try {
            apiResults = await wmsAPI.Get(`inventory_bot/${inventoryBotID}/bot_process?name=${botProcessName}`);
        } catch (error) {
            console.log(error);
            continue;
        }

        if (apiResults && apiResults.Name) {
            // If this run's map is not available yet, don't update process status yet.
            if (!apiResults.EvaluationMapAvailable) {
                console.log(`Skipping inventory bot ${inventoryBotID} since its Run Evaluation Map is not ready yet`);
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
            console.log(`Skipping inventory bot ${inventoryBotID} since its status has not changed from ${oldStatus}`);
            continue;
        }

        try {
            await updatedProcessStatus(inventoryBotID, botProcessName, runningStatus);
        } catch (error) {
            console.log(error);
            continue;
        }
    }
}

async function updatedProcessStatus(inventoryBotID, runName, status) {
    const body = {
        "runName": runName,
        "status": status
    };

    try {
        console.log(`Calling WMS process_status API for ${inventoryBotID}, inventory name ${runName} and status ${status}`);
        await wmsAPI.Post(`inventory_bot/${inventoryBotID}/process_status`, body);
    } catch (error) {
        console.log(error);
    }
}
