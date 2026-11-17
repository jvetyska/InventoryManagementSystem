
const logger = require('/opt/nodejs/logger.js')('kmart-external:api-gateway-lambda-test'); 
exports.handler = async (event) => {
    logger.info('Incoming Event', {event});

    return {
        "statusCode": 200
    };
};

