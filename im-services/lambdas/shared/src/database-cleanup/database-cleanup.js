const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS } = require("/opt/nodejs/xray.js");
const moment = require("moment-timezone");
const logger = require('/opt/nodejs/logger.js')('database-cleanup'); 

const dynamodb = new AWS.DynamoDB.DocumentClient();
const dynamo = new AWS.DynamoDB();
let pool, SLACK_NOTIFICATIONS, SLACK_ERRORS, config;

/* To configure which DynamoDB tables should have old data pruned, include an environment variable starting
 * with DYNAMO_TABLE_ and have the value be the name of the DynamoDB table. For example, DYNAMO_TABLE_1 = task_log
 */
let configurationDynamoDB = [];

/* To configure which MySQL tables should have old data pruned, create an object with the exact three necessary properties:
 *  - table: The name of the table that will have old data pruned
 *  - column: The name of the column within the table which determines how old the row is
 *  - days: All rows that are older than this will be removed from the table
 */
const configurationMySQL = [
    {
        table: "inventory_rfid_history",
        column: "DateCreated",
        days: 28
    },{
        table: "task",
        column: "DateCreated",
        days: 62
    },{
        table: "task_group",
        column: "DateCreated",
        days: 62
    },{
        table: "bot_process_history",
        column: "DateCreated",
        days: 365
    },{
        table: "bot_process_status",
        column: "DateCreated",
        days: 365
    },{
        table: "replenishment_log",
        column: "Date",
        days: 62
    },{
        table: "report_performance",
        column: "Date",
        days: 62
    },{
        table: "inventory_adjustment",
        column: "DateCreated",
        days: 62
    },{
        table: "inventory_history",
        column: "DateCreated",
        days: 62
    },{
        table: "filtered_epc_tags",
        column: "DateCreated",
        days: 62
    },{
        table: "kmart_inventory_snapshot",
        column: "DateCreated",
        days: 7
    }
];

async function GetDynamoTableData() {
    for (let variable in process.env) {
        if (variable.includes("DYNAMO_TABLE_")) {
            let table = process.env[variable];
            let params = {TableName: table};
            let partitionKey, sortKey, results, slackMessage;

            try {
                results = await dynamo.describeTable(params).promise();
            } catch (error) {
                logger.error('ERROR: database-cleanup Lambda Function');
                console.log(error);

                try {
                    slackMessage = `*Database Cleanup*\n`;
                    slackMessage += `:x: Failed: There was an error describing a DynamoDB table \`${table}\`\n`;
                    slackMessage += "```" + error + "```";
                    await axios.post(SLACK_NOTIFICATIONS, {text: slackMessage});
                } catch (error) {
                    console.log(error);
                }

                return;
            }

            for (let obj of results.Table.KeySchema) {
                let keyName = obj.AttributeName;
                let keyType = obj.KeyType;

                if (keyType === "HASH") {
                    partitionKey = keyName;
                } else {
                    sortKey = keyName;
                }
            }

            configurationDynamoDB.push({
                table: table,
                partitionKey: partitionKey,
                sortKey: sortKey
            });
        }
    }
}

async function ValidateConfigurations() {
    let slackMessage;

    for (let i of configurationDynamoDB) {
        // Sanity check to make sure that the current object has all of the required properties
        if (!("table" in i) || !("partitionKey" in i) || !("sortKey" in i)) {
            try {
                slackMessage = `*Database Cleanup*\n`;
                slackMessage += ":x: Failed: At least one of these properties are missing: `table`, `partitionKey`, `sortKey`. Make sure all three are defined";
                await axios.post(SLACK_NOTIFICATIONS, {text: slackMessage});
            } catch (error) {
                logger.error('ERROR: database-cleanup Lambda Function');
                console.log(error);
            }

            return;
        }
    }

    for (let i of configurationMySQL) {
        // Sanity check to make sure that the current object has all of the required properties
        if (!("table" in i) || !("column" in i) || !("days" in i)) {
            try {
                slackMessage = `*Database Cleanup*\n`;
                slackMessage += ":x: Failed: At least one of these properties are missing: `table`, `column`, `days`. Make sure all three are defined";
                await axios.post(SLACK_NOTIFICATIONS, {text: slackMessage});
            } catch (error) {
                logger.error('ERROR: database-cleanup Lambda Function');
                console.log(error);
            }

            return;
        }
    }
}

