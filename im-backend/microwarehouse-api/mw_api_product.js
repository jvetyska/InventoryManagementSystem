/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const apiRequest = require("../library/apiRequest");
const authHelper = require("../library/authHelper");
const helper = require("../library/helperFn");
const moment = require("moment");
const stream = require("stream");
const { AWS, axios } = require("../library/xray");
const csvConverter = require("json-2-csv");
const csvtojson = require("csvtojson");
AWS.config.update({region: config.aws_region});
const s3 = new AWS.S3({apiVersion: "2006-03-01"});
const logger = require("../library/logger")("microwarehouse-api:mw_api_product");

exports.get_product = async function (req, res) {
    let Keycode = req.query.Keycode || null;
    let ProductID = req.query.ProductID || null; // Product ID can be anything: Keycode or Barcode.
    let LocationID = req.query.LocationID || ""; // Optional Location to get MDU value
    let sql, args, results, baseResult;

    // This API is versatile and can search products by Keycode, Barcode or case barcode.

    if (Keycode) { // Keycode field to be removed soon. There is no need to ask the front end to figure this out.
        ProductID = Keycode;
    }
    if (!ProductID) {
        res.status(400).json({"message": `You must provide ProductID! It can be a barcode or keycode.`});
        return;
    }

    sql = `call ${config.sql_database_for_sp}.get_product(?, ?)`;
    args = [ProductID, LocationID];

    try {
        // The get_product stored procedure only calls SELECT queries, so it's safe to execute on the read-only DB
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_product:", {error});
        res.status(500).json({"message": "Error while retriving product information"});
        return;
    }

    if (!results[0].length) {
        res.status(404).json({"message": `No product was found for ${ProductID}, Please try again or contact your administrator.`});
        return;
    }

    baseResult = results[0][0]; // all results are arrays, get the first item.

    if (baseResult.Barcode && !baseResult.Keycode) { // Case details, add second result as Contents.
        baseResult.Contents = results[1];
        res.status(200).json({"data": results[0]});
    } else { // Product details.
        baseResult.MDUdata = results[1];
        baseResult.DiscountData = results[2];
        res.status(200).json({"data": results[0]}); // still return as array
    }
};

exports.search_product = async function (req, res) {
    let searchTerm = req.query["product_name"];
    let locationId = req.query["locationId"];
    searchTerm = searchTerm.trim();

    let sql, args, results;

    if (searchTerm == "") {
        res.status(400).json({"message": "You must provide product keywords to search for."});
        return;
    }

    // Support for searching for Keycode:
    if (parseInt(searchTerm) == searchTerm) {
        // If entire searchTerm is an Integer, consider it a Keycode.
        searchTerm = parseInt(searchTerm);
        sql = `
        SELECT p.APN, p.Keycode, p.Product_Name, pd.Name AS Department_Name, IMAGE_PRIMARY,
            p.Online_Name, p.Style_ID, p.Item_Size, p.Secondary_Colour
        FROM product p
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        LEFT JOIN product_pricing pp
            ON p.keycode = pp.keycode AND pp.LocationID = ?
        WHERE p.Keycode = ?`;
        args = [locationId, searchTerm];
    } else {
        sql = `
        SELECT p.APN, p.Keycode, p.Product_Name, pd.Name AS Department_Name, IMAGE_PRIMARY,
            p.Online_Name, p.Style_ID, p.Item_Size, p.Secondary_Colour,
            MATCH (Product_Name,Online_Name) AGAINST(? IN BOOLEAN MODE) as Score
        FROM product p
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        LEFT JOIN product_pricing pp
            ON p.keycode = pp.keycode AND pp.LocationID = ?
        HAVING Score > 0
        order by Score DESC LIMIT 50;`;
        args = [searchTerm, locationId];
    }
    // Cut off the http: from the Image to avoid https issues
    try {
        [results] = await ro_pool.query(sql, args);
        if (!results.length) {
            res.status(404).json({"message": "No products were found for the given product name(s)"});
        } else {
            res.status(200).json({"data": results});
        }
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": "Error while searching for product"});
    }
};

