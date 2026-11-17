const { axios } = require("/opt/nodejs/xray.js");
const getConfig = require("/opt/nodejs/config.js");

exports.logNotification = async function(text) {
    let config = await getConfig.getConfig(process.env.NODE_ENV);
    await Main(text, config.logNotification);
};

exports.errors = async function(text) {
    let config = await getConfig.getConfig(process.env.NODE_ENV);
    await Main(text, config.slackHookErrors);
};

async function Main(text, webhook) {
    await axios.post(webhook, {"text": text});
}
