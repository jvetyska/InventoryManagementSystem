const wmsAPI = require("/opt/nodejs/wmsAPI.js");
const logger = require('/opt/nodejs/logger')('task-management-system-stepfunction:generate-backfill-tasks')

exports.handler = async (event) => {
    logger.startTrace('handler');
    try {
        await main(event);
        logger.info('Event Input', 'handler', {data: event.Input})
        return event.Input;
    } catch (error) {
        logger.error(error, 'handler');
        throw error;
    }
};

async function main(event) {
    logger.startTrace('main');
    const backfillScheduleID = event.Input.backfillScheduleID;

    const body = {
        storeBackfillScheduleID: backfillScheduleID
    };

    try {
        logger.trace('main:wmsAPI.Post')
        let apiResults = await wmsAPI.Post("generate_backfill_replenishment", body);
        logger.debug('Results', 'main:wmsAPI.Post', {data: apiResults.message});
    } catch (error) {
        logger.error(error, 'main:wmsAPI.Post');
        throw error;
    }
}
