/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const authHelper = require("../library/authHelper");
const helper = require("../library/helperFn");
const featureFlags = require("../config/feature_flags.js");
const path = require("path");
const fs = require("fs");
const logger = require("../library/logger")("microwarehouse-api:mw_api_settings");

exports.get_settings = async function (req, res) {
    let sql, results;

    sql = "SELECT * FROM system_settings";

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": error});
        return;
    }

    let setting_object = {};

    for (let category in settings) {
        for (let property in settings[category]) {
            setting_object[property] = {
                default: settings[category][property],
                category: category
            };
        }
    }

    for (let result of results) {
        if (setting_object[result.Property]) {
            setting_object[result.Property].value = result.Value;
            setting_object[result.Property].type = result.Type;
            if (result.Type === "Array") {
                setting_object[result.Property].value = setting_object[result.Property].value.split(",");
            }
        }
    }



    res.status(200).json({"data": setting_object});
};

exports.put_settings = async function (req, res) {
    let settings  = req.body.settings;
    let user      = authHelper.parseRole(req);
    let sql, args, results;


    sql = `INSERT INTO system_settings (Property, Category, Value, Type, UserUpdated)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        PreviousValue = IF(Value != VALUES(Value), VALUE, PreviousValue),
        Value = VALUES(Value),
        Type = VALUES(Type),
        UserUpdated = VALUES(UserUpdated);`;

    args = [];

    for (let setting of settings) {
        args.push([setting.property, setting.category, setting.value, setting.type, user.id]);
    }

    args = [args];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": error});
        return;
    }

    if (!results.affectedRows) {
        res.status(500).json({"message": "Failed to Update Database"});
        return;
    }

    // NOTE: Only updates system settings for current core. Not sure currently how to update both cores.
    helper.updateSystemSettings();
    res.status(200).json({"message": "Updated System Settings"});
};

exports.get_feature_flags = async function (req, res) {
    let getAllFlags = (req.query.getAllFlags === "true" ? true : false);
    let user = authHelper.parseRole(req);
    let userFlags = {};

    // Non-admins are NOT allowed to get all of the feature flags, so we must
    // block requests from non-admins if they make an attempt to query all flags
    if (getAllFlags && user.isAdmin === false) {
        res.status(401).json({"message": "Unauthorized!"});
        return;
    }

    for (let feature in featureFlags) {
        // If feature is enabled OR the user requested to get all flags (in which they are a verified admin above)
        if (featureFlags[feature] || getAllFlags) {
            userFlags[feature] = featureFlags[feature];
        }
    }

    res.status(200).json(userFlags);
};

exports.db_sql_files = async function (req, res) {
    let sql, args, dbResults, fileDirectoryResults;

    sql = `SELECT File_Name FROM _sql_files ORDER BY DateCreated DESC;`;
    try {
        [dbResults] = await pool.query(sql);
        dbResults = dbResults.map(element => element.File_Name);
    } catch (error) {
        logger.error("db_sql_files", {error});
        res.status(500).json({"message": "Unable to get processed file list from DB, Database Seeding unsuccessful."});
        return;
    }

    let getDirectoryPath =  path.join(__dirname, "../sql");

    if (!fs.existsSync(getDirectoryPath)) {
        res.status(500).json({"message": "Files Directory Path doesn't exits"});
        return;
    }
    fileDirectoryResults = await fs.readdirSync(getDirectoryPath);

    if (!fileDirectoryResults.length) {
        res.status(200).json({"message": "No Files to process!."});
        return;
    }
    // Get the list of new files to process
    let newFilesToProcess = fileDirectoryResults.filter((directoryFileName) => !dbResults.includes(directoryFileName));
    console.debug("New Files to Process for Database Seeding:", newFilesToProcess);

    // Cleanup the DB file, if we cleanup the codebase
    let deleteFileNameFromDB = dbResults.filter((sqlFileName) => !fileDirectoryResults.includes(sqlFileName));
    console.debug("Delete File_Name From Database:", deleteFileNameFromDB);


    if (newFilesToProcess.length) {
        for (let fileName of newFilesToProcess) {
            console.debug(`Starting to process file: ${fileName}`);
            const insertSql = (await fs.readFileSync(`${getDirectoryPath}/${fileName}`)).toString().trim();
            sql = `INSERT INTO _sql_files(File_Name) VALUES (?)`;
            args = [fileName];
            try {
                await pool.query(insertSql);
                await pool.query(sql, args);
            } catch (error) {
                logger.error("db_sql_files(Insert Data From Files)", {error});
                res.status(500).json({"message": `Unable to Process File: ${fileName} Correctly`});
                return;
            }
            console.debug(`Successfully processed file: ${fileName}`);
        }
    }

    if (deleteFileNameFromDB.length) {
        sql = `DELETE FROM _sql_files WHERE File_Name IN (?)`;
        args = deleteFileNameFromDB.join(",");
        try {
            await pool.query(sql, args);
        } catch (error) {
            logger.error("db_sql_files(DELETE From _sql_files)", {error});
            res.status(500).json({"message": `Unable to delete Files Correctly`});
            return;
        }
    }
    res.status(200).json({"message": "Successfully processed All Files"});
};
