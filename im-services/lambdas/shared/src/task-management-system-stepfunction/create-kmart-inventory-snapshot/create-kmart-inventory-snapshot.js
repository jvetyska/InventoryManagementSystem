const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const moment = require("moment-timezone");
const { axios, AWS, https } = require("/opt/nodejs/xray.js");
const stepfunctions = new AWS.StepFunctions();
const logger = require('/opt/nodejs/logger.js')('task-management-system-stepfunction:create-kmart-inventory-snapshot');

let pool, config;

exports.handler = async (event) => {
    logger.startTrace('handler');
    let taskToken, input, snapshotType, backfillScheduleID;

    try {
        let eventBody = event.Records[0].body;

        if (typeof(eventBody) === "string") {
            eventBody = JSON.parse(eventBody);
        }

        logger.info('body', 'handler', {eventBody});

        taskToken = eventBody.TaskToken;
        snapshotType = eventBody.Type;

        input = eventBody.Input;
        backfillScheduleID = input["backfillScheduleID"];

        logger.trace('handler:db.getPool');
        pool = await db.getPool();
        config = await getConfig.getConfig(process.env.NODE_ENV);

        logger.trace('handler:storeInventorySnapshot');
        await storeInventorySnapshot(backfillScheduleID, snapshotType);

        logger.trace('handler:resumeExecution');
        await resumeExecution(taskToken, input);
    } catch (error) {
        logger.error(error, 'handler');
        await failExecution(taskToken);

        throw error;
    }
    logger.endTrace('handler');
};

async function getLocationDetails(backfillScheduleID) {
    logger.startTrace('getLocationDetails');
    let sql, args, results;

    sql = `
        SELECT
            sbs.LocationID,
            loc.Timezone
        FROM store_backfill_schedule sbs
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        WHERE sbs.ID = ?
        `;
    args = [backfillScheduleID];

    try {
        [results] = await pool.query(sql, args);
        results = results[0];
    } catch (error) {
        logger.eror(error, 'getLocationDetails');
        throw error;
    }

    logger.endTrace('getLocationDetails');
    return results;
}

async function storeInventorySnapshot(backfillScheduleID, snapshotType) {
    logger.startTrace('storeInventorySnapshot');
    let sql, args;

    const locationDetails = await getLocationDetails(backfillScheduleID);
    const locationID = locationDetails.LocationID;
    const timezone = locationDetails.Timezone;

    const kmartInventoryRows = await getKmartInventoryForLocation(locationID, timezone);

    if (!kmartInventoryRows.length) {
        logger.info(`Not inserting snapshot for store ${locationID} as no Kmart Inventory found`, 'storeInventorySnapshot');
        return;
    }

    let insertArgs = [];

    for (let row of kmartInventoryRows) {
        let keycode = row.Keycode;
        let kmartQuantity = row.Quantity;
        let dateManifest = row.LastReceiptDate;

        insertArgs.push([locationID, keycode, kmartQuantity, dateManifest, backfillScheduleID, snapshotType]);
    }

    sql = `
        # To keep this table lean and quick, delete any old snapshots for this backfill schedule
        DELETE FROM kmart_inventory_snapshot WHERE BackfillScheduleID = ? AND SnapshotType = ?
        ;
        INSERT INTO kmart_inventory_snapshot (LocationID, Keycode, Quantity, DateKmartManifest, BackfillScheduleID, SnapshotType) VALUES ?;`;
    args = [backfillScheduleID, snapshotType, insertArgs];

    try {
        logger.trace('storeInventorySnapshot:pool.query');
        await pool.query(sql, args);
    } catch (error) {
        logger.error(error, 'storeInventorySnapshot:pool.query');
        throw new Error(`Unable to insert Kmart inventory snapshot data into ANKO DB`);
    }
    logger.endTrace('storeInventorySnapshot');
}

async function getKmartInventoryForLocation(locationID, timezone) {
    logger.startTrace('getKmartInventoryForLocation');
    const kmartSOHURL = config.KmartSOHAPIURL;
    // kmart has STR_ID = 1001 OR 1154, so get the Store code from locationID
    const locationCode = locationID.slice(0, locationID.indexOf("-"));
    const departmentIDList = await getLocationDepartments(locationID);
    let kmartInventory = [];
    let results;

    // Kmart's SSL Cert isn't accepted without this
    const agent = new https.Agent({
        rejectUnauthorized: false
    });

    // First get SOH and Manifest dates with the SOH by Department API
    for (let departmentID of departmentIDList) {
        const options = {
            "httpsAgent": agent,
            "params": {
                "storeID": locationCode,
                "department": departmentID
            }
        };

        try {
            logger.trace('getKmartInventoryForLocation:api')
            results = await axios.get(kmartSOHURL, options);
            results = results.data.SOH;
        } catch (error) {
            logger.error("failed to call the kmart SOH by Department API", 'getKmartInventoryForLocation');
            throw error;
        }

        for (let data of results) {
            let lastReceiptDate = data.LastReceiptDate || null;

            // lastReceipDate may be empty string
            if (lastReceiptDate) {
                // The date format from Kmart is "Feb 26 2021  2:51PM" which isn't standard so have to tell moment how to parse it
                lastReceiptDate = moment.tz(lastReceiptDate, "MMM DD YYYY  h:mma", timezone);
                // Convert date to UTC and format it so it can be properly inserted to DB
                lastReceiptDate = lastReceiptDate.utc().format();
            }

            kmartInventory.push({
                Keycode: data.Keycode,
                Quantity: data.StockOnHand,
                LastReceiptDate: lastReceiptDate
            });
        }
    }

    logger.endTrace('getKmartInventoryForLocation');
    return kmartInventory;
}

async function getLocationDepartments(locationID) {
    logger.startTrace('getLocationDepartments');
    let sql, args, results;

    sql = `
        SELECT GROUP_CONCAT(DISTINCT ld.DepartmentID) AS kmartDepartmentIDs
        FROM location loc
        INNER JOIN location_department ld ON loc.ID = ld.LocationID
        WHERE loc.ID = ?`;
    args = [locationID];

    try {
        logger.trace('getLocationDepartments:pool.query');
        [results] = await pool.query(sql, args);
        results = results[0];
    } catch (error) {
        logger.error(`failed to get location_departments for location ${locationID}`, 'getLocationDepartments');
        throw error;
    }

    let departmentArray = results.kmartDepartmentIDs.split(",");
    logger.endTrace('getLocationDepartments');
    return departmentArray;
}

async function resumeExecution(taskToken, output) {
    logger.startTrace('resumeExecution');
    const params = {
        "taskToken": taskToken,
        "output": JSON.stringify(output)
    };

    logger.endTrace('resumeExecution');
    await stepfunctions.sendTaskSuccess(params).promise();
}

async function failExecution(taskToken) {
    logger.startTrace('failExecution');
    const params = {
        "taskToken": taskToken
    };
    logger.endTrace('failExecution');

    return await stepfunctions.sendTaskFailure(params).promise();
}
