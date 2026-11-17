
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS, https } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('kmart-external:image-sync-data'); 


let pool, SLACK_ERRORS, config;

function ToHexString(byteArray) {
  return Array.from(byteArray, function(byte) {
    return ("0" + (byte & 0xFF).toString(16)).slice(-2);
  }).join("");
}

async function SynchronizeProductImages() {
    // 1. TRUNCATE the table import_product_img
    // 2. SELECT all keycodes from import_product which will have their images synchronized
    // 3. In batches of 10,000 keycodes, get the image hashes of each keycode
    // 4. INSERT each keycode/hash combination into the table import_product_img
    let rows, response;

    try {
        await pool.query(`TRUNCATE TABLE import_product_img`);
    } catch (error) {
        console.log(error.message);
        return;
    }

    try {
        [rows] = await pool.query(`SELECT Keycode FROM import_product`);
        console.log(`Fetched ${rows.length} rows`);
    } catch (error) {
        console.log(error.message);
        return;
    }

    while (rows.length) {
        // Process 10,000 keycodes at a time
        let elements = (rows.length < 10000 ? rows.length : 10000);
        let arrayOfObjs = rows.splice(rows.length - elements, elements);
        let keycodes = arrayOfObjs.map((obj) => obj.Keycode);
        let body = {keycodes: keycodes};
        let data;

        try {
            let options = {}
            if (config.hamiltonEnvSslCert) {
                const agent = new https.Agent({
                    rejectUnauthorized: false
                });
                options["httpsAgent"] = agent;
            }
            // Get the image hashes of each keycode using the Kmart API Integration
            console.log(`${config.integrationAPI}/image-sync`);
            response = await axios.post(`${config.integrationAPI}/image-sync`, body, options);
            data = response.data.data;
            logger.info('Data Length', {data.length});
        } catch (error) {
            console.log(error.message);
            return;
        }

        let args = [];

        for (let row of data) {
            let keycode = row.Keycode;
            let imageHash = ToHexString(row.ImageHash.data);
            args.push([
                keycode,
                imageHash
            ]);
        }

        if (args.length) {
            try {
                // INSERT the keycode/image hashes so that they can be checked if they should be uploaded to S3
                await pool.query(`INSERT IGNORE INTO import_product_img (Keycode, ImageHash) VALUES ?`, [args]);
            } catch (error) {
                console.log(error.message);
                return;
            }
        }
    }
}

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slackHookErrors;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;
        pool = await db.getPool();
        await SynchronizeProductImages();
    } catch (error) {
        console.log(error);
        let slackMessage;
        slackMessage = `*Image Sync Data*\n`;
        slackMessage += `:x: Failed: There was an error with Image sync lambda in the ${process.env.NODE_ENV} environment\n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
        throw error;
    }
};
