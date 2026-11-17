/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const db = require("/opt/nodejs/wmsDB.js");
const layerConfig = require("/opt/nodejs/config.js");

const { axios, AWS } = require("/opt/nodejs/xray.js");
const moment = require("moment-timezone");
const logger = require('/opt/nodejs/logger.js')('performance-report-creation'); 

let configuration;
let dynamodb;

async function getDynamo(date) {
    // Add location Here
    let response;
    let results = [];
    let pagination = {};
    let params = {
        "TableName": process.env.DYNAMO_TABLE,
        "KeyConditionExpression": "#LocalDate = :currentDay",
        "ExpressionAttributeNames": {
            "#LocalDate": "LocalDate"
        },
        "ExpressionAttributeValues": {
            ":currentDay": date
        }
    };

    do {
        response = await dynamodb.query(params).promise();
        results = [...results, ...response.Items];
        pagination = response.LastEvaluatedKey;
        params.ExclusiveStartKey = pagination;
    } while (response.hasOwnProperty("LastEvaluatedKey"));

    return results;
}

function createReport(data) {
    // Data in: [{ time: time, task: task, qty: qty }, ...]
    // Data out: { task: { qty: 1, min: 1, rate: 1 }, ...}
    let report = {};

    // First Sort By Date
    data.sort(function (a, b) {
        // Turn your strings into dates, and then subtract them
        // to get a value that is either negative, positive, or zero.
        return new Date(a.time) - new Date(b.time);
    });

    let currtask = null;
    let lasttime = null; // Used to calculate the last known instance if user does not logout.
    let start = null;
    let currqty = 0;

    for (let datum of data) {
        let task = datum.task;
        let qty = datum.qty;
        let time = datum.time;
        lasttime = moment(time);
        if (currtask) {
            if (task === currtask) {
                // User is continuing work on task add qty
                currqty += qty;
            } else if (task === "LOGOUT" || task === "LOGIN") {
                // User has logged out or app was quit and user is logging in again.
                let end = moment(time);

                let min = end.diff(start, "minutes");

                if (currtask in report) {
                    report[currtask].qty += currqty;
                    report[currtask].min += min;
                    if (report[currtask].min != 0) {
                        report[currtask].rate = report[currtask].qty / report[currtask].min;
                    }
                } else {
                    report[currtask] = {
                        qty: currqty,
                        min: min,
                        rate: 0
                    };
                    if (report[currtask].min != 0) {
                        report[currtask].rate = report[currtask].qty / report[currtask].min;
                    }
                }
                // Null out current task since user is not working on task
                currtask = null;
                start = null;
                currqty = 0;
            } else {
                // User has started a different task
                let end = moment(time);
                let min = end.diff(start, "minutes");

                if (currtask in report) {
                    report[currtask].qty += currqty;
                    report[currtask].min += min;
                    if (report[currtask].min != 0) {
                        report[currtask].rate = report[currtask].qty / report[currtask].min;
                    }
                } else {
                    report[currtask] = {
                        qty: currqty,
                        min: min,
                        rate: 0
                    };
                    if (report[currtask].min != 0) {
                        report[currtask].rate = report[currtask].qty / report[currtask].min;
                    }
                }
                // Null out current task since user is not working on task
                currtask = task;
                start = end;
                currqty = qty;
            }

        } else {
            // if there is no current task and the user is logging in and out set the first task for the session
            if (task !== "LOGIN" && task !== "LOGOUT") {
                currtask = task;
                start = moment(time);
                currqty = qty;
            }
        }
    }

    if (currtask) {
        // We never got final logout add 30 min to last task
        let min = lasttime.diff(start, "minutes");
        min += 30;
        if (currtask in report) {
            report[currtask].qty += currqty;
            report[currtask].min += min;
            if (report[currtask].min != 0) {
                report[currtask].rate = report[currtask].qty / report[currtask].min;
            }
        } else {
            report[currtask] = {
                qty: currqty,
                min: min,
                rate: 0
            };
            if (report[currtask].min != 0) {
                report[currtask].rate = report[currtask].qty / report[currtask].min;
            }
        }
        // Null out current task since user is not working on task
        currtask = null;
        start = null;
        currqty = 0;
    }


    return report;
}

