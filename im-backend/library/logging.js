/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

var moment = require("moment-timezone");
const { AWS } = require("./xray");
const UUID = require("uuid/v4");
AWS.config.update({region: config.aws_region});
var firehose = new AWS.Firehose();
var documentClient = new AWS.DynamoDB.DocumentClient();
var chalk = require("chalk");
const logger = require("./logger")("library:logging");

// This function dynamically builds up the object being sent to DynamoDB based off parameter names
// The parameter names need to be Case sensitive. Disabling ESLint rules for this item.

// eslint-disable-next-line no-unused-vars
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

exports.log_info = function (info) {
    console.log(chalk.green(info));
};

exports.log_error = function (err) {
    console.log(chalk.red(err));
};

exports.log_debug = function (dbg_info) {
    console.log(chalk.magenta(dbg_info));
};

exports.log_warn = function(warn_info) {
    console.log(chalk.yellow(warn_info));
};

exports.log_inventory = async function(type, Barcode, Keycode, quantity, from, to, user, fn, TaskType) {
    // Don't log the inventory if we're currently testing the APIs with Bitbucket's Pipeline
    if (parseInt(process.env.TEST_PIPELINE) === 1) {
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

    // For Firehouse logs we want to concat Barcode && Keycode as one string
    let productId = Barcode + "|" + Keycode;
    return await exports.write_to_s3(`inventory ${type} ${productId} ${from} ${to} ${quantity} ${user} ${fn} ${TaskType}`);
};

exports.log_rfid_stock_take = async function(quantity, containerID, userID) {
    let body = {
        Quantity: quantity,
        To: containerID,
        UserID: userID,
        Function: "complete_task",
        TaskType: "rfid-stock-take"
    };
    let location = locationTimezoneMap[containerID.split("-")[0]].location;
    await log_task_and_inventory("task", location, body);
};

exports.log_task = async function(location, body) {
    await log_task_and_inventory("task", location, body);
};

exports.log_sale_transaction = async function(date, location, productId, quantity) {
    return await exports.write_to_s3(`sale_transaction ${date} ${location} ${productId} ${quantity}`);
};

exports.write_to_s3 = async function(input) {
    let dateTime = moment().format("YYYY-MM-DD HH:mm:ss");
    let content  = `${dateTime} ${input}`;
    let params = {
        "DeliveryStreamName": `${config.firehose_delivery_stream_name}`,
        "Record": {
            "Data": Buffer.from(`${content}\n`) // Must have a newline in order to seperate Firehose logs on AWS
        }
    };

    // This method will be skipped if the firehose logs have been disabled
    if (config.enable_firehose_logs) {
        await firehose.putRecord(params).promise();
    }

    return input;
};
