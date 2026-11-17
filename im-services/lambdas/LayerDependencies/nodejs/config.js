const configJson = require("./config.json");
const { AWS } = require("./xray");
let config = {};
const logger = require('./logger.js')('config'); 

exports.getConfig = (async (env)=> {
    const region = configJson[env].region;
    const secretName = configJson[env].secret_name;

    if (secretName && (!config || !config[env])) {
        try {
            let secret = await new AWS.SecretsManager({region: region}).getSecretValue({SecretId: secretName}).promise();
            secret = JSON.parse(secret.SecretString);

            // This warning can be safely ignored
            // eslint-disable-next-line require-atomic-updates
            config = secret;
        } catch (error) {
            logger.info('From Layers get AWS secret Error', {error});
        }
    }

    return { ...config[env], ...configJson[env] };
});
