const TAG = "generic-slack-reporting: ";
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS, https } = require("/opt/nodejs/xray.js");
const logger = require("/opt/nodejs/logger.js")(TAG);

let pool, SLACK_CHAN, config;


// https://api.slack.com/messaging/webhooks#advanced_message_formatting
async function reportToSlack(procName, channel, statusCode, message ) {
    const fnName = "reportToSlack";
    try {
        logger.startTrace(fnName);
        if (statusCode == 200) {
            message = `:white_check_mark: *${procName}*\n ${message}`;
        } else {
            message = `:red_circle: *${procName}*\n ${message}`;
        }
        await axios.post(channel, {"text": message});
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}

exports.handler = async (event) => {
    const fnName = "handler";
    try {
        logger.startTrace(fnName);
        config = await getConfig.getConfig(process.env.NODE_ENV);
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;
        let eventBody = event.body || null;
        if (!eventBody) {
            throw new Error("api gateway called with no event body");
        }
        logger.info(TAG, eventBody);
        eventBody = JSON.parse(eventBody);
        let statusCode = eventBody.statusCode || 400;
        let message = eventBody.message || null;
        let processName = eventBody.processName || "";
        SLACK_CHAN = eventBody.slackChannel || config.genericSlackReportingHook;
        if (!message) {
            throw new Error("api gateway called without any message body");
        }
        await reportToSlack(processName, SLACK_CHAN, statusCode, message)
        logger.endTrace(fnName);
        return {"StatusCode": 200};
    } catch (err) {
        logger.error(`${TAG}:${fnName}`, err);
        return {"Status": 500, "error": err.message};
    }
};


