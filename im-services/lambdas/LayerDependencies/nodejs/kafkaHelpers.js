const { axios } = require("./xray");
const config = require("./config.js");
const logger = require("./logger")("KafkaHelpers");

async function uploadToKafkaTopic(topic, data) {
    logger.startTrace("uploadToKafkaTopic");
    const configuration = await config.getConfig(process.env.NODE_ENV);
    const uploadAPIURL = configuration.kafka.uploadAPIURL;

    // Have to call Kafka Insert API in chunks of 5000
    const kafkaUploadChunkSize = 5000;
    for (let i = 0; i < data.length; i += kafkaUploadChunkSize) {
        const arrayChunk = data.slice(i, i + kafkaUploadChunkSize);

        const body = {
            "topic": topic,
            "data": arrayChunk
        };

        try {
            logger.trace("uploadToKafkaTopic:Kafka");
            await axios.post(uploadAPIURL, body);
        } catch (error) {
            logger.error(error, "uploadToKafkaTopic:Kafka");
            throw new Error(`Calling the kafka upload api failed`);
        }
    }
    logger.endTrace("uploadToKafkaTopic");
}

exports.uploadToKafkaTopic = uploadToKafkaTopic;
