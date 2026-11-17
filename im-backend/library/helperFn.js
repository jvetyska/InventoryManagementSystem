//var apiRequest = require("../library/apiRequest");
const stream = require("stream");
const csvConverter = require("json-2-csv");
const moment = require("moment-timezone");
const { AWS } = require("./xray");
AWS.config.update({region: global.config.aws_region});
const s3 = new AWS.S3({apiVersion: "2006-03-01"});
const SES = new AWS.SES({region: global.config.email_region , apiVersion: "2010-12-01"});
const defaultSettings = require("../config/settings");
let sns = new AWS.SNS({apiVersion: "2010-03-31"});
const proxy = require("proxy-agent");
const logger = require("./logger")("library:helperFn");

/** trimVal
 *  - Trims string values and returns value or null if empty string.
 */
exports.trimVal = function(val) {

    if (val || !isNaN(val)) { // if val is 0, it treats the if clause as null, and skips. Because sometimes the numbers in csv are getting parsed as numbers, and not strings
        val = val.toString().trim();
        if (val != "") return val;
    }
    return null;
};

/** checkEmpty
 *  - Check if value is empty and return the value or null
 */
exports.checkEmpty = function(val) {
    if (val === "") {
        return null;
    }
    else {
        return val;
    }
};

exports.parseBoolean = function(val) {
    if (!val) {
        return false;
    } else if (val === "true" || val === 1 || val === "1" || val === true) {
        return true;
    } else {
        return false;
    }
};

/**
 * dueDate
 * - Calculate Due Date info and provide response object with helpful function getDueDate
 * - getDueDate returns properly formatted date based on the offset or by default 4 hours later.
 */

// Don't think this is used could not find it called
exports.dueDate = async function() {
    let sql, results, responseObj = {};

    // Start populating the respose object.
    responseObj.dueDateDef = moment().add(settings.dueDate.offsetDefault, "hour").format(); // Default value, 4 hours later.

    responseObj.getDueDate = function (forLocation, offset) {
        if (this[forLocation] == null) return this.dueDateDef; // return Default Due Date if location does not exist.
        let currHour = this[forLocation].currHour + offset;
        let dueHour;

        for (let h of this[forLocation].hours) {
            if (h >= currHour) {
                dueHour = h;
                break;
            }
        }

        if (dueHour != null) { // if dueHour was found, return the date.
            return moment.utc(this[forLocation].utcDate).add(dueHour, "hour").format();
        } else { // IF dueHour was not found, use the first value (+1 day) or 4 hours by default.
            dueHour = parseInt(this[forLocation].hours[0]);
            if (!isNaN(dueHour)) { // Set due date to first Hour of next day.
                dueHour += 24;
                return moment.utc(this[forLocation].utcDate).add(dueHour, "hour").format();
            } else { // If no Deliver Schedule is set, return default Due date.
                return this.dueDateDef;
            }
        }
    };

    // Calculating Due date:
    // Get list of DueDates and set Due dates based on Location.
    // Getting UtcHours as UTC hours offset from 0th hour local time converted to UTC.
    sql = `
    SELECT LocationID, UtcDate, CurrHour, GROUP_CONCAT(Hour ORDER BY Hour) as Hours
    FROM (
        SELECT ds.LocationID, CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), loc.Timezone, 'UTC') as UtcDate,
        HOUR(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) CurrHour, ds.Hour
        FROM delivery_schedule ds
        INNER JOIN location loc ON loc.ID = ds.LocationID) AS ds
    GROUP BY LocationID`;
    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        logger.error("replenish due date:", {error});
        return responseObj;
    }

    for (let location of results) {
        let loc = responseObj[location.LocationID] = {};
        loc.hours = location.Hours ? location.Hours.split(",") : [];
        loc.utcDate = location.UtcDate; // Date from which UTC hour starts.
        loc.currHour = location.CurrHour; // Current UTC hour, as an offset from UtcDate.
    }
    return responseObj;
};
exports.generateRandomIspBarcode = async function() {
    const array = [
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
    ];
    let string = "ISP-";
    for (let i = 0; i < 9; i++) {
        string += array[Math.floor((Math.random() * 62))];
    }
    return string;
};

