const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const wmsDB = require("/opt/nodejs/wmsDB.js");
const { axios } = require("/opt/nodejs/xray.js");
const getConfig = require("/opt/nodejs/config.js");
const logger = require('/opt/nodejs/logger.js')('tory-run-status-webhook'); 
let slackURL, config;
// This lambda is used for two webhooks on TORY, RunStatus and RunCompleted
//
// Webhook event example object for RunStatus
// {
//     "Status": "Finished",
//     "Inventory": "2020-07-06_04-00-02",
//     "RobotName": "TORY-Demo"
// }
//
// Webhook event example object for RunCompleted
// {
//     "Finished": true,
//     "Inventory": "2020-07-06_04-00-02",
//     "RobotName": "TORY-Demo"
// }

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        slackURL = config.slackHookErrors;
        logger.info('Success');
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
    let sql, args, results, inventoryBotID;
    const RunFinishedStatus = "RunDataReady";
    const pool = await wmsDB.getPool();

    let webhookEventBody = event.body;
    if (!event.body.RobotName) {
        webhookEventBody = JSON.parse(event.body);
    }

    let inventoryRunName = webhookEventBody.Inventory;
    let status = webhookEventBody.Status;
    let robotName = webhookEventBody.RobotName;

    // Sometimes an Idle event is called without an inventory run name
    // We don't need to update anything for these events
    if (!inventoryRunName || status === "Idle") {
        return;
    }

    sql = `SELECT ID FROM inventory_bot where Name = ?`;
    args = [robotName];

    try {
        console.log(`Getting inventory bot ID for name ${robotName}`);
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error);
        throw error;
    }

    if (!results.length) {
        console.log(`ERROR: No Inventory bot with name ${robotName}`);
        throw new Error(`ERROR: No Inventory bot with name ${robotName}`);
    }

    inventoryBotID = results[0].ID;

    // If this is coming from the RunFinished webhook, detect and send a status
    if (webhookEventBody.Finished) {
        status = RunFinishedStatus;
    }

    const body = {
        "runName": inventoryRunName,
        "status": status
    };

    try {
        console.log(`Calling WMS process_status API for ${inventoryBotID}, inventory name ${inventoryRunName} and status ${status}`);
        await wmsAPI.Post(`inventory_bot/${inventoryBotID}/process_status`, body);
    } catch (error) {
        let logString = ":no_entry: `tory-run-status-webhook`\n";
        logString += `Failed to call status change to ${body.status} on inventory bot ${inventoryBotID}`;
        await axios.post(slackURL, {"text": logString});
        logger.error(error);

        throw error;
    }
}
