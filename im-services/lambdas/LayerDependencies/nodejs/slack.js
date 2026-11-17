const TAG = "slack-reporting";
const { axios } = require("./xray");
const config = require("./config");
const logger = require("./logger.js")(TAG);
exports.report = async function (processName , slackChannel, statusCode, message) {
    const fnName = "report()";
    try {
        logger.startTrace(fnName);
        const configValues = await config.getConfig(process.env.NODE_ENV);
        let slackReportingURL = configValues.slackReportingURL;
        let data = {
            "processName": processName,
            "statusCode": statusCode,
            "message": message,
            "slackChannel": slackChannel
        };
        await axios.post(slackReportingURL, data);
        logger.startTrace(fnName);
        return {"statusCode": 200};
    } catch (err) {
        logger.error("slack.js: ", err);
    }
};

