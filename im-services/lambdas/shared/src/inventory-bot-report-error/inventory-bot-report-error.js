const wmsDB = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('inventory-bot-report-error'); 

let slackURL, config;
const ToEmailAddresses = ["engineering@anko.com", "emma.toop@kmart.com.au"];

// This lambda is used with an API Gateway to report Inventory Bot errors
//
// Example body:
// {
//     "InventoryBotID": 10,
//     "ErrorMessage": "Inventory Bot exploded like the Death Star"
// }
exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV); 
        slackURL = config.slackHookInventoryBotErrors;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;

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
    let sql, args, results, inventoryBotName, locationID;

    let webhookEventBody = event.body;
    if (!event.body.InventoryBotID) {
        webhookEventBody = JSON.parse(event.body);
    }

    let inventoryBotID = webhookEventBody.InventoryBotID;
    let errorMessage = webhookEventBody.ErrorMessage;

    if (!inventoryBotID) {
        logger.error('ERROR: There was no inventoryBotID');
        return;
    }

    const pool = await wmsDB.getPool();

    sql = `SELECT Name, LocationID FROM inventory_bot WHERE ID = ?`;
    args = [inventoryBotID];

    try {
        [results] = await pool.query(sql, args);
        locationID = results[0].LocationID;
        inventoryBotName = results[0].Name;
    } catch (error) {
        console.log(error);
    }

    let logString = ":no_entry: `inventory-bot-report-error`\n";
    logString += `Inventory Bot ${inventoryBotID} with Name ${inventoryBotName} at Location ${locationID}\n${errorMessage}`;

    logger.error(logString);

    try {
        console.log(slackURL);
        await axios.post(slackURL, {"text": logString});
    } catch (error) {
        console.log(error);
    }

    try {
        // await sendEmail(errorMessage, `Inventory Bot ${inventoryBotName} Error at ${locationID}`);
    } catch (error) {
        console.log(error);
    }
}

async function sendEmail(message, subject) {
    const SES = new AWS.SES();
    let success = false;

    let sendParams = {
        Destination: {
            ToAddresses: ToEmailAddresses
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: message
                }
            },
            Subject: {
                Charset: "UTF-8",
                Data: subject
            }
        },
        Source: "Anko Engineering<engineering@anko.com>"
    };

    try {
        let emailResponse = await SES.sendEmail(sendParams).promise();
        if (emailResponse && emailResponse.MessageId) {
            logger.info('Email succesfully sent');
            success = true;
        } else {
            logger.info('Seems like email failed');
        }
    } catch (err) {
        logger.info('Failed to send email for order', {err});
    }

    return success;
}
