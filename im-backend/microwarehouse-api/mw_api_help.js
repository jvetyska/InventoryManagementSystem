/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
const helper = require("../library/helperFn");
var authHelper = require("../library/authHelper");
const logger = require("../library/logger")("microwarehouse-api:mw_api_help");

exports.get_glossary = async function(req, res) {
    let sql, args, results;
    sql = `SELECT ID, Title, Description, DateCreated, DateUpdated FROM help_glossary ORDER BY Title`;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        return res.status(500).json({"message": `Error while getting glossary terms`});
    }

    if (results.length) {
        res.status(200).json({"data": results});
    } else {
        res.status(404).json({"message": `No glossary terms available`});
    }
};

exports.post_glossary = async function(req, res) {
    let ID = parseInt(req.body.ID) || null;
    let Title = req.body.Title;
    let Description = req.body.Description;

    let sql, args, results;

    if (ID == null) {
        sql = `INSERT INTO help_glossary (Title, Description) VALUES (?)`;
        args = [[Title, Description]];
        try {
            [results] = await pool.query(sql, args);
            res.status(200).json({"message": `Successfully created glossary record`});
        } catch (error) {
            return res.status(500).json({"message": `Error occured while inserting the glossary record`});
        }
    }
    else
    {
        sql = `
            UPDATE help_glossary
            SET
                Title = ?,
                Description = ?
            WHERE ID = ?`;
        args = [Title, Description,ID];
        try {
            [results] = await pool.query(sql, args);
            res.status(200).json({"message": `Successfully updated the term`});
        } catch (error) {
            console.log(error);
            return res.status(500).json({"message": `Error occured while updating the glossary record`});
        }
    }
};

exports.delete_glossary = async function(req, res) {
    let glossaryId = parseInt(req.query.glossaryId) || null;
    let sql, args;

    if (glossaryId == null) {
        return res.status(400).json({"message": `glossary id is required for the term to be deleted`});
    }

    sql = `DELETE from help_glossary where ID = ?`;
    args = [glossaryId];

    try {
        await pool.query(sql, args);
        res.status(200).json({"message": `Successfully Deleted term`});
    } catch (error) {
        res.status(500).json({"message": `Error while attempting to delete the term`});
    }
};

// Note New Functions Look at possibly remove functions above

exports.get_help_files = async function(req, res) {
    let type = req.query.Type;
    let sql, args, results;

    sql = `SELECT * FROM help_files`;
    args = [];

    if (type) {
        sql = sql + " WHERE Type = ?";
        args = [type];
    }

    sql = sql + " ORDER BY DisplayOrder";


    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_help_video: ", {error});
        res.status(500).json({"message": `Error getting help files.`});
        return;
    }

    if (results.length) {
        res.status(200).json({"data": results});
    } else {
        res.status(404).json({"message": `No help files found!`});
    }
};

exports.get_help_file = async function(req, res) {
    let ID = req.query.ID;
    let sql, args, results;

    sql = `SELECT * FROM help_files WHERE ID = ?`;
    args = [ID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("get_help_video: ", {error});
        res.status(500).json({"message": `Error getting help files.`});
        return;
    }

    if (results.length) {
        res.status(200).json({"data": results[0]});
    } else {
        res.status(404).json({"message": `File not found!`});
    }
};

exports.update_file_order = async function(req, res) {
    let displayOrder = req.body.displayOrder;
    let sql, args;
    sql = ``;
    args = [];

    for (let order of displayOrder) {
        sql += `UPDATE help_files SET displayOrder = ? WHERE ID = ?; `;
        args.push(order.DisplayOrder, order.ID);
    }


    try {
        await pool.query(sql, args);
        res.status(200).json({"message": `Order Changed Successfully`});
        return;
    } catch (error) {
        logger.error("update_file_order: ", {error});
        res.status(500).json({"message": `Error updating order.`});
        return;
    }
};

