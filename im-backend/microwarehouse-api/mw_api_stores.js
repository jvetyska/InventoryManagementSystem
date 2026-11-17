/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
const helper = require("../library/helperFn");
const ProxyAPIRequester = require("../library/proxyAPIRequest");
const logger = require("../library/logger")("microwarehouse-api:mw_api_stores");
exports.env_settings = async function (req, res) {
    let store_id = req.query.store_id || null;
    let STORE_SUFFIX = "-STR";
    let data = {};
    let results, args;
    if (!store_id) {
        return res.status(400).json({"message": "Must include store_id"});
    }
    let getEnvSettingsFromStoreIDSQL = `
            SELECT * from location_env le
            WHERE le.LocationID = ?
    `;
    if (store_id.indexOf(STORE_SUFFIX) == -1) {
        store_id = `${store_id}-STR`;
    }
    args = [store_id];
    try {
        [results] = await pool.query(getEnvSettingsFromStoreIDSQL, args);
        if (results.length > 0) {
            data = results;
        }
    } catch (error) {
        console.log (error);
        return res.status(404).json({"message": "Error occured"});
    }

    res.status(200).json({"response": data});
};
