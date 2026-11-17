"use strict";
const wmsDB = require("/opt/nodejs/wmsDB.js");
const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const { axios } = require("/opt/nodejs/xray.js");
const getConfig = require("/opt/nodejs/config.js");
const logger = require('/opt/nodejs/logger.js')('generate-backfill-efficacy-report'); 

let pool, SLACK_ERRORS, config;

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        SLACK_ERRORS = config.slackHookErrors;
        await main();
    } catch (error) {
        await sendNotification(error);
        return;
    }
    return "Done Successfully";
};

const main = async () => {
    let sql, results;

    try {
        pool = await wmsDB.getPool();

        // SELECT Locations which have updated inventory in the last 24 hours
        // Only these locations are eligible to create the backfill efficacy report
        sql = `
            SELECT DISTINCT LocationID
            FROM store_inventory_snapshot
            WHERE DateCreated > NOW() - INTERVAL 24 HOUR`;

        try {
            [results] = await pool.query(sql);
        } catch (error) {
            console.log(error);
            throw new Error(`Not able to get locations from Database`);
        }

        for (let row of results) {
            let body = {
                locationID: row.LocationID
            };
            // Generate Backfill Efficacy Report
            await wmsAPI.Get("reports/generate_backfill_efficacy_report", body);
        }
    } catch (error) {
        console.log("ERROR generate_backfill_efficacy_report: ",error);
        await sendNotification(`Unable to generate for backfill efficacy report in environment ${process.env.NODE_ENV}`);
    }
};

const sendNotification = async (error) => {
    try {
        let slackMessage = `*Backfill Efficacy Report *\n`;
        slackMessage += `:x: Failed: There was an error creating Backfill Efficacy Report \n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
    } catch (error) {
        logger.info('Failed to post Error message to Slack', {error});
    }
};
