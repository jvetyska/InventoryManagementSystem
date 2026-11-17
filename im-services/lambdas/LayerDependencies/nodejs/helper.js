const { AWS } = require("./xray");
const sqs = new AWS.SQS({apiVersion: "2012-11-05"});
const wmsDB = require("./wmsDB.js");
const defaultSettings = require("./setting.js");
const moment = require("moment-timezone");
const UUID = require("uuid/v4");
const getConfig = require("./config.js");
const logger = require("./logger")("helper");
let documentClient, config;
let locationTimezoneMap = {};


async function InitializeLocationTimezoneMaps() {
    let pool = await wmsDB.getPool();
    let sql = `
        SELECT loc.ID, loc.Timezone
        FROM container c
        INNER JOIN location loc ON loc.ID = c.LocationID`;
    let [results] = await pool.query(sql);

    for (let row of results) {
        let id = row.ID;
        let timezone = row.Timezone;
        let location = id.split("-")[0];
        locationTimezoneMap[location] = {
            timezone: timezone,
            location: id
        };
    }
}

async function inventory_log(Type, Barcode, Keycode, Quantity, From, To, UserId, Function, TaskType) {
    let timezone;

    if (locationTimezoneMap[To.split("-")[0]]) {
        timezone = locationTimezoneMap[To.split("-")[0]].timezone;
    } else if (locationTimezoneMap[From.split("-")[0]]) {
        timezone = locationTimezoneMap[From.split("-")[0]].timezone;
    } else {
        timezone = "UTC";
    }

    let tableName = config.dynamodb.inventory_log;
    let date = moment().tz(timezone).format("YYYY-MM-DD");
    let insertDate = moment().tz(timezone).format("YYYY-MM-DD HH:mm:ss");
    let params = {
        TableName: tableName,
        Item: {
            Date: date,
            UUID: UUID(),
            InsertDate: insertDate
        }
    };

    // Workaround for DynamoDB rejecting null or zero-length strings.
    // As per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#putItem-property,
    // "Attribute values must not be null; string and binary type attributes must have lengths greater
    // than zero;". Check for null/empty string, and only send the parameter if its a valid item
    function getParameterNames(func) {
        let STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
        let ARGUMENT_NAMES = /([^\s,]+)/g;
        let functionString = func.toString().replace(STRIP_COMMENTS, "");
        let result = functionString.slice(functionString.indexOf("(") + 1, functionString.indexOf(")")).match(ARGUMENT_NAMES);

        if (result === null) {
            result = [];
        }

        return result;
    }

    let parameters = getParameterNames(inventory_log);

    for (let i = 0; i < parameters.length; i++) {
        if (arguments[i] || arguments[i] === 0) { // Warning: empty string '' == 0, so need === to work
            params.Item[parameters[i]] = arguments[i];
        }
    }
    return await documentClient.put(params).promise();
}

async function log_task_and_inventory(type, location, body) {
    // Type is Inventory / Task
    // Body is other data being passed
    let tableName = config.dynamodb.performance_log;

    if (!location) {
        // Location is required to have timezone work correctly
        return;
    }

    let timezone;
    if (locationTimezoneMap[location.split("-")[0]]) {
        timezone = locationTimezoneMap[location.split("-")[0]].timezone;
    } else {
        timezone = "UTC";
    }

    let date = moment().tz(timezone).format("YYYY-MM-DD");
    let dateTime = moment().utc().format();
    let item = {
        LocalDate: date,
        Timezone: timezone,
        DateUTC: dateTime,
        LocationID: location,
        Type: type,
        UUID: UUID()
    };

    for (let key in body) {
        // only include field if not null or empty
        if (body[key]) {
            item[key] = body[key];
        }
    }

    let params = {
        TableName: tableName,
        Item: item
    };

    return await documentClient.put(params).promise();
}

exports.log_inventory = async (type, Barcode, Keycode, quantity, from, to, user, fn, TaskType) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        AWS.config.update({region: config.region});
        documentClient = new AWS.DynamoDB.DocumentClient({region: config.region});

        await InitializeLocationTimezoneMaps();
        // Don't log the inventory if we're currently testing locally
        if (parseInt(process.env.AWS_SAM_LOCAL) === 1) {
            return;
        }

        let body = {
            Method: type,
            Barcode: Barcode,
            Keycode: Keycode,
            Quantity: quantity,
            From: from,
            To: to,
            UserID: user,
            Function: fn,
            TaskType: TaskType
        };

        let location;

        if (locationTimezoneMap[to.split("-")[0]]) {
            location = locationTimezoneMap[to.split("-")[0]].location;
        } else if (locationTimezoneMap[from.split("-")[0]]) {
            location = locationTimezoneMap[from.split("-")[0]].location;
        } else {
            location = "-";
        }

        await log_task_and_inventory("task", location, body);

        await inventory_log(type, Barcode, Keycode, quantity, from, to, user, fn, TaskType);
        return;
    } catch (error) {
        console.log(error);
    }
};

exports.getSettings = async () => {
    logger.startTrace("getSettings");
    let sql, results;

    sql = "SELECT * FROM system_settings";

    try {
        let pool = await wmsDB.getPool();
        logger.trace("getSettings:pool.query:system_settings");
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error("EXIT", "getSettings:pool.query:system_settings", {error: error});
    }

    // Default Settings is retrived from the config file
    let updatedSettings = defaultSettings;
    for (let result of results) {
        if (updatedSettings[result.Category]) {
            if (updatedSettings[result.Category][result.Property]) {
                switch (result.Type) {
                case "Boolean":
                    if (result.Value === "true") {
                        updatedSettings[result.Category][result.Property] = true;
                    } else {
                        updatedSettings[result.Category][result.Property] = false;
                    }
                    break;
                case "Hours":
                case "Minutes":
                case "Days":
                case "Number":
                    updatedSettings[result.Category][result.Property] = +result.Value;
                    break;
                case "Text":
                    updatedSettings[result.Category][result.Property] = result.Value;
                    break;
                case "Array":
                    updatedSettings[result.Category][result.Property] = result.Value.split(",");
                    break;
                }
            }
        }
    }
    logger.endTrace("getSettings");
    return updatedSettings;
};