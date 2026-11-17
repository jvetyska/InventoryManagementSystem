const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS, https } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('kmart-external:image-sync-s3'); 

let pool, s3, config, SLACK_ERRORS;

function DoTask(row) {
    return new Promise(async (resolve) => {
        if (row === undefined) {
            logger.info('row is undefined');
            resolve();
            return;
        }
        let keycode = row.Keycode;
        let imageHash = row.ImageHash;
        let response, data, imageData;
        try {
            const agent = new https.Agent({
                rejectUnauthorized: false
            });
            response = await axios.get(`${config.integrationAPI}/image-sync?keycode=${keycode}`, { httpsAgent: agent });

            // We can only process one image at a time, so get the 0th index. The data from this will be something like:
            // { Keycode: 5344352, Image: { type: "Buffer", data: [Array] } }
            data = response.data.data[0];

            // Get the binary image data from the above data
            imageData = data.Image.data;
        } catch (error) {
            logger.error('ERROR when getting an image from Kmart's SQL Database');
            console.log(error.message);
            resolve(false);
        }
        // Get the binary image data from the response data
        // let binaryImageData = data.Image.data;
        // Upload the image file to Anko's S3 bucket
        // Update the image hash in Anko's database so that it is now up-to-date
        let imageBuffer = Buffer.from(imageData, "hex");
        let key = `product/${keycode}.jpg`;
        let params = {
            Bucket: config.bucket.imageSync,
            Key: key,
            Body: imageBuffer,
            ContentType: "image/jpeg"
        };

        if (!config.hamiltonEnvSslCert) {
            params["ACL"] = "public-read"
        }

        try {
            let s3Response = await s3.upload(params).promise();
            console.log(s3Response.Key + " uploaded");
        } catch (error) {
            logger.error('Error while uploading data to s3');
            console.log(error.message);
            return;
        }

        let args = [keycode, imageHash];
        let sql = `INSERT INTO product_img (Keycode, ImageHash) VALUES (?, ?) ON DUPLICATE KEY UPDATE ImageHash = ImageHash`;

        try {
            await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            return;
        }
        resolve();
    });
}

async function Parallel(processing) {
    let tasks = [];

    for (let i = 0; i < processing.length; i++) {
        tasks.push(DoTask(processing[i]));
    }

    await Promise.all(tasks);
}

async function UploadImagesToS3() {
    // Three main steps to synchronizing the product images
    // 1. TRUNCATE the table import_product_img
    // 2. INSERT data into the two above tables for importing
    // 3. UPDATE/INSERT to the main tables import_product and import_product_attr
    let rows;
    let sql = `
        SELECT
            ipi.Keycode,
            ipi.ImageHash
        FROM import_product_img ipi
        LEFT JOIN product_img p ON p.Keycode = ipi.Keycode
        WHERE ipi.ImageHash != p.ImageHash OR p.ImageHash IS NULL`;

    // Get all keycodes that are out-of-date and need to be updated
    try {
        [rows] = await pool.query(sql);
        console.log(`Fetched ${rows.length} rows`);
    } catch (error) {
        console.log(error);
        return;
    }
    // The number of parallel requests for images that will be made in one batch to Kmart
    let parallelExecutions = 20;
    while (rows.length) {
        // Reduce the amount of parallel executions if there are a smaller amount of rows to process
        if (parallelExecutions > rows.length) {
            parallelExecutions = rows.length;
        }
        let processing = rows.splice(rows.length - parallelExecutions, parallelExecutions);
        await Parallel(processing);
    }
}

exports.handler = async (event) => {
    s3 = new AWS.S3({apiVersion: "2006-03-01"});
    pool = await db.getPool();

    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slackHookErrors;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;

        await UploadImagesToS3();
    } catch (error) {
        console.log(error);
        let slackMessage;
        slackMessage = `*Image Sync s3*\n`;
        slackMessage += `:x: Failed: There was an error with image sync lambda in the ${process.env.NODE_ENV} environment\n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
    }

    // Update all IMAGE_PRIMARY columns from the product_img table to the product table with a single SQL call
    let sql = `
            UPDATE product p
            INNER JOIN product_img pi USING (Keycode)
            SET p.IMAGE_PRIMARY = CONCAT('${config.imagePrimaryColumnURL}/', p.Keycode, '.jpg');`;

    try {
        await pool.query(sql);
    } catch (error) {
        console.log(error);
    }
};
