const inventoryBotAPIHelper = require("/opt/nodejs/inventoryBotHelper.js");
const logger = require("/opt/nodejs/logger.js")("error-reporting"); 

/**
 *  Input:
 *  
    {
        Input: {
            status: 'RunDataReady',
            inventoryName: '2010-02-01',
            inventoryBotID: '1001',
            mapAreaName: 'Testing',
            location: 'Testing',
            executionName: "26_2021-08-22_12-59-00_RunDataReady"
            error: {
                "Error": "\"Updating Inventory Tory Data Lambda failed\"",
                "Cause": "Missing executionName, inventoryName, Status, location,\n                inventoryName, mapAreaName, locationID, isUpdateInventory or InventoryBotID"
            }
        }
    }
 */


exports.handler = async (event) => {
    logger.startTrace("handler");
    let inventoryBotID, inventoryName, errorMessage, input;
    try {
        logger.info("Input Body", `handler:input`, event);

        if (!event || !event.Input) {
            logger.error("No Input, Ending Error Reporting Lambda", "handler");
            throw new Error(`Error Reporting Lambda: Missing Input Body`);
        }
        input = event.Input;

        if (!Object.prototype.hasOwnProperty.call(input, "status")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryBotID")
            || !Object.prototype.hasOwnProperty.call(input, "inventoryName")
        ) {
            throw new Error(`Missing inventoryName, Status or InventoryBotID`);
        }
        
        logger.info(`Error Reporting for Tory: ${input.inventoryBotID} 
            run: ${input.inventoryName} with status ${input.status}
        `, "handler");

        inventoryBotID = input.inventoryBotID;
        inventoryName = input.inventoryName;
        errorMessage = "";
        if (input.error) {
            logger.info("Step Function Lambda in Error State", "handler");
            errorMessage += `ProcessToryDataStateMachine failed with Error: ${input.error.Cause}`;
        } else if (input.status === "Interrupted") {
            logger.info("Bot Status is Interrupted", "handler");
            errorMessage = `Inventory Bot Run ${inventoryName} has been Interrupted.\n`;
            await inventoryBotAPIHelper.createInterruptedNotification(inventoryBotID, inventoryName);
        } else {
            logger.info("Invalid Input to Error Reporting Lambda", "handler");
            errorMessage += `ProcessToryDataStateMachine failed.`;
        }
        await inventoryBotAPIHelper.reportInventoryBotError(inventoryBotID, errorMessage);
        logger.endTrace("handler");
        return input;
    } catch (error) {
        logger.error("EXIT", "handler", {error: error, input: input});
        throw (`Error Reporting failed ${error}`);        
    }
};
