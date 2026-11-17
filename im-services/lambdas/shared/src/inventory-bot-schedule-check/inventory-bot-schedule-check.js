const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('inventory-bot-schedule-check'); 

const failedtoStartStatus = "Scheduled";
const cannotReachStatus = "CannotReach";
const interruptedStatus = "Interrupted";
let inventoryBotErrorURL, config;

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        inventoryBotErrorURL = config.inventory_bot_error_api;
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
    let sql, args, results, apiResults;
    let inventoryBotsNotRunning = [];
    let shouldBeStartedResults, shouldBeFinishedResults;

    const pool = await wmsDB.getPool();

    sql = `
        SELECT
            ib.ID,
            its.InventoryBotArea AS TaskConfig,
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
        INNER JOIN inventory_bot ib ON its.InventoryBotID = ib.ID
        INNER JOIN location loc ON ib.LocationID = loc.ID
        LEFT JOIN (
            # Select InventoryBotIDs and TaskConfigs which have been completed in last {hoursRunShouldBeFinishedBy} hours
            SELECT DISTINCT bph.InventoryBotID, bph.TaskConfig, bph.status
            FROM bot_process_history bph
            INNER JOIN bot_process_status bps ON bph.ID = bps.BotProcessHistoryID
            WHERE bps.DateCreated > DATE_FORMAT(NOW() - INTERVAL 1 HOUR, '%Y-%m-%d %H:00:00')
        ) bph ON ib.ID = bph.InventoryBotID AND bph.TaskConfig = its.InventoryBotArea
        # MySQL DAYOFWEEK returns 1-7, we use 0-6 Sun - Sat
        WHERE its.Type = 'InventoryBot'
            AND sbs.IsEnabled = 1
            AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)
            AND (bph.status IS NULL OR bph.status NOT IN ('RunDataReady', 'Finished', 'Running'))
        HAVING its.Hour = localTZHour
            AND its.Minute BETWEEN startMinute AND endMinute
        ;
        # Any run which is past its Max Run time yet is not in a completed state will be updated as Interrupted
        SELECT
            bph.InventoryBotID,
            bph.TaskConfig,
            bph.Name AS RunName,
            its.MinsToComplete,
            # Get the time a run should be completed based on its schedule with a 60 min buffer
            CONVERT_TZ(CONVERT(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), DATETIME)
                + INTERVAL its.Hour HOUR + INTERVAL (its.Minute + its.MinsToComplete + 60) MINUTE, loc.Timezone, 'UTC')  AS timeToComplete
        FROM bot_process_history bph
        INNER JOIN inventory_take_schedule its ON bph.InventoryTakeScheduleID = its.ID
        INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleID = sbs.ID
        INNER JOIN location loc ON sbs.LocationID = loc.ID
        WHERE bph.Status NOT IN ('RunDataReady', 'Interrupted', 'Error')
            AND checkdate(loc.Timezone, sbs.Sun, sbs.Mon, sbs.Tue, sbs.Wed, sbs.Thu, sbs.Fri, sbs.Sat)
        HAVING NOW() > timeToComplete;`;

    try {
        [results] = await pool.query(sql);
        shouldBeStartedResults = results[0];
        shouldBeFinishedResults = results[1];
    } catch (error) {
        console.log(error);
        throw error;
    }

    for (let result of shouldBeStartedResults) {
        let inventoryBotID = result.ID;
        let taskConfig = result.TaskConfig;
        let inventoryRunName, status;

        try {
            apiResults = await wmsAPI.Get(`inventory_bot/${inventoryBotID}/status`);
            if (apiResults) {
                inventoryRunName = apiResults.ActiveRunName;
                status = apiResults.Status;
            } else {
                status = cannotReachStatus;
            }
        } catch (error) {
            console.log(error);
            status = cannotReachStatus;
        }

        // If there is no RunName, that means WMS thought the bot was scheduled but it didn't actually start
        if (!inventoryRunName) {
            // If status was not set to cannotReachStatus, it will be failedToStartStatus
            if (status !== cannotReachStatus) {
                status = failedtoStartStatus;
            }

            sql = `
                UPDATE bot_process
                SET Status = ?, RunName = NULL
                WHERE InventoryBotID = ? AND TaskConfig = ?`;
            args = [status, inventoryBotID, taskConfig];

            try {
                await pool.query(sql, args);
            } catch (error) {
                logger.error('Failed to update bot_process status to failedToStartStatus', {error});
            }

            inventoryBotsNotRunning.push(inventoryBotID);
            continue;
        }

        try {
            await updateProcessStatus(inventoryBotID, inventoryRunName, status, taskConfig);
        } catch (error) {
            console.log(error);
            continue;
        }
    }

    for (let inventoryBotID of inventoryBotsNotRunning) {
        let errorMessage = "Inventory Bot did not start running when it was scheduled to.\n";
        await reportInventoryBotError(inventoryBotID, errorMessage);
    }

    for (let result of shouldBeFinishedResults) {
        let inventoryBotID = result.InventoryBotID;
        let inventoryRunName = result.RunName;
        let taskConfig = result.TaskConfig;
        // If the run should be finished, update it to Interrupted
        const status = interruptedStatus;

        try {
            await updateProcessStatus(inventoryBotID, inventoryRunName, status, taskConfig);
        } catch (error) {
            console.log(error);
        }

        let errorMessage;
        errorMessage = `Inventory Bot run ${inventoryRunName} did not finish after ${result.MinsToComplete} minutes.\n`;
        await reportInventoryBotError(inventoryBotID, errorMessage);
    }
}

async function updateProcessStatus(inventoryBotID, runName, status, taskConfig) {
    const body = {
        "runName": runName,
        "status": status,
        "taskConfig": taskConfig
    };

    try {
        console.log(`Calling WMS process_status API for ${inventoryBotID}, inventory name ${runName} and status ${status}`);
        await wmsAPI.Post(`inventory_bot/${inventoryBotID}/process_status`, body);
    } catch (error) {
        console.log(error);
    }
}

async function reportInventoryBotError(inventoryBotID, errorMessage) {
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