exports.blacklist_product_from_csv = async function (req, res) {
    // Reject if a file was NOT uploaded
    if (req.file == undefined) {
        var message = "Nothing was selected to upload; please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }
    var file = req.file;
    // if (file.mimetype != "text/csv") {
    //     res.status(400).json({"message": "File rejected; please submit a .csv file"});
    //     return;
    // }
    //var input = fs.readFileSync(file["path"], "utf-8").replace(/[\r\n]+/g, "\n");

    let user = authHelper.parseRole(req);

    let file_name_for_s3 = `Blacklist_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBackupBucket = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3:", {file_name_for_s3});
    helper.uploadFileToS3(csvBackupBucket, file_name_for_s3, file["buffer"]);

    console.log(`${moment().format()} BLACKLIST UPLOAD started by ${user.id}`);
    // Read the uploaded file and remove duplicate newlines from it, otherwise it will have issues parsing the text
    var input = file["buffer"].toString("utf-8").replace(/[\r\n]+/g, "\n");

    //var data = await csvtojson({"checkColumn": true}).fromString(input);
    var data = await csvConverter.csv2jsonAsync(input); // Unable to use due to bug parsing commas.

    //fs.unlink(file["path"], function() {logger.info("file deleted");});
    if (data.length == 0) {
        res.status(400).json({"message": "No data was found in the .csv file. Please check it and make sure it's valid."});
        return;
    }
    //logger.info("data: :", {data});
    // Sample csv header:
    // Retail_Zone_ID, Department Name,	Class Name, Sub Class Name, Keycode, Product Name, BEL1-STR, MIL1-STR, ..., Blacklist Start, Blacklist End
    // The requirement is, that either specific Keycode is provided (other fields don't matter),
    //   OR one or more of the other fields are specified, and all the supplied fields must match the product
    //   - for example, if DepartmentID = 020 and Retail_Zone_ID = 'Z05', only products matching both is blacklisted.
    let blackList = []; // DB Schema: Location, Keycode, Class_Name, DepartmentID, Retail_Zone_ID
    let keyarr = Object.keys(data[0]);
    let stores = [];
    for (let key of keyarr) {
        key = key.toUpperCase();
        if (key.match(/-STR$/g)) {
            stores.push(key);
        }
    }
    for (let row in data) {
        // process the dates, as they don't change for each store:
        let dateStart = helper.trimVal(data[row]["Start Date"]);
        let dateEnd   = helper.trimVal(data[row]["End Date"]);
        let exception = helper.trimVal(data[row]["Exception"]);
        let comment   = helper.trimVal(data[row]["Comment"]);
        let program   = helper.trimVal(data[row]["Program"]);

        // logger.info("DateStart ", dateStart, ", DateEnd ", {dateEnd});
        // format("YYYY-MM-DD")
        // checking if dateStart is not null
        if (dateStart != null) {
            dateStart = moment(dateStart, "L"); // Local date format
            dateStart = dateStart.isValid() ? dateStart.format() : null;
        }
        if (dateEnd != null) {
            dateEnd = moment(dateEnd, "L"); // Local date format
            dateEnd = dateEnd.isValid() ? dateEnd.format() : null;
        }

        // We don't want if startDate is after end Date
        if (dateStart && dateEnd && dateStart > dateEnd ) {
            logger.info("dateStart > dateEnd ", dateStart, " ", {dateEnd });
            continue;
        }

        let storecount = 0;

        // The Program attribute is stand alone. When it is used, then other hierarchical data must be cleared out
        if (program != null) {
            console.info("Wiping out hierarchical details for ", data[row]["Program"]);
            data[row]["Class Name"] = "";
            data[row]["Sub Class Name"] = "";
            data[row]["DepartmentID"] = "";
            data[row]["Retail_Zone_ID"] = "";
        }

        for (let key in stores) {
            key = stores[key];
            let val = data[row][key];
            let item = null;
            let rowList = [];
            if (val && val != "") {

                // for each checked store, Select fields in order of specificity and leave all others null.
                rowList.push(key);
                rowList.push(item = helper.checkEmpty(data[row]["Keycode"]));
                item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Class Name"]));
                item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Sub Class Name"]));
                item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["DepartmentID"]));
                item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Retail_Zone_ID"]));

                rowList.push(program);
                rowList.push(comment);
                // start date and end date:
                rowList.push(dateStart);
                rowList.push(dateEnd);
                if (exception != null) {
                    rowList.push(1);
                } else {
                    rowList.push(0);
                }

                blackList.push(rowList);
                storecount++;
            }
        }
        if (storecount === 0) {
            let item = null;
            let rowList = [];
            rowList.push(null);
            rowList.push(item = helper.trimVal(data[row]["Keycode"]));
            item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Class Name"]));
            item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Sub Class Name"]));
            item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["DepartmentID"]));
            item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Retail_Zone_ID"]));
            item ? rowList.push(null) : rowList.push(helper.trimVal(data[row]["Program"]));
            rowList.push(comment);
            // start date and end date:
            rowList.push(dateStart);
            rowList.push(dateEnd);
            if (exception != null) {
                rowList.push(1);
            } else {
                rowList.push(0);
            }
            blackList.push(rowList);
        }
    }

    // console.table(blackList);

    if (!blackList.length) {
        res.status(400).json({"message": "No selected stores found in the .csv file."});
        return;
    }
    let sql  = `TRUNCATE product_blacklist_raw;`;
    let sql2 = `INSERT INTO product_blacklist_raw (LocationID, Keycode, Class_Name, Sub_Class_Name, DepartmentID, Retail_Zone_ID, Program, Comment, DateStart, DateEnd, Exception) VALUES ?;`;

    let args = blackList;
    try {
        await pool.query(sql);
        await helper.largeSQLQuery(sql2, args);
        console.log(`${moment().format()} BLACKLIST UPLOAD Completed by ${user.id}`);
        console.log(`blacklist_product_from_csv - total ${blackList.length} rows inserted (from ${data.length} rows of csv).`);
        // Immediately call blacklist_product_update that will generate proper blacklist values.
        apiRequest.post(req, "blacklist_product_update");

        let message = `${data.length} rows from csv file are now in black list.`;
        res.status(200).json({"message": message});
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to insert blacklist data from csv file."});
        logger.info("blacklist_product_from_csv ERROR: ", {error});
    }
};

exports.blacklist_product_csv = async function(req, res) {
    let sql, sql2, results, locations, data, row;

    // First, select all the distinct locations that will be used in the csv.
    sql = `SELECT DISTINCT LocationID FROM product_blacklist_raw WHERE LocationID is not null`;
    // Select everything from Blacklist Raw and backfill details from Product Table. Group Locations into one field.

    sql2 = `
    SELECT IFNULL(bl.Retail_Zone_ID, p.Retail_Zone_ID) as Retail_Zone_ID, IFNULL(bl.DepartmentID, p.DepartmentID) as DepartmentID,
        IFNULL(bl.Class_Name, p.Class_Name) as Class_Name, IFNULL(bl.Sub_Class_Name, p.Sub_Class_Name) as Sub_Class_Name,
        IFNULL(bl.Program, p.Program) as Program, IFNULL(bl.Keycode, p.Keycode) as Keycode, p.Product_Name,
        DATE_FORMAT(DateStart,'%m/%d/%Y') as DateStart, DATE_FORMAT(DateEnd,'%m/%d/%Y') as DateEnd, GROUP_CONCAT(LocationID) as Locations, bl.Exception, bl.Comment
    FROM product_blacklist_raw bl
    INNER JOIN product p ON p.Keycode = bl.Keycode
    GROUP BY bl.Retail_Zone_ID, bl.DepartmentID, bl.Sub_Class_Name, bl.Class_Name, bl.Keycode, bl.Program, bl.Exception`;

    try {
        [locations] = await ro_pool.query(sql);
        [results] = await ro_pool.query(sql2);
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to generate blacklist csv file."});
    }
    // Loop through results and save everything into data for csv:
    data = [];
    for (let i in results) {
        // Retail_Zone_ID	Department Name	Class Name Sub Class Name	Keycode	Product Name	BEL1-STR	MIL1-STR	LYN1-STR	ONLINE-STR	Blacklist Start	Blacklist End
        let exception = null;
        if (results[i]["Exception"]) {
            exception = "x";
        }

        row = {
            "Retail_Zone_ID": results[i]["Retail_Zone_ID"],
            "DepartmentID": results[i]["DepartmentID"],
            "Class Name": results[i]["Class_Name"],
            "Sub Class Name": results[i]["Sub_Class_Name"],
            "Program": results[i]["Program"],
            "Keycode": results[i]["Keycode"],
            "Product Name": results[i]["Product_Name"],
            "Exception": exception
        };
        for (let loc in locations) {
            let location = locations[loc].LocationID;
            if (results[i].Locations == null) {
                row[location] = null;
            } else if (results[i].Locations.indexOf(location) >= 0) {
                row[location] = "X";
            } else {
                row[location] = null;
            }
        }
        row["Start Date"] = results[i]["DateStart"];
        row["End Date"] = results[i]["DateEnd"];
        row["Comment"] = results[i]["Comment"];
        data.push(row);
    }
    let fileData = await csvConverter.json2csvAsync(data, {emptyFieldValue: ""});
    let fileName = "Blacklist_" + moment(moment.now()).format("YYYY-MM-DD") + ".csv";
    fileData = Buffer.from(fileData); //, "base64");
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);

    //res.json({"status": "OK"});
};

exports.get_product_blacklist = async function(req, res) {
    let sql = "SELECT * FROM product_blacklist_raw";

    try {
        let [results] = await ro_pool.query(sql);
        if (!results.length) {
            res.json({"message": "Blacklist is empty."});
        } else {
            res.json({"data": results});
        }
    } catch (error) {
        res.status(400).json({"message": "Error while trying to retrieve the black list."});
        logger.info("get_product_blacklist ERROR: ", {error});
    }
};

exports.blacklist_product_update = async function(req, res) {
    // Process RAW blacklist and populate different product_blacklist table that is easy to query.
    // THIS IS A PROBLEM, SO SLOW IT IS NON-FUNCTIONAL
    let sql = `
    TRUNCATE product_blacklist;
    INSERT INTO product_blacklist (LocationID, Keycode)
    SELECT DISTINCT q.LocationID, q.Keycode FROM (
        select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
        from product_blacklist_raw bl
        INNER JOIN product p on p.Retail_Zone_ID = bl.Retail_Zone_ID
        WHERE bl.DepartmentID is null AND bl.LocationID is not null AND bl.Exception = 0
    UNION
        select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
        from product_blacklist_raw bl
        INNER JOIN product p on p.DepartmentID = bl.DepartmentIDID
        WHERE bl.Class_Name is null AND bl.LocationID is not null AND bl.Exception = 0
    UNION
        select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
        from product_blacklist_raw bl
        INNER JOIN product p on p.Class_Name = bl.Class_Name AND p.DepartmentID = bl.DepartmentID
        WHERE bl.Sub_Class_Name is null AND bl.Keycode is null AND bl.LocationID is not null AND bl.Exception = 0
    UNION
        select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
        from product_blacklist_raw bl
        INNER JOIN product p on p.Sub_Class_Name = bl.Sub_Class_Name AND p.Class_Name = bl.Class_Name AND p.DepartmentID = bl.DepartmentID
        WHERE bl.Keycode is null AND bl.LocationID is not null AND bl.Exception = 0
    UNION
        select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
        from product_blacklist_raw bl
        INNER JOIN product p on p.Program = bl.Program
        WHERE bl.Keycode is null AND bl.LocationID is not null AND bl.Exception = 0
    UNION
        select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
        from product_blacklist_raw bl
        inner JOIN product p ON p.Keycode = bl.Keycode
        WHERE bl.LocationID is not null AND bl.Exception = 0
    ) as q
    left Join (
		SELECT DISTINCT LocationID, Keycode FROM (
			select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
			from product_blacklist_raw bl
			INNER JOIN product p on p.Retail_Zone_ID = bl.Retail_Zone_ID
			WHERE bl.DepartmentID is null AND bl.LocationID is not null AND bl.Exception = 1
		UNION
			select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
			from product_blacklist_raw bl
			INNER JOIN product p on p.DepartmentID = bl.DepartmentID
			WHERE bl.Class_Name is null AND bl.LocationID is not null AND bl.Exception = 1
		UNION
			select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
			from product_blacklist_raw bl
			INNER JOIN product p on p.Class_Name = bl.Class_Name AND p.DepartmentID = bl.DepartmentID
			WHERE bl.Sub_Class_Name is null AND bl.Keycode is null AND bl.LocationID is not null AND bl.Exception = 1
		UNION
			select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
			from product_blacklist_raw bl
			INNER JOIN product p on p.Sub_Class_Name = bl.Sub_Class_Name AND p.Class_Name = bl.Class_Name AND p.DepartmentID = bl.DepartmentID
            WHERE bl.Keycode is null AND bl.LocationID is not null AND bl.Exception = 1
        UNION
            select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
            from product_blacklist_raw bl
            INNER JOIN product p on p.Program = bl.Program
            WHERE bl.Keycode is null AND bl.LocationID is not null AND bl.Exception = 1
		UNION
			select distinct bl.LocationID, p.Keycode, bl.DateStart, bl.DateEnd
			from product_blacklist_raw bl
			inner JOIN product p ON p.Keycode = bl.Keycode
			WHERE bl.LocationID is not null AND bl.Exception = 1
		) as w
    ) as w on w.LocationID = q.LocationID and w.Keycode = q.Keycode
    WHERE w.LocationID is null
    AND (q.DateStart IS NULL OR DATE(q.DateStart) < DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')))
    AND (q.DateEnd is NULL OR DATE(q.DateEnd) >  DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')));`;
    // Note: This needs to be fixed if used in kmart
    try {
        let [results] = await pool.query(sql);
        console.log(moment().format("YYYY-MM-DD HH:mm:ss"), `BLACKLIST_product_update - total ${results[1].affectedRows} rows inserted into blacklist.`);
        let message = `Total of ${results[1].affectedRows} rows are now in the BlackList.`;
        res.status(200).json({"message": message});
        // Immediate call replenishment_order cleanup:
        apiRequest.get(req, "close_inactive_replenish_orders");
    } catch (error) {
        res.status(400).json({"message": "Error while updating BlackList data!"});
        return;
    }
};

exports.update_product_mdu = async function(req, res) {
    let Keycode = req.body.Keycode;
    let LocationID = req.body.LocationID;
    let MDU = parseInt(req.body.MDU) || 0;
    let isExtAisle = req.body.EXT;
    let user = authHelper.parseRole(req);

    if (isExtAisle == undefined) {
        isExtAisle = false;
    }

    let sql, args, message;
    if (Keycode == null || LocationID == null) {
        res.status(400).json({"message": "Keycode, LocationID and MDU are required"});
        return;
    } else if (!LocationID.match(/-STR$/)) {
        res.status(400).json({"message": "MDU can only be set for Items in Stores!"});
        return;
    } else if (MDU < 0 || MDU > settings.validation.maxQtyOverride ||
              (MDU > settings.validation.maxQuantity && settings.validation.maxQtyOverrideList.indexOf(Keycode) < 0)) {
        message = `MDU can only be between 0-${settings.validation.maxQuantity} for most items!`;
        res.status(400).json({"message": message});
        return;
    }

    sql = `
        INSERT INTO product_mdu (Keycode, LocationID, MDU, isExtAisle, UserID, DateCustomUpdated) VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
        PreviousMDU = MDU,
        Keycode = VALUES(Keycode),
        LocationID = VALUES(LocationID),
        MDU = VALUES(MDU),
        isExtAisle = VALUES(isExtAisle),
        UserID = VALUES(UserID),
        DateCustomUpdated = VALUES(DateCustomUpdated)`;
    args = [Keycode, LocationID, MDU, isExtAisle, user.id];
    try {
        await pool.query(sql, args);
        console.log(`MDU for ${Keycode} in ${LocationID} was UPDATED to ${MDU} by ${user.id}.`);
        res.status(200).json({"message": `MDU for ${Keycode} in ${LocationID} was UPDATED to ${MDU}.`});
    } catch (error) {
        logger.info("update_product_mdu ERROR:", {error});
        res.status(400).json({"message": `Updating MDU for ${Keycode} in ${LocationID} to ${MDU} has failed!`});
    }
};

exports.get_fixture_mdu = async function(req, res) {
    let LocationID = req.query.LocationID || null;
    let sql, args, results;

    if (!LocationID) {
        res.status(400).json({"message": `LocationID is required.`});
        return;
    }

    // Temporary Reversion to avoid db changes use default
    LocationID = "DEFAULT"

    sql = `SELECT pa.Fixture_Code, f.MDU
    FROM product_attr pa
    LEFT JOIN fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code
    AND f.LocationID = ?
    WHERE pa.Fixture_Code IN ('R','E','F','T')
    GROUP BY pa.Fixture_Code `;

    args = [LocationID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("get_fixture_mdu:", {error});
        res.status(500).json({"message": "Error while retriving fixture mdu information"});
        return;
    }

    const codeToReadable = {
        "R": "Hanging",
        "F": "Flat Deck",
        "T": "Table",
        "E": "End"
    };

    results.forEach(datum => {
        datum.Fixture_Readable = codeToReadable[datum.Fixture_Code];
    });

    res.status(200).json({"data": results});
};

exports.upsert_fixture_mdu = async function(req, res) {
    let data = req.body.data || null;
    let LocationID = req.body.LocationID || null;
    let sql, args;

    // Validate required parameters
    if (!data || !LocationID) {
        res.status(400).json({"message": `Missing required parameters: data, locationID`});
        return;
    }

    // Temp Revert use Default Location
    LocationID = "DEFAULT";


    args = [];
    for (let datum of data) {
        args.push([datum.Fixture_Code, LocationID, datum.MDU]);
    }
    sql = `
        INSERT INTO fixture_mdu (Fixture_Code, LocationID, MDU)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        MDU=VALUES(MDU);`;

    try {
        await pool.query(sql, [args]);
    } catch (error) {
        logger.error("upsert_fixture_mdu", {error});
        res.status(500).json({"message": `Error while updating fixture mdus, please contact your system administrator`});
        return;
    }

    res.status(200).json({"message": "Fixture MDU Updated Sucessfully!"});
};

exports.add_product_barcode = async function(req, res) {
    let keycode = req.body.Keycode;
    let barcode = req.body.Barcode;
    let sql, args, results;

    if (barcode == null || keycode == null) {
        res.status(400).json({"message": "Both SKU/APN and Keycode are required!"});
        return;
    }

    let regExp = /^\d+$/;
    let validKeycode = regExp.test(keycode);
    let validBarcode = regExp.test(barcode);

    if (!validKeycode || !validBarcode) {
        res.status(400).json({"message": "Invalid keycode or barcode, please make sure they are correct"});
        return;
    }

    sql = `
        SELECT Keycode FROM product_barcode WHERE Barcode = ?
        ;
        SELECT Keycode FROM product WHERE Keycode = ?`;
    args = [barcode, keycode];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("add_product_from_keycode:", {error});
        res.status(500).json({"message": `Error occured while looking up Keycode ${keycode} and Barcode ${barcode}.`});
    }

    if (results[0].length) {
        res.status(400).json({"message": `Barcode ${barcode} is already associated to a product.`});
        return;
    }

    if (!results[1].length) {
        res.status(400).json({"message": `There is no product for Keycode ${keycode}!`});
        return;
    }

    sql = `
        INSERT INTO product_barcode (Keycode, Barcode)
        VALUES (?,?)
        ON DUPLICATE KEY UPDATE
        Keycode = VALUES(Keycode)`;
    args = [keycode, barcode];

    try {
        await pool.query(sql, args);
        res.status(200).json({"message": "Successfully added another Barcode to a Keycode"});
    } catch (error) {
        logger.error("get_inventory_by_style:", {error});
        res.status(500).json({"message": `Failed to add another Barcode: ${barcode} to a Keycode: ${keycode}.`});
    }
};

/**
 *  Add Keycodes to Mod Code
 *  - if Keycode has StyleID and Secondary_Colour, find all related keycodes too!
 */
exports.post_mod_code_keycodes = async function(req, res) {
    let ModCode = req.body.ModCode;
    let Keycode = parseInt(req.body.Keycode) || null;
    let LocationID = req.body.LocationID;
    let sql, args, results;

    if (ModCode == null || LocationID == null) {
        res.status(400).json({"message": "Both ModCode and LocationID are required!"});
        return;
    } else if (!LocationID.match(/-STR$/)) {
        res.status(400).json({"message": "Mod Code can only be set for Items in Stores!"});
        return;
    }

    // Ensure that if product has Style_ID > 0, add all related keycodes for the Style and Color.
    sql = `
        INSERT INTO product_mod_code (Keycode, LocationID, ModCode)
        SELECT p.Keycode, ? AS LocationID, ? AS ModCode
        FROM product p
        INNER JOIN (
            SELECT Keycode, US_Size, IF(Style_ID = 0, NULL, Style_ID) as Style_ID, Secondary_Colour FROM product
            WHERE Keycode = ?
        ) AS pp ON (pp.Style_ID is not null AND pp.Style_ID  = p.Style_ID AND pp.Secondary_Colour = p.Secondary_Colour) OR pp.Keycode = p.Keycode
        ON DUPLICATE KEY UPDATE ModCode = VALUES(ModCode)`;
    args = [LocationID, ModCode, Keycode];
    try {
        await pool.query(sql, args);
        res.status(200).json({"message": `Successfully added product keycode: ${Keycode} to Modcode: ${ModCode}`});
    } catch (error) {
        logger.error("post_mod_code_keycodes:", {error});
        res.status(500).json({"message": `Failed to add Mod Code: ${ModCode} with Keycode: ${Keycode}`});
    }
};

exports.get_mod_code_keycodes = async function get(req, res) {
    let ModCode = helper.trimVal(req.query.ModCode) || null;
    let LocationID = req.query.LocationID || null;
    let sql, args, results;
    if (ModCode == null) {
        return res.status(400).json({"message": "Mod code is required"});
    }

    sql = `SELECT
                p.Keycode, IFNULL(Online_Name, Product_Name) AS Product_Name, IMAGE_PRIMARY, IF(pp.price, pp.price ,p.Sell_Price_Usd) as Sell_Price_Usd, p.Secondary_Colour AS Color, p.Item_Size, p.US_Size, p.Style_ID
            FROM product p
            LEFT JOIN
                product_mod_code mc ON p.Keycode = mc.Keycode
            LEFT JOIN
                product_pricing pp ON p.Keycode = pp.Keycode AND pp.LocationID = ?
            WHERE
                mc.ModCode = ?`;
    args = [LocationID, ModCode];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("GET: mod_code_keycodes:", {error});
        return res.status(500).json({"message": `Error occured while looking up ModCode ${ModCode}.`});
    }

    if (!results.length) {
        res.status(404).json({"message": `No Keycodes associated with Modcode: ${ModCode}.`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.del_mod_code_keycodes = async function del(req, res) {
    // Delete All the keycodes associated with the current modcode.
    let ModCode = helper.trimVal(req.query.ModCode);
    let sql, args, results;
    if (ModCode == null) {
        return res.status(400).json({"message": "Mod code is required"});
    }

    sql = `DELETE
                FROM product_mod_code
            WHERE
                ModCode = ?`;
    args = [ModCode];
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_product_mod_code ", {error});
        return res.status(500).json({"message": `Error occured while deleting Keycodes associated with modcode ${ModCode}.`});

    }
    if (!results.affectedRows) {
        return res.status(404).json({"message": `No product was found for ${ModCode}. No items were deleted.`});
    }
    res.status(200).json({"message": `Succesfully deleted ${results.affectedRows} Keycodes for given Modcode: ${ModCode}.`});
};

exports.product_mod_code_csv = async function(req, res) {
    let sql, results, data;
    sql = `SELECT * FROM product_mod_code ORDER BY LocationID, ModCode`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to generate product mod code csv file."});
        return;
    }

    // Loop through results and save everything into data for csv:
    data = [];
    for (let row of results) {
        // CSV Header: Mod Code, Keycode, LocationID
        row = {
            "Mod Code": row["ModCode"],
            "Keycode": row["Keycode"],
            "LocationID": row["LocationID"]
        };
        data.push(row);
    }

    let fileData = await csvConverter.json2csvAsync(data, {emptyFieldValue: ""});
    let curDate = moment(moment.now()).format("YYYY-MM-DD");
    let fileName = `Product_Mod_Code_${curDate}.csv`;
    fileData = Buffer.from(fileData);
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);
};

async function _backupProductDiscountRaw() {
    let sql = `
        SELECT DiscountPercent, Keycode, Class_Name, Sub_Class_Name, DepartmentID, DateStart, DateEnd, DiscountName, DiscountPrice, DiscountPrice
        FROM product_discount_raw`;
    try {
        let [rows] = await pool.query(sql);

        return rows;
    } catch (ex) {
        console.log(ex);
    }

}

async function _checkCSVData(data) {
    let discount_price_gt_sell_price_sql = `
       SELECT p.DepartmentID, p.Keycode, p.APN, p.Sell_Price_Usd, d.DiscountPrice FROM product p
        INNER JOIN (
            SELECT Keycode, DiscountPercent, d.DiscountName, d.DiscountPrice, d.Sell_Price_Usd, d.DateStart, d.DateEnd
            FROM (
                    SELECT p.Keycode, d.DiscountPercent, 1 as priority, d.DiscountName, d.DiscountPrice, p.Sell_Price_Usd, d.DateStart, d.DateEnd
                    FROM product_discount_raw d
                    INNER JOIN product p on d.Keycode = p.Keycode
                    WHERE d.Keycode is not null
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 2 as priority, d.DiscountName, d.DiscountPrice, p.Sell_Price_Usd, d.DateStart, d.DateEnd
                    FROM product_discount_raw d
                    INNER JOIN product p on d.DepartmentID = p.DepartmentID
                    AND d.Class_Name = p.Class_Name
                    AND d.Sub_Class_Name = p.Sub_Class_Name
                    WHERE d.Keycode is null
                    AND d.Class_Name is not null
                    AND d.Sub_Class_Name is not null
                    AND d.DepartmentID is not null
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 3 as priority, d.DiscountName, d.DiscountPrice, p.Sell_Price_Usd, d.DateStart, d.DateEnd
                    FROM product_discount_raw d
                    INNER JOIN product p on d.DepartmentID = p.DepartmentID
                    AND d.Class_Name = p.Class_Name
                    WHERE d.Keycode is null
                    AND d.Class_Name is not null
                    AND d.Sub_Class_Name is null
                    AND d.DepartmentID is not null
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 4 as priority, d.DiscountName, d.DiscountPrice, p.Sell_Price_Usd, d.DateStart, d.DateEnd
                    FROM product_discount_raw d
                    INNER JOIN product p on d.DepartmentID = p.DepartmentID
                    WHERE d.Keycode is null
                    AND d.Class_Name is null
                    AND d.Sub_Class_Name is null
                    AND d.DepartmentID is not null
            ) AS d
            Group By Keycode
            Order by priority asc
        ) AS d ON d.Keycode = p.Keycode
        WHERE (d.DateStart IS NULL OR DATE(d.DateStart) < DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')))
    	AND (d.DateEnd is NULL OR DATE(d.DateEnd) >  DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')))
    	AND p.Sell_Price_Usd <= d.DiscountPrice;
    `;
    // Note: Needs to Be updated for kmart when/if we need to use

    try {
        let [rows_discount_gt_price] = await ro_pool.query(discount_price_gt_sell_price_sql, data);

        // console.log(" rows_discount_gt_price:  ",rows_discount_gt_price);

        if (rows_discount_gt_price.length >= 1) {
            throw "Invalid Price Setting in CSV";
        }

        // return rows_discount_gt_price.length;
    } catch (err) {
        console.log(err);

        // restoring old discounts becaue some heavy stuff went down in the try block

        let oldDiscounts = [];
        for (let elem of data) {
            let od = [];
            for (let [key, value] of Object.entries(elem)) {
                od.push(value);
            }
            oldDiscounts.push(od);
        }

        let sql = `
            TRUNCATE product_discount_raw
            ;
            INSERT INTO product_discount_raw (DiscountPercent, Keycode, Class_Name, Sub_Class_Name, DepartmentID, DateStart, DateEnd, DiscountName, DiscountPrice) VALUES ?;`;

        try {
            let args = [oldDiscounts];
            await pool.query(sql, args);
            console.log(`${moment().format()} DISCOUNT RESTORED`);
        } catch (ex) {
            console.log(ex);
        }
        throw err;

    } finally {
        logger.info("finally block");
    }
}

async function _updatePDU() {
    let sql = `
        UPDATE product_mdu pmdu
        SET pmdu.PDU = NULL, pmdu.DateStartPDU = null, pmdu.DateEndPDU = null, pmdu.PDUName = null;
        INSERT INTO product_mdu (Keycode, LocationID, DateStartPDU, DateEndPDU, PDU, PDUName)
        SELECT p.Keycode, d.LocationID, d.DateStart, d.DateEnd,  IF(d.PDU = 0, NULL, d.PDU) as PDU, d.DiscountName from  product p
            INNER JOIN (
                SELECT d.ID, d.Keycode, d.DiscountPercent, pbcd.Barcode, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, pdut.LocationID, pdut.PDU
                FROM (
                        SELECT d.ID, p.Keycode, d.DiscountPercent, 1 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice
                        FROM product_discount_raw d
                        INNER JOIN product p on d.Keycode = p.Keycode
                        WHERE d.Keycode is not null
                    UNION
                        SELECT d.ID, p.Keycode, d.DiscountPercent, 2 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice
                        FROM product_discount_raw d
                        INNER JOIN product p on d.DepartmentID = p.DepartmentID
                        AND d.Class_Name = p.Class_Name
                        AND d.Sub_Class_Name = p.Sub_Class_Name
                        WHERE d.Keycode is null
                        AND d.Class_Name is not null
                        AND d.Sub_Class_Name is not null
                        AND d.DepartmentID is not null
                    UNION
                        SELECT d.ID, p.Keycode, d.DiscountPercent, 3 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice
                        FROM product_discount_raw d
                        INNER JOIN product p on d.DepartmentID = p.DepartmentID
                        AND d.Class_Name = p.Class_Name
                        WHERE d.Keycode is null
                        AND d.Class_Name is not null
                        AND d.Sub_Class_Name is null
                        AND d.DepartmentID is not null
                    UNION
                        SELECT d.ID, p.Keycode, d.DiscountPercent, 4 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice
                        FROM product_discount_raw d
                        INNER JOIN product p on d.DepartmentID = p.DepartmentID
                        WHERE d.Keycode is null
                        AND d.Class_Name is null
                        AND d.Sub_Class_Name is null
                        AND d.DepartmentID is not null
                ) AS d
                LEFT JOIN product_barcode pbcd on d.Keycode = pbcd.Keycode
                INNER JOIN product_discount_pdu pdut on d.ID = pdut.DiscountRawID
                GROUP BY pbcd.Barcode, pdut.LocationID
                Order by priority asc
            ) AS d ON d.Keycode = p.Keycode
            where (d.DateEnd is NULL OR DATE(d.DateEnd) >  DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')))
        ON DUPLICATE KEY UPDATE
        PDU=VALUES(PDU),
        DateStartPDU=VALUES(DateStartPDU),
        DateEndPDU=VALUES(DateEndPDU),
        PDUName=VALUES(PDUName);`;
        // Note: Needs to Be updated for kmart when/if we need to use

    try {
        let [results] = await pool.query(sql);
        console.log(moment().format("YYYY-MM-DD HH:mm:ss"), `Updated PDU  - total ${results[results.length-1].affectedRows} rows affected.`);
    } catch (ex) {
        logger.info("update_discounts ERROR: ", {ex});
    }
}

async function _getOpenStores() {
    let sql = `
        SELECT DISTINCT ID from location lo where lo.IsOpen = true and lo.WarehouseID is not null ORDER BY ID ASC;
    `;

    try {
        let [results] = await pool.query(sql);
        let locations = [];
        for (let i in results) {
            locations.push(results[i].ID);
        }
        return locations;
    } catch (ex) {
        logger.info("update_discounts ERROR: ", {ex});
    }
}

exports.mdu_from_csv = async function(req, res) {
    // Reject if a file was not uploaded
    if (req.file == undefined) {
        let message = "Nothing was selected to upload. Please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }

    let file = req.file;
    let user = authHelper.parseRole(req);
    console.log(`${moment().format()} MDU UPLOAD started by ${user.id}`);

    let fileNameForS3 = `mdus_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBackupBucket = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3:", {fileNameForS3});
    helper.uploadFileToS3(csvBackupBucket, fileNameForS3, file["buffer"]);

    // Read the uploaded file and remove duplicate newlines from it, otherwise it will have issues parsing the text
    let input = file["buffer"].toString("utf-8").replace(/[\r\n]+/g, "\n");
    let data = await csvConverter.csv2jsonAsync(input);

    if (data.length == 0) {
        res.status(400).json({"message": "No data was found in the .csv file. Please check it and make sure it's valid."});
        return;
    }

    let mdus = [];

    // Get Keys which are the stores.
    let stores = Object.keys(data[0]);
    // Remove Keycode from list of stores.
    stores.shift();

    // Need to get the Date first and add to column DateUpdated.
    // because If the new INSERT values are the same as the old values in the duplicate row then apparently MySQL does not perform the UPDATE,
    // therefore the ON UPDATE CURRENT_TIMESTAMP ON DateUpdated Column is not fired.

    const updatedDate = moment.utc().format();
    for (let datum of data) {
        let keycode = datum.Keycode;
        for (let store of stores) {
            let mdu = datum[store];
            if (helper.trimVal(mdu) !== null) {
                mdus.push([keycode, store, mdu, user.id, updatedDate]);
            }
        }
    }

    if (mdus.length) {
        let sql, args;

        sql = `
            INSERT INTO product_mdu (Keycode, LocationID, MDU, UserID, DateUpdated) VALUES ?
            ON DUPLICATE KEY UPDATE
            PreviousMDU = MDU,
            Keycode = VALUES(Keycode),
            LocationID = VALUES(LocationID),
            MDU = VALUES(MDU),
            UserID = VALUES(UserID),
            DateUpdated = ?
            ;
            # DELETE Rows that are not updated
            DELETE FROM product_mdu Where DateUpdated != ?;`;
        args = [mdus, updatedDate, updatedDate];

        try {
            await pool.query(sql, args);
            res.status(200).json({"message": "MDUs Updated Successfully"});
        } catch (err) {
            res.status(400).json({"message": "Error occured while trying to insert MDU data from csv file."});
            logger.info("mdus_from_csv ERROR: ", {err});
            return;
        }
    } else {
        res.status(400).json({"message": "No valid MDU information found in file"});
        return;
    }
};

exports.product_list_from_csv = async function(req, res) {
    let csvType = req.body.csvtype || null;
    let csvFile = req.file         || null;
    let results, data, columns, inputFileColumns, slackMessage;

    /* Steps to ensure that the file is valid:
     * 1. Check if the user provided a .csv type
     * 2. Check if the user provided a .csv file
     * 3. Validate that the number of .csv columns match the number of columns in the list type
     *
     * There are currently two different predefined list of columns that the user can decide upon when
     * uploading the .csv on the frontend. The user will select one of the column lists and the csv will
     * be uploaded based on that list of columns. An error will be returned if the columns don't match.
     */

    const COL_KEYCODE = 0; // Keycode should always be the 0th-index column
    const COL_APN = 1; // APN should always be the 1st-index column
    const listTypes = {
        "with-image-primary": [
            "Keycode",
            "APN",
            "Product_Name",
            "Style_ID",
            "DepartmentID",
            "Business_Unit_RBU_Name",
            "Class_Name",
            "Sub_Class_Name",
            "Sub_Sub_Class_Name",
            "Secondary_Colour",
            "Item_Size",
            "IMAGE_PRIMARY"
        ],
        "without-image-primary": [
            "Keycode",
            "APN",
            "Product_Name",
            "Style_ID",
            "DepartmentID",
            "Business_Unit_RBU_Name",
            "Class_Name",
            "Sub_Class_Name",
            "Sub_Sub_Class_Name",
            "Secondary_Colour",
            "Item_Size"
        ]
    };

    // Reject with proper message if the .csv type wasn't provided by the user
    if (!csvType) {
        res.status(400).json({"message": "The .csv type must be provided"});
        return;
    } else {
        // Ensure that the .csv type exists
        if (csvType in listTypes) {
            columns = listTypes[csvType];
        } else {
            res.status(400).json({"message": "Invalid .csv type, please contact your system administrator"});
            return;
        }
    }

    // Reject with proper message if a file wasn't uploaded
    if (!csvFile) {
        res.status(400).json({"message": "Nothing was selected to upload. Please submit a .csv file"});
        return;
    }

    /* Read the uploaded file. csvtojson is exponentially faster than the
     * library "json-2-csv". Using "json-2-csv" on afile with over 300,000
     * lines will take minutes, where the library "csvtojson" takes seconds! */
    try {
        let input = csvFile["buffer"].toString("utf-8");
        data = await csvtojson({
            noheader: false,
            output: "csv"}).fromString(input);

        // Get the .csv columns by splitting by newline, removing carriage returns, and splitting again by comma
        inputFileColumns = input.split("\n")[0].replace(/[\r]+/g, "").split(",");
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": "There was an error parsing the uploaded file, please contact your system administrator"});
        return;
    }

    if (data.length == 0) {
        res.status(400).json({"message": "No data was found in the .csv file. Please check that the .csv file is correct and try again"});
        return;
    }

    // Validating the number of columns isn't feasible when we have optional columns (such as Fixture_Code),
    // so we'll just comment this out for now since it could be useful later
    //
    // The csv-parsing library can only check column-count when converting to JSON, not CSV (array of arrays),
    // which means we need to validate that there are the same amount of columns in all rows
    // for (let i = 0; i < data.length; i++) {
    //     if (columns.length !== data[i].length) {
    //         res.status(400).json({"message": `The .csv file contained an invalid amount of columns at line ${i+1}. Please check the file and the selected .csv type and try again`});
    //         return;
    //     }
    // }

    // Check the .csv file for errors, reporting back to the user if any errors were found
    let logRowsInCsv = data.length;
    let keycodeDistinct = {};      // Tracks distinct keycodes
    let keycodeDuplicates = {};    // Tracks distinct duplicate keycodes
    let logKeycodesDistinct = 0;   // Number of distinct keycodes to be processed
    let logKeycodesDuplicated = 0; // Number of distinct duplicate keycodes (count)
    let logRowsDuplicated = 0;     // Total duplicate rows ignored
    let logRowsErrors = 0;         // Products skipped with errors
    let logRowsSuccess = 0;        // Products successfully validated
    let logRowsInserted;           // Rows INSERTed
    let logRowsUpdated;            // Rows UPDATEed
    let countBefore, countAfter;   // Total amount of rows in the "product" table before and after processing the data
    let distinctProducts = [];

    for (let i = 0; i < data.length; i++) {
        let row = data[i];
        let keycode = row[COL_KEYCODE];

        if (keycode in keycodeDistinct) {
            // Note: We should NOT do the .splice() method to remove duplicate objects because it kills performance for large files!
            logRowsDuplicated++;
            keycodeDuplicates[keycode] = true; // Track this keycode as a duplicate
        } else {
            keycodeDistinct[keycode] = true; // Track this keycode so we can tell if a duplicate shows up later
            distinctProducts.push(row); // Pushing data into a new array is MUCH FASTER than removing duplicate objects
        }
    }

    logKeycodesDistinct   = Object.keys(keycodeDistinct).length;
    logKeycodesDuplicated = Object.keys(keycodeDuplicates).length;

    // Send a 200 OK response to the user right away, because this job can take a long time
    // After the job is completed, logging information will be sent to the #notifications channel on Slack
    res.status(200).json({"message": "The file has been uploaded for processing"});

    // Because we want to see exactly how many products were INSERTed and UPDATED, and the fact that
    // INSERT ... ON DUPLICATE key UPDATE will not product the information needed for this, we need
    // to perform a COUNT(*) before and after all of the products are processed.
    try {
        [results] = await pool.query(`SELECT COUNT(*) AS count FROM product`);
        countBefore = results[0]["count"];
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error parsing the .csv file, please contact your system administrator"});
        return;
    }

    // Validate each product, removing it from the distinctProducts array of products to be INSERTed/UPDATEed if it fails validation
    for (let i = 0; i < distinctProducts.length; i++) {
        let row = distinctProducts[i];
        let product = {};

        for (let i = 0; i < columns.length; i++) {
            product[columns[i]] = row[i];
        }

        let isValid = helper.ValidateProduct(product);

        if (isValid) {
            logRowsSuccess++;
        } else {
            logRowsErrors++;
            distinctProducts.splice(i--, 1); // Remove this invalid product from our distinctProducts array
        }
    }

    /* Prepare the SQL for the table "product" by dynamically constructing the SQL from the given columns in the .csv file.
     * Note that the "Keycode" column is special as it's the primary key for: product, product_attr, product_barcode
     *
     * INSERT INTO product (
     *     APN,
     *     Keycode,
     *     Product_Name,
     *     etc...
     * ) VALUES ?
     * ON DUPLICATE KEY UPDATE
     *     APN=VALUES(APN),
     *     Product_Name = VALUES(Product_Name),
     *     etc...
     */
    let sqlProduct     = `INSERT INTO product (` + columns.join(",") + `) VALUES ? ON DUPLICATE KEY UPDATE `;
    let withoutKeycode = columns.filter(element => element !== "Keycode"); // Remove "Keycode" from columns since it's NOT be included for "DUPLICATE KEY UPDATE"
    let partTwo        = [];

    // Append SQL after "ON DUPLICATE KEY UPDATE"
    for (let column of withoutKeycode) {
        partTwo.push(`${column} = VALUES(${column})`);
    }

    sqlProduct += partTwo.join(",");

    // Prepare SQL for the table: product_attr
    // The product_attr table is simple, since the Keycode and APN will be directly INSERTed into this table with an optional Fixture_Code
    // Because Fixture_Code is optional, it will be -1 if it wasn't found in the .csv file
    let fixtureCodeIndex = inputFileColumns.indexOf("Fixture_Code");
    let sqlProductAttr;

    if (fixtureCodeIndex > -1) { // If an index exists for Fixture_Code
        sqlProductAttr = `INSERT INTO product_attr (Keycode, APN, Fixture_Code) VALUES ? ON DUPLICATE KEY UPDATE APN = VALUES(APN), Fixture_Code = VALUES(Fixture_Code)`;
    } else {
        sqlProductAttr = `INSERT INTO product_attr (Keycode, APN) VALUES ? ON DUPLICATE KEY UPDATE APN = VALUES(APN)`;
    }

    // Prepare SQL for the table: product_barcode
    let sqlProductBarcode = `INSERT INTO product_barcode (Keycode, Barcode) VALUES ?
                            ON DUPLICATE KEY UPDATE
                                Keycode = VALUES(Keycode)`;

    // Now that the distinct products with errors have been filtered out, we can INSERT/UPDATE into the database
    // Process 10,000 rows at a time until the distinctProducts array is empty
    while (distinctProducts.length) {
        let productChunk = distinctProducts.splice(0, 10000);
        let argsProduct = [];
        let argsProductAttr = [];
        let argsProductBarcode = [];

        for (let product of productChunk) {
            // Push arguments for the three tables: product, product_attr, product_barcode
            // If a Fixture_Code was provided in the .csv file when uploading
            if (fixtureCodeIndex > -1) {
                // Fixture_Code is an optional column in the .csv that will only have an effect on the product_attr table, so it must be removed here
                argsProductAttr.push([
                    product[COL_KEYCODE],
                    product[COL_APN],
                    product[fixtureCodeIndex]
                ]);

                // The column Fixture_Code doesn't exist for the product table, so it must be removed before pushing in arugments for that table
                product.splice(fixtureCodeIndex, 1);
                argsProduct.push(product);
            } else {
                argsProductAttr.push([
                    product[COL_KEYCODE],
                    product[COL_APN]
                ]);

                argsProduct.push(product);
            }

            argsProductBarcode.push([
                product[COL_KEYCODE],
                product[COL_APN]
            ]);
        }

        try {
            await pool.query(sqlProduct, [argsProduct]);
            await pool.query(sqlProductAttr, [argsProductAttr]);
            await pool.query(sqlProductBarcode, [argsProductBarcode]);
        } catch (error) {
            console.log(error);
            slackMessage = ":x: *Product upload upload failed*\n```";
            await axios.post(config.slack_channel_notifications, {"text": slackMessage});
            return;
        }
    }

    try {
        [results] = await pool.query(`SELECT COUNT(*) AS count FROM product`);
        countAfter = results[0]["count"];
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error parsing the .csv file, please contact your system administrator"});
        return;
    }

    logRowsInserted = countAfter - countBefore;
    logRowsUpdated  = logRowsSuccess - logRowsInserted;

    // Send detailed logs of this job's result to Slack
    try {
        slackMessage = ":heavy_check_mark: *Product upload completed successfully*\n```";
        slackMessage += `Total rows in CSV: ${logRowsInCsv}\n`;
        slackMessage += `Total duplicate rows ignored: ${logRowsDuplicated} (${logKeycodesDuplicated} distinct dupes)\n`;
        slackMessage += `Distinct keycodes to be processed: ${logKeycodesDistinct}\n`;
        slackMessage += `Products skipped with errors: ${logRowsErrors}\n`;
        slackMessage += `Products successfully validated: ${logRowsSuccess}\n`;
        slackMessage += `Rows INSERTed: ${logRowsInserted}\n`;
        slackMessage += `Rows UPDATEed: ${logRowsUpdated}\n`;
        slackMessage += "```";
        await axios.post(config.slack_channel_notifications, {"text": slackMessage});
    } catch (error) {
        logger.error("generate_backfill_replenishment:", {error});
    }
};

exports.download_mdu_csv = async function(req, res) {
    let sql, results, locations, data;
    sql = `SELECT Keycode, LocationID, MDU FROM product_mdu ORDER BY Keycode`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to generate blacklist csv file."});
        return;
    }

    data = {};
    locations = [];

    for (let result of results) {
        let {Keycode, LocationID, MDU} = result;

        if (!(locations.includes(LocationID))) {
            locations.push(LocationID);
        }
        if (Keycode in data) {
            data[Keycode][LocationID] = MDU;
        } else {
            data[Keycode] = {};
            data[Keycode][LocationID] = MDU;
        }
    }

    let prepare = [];

    for (let keycode in data) {
        let row = {
            Keycode: keycode
        };
        for (let loc of locations) {
            if (loc in data[keycode]) {
                row[loc] = data[keycode][loc];
            } else {
                row[loc] = "";
            }
        }
        prepare.push(row);
    }
    let fileData = await csvConverter.json2csvAsync(prepare, {emptyFieldValue: ""});
    let fileName = "mdu_" + moment(moment.now()).format("YYYY-MM-DD") + ".csv";
    fileData = Buffer.from(fileData); //, "base64");
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);
};