async function main(daysago) {
    let pool = await db.getPool();

    let sql, args, results;
    let rows = [];
    let report = {};
    let timezoneLocationMap = {};

    // Get Locations by Timezone
    sql = `
        SELECT
            GROUP_CONCAT(ID) AS Locations, Timezone
        FROM location
        GROUP BY Timezone`;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw error;
    }

    for (let result of results) {
        let Locations = result.Locations.split(",");
        let Timezone = result.Timezone;
        let date = moment().tz(Timezone);
        date.subtract(daysago, "days");
        let Date = date.format("YYYY-MM-DD");
        if (Date in timezoneLocationMap) {
            timezoneLocationMap[Date] = [...timezoneLocationMap[Date], ...Locations];
        } else {
            timezoneLocationMap[Date] = [...Locations];
        }
    }

    for (let date in timezoneLocationMap) {
        report[date] = {};
        let logs = await getDynamo(date);

        for (let log of logs) {
            // Check if we are looking at the right timezone
            if (timezoneLocationMap[date].includes(log.LocationID)) {
                // Sort By Location and user
                let location = log.LocationID;
                let user = log.UserID;
                let time = log.DateUTC;
                let task;

                if (log.Type === "task") {
                    // The type is task
                    task = log.TaskType;
                } else {
                    // The type is inventory
                    task = log.Job;
                }

                let qty = 0;
                if (log.Quantity) {
                    qty = +log.Quantity;
                }

                if (location in report[date]) {
                    if (user in report[date][location]) {
                        report[date][location][user].push({
                            time: time,
                            task: task,
                            qty: qty
                        });
                    } else {
                        report[date][location][user] = [{
                            time: time,
                            task: task,
                            qty: qty
                        }];
                    }

                } else {
                    report[date][location] = {};
                    report[date][location][user] = [{
                        time: time,
                        task: task,
                        qty: qty
                    }];
                }
            }
        }
    }

    for (let date in report) {
        for (let location in report[date]) {
            for (let user in report[date][location]) {
                report[date][location][user] = createReport(report[date][location][user]);
                // Parse report into rows
                for (let task in report[date][location][user]) {
                    rows.push([
                        date,
                        location,
                        user,
                        task,
                        report[date][location][user][task].qty,
                        report[date][location][user][task].min,
                        report[date][location][user][task].rate
                    ]);
                }
            }
        }
    }

    if (rows.length) {
        sql = `
            INSERT INTO report_performance (Date, LocationID, UserID, Task, Quantity, Minutes, HourlyRate)
            VALUES ?
            ON DUPLICATE KEY UPDATE
            Quantity = VALUES(Quantity),
            Minutes = VALUES(Minutes),
            HourlyRate = VALUES(HourlyRate)`;
        let args = [rows];

        try {
            await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

}

exports.handler = async (event, context) => {
    configuration = await layerConfig.getConfig(process.env.NODE_ENV);
    AWS.config.update({region: configuration.region});
    dynamodb = new AWS.DynamoDB.DocumentClient({region: configuration.region});
    const slack = configuration.slackHookErrors;
    // This Lambda function may be called from a scheduled CloudWatch event (11:00am UTC),
    // or it may be called from the WMS after a user uploads a new T-Sheet .csv file
    // If it's a scheduled run via CloudWatch, then there will not be a body in the event
    // If it's called from WMS, then it should be sending "daysAgo" in a body
    let daysAgo = 0; // The number of days in the past to begin generating reports; defaults to yesterday

    if (event && "body" in event && "daysAgo" in event["body"]) {
        daysAgo = event["body"]["daysAgo"];
    }

    try {
        // For example, if daysAgo is 3, then Main() will be executed three times
        // Once for yesterday, once for two days ago, and once for three days ago
        for (let i = 0; i <= daysAgo; i++) {
            await main(i);
        }
    } catch (error) {
        console.log(error);
        let text = "ERROR: Performance Report `Lambda: us-west-2`\n";
        text += "```" + error + "```";
        await axios.post(slack, {
            "text": text
        });
    }
};