async function CleanupDynamoDatabases() {
    // Data in DynamoDBs will be kept for up to an entire year
    let response, slackMessage;
    let results = [];
    let yearAgo = moment.utc().subtract(365, "days").format("YYYY-MM-DD");
    let params = {
        "TableName": "", // TableName will be set when looping through tables
        "KeyConditionExpression": "#Date = :currentDay",
        "ExpressionAttributeNames": {}, // ExpressionAttributeNames will be set when looping through tables
        "ExpressionAttributeValues": {
            ":currentDay": yearAgo
        }
    };

    /* There are some factors that will make deleting old data from DynamoDB slow/expensive
     * 1. You MUST specify both the Partition Key AND the Sort Key in order to delete an item
     * 2. While the Partition Key will be the date 365 days ago, we don't know what the Sort Keys are
     *    and therefore need to perform a query on the table first before we can delete the items
     * 3. You can only delete up to 25 items in one query
     */

    for (let i of configurationDynamoDB) {
        // Sanity check to make sure that the current object has all of the required properties
        if (!("table" in i) || !("partitionKey" in i) || !("sortKey" in i)) {
            try {
                slackMessage = `*Database Cleanup*\n`;
                slackMessage += ":x: Failed: At least one of these properties are missing: `table`, `partitionKey`, `sortKey`. Make sure all three are defined";
                await axios.post(SLACK_NOTIFICATIONS, {text: slackMessage});
            } catch (error) {
                logger.error('ERROR: database-cleanup Lambda Function');
                console.log(error);
            }

            return;
        }

        params["TableName"] = i.table;
        params["ExpressionAttributeNames"]["#Date"] = i.partitionKey;

        // Scan the table until all items have been evaluated
        do {
            response = await dynamodb.query(params).promise();
            results = [...results, ...response.Items];
            let pagination = response.LastEvaluatedKey;
            params.ExclusiveStartKey = pagination;
        } while (response.hasOwnProperty("LastEvaluatedKey"));

        // Now that all items have been evaluated and the results to be deleted are stored,
        // they may now be deleted since we'll have both the partition key and sort key
        let params2 = {
            RequestItems: {}
        };

        // Query 25 deletes at a time until there are no more results to process
        while (results.length) {
            // The AWS SDK can only delete up to 25 items in a single query
            let items = results.splice(0, 25);

            // The second params variable must have a property dynamically set to the current table which is an array
            params2["RequestItems"][i.table] = [];

            // Push up to 25 delete requests which require both the partition key and sort key
            for (let item of items) {
                params2["RequestItems"][i.table].push({
                    DeleteRequest: {
                        Key: {
                            Date: item[i.partitionKey],
                            UUID: item[i.sortKey]
                        }
                    }
                });
            }

            // batchWrite is the best AWS SDK method to use for batch-deleting records in DynamoDB
            await dynamodb.batchWrite(params2).promise();
        }
    }
}

async function CleanupMysqlDatabases() {
    let args = [];
    let sqlCollection = [];
    let sql;

    // Loop through every object of configurationMySQL,
    for (let i of configurationMySQL) {
        // Note that tables and columns must be specified and can't be passed in as an argument with a question mark
        sqlCollection.push(`DELETE FROM ${i.table} WHERE DATE(${i.column}) < CURDATE() - INTERVAL ? DAY`);
        args.push(i.days);
    }

    // Create the SQL query, get the connection pool, and execute the query
    sql = sqlCollection.join(";");
    pool = await db.getPool();

    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        throw error;
    }
}

// Clean up for not finished tasks is a bit more complicated so do the queries in this function
async function CleanupTasks() {
    let sql;

    sql = `
        # Delete old Inventory tasks which have a ReferenceID (coming from backfill schedule ID)
        DELETE t FROM task t
        INNER JOIN task_group tg ON t.TaskGroupID = tg.ID
        WHERE
            t.Type = 'Inventory'
            AND tg.ReferenceID IS NOT NULL
            AND t.DateCompleted IS NULL
            AND t.DateCreated < NOW() - INTERVAL 12 HOUR
        ;
        # Update tasks groups to complete if they have no remaining unfinished tasks
        UPDATE task_group tg
        LEFT JOIN task t ON tg.ID = t.TaskGroupID AND t.DateCompleted IS NULL
        SET
            tg.DateCompleted = IFNULL(tg.DateCompleted, NOW()),
            tg.DateFulfilled = NOW()
        WHERE
            t.ID IS NULL
            AND tg.DateCompleted IS NULL
    `;

    try {
        await pool.query(sql);
    } catch (error) {
        console.log(error);
        throw error;
    }
}

async function SlackNotification() {
    let slackMessage = `*Database Cleanup*\n`;
    slackMessage += `:heavy_check_mark: Succeeded\n`;
    slackMessage += `${configurationDynamoDB.length} DynamoDB tables checked\n`;
    slackMessage += `${configurationMySQL.length} MySQL tables checked\n`;

    try {
        await axios.post(SLACK_NOTIFICATIONS, {text: slackMessage});
    } catch (error) {
        console.log(error);
        slackMessage = `*Database Cleanup*\n`;
        slackMessage += `:x: Failed: There was an error cleaning up databases\n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
    }
}

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slackHookErrors;
        SLACK_NOTIFICATIONS = config.slackHookNotifications;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;

        await GetDynamoTableData();
        await ValidateConfigurations();
        await CleanupDynamoDatabases();
        await CleanupMysqlDatabases();
        await CleanupTasks();
        await SlackNotification();
    } catch (error) {
        console.log(error);
        let slackMessage;
        slackMessage = `*Database Cleanup*\n`;
        slackMessage += `:x: Failed: There was an error cleaning up databases in the ${process.env.NODE_ENV} environment\n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
        throw error;
    }
};
