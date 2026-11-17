const wmsDB = require("/opt/nodejs/wmsDB.js");
const { axios } = require("/opt/nodejs/xray.js");

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
    // await get_locations();
    await streamToSnowflake();
}

async function get_locations(){
    let sql, results;

    try {
        sql = `
        SELECT ID AS locationID FROM location;
        `;

        [results] = await pool.query(sql);
        console.log(results);
        return results;
    } catch (error) {
        console.log("Error in get_locations():", error);
        throw error;
    }
}

async function get_wmsdb_and_send_data(mdu, args, mduResults){
    try {
        [mduResults] = await pool.query(mdu, args);   
        console.log(mduResults);
        await uploadToKafkaTopic("product_mdu", mduResults);
    } catch (error) {
        console.log("Error in get_wmsdb_and_send_data():", error);
        throw error;
    }
}

async function streamToSnowflake() {
    console.log(`Adding data to kafka`);

    let sql, results, mdu, mduResults, args;
    
    let locations = await get_locations();

    try {
        for (let i = 0; i < locations.length; i++){
            // console.log(locations[i].locationID);
            mdu = `
                SELECT
                    current_date() as Date,
                    p.Keycode,
                    loc.ID AS LocationID,
                    calc_mdu(pm.MDU, loc.StoreDefaultMDU, pm.PDU, pm.DateStartPDU, pm.DateEndPDU, fm.MDU) AS MDU
                FROM product p
                CROSS JOIN location loc
                LEFT JOIN product_mdu pm ON p.Keycode = pm.Keycode AND loc.ID = pm.LocationID
                LEFT JOIN product_attr pa ON pa.Keycode = pm.Keycode
                LEFT JOIN fixture_mdu fm ON pa.Fixture_Code = fm.Fixture_Code AND loc.ID = fm.LocationID
                WHERE loc.ID = ?
                ;`;
                args = [locations[i].locationID];
                await get_wmsdb_and_send_data(mdu, args, mduResults);
        }
    } catch (error) {
        console.log("ERROR: streamToSnowflake", error);
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
            console.log("ERROR: uploadToKafkaTopic", error);
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