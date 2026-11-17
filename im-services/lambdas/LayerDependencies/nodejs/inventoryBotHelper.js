const { axios, https } = require("./xray");
const wmsApi = require("./wmsAPI.js");
const config = require("./config.js");
const wmsDB = require("./wmsDB.js");
const helper = require("./helper.js");
const logger = require("./logger")("inventoryBotHelper");

async function Main(uri, type, data, options = {}) {
    logger.startTrace("Main");
    let result;
    const settings = await helper.getSettings();
    // Axios time out is in milliseconds
    const defaultTimeout = settings.inventoryBot.defaultTimeoutForToryApis;
    const configuration = await config.getConfig(process.env.NODE_ENV);
    // If this environment uses an ngrok tunnel for inventory bots, add the basic auth
    if (configuration.ngrok_tunnel_username) {
        options["auth"] = {
            "username": configuration.ngrok_tunnel_username,
            "password": configuration.ngrok_tunnel_password
        };
    }

    const agent = new https.Agent({
        rejectUnauthorized: false
    });
    options["httpsAgent"] = agent;

    // Add a default timeout if it is not already set
    if (!options["timeout"]) {
        options["timeout"] = defaultTimeout;
    }

    let source = axios.CancelToken.source();
    setTimeout(() => {
        source.cancel();
    }, options["timeout"]);

    options["cancelToken"] = source.token;

    // GET and DELETE use params
    if (type == "GET" || type == "DELETE") {
        options["params"] = data;
    } else if (type == "PUT" || type == "POST") {
        options["headers"] = {
            "Content-Type": "application/x-www-form-urlencoded"
        };

    }

    try {
        logger.trace(`main:tory:api:${uri}`);
        switch (type) {
        case "GET":
            result = await axios.get(uri, options);
            break;
        case "POST":
            result = await axios.post(uri, data, options);
            
            break;
        case "PUT":
            result = await axios.put(uri, data, options);
            break;
        case "DELETE":
            result = await axios.delete(uri, options);
            break;
        default:
            console.log("ERROR: Not supported HTTP command", type);
            return;
        }
    } catch (error) {
        // When developing on your local machine, an unhandled error will occur for 127.0.0.1
        if (error.address === "127.0.0.1") {
            return;
        }
        let statusCode;
        if (error.response) {
            statusCode = error.response.status;
        }
        let errorMessage = `ERROR with HTTP code ${statusCode} on URL ${uri}: `;

        if (statusCode == 502) {
            errorMessage += "Unable to connect to the inventory robot. Please try again later or contact your system administrator.";
        } else if (statusCode == 403) {
            errorMessage += "Requested operation is not possible at this time";
        } else if (statusCode == 400) {
            errorMessage += "Requested resource not found";
        } else {
            errorMessage += `Unknown error: ${error.message}`;
        }
        logger.error(errorMessage, "main:tory:api", error);
        throw new Error(errorMessage);
    }
    logger.endTrace("Main");
    return result.data;
}

async function reportInventoryBotError(inventoryBotID, errorMessage) {
    logger.startTrace("reportInventoryBotError");
    try {
        const configuration = await config.getConfig(process.env.NODE_ENV);
        const uri = configuration.slackHookInventoryBotErrors;
        const botInfo = await getInventoryBotInfo(inventoryBotID);
        const locationID = botInfo.LocationID;
        const inventoryBotName = botInfo.Name;

        let logString = ":no_entry: `inventory-bot-report-error`\n";
        logString += `Inventory Bot ${inventoryBotID} with Name ${inventoryBotName} at Location ${locationID}\n${errorMessage}`;

        logger.trace("reportInventoryBotError");
        await axios.post(uri,  {"text": logString});
    } catch (error) {
        logger.error(error, "reportInventoryBotError");
    }
    logger.endTrace("reportInventoryBotError");
}

async function createInterruptedNotification(inventoryBotID, inventoryName) {
    logger.startTrace("createInterruptedNotification");
    let sql, args, results, inventoryBotName, locationID;

    sql = `SELECT Name, LocationID FROM inventory_bot WHERE ID = ?`;
    args = [inventoryBotID];

    try {
        logger.trace("createInterruptedNotification:pool:query:inventoryBot");
        let pool = await wmsDB.getPool();
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "createInterruptedNotification:pool:query:inventoryBot");
        return;
    }

    if (!results.length) {
        logger.info(`createInterruptedNotification could not find bot data for Inventory Bot ${inventoryBotID}`);
        return;
    }
    results = results[0];
    inventoryBotName = results.Name;
    locationID = results.LocationID;


    const title = `Inventory Bot ${inventoryBotName} was Interrupted for Run ${inventoryName}.
        Action: Please check Run Map in Team Connector to investigate reason for failure`;
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
        logger.trace("createInterruptedNotification:WMS:API:note");
        await wmsApi.Post(`/note`, body);
    } catch (error) {
        logger.error(`Failed to create notification for bot ${inventoryBotID}`, "createInterruptedNotification", error);
        return;
    }
    logger.endTrace("createInterruptedNotification");
}

async function getInventoryBotInfo(inventoryBotID) {
    logger.startTrace("getInventoryBotInfo");
    let sql, args, results;
    sql = `SELECT IPAddress, DefaultMap, MapID, Name, LocationID FROM inventory_bot WHERE ID = ?`;
    args = [inventoryBotID];

    try {
        logger.trace("getInventoryBotInfo:pool:query:getBotInformation");
        let pool = await wmsDB.getPool();
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error(error, "getInventoryBotInfo:pool:query:getBotInformation");
        throw new Error(`Error finding Inventory Bot ${inventoryBotID} data.`);
    }

    if (!results.length) {
        logger.error(`Inventory Bot ${inventoryBotID} not found.`, "getInventoryBotInfo:pool:query:getBotInformation");
        throw new Error(`Inventory Bot ${inventoryBotID} not found.`);
    }
    logger.endTrace("getInventoryBotInfo");
    return results[0];
}


exports.get    = async function (uri, params, options) {return await Main(uri, "GET"   , params, options);};
exports.post   = async function (uri, body, options)   {return await Main(uri, "POST"  , body  , options);};
exports.put    = async function (uri, body, options)   {return await Main(uri, "PUT"   , body  , options);};
exports.delete = async function (uri, params, options) {return await Main(uri, "DELETE", params, options);};
exports.reportInventoryBotError = reportInventoryBotError;
exports.createInterruptedNotification = createInterruptedNotification;
exports.getInventoryBotInfo = getInventoryBotInfo;
