const { AWS, axios } = require("../library/xray");
const moment = require("moment-timezone");
AWS.config.update({region: config.aws_region});
const dynamodb = new AWS.DynamoDB.DocumentClient({region: config.aws_region});
const logger = require("../library/logger")("microwarehouse-api:mw_api_performance_reporting");

let tableNameTaskLog      = config.dynamodb.task_log;
let tableNameInventoryLog = config.dynamodb.inventory_log;

async function GetTaskLog(day) {
    let response;
    let results = [];
    let pagination = {};
    let params = {
        "TableName": tableNameTaskLog,
        "KeyConditionExpression": "#Date = :currentDay",
        "ExpressionAttributeNames": {
            "#Date": "Date"
        },
        "ExpressionAttributeValues": {
            ":currentDay":  day
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

async function GetInventoryLog(day) {
    let response;
    let results = [];
    let pagination = {};
    let params = {
        "TableName": tableNameInventoryLog,
        "KeyConditionExpression": "#Date = :currentDay",
        "ExpressionAttributeNames": {
            "#Date": "Date"
        },
        "ExpressionAttributeValues": {
            ":currentDay": day
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

async function GeneratePerformanceReportData(day) {
    // 1. Get information from the DynamoDB tables inventory_log and task_log
    // 2. Parse the data and store it into the MySQL table: report_performance
    let taskLogs, inventoryLogs, sql, args, results;
    let report = [];
    let map = {}; // {BEL1: "BEL1-STR"}
    let users = {};
    let timeline = {};
    let fif_task_map = {
        "task_update_complete": "w-pick",
        "w-create-case-inventory": "w-receive-to-stow"
    };

    // Get data from the task_log and inventory_log DynamoDB tables according to the current day that's being checked
    taskLogs = await GetTaskLog(day);
    inventoryLogs = await GetInventoryLog(day);

    // Parse the data after pulling it
    taskLogs.sort(function compare(a, b) {
        var dateA = new Date(a["DateStart"]);
        var dateB = new Date(b["DateStart"]);
        return dateA - dateB;
    });

    for (let log of taskLogs) {
        let user = log.UserID;
        let task = log.TaskType;
        let time = log.DateStart;
        let location = log.LocationID; // BEL1-STR, FIF1-WRH, LYN2-STR, etc
        let locationIdPrefix = location.split("-")[0]; // BEL1, FIF1, LYN2, etc

        // If the location id prefix doesn't exist in the map, create a key/value pair in the map
        if (!(locationIdPrefix in map)) {
            map[locationIdPrefix] = location;
        }

        if (location in timeline) {
            if (user in timeline[location]) {
                let start = moment(timeline[location][user]["start"]);
                let end = moment(time);
                let seconds = end.diff(start, "s");
                let currentTask = timeline[location][user]["currentTask"];

                // Special case if the current task is starting their shift
                if (currentTask == "SHIFT_START") {
                    if (!("UNKNOWN" in timeline[location][user])) {
                        timeline[location][user]["UNKNOWN"] = {seconds: 0, units: 0};
                    }

                    timeline[location][user]["UNKNOWN"]["seconds"] += seconds;
                    timeline[location][user]["currentTask"] = task;
                    timeline[location][user]["start"] = time;

                    if (!(task in timeline[location][user])) {
                        timeline[location][user][task] = {seconds: 0, units: 0};
                    }

                    continue;
                }

                timeline[location][user][currentTask]["seconds"] += seconds;
                timeline[location][user]["currentTask"] = task;
                timeline[location][user]["start"] = time;

                if (!(task in timeline[location][user])) {
                    timeline[location][user][task] = {seconds: 0, units: 0};
                }
            } else {
                timeline[location][user] = {};
                timeline[location][user]["currentTask"] = task;
                timeline[location][user]["start"] = time;
                timeline[location][user][task] = {seconds: 0, units: 0};
            }
        } else {
            timeline[location] = {};
            timeline[location][user] = {};
            timeline[location][user]["currentTask"] = task;
            timeline[location][user]["start"] = time;
            timeline[location][user][task] = {seconds: 0, units: 0};
        }
    }

    for (let log of inventoryLogs) {
        let locationFrom = log.From.split("-");
        let locationTo = log.To.split("-");
        let user = log.UserId;
        let task = log.Process;
        let type = log.Type;
        let qty = log.Quantity;

        if (log.UserId == 0 || log.UserId == undefined) {
            continue;
        }

        // Add in inventory task and delete continue
        if (task == "w-inventory-task" && type == "DELETE") {
            continue;
        }

        locationFrom = locationFrom[0];
        locationTo = locationTo[0];

        if (locationFrom == "FIF1") {
            if (task in fif_task_map) {
                task = fif_task_map[task];
            }
        }

        if (locationTo == "FIF1") {
            if (task in fif_task_map) {
                task = fif_task_map[task];
            }
        }

        if (locationFrom in map) {
            let location = map[locationFrom];
            if (user in timeline[location]) {
                if (task in timeline[location][user]) {
                    timeline[location][user][task].units += qty;
                } else {
                    if (locationTo in map) {
                        location = map[locationTo];
                        if (user in timeline[location]) {
                            if (task in timeline[location][user]) {
                                timeline[location][user][task].units += qty;
                            } else {
                                continue;
                            }
                        }
                    } else {
                        continue;
                    }
                }
            } else {
                if (locationTo in map) {
                    location = map[locationTo];
                    if (user in timeline[location]) {
                        if (task in timeline[location][user]) {
                            timeline[location][user][task].units += qty;
                        } else {
                            continue;
                        }
                    }
                } else {
                    continue;
                }
            }
        } else if (locationTo in map) {
            let location = map[locationTo];
            if (user in timeline[location]) {
                if (task in timeline[location][user]) {
                    timeline[location][user][task].units += qty;
                } else {
                    continue;
                }
            }
        } else {
            continue;
        }
    }

    for (let location in timeline) {
        for (let user in timeline[location]) {
            let currentTask = timeline[location][user]["currentTask"];

            if (timeline[location][user][currentTask]["seconds"] == 0) {
                let start = moment(timeline[location][user].end);
                let end = moment(timeline[location][user].end).add(30, "minute");
                let seconds = end.diff(start, "s");
                timeline[location][user][currentTask]["seconds"] = seconds;
            }
        }
    }

    try {
        [results] = await ro_pool.query(`SELECT ID, Username FROM user`);
    } catch (error) {
        throw error;
    }

    for (let result of results) {
        users[result.ID] = result.Username;
    }

    for (let location in timeline) {
        for (let user in timeline[location]) {
            for (let task in timeline[location][user]) {
                // Skip over these properties as they are no longer needed
                if (["currentTask", "start", "SHIFT_START", "SHIFT_END", "BREAK_START", "BREAK_END"].includes(task)) {
                    continue;
                }

                // As a fallback, use the UserID as the username if it wasn't found in the users map
                let username, userId;
                let hourlyRate = 0;
                let estimated = 1; // True

                if (users[user] == undefined) {
                    username = user;
                    userId = null;
                } else {
                    username = users[user];
                    userId = parseInt(user);
                }

                // To see if this performance report is estimated, simply check to see if the UNKNOWN task/property exists
                if ("UNKNOWN" in timeline[location][user]) {
                    estimated = 0; // False
                }

                // Prevent a divide by zero error, which would give the result "NaN"
                if (timeline[location][user][task].seconds/60/60 != 0) {
                    hourlyRate = timeline[location][user][task].units / (timeline[location][user][task].seconds/60/60);
                }

                report.push({
                    Date: day,
                    HourlyRate: hourlyRate,
                    LocationID: location,
                    Seconds: timeline[location][user][task].seconds,
                    Task: task,
                    Quantity: timeline[location][user][task].units,
                    UserID: userId,
                    Username: username,
                    Estimated: estimated
                });
            }
        }
    }

    if (report.length == 0) {
        return; // There was nothing to report for this date
    }

    sql = `INSERT INTO report_performance (Date, HourlyRate, LocationID, Seconds, Task, Quantity, UserID, Username, Estimated) VALUES ?`;
    args = [[]];

    for (let item of report) {
        args[0].push([
            item["Date"],       // "09/18/2020"
            item["HourlyRate"], // 22.026078234704112
            item["LocationID"], // "LYN1-WRH"
            item["Seconds"],    // 9800
            item["Task"],       // "w-pick"
            item["Quantity"],   // 45
            item["UserID"],     // "123"
            item["Username"],   // "john.doe"
            item["Estimated"]   // 0
        ]);
    }

    try {
        // Delete old reporting data first, and then insert the new data
        await pool.query(`DELETE FROM report_performance WHERE Date = ?`, [day]);
        [results] = await pool.query(sql, args);
    } catch (error) {
        throw error;
    }
}

exports.generate_performance_report_data = async function(req, res) {
    // This will be called from a scheduled CloudWatch event (once every hour)

    try {
        // Generate performance report data all days that currently exist across all timezones.
        // For the current UTC day, extend the hours to the earliest and latest timezones. This will guarantee
        // at least two different days that need to be checked in DynamoDB. Potentially three days because
        // the earliest timezone is UTC-12 and the latest is UTC+14 (Samoa) which is a 26-hour difference
        let days = [];
        days.push(moment().utc().utcOffset("GMT-12:00").format("YYYY-MM-DD")); // Earliest time
        days.push(moment().utc().utcOffset("GMT+00:00").format("YYYY-MM-DD")); // Current time
        days.push(moment().utc().utcOffset("GMT+14:00").format("YYYY-MM-DD")); // Latest time
        days = [...new Set(days)]; // Remove duplicate "days" that appear in the array

        for (let day of days) {
            await GeneratePerformanceReportData(day);
        }
    } catch (error) {
        console.log(error);
        let text = "ERROR: Performance Report\n";
        text += "```" + error + "```";
        await axios.post(config[process.env.NODE_ENV].slackHookErrors, {"text": text});
    }

    res.status(200).json({"message": "Performance report data has been generated"});
};
