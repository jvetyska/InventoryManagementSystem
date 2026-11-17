/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
const ProxyAPIRequester = require("../library/proxyAPIRequest");
const util = require("util");
const { axios } = require("../library/xray");
const logger = require("../library/logger")("microwarehouse-api:mw_api_debug");

// var obj = new ProxyAPIRequester();
// ProxyAPIRequester.GET(ProxyAPIRequester.ENDPOINT_TYPE.TORY,
//                         "kv1154tr001.kmtltd.net.au/v1/getInventoryDataFile",
//                         {"location": "1154_STR_FMAP3","inventory": "021-03-10_03-00-04"},
//                         {"user-role": "something"});

exports.call_from_kmart_endpoint = async function (req, res) {
    let url = req.body.url;
    let endpointType = req.body.endpointType;
    let http_method = req.body.httpMethod || "GET";
    let postPayload = req.body.postPayload || {};
    let getPayload  = req.body.getPayload || {};
    let data;
    let axiosOptions = {};

    if (!url && !endpointType) {
        return res.status(400).json({"message": "Must include url and endpointType"});
    }

    console.log( "http_method: " + http_method + "getPayload: " + getPayload + ", postPayload: " + postPayload);
    try {
        if (http_method == "GET") {
            if (endpointType == "TORY") {
                axiosOptions.params = getPayload;
                data = await ProxyAPIRequester.get(ProxyAPIRequester.ENDPOINT_TYPE.TORY, url, axiosOptions);
            } else if (endpointType == "STORE") {
                axiosOptions.params = getPayload;
                data = await ProxyAPIRequester.get(ProxyAPIRequester.ENDPOINT_TYPE.STORE, url, axiosOptions);
            } else if (endpointType == "INTEGRATION") {
                axiosOptions.params = getPayload;
                data = await ProxyAPIRequester.get(ProxyAPIRequester.ENDPOINT_TYPE.INTEGRATION, url, axiosOptions);
            }
        } else if (http_method == "POST") {
            if (endpointType == "TORY") {
                axiosOptions.data = postPayload;
                data = await ProxyAPIRequester.post(ProxyAPIRequester.ENDPOINT_TYPE.TORY, url, axiosOptions);
            } else if (endpointType == "STORE") {
                axiosOptions.data = postPayload;
                data = await ProxyAPIRequester.post(ProxyAPIRequester.ENDPOINT_TYPE.STORE, url, axiosOptions);
            } else if (endpointType == "INTEGRATION") {
                axiosOptions.data = postPayload;
                data = await ProxyAPIRequester.post(ProxyAPIRequester.ENDPOINT_TYPE.INTEGRATION, url, axiosOptions);
            }
        }
    } catch (error) {
        // default to 400, get the status if the error response has one
        let errorStatus = 400;
        if (Number.isInteger(error.status)) {
            errorStatus = error.status;
        }

        res.status(errorStatus).json({"response": data});
        return;
    }

    console.log(util.inspect(data, false, 3, false));
    res.status(200).json({"response": data});
};

exports.api_gateway_lambda_test = async function (req, res) {
    let url = req.body.url;
    try {
        const body  = {
            "Message": "Testing the API gateway inside the VPC"
        };
        await axios.post(url, body);
    } catch (error) {
        logger.error("api_gateway_lambda_test:", {error});
        res.status(500).json({"response": "Unable to call API gateway"});
        return;
    }

    res.status(200).json({"response": "API call Successfull!"});
};
