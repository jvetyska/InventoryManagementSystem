const moment = require("moment-timezone");
const { axios, https } = require("/opt/nodejs/xray.js");
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const logger = require('/opt/nodejs/logger.js')('kmart-external:kmart-inventory-snapshot'); 

let pool, slackURL, config;

exports.handler = async (event) => {
    let message;

    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        slackURL = config.slackHookErrors;
        pool = await db.getPool();
        await main();
    } catch (error) {
        console.log(error);
        await sendError();
    }

    message = `Successfully Created Kmart Inventory Snapshots`;
    console.log(message);
    return {
        "statusCode": 200
    };
};

async function main () {
    let sql, results;

    // SELECT Backfill Schedules which are at the start of their schedule to get kmart inventory snapshots
    sql = `
        SELECT
            sbs.ID AS backfillScheduleID,
            sbs.LocationID,
            its.Hour,
            its.Minute,
            loc.Timezone,
            # Use UNIX Timestamp arithmatic to round to the nearest 15 prior minute inverval, 60 hear refers to seconds, 15 to minutes
            # Ex: NOW() at 14:26:13 => startMinute 0, endMinute 14
            #     NOW()	at 2:01:10 => startMinute 45, endMinute 59
            # After UNIX Timestamp rounding, convert tz for the hour to the store's local TZ
            MINUTE(CONVERT_TZ(FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(NOW() - INTERVAL 15 MINUTE) / (60 * 15)) * (60 * 15)), 'UTC', loc.Timezone)) AS startMinute,
            MINUTE(CONVERT_TZ(FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(NOW()) / (60 * 15)) * (60 * 15)) - INTERVAL 1 SECOND, 'UTC', loc.Timezone)) AS endMinute,
            HOUR(CONVERT_TZ(FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(NOW() - INTERVAL 15 MINUTE) / (60 * 15)) * (60 * 15)), 'UTC', loc.Timezone)) AS localTZHour
        FROM inventory_take_schedule its
        INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleId = sbs.ID
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        # MySQL DAYOFWEEK returns 1-7, we use 0-6 Sun - Sat
        WHERE
            sbs.IsEnabled = 1
            # Only get schedules with system inventory checks (IPS updates)
            AND sbs.InventoryCheckType = 'system'
            AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)
        HAVING
            its.Hour = localTZHour
            AND its.Minute BETWEEN startMinute AND endMinute
        ;`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw error;
    }

    for (let result of results) {
        let backfillScheduleID = result["backfillScheduleID"];
        let locationID = result["LocationID"];
        let timezone = result["Timezone"];

        try {
            await insertKmartInventorySnapshot(backfillScheduleID, locationID, timezone);
        } catch (error) {
            console.log(error);
            throw error;
        }
    }
}

async function insertKmartInventorySnapshot(backfillScheduleID, locationID, timezone) {
    let sql, args;

    let kmartInventoryRows = await getKmartInventoryForLocation(locationID, timezone);

    if (!kmartInventoryRows.length) {
        console.log(`Not inserting snapshot for store ${locationID} as no Kmart Inventory found`);
        return;
    }

    const ScheduleType = "ScheduleStart";
    let insertArgs = [];

    for (let row of kmartInventoryRows) {
        let keycode = row.Keycode;
        let kmartQuantity = row.Quantity;
        let dateManifest = row.LastReceiptDate;
        insertArgs.push([locationID, keycode, kmartQuantity, dateManifest, backfillScheduleID, ScheduleType]);
    }

    sql = `
        # To keep this table lean and quick, delete any old snapshots for this backfill schedule
        DELETE FROM kmart_inventory_snapshot WHERE BackfillScheduleID = ? AND SnapshotType = '${ScheduleType}'
        ;
        INSERT INTO kmart_inventory_snapshot (LocationID, Keycode, Quantity, DateKmartManifest, BackfillScheduleID, SnapshotType) VALUES ?;`;
    args = [backfillScheduleID, insertArgs];

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error('insertKmartInventorySnapshot: ', {error});
        throw new Error(`Unable to insert Kmart inventory snapshot data into ANKO DB`);
    }
}

async function getKmartInventoryForLocation(locationID, timezone) {
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
            results = await axios.get(kmartSOHURL, options);
            results = results.data.SOH;
        } catch (error) {
            logger.error('ERROR: getKmartInventoryForLocation failed to call the kmart SOH by Department API');
            throw error;
        }

        for (let data of results) {
            let lastReceiptDate = data.LastReceiptDate || null;

            // lastReceipDate may be empty string
            if (lastReceiptDate) {
                // The date format from Kmart is "Feb 26 2021  2:51PM" which isn't standard so have to tell moment how to parse it
                lastReceiptDate = moment(lastReceiptDate, "MMM DD YYYY  h:mma").tz(timezone).format();
            }

            kmartInventory.push({
                Keycode: data.Keycode,
                Quantity: data.StockOnHand,
                LastReceiptDate: lastReceiptDate
            });
        }
    }

    return kmartInventory;
}

async function getLocationDepartments(locationID) {
    let sql, args, results;

    sql = `
        SELECT GROUP_CONCAT(DISTINCT ld.DepartmentID) AS kmartDepartmentIDs
        FROM location loc
        INNER JOIN location_department ld ON loc.ID = ld.LocationID
        WHERE loc.ID = ?`;
    args = [locationID];

    try {
        [results] = await pool.query(sql, args);
        results = results[0];
    } catch (error) {
        console.log(`ERROR: getLocationDepartments failed to get location_departments for location ${locationID}`);
        throw error;
    }

    let departmentArray = results.kmartDepartmentIDs.split(",");
    return departmentArray;
}

async function sendError() {
    let logString = ":no_entry: `kmart-inventory-snapshot`\n";
    logString += `Failed to create kmart inventory snapshots in environment ${process.env.NODE_ENV}`;

    logger.error(logString);

    try {
        console.log(slackURL);
        await axios.post(slackURL, {"text": logString});
    } catch (error) {
        console.log(error);
    }
}
