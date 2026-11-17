const config = require("/opt/nodejs/config.js");
const { axios, https } = require("/opt/nodejs/xray.js");
const slack = require("./slack.js");
const logger = require('/opt/nodejs/logger.js')('wms-api-call'); 

exports.handler = async (event) => {
    let api         = event.api;
    let requestType = event.request || null;
    let stop        = event.stop;
    let body        = event.body || null;

    try {
        const configuration = await config.getConfig(process.env.NODE_ENV);

        // If you don't want certain CloudWatch rules to run, but you also don't want to
        // delete them, you can give them the property `stop: true` in the constant.
        // This is mainly used for some Dev rules, because I don't want the development
        // server to try to create replenishment tasks automatically
        if (stop) {
            return "OK";
        }

        let options = {
            "headers": {
                "authorization": configuration.system_token
            }
        };
        // Kmart's SSL Cert isn't accepted without this
        if (configuration.hamiltonEnvSslCert) {
            const agent = new https.Agent({
                rejectUnauthorized: false
            });
            options["httpsAgent"] = agent;
        }

        logger.info('Calling API', {api});
        logger.info('RequestType', {requestType});
        if (requestType === "GET") {
            await axios.get(api, options);
        } else if (requestType === "POST") {
            await axios.post(api, body, options);
        } else {
            throw new Error("Request type not defined");
        }
        logger.info('OK');
        await slack.logNotification(`Scheduled WMS API call was sucessful: ${api}`);
        return "OK";
    } catch (error) {
        console.log(error);
        await slack.errors(JSON.stringify(`WmsApiCall failed to call API ${api}`));
        return "ERROR";
    }
};
