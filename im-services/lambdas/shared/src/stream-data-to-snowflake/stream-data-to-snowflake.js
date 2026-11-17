const wmsDB = require("/opt/nodejs/wmsDB.js");
const { axios } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('stream-data-to-snowflake'); 

const getConfig = require("/opt/nodejs/config.js");
let SLACK_ERRORS, config, pool;

exports.handler = async () => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        SLACK_ERRORS = config.slackHookErrors;
        await main();
    } catch (error) {
        console.log(error);
        await slackNotification(error);
    }
};

async function main() {
    pool = await wmsDB.getPool();
    await streamToSnowflake();
}

async function streamToSnowflake() {
    console.log(`Adding data to kafka`);

    let sql, results;

    sql = `
        SELECT
            bph.*, 
            ib.LocationID 
        FROM inventory_bot ib 
        INNER JOIN bot_process_history  bph ON ib.ID = bph.InventoryBotID
        WHERE bph.DateUpdated >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            ia.*,
            c.LocationID
        FROM inventory_adjustment ia 
        INNER JOIN container c ON c.id = ia.ContainerID
        WHERE ia.DateCreated >= NOW() - INTERVAL 15 MINUTE
            OR ia.DateCompleted >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            rp.*
        FROM report_performance rp
        WHERE rp.DateUpdated >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            sis.*
        FROM store_inventory_snapshot sis
        WHERE sis.DateCreated >= NOW() - INTERVAL 15 MINUTE
            OR sis.DateCompleted >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            t.*,
            tg.SourceLocation AS LocationID
        FROM task t 
        INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
        WHERE t.DateCreated >= NOW() - INTERVAL 15 MINUTE
            OR t.DateCompleted >= NOW() - INTERVAL 15 MINUTE
            OR t.DateFulfilled >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            tg.ID, 
            tg.SourceLocation AS LocationID, 
            tg.TargetLocation, 
            tg.DateDue, 
            tg.Priority, 
            tg.Type, 
            tg.CartType, 
            tg.ReferenceID, 
            tg.DateCreated, 
            tg.DateCompleted, 
            tg.DateFulfilled, 
            tg.isRestricted, 
            tg.isReserve, 
            tg.AssignedUserID, 
            tg.DateUserAssigned, 
            tg.Name, 
            tg.Source
        FROM task_group tg
        WHERE tg.DateCreated >= NOW() - INTERVAL 15 MINUTE
            OR tg.DateCompleted >= NOW() - INTERVAL 15 MINUTE
            OR tg.DateFulfilled >= NOW() - INTERVAL 15 MINUTE
            OR tg.DateUserAssigned >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            hw.*
        FROM help_watched hw
        WHERE hw.DateViewed >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            u.ID,
            u.Username,
            u.FirstName,
            u.LastName,
            u.DefaultLocation,
            u.isSSO
        FROM user u
        WHERE u.AccountCreated >= NOW() - INTERVAL 15 MINUTE
            OR u.AccountLastLoggedIn >= NOW() - INTERVAL 15 MINUTE
            OR u.lastCreated >= NOW() - INTERVAL 15 MINUTE
            OR u.lastDeleted >= NOW() - INTERVAL 15 MINUTE
        ;
        SELECT
            loc.*
        FROM location loc
        ;
    `;

    try {
        [results] = await pool.query(sql);
    } catch (error) {
        logger.error('streamToSnowflake getting wmsDB', {error});
        throw error;
    }

    const topics= [
        "bot_process_history",
        "inventory_adjustment",
        "performance",
        "store_inventory_snapshot",
        "task",
        "task_group",
        "help_watched",
        "user",
        "location"
    ];

    try {
        for (let i = 0; i < topics.length; i++) {
            await uploadToKafkaTopic(topics[i], results[i]);
        }
    } catch (error) {
        logger.error('streamToSnowflake', {error});
        throw new Error(`Error while uploading data to Kafka`);
    }
}

async function uploadToKafkaTopic(topic, data) {
    config = await getConfig.getConfig(process.env.NODE_ENV);
    const uploadAPIURL = config.kafka.uploadAPIURL;

    // Have to call Kafka Insert API in chunks of 5000
    const kafkaUploadChunkSize = 5000;
    for (let i = 0; i < data.length; i += kafkaUploadChunkSize) {
        const arrayChunk = data.slice(i, i + kafkaUploadChunkSize);

        const body = {
            "topic": topic,
            "data": arrayChunk
        };

        try {
            await axios.post(uploadAPIURL, body);
        } catch (error) {
            logger.error('uploadToKafkaTopic', {error});
            throw error;
        }
    }
}

const slackNotification = async (error) => {
    let slackMessage = `*stream data to Snowflake*\n`;
    slackMessage += `:x: Failed: There was an error streaming data to Snowflake\n`;
    slackMessage += "```" + error + "```";
    console.log(slackMessage);
    try {
        await axios.post(SLACK_ERRORS, {text: slackMessage});
    } catch (error) {
        console.log(error);
        throw error;
    }
};