exports.generateRandomOnlineOrderNumber = function() {
    // An easy to prevent almost all cases of randomly generated inappropriate words is to not use vowels
    const array = [
        "B", "C", "D", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "V", "W", "X", "Y", "Z",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
    ];
    let string = "";
    for (let i = 0; i < 5; i++) {
        string += array[Math.floor((Math.random() * 31))];
    }
    return string;
};

exports.largeSQLQuery = async function(sql, args) {
    let sqlstring = "";
    let resultsArray = [];
    let results, tempString;

    if (Array.isArray(sql)) {
        if (sql.length != args.length) {
            throw "largeSQLQuery ERROR: sql array and args array must be same length";
        }

        let length = sql.length;
        let MB = 0;

        for (let x = 0; x < length; x++) {
            // sqlstring + " " + pool.format(sql[x], args[x]);
            tempString = pool.format(sql[x], args[x]);
            MB += (Buffer.byteLength(tempString, "utf8") / Math.pow(1024, 2));
            sqlstring += tempString + " ; ";

            if (MB > 10) {
                try {
                    [results] = await pool.query(sqlstring);
                    resultsArray.push(results);
                    sqlstring = "";
                    MB = 0;
                } catch (error) {
                    throw error;
                }
            }
        }

        if (sqlstring != "") {
            try {
                [results] = await pool.query(sqlstring);
                resultsArray.push(results);
                sqlstring = "";
            } catch (error) {
                throw error;
            }
        }

        return resultsArray;
    } else {
        let arggroup = [];
        for (var x = 0; x < args.length; x += 10000) {
            arggroup.push(args.slice(x, x + 10000));
        }

        for (let arg of arggroup) {
            try {
                [results] = await pool.query(sql, [arg]);
                resultsArray.push(results);
            } catch (error) {
                throw error;
            }
        }

        return resultsArray;
    }
};

exports.queryWithRetries = async function(sql, args, numberOfRetries = 5, retryDelay = 1000) {
    let results;

    while (numberOfRetries > 0) {
        try {
            results = await pool.query(sql, args);
        } catch (error) {
            if (error && error.code == "ER_LOCK_DEADLOCK") {
                console.log(`queryWithRetries encountered DEADLOCK. Retrying ${numberOfRetries} more times.\n\n\n`);
                numberOfRetries--;
                await new Promise(resolve => setTimeout(resolve, retryDelay));

                continue;
            } else {
                throw error;
            }
        }

        return results;
    }
};

/* *********************************
 * Exposed function.
 *
 * Call this file with
 * the arguments
 * *********************************/

exports.uploadFileToS3 = function(bucket_name, key, file_stream, verbose = false, additionalParamaters = null) {

    return new Promise(async (resolve, reject) => {

        if (config.isDevelopment) {
            key = "_DEV_" + key;
        }
        try {

            let res = await _uploadToS3(bucket_name, key, file_stream, verbose, additionalParamaters);
            resolve(res);
        } catch (err) {
            console.log(err);
            reject(err);
        }
    });
};

exports.deleteFileInS3 = function(bucket_name, key) {
    return new Promise(async (resolve, reject) => {
        try {

            let res = await _deleteInS3(bucket_name, key);
            resolve(res);
        } catch (err) {
            console.log(err);
            reject(err);
        }
    });
};

/* *********************************************************
 *  internal function. takes bucket_name, key, file_stream
 * *********************************************************/
