"use strict";
const wmsDB = require("/opt/nodejs/wmsDB.js");
const { axios, AWS } = require("/opt/nodejs/xray.js");
const { parse } = require("json2csv");
const moment = require("moment");
const s3 = new AWS.S3({ signatureVersion: "v4" });
const configuration = require("/opt/nodejs/config.js");
let SLACK_ERRORS;
let config;
const logger = require("/opt/nodejs/logger.js")("rfid-data-for-sophia"); 

let pool;

exports.handler = async (event) => {
    try {
        config = await configuration.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slackHookErrors;
        await main();
    } catch (error) {
        try {
            let slackMessage = `*Sophia Upload CSV *\n`;
            slackMessage += `:x: Failed: There was an error uploading CSV file for Sophia \n`;
            slackMessage += "```" + error + "```";
            await axios.post(SLACK_ERRORS, {text: slackMessage});
        } catch (error) {
            logger.info("Failed to post Error message to Slack", {error});
        }
        return;
    }
    return "Done Successfully";
};

const main = async () => {
    let sql, results;

    pool = await wmsDB.getPool();

    // There is too much data to upload all at one time so go location by location
    sql = `SELECT ID FROM location`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw new Error(`Not able to get locations from Database`);
    }

    for (let row of results) {
        let locationID = row.ID;

        try {
            await uploadDataForLocation(locationID);
        } catch (error) {
            console.log(error);
            throw error;
        }
    }
};

