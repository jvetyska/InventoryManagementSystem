const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('process-tory-webhook-data'); 

let slackURL, config;
/* This lambda is trigger by SQS, Incoming event body example
    {
        "runName":"tory3",
        "status": "RunDataReady",
        "inventoryBotID": 1
    }
*/

exports.handler = async (event) => {
    let status, inventoryBotID, runName;
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        slackURL = config.slackHookErrors;
        let body = JSON.parse(event["Records"][0]["body"]);
        console.log(body);

        if (!Object.prototype.hasOwnProperty.call(body, "runName") 
            || !Object.prototype.hasOwnProperty.call(body, "status")
            || !Object.prototype.hasOwnProperty.call(body, "inventoryBotID")) {
            throw new Error(`Missing RunName, Status or InventoryBotID`);
        }
        status = body.status;
        runName = body.runName;
        inventoryBotID = body.inventoryBotID;

        console.log(`Calling WMS process_status API for ${inventoryBotID}, inventory name ${runName} and status ${status}`);
        await wmsAPI.Post(`inventory_bot/${inventoryBotID}/process_status`, {runName, status});

    } catch (error) {
        console.log("ERROR: ",error);
        let logString = ":no_entry: `tory-run-status-webhook`\n";
        logString += `ENV: ${process.env.NODE_ENV} Failed to call status change to ${status} on inventory bot ${inventoryBotID}`;
        await axios.post(slackURL, {"text": logString});
    }

    return {
        "statusCode": 200
    };
};
