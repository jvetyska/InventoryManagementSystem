/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const { axios, https } = require("./xray");
axios.defaults.validateStatus = false;
const config = require("./config");
const logger = require("./logger.js")("wmsAPI"); 

async function main(api, body, call) {
    const configuration = await config.getConfig(process.env.NODE_ENV);
    const apiBase = configuration.api_base;
    const token = configuration.system_token;
    const uri = apiBase + api;

    const options = {
        "headers": {"authorization": token}
    };

    // Kmart's SSL Cert isn't accepted without this
    if (configuration.hamiltonEnvSslCert) {
        const agent = new https.Agent({
            rejectUnauthorized: false
        });
        options["httpsAgent"] = agent;
    }

    let result;
    try {
        switch (call) {
        case "GET":
            options["params"] = body;
            result = await axios.get(uri, options);
            result = result.data.data;
            break;
        case "POST":
            result = await axios.post(uri, body, options);
            result = result.data;
            break;
        case "PUT":
            result = await axios.put(uri, body, options);
            result = result.data;
            break;
        case "DELETE":
            options["params"] = body;
            result = await axios.delete(uri, options);
            result = result.data;
            break;
        default:
            logger.error('Not supported HTTP command', {call});
            return;
        }
    } catch (error) {
        console.log(error);
        throw error;
    }

    return result;
}

/**
 * Calls the wms APIs using GET.
 *
 * Calls any of the WMS apis that use the GET axios syntax and returns the data to the use abstracting the process.
 *
 * @param String api The string of the api you want to call missing the starting / example: "replenish_order_to_task".
 * @param Object body The body that you want to pass to the wms function.
 *
 * @return Usually Returns Array of Objects.
 */
exports.Get = async function (api, body) {
    return await main(api, body, "GET");
};

/**
 * Calls the wms APIs using POST.
 *
 * Calls any of the WMS apis that use the POST axios syntax and returns the data to the use abstracting the process.
 *
 * @param String api The string of the api you want to call missing the starting / example: "replenish_order_to_task".
 * @param Object body The body that you want to pass to the wms function.
 *
 * @return Usually Returns Array of Objects.
 */
exports.Post = async function (api, body) {
    return await main(api, body, "POST");
};

/**
 * Calls the wms APIs using PUT.
 *
 * Calls any of the WMS apis that use the PUT axios syntax and returns the data to the use abstracting the process.
 *
 * @param String api The string of the api you want to call missing the starting / example: "replenish_order_to_task".
 * @param Object body The body that you want to pass to the wms function.
 *
 * @return Usually Returns Array of Objects.
 */
exports.Put = async function (api, body) {
    return await main(api, body, "PUT");
};

/**
* Calls the wms APIs using DELETE.
*
* Calls any of the WMS apis that use the DELETE axios syntax and returns the data to the use abstracting the process.
*
* @param String api The string of the api you want to call missing the starting / example: "replenish_order_to_task".
* @param Object body The body that you want to pass to the wms function.
*
* @return Usually Returns Array of Objects.
*/
exports.Delete = async function (api, body) {
    return await main(api, body, "DELETE");
};


//main("get_product", {"ProductID":42818564}, "GET");