const uploadDataForLocation = async (locationID) => {
    let sql, args, results, inventoryResult, inventoryAdjustmentResult, botProcessHistoryResult, performanceDashboardResult;
    let backfillEfficacyResult, backfillEfficacyMetricResult, storeInventorySnapshotResult, taskResult, taskGroupResult, userResult;
    let tableFields, options, fileData, fileName;
    console.log(`Uploading for location ${locationID}`);

    sql = `
        SELECT
            i.*,
            DATE_FORMAT(i.DateCreated, '%Y-%m-%d %T') as DateCreatedFormated,
            DATE_FORMAT(i.DateUpdated, '%Y-%m-%d %T') as DateUpdatedFormated
        FROM inventory i
        INNER JOIN container c ON i.ContainerID = c.ID
        WHERE c.LocationID = ?
        ;
        SELECT
            ia.*,
            DATE_FORMAT(DateCreated, '%Y-%m-%d %T') as DateCreatedFormated,
            DATE_FORMAT(DateCompleted, '%Y-%m-%d %T') as DateCompletedFormated
        FROM inventory_adjustment ia
        INNER JOIN container c ON ia.ContainerID = c.ID
        WHERE c.LocationID = ? AND ia.DateCreated > DATE_FORMAT(NOW() - INTERVAL 24 HOUR, '%Y-%m-%d %H:00:00')
        ;
        SELECT
            bph.*,
            DATE_FORMAT(bph.DateCreated, '%Y-%m-%d %T') as DateCreatedFormated,
            DATE_FORMAT(bph.DateUpdated, '%Y-%m-%d %T') as DateUpdatedFormated
        FROM bot_process_history bph
        INNER JOIN inventory_bot ib ON ib.ID = bph.InventoryBotID
        WHERE ib.LocationID = ? AND bph.DateCreated > DATE_FORMAT(NOW() - INTERVAL 24 HOUR, '%Y-%m-%d %H:00:00')
        ;
        SELECT
            *,
            HourlyRate AS Rate,
            DATE_FORMAT(pb.DateUpdated, '%Y-%m-%d %T') AS DateUpdatedFormated
        FROM report_performance pb
        WHERE
            pb.LocationID = ?
            AND pb.DateUpdated > DATE_FORMAT(NOW() - INTERVAL 48 HOUR, '%Y-%m-%d %H:00:00')
            AND pb.DateUpdated < DATE_FORMAT(NOW() - INTERVAL 24 HOUR, '%Y-%m-%d %H:00:00')
        ;
        SELECT
            sis.*,
            DATE_FORMAT(sis.DateCreated, '%Y-%m-%d %T') as DateCreatedFormated
        FROM store_inventory_snapshot sis
        WHERE sis.LocationID = ? AND sis.DateCreated > DATE_FORMAT(NOW() - INTERVAL 24 HOUR, '%Y-%m-%d %H:00:00')
        ;
        SELECT
            t.*,
            DATE_FORMAT(t.DateCreated, '%Y-%m-%d %T') as DateCreatedFormated,
            SUBSTRING_INDEX(c.LocationID, '-', 1) AS Store
        FROM task t
        INNER JOIN container c ON t.SourceContainer = c.ID
        WHERE c.LocationID = ? AND t.DateCreated > DATE_FORMAT(NOW() - INTERVAL 24 HOUR, '%Y-%m-%d %H:00:00')
        ;
        SELECT
            tg.*,
            DATE_FORMAT(tg.DateCreated, '%Y-%m-%d %T') as DateCreatedFormated
        FROM task_group tg
        WHERE tg.SourceLocation = ? AND tg.DateCreated > DATE_FORMAT(NOW() - INTERVAL 24 HOUR, '%Y-%m-%d %H:00:00')
        ;
        SELECT
            u.ID,
            u.Username,
            u.FirstName,
            u.LastName,
            u.DefaultLocation,
            u.isSSO,
            DATE_FORMAT(u.AccountCreated, '%Y-%m-%d %T') as DateCreatedFormated
        FROM user u
        WHERE u.DefaultLocation = ?
        ;
        CALL backfill_generate_efficacy_report(?)
        ;
    `;
    args = [locationID, locationID, locationID, locationID, locationID, locationID, locationID, locationID, locationID];

    try {
        [results] = await pool.query(sql, args);
        inventoryResult = results[0];
        inventoryAdjustmentResult = results[1];
        botProcessHistoryResult = results[2];
        performanceDashboardResult = results[3];
        storeInventorySnapshotResult = results[4];
        taskResult = results[5];
        taskGroupResult = results[6];
        userResult = results[7];
        backfillEfficacyResult = results[8];
        backfillEfficacyMetricResult = results[9];

        logger.info(`Inventory Count : ${inventoryResult.length}`);
        logger.info(`Inventory Adjustment Count : ${inventoryAdjustmentResult.length}`);
        logger.info(`Bot Process History Count : ${botProcessHistoryResult.length}`);
        logger.info(`Performance Dashboard Count : ${performanceDashboardResult.length}`);
        logger.info(`Store Inventory Snapshot Count : ${storeInventorySnapshotResult.length}`);
        logger.info(`Task Count : ${taskResult.length}`);
        logger.info(`Task Group Count : ${taskGroupResult.length}`);
        logger.info(`User Count : ${userResult.length}`);
        logger.info(`Backfill Efficacy Count : ${backfillEfficacyResult.length}`);
    } catch (error) {
        console.log(error);
        let slackMessage = `*Sophia Upload CSV *\n`;
        slackMessage += `:x: Failed: There was an error uploading CSV file for Sophia \n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
    }

    let timeStamp = String(moment().format("YYYY-MM-DDTHH:mm:SS"));

    if (inventoryResult.length) {
        tableFields = ["ID", "ContainerID", "Keycode", "ProductID", "TaskID", "DateCreatedFormated", "DateUpdatedFormated", "UserID", "IsSuspicious", "isSameLocation", "TagID", "XPosition", "YPosition", "ZPosition", "Certainty", "InventoryBotID"];
        options = { fields: tableFields };
        fileData = parse(inventoryResult, options);
        fileName = `inventory/inventory_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (inventoryAdjustmentResult.length) {
        tableFields = ["ID", "TaskID", "UserID", "ContainerID", "Keycode", "ProductID", "ExpectedQty", "ActualQty", "Delta", "DateCreatedFormated", "DateCompletedFormated", "IdentifierType"];
        options = { fields: tableFields };
        fileData = parse(inventoryAdjustmentResult, options);
        fileName = `inventory_adjustment/inventory_adjustment_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (botProcessHistoryResult.length) {
        tableFields = ["InventoryBotID", "Name", "Location", "ScanArea", "TaskConfig", "Status", "IsManual", "MapID", "InventoryTakeScheduleID", "NumTagsRead", "NumTagsProcessed", "AverageCertainty", "RunQualityPct", "DateCreatedFormated", "DateUpdatedFormated", "RunDuration", "FailureReason"];
        options = { fields: tableFields };
        fileData = parse(botProcessHistoryResult, options);
        fileName = `bot_process_history/bot_process_history_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (performanceDashboardResult.length) {
        tableFields = ["Date", "LocationID", "UserID", "Task", "Quantity", "Minutes", "Rate", "DateUpdatedFormated"];
        options = { fields: tableFields };
        fileData = parse(performanceDashboardResult, options);
        fileName = `performance/performance_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (storeInventorySnapshotResult.length) {
        tableFields = ["LocationID", "ContainerID", "BackfillScheduleID", "Keycode", "Quantity", "QuantityExternalTotal", "QuantityBackfill", "DateSnapshot", "QuantityCounted", "QuantityAdjusted", "AdjustmentReason", "DateCounted", "DateCompleted", "ExternalInventoryAdjust", "TaskID", "IsOverThreshold", "DateCreatedFormated"];
        options = { fields: tableFields };
        fileData = parse(storeInventorySnapshotResult, options);
        fileName = `store_inventory_snapshot/store_inventory_snapshot_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (taskResult.length) {
        tableFields = ["TaskGroupID", "Keycode", "Barcode", "ProductID", "RowID", "Quantity", "QuantityFilled", "QuantityDelivered", "SourceContainer", "TargetContainer", "SecondarySort", "DateCompleted", "DateFulfilled", "DateTransitStart", "DateTransitEnd", "Type", "Priority", "isRestricted", "isSkipped", "isBackup", "isRandom", "ReferenceID", "AssignedUserID", "DateCreatedFormated", "Store"];
        options = { fields: tableFields };
        fileData = parse(taskResult, options);
        fileName = `task/task_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (taskGroupResult.length) {
        tableFields = ["SourceLocation", "TargetLocation", "DateDue", "Priority", "Type", "CartType", "ReferenceID", "DateCompleted", "DateFulfilled", "isRestricted", "isReserve", "AssignedUserID", "DateUserAssigned", "Name", "Source", "DateCreatedFormated"];
        options = { fields: tableFields };
        fileData = parse(taskGroupResult, options);
        fileName = `task_group/task_group_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (userResult.length) {
        tableFields = ["ID", "Username", "FirstName", "LastName", "DefaultLocation", "isSSO", "DateCreatedFormated"];
        options = { fields: tableFields };
        fileData = parse(taskGroupResult, options);
        fileName = `user/user_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    if (backfillEfficacyResult.length) {
        tableFields = ["LocationID", "Keycode", "Product_Name", "Department_Name", "MDU", "InOrOutOfStock", "FOHQuantityYesterday", "BOHQuantityYesterday", "FOHQuantityCurrent", "BOHQuantityCurrent", "BackfillGenerated", "BackfillPerformed", "BackfilledButOutOfStockToday", "Qty_Picked", "Qty_Unavailable", "Qty_Expired"];
        options = { fields: tableFields };
        fileData = parse(backfillEfficacyResult, options);
        fileName = `backfill_efficacy/backfill_efficacy_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }

    // The backfill efficacy metric result can have 1 row when the efficacy report itself has 0
    // Don't want to add to Sophia in this case
    if (backfillEfficacyResult.length && backfillEfficacyMetricResult.length) {
        tableFields = ["LocationID", "InStockPercentage", "OOSDueToSystemNotGeneratingBackfill", "OOSDueToBackfillNotPerformed", "OOSDueToLessMDU"];
        options = { fields: tableFields };
        fileData = parse(backfillEfficacyMetricResult, options);
        fileName = `backfill_efficacy_metric/backfill_efficacy_metric_${locationID}_${timeStamp}.csv`;
        await putFileTOS3(fileData, fileName);
    }
};

const putFileTOS3 = async (fileData, fileName) => {
    const s3Params = {
        Bucket : process.env.S3BUCKET,
        Key    : fileName,
        ServerSideEncryption: "AES256",
        ACL    : "bucket-owner-full-control",
        Body   : fileData
    };
    console.log(`UPLOAD S3 BUCKET: ${s3Params.Bucket}/${s3Params.Key}`);
    try {
        const putFile = await s3.upload(s3Params).promise();
        logger.info('----------- S3 UPLOAD SUCCESSFULL -----------', {putFile});
    } catch (error) {
        console.log(error);
        throw new Error(`Failed to upload to s3 bucket: ${error}`);
    }
};
