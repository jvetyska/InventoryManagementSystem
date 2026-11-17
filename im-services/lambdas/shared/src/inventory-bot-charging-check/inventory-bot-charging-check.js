const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const wmsDB = require("/opt/nodejs/wmsDB.js");
const { axios } = require("/opt/nodejs/xray.js");
const getConfig = require("/opt/nodejs/config.js");
const logger = require('/opt/nodejs/logger.js')('inventory-bot-charging-check'); 

let pool, inventoryBotErrorURL, SLACK_ERRORS, config;

// ChargingStatus vars
const chargingStatus = "Charging";
const notChargingStatus = "Not Charging";
const runningStatus = "Running";
const notChargingNoticationSent = "Not Charging Notification Sent";

// Running statuses which will make us set ChargingStatus to Running
const validRunningStatuses = ["Initialization", "Running", "Finished"];

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        SLACK_ERRORS = config.slackHookErrors;
        inventoryBotErrorURL = config.inventory_bot_error_api;
        await main(event);
    } catch (error) {
        console.log(error);

        let message = ":no_entry: ERROR: inventory-bot-charging-check\n";
        message += `Error while checking if inventory bots are charging in environment ${process.env.NODE_ENV}`;
        await axios.post(SLACK_ERRORS, {text: message});

        return {
            "statusCode": 500
        };
    }

    return {
        "statusCode": 200
    };
};

async function main() {
    let sql, results, apiResults;

    pool = await wmsDB.getPool();

    sql = ` SELECT * FROM inventory_bot `;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw error;
    }

    for (let result of results) {
        let inventoryBotID = result.ID;
        let oldChargingStatus = result.ChargingStatus;

        let isCharging;
        let runtimeStatus;
        let newChargingStatus;

        try {
            apiResults = await wmsAPI.Get(`inventory_bot/${inventoryBotID}/status`);

            // If the API doesn't return or if there is an error, this lambda can just ignore the error
            if (!apiResults) {
                continue;
            }

            isCharging = apiResults.IsCharging;
            runtimeStatus = apiResults.RuntimeStatus;
        } catch (error) {
            continue;
        }

        // Figure out what the new ChargingStatus is
        // The progression would be Charging -> Not Charging -> Not Charging Notication Sent
        // This means this lambda has to detect the bot not charging twice before the notifcation is sent
        // Then, the ChargingStatus would stay on Not Charging Notication Sent to avoid sending the notification multiple times
        if (isCharging) {
            newChargingStatus = chargingStatus;
        } else {
            // If the bot is docking or running, we will set ChargingStatus to Running
            if (validRunningStatuses.includes(runtimeStatus)) {
                newChargingStatus = runningStatus;
            } else if (oldChargingStatus === notChargingStatus) {
                await _sendNotChargingNotification(inventoryBotID);

                let errorMessage = "Inventory Bot is not charging when it should be.\n";
                await _reportInventoryBotError(inventoryBotID, errorMessage);

                newChargingStatus = notChargingNoticationSent;
            } else if (oldChargingStatus === notChargingNoticationSent) {
                newChargingStatus = notChargingNoticationSent;
            } else {
                newChargingStatus = notChargingStatus;
            }
        }

        if (oldChargingStatus !== newChargingStatus) {
            await _updateChargingStatus(inventoryBotID, newChargingStatus);
        }
    }
}

async function _updateChargingStatus(inventoryBotID, status) {
    let sql, args;

    sql = `
        UPDATE inventory_bot
        SET ChargingStatus = ?
        WHERE ID = ?`;
    args = [status, inventoryBotID];

    try {
        console.log(`Updating ChargingStatus for bot ${inventoryBotID} to ${status}`);
        await pool.query(sql, args);
    } catch (error) {
        console.log(`ERROR: _updateChargingStatus failed to update ChargingStatus for Inventory Bot ${inventoryBotID}`);
        throw error;
    }
}

async function _sendNotChargingNotification(inventoryBotID) {
    let sql, args, results, inventoryBotName, locationID;

    console.log(`Sending Not Charging Notification for Inventory Bot ${inventoryBotID}`);

    sql = `SELECT Name, LocationID FROM inventory_bot WHERE ID = ?`;
    args = [inventoryBotID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(`ERROR: _sendNotChargingNotification failed to get bot data for Inventory Bot ${inventoryBotID}`);
        throw error;
    }

    if (!results.length) {
        console.log(`ERROR: _sendNotChargingNotification could not find bot data for Inventory Bot ${inventoryBotID}`);
        throw Error(`Inventory Bot ${inventoryBotID} not found in DB`);
    }
    results = results[0];
    inventoryBotName = results.Name;
    locationID = results.LocationID;

    const title = `Inventory Bot ${inventoryBotName} is not Charging. Action: Locate Tory and push it back to the charging station`;
    const roleName = ["s_manager", "s_bot_mng"];
    const type = "InventoryBot";
    const mustRead = false;

    try {
        const body = {
            "title": title,
            "roleName": roleName,
            // This param expects an array of locationIDs
            "locationID": [locationID],
            "type": type,
            "link": "/dashboard",
            "mustRead": mustRead
        };

        await wmsAPI.Post(`/note`, body);
    } catch (error) {
        console.log(`ERROR: _sendNotChargingNotification failed to create notification for bot ${inventoryBotID}`);
        throw error;
    }
}

async function _reportInventoryBotError(inventoryBotID, errorMessage) {
    try {
        const body  = {
            "InventoryBotID": inventoryBotID,
            "ErrorMessage": errorMessage
        };

        console.log(errorMessage);
        await axios.post(inventoryBotErrorURL, body);
    } catch (error) {
        console.log(error);
    }
}