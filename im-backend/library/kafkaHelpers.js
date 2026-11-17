const { axios } = require("./xray");
const logger = require("./logger")("library:kafkaHelpers");

async function uploadToKafkaTopic(topic, data) {
    const uploadAPIURL = config.kafka.uploadAPIURL;

    // Have to call Kafka Insert API in chunks of 5000
    const kafkaUploadChunkSize = 5000;
    for (let i = 0; i < data.length; i += kafkaUploadChunkSize) {
        const arrayChunk = data.slice(i, i + kafkaUploadChunkSize);

        const body = {
            "topic": topic,
            "data": arrayChunk
        };

        try {
            await axios.post(uploadAPIURL, body);
        } catch (error) {
            logger.error("uploadToKafkaTopic", {error});
            throw error;
        }
    }
}

exports.uploadToKafkaTopic = uploadToKafkaTopic;
