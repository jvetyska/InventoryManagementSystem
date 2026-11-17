const { AWS } = require("./xray");
const sqs = new AWS.SQS({apiVersion: "2012-11-05"});
const stepfunctions = new AWS.StepFunctions();
const logger = require("./logger")("awsApiHelper");

exports.sendSqsMessage = async (sqsUrl, sqsPayload, options) => {
    logger.startTrace("sendSqsMessage");
    let params = {
        MessageBody: JSON.stringify(sqsPayload),
        QueueUrl: sqsUrl
    };

    if (options) {
        params = Object.assign(options, params);
    }
    logger.info("Input Message Body for SQS", "sendSqsMessage", params);
    try {
        await sqs.sendMessage(params).promise();
    } catch (error) {
        logger.error(error, "sendSqsMessage");
        throw error;
    }
    logger.endTrace("sendSqsMessage");
};

exports.startStateMachineExeuction = async (stateMachineArn, input, options) => {
    logger.startTrace("startStateMachineExeuction");

    let params = {
        stateMachineArn: stateMachineArn,
        input: JSON.stringify(input)
    };

    if (options) {
        params = Object.assign(options, params);
    }

    try {
        logger.info("Starting execution with Params", "startStateMachineExeuction:input", params);
        await stepfunctions.startExecution(params).promise();
    } catch (error) {
        logger.error(error, "startStateMachineExeuction");
        throw error; 
    }
    logger.endTrace("startStateMachineExeuction");
};

exports.sendTaskSuccessAndResumeExecution = async (taskToken, output) => {
    logger.startTrace("sendTaskSuccessAndResumeExecution");

    const params = {
        "taskToken": taskToken,
        "output": JSON.stringify(output)
    };

    try {
        logger.info("Resume execution with Params", "sendTaskSuccessAndResumeExecution:output", params);
        await stepfunctions.sendTaskSuccess(params).promise();
    } catch (error) {
        logger.error(error, "sendTaskSuccessAndResumeExecution");
        throw error; 
    }
    logger.endTrace("sendTaskSuccessAndResumeExecution");
};

exports.sendTaskFailureAndStopExecution = async (taskToken, cause, error) => {
    logger.startTrace("sendTaskFailureAndStopExecution");

    const params = {
        "taskToken": taskToken,
        "cause": cause,
        "error": JSON.stringify(error)
    };

    try {
        logger.info("Resume execution with Params", "sendTaskFailureAndStopExecution:output", params);
        await stepfunctions.sendTaskFailure(params).promise();
    } catch (error) {
        logger.error(error, "sendTaskFailureAndStopExecution");
        throw error; 
    }
    logger.endTrace("sendTaskFailureAndStopExecution");
};