function _uploadToS3(bucket_name, key, file_stream, verbose, additionalParamaters) {
    return new Promise(async (resolve, reject) => {
        let uploadParams = {
            Bucket: bucket_name,
            Key: key,
            Body: file_stream
        };

        if (additionalParamaters) {
            uploadParams = Object.assign(additionalParamaters, uploadParams);
        }
        try {
            s3.upload(uploadParams, function(err, data) {
                if (err) {
                    console.log(err);
                    // Throwing error here does not cascade up chain instead you need to reject
                    reject(err);
                }
                if (verbose) {
                    logger.info("Uploaded csv to s3\n", {data});
                }
                resolve(data);
            });
        } catch (err) {
            reject(err);
        }
    });
}
function _deleteInS3(bucket_name, key) {
    return new Promise(async (resolve, reject) => {
        var params = {
            Bucket: bucket_name,
            Key: key
        };


        try {
            s3.deleteObject(params, function(err, data) {
                if (err) {
                    console.log(err);
                    // Throwing error here does not cascade up chain instead you need to reject
                    reject(err);
                }
                resolve(data);
            });

        } catch (err) {
            reject(err);
        }
    });
}

/**
 * @description Sends a .csv file to the frontend user. This satisfies the response, so you don't need to call res.status() or res.json() after invoking this method
 * @param string   Name of the file that the frontend user will receive
 * @param object   Any object that will be transformed into a .csv string and piped to the frontend user
 * @param response The response object
 */
exports.SendCSVToUser = async function(fileName, data, res) {
    let readStream = new stream.PassThrough();
    let inventoryCsv = await csvConverter.json2csvAsync(data, {emptyFieldValue: ""});
    inventoryCsv = Buffer.from(inventoryCsv);
    readStream.end(inventoryCsv);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");
    readStream.pipe(res);
};

exports.updateSystemSettings = async function() {
    let sql, results;

    sql = "SELECT * FROM system_settings";

    try {
        [results] = await pool.query(sql);
    } catch (err) {
        console.log(err);
        return defaultSettings;
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
    global.settings = updatedSettings;
    logger.info("System Settings Updated...");
};

exports.CompareArrays = function(arr1, arr2) {
    // This helper function checks two arrays and returns true if the arrays are identical,
    // and false if the arrays aren't. Note that the checks are very simple, and therefore
    // only works on arrays with basic data types like strings and numbers.

    // Arrays with different lengths will never be equal
    if (arr1.length !== arr2.length) {
        return false;
    }

    // Check if all items exist and are in the same order
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) {
            return false;
        }
    }

    // The checks have passed; the two arrays are equal
    return true;
};

exports.ValidateProduct = function(product) {
    /* A product MUST meet the following standards in order for it to be considered valid
     * 1. There is a Keycode, and it must be an INT value
     * 2. There is an APN, and it must have a length of at least 9 digits (reject 8 or less)
     * 3. The Keycode and APN must not match
     * 4. There is a Product_Name, it's NOT null, "null", or "undefined"
     * 5. Department_Name and Class_Name both exist
     * 6. If the product has Style_ID (NOT null and > 0), make sure Item_Size and Secondary_Colour are populated
     * If a product fails the above conditions, it will be removed and won't be INSERTed or UPDATEed
     * Failed products will be included in the Slack logs: "Products skipped with errors"
     */

    let keycode = null;

    // 1. There is a Keycode, and it must be an INT value
    if ("Keycode" in product) {
        // The keycode will always be a string, but we can verify that it's an INT value by checking if
        // the value is the exact same after parsing it as an integer and converting back into a string
        keycode = product["Keycode"];
        let convert = parseInt(keycode, 10).toString();

        if (keycode !== convert) {
            return false; // INVALID: The keycode isn't an integer
        }
    } else {
        return false; // INVALID: Keycode doesn't exist
    }

    // 2. There is an APN, and it must have a length of at least 9 digits (reject 8 or less)
    if ("APN" in product) {
        let apn = product["APN"];

        if (apn.length <= 8) {
            return false; // INVALID: APN must be at least 9 digits
        }
    } else {
        return false; // INVALID: APN doesn't exist
    }

    // 3. The Keycode and APN must not match
    keycode = product["Keycode"];
    let apn = product["APN"];
    if (keycode === apn) {
        return false; // INVALID: Keycode and APN match
    }

    // 4. There is a Product_Name, it's NOT null, "null", or "undefined"
    if ("Product_Name" in product) {
        let productName = product["Product_Name"];

        if (!(productName && productName !== "null" && productName !== "undefined")) {
            return false; // INVALID: Product_Name is not a proper value
        }
    } else {
        return false; // INVALID: Product_Name doesn't exist
    }

    // 5. Department_Name and Class_Name both exist
    if ("Department_Name" in product && "Class_Name" in product) {
        let departmentName = product["Department_Name"];
        let className = product["Class_Name"];

        if (!(departmentName && className)) {
            return false; // INVALID: Department_Name and Class_Name are not proper values
        }
    } else {
        return false; // INVALID: Department_Name and Class_Name don't both exist
    }

    // 6. If the product has Style_ID (NOT null and > 0), make sure Item_Size and Secondary_Colour are populated
    if ("Style_ID" in product) {
        let styleId = product["Style_ID"];

        if (styleId !== null && styleId > 0) {
            let itemSize = product["Item_Size"];
            let secondaryColour = product["Secondary_Colour"];

            if (!(itemSize && secondaryColour)) {
                return false; // INVALID: Style_ID is not a proper value
            }
        }
    } else {
        return false; // INVALID: Style_ID doesn't exist
    }

    return true; // All checks have passed, so this product is deemed as valid
};