exports.discounts_from_csv = async function(req, res) {
    // Reject if a file was not uploaded
    if (req.file == undefined) {
        let message = "Nothing was selected to upload. Please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }

    let file = req.file;
    let user = authHelper.parseRole(req);
    console.log(`${moment().format()} DISCOUNT UPLOAD started by ${user.id}`);

    let fileNameForS3 = `Discounts_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBackupBucket = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3:", {fileNameForS3});
    helper.uploadFileToS3(csvBackupBucket, fileNameForS3, file["buffer"]);

    // Read the uploaded file and remove duplicate newlines from it, otherwise it will have issues parsing the text
    let input = file["buffer"].toString("utf-8").replace(/[\r\n]+/g, "\n");
    let data = await csvConverter.csv2jsonAsync(input);

    if (data.length == 0) {
        res.status(400).json({"message": "No data was found in the .csv file. Please check it and make sure it's valid."});
        return;
    }

    let oldPDR;
    let openStores;
    let discount_raw_id = 1;
    let discount_name_list = {};
    let rowNo = 1; // Header
    let discount = [];
    let discount_name_map = {};
    let product_discount_pdu = [];
    let mapStyleColour = {};
    let sql = "SELECT Keycode, CONCAT(Style_ID, Secondary_Colour) AS StyleColour FROM product WHERE Style_ID IS NOT NULL AND Secondary_Colour IS NOT NULL";
    let args;

    // Get the keycodes for all Style_ID/Secondary_Colour combinations
    try {
        let [results] = await pool.query(sql);

        // Create an object that has the styleid + secondary color as the key which maps to an array of its keycodes
        for (let row of results) {
            let keycode = row["Keycode"];
            let styleColour = row["StyleColour"];

            if (styleColour in mapStyleColour) {
                mapStyleColour[styleColour].push(keycode);
            } else {
                mapStyleColour[styleColour] = [keycode];
            }
        }
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to insert discount data from csv file."});
        logger.info("discounts_from_csv ERROR: ", {error});
        return;
    }

    try {
        oldPDR = await _backupProductDiscountRaw();
        openStores = await _getOpenStores();

        for (let row of data) {
            rowNo++;
            let discountRow = [];
            let pdu_array = [];
            let hasPDU = false;
            let hasDiscountOrAmount = true;
            let dateStart = helper.trimVal(row["Start Date"]);
            let dateEnd = helper.trimVal(row["End Date"]);
            let discountName = helper.trimVal(row["Discount Name"]);
            let keycode = helper.checkEmpty(row["Keycode"]);
            let discountPrice = helper.checkEmpty(row["Discount Price"]);
            let discountPCT = helper.checkEmpty(row["Percent Discount"]);
            let percentDiscount = helper.checkEmpty(row["Percent Discount"]);
            let className = helper.trimVal(row["Class Name"]);
            let subClassName = helper.trimVal(row["Sub Class Name"]);
            let departmentID = helper.trimVal(row["Department ID"]);
            let StyleID = helper.trimVal(row["Style ID"]);
            let SecondaryColour = helper.trimVal(row["Secondary Colour"]);
            let keycodeCollection = []; // This will contain all keycodes
            let FinalSale = helper.trimVal(row["Final Sale"]);
            let isFinalSale = (FinalSale && FinalSale.toUpperCase() == "X") ? true : false;

            // If discountName doesn't exist in the list, then add it
            if (!(discountName in discount_name_list)) {
                discount_name_list[discountName] = {
                    percent: false,
                    amount: false
                };
            }

            // Set amount attribute to TRUE
            if (discountPrice) {
                discount_name_list[discountName].amount = true;
            }

            // Set percent attribute to TRUE
            if (discountPCT) {
                discount_name_list[discountName].percent = true;
            }

            // Now if both are TRUE, that can't be right. Smack'em with a 500
            if (discount_name_list[discountName].amount && discount_name_list[discountName].percent) {
                res.status(500).json({"message": `${discountName} has both Percent and Dollar amounts assigned to the group. [Row: ${rowNo}] Correct and reupload.`});
                return;
            }

            if (keycode) {
                // Keycode overrides the StyleID and SecondaryColour if they exist. There will only be a single keycode in our Keycode Collection
                keycodeCollection = [keycode];
            } else if (StyleID && SecondaryColour) {
                // If there's no keycode but we have a StyleID and SecondaryColour, get ALL keycodes related to this StyleID/SecondaryColour combination
                let key = `${StyleID}${SecondaryColour}`;
                keycodeCollection = mapStyleColour[key];
            }

            /* *********************************************************************************************************
             *  The for loop below is doing this very same thing. Comment it out, if you want to debug for a single
             *  store or something. At the time of writing this, they can add as many stores, it would work, for upload
             *  and download. There would be no need to manually change stores.
             *
             * location.push("LYN2-STR");
             * location_based_pdu.push((row["LYN2-STR"].length == 0) ? null :  row["LYN2-STR"]);
             *
             * location.push("BUR1-STR");
             * location_based_pdu.push((row["BUR1-STR"].length == 0) ? null :  row["BUR1-STR"]);
             *
             * *******************************************************************************************************/

            for (let i in openStores) {
                let store_id = openStores[i]; // e.g. - "LYN2-STR", "BUR1-STR"
                if (store_id in row) {
                    pdu_array = []; // reset

                    if (row[store_id].length > 0 || row[store_id] != "" || row[store_id].trim() != "") {
                        hasPDU = hasPDU | true; // this thing will be true, if at least one of the stores has a PDU set
                        pdu_array.push(discount_raw_id);
                        pdu_array.push(store_id);
                        let pdu_value = (row[store_id].length > 0) ? row[store_id].trim() : row[store_id];
                        pdu_array.push(pdu_value);
                        product_discount_pdu.push(pdu_array);
                    }

                } else {
                    logger.info("Err: ", store_id, " not found in ", {data: Object.keys(row)});
                }
            }

            if (dateStart != null) {
                dateStart = moment(dateStart, "L"); // Local date format
                dateStart = dateStart.isValid() ? dateStart.format() : null;
            }

            if (dateEnd != null) {
                dateEnd = moment(dateEnd, "L"); // Local date format
                dateEnd = dateEnd.isValid() ? dateEnd.format() : null;
            }

            if (discountName != null) {
                // Do nothing
            } else {
                discountName = "SALE";
            }

            if (discountPrice == null && discountPCT == null) {
                let errMsg =  "WARNING: discountPrice and discountPercent both null";
                hasDiscountOrAmount = false;
                console.log(errMsg);
            } else if (discountPrice != null && discountPCT != null) {
                let errMsg =  "WARNING: discountPrice and discountPercent both set";
                console.log(errMsg);
            }

            if (discountName in discount_name_map) {
                // Name exists, increase the count
                let tmpCount = parseInt(discount_name_map[discountName]);
                tmpCount += 1;
                discount_name_map[discountName] = tmpCount;
            } else {
                // add the entry
                discount_name_map[discountName] = 1;
            }

            // Adding columns
            discountRow.push(percentDiscount);
            discountRow.push(keycode);
            discountRow.push(className);
            discountRow.push(subClassName);
            discountRow.push(departmentID);
            discountRow.push(dateStart);
            discountRow.push(dateEnd);
            discountRow.push(discountName);
            discountRow.push(discountPrice);
            discountRow.push(StyleID);
            discountRow.push(SecondaryColour);
            discountRow.push(isFinalSale);

            if (hasPDU == true || hasDiscountOrAmount == true) {
                // Adding rows
                discount.push(discountRow);
                discount_raw_id++;
            } else {
                logger.info("------------------------------- Skipping Discount Entry ----------------------------------");
                console.log(discountRow.join("|"));
                logger.info("------------------------------------------------------------------------------------------");
            }

        }
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to insert discount data from csv file."});
        logger.info("discounts_from_csv ERROR: ", {error});
    }

    /* *********************************************************************************************************************************************
     *
     *  An important thing to remember is that, at no point should the table product_discount_raw be truncated after the csv has been uploaded,
     *  and update_discounts API has been called.
     *
     *  The product_discount_raw is used from within ankoMicroservices to figure out daily applicable discounts, and discounts are
     *  added/removed based on the dateStart and dateEnd date
     *
     * The only time to TRUNCATE would be before uploading a new set of csv data
     *
     * ************************************************************************************************************************************************/

    sql = `
        TRUNCATE product_discount_raw;
        TRUNCATE product_discount_pdu;
        INSERT INTO product_discount_raw
        (DiscountPercent, Keycode, Class_Name, Sub_Class_Name, DepartmentID, DateStart, DateEnd, DiscountName, DiscountPrice, StyleID, SecondaryColour, isSaleFinal)
        VALUES ?
        ;
        INSERT INTO product_discount_pdu
        (DiscountRawID, LocationID,PDU)
        VALUES ?`;
    args = [discount, product_discount_pdu];
    try {
        await pool.query(sql, args);
        console.log(`${moment().format()} DISCOUNT UPLOAD Completed by ${user.id}`);
        console.log(`discounts_from_csv - total ${discount.length} rows inserted (from ${data.length} rows of csv).`);
        await _checkCSVData(oldPDR);
        // updating the Sell_Price_Discount_Pct
        //apiRequest.post(req, "update_discounts");
        let message = `${data.length} rows from csv file are now in discounts, spread across ${Object.keys(discount_name_map).length} Discount Types`;
        res.status(200).json({"message": message});
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to insert discount data from csv file."});
        logger.info("discounts_from_csv ERROR: ", {error});
    }
};

exports.download_discounts_csv = async function(req, res) {
    let sql, results, data, row, loc;

    // loc.IsOpen will wipe out all stores that are not open. If you are uploading to multiple
    // locations that are empty the upload will work fine, but won't download the stuff
    sql = `
       SELECT loc.ID AS LocationID FROM location loc
       WHERE loc.IsOpen = TRUE AND loc.WarehouseID  IS NOT NULL;`;

    try {
        [results] = await ro_pool.query(sql);
        loc = results;
        sql = `
            SELECT
                IFNULL(d.DiscountName, 'SALE') AS Discount_Name,
                IFNULL(d.DepartmentID, p.DepartmentID) AS DepartmentID,
                IFNULL(d.Class_Name, p.Class_Name) AS Class_Name,
                IFNULL(d.Sub_Class_Name, p.Sub_Class_Name) AS Sub_Class_Name,
                IFNULL(d.Keycode, p.Keycode) AS Keycode,
                p.Product_Name,
                d.DiscountPercent,
                IFNULL(d.DiscountPrice, NULL) AS DiscountPrice,
                DATE_FORMAT(DateStart,'%m/%d/%Y') AS DateStart,
                DATE_FORMAT(DateEnd,'%m/%d/%Y') AS DateEnd,
                IFNULL(d.StyleID, p.Style_ID) AS Style_ID,
                IFNULL(d.SecondaryColour, p.Secondary_Colour) AS Secondary_Colour,
                IFNULL(d.isSaleFinal, p.isSaleFinal) as isSaleFinal`;

        loc.map((elem, index) => {
            sql += `, loc${index}.PDU AS '${elem.LocationID}'\n`;
        });
        sql += `FROM product_discount_raw d\n`;
        loc.map((elem, index) => {
            sql += `LEFT JOIN product_discount_pdu loc${index} on loc${index}.DiscountRawID = d.ID AND loc${index}.LocationID = '${elem.LocationID}'\n`;
        });
        sql += `LEFT JOIN product p ON p.Keycode = d.Keycode;`;
        console.debug(sql);
        [results] = await ro_pool.query(sql);
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": "Error occured while trying to generate discount csv file"});
        return;
    }

    data = [];

    if (results.length == 0) {
        row = {
            "Discount Name": "",
            "Department ID": "",
            "Class Name": "",
            "Sub Class Name": "",
            "Keycode": "",
            "Product Name": "",
            "Style ID": "",
            "Secondary Colour": "",
            "Final Sale": "",
            "Percent Discount": "",
            "Discount Price": "",
            "Start Date": "",
            "End Date": ""
        };

        for (let i = 0; i < loc.length; i++) {
            row[loc[i].LocationID] = "";
        }

        data.push(row);
    }

    for (let product of results) {
        row = {
            "Discount Name": product["Discount_Name"],
            "Department ID": product["DepartmentID"],
            "Class Name": product["Class_Name"],
            "Sub Class Name": product["Sub_Class_Name"],
            "Keycode": product["Keycode"],
            "Product Name": product["Product_Name"],
            "Style ID": product["Style_ID"],
            "Secondary Colour": product["Secondary_Colour"],
            "Final Sale": (product["isSaleFinal"]) ? "X" : "",
            "Percent Discount": product["DiscountPercent"],
            "Discount Price": product["DiscountPrice"],
            "Start Date": product["DateStart"],
            "End Date": product["DateEnd"]
        };

        // If the Style ID is an empty string, zero, or NULL, make sure both the Style ID and Secondary Colour are cleared
        if (row["Style ID"] === "" || row["Style ID"] === 0 || row["Style ID"] === null) {
            row["Style ID"] = "";
            row["Secondary Colour"] = "";
        }

        for (let location of loc) {
            let location_id = location.LocationID;
            if (location_id in product) {
                row[location_id] = (product[location_id] == 0 || product[location_id] == null) ? "" : product[location_id];
            }
        }

        data.push(row);
    }

    let fileData = await csvConverter.json2csvAsync(data, {emptyFieldValue: ""});
    let fileName = "Discount_" + moment(moment.now()).format("YYYY-MM-DD") + ".csv";
    fileData = Buffer.from(fileData); //, "base64");
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);
};

exports.update_discounts = async function(req, res) {
    // this sql query
    // 1. truncates product_discount table
    // 2. inserts all the discounts into the table
    // 3. nulls out the discount amount & percent column in product table
    // 4. updates the discount amount & percent column in product table

    let createHistory = req.body.createHistory || false;
    logger.info("createHistory[Lambda Passed] : ", {createHistory});

    let sql_insert_product_discount_tbl = `
      TRUNCATE product_discount;
      INSERT INTO product_discount (Keycode, DiscountName, DiscountPercent, DiscountPrice, DateStart, DateEnd, isSaleFinal)
      SELECT p.Keycode, d.DiscountName, d.DiscountPercent,d.DiscountPrice, d.DateStart, d.DateEnd, d.isSaleFinal   from  product p
        INNER JOIN (
            SELECT d.Keycode, d.DiscountPercent, pbcd.Barcode, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
            FROM (
                    SELECT p.Keycode, d.DiscountPercent, 1 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                    FROM product_discount_raw d
                    INNER JOIN product p on d.Keycode = p.Keycode
                    WHERE d.Keycode is not null
                    AND p.In_US_Range = TRUE
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 2 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                    FROM product_discount_raw d
                    INNER JOIN product p on d.StyleID = p.Style_ID
                    AND d.SecondaryColour = p.Secondary_Colour
                    WHERE d.Keycode is null
                    AND d.StyleID is not null
                    AND d.SecondaryColour is not null
                    AND p.In_US_Range = TRUE
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 3 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                    FROM product_discount_raw d
                    INNER JOIN product p on d.DepartmentID = p.DepartmentID
                    AND d.Class_Name = p.Class_Name
                    AND d.Sub_Class_Name = p.Sub_Class_Name
                    WHERE d.Keycode is null
                    AND d.Class_Name is not null
                    AND d.Sub_Class_Name is not null
                    AND d.DepartmentID is not null
                    AND p.In_US_Range = TRUE
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 4 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                    FROM product_discount_raw d
                    INNER JOIN product p on d.DepartmentID = p.DepartmentID
                    AND d.Class_Name = p.Class_Name
                    WHERE d.Keycode is null
                    AND d.Class_Name is not null
                    AND d.Sub_Class_Name is null
                    AND d.DepartmentID is not null
                    AND p.In_US_Range = TRUE
                UNION
                    SELECT p.Keycode, d.DiscountPercent, 5 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                    FROM product_discount_raw d
                    INNER JOIN product p on d.DepartmentID = p.DepartmentID
                    WHERE d.Keycode is null
                    AND d.Class_Name is null
                    AND d.Sub_Class_Name is null
                    AND d.DepartmentID is not null
                    AND p.In_US_Range = TRUE
            ) AS d
            JOIN product_barcode pbcd
            on d.Keycode = pbcd.Keycode
            GROUP BY pbcd.Barcode
            Order by priority asc
        ) AS d ON d.Keycode = p.Keycode
        where (d.DateStart IS NULL OR DATE(d.DateStart) <= DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')))
        AND (d.DateEnd is NULL OR DATE(d.DateEnd) >  DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')));
        UPDATE product p SET  p.Discount_Price_Usd = null;
        UPDATE product p
   		INNER JOIN product_discount pd
   		ON p.Keycode = pd.Keycode
        SET p.Discount_Price_Usd = IFNULL(pd.DiscountPrice, IF((p.Sell_Price_Usd-(IFNULL(pd.DiscountPercent/100, NULL) * p.Sell_Price_Usd)) = p.Sell_Price_Usd, NULL, (p.Sell_Price_Usd - (pd.DiscountPercent/100) * p.Sell_Price_Usd)   )),
        p.isSaleFinal = IF(pd.isSaleFinal = true, true, p.isSaleFinal);`;

    // Note: Needs to Be updated for kmart when/if we need to use


    // doing this because, when discount_csv is uploaded, we call this update discount function right after
    // This function is again called using a cloud watch rule at 12:00 AM every night
    // so on the day, someone uploaded the discount multiple times
    // the discount_history table would have multiple entries of the same keycode
    // so in order to circumvent that issue, the cloud watch rule
    // when it call the wms_api_call, sends the flag 'createHistory = true'
    // which gets passed along from the wms_api_call lambda
    // We are just checking it here to make sure, the api call was
    // originated from the lambda or internally when the csv was uploaded
    if (createHistory == true || createHistory == "true") { // not sure how the lambda is ending the value as boolean or string
        sql_insert_product_discount_tbl = `
            TRUNCATE product_discount;
            INSERT INTO product_discount (Keycode, DiscountName, DiscountPercent, DiscountPrice, DateStart, DateEnd, isSaleFinal)
            SELECT p.Keycode, d.DiscountName, d.DiscountPercent,d.DiscountPrice, d.DateStart, d.DateEnd, d.isSaleFinal   from  product p
                INNER JOIN (
                    SELECT d.Keycode, d.DiscountPercent, pbcd.Barcode, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                    FROM (
                            SELECT p.Keycode, d.DiscountPercent, 1 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                            FROM product_discount_raw d
                            INNER JOIN product p on d.Keycode = p.Keycode
                            WHERE d.Keycode is not null
                            AND p.In_US_Range = TRUE
                        UNION
                            SELECT p.Keycode, d.DiscountPercent, 2 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                            FROM product_discount_raw d
                            INNER JOIN product p on d.StyleID = p.Style_ID
                            AND d.SecondaryColour = p.Secondary_Colour
                            WHERE d.Keycode is null
                            AND d.StyleID is not null
                            AND d.SecondaryColour is not null
                            AND p.In_US_Range = TRUE
                        UNION
                            SELECT p.Keycode, d.DiscountPercent, 3 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                            FROM product_discount_raw d
                            INNER JOIN product p on d.DepartmentID = p.DepartmentID
                            AND d.Class_Name = p.Class_Name
                            AND d.Sub_Class_Name = p.Sub_Class_Name
                            WHERE d.Keycode is null
                            AND d.Class_Name is not null
                            AND d.Sub_Class_Name is not null
                            AND d.DepartmentID is not null
                            AND p.In_US_Range = TRUE
                        UNION
                            SELECT p.Keycode, d.DiscountPercent, 4 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                            FROM product_discount_raw d
                            INNER JOIN product p on d.DepartmentID = p.DepartmentID
                            AND d.Class_Name = p.Class_Name
                            WHERE d.Keycode is null
                            AND d.Class_Name is not null
                            AND d.Sub_Class_Name is null
                            AND d.DepartmentID is not null
                            AND p.In_US_Range = TRUE
                        UNION
                            SELECT p.Keycode, d.DiscountPercent, 5 as priority, d.DiscountName, d.DateStart, d.DateEnd,d.DiscountPrice, d.isSaleFinal
                            FROM product_discount_raw d
                            INNER JOIN product p on d.DepartmentID = p.DepartmentID
                            WHERE d.Keycode is null
                            AND d.Class_Name is null
                            AND d.Sub_Class_Name is null
                            AND d.DepartmentID is not null
                            AND p.In_US_Range = TRUE
                ) AS d
                JOIN product_barcode pbcd
                on d.Keycode = pbcd.Keycode
                GROUP BY pbcd.Barcode
                Order by priority asc
            ) AS d ON d.Keycode = p.Keycode
            where (d.DateStart IS NULL OR DATE(d.DateStart) <= DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')))
            AND (d.DateEnd is NULL OR DATE(d.DateEnd) >  DATE(CONVERT_TZ(NOW(), 'UTC', 'America/Los_Angeles')));
            UPDATE product p SET p.Discount_Price_Usd = null;
            UPDATE product p
            INNER JOIN product_discount pd
            ON p.Keycode = pd.Keycode
            SET p.Discount_Price_Usd = IFNULL(pd.DiscountPrice, IF((p.Sell_Price_Usd-(IFNULL(pd.DiscountPercent/100, NULL) * p.Sell_Price_Usd)) = p.Sell_Price_Usd, NULL, (p.Sell_Price_Usd - (pd.DiscountPercent/100) * p.Sell_Price_Usd)   )),
            p.isSaleFinal = IF(pd.isSaleFinal = true, true, p.isSaleFinal);
            INSERT INTO product_discount_history ( Keycode, DiscountName, DiscountPrice, DiscountPercent, Date)
            SELECT  distinct Keycode, DiscountName, DiscountPrice, DiscountPercent, DATE(NOW()) as datecreated from product_discount pd;
            `;

        // Note: Needs to Be updated for kmart when/if we need to use
    }

    try {
        let [results] = await pool.query(sql_insert_product_discount_tbl);
        console.log(moment().format("YYYY-MM-DD HH:mm:ss"), `update_discounts - total ${results[1].affectedRows} items updated.`);
        let message = `Total of ${results[1].affectedRows} products are discounted.`;
        await _updatePDU();
        res.status(200).json({"message": message});
    } catch (error) {
        res.status(400).json({"message": "Error occured while trying to update discount data in product table."});
        logger.info("update_discounts ERROR: ", {error});
    }
};

exports.upload_category_csv = async function(req, res) {
    let file = req.file;
    if (file == undefined) {
        let message = "Nothing was selected to upload. Please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }

    let user = authHelper.parseRole(req);
    console.log(`${moment().format()} Category UPLOAD started by ${user.id}`);

    // Upload Category CSV to CSV backups
    let fileNameForS3 = `Category_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBucketName = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3: ", {fileNameForS3});
    helper.uploadFileToS3(csvBucketName, fileNameForS3, file["buffer"]);

    res.status(200).json({"message": "Succesfully uploaded Category CSV file"});
};

exports.upload_product_prices_csv = async function(req, res) {

    let file = req.file;
    let user = authHelper.parseRole(req);
    if (!file) {
        let message = "Nothing was selected to upload. Please submit a .csv file";
        res.status(400).json({"message": message});
        return;
    }

    console.log(`${moment().format()} PRODUCT PRICING UPLOAD started by ${user.id}`);

    let fileNameForS3 = `Product_Pricing_${moment().format("YYYY-MM-DDTHH:mm:ss")}_USER_${user.id}.csv`;
    let csvBackupBucket = config.s3_bucket.csv_backup;
    logger.info("Uploading to s3:", {fileNameForS3});
    helper.uploadFileToS3(csvBackupBucket, fileNameForS3, file["buffer"]);

    // Read the uploaded file and remove duplicate newlines from it, otherwise it will have issues parsing the text
    let input = file["buffer"].toString("utf-8").replace(/[\r\n]+/g, "\n");
    let data = await csvConverter.csv2jsonAsync(input);

    if (data.length == 0) {
        res.status(400).json({"message": "No data was found in the .csv file. Please check it and make sure it's valid."});
        return;
    }
    let product_prices_array = [];
    let errMessage = "";
    let openStores;
    try {
        openStores = await _getOpenStores();
        for (let row in data) {
            let pricesRow = [];
            let hasPrice = false;
            let Keycode = helper.trimVal(data[row]["Keycode"])  || helper.trimVal(data[row]["Keycode"]);
            let styleID = helper.trimVal(data[row]["Style_ID"]) ||  helper.trimVal(data[row]["Style_ID"]);
            let secondaryColour = helper.trimVal(data[row]["Secondary_Colour"]) || helper.trimVal(data[row]["Secondary_Colour"]);


            for (let i in openStores) {
                let store_id = openStores[i]; // e.g. - "LYN2-STR", "BUR1-STR"
                if (store_id in data[row]) {
                    pricesRow = [];

                    if (data[row][store_id].length > 0 || data[row][store_id] != "" || data[row][store_id].trim() != "") {
                        hasPrice = hasPrice | true; // this thing will be true, if at least one of the stores has a PDU set
                        // if both Keycode and either from the combo (styleID & secondaryColour) is NULL
                        // ELSE block will get executed which throws an error
                        if (Keycode || (styleID && secondaryColour)) {
                            // This takes care of the fact
                            // that if some user enters all the values for Keycode, Style_ID, secondaryColour
                            // There won't be a problem here
                            // but it will make the update_product_prices fail because of the WHERE constraints
                            // that has been set on the UNION
                            // so if Keycode is there (Higher Precedence), null the rest
                            if (Keycode) {
                                styleID = null;
                                secondaryColour = null;
                            }
                            pricesRow.push(Keycode); // Keycode
                            pricesRow.push(styleID); // Style_ID
                            pricesRow.push(secondaryColour); // Secondary_Colour
                            pricesRow.push(store_id); // LocationID
                            let price_value = (data[row][store_id].length > 0) ? data[row][store_id].trim() : data[row][store_id]; // Price
                            if (parseFloat(price_value) <= 0) { //yo, can't set negative prices or give away free stuff
                                errMessage = `Row ${parseInt(row)+2} has negative price value`;
                                throw new Error(errMessage);
                            }
                            pricesRow.push(price_value);
                            if (!isNaN(price_value)) {
                                product_prices_array.push(pricesRow);
                            }
                        } else {
                            console.log(data[row]);
                            errMessage = `Must include Keycode or Style_ID and Secondary_Colour Row: ${parseInt(row)+2}`;
                            throw new Error(errMessage);
                        }
                    }

                } else {
                    logger.info("Err: ", store_id, " not found in ", {data: Object.keys(data[row])});
                }
            }

            // This is done, so they can upload a csv with header and an empty row. This would essentially wipe the data clean on product_pricing_raw
            if (!hasPrice && data.length > 1) {
                errMessage = `Must set price for at least one location Row: ${parseInt(row)+2}`;
                throw new Error(errMessage);
            }

        }
    } catch (error) {
        res.status(500).json({"message": `Error occured. ${errMessage}`});
        logger.info("product_pricing_from_csv ERROR: ", {error});
        return;
    }

    let sql = `TRUNCATE product_pricing_raw;`;

    if (product_prices_array.length > 0) {
        sql = `
        TRUNCATE product_pricing_raw;
        INSERT INTO product_pricing_raw (Keycode, Style_ID, Secondary_Colour, LocationID, Price)
        VALUES ?;
        `;
    }
    let args = [product_prices_array];
    try {
        console.debug(pool.format(sql, args)); // debug suppressed in prod
        await pool.query(sql, args);
        console.log(`${moment().format()} PRODUCT PRICING UPLOAD Completed by ${user.id}`);
        console.log(`product_pricing_from_csv - total ${product_prices_array.length} rows inserted (from ${data.length} rows of csv).`);
        // updating product_pricing
        apiRequest.post(req, "update_product_prices");
        let message = `${data.length} rows from csv file are now in product_pricing_raw`;
        res.status(200).json({"message": message});
    } catch (error) {
        res.status(500).json({"message": "Error occured while trying to insert discount data from csv file."});
        logger.info("upload_product_prices_csv ERROR: ", {error});
    }
};

exports.download_product_prices_csv = async function(req, res) {
    let sql, results, data, row, loc;

    // loc.IsOpen will wipe out all stores that are not open. If you are uploading to multiple locations that are empty
    // the upload will work fine, but won't download the stuff

    sql = `
     SELECT loc.ID AS LocationID FROM location loc
     WHERE loc.IsOpen = TRUE AND loc.WarehouseID  IS NOT NULL;
    `;

    try {
        [results] = await pool.query(sql);
        loc = results;

        /*
         * This is the sample of what the SQL will look like after it is being generated
         *
         * SELECT ppr.Keycode,
         * MAX(CASE WHEN ppr.LocationID = 'BUR1-STR' THEN ppr.Price END ) as 'BUR1-STR',
         * MAX(CASE WHEN ppr.LocationID = 'TOT1-STR' THEN ppr.Price END)  as 'TOT1-STR',
         * MAX(CASE WHEN ppr.LocationID = 'LYN2-STR' THEN ppr.Price END)  as 'LYN2-STR'
         * FROM product_pricing_raw ppr
         * GROUP by ppr.Keycode;
         *
         * This is being done to pivot the table
         *
         * so results will look like this
         * --------------------------------------------------------------------------------------------------------
         *  |Keycode|Product_Name|DepartmentID|Class_Name|Style_ID|Secondary_Colour|BUR1-STR|TOT1-STR|LYN2-STR|
         * --------------------------------------------------------------------------------------------------------
         *  | 1234  |   xyx      |               |          |  1123  |   METAL        |  5.99  |        | 11.99  |
         * --------------------------------------------------------------------------------------------------------
         *  | 8956  |   abc      |               |          |  6623  |   METAL        |        | 12.34  | 11.99  |
         * --------------------------------------------------------------------------------------------------------
         *
         * */

        sql = `
            SELECT ppr.Keycode,
            p.Product_Name,
            p.DepartmentID,
            p.Class_Name,
            ppr.Style_ID,
            ppr.Secondary_Colour`;

        loc.map((elem, index) => {
            sql += `, MAX(CASE WHEN ppr.LocationID = '${elem.LocationID}' THEN ppr.Price END) as '${elem.LocationID}' \n`;
        });
        sql += `FROM product_pricing_raw ppr\n`;
        sql += `LEFT JOIN product p ON ppr.Keycode = p.Keycode OR (ppr.Style_ID = p.Style_ID AND ppr.Secondary_Colour = p.Secondary_Colour)`;
        sql += `GROUP BY ppr.Keycode, ppr.Style_ID, ppr.Secondary_Colour;`;
        console.debug(sql); // debug suppressed in prod
        [results] = await ro_pool.query(sql);

    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error occured while trying to generate discount csv file"});
        return;
    }

    data = [];

    if (results.length == 0) {

        row = {
            "Keycode": "",
            "Product_Name": "",
            "DepartmentID": "",
            "Class_Name": "",
            "Style_ID": "",
            "Secondary_Colour": ""
        };

        for (let i = 0; i < loc.length; i++) {
            row[loc[i].LocationID] = "";
        }
        data.push(row);
    }
    for (let i in results) {
        row = {
            "Keycode": results[i]["Keycode"],
            "Product_Name": (results[i]["Keycode"] != null) ? results[i]["Product_Name"] : "",
            "DepartmentID": results[i]["DepartmentID"],
            "Class_Name": results[i]["Class_Name"],
            "Style_ID": results[i]["Style_ID"],
            "Secondary_Colour": results[i]["Secondary_Colour"]
        };
        for (let k in loc) {
            let location_id = loc[k].LocationID;
            if (location_id in results[i]) {
                row[location_id] = (results[i][location_id] == 0 || results[i][location_id] == null) ? "" : results[i][location_id];
            }
        }
        data.push(row);
    }

    let fileData = await csvConverter.json2csvAsync(data, {emptyFieldValue: ""});
    let fileName = "Product_Pricing_" + moment(moment.now()).format("YYYY-MM-DD") + ".csv";
    fileData = Buffer.from(fileData); //, "base64");
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);
    res.status(200);
};

exports.update_product_prices = async function(req, res) {

    let sql_insert_product_pricing_tbl = `
      TRUNCATE product_pricing;
      INSERT INTO product_pricing (Keycode, LocationID, Price)
      SELECT p.Keycode, d.LocationID, d.Price from  product p
        INNER JOIN (
            SELECT d.Keycode, d.LocationID, d.Style_ID, d.Secondary_Colour, d.priority, d.Price
            FROM (
                    SELECT p.Keycode, ppr.LocationID, 1 as priority, ppr.Price, IFNULL(ppr.Style_ID,p.Style_ID) as Style_ID, IFNULL(ppr.Secondary_Colour, ppr.Secondary_Colour) as Secondary_Colour
                    FROM product_pricing_raw ppr
                    INNER JOIN product p on ppr.Keycode = p.Keycode
                    WHERE ppr.Keycode is not null
                    AND ppr.Secondary_Colour is null
                    AND ppr.Style_ID is null
               UNION
                    SELECT p.Keycode, ppr.LocationID, 2 as priority, ppr.Price, IFNULL(ppr.Style_ID,p.Style_ID) as Style_ID, IFNULL(ppr.Secondary_Colour, ppr.Secondary_Colour) as Secondary_Colour
                    FROM product_pricing_raw ppr
                    INNER JOIN product p on ppr.Secondary_Colour = p.Secondary_Colour
                    AND ppr.Style_ID = p.Style_ID
                    WHERE ppr.Keycode is null
                    AND ppr.Secondary_Colour is not null
                    AND ppr.Style_ID is not null
            ) AS d
            Order by priority asc
        ) AS d ON d.Keycode = p.Keycode;
        `;

    try {
        let [results] = await pool.query(sql_insert_product_pricing_tbl);
        console.log(moment().format("YYYY-MM-DD HH:mm:ss"), `update_product_prices - total ${results[1].affectedRows} items updated.`);
        let message = `Total of ${results[1].affectedRows} products are discounted.`;
        res.status(200).json({"message": message});
    } catch (error) {
        res.status(500).json({"message": "Error occured while trying to update discount data in product table."});
        logger.info("update_discounts ERROR: ", {error});
    }
};

exports.blacklist_keycode = async function(req, res) {
    let Keycode = req.body.Keycode;
    let Blacklisted = helper.parseBoolean(req.body.blacklisted);
    let sql, args, results;

    sql = "Update product SET Blacklisted = ? WHERE keycode = ?";
    args = [Blacklisted, Keycode];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("unblacklist_keycode ERROR: ", {error});
        return res.status(400).json({"message": "Error occured while trying to update global keycode blacklist."});
    }
    if (!results.affectedRows) {
        return res.status(400).json({"message": "Error occured while trying to update global keycode blacklist."});
    } else {
        return res.status(200).json({"message": "Global keycode blacklist updated"});
    }
};

exports.get_keycode_blacklist = async function(req, res) {
    let sql = "Select * from product WHERE Blacklisted IS TRUE";

    try {
        let [results] = await pool.query(sql);
        res.json({"data": results});
    } catch (error) {
        res.status(400).json({"message": "Error while trying to retrieve the black list."});
        logger.info("get_keycode_blacklist ERROR: ", {error});
    }
};