exports.upload_help_file = async function(req, res) {
    const bucket    = config.s3_bucket.wms_assets;
    const bucketURL = config.StoreFilesWithDomain ? config.base_url : "" + config.s3_bucket.wms_assets_url;
    let file        = req.file; // The File to Upload
    let type        = req.body.type; // The Type of file either document or video
    let format      = req.body.format; // The Format of the file
    let name        = req.body.fileName;
    let desc        = req.body.description || "";
    let order       = req.body.order || 1;

    let response, sql, args;

    // look at naming issue.
    let filename = file.originalname;
    filename = filename.replace(/\s/g, "_");

    let key =`help/${filename}`;
    let params;
    if (config.isKmartEnvironment) {
        params = {
            "ACL": "public-read"
        };
    }


    try {
        response = await helper.uploadFileToS3(bucket, key, file["buffer"], false, params);
    } catch (err) {
        logger.error("upload_help_file: ", {error: err.message});
        if (err.statusCode) {
            res.status(err.statusCode).json({"message": err.message});
        } else {
            res.status(500).json({"message": "File Failed To Upload"});
        }
        return;
    }


    if (!response) {
        logger.error("upload_help_file: ", {error: "File Failed To Upload."});
        res.status(500).json({"message": "File Failed To Upload."});
        return;
    }


    if (config.isDevelopment) {
        key = "_DEV_" + key;
    }

    let url = `${bucketURL}/${key}`;

    sql = "INSERT INTO help_files (Filename, `Key`, FileURL, Type, Format, DisplayOrder, Description) VALUES (?, ?, ?, ?, ?, ?, ?)";

    args = [name, key, url, type, format, order, desc];

    try {

        await pool.query(sql, args);
        res.status(200).json({"message": `Successfully created or updated file ${filename}`});
        return;
    } catch (error) {
        logger.error("upload_help_file: ", {error});
        res.status(500).json({"message": `Error uploading file.`});
        return;
    }

};

exports.update_file = async function(req, res) {
    let filename = req.body.filename;
    let description = req.body.description;
    let ID = req.body.ID;
    let sql, args;

    if (!ID || !filename) {
        return res.status(400).json({"message": `ID and Name is required`});
    }

    sql = `UPDATE help_files SET Filename = ?, Description = ? WHERE ID = ?; `;
    args = [filename, description, ID];

    try {
        await pool.query(sql, args);
        res.status(200).json({"message": `File Updated Successfully`});
        return;
    } catch (error) {
        logger.error("update_file_order: ", {error});
        res.status(500).json({"message": `Error updating order.`});
        return;
    }
};

exports.delete_help_file = async function(req, res) {
    let fileID = parseInt(req.query.fileID) || null;
    let fileName = req.query.fileName || null;
    const locationMapBucketName = config.s3_bucket.wms_assets;
    let sql, args;

    if (!fileID || !fileName) {
        return res.status(400).json({"message": `ID and Name is required for the file to be deleted`});
    }

    try {
        await helper.deleteFileInS3(locationMapBucketName, fileName);
    } catch (err) {
        logger.error("delete_help_file: ", {err});
        res.status(500).json({"message": err});
        return;
    }

    sql = `DELETE from help_files where ID = ?`;
    args = [fileID];

    try {
        await pool.query(sql, args);
        res.status(200).json({"message": `Successfully Deleted file`});
    } catch (error) {
        res.status(500).json({"message": `Error while attempting to delete the file`});
    }
};

exports.add_help_watched = async function(req, res) {

    let user = authHelper.parseRole(req);
    let UserID = user.id;
    let HelpfileID = req.body.HelpfileID;
    let sql, args, results;

    args = [[UserID, HelpfileID, 1]];
    if (UserID) {

        sql = `INSERT IGNORE INTO help_watched(UserID, HelpfileID, Watched) VALUES (?)`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("help_watched", {error});
            res.status(500).json({"message": `Error while attempting to create help watched`});
            return;
        }
    }

    sql = `UPDATE help_files
           SET Views = Views + 1
           WHERE ID = ?`;

    args = [HelpfileID];

    try {
        [results] = await pool.query(sql, args);
        res.status(200).json({"message": `Successfully updated help_files`});
    } catch (error) {
        logger.error("help_files", {error});
        res.status(500).json({"message": `Error while attempting to update help files`});
        return;
    }

};

exports.get_training_data = async function(req, res) {
    let sql, args, results;

    sql = `SELECT  CONCAT(u.FirstName , ' ' , u.LastName)  as Fullname,
                    hf.Filename,
                    hf.Views
            FROM help_files as hf
            LEFT JOIN help_watched hw ON hw.HelpFileID = hf.ID
            LEFT JOIN user u on u.ID = hw.UserID
            WHERE hf.Filename is NOT NULL`;
    args = [];

    try {
        [results] = await pool.query(sql, args);
        res.status(200).json({"message": `Successfully retrieved training info`,
            "data":results });
    } catch (error) {
        logger.error("help_watched", {error});
        res.status(500).json({"message": `Error while attempting to get training data`});
        return;
    }
};