exports.GenerateUsernameZPL = function(data) {
    // Make sure that the data contains the necessary properties when generating ZPL for a username label
    if (!("barcode" in data && "username" in data)) {
        throw "The data must contain the following properties: barcode, username";
    }

    let zplData = `^XA`;
    zplData += `^FO60,30^BY2`;
    zplData += `^BCN,60,N,N,N`;
    zplData += `^FD${data.barcode}`;
    zplData += `^FS`;
    zplData += `^FO60,120`;
    zplData += `^A0,70,30`;
    zplData += `^FD${data.username}`;
    zplData += `^FS`;
    zplData += `^XZ`;

    return zplData;
};

exports.GenerateProductBarcodeZPL = function(data) {
    // Make sure that the data contains the necessary properties when generating ZPL for a product barcode label
    if (!("productName"     in data && "keycode"        in data && "styleID" in data && "ausSize" in data &&
          "secondaryColour" in data && "departmentName" in data && "barcode" in data && "epcTag"  in data)) {
        throw "The data must contain the following properties: productName, keycode, styleID, ausSize, secondaryColour, departmentName, barcode, epcTag";
    }

    const fontSize = 14;
    const initX = 80;
    const initY = 10;
    let zplData = `^XA`;
    zplData += `^FO${initX},${initY},0`;
    zplData += `^A1,${fontSize},${fontSize}`;
    zplData += `^FD${data.productName}`;
    zplData += `^FS`;
    zplData += `^FO${initX},${initY+30},0`;
    zplData += `^A1,${fontSize-2},${fontSize-2}`;
    zplData += `^FD${data.keycode}`;
    zplData += `^FS`;
    zplData += `^FO${initX+140},${initY+30},0`;
    zplData += `^A1,${fontSize-2},${fontSize-2}`;
    zplData += `^FD${data.styleID}`;
    zplData += `^FS`;
    zplData += `^FO${initX},${initY+45},0`;
    zplData += `^A1,${fontSize-4},${fontSize-4}`;
    zplData += `^FD${data.ausSize}`;
    zplData += `^FS`;
    zplData += `^FO${initX+140},${initY+45},0`;
    zplData += `^A1,${fontSize-4},${fontSize-4}`;
    zplData += `^FD${data.secondaryColour}`;
    zplData += `^FS`;
    zplData += `^FO${initX},${initY+60},2`;
    zplData += `^A1,${fontSize-4},${fontSize-4}`;
    zplData += `^FD${data.departmentName}`;
    zplData += `^FS`;
    zplData += `^FO${initX+60},${initY+80}^BY2`;
    zplData += `^BEN,30,Y,N`;
    zplData += `^FD${data.barcode}`;
    zplData += `^FS`;
    zplData += `^RFW,H`;
    zplData += `^FD${data.epcTag}`;
    zplData += `^FS`;
    zplData += `^XZ`;

    return zplData;
};
