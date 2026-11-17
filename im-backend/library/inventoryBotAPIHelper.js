const { axios, https } = require("./xray");
const apiRequest = require("./apiRequest");
const ProxyAPIRequester = require("./proxyAPIRequest");
const logger = require("./logger")("library:inventoryBotAPIHelper");

async function Main(uri, type, data, options = {}) {
    let result;
    // Axios time out is in milliseconds
    const defaultTimeout = 60 * 1000;

    // If this environment uses an ngrok tunnel for inventory bots, add the basic auth
    if (config.ngrok_tunnel_username) {
        options["auth"] = {
            "username": config.ngrok_tunnel_username,
            "password": config.ngrok_tunnel_password
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


    // While transitioning this to use proxy service, need to be backwards compatible for a smooth transition
    let useProxyService = true;
    // search returns -1 on not found
    if (uri.search("http") >= 0) {
        useProxyService = false;
    }

    // GET and DELETE use params
    if (type == "GET" || type == "DELETE") {
        options["params"] = data;
    } else if (type == "PUT" || type == "POST") {
        options["headers"] = {
            "Content-Type": "application/x-www-form-urlencoded"
        };

        if (useProxyService) {
            options["data"] = data;
        }
    }

    try {
        switch (type) {
        case "GET":
            if (useProxyService) {
                result = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.GET, ProxyAPIRequester.ENDPOINT_TYPE.TORY, uri, options);
            } else {
                result = await axios.get(uri, options);
            }
            break;
        case "POST":
            if (useProxyService) {
                result = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.POST, ProxyAPIRequester.ENDPOINT_TYPE.TORY, uri, options);
            } else {
                result = await axios.post(uri, data, options);
            }
            break;
        case "PUT":
            if (useProxyService) {
                result = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.PUT, ProxyAPIRequester.ENDPOINT_TYPE.TORY, uri, options);
            } else {
                result = await axios.put(uri, data, options);
            }
            break;
        case "DELETE":
            if (useProxyService) {
                result = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.DELETE, ProxyAPIRequester.ENDPOINT_TYPE.TORY, uri, options);
            } else {
                result = await axios.delete(uri, options);
            }
            break;
        default:
            logger.error("Not supported HTTP command", {type});
            return;
        }
    } catch (error) {
        console.log(uri, error);
        // When developing on your local machine, an unhandled error will occur for 127.0.0.1
        if (error.address === "127.0.0.1") {
            return;
        }
        let statusCode;
        if (useProxyService) {
            statusCode = error.status;
        } else if (error.response) {
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
            errorMessage += "Unknown error";
        }
        throw new Error(errorMessage);
    }

    return result.data;
}

async function reportInventoryBotError(inventoryBotID, errorMessage) {
    try {
        const uri = config.inventory_bot_error_api;
        const body  = {
            "InventoryBotID": inventoryBotID,
            "ErrorMessage": errorMessage
        };

        await axios.post(uri, body);
    } catch (error) {
        console.log(error);
    }
}

async function syncInventoryBotSchedule(req, inventoryBotID, inventoryBotArea) {
    let sql, args, results;

    sql = `
        SELECT
            its.Hour,
            its.Minute,
            IF(IFNULL(its.MinsToComplete, 0) = 0, iba.MaxRunDurationMinutes, its.MinsToComplete) AS MaxRunDurationMinutes,
            sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat, sbs.Sun
        FROM inventory_take_schedule its
        INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleID = sbs.ID
        INNER JOIN inventory_bot_area iba ON its.InventoryBotArea = iba.Area AND its.InventoryBotID = iba.InventoryBotID
        WHERE its.Type = 'InventoryBot'
            AND sbs.IsEnabled
            AND its.InventoryBotID = ?
            AND its.InventoryBotArea = ?`;
    args = [inventoryBotID, inventoryBotArea];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("Backfill _updateInventoryBotSchedule error updating Inventory Bot schedule");
        throw (error);
    }

    // Example schedule array:
    // 0(Sunday) to 6(Saturday)
    // [0:[23:12:00, 4:12:00], 1:[5:10:00, 23:00:00], 2:[23:00:00], 3:[], 4:[], 5:[23], 6:[4:02:00, 23:12:00]]
    let newSchedule = [];

    for (let i = 0; i < 7; i++) {
        newSchedule.push([]);
    }

    for (const result of results) {
        const hour = result.Hour;
        const minute = result.Minute;
        const maxRunDurationMinutes = result.MaxRunDurationMinutes;
        const time = `${hour}:${minute}:00`;

        const dayList = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        // For each day, if the day value from query is true, add the time
        for (const i in dayList) {
            const day = dayList[i];
            if (result[day]) {
                newSchedule[i].push({
                    "time": time,
                    "maxRunDurationMinutes": maxRunDurationMinutes
                });
            }
        }
    }

    try {
        const body = {
            "schedule": newSchedule,
            "taskConfig": inventoryBotArea
        };

        await apiRequest.put(req, `/inventory_bot/${inventoryBotID}/schedule`, body);
    } catch (error) {
        logger.info("Backfill _updateInventoryBotSchedule error updating Inventory Bot schedule");
        throw (error);
    }
}

async function createInterruptedNotification(req, inventoryBotID) {
    let sql, args, results, inventoryBotName, locationID;

    sql = `SELECT Name, LocationID FROM inventory_bot WHERE ID = ?`;
    args = [inventoryBotID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(`ERROR: createInterruptedNotification failed to get bot data for Inventory Bot ${inventoryBotID}`);
        return;
    }

    if (!results.length) {
        console.log(`ERROR: createInterruptedNotification could not find bot data for Inventory Bot ${inventoryBotID}`);
        return;
    }
    results = results[0];
    inventoryBotName = results.Name;
    locationID = results.LocationID;


    const title = `Inventory Bot ${inventoryBotName} was Interrupted. Action: Please check Run Map in Team Connector to investigate reason for failure`;
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

        await apiRequest.post(req, `/note`, body);
    } catch (error) {
        console.log(`ERROR: createInterruptedNotification failed to create notification for bot ${inventoryBotID}`);
        return;
    }
}

exports.get    = async function (uri, params, options) {return await Main(uri, "GET"   , params, options);};
exports.post   = async function (uri, body, options)   {return await Main(uri, "POST"  , body  , options);};
exports.put    = async function (uri, body, options)   {return await Main(uri, "PUT"   , body  , options);};
exports.delete = async function (uri, params, options) {return await Main(uri, "DELETE", params, options);};
exports.reportInventoryBotError = reportInventoryBotError;
exports.syncInventoryBotSchedule = syncInventoryBotSchedule;
exports.createInterruptedNotification = createInterruptedNotification;
