/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

const apiRequest = require("../library/apiRequest");
const authHelper = require("../library/authHelper");
const moment = require("moment");
const logging = require("../library/logging");
const helper = require("../library/helperFn");
const stream = require("stream");
const csvConverter = require("json-2-csv");
const { AWS } = require("../library/xray");
const { default: chalk } = require("chalk");
const logger = require("../library/logger")("microwarehouse-api:mw_api_inventory");
AWS.config.update({region: config.aws_region});

exports.get_container_inventory = async function(req, res) {
    let container = req.query.container;
    // If true, we will force the API to return Inventory details rather then a container hierarchy, even if the container is a location
    let getLocationInventory = req.query.getLocationInventory || false;
    let sql, args, results, error_message;
    let user = authHelper.parseRole(req);

    console.log(`${moment().format()} Process get_container_inventory Running on Id: ${process.pid}`);

    sql = `
        SELECT loc.hasFHBH, c.Type
        FROM container c
        INNER JOIN location loc ON c.LocationID = loc.ID
        WHERE c.ID = ?;`;
    args = [container];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.warn("get_container_inventory ERROR", error);
        res.status(500).json({"message": `Get Container Inventory request failed for container ${container}.`});
        return;
    }

    if (!results.length) {
        res.status(400).json({"message": `No Container available ${container}.`});
        return;
    }

    const hasFHBH = results[0].hasFHBH ? true : false;
    const Type = results[0].Type;
    if (Type === "STR" && hasFHBH && !getLocationInventory) {
        sql = `
                    SELECT ContainerID, 'Shop Floor' AS ParentContainer, COUNT(*) AS Keycodes, SUM(keycodeQty) AS Units
                    FROM (
                        SELECT i.ContainerID , i.Keycode, c.Type, COUNT(*) AS keycodeQty
                        FROM container c
                        INNER JOIN inventory i ON i.ContainerID = c.ID
                        INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
                        WHERE ct.isFoH = 1 AND ct.BackfillEnabled AND c.LocationID = ?
                        GROUP BY i.ContainerID, i.Keycode
                    ) A
                    GROUP BY ContainerID
                    ;
                    SELECT ContainerID, 'Back Of House' AS ParentContainer, COUNT(*) AS Keycodes, SUM(keycodeQty) AS Units
                    FROM (
                        SELECT i.ContainerID , i.Keycode, c.Type, count(*) AS keycodeQty
                        FROM container c
                        INNER JOIN inventory i ON i.ContainerID = c.ID
                        INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
                        # BoH inventory includes containers with isBoH of 1 AND Carts
                        WHERE ((ct.isBoH = 1 AND ct.BackfillEnabled = 1) OR c.Type = 'CRT') AND c.LocationID = ?
                        GROUP BY i.ContainerID, i.Keycode
                    ) A
                    GROUP BY ContainerID
                    ;
                    SELECT ContainerID, 'Other (Unavailable)' as ParentContainer,count(*) as Keycodes,  SUM(keycodeQty) as Units
                    FROM (
                        SELECT i.ContainerID , i.Keycode, c.Type, count(*) as keycodeQty
                        FROM container c
                        INNER JOIN inventory i ON i.ContainerID = c.ID
                        WHERE c.LocationID = ?
                        AND c.Type IN ('OTH', 'RCV')
                        GROUP BY i.ContainerID , i.Keycode
                    ) A
                    GROUP BY ContainerID
                ;
        `;
        args = [container, container, container];
        try {
            [results] = await ro_pool.query(sql, args);
        } catch (error) {
            console.warn("get_container_inventory ERROR", error);
            res.status(500).json({"message": `Get Container Inventory request failed for container ${container}.`});
            return;
        }

        let responseData = [];

        for (const data of results) {
            let Units = 0;
            let Keycodes = 0;
            for (const container of data) {
                Units += parseInt(container.Units);
                Keycodes += parseInt(container.Keycodes);
            }
            if (data.length) {
                responseData.push({"Container": data[0].ParentContainer, "Units": Units, "Keycodes": Keycodes, Containers: data});
            }
        }
        /**  Trying to create the Tree type response for Store type location with hasFHBH enabled
         *  "responseData": [
                    {
                        "Container": "Back Of House",
                        "Keycodes": 970,
                        "Units": 5420,
                        "Containers": [
                            {
                            "ContainerID": "1001-BOH1",
                            "ParentContainer": "Back Of House",
                            "Keycodes": 821,
                            "Units": 4791
                            },
                            {
                            "ContainerID": "1001-BOH2",
                            "ParentContainer": "Back Of House",
                            "Keycodes": 149,
                            "Units": 629
                            }
                        ],
                    },
                    {
                        "Container": "Shop Floor",
                        "Keycodes": 333,
                        "Units": 924,
                        "Containers": [
                            {
                            "ContainerID": "1001-STR",
                            "ParentContainer": "Shop Floor",
                            "Keycodes": 333,
                            "Units": 924
                            }
                        ],
                    },
                    {
                        "Container": "Incoming",
                        "Keycodes": 6,
                        "Units": 8,
                        "Containers": [
                            {
                            "ContainerID": "1001-CRT-NQ5W",
                            "ParentContainer": "Incoming",
                            "Keycodes": 6,
                            "Units": 8
                            }
                        ],
                    }
                }
        */
        res.status(200).json({"strTreeData": responseData, "ContainerType": Type, "hasFHBH": hasFHBH, "data": [], "case": [] });
        return;
    }

    // If the container is not Store or it is store but hasFHBH = false, continue with normal process
    sql = `
        SELECT p.APN, i.Keycode, i.Quantity, p.Style_ID, p.Item_Size as Size, p.US_Size, p.Secondary_Colour, p.Sell_Price_Usd, p.Sell_Price_Aus, p.Product_Name, pd.Name AS Department_Name, p.Online_Name, t.TargetLocation, t.QuantityFilled
        FROM (
            SELECT Keycode, COUNT(*) AS Quantity, ContainerID
            FROM inventory i WHERE i.ContainerID IN (
                # Select the container that the user desires
                SELECT ? AS ID
                UNION
                # Also get associated containers if this is a store with a FHBH
                SELECT c2.ID
                FROM container c
                LEFT JOIN container c2 ON c2.LocationID = c.LocationID
                WHERE c.ID = ? AND c.Type = 'STR' AND c2.Type = 'MOD'
            )
            GROUP BY i.ContainerID, i.Keycode
        ) AS i
        LEFT JOIN (
            SELECT t.Keycode, t.TargetContainer, tg.TargetLocation, t.Quantity AS taskQuantity, t.QuantityFilled, tg.Type
            FROM task t
            INNER JOIN inventory i ON i.TaskID = t.ID
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            INNER JOIN container c ON c.ID = i.ContainerID
            WHERE i.ContainerID = ?
            AND c.Type IN ("CRT","TOT")
            GROUP by t.Keycode
        ) AS t ON t.Keycode = i.Keycode
        INNER JOIN product p ON p.Keycode = i.Keycode
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        WHERE i.Keycode IS NOT NULL
        GROUP BY i.Keycode
        ;
        SELECT ic.Barcode, ic.CaseQuantity, GROUP_CONCAT(cb.Keycode) AS Keycodes, GROUP_CONCAT(cb.Quantity) AS Quantities,
            p.Product_Name, p.Online_Name, t.TargetLocation, t.QuantityFilled
        FROM (
            SELECT Barcode, COUNT(*) AS CaseQuantity
            FROM inventory_case i
            WHERE i.ContainerID = ?
            GROUP BY Barcode
        ) AS ic
        LEFT JOIN case_barcode cb ON cb.Barcode = ic.Barcode
        LEFT JOIN (
            SELECT t.Barcode, t.TargetContainer, tg.TargetLocation, t.Quantity AS taskQuantity, t.QuantityFilled, tg.Type
            FROM task t
            INNER JOIN inventory_case i on i.TaskID = t.ID
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            INNER JOIN container c ON c.ID = i.ContainerID
            WHERE i.ContainerID = ?
            AND c.Type IN ("CRT","TOT")
            GROUP by t.Barcode
        ) AS t ON t.Barcode = ic.Barcode
        LEFT JOIN product p ON p.Keycode = cb.Keycode
        GROUP BY Barcode`;
    args = [container, container, container, container, container];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.warn("get_container_inventory ERROR", error);
        error_message = `Get Container Inventory request failed for container ${container}.`;
        res.status(500).json({"message": error_message});
        return;
    }

    res.status(200).json({"data": results[0], "case": results[1], "strTreeData": []});
    console.log(moment().format("YYYY-MM-DD HH:mm:ss"), "get_container_inventory CALLED for:", container, "by:", user.id);
};

exports.get_product_inventory = async function(req, res) {
    let location = req.query.location;
    let keycode = req.query.keycode;
    let get_available = req.query.get_available; // optional flag to get only available inventory
    let container_type = req.query.container_type; // optional parameter to only get from a specified container type
    let typeRegex = /^\w{3}$/;
    let sql, args, results, error_message;
    let user = authHelper.parseRole(req);
    let hasFHBH = false; // If this location uses FOH and BOH (front/back of house)
    let FOH = 0; // Front-of-House
    let BOH = 0; // Back-of-House
    let unavailable = 0; // unavailable inventory(may be damage or something else), which can't be pick
    let data = [];

    console.log(`${moment().format()} Process get_product_inventory Running on Id: ${process.pid}`);

    if (!location || !keycode) {
        error_message = "Required parameters: location and keycode are missing!";
        res.status(400).json({"message": error_message});
        return;
    }

    if (get_available == "true" || get_available == 1) {
        get_available = "AND TaskID IS NULL";
    } else {
        get_available = "";
    }

    if (container_type && typeRegex.match(container_type)) {
        container_type = `AND Type = '${container_type}' `;
    } else {
        container_type = "";
    }

    sql = `
        SELECT c.*, COUNT(c.ID) AS Quantity, MIN(i.DateUpdated) as DateUpdated
        FROM container c
        INNER JOIN inventory i ON i.ContainerID = c.ID
        WHERE c.LocationID = ?
        AND i.Keycode = ?
        ${container_type}
        ${get_available}
        GROUP BY c.ID
        ORDER BY Quantity ASC
        ;
        SELECT * FROM (
            SELECT SUM(t.Quantity) AS Quantity, MIN(tg.DateDue) AS ETA
            FROM task t
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            WHERE
            t.Type ='Pick'
            AND t.Keycode = ?
            AND tg.TargetLocation = ?
            AND t.DateFulfilled IS NULL AND t.DateCompleted IS NOT NULL
            UNION
            SELECT SUM(t.Quantity * b.Quantity) AS Quantity, MIN(tg.DateDue) AS ETA
            FROM task t
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            INNER JOIN case_barcode b on b.Barcode = t.Barcode
            WHERE
            t.Type = 'Pick'
            AND b.Barcode = ?
            AND tg.TargetLocation = ?
            AND t.DateFulfilled IS NULL AND t.DateCompleted IS NOT NULL
        ) AS i
        ORDER BY Quantity DESC
        LIMIT 1
        ;
        SELECT ic.ContainerID AS ID, SUM(cb.Quantity) AS Quantity, COUNT(ic.Barcode) AS Cases
        FROM case_barcode cb
        INNER JOIN inventory_case ic ON ic.Barcode = cb.Barcode
        INNER JOIN container c ON c.ID = ic.ContainerID
        WHERE c.LocationID = ? AND cb.Keycode = ?
        GROUP BY ic.ContainerID
        ;
        SELECT hasFHBH FROM location WHERE ID = ?`;
    args = [location, keycode, keycode, location, keycode, location, location, keycode, location];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_product_inventory:", {error});
        res.status(500).json({"message": `Product Inventory request failed for location ${location} and product ${keycode}.`});
        return;
    }

    // If this location has a front-of-house and back-of-house
    if (results[3][0]["hasFHBH"]) {
        hasFHBH = true;
        // find out summary of STR qty and each container level qty
        let fohcontainerData = [];
        let bohContainerData = [];
        let otherContainerData = [];

        for (let row of results[0]) {
            // For locations with a front/back of house, MOD types are front-of-house (see jira ticket ANKO-594)
            if (row["Type"] === "STR" || row["Type"] === "MOD") {
                FOH += row["Quantity"];
                fohcontainerData.push({"ID": row["ID"], "Quantity": row["Quantity"], "DateUpdated": row["DateUpdated"]});
            } else if (row["Type"] === "SHL" || row["Type"] === "RSV") {
                BOH += row["Quantity"];
                bohContainerData.push({ "ID": row["ID"], "Quantity": row["Quantity"], "DateUpdated": row["DateUpdated"]});
            } else {
                unavailable += row["Quantity"];
                otherContainerData.push({ "ID": row["ID"], "Quantity": row["Quantity"], "DateUpdated": row["DateUpdated"]});
            }
        }

        data.push({
            "ID": "Shop Floor",
            "Quantity": FOH,
            "ContainerData": fohcontainerData
        },{
            "ID": "Back of House",
            "Quantity": BOH,
            "ContainerData": bohContainerData
        });

        if (unavailable > 0) {
            data.push({
                "ID": "Other (Unavailable)",
                "Quantity": unavailable,
                "ContainerData": otherContainerData
            });
        }

    } else {
        // If this location doesn't have front/back of house, then the data will just be index 0 of results
        data = results[0];
    }

    if ((results[0].length || results[1][0].Quantity != null || results[2].length) && results[3].length) {
        res.status(200).json({"data": data, "incoming": results[1][0], "case": results[2], "hasFHBH": hasFHBH});
        console.log(moment().format("YYYY-MM-DD HH:mm:ss"), "get_product_inventory CALLED for:", keycode , "by:", user.id);
    } else {
        error_message = `${keycode} was not found in ${location}`;
        res.status(404).json({"message": error_message});
    }
};

exports.get_inventory_by_style = async function(req, res) {
    let location = req.query.location;
    let styleID = parseInt(req.query.style);
    let sql, args, results;
    let hasFHBH = false;
    let data = [];

    console.log(`${moment().format()} Process get_inventory_by_style Running on Id: ${process.pid}`);

    if (!location || !styleID || styleID == 0) {
        let error = "Required parameters: location or style are missing!";
        logger.info("get_inventory_by_style - Missing required params: location=", location, ", style=", {styleID});
        res.status(400).json({"message": error});
        return;
    }

    sql = `
        SELECT
            p.APN,
            p.Keycode,
            p.Style_ID,
            IFNULL(p.Online_Name, p.Product_Name) AS Product_Name,
            p.Secondary_Colour AS Color,
            p.Item_Size AS Size,
            p.US_Size,
            IF(pp.Price, pp.Price, p.Sell_Price_Usd) AS Sell_Price_Usd,
            IMAGE_PRIMARY,
            IFNULL(i.Quantity, 0) AS Quantity,
            i.ContainerID,
            c.Type
        FROM product p
        LEFT JOIN (
            SELECT i.Keycode, COUNT(*) AS Quantity, i.ContainerID
            FROM product p
            LEFT JOIN inventory i ON i.Keycode = p.Keycode
            LEFT JOIN container c ON c.ID = i.ContainerID
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            WHERE
                p.Style_ID = ?
                AND (
                    c.ID IS NULL
                    OR c.LocationID = ?
                    OR (
                        c.ParentID = ?
                        AND ct.isBoH = 1
                        AND ct.BackfillEnabled = 1
                    )
                )
            GROUP BY p.Keycode, i.ContainerID
        ) AS i ON p.Keycode = i.Keycode
        LEFT JOIN product_pricing pp ON pp.Keycode = p.Keycode AND pp.LocationID = ?
        LEFT JOIN container c ON i.ContainerID = c.ID
        WHERE p.Style_ID = ?
        ORDER BY Color, Size
        ;
        SELECT hasFHBH FROM location WHERE ID = ?
        ;
        `;
    args = [styleID, location, location, location, styleID, location];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_inventory_by_style:", {error});
        res.status(500).json({"message": `Get Inventory By Style failed for location ${location} and style ID ${styleID}`});
        return;
    }

    // If this location does have front/back of house, then the data will need to be process in order to give correct Qty
    if (results[1][0]["hasFHBH"]) {
        hasFHBH = true;
        let keycodeDictionary = {}; // create a dictionary to find the total qty at BOH  & FOH
        for (let row of results[0]) {
            let isKeycodeExits = true; // flag to keep track that keycode already added to final result set
            let strQunatityObject;

            if (keycodeDictionary[row["Keycode"]]) {
                strQunatityObject = keycodeDictionary[row["Keycode"]];
                isKeycodeExits = false;
            } else {
                strQunatityObject = {"Shop Floor": 0, "Back of House": 0, "unavailable": 0};
            }

            if (row["Type"] === "MOD" || row["Type"] === "STR") {
                strQunatityObject["Shop Floor"] += row["Quantity"];
            } else if ( row["Type"] === "RSV" || row["Type"] === "SHL") {
                strQunatityObject["Back of House"] += row["Quantity"];
            } else {
                strQunatityObject["unavailable"] += row["Quantity"];
            }

            keycodeDictionary[row["Keycode"]] = strQunatityObject;
            row.Quantity = keycodeDictionary[row["Keycode"]];

            if (isKeycodeExits) {
                data.push(row);
            }
        }
    } else {
        // If this location doesn't have front/back of house, then the data will just be what we selected
        data = results[0];
    }

    if (results[0].length) {
        res.status(200).json({"data": data, hasFHBH: hasFHBH});
    } else {
        res.status(404).json({"message": `No product with Style ID ${styleID} was found in ${location}`});
    }
};

exports.get_cluster_inventory = async function(req, res) {
    let location = req.query.location;
    let barcode = req.query.barcode || null;
    let keycode = req.query.keycode || null;
    let sql, args, results, error_message;

    console.log(`${moment().format()} Process get_cluster_inventory Running on Id: ${process.pid}`);

    if (barcode == null &&  keycode == null) {
        res.status(400).json({"message": "Either barcode or keycode are required!"});
        return;
    }

    /* SQL:
     * Important - return all the stores and their inventory (so it will show 0 or more)
     * 1. Select Inventory for each store in the cluster
     * 2. Select Inventory from warehouse in the cluster
     * 3. Union both results together */

    sql = `CALL ${config.sql_database_for_sp}.cluster_inventory(?,?,?)`;
    args = [location,barcode,keycode];

    try {
        // The cluster_inventory stored procedure only has SELECT queries, so it's safe to execute this on the read-only DB
        [results] = await ro_pool.query(sql, args);
        if (results.length) {
            res.status(200).json({"data": results[0]});
        } else {
            error_message = `${location} is not a valid location!`;
            res.status(404).json({"message": error_message});
        }
    } catch (error) {
        error_message = `Get Cluster Inventory request failed for location ${location} and product ${barcode}.`;
        logger.error("get_cluster_inventory", {error});
        res.status(400).json({"message": error_message});
    }
};

exports.get_cart_inventory = async function(req, res) {
    let container = req.query.container;
    let taskID = parseInt(req.query.taskID) || null;
    let noVerification = req.query.noVerification === "true" || req.query.noVerification === 1 ? true : false;

    let results, sql, args, error_message, message;
    console.log(`${moment().format()} Process get_cart_inventory Running on Id: ${process.pid}`);

    sql = `
        SELECT c.Type, t.TargetLocation, i.ProductID, i.Keycode, t.Quantity, t.QuantityFilled, i.InventoryQuantity, i.HoursSinceUpdated, t.Type AS TaskType,
            tt.Destination
        FROM container c
        LEFT JOIN (
            SELECT
                ProductID,
                Keycode,
                COUNT(*) AS InventoryQuantity,
                ContainerID,
                TIMESTAMPDIFF(HOUR, MAX(DateUpdated), NOW()) AS HoursSinceUpdated
            FROM inventory WHERE ContainerID = ?
            GROUP BY Keycode
        ) AS i ON i.ContainerID = c.ID
        LEFT JOIN (
            SELECT
                t.Keycode,
                t.ProductID,
                t.TargetContainer,
                tg.TargetLocation,
                t.Quantity,
                t.QuantityFilled,
                tg.Type
            FROM task t
            INNER JOIN inventory i on i.TaskID = t.ID
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            WHERE i.ContainerID = ?
            GROUP BY t.Keycode
        ) AS t ON t.Keycode = i.Keycode
        LEFT JOIN (
            SELECT tg.TargetLocation AS Destination
            FROM task t
            INNER JOIN task_group tg ON t.TaskGroupID = tg.ID
            WHERE t.ID = ?
        ) AS tt ON true
        WHERE c.ID = ?
        ;
        SELECT c.Type, t.TargetLocation, i.Barcode, t.Quantity, t.QuantityFilled, i.InventoryQuantity, t.Type AS TaskType, tt.Destination
        FROM container c
        LEFT JOIN (
            SELECT ic.ContainerID, ic.Barcode, count(*) AS InventoryQuantity
            FROM inventory_case ic
            WHERE ic.ContainerID = ?
            GROUP BY ic.Barcode
        ) AS i ON i.ContainerID = c.ID
        LEFT JOIN (
            SELECT
                t.Keycode,
                t.Barcode,
                t.TargetContainer,
                tg.TargetLocation,
                t.Quantity,
                t.QuantityFilled,
                tg.Type
            FROM task t
            INNER JOIN inventory_case i on i.TaskID = t.ID
            INNER JOIN task_group tg ON tg.ID = t.TaskGroupID
            WHERE i.ContainerID = ?
            GROUP by t.Barcode
        ) AS t ON t.Barcode = i.Barcode
        LEFT JOIN (
            SELECT tg.TargetLocation AS Destination
            FROM task t
            INNER JOIN task_group tg ON t.TaskGroupID = tg.ID
            WHERE t.ID = ?
        ) AS tt ON true
        WHERE c.ID = ?`;
    args = [container, container, taskID, container, container, container, taskID, container];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.info("get_cart_inventory ERROR:", {error});
        error_message = `Cart Inventory request failed for container ${container}.`;
        res.status(500).json({"message": error_message});
        return;
    }
    if (!results[0].length) { // Container does not exist
        error_message = `Container ${container} does not exist!`;
        console.log(error_message);
        res.status(404).json({"message": error_message});
    }
    // Container exists, but no inventory
    if (results[0].length == 1 && results[0][0]["Keycode"] == null && results[1].length == 1 && results[1][0]["Barcode"] == null) {
        message = `Cart ${container} is empty.`;
        res.status(200).json({"message": message, "data": {}, "cases": {}});
        return;
    }
    // For Cart with Existing inventory - more validation!
    let invRow; // Point to the first results row that has inventory / invntory_case
    if (results[1][0]["Barcode"] != null) {
        invRow = results[1][0];
    } else {
        invRow = results[0][0];
    }

    if (noVerification) {
        // Do not verify anything.
    } else if (taskID && invRow.Type != "CRT") {
        // Ensure we are only picking into a cart, if taskID is associated!
        error_message = `Container ${container} is not a Cart!`;
    } else if (invRow.Type != "OTH" && invRow.Type != "CRT") {
        // Without taskID, allow picking into CRT or OTH
        error_message = `Container ${container} is not a Cart!`;
    } else if (taskID && !invRow.TargetLocation && invRow.InventoryQuantity > 0) {
        // If taskID is passed a destination and The target location is null and the amount of items is greater than 0 that means that
        // cart is in use for stow or manual pick and cannot be used for this task.
        error_message = `Cannot use Cart for destination ${invRow.Destination}. Cart ${container} already contains items for stow or manual pick.`;
    } else if (taskID && invRow.TargetLocation && invRow.Destination != invRow.TargetLocation) {
        // IF taskID is passed Destination and TargetLocation must equal.
        error_message = `Cannot use Cart for destination ${invRow.Destination}. Cart ${container} already contains items for ${invRow.TargetLocation}.`;
    } else if (!taskID && invRow.TargetLocation) {
        // IF taskID is not passed, TargetLocation cannot be populated!
        error_message = `Cart ${container} already contains items for another location: ${invRow.TargetLocation}.`;
    }

    if (error_message) {
        console.log(error_message);
        res.status(400).json({"message": error_message});
        return;
    }
    // Inventory exists, and allowed to add to the cart.
    res.status(200).json({"data": results[0], "cases": results[1], "targetLocation": invRow.TargetLocation});
};

exports.get_inventory_overages = async function(req, res) {
    let container = req.query.container || null;
    let sql, args, results, message;

    if (!container) {
        logger.info("No container");
        res.status(400).json({"message": `A container must be provided`});
        return;
    }

    sql = `
    SELECT p.APN, o.Keycode, COUNT(*) AS Quantity, o.ContainerID, p.Sell_Price_Usd, p.Product_Name,
        pd.Name AS Department_Name, p.Online_Name
    FROM inventory_overage o
    INNER JOIN product p ON p.Keycode = o.Keycode
    INNER JOIN product_department pd ON p.DepartmentID = pd.ID
    WHERE o.ContainerID = ?
    GROUP BY o.Keycode`;
    args = [container];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.info("get_inventory_overages ERROR:", {error});
        message = `Get Inventory Overages request failed for container ${container}.`;
        res.status(400).json({"message": message});
        return;
    }

    if (results.length) {
        res.status(200).json({"data": results});
        return;
    } else {
        message = `No Inventory Overages found for container ${container}`;
        res.status(200).json({"message": message});
        return;
    }
};

exports.get_stow_locations = async function(req, res) {
    let location = req.query.location;
    let barcode = req.query.barcode;
    let isCase = (req.query.isCase == "true") || false;
    let maxSKU = (isCase ? settings.receiveToStow.maxLocationPerCase : settings.receiveToStow.maxLocationPerSKU);
    let user = authHelper.parseRole(req);
    let sql, args, results, data, error_message;

    console.log(`${moment().format()} Process get_stow_locations Running on Id: ${process.pid}`);

    if (!location || !barcode) {
        error_message = "Required parameters: location and barcode";
        console.log(`get_stow_locations Error: ${error_message}`);
        res.status(400).json({"message": error_message});
        return;
    }

    try {
        [results] = await ro_pool.query("SELECT ID FROM location");
    } catch (error) {
        res.status(500).json({"message": "SQL error in: SELECT ID FROM location"});
        return;
    }

    if (!(results.map(a => a.ID).includes(location))) {
        res.status(404).json({"message": `The location ${location} was not found`});
        return;
    }

    if (isCase) {
        sql = `
            SELECT c.Type AS Type, ic.ContainerID AS ID, COUNT(*) AS Quantity
            FROM inventory_case ic
            LEFT JOIN container c ON c.ID = ic.ContainerID
            WHERE c.ParentID = ?
            AND ic.Barcode = ?
            AND c.Type = 'RSV'
            GROUP BY ic.ContainerID`;
        args = [location, barcode];
    } else {
        sql = `
            SELECT c.ID, c.Type, COUNT(*) AS Quantity
            FROM container c
            INNER JOIN inventory i ON i.ContainerID = c.ID
            INNER JOIN (
                SELECT keycode
                FROM product_barcode
                WHERE Barcode = ? OR Keycode = ?
            ) AS p ON p.Keycode = i.Keycode
            INNER JOIN container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            WHERE ct.isBoH = 1 AND ct.BackfillEnabled = 1 AND c.ParentID = ?
            GROUP BY c.ID
            ORDER BY c.Type DESC, c.ID`;
        args = [barcode, barcode, location];
    }

    try {
        [results] = await ro_pool.query(sql, args);
        data = {
            "locations": results,
            "maxSKU": maxSKU
        };
        console.log(moment().format("YYYY-MM-DD HH:mm:ss"), "get_stow_locations CALLED for:", barcode, "by:", user.id);
        res.status(200).json({"data": data});
    } catch (error) {
        error_message = `Get Stow Locations request failed for location ${location} and product ${barcode}.`;
        logger.error("get_stow_locations:", {error_message});
        res.status(500).json({"message": error_message});
    }
};

exports.create_inventory = async function(req, res) {
    let keycode = req.body.keycode || null;
    let barcode = req.body.barcode || null;
    let container = req.body.container;
    let quantity = parseInt(req.body.quantity) || 1;
    let UIprocess = req.body.process || "-";
    let user = authHelper.parseRole(req);
    let code = (keycode ? keycode : barcode); // Keycode or Barcode, defaulting to the keycode
    let sql, args, results, error_message;

    console.log(`${moment().format()} Process create_inventory Running on Id: ${process.pid}`);

    if (!code || !container) {
        res.status(400).json({"message": `A keycode or barcode must be provided, along with a container`});
        return;
    }

    sql = `CALL ${config.sql_database_for_sp}.create_inventory_bulk(?, ?, ?, ?, ?);`;
    args = [barcode, keycode, container, quantity, user.id];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("SQL error: ", {error});
        error_message = `Code ${code} or container ${container} is not valid; please contact the system administrator`;
        res.status(500).json({"message": error_message});
        return;
    }

    results = results[0];

    /* The results[0] object will have one of the three below variants:
     *
     * Example 1: [ { InsertedRows: 2, Keycode: 42610588 } ]
     * Example 2: [ { InsertedRows: 3, Keycode: null     } ]
     * Example 3: undefined
     *
     * For example 1, this happens when a product was inserted into the `inventory` table
     * The quantity inserted is given to us along with the keycode of the product
     *
     * For example 2, this happens when a case was inserted into the `inventory_case` table
     * There are no keycodes associate with inventory cases which is why the keycode is null
     *
     * For example 3, you'll get undefined when the code wasn't found at all
     */
    if (results == undefined) {
        error_message = `Code ${code} was not found; unable to receive inventory into container ${container}`;
        console.log(error_message);
        res.status(404).json({"message": error_message});
        return;
    } else {
        results = results[0];
        keycode = results["Keycode"];
    }

    if (keycode == "" || keycode == null) {
        keycode = "-"; // DynamoDB will say 'true' for null/empty strings, set it to '-' to be consistent
    }

    quantity = results["InsertedRows"];
    logging.log_inventory("INSERT", barcode, keycode, quantity, "-", container, user.id, "create_inventory", UIprocess);
    res.status(200).json({"message": `Created inventory at ${container}: ${quantity}x ${code}`});
};

exports.adjust_inventory = async function(req, res) {
    let barcode  = req.body.barcode || null;
    let container = req.body.container || null;
    let quantity = parseInt(req.body.quantity);
    let taskId = parseInt(req.body.task_id) || null;
    let isRestricted = req.body.restricted;
    let UIprocess = req.body.process || "-";
    let reason = req.body.reason || null;
    let sourceContainer = null;
    let targetContainer = null;
    let managerOverride = true; // Users with the inventory role have full trust to adjust inventory
    let body, sql, args, inventoryAdjustmentArgs, results, resultsInventory, resultsInventoryCase, message;
    let virtualInventory, physicalInventory, delta;
    let difference, identifierType, keycode, referenceID;

    console.log(`${moment().format()} Process adjust_inventory Running on Id: ${process.pid}`);

    if (!barcode) {
        let args = [taskId];
        let sql = `
            SELECT pb.Barcode
            FROM task t
            INNER JOIN product_barcode pb ON pb.Keycode = t.Keycode
            WHERE ID = ?
            LIMIT 1`;
        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": "Unable to get Keycode from Barcode"});
            return;
        }

        if (results.length) {
            barcode = results[0]["Barcode"];
        } else {
            res.status(400).json({"message": "Unable to get Keycode from Barcode"});
            return;
        }
    }

    if (!barcode || !container || isNaN(quantity)) {
        res.status(400).json({"message": "Barcode, container and quantity are required!"});
        return;
    } else if (quantity < 0 || quantity > settings.validation.maxQtyOverride ||
              (quantity > settings.validation.maxQuantity && settings.validation.maxQtyOverrideList.indexOf(barcode) < 0)) {
        // Quantity must be 0-250 (maxQuantity), or 500 (maxQtyOverride) and on the maxQtyOverrideList
        message = `Quantity can only be between 0-${settings.validation.maxQuantity} for most items!`;
        res.status(400).json({"message": message});
        return;
    }

    if (isRestricted == 1 || isRestricted == "true") {
        isRestricted = 1;
    } else {
        isRestricted = 0;
    }

    // First, retrive current inventory level
    physicalInventory = quantity;
    logger.info("Finding virtual quantity at the location:", {container});

    /* The first SQL query checks for inventory, and the second SQL query checks for inventory_case
     * There should only be results for one these queries because a container ID should NEVER exist
     * in both the tables inventory and inventory_case
     */
    args = [barcode, barcode, container, container, barcode, container];
    sql = `
        SELECT
            p.APN,
            pb.Keycode,
            p.Retail_Zone_Name,
            p.Class_Name,
            c.ID,
            c.Type,
            c.LocationID,
            IFNULL(i.quantity, 0) AS Quantity
        FROM product p
        INNER JOIN (
            SELECT Keycode FROM product_barcode WHERE (Barcode = ? || Keycode = ?) LIMIT 1
        ) as pb on p.Keycode = pb.Keycode
        INNER JOIN container c on ID = ?
        LEFT JOIN (
            SELECT Keycode, ContainerID, COUNT(*) AS quantity FROM inventory WHERE ContainerID = ? GROUP BY Keycode
        ) as i on i.Keycode = p.Keycode
        ;
        SELECT Barcode, ContainerID, COUNT(*) AS Quantity
        FROM inventory_case
        WHERE Barcode = ? AND ContainerID = ? GROUP BY Barcode`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("adjust_inventory:", {error});
        res.status(500).json({"message": `Adjusting the inventory failed for ${barcode}  at ${container}`});
        return;
    }

    resultsInventory = results[0];
    resultsInventoryCase = results[1];

    if (resultsInventory.length && resultsInventoryCase.length) {
        // There should only be results for one query, because a container ID should NEVER exist in both the tables inventory and inventory_case
        res.status(400).json({"message": `The location ${container} contains both individual units and cases! Please contact your Manager or Administrator.`});
        return;
    } else if (resultsInventory.length) {
        results = resultsInventory[0];
    } else if (resultsInventoryCase.length) {
        results = resultsInventoryCase[0];
    } else {
        res.status(404).json({"message": `Product ${barcode} does not exist`});
        return;
    }

    virtualInventory = results["Quantity"];
    keycode = results["Keycode"];

    // Default message
    message = `Inventory of ${keycode} in ${container} is ${quantity}.`;

    // SET location info based on container type:
    // Target = Location, Source is shelf or zone.
    if (results.Type == "STR") {
        targetContainer = container;
        sourceContainer = results.Retail_Zone_Name;
    } else { // It's a shelf in WRH
        targetContainer = results.LocationID;
        sourceContainer = container;
    }

    delta      = physicalInventory - virtualInventory;
    difference = Math.abs(delta);

    try {
        // If a Task ID was defined, check to see if this was a random inventory checking task or not
        if (taskId) {
            try {
                let [randomTest] = await pool.query("SELECT isRandom FROM task WHERE ID = ?", [taskId]);

                if (randomTest[0]["isRandom"]) {
                    identifierType = "random"; // If the isRandom boolean for the associated TaskID is true
                } else {
                    identifierType = "suspicious"; // If the isRandom boolean for the associated TaskID is false
                }
            } catch (error) {
                console.log(error);
                message = `ERROR: Bad query or no results when looking for TaskID: ${taskId}`;
                res.status(500).json({"message": message});
                return;
            }
        } else {
            // If no Task ID was defined, then this is a "manual" type
            identifierType = "manual";
        }

        // Document/log inventory adjustment details into the table: inventory_adjustment. This will happen no
        // matter what the case may be, whether it's a positive increase, negative decrease, or no change at all
        sql = "INSERT INTO inventory_adjustment (TaskID, UserID, ContainerID, Keycode, ProductID, ExpectedQty, ActualQty, Delta, IdentifierType, Reason) VALUES ?;";
        inventoryAdjustmentArgs = [taskId, req.headers["user-id"], container, keycode, barcode, virtualInventory, physicalInventory, delta, identifierType, reason];

        args = [[inventoryAdjustmentArgs]];

        try {
            await pool.query(sql, args);
        } catch (error) {
            logger.info("adjust_inventory INSERT ERROR", {error});
        }

        if (difference == 0) {
            // Do nothing
        } else if (difference <= 5 || managerOverride) {
            /* If the change is small enough, Or if the user is manager and this is a Manager Review task, then it can be executed
             * immediately (difference of 5 or less). Otherwise if the change is too big, Create a task for manager to review
             */
            if (physicalInventory > virtualInventory) {
                // There is more stock in the physical store than what was virtually reported, so items need to be added
                console.log(`Inventory adjustment for ${barcode}: adding ${difference} to ${container}`);
                message += ` (${difference} added to inventory)`;
                await apiRequest.post(req, "create_inventory", {"keycode": keycode, "container": container, "quantity": difference, "process": UIprocess});
            } else if (physicalInventory < virtualInventory) {
                // There is less stock in the physical store than what was virtually reported, so items need to be removed
                console.log(`Inventory adjustment for ${barcode}: removing ${difference} from ${container}`);
                message += ` (${difference} removed from inventory)`;
                await apiRequest.delete(req, "delete_inventory_nb", {"keycode": keycode, "container": container, "quantity": difference, "process": UIprocess});
            }
        } else { // This condition is currently not used because this method will ALWAYS have managerOverride be true (users with the inventory role have full trust)
            // If the change is too big (greater than 5), then it needs to be reviewed
            console.log(`Inventory adjustment of ${difference} for ${barcode} at ${container} submitted for review.`);
            message = `Inventory adjustment for ${barcode} in ${container} exceeds threshold and is scheduled for review.`;
            body = {
                "type"            : "Inventory",
                "keycode"         : keycode,
                "quantity"        : physicalInventory,
                "source_container": sourceContainer,
                "target_container": targetContainer,
                "is_restricted"   : 1
            };

            let result = await apiRequest.post(req, "task/create", body);
            logger.info("Create task result: ", {result});
        }
    } catch (error) {
        logger.error("adjust_inventory:", {error});
        res.status(500).json({"message": error});
        return;
    }

    let resBody = {
        "message": message,
        "virtual": virtualInventory,
        "actual": physicalInventory
    };
    res.status(200).json(resBody);
};

// TODO: Depricate and use adjust_container_inventory with some new changes that will be needed
exports.adjust_shelf_inventory = async function(req, res) {
    let blacklistedContainers = ["STR", "WRH"]; // Store, Warehouse
    let ContainerID = req.body.ContainerID || null;
    let ProductQtyArray = req.body.Data || null;
    let taskId = req.body.TaskID || null; // Optional Task ID to complete this task
    let UIprocess = req.body.Process || "-";
    let user = authHelper.parseRole(req);
    let inventoryAdjustmentArgs = [];
    let inventoryAdjustmentLogging = {};
    let message = "";
    let sqlTaskMemory = "";
    let argsTaskMemory = [];
    let sql, args, results, identifierType, sqlToSelectTable, argsToSelectTable;
    let selectResultsInventory, selectResultsInventoryCase, taskResultsInventory, taskResultsInventoryCase;

    console.log(`${moment().format()} Process adjust_shelf_inventory Running on Id: ${process.pid}`);


    if (!ContainerID || !ProductQtyArray) {
        res.status(400).json({"message": "ContainerID and Data are required parameters"});
        return;
    }

    // Make sure that the user does NOT try to adjust a non-existent container, AND that it's an allowed container
    try {
        [results] = await pool.query("SELECT Type FROM container WHERE ID = ?", [ContainerID]);
        if (results.length == 0) {
            res.status(400).json({"message": "That container does not exist"});
            return;
        }

        if (blacklistedContainers.includes(results[0]["Type"])) {
            res.status(400).json({"message": "You are not allowed to adjust inventory on this container"});
            return;
        }
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": "ContainerID and Data are required parameters"});
        return;
    }

    // It's extremely important to try-catch parsing the JSON we received from the user to ensure it's valid
    try {
        ProductQtyArray = JSON.parse(ProductQtyArray);
    } catch (error) {
        logger.error("adjust_shelf_inventory:", {error});
        res.status(400).json({"message": "Unable to parse the JSON object passed into the Data parameter"});
        return;
    }

    if (ProductQtyArray.length) {
        /* The user reported that the container contains at least one product. Here are two examples of the product
         * quantity array. The first example being an adjustment to products for a shelf in a store or warehouse,
         * and the second example being for an adjustment to case quantity for a container in a warehouse.
         *
         * Example of adjusting product inventory for a shelf in a store or warehouse:
         * [{"Barcode": "019071288088", "Quantity": 2},
         *  {"Barcode": "019071868051", "Quantity": 3},
         *  {"Barcode": "047754605006", "Quantity": 4}]
         *
         * Example of adjusting case quantity for the inventory of cases within a container in a warehouse:
         * [{"Barcode": "CS-0-37538590","Quantity": 2},
         *  {"Barcode": "CS-1-42440444","Quantity": 3},
         *  {"Barcode": "MX-0000000012","Quantity": 4}]
         *
         * We used to only handle one or the other, but since we are now allowing co-mingled inventory
         * (this means that individual items and cases can exist in the same container), we need to always
         * handle both the `inventory` and `inventory_case` tables. Individual items will ALWAYS ONLY go into
         * the table `inventory` and cases will ALWAYS ONLY go into the table `inventory_case`
         *
         * Define SQL for adjusting the tables: `inventory` and `inventory_case`
         * 1. Find keycodes for inventory in the specified container
         * 2. Find barcodes for inventory_case in the specified container
         * 3. Find task IDs for inventory in the specified container
         * 4. Find task IDs for inventory_case in the specified container
         * 5. Delete everything from inventory in the specified container
         * 6. Delete everything from inventory_case in the specified container */
        sqlToSelectTable = `
            SELECT Keycode, NULL AS Barcode, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ?
            GROUP BY Keycode
            ;
            SELECT NULL AS Keycode, Barcode, COUNT(*) AS Quantity
            FROM inventory_case
            WHERE ContainerID = ?
            GROUP BY Barcode
            ;
            SELECT Keycode AS Code, TaskID, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ? AND TaskID IS NOT NULL
            GROUP BY Keycode, TaskID
            ;
            SELECT Barcode AS Code, TaskID, COUNT(*) AS Quantity
            FROM inventory_case
            WHERE ContainerID = ? AND TaskID IS NOT NULL
            GROUP BY Barcode, TaskID
            ;
            DELETE FROM inventory WHERE ContainerID = ?
            ;
            DELETE FROM inventory_case WHERE ContainerID = ?`;
        argsToSelectTable = [ContainerID, ContainerID, ContainerID, ContainerID, ContainerID, ContainerID];

        /* Go through the data the user sent us, and add the following properties into it
         * 1. The type of whatever it is that they scanned; this will either be an "item" or "case"
         * 2. If they scanned an "item", retrieve its "Keycode" from the table `product_barcode` */
        for (let i = 0; i < ProductQtyArray.length; i++) {
            let barcode = ProductQtyArray[i]["Barcode"];

            /* barcode will either be a valid SKU belonging to a product such as 046726010770, or it will be a
             * Case Barcode such as CS-0-10000004. This will always be a string, and a barcode belonging to a
             * case will always start with a letter (NEVER a number). In order to determine the type which is
             * either "item" or "case", simply check the first character of the string for a letter or number */
            if (isNaN(barcode[0])) {
                ProductQtyArray[i]["Type"] = "case";
            } else {
                ProductQtyArray[i]["Type"] = "item";

                try {
                    [results] = await pool.query("SELECT Keycode FROM product_barcode WHERE Barcode = ? or Keycode = ?", [barcode, barcode]); // Returns one keycode
                } catch (error) {
                    logger.info("adjust_shelf_inventory ERROR: ", {error});
                    res.status(400).json({"message": "Unable to get a keycode from the barcode"});
                    return;
                }


                ProductQtyArray[i]["Keycode"] = results[0]["Keycode"];
            }
        }

        try {
            [results] = await pool.query(sqlToSelectTable, argsToSelectTable);
        } catch (error) {
            logger.error("adjust_shelf_inventory (select):", {error});
            res.status(400).json({"message": "Error while attempting to remove existing inventory."});
            return;
        }

        selectResultsInventory     = results[0]; // Store the SELECT results from the `inventory` table
        selectResultsInventoryCase = results[1]; // Store the SELECT results from the `inventory_case` table
        taskResultsInventory       = results[2]; // Store the Task ID results from the `inventory` table
        taskResultsInventoryCase   = results[3]; // Store the Task ID results from the `inventory_case` table

        // Store the quantity of each unique task for each keycode in `inventory`
        for (let result of taskResultsInventory) {
            let code = result["Code"];
            let taskId = result["TaskID"];
            let quantity = result["Quantity"];

            sqlTaskMemory += "UPDATE inventory SET TaskID = ? WHERE ContainerID = ? AND Keycode = ? ORDER BY IsSuspicious ASC, TaskID ASC LIMIT ?;";
            argsTaskMemory.push(taskId, ContainerID, code, quantity);
        }

        // Store the quantity of each unique task for each keycode in `inventory_case`
        for (let result of taskResultsInventoryCase) {
            let code = result["Code"];
            let taskId = result["TaskID"];
            let quantity = result["Quantity"];

            sqlTaskMemory += "UPDATE inventory_case SET TaskID = ? WHERE ContainerID = ? AND Barcode = ? ORDER BY IsSuspicious ASC, TaskID ASC LIMIT ?;";
            argsTaskMemory.push(taskId, ContainerID, code, quantity);
        }
    } else {
        // The user reported that the container to adjust is completely empty
        sql = `
            SELECT Keycode, NULL AS Barcode, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ?
            GROUP BY Keycode
            ;
            SELECT NULL AS Keycode, Barcode, COUNT(*) AS Quantity
            FROM inventory_case
            WHERE ContainerID = ?
            GROUP BY Barcode
            ;
            DELETE FROM inventory WHERE ContainerID = ?
            ;
            DELETE FROM inventory_case WHERE ContainerID = ?`;
        args = [ContainerID, ContainerID, ContainerID, ContainerID];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("adjust_shelf_inventory (select):", {error});
            res.status(400).json({"message": "Error while attempting to remove existing inventory."});
            return;
        }

        selectResultsInventory     = results[0];
        selectResultsInventoryCase = results[1];
    }

    // Log the items that have been deleted in the table `inventory`
    for (let result of selectResultsInventory) {
        // Example of a result if we're adjusting product inventory for a shelf in a store or warehouse:
        // { Keycode: 42610588, Barcode: null, Quantity: 3 }
        let keycode = result["Keycode"]; // This will be defined for products in inventory, and null for cases in inventory_case
        let existingCode = keycode; // Get whichever one is defined
        let quantityDeleted = result["Quantity"];
        let actualQuantity = 0;

        // Get the actual quantity of this product which is reported by the user
        for (let product of ProductQtyArray) {
            // Keycodes for inventory
            if (product["Keycode"] == keycode) {
                actualQuantity = product["Quantity"];
                break;
            }
        }

        logging.log_inventory("DELETE", null, keycode, quantityDeleted, ContainerID, "-", user.id, "adjust_shelf_inventory", UIprocess);

        // The key will be the barcode if it's a product, or the case's barcode if it's a case
        inventoryAdjustmentLogging[existingCode] = {
            "keycode": keycode,                       // The keycode (or null if this is adjusting for inventory_case)
            "barcode": null,                          // The barcode (or null if this is adjusting for inventory)
            "quantityDeleted": quantityDeleted,       // The quantity that was expected in the database; this may or may not be correct
            "actualQuantity": actualQuantity,         // The actual quantity of items on the shelf that the user reported
            "delta": actualQuantity - quantityDeleted // Delta; positive value if we had more items than we thought; negative if it's less
        };
    }

    // Log the cases that have been deleted  in the table `inventory_case`
    for (let result of selectResultsInventoryCase) {
        // Example of result if we're adjusting case quantity for the inventory of cases within a container in a warehouse:
        // { Keycode: null, Barcode: "CS-0-37538590", Quantity: 5 }
        let barcode = result["Barcode"]; // This will be defined for cases in inventory_case, and null for products in inventory
        let existingCode = barcode; // Get whichever one is defined
        let quantityDeleted = result["Quantity"];
        let actualQuantity = 0;

        // Get the actual quantity of this product which is reported by the user
        for (let product of ProductQtyArray) {
            // Barcodes for inventory_case
            if (product["Barcode"] == barcode) {
                actualQuantity = product["Quantity"];
                break;
            }
        }

        logging.log_inventory("DELETE", barcode, null, quantityDeleted, ContainerID, "-", user.id, "adjust_shelf_inventory", UIprocess);

        // The key will be the barcode if it's a product, or the case's barcode if it's a case
        inventoryAdjustmentLogging[existingCode] = {
            "keycode": null,                          // The keycode (or null if this is adjusting for inventory_case)
            "barcode": barcode,                       // The barcode (or null if this is adjusting for inventory)
            "quantityDeleted": quantityDeleted,       // The quantity that was expected in the database; this may or may not be correct
            "actualQuantity": actualQuantity,         // The actual quantity of items on the shelf that the user reported
            "delta": actualQuantity - quantityDeleted // Delta; positive value if we had more items than we thought; negative if it's less
        };
    }

    // Create new inventory in this container
    try {
        for (let product of ProductQtyArray) {
            let keycode = product["Keycode"] || null;
            let barcode = product["Barcode"];
            let code = (keycode ? keycode : barcode);
            let quantity = product["Quantity"];

            let body = {
                "keycode": keycode,
                "barcode": barcode,
                "container": ContainerID,
                "quantity": quantity,
                "process": UIprocess
            };

            // This API determines on its own if it's an item in `inventory` or case in `inventory_case`
            await apiRequest.post(req, "create_inventory", body);

            // It's possible that we already have adjustment data on this barcode from earlier when it was removed from the inventory.
            // If we DO NOT have adjustment data on this, that means the DB didn't think we had any located on this shelf and therefore
            // didn't delete any (expected stock for this container/shelf was zero).
            if (!(code in inventoryAdjustmentLogging)) {
                if (keycode) {
                    barcode = null;
                }

                inventoryAdjustmentLogging[code] = {
                    "keycode": keycode,         // The keycode (or null if this is adjusting for inventory_case)
                    "barcode": barcode,         // The barcode (or null if this is adjusting for inventory)
                    "quantityDeleted": 0,       // The quantity that was expected in the database; this may or may not be correct
                    "actualQuantity": quantity, // The actual quantity of items on the shelf that the user reported
                    "delta": quantity           // Delta; positive value if we had more items than we thought; negative if it's less
                };
            }
        }
    } catch (error) {
        logger.error("adjust_shelf_inventory (creating inventory):", {error});
        res.status(error.status).json({"message": error.message});
        return;
    }

    // Call the query for updating task IDs for the inventory if we have any to update
    if (argsTaskMemory.length) {
        try {
            await pool.query(sqlTaskMemory, argsTaskMemory); // The appropiate SQL query for updating tasks was defined earlier
        } catch (error) {
            logger.error("adjust_shelf_inventory (inventory taskIDs):", {error});
            res.status(500).json({"message": `ERROR: Unable to update tasks for the containers, please contact your system administrator`});
            return;
        }
    }

    // Determine the "identifierType" before we log the inventory adjustment
    if (taskId) {
        // If a Task ID was defined, check to see if this was a random inventory checking task or not
        try {
            [results] = await pool.query("SELECT isRandom FROM task WHERE ID = ?", [taskId]);

            if (results[0]["isRandom"]) {
                identifierType = "random"; // If the isRandom boolean for the associated TaskID is true
            } else {
                identifierType = "suspicious"; // If the isRandom boolean for the associated TaskID is false
            }
        } catch (error) {
            logger.error("adjust_shelf_inventory (get type):", {error});
            res.status(500).json({"message": `ERROR: Bad query for task ${taskId}, please contact your system administrator`});
            return;
        }
    } else {
        identifierType = "manual"; // The type is manual if no Task ID was defined
    }

    // Log inventory adjustment details into the inventory_adjustment table. This happens for positive increase, negative decrease, or no change at all
    try {
        for (let barcode in inventoryAdjustmentLogging) {
            let productInfo = inventoryAdjustmentLogging[barcode];

            inventoryAdjustmentArgs.push([
                taskId,                         // TaskID
                req.headers["user-id"],         // UserID
                ContainerID,                    // ContainerID
                productInfo["keycode"],         // Keycode
                productInfo["barcode"],         // Barcode
                productInfo["quantityDeleted"], // The quantity that was expected in the database; this may or may not be correct
                productInfo["actualQuantity"],  // The actual quantity of items on the shelf that the user reported
                productInfo["delta"],           // Delta; positive value if we had more items than we thought; negative if it's less
                identifierType                  // IdentifierType
            ]);
        }

        if (inventoryAdjustmentArgs.length) {
            let sql = "INSERT INTO inventory_adjustment (TaskID, UserID, ContainerID, Keycode, ProductID, ExpectedQty, ActualQty, Delta, IdentifierType) VALUES ?";
            await pool.query(sql, [inventoryAdjustmentArgs]);
        }
    } catch (error) {
        logger.error("adjust_shelf_inventory (adjustment):", {error});
        res.status(500).json({"message": `ERROR: Bad query for inventory adjustment logging, please contact your system administrator`});
        return;
    }

    message += `Inventory successfully adjusted for shelf ${ContainerID}.`;

    // If task ID is provided, update the status if it's for the same container.
    if (taskId) {
        sql = `UPDATE task SET DateCompleted = NOW(), AssignedUserID = ? where ID = ? and SourceContainer = ?`;
        args = [user.id, taskId, ContainerID];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("adjust_shelf_inventory (update task):", {error});
            res.status(500).json({"message": `ERROR: Bad query for updating task ${taskId}, please contact your system administrator`});
            return;
        }

        if (results["affectedRows"]) {
            message += " Task complete!";
        }
    }

    res.status(200).json({"message": message});
};

exports.reconcile_inventory = async function(req, res) {
    let container = req.body.container || null;
    let sql, args, results, message;
    let user = authHelper.parseRole(req);
    let UIprocess = req.body.Process;

    console.log(`${moment().format()} Process reconcile_inventory Running on Id: ${process.pid}`);

    if (!container) {
        res.status(400).json({"message": "The container parameter is required"});
        return;
    }

    sql = `
        SELECT i.Keycode, p.APN, i.TaskID, COUNT(*) AS Quantity
        FROM inventory i
        INNER JOIN product p on p.Keycode = i.Keycode
        WHERE ContainerID = ?
        GROUP BY Keycode
        ;
        SELECT o.Keycode, p.APN, o.TaskID, Count(*) as Quantity
        FROM inventory_overage o
        INNER JOIN product p on p.Keycode = o.Keycode
        WHERE o.ContainerID = ?
        GROUP BY Keycode
        ;
        SELECT *
        FROM container
        WHERE ID = ? AND Type = 'RCV'
        ;
        SELECT ID, RowID, QuantityFilled
        FROM task
        WHERE SourceContainer = ? AND Type = 'CrossDock' AND DateCompleted IS NULL`;
    args = [container, container, container, container];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `Reconcile Inventory ERROR`});
        return;
    }

    let virtuals = results[0];
    let overages = results[1];
    let iscontainer = results[2];
    let crossDockCleanup = results[3];

    // Cleanup all CrossDock tasks that are associated with the RCV location that we're reconciling. Close CrossDock tasks
    // and their associated replenish orders for all tasks that never got updated with any quantity (or less quantity)
    if (crossDockCleanup.length) {
        sql = "";
        args = [];
        for (let row of crossDockCleanup) {
            let id = row["ID"];
            let rowId = row["RowID"];
            let quantityFilled = row["QuantityFilled"];

            // A task that didn't receive a single product will be filled as zero and fulfilled immediately
            if (quantityFilled === null) {
                quantityFilled = 0;
                sql += `UPDATE task SET QuantityFilled = ?, QuantityDelivered = 0, DateCompleted = NOW(), DateFulfilled = NOW() WHERE ID = ?;`;
            } else {
                sql += `UPDATE task SET QuantityFilled = ?, DateCompleted = NOW() WHERE ID = ?;`;
            }

            sql += `UPDATE task_group SET DateCompleted = NOW() WHERE ID = ?;`;
            sql += `UPDATE replenish_order SET QuantityFilled = ?, DateFulfilled = NOW() WHERE RowID = ?;`;
            args.push(quantityFilled, id, id, quantityFilled, rowId);
        }

        try {
            await pool.query(sql, args);
        } catch (error) {
            logger.error("reconcile_inventory:", {error});
            res.status(500).json({"message": "Unable to reconcile inventory"});
            return;
        }
    }

    if (iscontainer.length == 0) {
        message = `Container needs to be a RCV location`;
        console.log(message);
        res.status(400).json({"message": message});
        return;
    }

    if (virtuals.length == 0 && overages.length == 0) {
        message = `No inventory to reconcile`;
        res.status(200).json({"message": message});
        return;
    }

    args = [];

    for (let virtual of virtuals) {
        args.push([
            virtual.TaskID,             // TaskID
            user.id,                    // UserID
            container,                  // ContainerID
            virtual.Keycode,            // Keycode
            virtual.APN,                // Barcode
            virtual.Quantity,           // The quantity that was expected in the database; this may or may not be correct
            0,                          // The actual quantity of items on the shelf that the user reported
            (virtual.Quantity * -1),    // Delta; positive value if we had more items than we thought; negative if it's less
            "reconcile"                 // IdentifierType
        ]);
    }

    for (let overage of overages) {
        args.push([
            overage.TaskID,             // TaskID
            user.id,                    // UserID
            container,                  // ContainerID
            overage.Keycode,            // Keycode
            overage.APN,                // Barcode
            0,                          // The quantity that was expected in the database; this may or may not be correct
            overage.Quantity,           // The actual quantity of items on the shelf that the user reported
            overage.Quantity,           // Delta; positive value if we had more items than we thought; negative if it's less
            "reconcile"                 // IdentifierType
        ]);
    }

    sql = `
        INSERT INTO inventory_adjustment (TaskID, UserID, ContainerID, Keycode, ProductID, ExpectedQty, ActualQty, Delta, IdentifierType) VALUES ?`;
    try {
        await pool.query(sql, [args]);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `ERROR: Bad query for inventory adjustment logging, please contact your system administrator`});
        return;
    }

    sql = `
        DELETE FROM inventory WHERE ContainerID = ?
        ;
        DELETE FROM inventory_overage WHERE ContainerID = ?`;
    args = [container,container];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `Reconcile Inventory ERROR`});
        return;
    }

    for (let virtual of virtuals) {
        logging.log_inventory("DELETE", virtual.APN, virtual.Keycode, virtual.Quantity, container, "-", user.id, "reconcile_inventory", UIprocess);
    }

    message = `Inventory Reconciled Successfully!`;
    res.status(200).json({"message": message});

};

exports.move_inventory = async function(req, res) {
    let inKeycode = req.body.keycode || req.query.keycode || null;
    let inBarcode = req.body.barcode || req.query.barcode || null;
    let srcContainer = req.body.source_container || req.query.source_container;
    let tgtContainer = req.body.target_container || req.query.target_container;
    let allowOverage = req.body.allowOverage == "true" || req.body.allowOverage == 1 || req.query.allowOverage == "true" ? true : false;
    let inAvailableOnly = req.body.inAvailableOnly == "true" || req.body.inAvailableOnly == 1 || req.query.inAvailableOnly == "true" ? true : false;
    let quantity = parseInt(req.body.quantity || req.query.quantity) || 1;
    let taskID = parseInt(req.body.task_id || req.query.task_id) || null;
    let UIprocess = req.body.process || req.query.process || "-";

    let sql, args, results, message, barcode = null, keycode = null;

    console.log(`${moment().format()} Process move_inventory Running on Id: ${process.pid}`);

    if (srcContainer == null || tgtContainer == null || (inKeycode == null && inBarcode == null)) {
        var error = "Source Container, Target Container and Keycode or Barcode are required!";
        res.status(400).json({"message": error});
        return;
    }

    let user = authHelper.parseRole(req);
    //  move_inventory params: barcode, keycode, srcContianer, tgtContainer, taskID, userID, Quantity, MinQuantity
    sql =  `CALL ${config.sql_database_for_sp}.move_inventory(?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    args = [inBarcode, inKeycode, srcContainer, tgtContainer, taskID, user.id, quantity, allowOverage?1:quantity,inAvailableOnly?1:0];

    try {
        [results] = await pool.query(sql, args);
        results = results[0][0]; // Always grab first result for stored procedure.
        keycode = results.keycode;
        barcode = results.barcode;
    } catch (error) {
        logger.info("move_inventory ERROR: ", {error});
        res.status(500).json({"message": "Error occured while trying to move inventory"});
        return;
    }
    /** RESPONSE FORMAT:
     * validationPassed (0/1), quantityMoved (0/1), keycode, barcode,
     * srcContainer, srcType, srcQuantity, tgtContainer, tgtType;
     */
    message = null;
    if (!results.validationPassed) { // Return validation error response
        if (results.srcType == null || results.tgtType == null) {
            message = `Unable to move inventory from ${srcContainer} to ${tgtContainer}. Containers not valid.`;
        } else if (barcode == null && keycode == null) {
            message = `Unable to move inventory. Barcode ${inBarcode} or Keycode ${inKeycode} is NOT valid!`;
        } else if (results.srcQuantity < quantity && !allowOverage && !inAvailableOnly) { // No srcQuantity, unless allowOverage.
            message = `Unable to move ${quantity}x ${barcode || keycode} from ${srcContainer} which has ${results.srcQuantity} in inventory.`;
        } else if (results.srcAvailQty < quantity && !allowOverage && inAvailableOnly) {
            message = `Unable to move ${quantity} of ${barcode || keycode} from ${srcContainer} which has ${results.srcAvailQty} (Non Reserved) inventory available.`;
        } else if ((results.tgtType == "STR" || results.tgtType == "WRH") && !(results.srcType == "TOT" && results.tgtType == "STR")) {
            message = `Unable to move inventory directly to STR or WRH. Please use Bulk Stow.`; // Moving products from a Tote into a Store is OKAY!
        }
    } else if (!results.quantityMoved && !allowOverage) { // If quantityMoved is 0 even after validation passed, that is not good.
        message = `No inventory was moved for ${keycode || barcode} from ${srcContainer} to ${tgtContainer}!`;
    }
    if (message != null) {
        logger.info("MOVE_INVENTORY VALIDATION WARNING:", {message});
        res.status(400).json({"message": message});
        return;
    }

    // Handle allowOverage case:
    if (allowOverage && results.quantityMoved < quantity) { // When no quantity was moved and we allow Overages, create the items.
        let body = {
            "keycode"   : keycode,
            "barcode"   : barcode,
            "container" : tgtContainer,
            "quantity"  : quantity - results.quantityMoved,
            "process"   : UIprocess
        };
        try {
            await apiRequest.post(req, "/create_inventory", body);
        } catch (error) {
            logger.info("move_inventory ERROR (calling create_inventory):", {error});
            res.status(500).json({"message": "Error occured while trying to move inventory"});
            return;
        }

        sql = `INSERT INTO inventory_overage (ContainerID, Keycode, ProductID, TaskID, UserID) VALUES ?`;
        args = [];
        for (let i = 0; i < quantity - results.quantityMoved; i++) {
            args.push([srcContainer, keycode, barcode, taskID, user.id]);
        }
        try {
            await pool.query(sql, [args]);
        } catch (error) {
            logger.info("move_inventory ERROR (overage): ", {error});
        }
    }
    if (keycode) {
        message = `${quantity} unit(s) of ${keycode} moved from ${srcContainer} to ${tgtContainer}.`;
    } else {
        message = `${quantity} case(s) of ${barcode} moved from ${srcContainer} to ${tgtContainer}.`;
    }

    res.status(200).json({"message": message});
    if (results.quantityMoved) { // Log when Inventory was moved. Not when it was created!
        // (INSERT|MOVE|DELETE), Barcode, Quantity, From, To, User, Function, Process
        logging.log_inventory("MOVE", barcode, keycode, results.quantityMoved, srcContainer, tgtContainer, user.id, "move_inventory", UIprocess);
    }
};

exports.move_inventory_bulk = async function(req, res) {
    /* You should only be allowed to bulk-move items from shelves and carts, NOT warehouses and stores
     *
     * Error checking:
     * - Source and target containers must exist and be different
     * - Source container can be anything EXCEPT a store OR warehouse
     * - Source container must not be empty
     */
    let containerSource = req.query.source_container || req.body.source_container;
    let containerTarget = req.query.target_container || req.body.target_container;
    let UIprocess = req.query.process || req.body.process || "-";
    let isCrossDockEnabled;
    let backFillFlag;
    let isFHBHEnabled;
    let taskType;
    let taskGroupIds;

    let sql, args, results, containerSourceResult, containerTargetResult, error_message, message, removeTaskIDSQL;
    let user = authHelper.parseRole(req);

    console.log(`${moment().format()} Process move_inventory_bulk Running on Id: ${process.pid}`);

    if (!containerSource || !containerTarget) {
        error_message = "You must provide both a source container and target container";
        res.status(400).json({"message": error_message});
        return;
    }

    if (containerSource == containerTarget) {
        error_message = "The source container and target containers must be different";
        res.status(400).json({"message": error_message});
        return;
    }

    // 1. Check if the source and target container exists
    // 2. Get if Cross-Dock is enabled or disabled for the target location
    // 3. Get the Task Group IDs associated for the target location (needed if Cross-Dock is enabled)
    sql  = `
        # Select Source Container
        SELECT ID, Type FROM container WHERE ID = ?
        ;
        # Select Target Container
        SELECT ID, Type FROM container WHERE ID = ?
        ;
        SELECT l.isCrossDockEnabled, l.hasFHBH
        FROM container c
        INNER JOIN location l ON l.ID = c.LocationID
        WHERE c.ID = ?
        ;
        SELECT DISTINCT TaskGroupID, Type FROM task WHERE ID IN (SELECT TaskID FROM inventory WHERE ContainerID = ?)`;
    args = [containerSource, containerTarget, containerTarget, containerSource];

    try {
        let [queryResults] = await pool.query(sql, args);
        containerSourceResult = queryResults[0][0];
        containerTargetResult = queryResults[1][0];
        isCrossDockEnabled = queryResults[2][0]["isCrossDockEnabled"]; // Status of Cross-Dock
        isFHBHEnabled = parseInt(queryResults[2][0]["hasFHBH"]);       // status of FBHB for the task type backfill bulk stow
        taskGroupIds = queryResults[3];                                // Task Group IDs associated for the target location
    } catch (error) {
        logger.info("move_inventory_bulk ERROR:", {error});
        message = "Error while retrieving inventory from containers.";
        res.status(500).json({"message": message});
        return;
    }

    if (!containerSourceResult) {
        message = `The source container wasn't found: ${containerSource}`;
        res.status(404).json({"message": message});
        return;
    }

    if (!containerTargetResult) {
        message = `The target container wasn't found: ${containerTarget}`;
        res.status(404).json({"message": message});
        return;
    }

    // If both containers exist, then make sure that the source container can be anything EXCEPT a store OR warehouse
    if (containerSourceResult["Type"] == "STR" || containerSourceResult["Type"] == "WRH") {
        message = `${containerSourceResult["ID"]} has the type ${containerSourceResult["Type"]}, it must NOT be a store or warehouse`;
        res.status(400).json({"message": message});
        return;
    }

    if (containerTargetResult["Type"] != "STR" && containerTargetResult["Type"] != "RCV") {
        message = `Target Location ${containerTargetResult["ID"]} is invalid! Must be a STR or RCV location!`;
        res.status(400).json({"message": message});
        return;
    }

    if (taskGroupIds.length) {
        taskType = taskGroupIds[0]["Type"];
    }

    // IF Task type is BackFill and location has hasFHBH enable, than that type of task don't have Replenish order row
    if (isFHBHEnabled && taskType === "Backfill") {
        backFillFlag = true;
    }

    try {
        await apiRequest.put(req, "fulfill_replenish_order", {
            "source_container": containerSource,
            "target_container": containerTarget,
            "backfill_flag" : backFillFlag});
        logger.info("Inventory fulfilled for source:", containerSource, "and target:", {containerTarget});
    } catch (error) {
        logger.info("move_inventory_bulk ERROR - fulfill RO:", {error});
        res.status(error.status).json({"message": error.message});
        return;
    }

    // Convert from cases to eaches
    try {
        await apiRequest.put(req, "cases_to_eaches", {"ContainerID": containerSource, "process": UIprocess});
    } catch (error) {
        logger.info("move_inventory_bulk ERROR - inventory cases to eaches:", {error});
        res.status(error.status).json({"message": error.message});
        return;
    }

    // If the Source Container is a TOT, this is for an C&C order and we don't want to remove TaskIDs
    removeTaskIDSQL = "";
    if (containerSourceResult["Type"] !== "TOT") {
        removeTaskIDSQL = `TaskID = NULL,`;
    }

    // Move ALL contents from the source container to the target container
    sql = `
        DROP TEMPORARY TABLE IF EXISTS movedInventory
        ;
        CREATE TEMPORARY TABLE IF NOT EXISTS movedInventory AS (SELECT ContainerID, i.Keycode, ProductID, COUNT(*) AS Quantity, IFNULL(tgtQty, 0) AS previousInventory, 0 AS currentInventory
        FROM inventory i
        LEFT JOIN (
            SELECT Keycode, COUNT(*) AS tgtQty
            FROM inventory
            WHERE ContainerID = ?
            GROUP BY Keycode
        ) AS c ON c.Keycode = i.Keycode
        WHERE i.ContainerID = ?
        GROUP BY Keycode)
        ;
        UPDATE inventory
        SET ContainerID = ?, ${removeTaskIDSQL} UserID = ?
        WHERE ContainerID = ?
        ;
        UPDATE movedInventory mi
        INNER JOIN (
            SELECT ContainerID, i.Keycode, COUNT(*) AS Quantity
            FROM inventory i
            WHERE ContainerID = ?
            GROUP BY Keycode
        ) AS ci ON mi.Keycode = ci.Keycode
        SET mi.currentInventory = ci.Quantity
        ;
        SELECT * FROM movedInventory
        ;
        DROP TEMPORARY TABLE IF EXISTS movedInventory; `;
    args = [containerTarget, containerSource, containerTarget, user.id, containerSource, containerTarget];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("bulk_inventory_move ERROR:", {error});
        message = "Error occured while attempting to move inventory!";
        res.status(500).json({"message": message});
        return;
    }

    let inventoryMoved = results[4];
    results = results[2];

    if (results["affectedRows"] == 0) {
        message = `There are currently no items in the source container ${containerSource} to move to the target container ${containerTarget}`;
        res.status(404).json({"message": message});
    } else {
        for (let i in inventoryMoved) {
            let item = inventoryMoved[i];
            //console.log(item);
            console.log(`${moment().format()} ${containerTarget} inventory of ${item.Keycode} increased from ${item.previousInventory} to ${item.currentInventory} from ${containerSource}`);
            // (INSERT|MOVE|DELETE), Barcode, Quantity, From, To, User, Function, Process
            logging.log_inventory("BULK_MOVE", item.ProductID, item.Keycode, item.Quantity, containerSource, containerTarget, user.id, "move_inventory_bulk", UIprocess);
        }
        message = `${results["affectedRows"]} items have been moved from ${containerSource} to ${containerTarget}`;
        res.status(200).json({"message": message});
    }

    // If we're bulk stowing into a RCV location that has its warehouse Cross-Dock enabled, call the API to generate replenishment for Cross-Dock
    // Generating a replenishment for Coss-Dock shouldn't hold up the bulk stow process, so a simple non-await call will work
    if (isCrossDockEnabled && containerTargetResult["Type"] === "RCV") {
        apiRequest.post(req, "cross_dock/replenish_order", {"ContainerID": containerTarget});
    } else if (isCrossDockEnabled && containerTargetResult["Type"] === "STR") {
        // If we're bulk stowing into a store that has Cross-Dock enabled
        sql = `UPDATE task_group SET DateCompleted = NOW(), DateFulfilled = NOW() WHERE ID IN (?)`;
        args = [];

        for (let row of taskGroupIds) {
            args.push(row["TaskGroupID"]);
        }

        pool.query(sql, [args]);
    }
};

exports.reserve_inventory = async function(req, res) {
    let barcode = req.body.barcode;
    let keycode = req.body.keycode;
    let container = req.body.container;
    let quantity = parseInt(req.body.quantity) || 1;
    let task_id = parseInt(req.body.task_id);

    let sql, args, error_message, results, sqlType, sqlArg;

    console.log(`${moment().format()} Process reserve_inventory Running on Id: ${process.pid}`);

    if (container == null || isNaN(task_id) || (barcode == null && keycode == null)) {
        let error = "Missing required parameter values";
        console.log(error);
        // await logging.write_to_s3(error);
        res.status(400).json({"message": error});
        return;
    }
    if (keycode == null) {
        sqlType = "ProductID =";
        sqlArg = barcode;
    } else {
        sqlType = "Keycode =";
        sqlArg = keycode;
    }

    sql = `
        UPDATE inventory
        SET TaskID = ?
        WHERE ContainerID = ? AND ${sqlType} ? AND TaskID IS NULL
        ORDER BY IsSuspicious ASC
        LIMIT ?`;
    args = [task_id, container, sqlArg, quantity];
    try {
        [results] = await pool.query(sql, args);
        //console.table(results);
    } catch (error) {
        error_message = `Reserve Inventory request failed for container ${container}.`;
        console.log(error_message);
        // await logging.write_to_s3(error);
        res.status(500).json({"message": error_message});
        return;
    }

    if (results.affectedRows > 0) {
        //logger.info("Inventory reserved successfully.");
        res.status(200).json({"data": results});
    } else {
        error_message = `Container ${container} has no available inventory`;
        console.log(error_message);
        // await logging.write_to_s3(error);
        res.status(400).json({"message": error_message});
    }
};

exports.delete_inventory = async function(req, res) {
    let keycode = req.query.keycode || req.body.keycode;
    let barcode = req.query.barcode || req.body.barcode;
    let container = req.query.container || req.body.container;
    let quantity = parseInt(req.query.quantity) || parseInt(req.body.quantity) || 1;
    let UIprocess = req.query.process || req.body.process || "-";
    let sqlType, sqlValue, results;
    let user = authHelper.parseRole(req);

    sqlType = keycode ? "Keycode" : "Barcode";
    sqlValue = keycode ? keycode : barcode;

    console.log(`${moment().format()} Process delete_inventory Running on Id: ${process.pid}`);

    let sql  = `
        SELECT i.Keycode, ProductID, COUNT(*) AS count
        FROM inventory i
        INNER JOIN product_barcode pb on pb.Keycode = i.Keycode
        WHERE pb.${sqlType} = ? AND ContainerID = ?
        GROUP BY Keycode
        ;
        SELECT Barcode, COUNT(*) AS count
        FROM inventory_case
        WHERE Barcode = ? AND ContainerID = ?
        GROUP BY Barcode`;
    let args = [sqlValue, container, sqlValue, container];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("delete_inventory ERROR: ", {error});
        res.status(500).json({"message": `Error trying to Delete inventory for ${sqlType}: ${sqlValue} from ${container}.`});
        return;
    }
    if (!results[0].length && !results[1].length) {
        res.status(400).json({"message": `Unable to delete ${quantity} of ${sqlValue} from ${container}, which has 0 in inventory!`});
        return;
    } else {
        if (results[0].length) {
            results = results[0][0];
            keycode = results.Keycode;
            sql  = `DELETE from inventory WHERE Keycode = ? AND ContainerID = ? ORDER BY TaskID LIMIT ?`;
            args = [keycode, container, quantity];
        } else {
            results = results[1][0];
            barcode = results.Barcode;
            sql  = `DELETE from inventory_case WHERE Barcode = ? AND ContainerID = ? ORDER BY TaskID LIMIT ?`;
            args = [barcode, container, quantity];
        }

    }
    if (results["count"] < quantity) {
        let error_message = `Unable to delete ${quantity} of ${sqlValue} from ${container}, it has only ${results["count"]} in inventory`;
        console.log(error_message);
        res.status(400).json({"message": error_message});
        return;
    }

    try {
        [results] = await pool.query(sql, args);
        let qtyDeleted = results.affectedRows;
        // Type (INSERT|MOVE|DELETE), Barcode, Quantity, From, To, User, Function, Process
        logging.log_inventory("DELETE", barcode, keycode, qtyDeleted, container, "-", user.id, "delete_inventory", UIprocess);
        res.status(200).json({"message": `Deleted ${qtyDeleted} of ${sqlValue} from ${container}.`});
    } catch (error) {
        logger.info("delete_inventory ERROR: ", {error});
        res.status(500).json({"message": "Attempt to Delete Inventory has failed."});
        return;
    }
};

exports.delete_inventory_nb = async function(req, res) {
    let keycode = req.query.keycode || req.body.keycode;
    let barcode = req.query.barcode || req.body.barcode;
    let container = req.query.container || req.body.container;
    let quantity = parseInt(req.query.quantity) || parseInt(req.body.quantity) || 1;
    let UIprocess = req.query.process || req.body.process || "-";
    let sql, args;
    let user = authHelper.parseRole(req);
    //let sqlType1, sqlType2, sqlValue;

    let sqlType = keycode ? "Keycode" : "Barcode";
    let sqlValue = keycode ? keycode : barcode;

    console.log(`${moment().format()} Process delete_inventory_nb Running on Id: ${process.pid}`);

    sql = `
        SELECT @keycode := pb.Keycode AS Keycode FROM product_barcode pb WHERE ${sqlType} = ?
        ;
        DELETE FROM inventory WHERE Keycode = @keycode AND ContainerID = ? ORDER BY TaskID LIMIT ?
        ;
        DELETE FROM inventory_case WHERE Barcode = ? AND ContainerID = ? ORDER BY TaskID LIMIT ?`;
    args = [sqlValue, container, quantity, sqlValue, container, quantity];
    try {

        let [results] = await pool.query(sql, args);

        let quantityDeleted = results[1].affectedRows + results[2].affectedRows;

        let KeycodeValue = "";
        if (results[0].length) {
            KeycodeValue = results[0][0].Keycode;
        }

        let message = `${quantityDeleted} of ${sqlValue} DELETED from ${container}.`;
        // Type (INSERT|MOVE|DELETE), Barcode, Quantity, From, To, User, Function, Process
        logging.log_inventory("DELETE", barcode, KeycodeValue, quantityDeleted, container, "-", user.id, "delete_inventory_nb", UIprocess);
        res.status(200).json({"message": message});
    } catch (error) {
        logger.info("delete_inventory_nb ERROR: ", {error});
        logging.write_to_s3(error["message"]);
        res.status(500).json({"message": error["message"]});
        return;
    }
};

exports.delete_inventory_bulk = async function(req, res) {
    // Delete All inventory from container, that is also associated to a task for safety.
    let container = req.query.container;
    let taskId = parseInt(req.query.taskId) || null;
    let UIprocess = req.query.process || "-";
    let user = authHelper.parseRole(req);
    let keycode = "";
    let sql, args, results, contents, message;

    console.log(`${moment().format()} Process delete_inventory_bulk Running on Id: ${process.pid}`);

    // If a taskId was given, only delete inventory in the given container
    // that has this taskId. Otherwise, delete all inventory from the container.
    // The first query will select the contents, and the second will delete them.
    if (taskId) {
        args = [taskId, container, taskId, container];
        sql = `
            SELECT i.Keycode, i.ContainerID, i.ProductID, COUNT(*) AS Quantity
            FROM inventory i
            INNER JOIN task t ON (t.TargetContainer = i.ContainerID OR t.SourceContainer = i.ContainerID)
            WHERE t.ID = ? AND i.ContainerID = ?
            GROUP BY i.ProductID
            ;
            DELETE i.* FROM inventory i
            INNER JOIN task t ON (t.TargetContainer = i.ContainerID OR t.SourceContainer = i.ContainerID)
            WHERE t.ID = ? AND i.ContainerID = ?`;
    } else {
        args = [container, container];
        sql = `
            SELECT Keycode, ContainerID, ProductID, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ?
            GROUP BY ProductID
            ;
            DELETE FROM inventory WHERE ContainerID = ?`;
    }

    try {
        [results] = await pool.query(sql, args);
        contents = results[0];
        results = results[1];
        let quantityDeleted = results.affectedRows;
        message = `Total ${quantityDeleted} individual items DELETED from ${container}.`;
        console.log(moment().format(), message);

        for (let i in contents) {
            let barcode = contents[i].ProductID;
            let quantityDeleted = contents[i].Quantity;
            keycode = contents[i].Keycode;
            // Type (INSERT|MOVE|DELETE), ProductID|Keycode, Quantity, From, To, User, Function, Process
            logging.log_inventory("DELETE", barcode, keycode, quantityDeleted, container, "-", user.id, "delete_inventory_bulk", UIprocess);
        }
        res.status(200).json({"message": message});
    } catch (error) {
        logger.error("delete_inventory_bulk: ", {error});
        logging.write_to_s3(error["message"]);
        res.status(500).json({"message": error["message"]});
        return;
    }
};

exports.debug_get_inventory = async function(req, res) {
    const barcode = req.query.barcode || req.body.barcode;
    const cart = req.query.cart || req.body.cart;
    const isCase = (req.query.isCase == "true") || false;
    const location = req.query.locationID || req.body.locationID;
    let searchCondition, caseSearchCondition, results;
    let sql = `Select Timezone from location where ID = ?`;
    let args = [location];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        res.status(500).json({"message": `Unable to get location timezone data: ${location}.`});
        return;
    }
    if (results) {
        if (barcode)  {
            searchCondition = `
                INNER JOIN (
                    SELECT DISTINCT(Keycode) FROM product_barcode WHERE Keycode = ? or Barcode = ?
                ) As k ON k.Keycode = i.Keycode`;
            args = [barcode, barcode];
            caseSearchCondition = `SELECT * FROM inventory_case WHERE Barcode = ?;`;
            args.push(barcode);
            if (isCase) {
                caseSearchCondition += `SELECT * FROM case_barcode WHERE Barcode = ? or Keycode = ?;`;
                args.push(barcode, barcode);
            } else {
                caseSearchCondition = `SELECT ic.Barcode, ic.ContainerID, TaskID, cb.Keycode, ic.UserID, cb.Quantity,
                ic.DateCreated,
                ic.DateUpdated
                    FROM inventory_case ic INNER JOIN (
                        SELECT * from case_barcode WHERE Keycode = ?
                        GROUP BY Barcode
                    ) AS cb ON cb.Barcode = ic.Barcode;`;
            }
        } else if (cart) {
            searchCondition = `WHERE ContainerID = ?`;
            args = [cart];
            caseSearchCondition = `SELECT * from inventory_case WHERE ContainerID = ?`;
            args.push(cart);
        }
        sql = `
        SELECT i.Keycode, i.ContainerID, i.ProductID, i.TaskID, i.UserID,
        i.DateCreated,
        i.DateUpdated
        FROM inventory i
        ${searchCondition}
        ORDER BY i.ContainerID;
        ${caseSearchCondition}
        `;
        try {
            [results] = await ro_pool.query(sql, args);
            if (results.length > 0) {
                res.status(200).json({"data": results});
            } else {
                if (barcode) {
                    res.status(500).json({"message":  `No product found with ID: ${barcode}.`});
                } else {
                    res.status(500).json({"message":  `No product found with ID: ${cart}.`});
                }
            }
        } catch (error) {
            if (barcode) {
                res.status(500).json({"message": `No product inventory found with ID: ${barcode}.`});
            } else {
                res.status(500).json({"message": `No product inventory found with ID: ${cart}.`});
            }
        }
    }
};

exports.inventory_cases_to_eaches = async function(req, res) {
    const ContainerID = req.query.ContainerID || req.body.ContainerID;
    let UIprocess = req.query.process || "-";

    let sql, args, results, message;

    let user = authHelper.parseRole(req);

    // Break down inventory

    sql = `CALL ${config.sql_database_for_sp}.inventory_case_to_eaches(?,?);`;
    args = [ContainerID, user.id];
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("move_inventory_bulk ERROR:", {error});
        message = "Error occured while attempting to convert inventory!";
        res.status(500).json({"message": message});
        return;
    }

    // Log inventory

    let data = results[1];

    let CaseQty = 0;
    let KeycodeQty = 0;

    for (let datum of data) {
        if (datum.Barcode != null) {
            CaseQty += parseInt(datum.Quantity);
            logging.log_inventory("DELETE", datum.Barcode, null, datum.Quantity, ContainerID, "-", user.id, "delete_inventory", UIprocess);
        } else {
            KeycodeQty += parseInt(datum.Quantity);
            logging.log_inventory("INSERT", null, datum.Keycode, datum.Quantity, "-", ContainerID, user.id, "create_inventory", UIprocess);
        }
    }

    message  = `${CaseQty} Cases broken down into ${KeycodeQty} Eaches.`;
    console.log(message);
    res.status(200).json({"message": message});
};

exports.inventory_delivery = async function(req, res) {
    const ContainerID = req.query.ContainerID || req.body.ContainerID;
    const LocationID = req.query.LocationID || req.body.LocationID;
    const Status = req.query.Status || req.body.Status;
    const UIprocess = req.query.process || req.body.process|| "-";
    const User = authHelper.parseRole(req);

    if (!ContainerID || !LocationID || !Status) {
        let error = "Missing required parameter values";
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }

    if (Status === "PICKEDUP") {
        let sql = `
        UPDATE task t
        INNER JOIN (
            SELECT t.ID
            FROM task t
            INNER JOIN inventory i on t.ID = i.TaskID
            WHERE i.ContainerID = ? and i.Keycode = t.Keycode
            GROUP BY t.ID
            UNION ALL
            SELECT t.ID
            FROM task t
            INNER JOIN inventory_case i on t.ID = i.TaskID
            WHERE i.ContainerID = ? and i.Barcode = t.Barcode
            GROUP BY t.ID
        ) as i on i.ID = t.ID
        SET t.DateTransitStart = current_timestamp()`;
        let args = [ContainerID, ContainerID];
        let results;
        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.info("inventory_delivery ERROR: ", {error});
            res.status(500).json({"message": error});
            return;
        }
        console.log(results);
        if (!results.affectedRows ||results.affectedRows <= 0 ) {
            let error = "Cart is Empty";
            logger.info("inventory_delivery ERROR: ", {error});
            res.status(500).json({"message": error});
            return;
        }
        logging.log_inventory(Status,null,null,1,LocationID,ContainerID,User.id,"inventory_delivery", UIprocess);
        let message  = `${ContainerID} has been picked up from ${LocationID}`;
        res.status(200).json({"message": message});
        return;
    } else if (Status === "DELIVERED") {
        let sql = `
        UPDATE task t
        INNER JOIN (
            SELECT t.ID
            FROM task t
            INNER JOIN inventory i on t.ID = i.TaskID
            WHERE i.ContainerID = ? and i.Keycode = t.Keycode
            GROUP BY t.ID
            UNION ALL
            SELECT t.ID
            FROM task t
            INNER JOIN inventory_case i on t.ID = i.TaskID
            WHERE i.ContainerID = ? and i.Barcode = t.Barcode
            GROUP BY t.ID
        ) as i on i.ID = t.ID
        SET t.DateTransitEnd = current_timestamp()`;
        let args = [ContainerID, ContainerID];
        let results;
        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.info("inventory_delivery ERROR: ", {error});
            res.status(500).json({"message": error});
            return;
        }
        if (!results.affectedRows ||results.affectedRows <= 0 ) {
            let error = "Cart is Empty";
            logger.info("inventory_delivery ERROR: ", {error});
            res.status(500).json({"message": error});
            return;
        }
        logging.log_inventory(Status,null,null,1,ContainerID,LocationID,User.id,"inventory_delivery", UIprocess);
        let message  = `${ContainerID} has been delivered to ${LocationID}`;
        res.status(200).json({"message": message});
        return;
    } else {
        let error = "Wrong Status Given. Please Use Either PICKEDUP or DELIVERED";
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }
};

exports.move_inventory_rfid = async function(req, res) {
    let inKeycode = req.body.keycode || null;
    let inBarcode = req.body.barcode || null;
    let inTagId = req.body.tagid || null;
    let srcContainer = req.body.source_container || null;
    let tgtContainer = req.body.target_container || null;
    let taskID = parseInt(req.body.task_id) || null;
    let UIprocess = "w-rfid";

    let sql, args, results, message, barcode = null, keycode = null;

    console.log(`${moment().format()} Process move_inventory_rfid Running on Id: ${process.pid}`);

    if (srcContainer == null || tgtContainer == null || inTagId == null ||
        inKeycode == null || inBarcode == null) {
        var error = "Source Container, Target Container, Keycode, Barcode and TagID are required!";
        res.status(400).json({"message": error});
        return;
    }

    let user = authHelper.parseRole(req);
    //  move_inventory params: barcode, keycode, srcContianer, tgtContainer, taskID, userID, Quantity, MinQuantity
    sql =  `CALL ${config.sql_database_for_sp}.move_inventory_rfid(?, ?, ?, ?, ?, ?, ?, ?)`;
    args = [inBarcode, inKeycode, inTagId, srcContainer, tgtContainer, taskID, user.id];

    try {
        [results] = await pool.query(sql, args);
        results = results[0][0]; // Always grab first result for stored procedure.
        keycode = results.keycode;
        barcode = results.barcode;
    } catch (error) {
        logger.info("move_inventory_rfid ERROR: ", {error});
        res.status(500).json({"message": "Error occured while trying to move inventory"});
        return;
    }
    /** RESPONSE FORMAT:
     * validationPassed (0/1), quantityMoved (0/1), keycode, barcode,
     * srcContainer, srcType, srcQuantity, tgtContainer, tgtType;
     */
    message = null;
    if (!results.validationPassed) { // Return validation error response
        if (results.srcType == null || results.tgtType == null) {
            message = `Unable to move inventory from ${srcContainer} to ${tgtContainer}. Containers not valid.`;
        } else if (barcode == null && keycode == null) {
            message = `Unable to move inventory. Barcode ${inBarcode} or Keycode ${inKeycode} is NOT valid!`;
        } else if (results.tgtType == "STR" || results.tgtType == "WRH") {
            message = `Unable to move inventory directly to STR or WRH. Please use Bulk Stow.`;
        }
    } else if (!results.quantityMoved) { // If quantityMoved is 0 even after validation passed, that is not good.
        message = `No inventory was moved for ${keycode || barcode} from ${srcContainer} to ${tgtContainer}!`;
    }
    if (message != null) {
        logger.info("MOVE_INVENTORY_RFID VALIDATION WARNING:", {message});
        res.status(400).json({"message": message});
        return;
    }

    if (keycode) {
        message = `1 unit of ${keycode} moved from ${srcContainer} to ${tgtContainer}.`;
    }

    res.status(200).json({"message": message});
    if (results.quantityMoved) { // Log when Inventory was moved. Not when it was created!
        // (INSERT|MOVE|DELETE), ProductID, Quantity, From, To, User, Function, Process
        logging.log_inventory("MOVE", barcode, keycode, results.quantityMoved, srcContainer, tgtContainer, user.id, "move_inventory_rfid", UIprocess);
    }
};

exports.start_store_inventory_count = async function(req, res) {
    let locationID = req.body["locationID"];
    let sql, args, results;

    if (!locationID) {
        res.status(400).json({"message": "You must provide locationID; a store's ID"});
        return;
    }

    sql = `
        UPDATE location AS l
        INNER JOIN container AS c ON c.ID = l.ID
        SET l.isInventoryCounted = 1
        WHERE l.ID = ? AND l.isInventoryCounted = 0 AND c.Type = 'STR'`;
    args = [locationID];

    // Update the isInventoryCounted flag to true on the location.
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in start_store_inventory_count; please contact your system administrator"});
        return;
    }

    // If there were no affected rows, then that means either the location ID doesn't exist, or isInventoryCounted is already TRUE
    if (!results.affectedRows) {
        res.status(400).json({"message": `${locationID} location may not have it's wall-to-wall inventory count started at this time`});
        return;
    }

    // Delete all rows for the current location in the store_inventory_count table
    try {
        [results] = await pool.query(`DELETE FROM store_inventory_count WHERE LocationID = ?`, [locationID]);
    } catch (error) {
        console.log(error);
        reset_isInventoryCounted(locationID); // Reset the isInventoryCounted column for the location
        res.status(500).json({"message": "There was an error in start_store_inventory_count; please contact your system administrator"});
        return;
    }

    // Populate store_inventory_count with current inventory levels from the location per keycode. Unreserved inventory only!
    sql = `
        SELECT Keycode, COUNT(*) AS Quantity
        FROM inventory
        WHERE ContainerID = ? AND TaskID IS NULL
        GROUP BY Keycode`;
    args = [locationID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        reset_isInventoryCounted(locationID); // Reset the isInventoryCounted column for the location
        res.status(500).json({"message": "There was an error in start_store_inventory_count; please contact your system administrator"});
        return;
    }

    sql = `INSERT INTO store_inventory_count (LocationID, Keycode, QuantityStart) VALUES ?`;
    args = [[]];

    for (let result of results) {
        args[0].push([
            locationID,
            result.Keycode,
            result.Quantity
        ]);
    }

    if (args[0].length) {
        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            reset_isInventoryCounted(locationID); // Reset the isInventoryCounted column for the location
            res.status(500).json({"message": "There was an error in start_store_inventory_count; please contact your system administrator"});
            return;
        }
    }

    // Update task notifications for Wall-To-Wall Inventory Checking
    try {
        await apiRequest.post(req, "updateTaskNotifications", {"type": "Wall2Wall"});
    } catch (error) {
        reset_isInventoryCounted(locationID); // Reset the isInventoryCounted column for the location
        res.status(error.status).json({"message": error.message});
    }

    res.status(200).json({"message": "Store inventory counting has started"});
};

exports.store_inventory_details = async function(req, res) {
    let locationID = req.query.locationID;
    let sql, args, results;

    if (!locationID) {
        res.status(400).json({"message": "You must provide locationID"});
        return;
    }

    sql = `
    SELECT
        count(*) as TotalKeycodes,
        count(DateAdjusted) as AdjustedKeycodes,
        count(DateEnd) as CountedKeycodes,
        IFNULL(isInventoryCounted, 0) as isInventoryCounted
    FROM store_inventory_count c
    INNER JOIN location loc on loc.ID = c.LocationID
    WHERE LocationID = ?;`;

    args = [locationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was a problem retrieving the store inventory counts"});
        return;
    }

    res.status(200).json({"data": results[0]});
};

exports.store_inventory_count = async function(req, res) {
    let locationID = req.body["locationID"];
    let keycode    = req.body["keycode"];
    let quantity   = parseInt(req.body["quantity"]) || 1;
    let quantityOverride = (req.body.quantityOverride == "true" || req.body.quantityOverride == 1) ? true : false;
    let sql, args, results, currentTotal, message;

    if (!locationID || !keycode) {
        res.status(400).json({"message": "You must provide locationID and keycode"});
        return;
    }

    // Call the SP: stored procedure for updating store_inventory_count
    sql = `CALL ${config.sql_database_for_sp}.store_inventory_count_sp(?, ?, ?, ?)`;
    args = [locationID, keycode, quantity, quantityOverride];

    try {
        // The store_inventory_count_sp stored procedure only uses SELECT queries, so it's safe to execute this on the read-only DB
        [results] = await ro_pool.query(sql, args);
        results = results[0]; // Stored procedure, need to get the 0th index
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in store_inventory_count; please contact your system administrator"});
        return;
    }

    if (results[0]["ValidationPassed"]) {
        currentTotal = results[0]["QuantityEnd"];

        // The message will be different depending on if the user set quantityOverride true
        if (quantityOverride) {
            message = `The quantity for keycode ${keycode} has been set to: ${currentTotal}`;
        } else {
            message = `Added ${quantity} to the count for keycode ${keycode}. Current total: ${currentTotal}`;
        }

        res.status(200).json({"message": message});
    } else {
        if (results[0]["InventoryCountActive"] === 0) {
            message = `Wall-to-Wall stock take has not been started at ${locationID}`;
        } else if (results[0]["ProductExists"] === null) {
            message = `Somehow keycode ${keycode} does not exist in our database. Please inform the manager of the keycode.`;
        } else {
            // The keycode has a compliance issue;
            message = `Keycode ${keycode} is not currently eligible for sale. Please remove from inventory and send to the compliance team.`;
        }
        res.status(400).json({"message": message});
    }
};

exports.end_store_inventory_count = async function(req, res) {
    let locationID = req.body["locationID"];
    let action = req.body["action"] || null; // This may either be "cancel" or "overThreshold" or NULL
    let recountKeycodes = req.body["recountKeycodes"] || [];
    let exactMatch = 0;
    let withinThreshold = [];
    let outsideThreshold = [];
    let sourceContainers = {}; // Stores source containers of products that aren't an exact match (used for created inv tasks)
    let sicData; // Store Inventory Count data
    let sql, args, results, data;
    let logfileContent = "LocationID,Keycode,Product_Name,Quantity_Start,Quantity_End,Threshold_Status\n";

    if (!locationID) {
        res.status(400).json({"message": "Please provide the ID of the store"});
        return;
    }

    // Validate that the location exists and it's a store
    args = [locationID];
    sql = `
        SELECT l.ID
        FROM location l
        INNER JOIN container c ON c.ID = l.ID
        WHERE l.ID = ? AND c.Type = 'STR'`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
        return;
    }

    // If there are no rows, the store location ID doesn't exist
    if (results.length == 0) {
        res.status(400).json({"message": `The store ${locationID} does not exist`});
        return;
    }

    // Since the store exists, the counting will now be turned off. Also get the note(s) associated with this so they can be deleted
    sql = `
        UPDATE location SET isInventoryCounted = 0 WHERE ID = ?
        ;
        SELECT ID
        FROM note n
        INNER JOIN note_locations nl ON nl.NoteID = n.ID
        WHERE n.Title = 'Wall-to-Wall Inventory Checking' AND nl.LocationID = ?`;
    args = [locationID, locationID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
    }

    // Update task notifications for Wall-To-Wall Inventory Checking
    await apiRequest.post(req, "updateTaskNotifications", {"type": "Wall2Wall"});

    // First, retrieve all data in store_inventory_count for the specific store location
    sql = `
        SELECT
            sic.Keycode,
            sic.QuantityStart,
            sic.QuantityEnd,
            IFNULL(p.Product_Name, Online_Name) as ProductName,
            sic.DateAdjusted,
            IFNULL(pm.MDU, 0) AS MDU,
            IFNULL(CONCAT(p.Retail_Zone_ID, pd.Name), 'Unknown') AS SourceContainer
        FROM store_inventory_count sic
        INNER JOIN product p ON p.Keycode = sic.Keycode
        INNER JOIN product_department pd ON p.DepartmentID = pd.ID
        LEFT JOIN product_mdu pm ON pm.Keycode = sic.Keycode AND pm.LocationID = sic.LocationID
        WHERE sic.LocationID = ?`;
    args = [locationID];

    try {
        [sicData] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
        return;
    }

    sql = `
        UPDATE store_inventory_count
        SET DateAdjusted = Now()
        WHERE locationID = ? AND Keycode in (?) AND DateAdjusted IS NULL`;
    args = [locationID];
    let adjustedKeycodes = [];

    for (let result of sicData) {
        let keycode = result["Keycode"];
        let quantityStart = result["QuantityStart"];
        let quantityEnd = result["QuantityEnd"];
        let sourceContainer = result["SourceContainer"];
        let name = result["ProductName"];
        logfileContent += `"${locationID}","${keycode}","${name}","${quantityStart}","${quantityEnd}",`;
        let adjusted;
        if (result["DateAdjusted"]) {
            adjusted = true;
        } else {
            adjusted = false;
        }

        // Check if the current product is within the threshold where it will be automatically adjusted with adjust_inventory
        // If it is NOT within the threshold, then an inventory check task will be created (just like No More Items)
        if (quantityStart == quantityEnd) {
            logfileContent += "OK\n";
            exactMatch++; // If it's an exact match
            adjustedKeycodes.push(keycode);
        } else if (quantityEnd >= quantityStart - 2 || quantityEnd >= 0.5 * quantityStart) {
            logfileContent += "WITHIN_THRESHOLD\n";
            sourceContainers[keycode] = sourceContainer;
            withinThreshold.push({
                Keycode: keycode,
                ProductName: name,
                QuantityStart: quantityStart,
                QuantityEnd: quantityEnd,
                Difference: quantityEnd - quantityStart,
                Adjusted: adjusted
            });
            adjustedKeycodes.push(keycode);
        } else {
            logfileContent += "OUTSIDE_THRESHOLD\n";
            // Everything else is outside of the threshold
            sourceContainers[keycode] = sourceContainer;
            outsideThreshold.push({
                Keycode: keycode,
                ProductName: name,
                QuantityStart: quantityStart,
                QuantityEnd: quantityEnd,
                Difference: quantityEnd - quantityStart
            });
        }
    }

    args.push(adjustedKeycodes);

    // Update Date Adjusted for  keycodes within threshold and exact where the date adjusted is null.
    if (adjustedKeycodes.length) {
        try {
            await pool.query(sql, args);
        } catch (error) {
            logger.error("end_store_inventory_count - create tasks", {error});
            res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
            return;
        }
    }

    data = {
        ExactMatch: exactMatch,
        WithinThreshold: withinThreshold,
        OutsideThreshold: outsideThreshold
    };

    if (action == "overThreshold") {
        // For the last manual step after the user confirms which keycodes to re-count and which to auto-adjust,
        // the API will process those that are overThreshold and UI will also pass it a list of keycodes "recountKeycodes".
        // Then just select all the overThreshold keycodes, exclude those from the "recountKeycodes" list and pass them to
        // the bulk auto-adjust. Keycodes from the list should then be turned into new inventory count tasks and grouped.
        let outsideThreshold = {}; // A map of keycodes that are outside the threshold
        sql = "";
        args = [];

        // Get all products that are outside the threshold
        for (let result of sicData) {
            let keycode = result["Keycode"];
            let quantityStart = result["QuantityStart"];
            let quantityEnd = result["QuantityEnd"];
            let sourceContainer = result["SourceContainer"];

            // If it's outside the threshold
            if (!(quantityStart == quantityEnd) &&
                !(quantityEnd >= quantityStart - 2 || quantityEnd >= 0.5 * quantityStart))
            {
                // Store the keycode in the map, and record its source container
                outsideThreshold[keycode] = quantityEnd;
                sourceContainers[keycode] = sourceContainer;
            }
        }

        args = [locationID, locationID];
        sql = `
            DELETE FROM task WHERE Type = 'Inventory' AND TargetContainer = ? AND DateFulfilled IS NULL
            ;
            DELETE FROM task_group WHERE Type = 'Inventory' AND TargetLocation = ? AND DateFulfilled IS NULL`;

        // Before creating inventory tasks, remove all the existing inventory counting tasks for this location
        try {
            await pool.query(sql, args);
        } catch (error) {
            logger.error("end_store_inventory_count - cleanup old inventory tasks", {error});
            res.status(500).json({"message": "There was an error ending the store inventory count; please contact your system administrator"});
            return;
        }

        // Reset SQL since we'll be appending to it multiple times in the for-loop below
        sql = "";
        args = [];

        // For each keycode that the user wants to recount, create an inventory task for it
        for (let keycode of recountKeycodes) {
            let sourceContainer = sourceContainers[keycode];
            let quantityEnd = outsideThreshold[keycode];

            sql += `INSERT INTO task (Keycode, Quantity, SourceContainer, TargetContainer, Type) VALUES (?, ?, ?, ?, 'Inventory');`;
            args = args.concat(keycode, quantityEnd, sourceContainer, locationID);

            // Delete the keycode from our outsideThreshold map; we WILL NOT be auto-adjusting it as it's getting recounted instead
            delete outsideThreshold[keycode];
        }

        // Now that all keycodes the user wants recounted have had tasks created for them, auto-adjust everything else remaining in outsideThreshold
        for (let keycode in outsideThreshold) {
            let quantityEnd = outsideThreshold[keycode];
            let data = {
                "barcode": keycode,
                "quantity": quantityEnd,
                "container": locationID
            };


            try {
                await apiRequest.put(req, "adjust_inventory", data);
            } catch (error) {
                logger.error("end_store_inventory_count - adjust inventory", {error});
                res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
                return;
            }
        }

        sql += `UPDATE store_inventory_count SET DateAdjusted = Now() WHERE locationID = ? AND DateAdjusted IS NULL;`;
        args.push(locationID);
        // insert into task and update DateAdjusted
        if (args.length) {
            try {
                await pool.query(sql, args);
            } catch (error) {
                logger.error("end_store_inventory_count - create tasks", {error});
                res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
                return;
            }
        }

        sql = `UPDATE location SET isInventoryCounted = 0 WHERE ID = ?`;
        args = [locationID];

        try {
            await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
            return;
        }

        // Group any inventory tasks that may have been created. No need to await since we don't care about the response
        apiRequest.get(req, "taskgroup/group_inventory_tasks");
        res.status(200).json({"message":"Keycodes that were outside the threshold have now been managed"});

        // Upload the logfile for wall-to-wall thresholds since it was unable to be uploaded earlier due to there being keycodes outside thresholds
        let dateTime = moment().tz("America/Los_Angeles").format("YYYY-MM-DDTHH-mm-ss");
        let user = authHelper.parseRole(req);
        let filename = `Wall_to_Wall_${dateTime}_USER_${user.id}.csv`;
        let csvBackupBucket = config.s3_bucket.csv_backup;
        await helper.uploadFileToS3(csvBackupBucket, filename, logfileContent);
        return;
    } else if (action == "cancel") {
        sql = `UPDATE store_inventory_count SET DateAdjusted = Now() WHERE locationID = ? AND DateAdjusted IS NULL;`;
        args = [locationID];
        try {
            await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": "There was an error in end_store_inventory_count; please contact your system administrator"});
            return;
        }
        res.status(200).json({"message": `The wall-to-wall inventory count for ${locationID} has been cancelled`});
        return;
    }

    // Send a response to the user ASAP, before uploading a logfile and adjusting inventory
    res.status(200).json({"message": "Store inventory counting has ended", "data": data});

    // All products that were within the threshold can have their inventory adjusted immediately
    for (let obj of withinThreshold) {
        if (obj["Adjusted"]) {
            // Keycodes have already been adjusted so exit loop.
            break;
        }
        let data = {
            "barcode": obj["Keycode"],
            "quantity": obj["QuantityEnd"],
            "container": locationID
        };

        try {
            await apiRequest.put(req, "adjust_inventory", data);
        } catch (error) {
            logger.error("end_store_inventory_count - adjust inventory", {error});
        }
    }

    // Upload the logfile for wall-to-wall thresholds, but only if there are no keycodes outside the threshold
    if (outsideThreshold.length == 0) {
        let dateTime = moment().tz("America/Los_Angeles").format("YYYY-MM-DDTHH-mm-ss");
        let user = authHelper.parseRole(req);
        let filename = `Wall_to_Wall_${dateTime}_USER_${user.id}.csv`;
        let csvBackupBucket = config.s3_bucket.csv_backup;
        await helper.uploadFileToS3(csvBackupBucket, filename, logfileContent);
    }
};

// Note: This is adjust_shelf_inventory that has been redesigned to work with EPC
exports.adjust_container_inventory = async function (req, res) {
    const blacklistedContainers = ["STR", "WRH"]; // Store, Warehouse
    let ContainerID = req.body.ContainerID || null;
    let ProductData = req.body.Data || null;
    let preprocess = helper.parseBoolean(req.body.preprocess);
    let taskId = req.body.TaskID || null; // Optional Task ID to complete this task
    let UIprocess = req.body.Process || "-";
    let user = authHelper.parseRole(req);
    let quantities = {};
    let inventoryAdjustmentArgs = [];
    let inventoryAdjustmentLogging = {};
    let message = "";
    let sqlTaskMemory = "";
    let argsTaskMemory = [];
    let sql, args, results, identifierType, sqlToSelectTable, argsToSelectTable;
    let selectResultsInventory, taskResultsInventory, tagIDResults;
    let epcMap = {};


    if (!ContainerID || !ProductData) {
        res.status(400).json({"message": "ContainerID and Data are required parameters"});
        return;
    }

    // The product data must be an array with at least one product. It doesn't make sense for a
    // manual RFID scan to provide an empty product array, and this also will prevent a user from
    // accidentally submitting an adjustment request that will clear the entire container's inventory
    if (!(Array.isArray(ProductData) && ProductData.length)) {
        res.status(400).json({"message": "At least one product must be RFID-scanned"});
        return;
    }

    // Make sure that the user does NOT try to adjust a nonexistent container, AND that it's an allowed container
    try {
        [results] = await pool.query("SELECT Type FROM container WHERE ID = ?", [ContainerID]);

        if (results.length == 0) {
            res.status(400).json({"message": "That container does not exist"});
            return;
        }

        if (blacklistedContainers.includes(results[0]["Type"])) {
            res.status(400).json({"message": "You are not allowed to adjust inventory on this container"});
            return;
        }
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": "ContainerID and Data are required parameters"});
        return;
    }

    let scannedUnits = 0;
    let scannedKeycodes = 0;
    let containerUnits = 0;
    let containerKeycodes = 0;
    let barcodeMap = {};

    console.log(`# of items received: ${ProductData.length}`);
    let c = 0;

    // Populate Map with barcodes and counts
    for (let product of ProductData) {
        if (product.Barcode in barcodeMap) {
            barcodeMap[product.Barcode]++;
        } else {
            barcodeMap[product.Barcode] = 1;
        }

        if (c < 10) {
            console.log(`barcode: ${ProductData.Barcode}, EPC: ${ProductData.EPC}`);
            c++;
        }
    }

    //.Get List of unique barcodes
    let barcodeList = Object.keys(barcodeMap);

    args = [ContainerID, ContainerID, barcodeList];
    sql = `
        Select count(distinct keycode) as totalKeycodes, count(*) as totalUnits
        from inventory i where i.ContainerID = ?
        ;
        SELECT
            pb.Keycode,
            pb.Barcode,
            IF ((ld.LocationID IS NULL AND ld2.LocationID IS NULL) OR p.Blacklisted IS TRUE, TRUE, FALSE) AS filter
        FROM product_barcode pb
        INNER JOIN container c ON c.ID = ?
        INNER JOIN product p ON p.Keycode = pb.Keycode
        LEFT JOIN location_department ld ON ld.LocationID = c.LocationID AND ld.DepartmentID = p.DepartmentID AND ld.ClassName = p.Class_Name
        LEFT JOIN location_department ld2 ON ld2.LocationID = c.LocationID AND ld2.DepartmentID = p.DepartmentID AND ld2.ClassName IS NULL
        WHERE pb.Barcode IN (?)`;


    // Query the keycodes from our database by barcodes
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("adjust_container_inventory ERROR: ", {error});
        res.status(400).json({"message": "Error parsing Keycodes to Barcodes"});
        return;
    }
    console.log(results);

    let containerResults = results[0];
    let productResults = results[1];
    let keycodeMap = {};
    let barcodeToKeycodeMap = {};
    let barcodeFilterMap = {};
    let filterLog = [];

    for (let result of productResults) {
        if (!result.filter) {
            // Result is not filtered
            if (!(result.Keycode in keycodeMap)) {
                scannedKeycodes++;
                keycodeMap[result.Keycode] = true;
            }
            scannedUnits += barcodeMap[result.Barcode];
            barcodeMap[result.Barcode] = 0;
        }
        let keycode = result["Keycode"];
        let barcode = result["Barcode"];
        barcodeToKeycodeMap[barcode] = keycode;
        // Determine whether to filter barcode based on ContainerID
        let filter = result["filter"] ? true : false;
        barcodeFilterMap[barcode] = filter;
    }

    for (let data of ProductData) {
        // Log Filtered Products
        if (barcodeFilterMap[data.Barcode]) {
            // Barcode is filtered
            filterLog.push([data.EPC, data.Barcode, data.Certainty, "Filtered Department", user.id, taskId, ContainerID]);
        }
    }

    if (filterLog.length) {
        sql = `Insert into filtered_epc_tags (TagID, Barcode, Certainty, Reason, UserID, TaskID, ContainerID) VALUES ?`;
        args = [filterLog];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.info("adjust_container_inventory ERROR: ", {error});
            res.status(400).json({"message": "Error logging filtered EPCs"});
            return;
        }
    }



    containerKeycodes = containerResults[0].totalKeycodes;
    containerUnits = containerResults[0].totalUnits;

    if (preprocess) {

        let data = {
            scannedKeycodes: scannedKeycodes,
            scannedUnits: scannedUnits,
            containerKeycodes: containerKeycodes,
            containerUnits: containerUnits
        };



        res.status(200).json({"data": data });
        return;
    }

    if (ProductData.length) {
        /* The user reported that the container contains at least one product; example:
         *
         * [{Barcode: 9311103396770, EPC: EPC_TAG_01, Certainty: 0.4},
         *  {Barcode: 9311103396770, EPC: EPC_TAG_02, Certainty: 0.5},
         *  {Barcode: 9311103396787, EPC: EPC_TAG_03, Certainty: 0.6}]
         *
         * Define SQL for adjusting the table: inventory
         * 1. Find keycodes for inventory in the specified container
         * 2. Find task IDs for inventory in the specified container
         * 3. Delete everything from inventory in the specified container */


        // Assign keycode to the data that the user passed in
        for (let i = 0; i < ProductData.length; i++) {
            let barcode = ProductData[i]["Barcode"];
            let keycode = barcodeToKeycodeMap[barcode];
            let filter = barcodeFilterMap[barcode];
            ProductData[i]["Keycode"] = keycode;
            ProductData[i]["filter"] = filter;

            // Track the user-recorded quantities for this product
            if (keycode in quantities) {
                quantities[keycode]++;
            } else {
                quantities[keycode] = 1;
            }
        }


        // Get the current inventory and task ID results for the container that we're adjusting
        argsToSelectTable = [ContainerID, ContainerID, ContainerID, ContainerID];
        sqlToSelectTable = `
            SELECT Keycode, NULL AS Barcode, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ?
            GROUP BY Keycode
            ;
            SELECT Keycode, TaskID, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ? AND TaskID IS NOT NULL
            GROUP BY Keycode, TaskID
            ;
            SELECT TagID
            FROM inventory
            WHERE ContainerID = ?
            ;
            DELETE FROM inventory WHERE ContainerID = ?`;

        try {
            [results] = await pool.query(sqlToSelectTable, argsToSelectTable);
        } catch (error) {
            logger.error("adjust_container_inventory (select):", {error});
            res.status(400).json({"message": "Error while attempting to remove existing inventory."});
            return;
        }

        selectResultsInventory = results[0]; // Store the SELECT results from the `inventory` table
        taskResultsInventory   = results[1]; // Store the Task ID results from the `inventory` table
        tagIDResults           = results[2];

        // Store the quantity of each unique task for each keycode in `inventory`
        for (let result of taskResultsInventory) {
            let keycode = result["Keycode"];
            let taskId = result["TaskID"];
            let quantity = result["Quantity"];

            sqlTaskMemory += `UPDATE inventory SET TaskID = ? WHERE ContainerID = ? AND Keycode = ? ORDER BY IsSuspicious ASC, TaskID ASC LIMIT ?;`;
            argsTaskMemory.push(taskId, ContainerID, keycode, quantity);
        }

        // Create a map for tags we have read before in this container
        for (let result of tagIDResults) {
            epcMap[result.TagID] = true;
        }
    } else {
        logger.info("DEBUG: The container to adjust is completely empty");
        // The user reported that the container to adjust is completely empty
        sql = `
            SELECT Keycode, NULL AS Barcode, COUNT(*) AS Quantity
            FROM inventory
            WHERE ContainerID = ?
            GROUP BY Keycode
            ;
            DELETE FROM inventory WHERE ContainerID = ?`;
        args = [ContainerID, ContainerID];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("adjust_container_inventory (select):", {error});
            res.status(400).json({"message": "Error while attempting to remove existing inventory."});
            return;
        }

        selectResultsInventory = results[0];
    }


    // Log the items that have been deleted in the table `inventory`
    for (let result of selectResultsInventory) {
        // Example of a result if we're adjusting product inventory for a shelf in a store or warehouse:
        // { Keycode: 42610588, Barcode: null, Quantity: 3 }
        let keycode = result["Keycode"]; // This will be defined for products in inventory, and null for cases in inventory_case
        let existingCode = keycode; // Get whichever one is defined
        let quantityDeleted = result["Quantity"];
        let actualQuantity = 0;

        // Get the actual quantity of this product which is reported by the user
        for (let product of ProductData) {
            // Keycodes for inventory
            if (product["Keycode"] === keycode) {
                console.log(`DEBUG: ${keycode} = ${quantities[keycode]} quantity`);
                actualQuantity = quantities[keycode];
                // totalCountedUnits += actualQuantity;
                break;
            }
        }

        logging.log_inventory("DELETE", null, keycode, quantityDeleted, ContainerID, "-", user.id, "adjust_container_inventory", UIprocess);

        // The key will be the barcode if it's a product, or the case's barcode if it's a case
        inventoryAdjustmentLogging[existingCode] = {
            "keycode": keycode,                       // The keycode (or null if this is adjusting for inventory_case)
            "barcode": null,                          // The barcode (or null if this is adjusting for inventory)
            "quantityDeleted": quantityDeleted,       // The quantity that was expected in the database; this may or may not be correct
            "actualQuantity": actualQuantity,         // The actual quantity of items on the shelf that the user reported
            "delta": actualQuantity - quantityDeleted // Delta; positive value if we had more items than we thought; negative if it's less
        };
    }

    // Create new inventory in this container
    sql = `
        INSERT INTO inventory
        (ContainerID, Keycode, ProductID, UserID, TagID, Certainty, isSameLocation)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        ContainerID    = VALUES(ContainerID),
        Keycode        = VALUES(Keycode),
        ProductID      = VALUES(ProductID),
        UserID         = VALUES(UserID),
        Certainty      = VALUES(Certainty),
        isSameLocation = VALUES(isSameLocation)
        ;
        INSERT INTO inventory_rfid_history
        (ContainerID, Keycode, ProductID, TagID, XPosition, YPosition, ZPosition, Certainty, IsRemoved, isSameLocation)
        VALUES ?
        ;`;

    let inventoryArgs = [];
    let inventoryRfidHistoryArgs = [];
    args = [];

    for (let product of ProductData) {
        let barcode   = product["Barcode"]   || null;
        let keycode   = product["Keycode"]   || null;
        let EPC       = product["EPC"]       || null;
        let certainty = product["Certainty"] || null;
        let filter    = product["filter"];
        let quantity  = quantities[keycode];
        // For now with handscanning, set isSameLocation to true if the tag was already in the container
        let isSameLocation = epcMap.hasOwnProperty(EPC);

        // Do not insert this product if its keycode wasn't given, or a keycode wasn't found from its given barcode
        if (!keycode) {
            continue;
        }

        // Actually filter out product if not in Departments
        if (!filter) {
            // INSERT into the table in this own API, don't rely on any other API
            inventoryArgs.push([
                ContainerID,   // ContainerID
                keycode,       // Keycode
                barcode,       // ProductID
                user.id,       // UserID
                EPC,           // TagID
                certainty,     // Certainty
                isSameLocation // isSameLocation
            ]);
        }

        inventoryRfidHistoryArgs.push([
            ContainerID,   // ContainerID,
            keycode,       // Keycode,
            barcode,       // ProductID,
            EPC,           // TagID,
            0,             // XPosition,
            0,             // YPosition,
            0,             // ZPosition,
            certainty,     // Certainty,
            filter,        // IsRemoved
            isSameLocation // isSameLocations
        ]);

        // It's possible that we already have adjustment data on this barcode from earlier when it was removed from the inventory.
        // If we DO NOT have adjustment data on this, that means the DB didn't think we had any located on this shelf and therefore
        // didn't delete any (expected stock for this container/shelf was zero).
        if (!(keycode in inventoryAdjustmentLogging)) {
            if (keycode) {
                barcode = null;
            }

            inventoryAdjustmentLogging[keycode] = {
                "keycode": keycode,         // The keycode (or null if this is adjusting for inventory_case)
                "barcode": barcode,         // The bacode (or null if this is adjusting for inventory)
                "quantityDeleted": 0,       // The quantity that was expected in the database; this may or may not be correct
                "actualQuantity": quantity, // The actual quantity of items on the shelf that the user reported
                "delta": quantity           // Delta; positive value if we had more items than we thought; negative if it's less
            };
        }
    }

    args = [inventoryArgs, inventoryRfidHistoryArgs];

    if (ProductData.length) {
        try {
            logger.info("SQL QUERY FORMAT FOR CREATING NEW INVENTORY");
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("adjust_container_inventory (creating inventory):", {error});
            res.status(error.status).json({"message": error.message});
            return;
        }
    }

    // Call the query for updating task IDs for the inventory if we have any to update
    if (argsTaskMemory.length) {
        try {
            await pool.query(sqlTaskMemory, argsTaskMemory); // The appropiate SQL query for updating tasks was defined earlier
        } catch (error) {
            logger.error("adjust_container_inventory (inventory taskIDs):", {error});
            res.status(500).json({"message": `ERROR: Unable to update tasks for the containers, please contact your system administrator`});
            return;
        }
    }

    // Determine the "identifierType" before we log the inventory adjustment
    if (taskId) {
        // If a Task ID was defined, check to see if this was a random inventory checking task or not
        try {
            [results] = await pool.query("SELECT isRandom FROM task WHERE ID = ?", [taskId]);

            if (results[0]["isRandom"]) {
                identifierType = "random"; // If the isRandom boolean for the associated TaskID is true
            } else {
                identifierType = "suspicious"; // If the isRandom boolean for the associated TaskID is false
            }
        } catch (error) {
            logger.error("adjust_container_inventory (get type):", {error});
            res.status(500).json({"message": `ERROR: Bad query for task ${taskId}, please contact your system administrator`});
            return;
        }
    } else {
        identifierType = "manual"; // The type is manual if no Task ID was defined
    }

    // Log inventory adjustment details into the inventory_adjustment table. This happens for positive increase, negative decrease, or no change at all
    try {
        for (let barcode in inventoryAdjustmentLogging) {
            let productInfo = inventoryAdjustmentLogging[barcode];

            inventoryAdjustmentArgs.push([
                taskId,                         // TaskID
                req.headers["user-id"],         // UserID
                ContainerID,                    // ContainerID
                productInfo["keycode"],         // Keycode
                productInfo["barcode"],         // Barcode
                productInfo["quantityDeleted"], // The quantity that was expected in the database; this may or may not be correct
                productInfo["actualQuantity"],  // The actual quantity of items on the shelf that the user reported
                productInfo["delta"],           // Delta; positive value if we had more items than we thought; negative if it's less
                identifierType                  // IdentifierType
            ]);
        }

        if (inventoryAdjustmentArgs.length) {
            let sql = `INSERT INTO inventory_adjustment (TaskID, UserID, ContainerID, Keycode, ProductID, ExpectedQty, ActualQty, Delta, IdentifierType) VALUES ?`;
            await pool.query(sql, [inventoryAdjustmentArgs]);
        }
    } catch (error) {
        logger.error("adjust_container_inventory (adjustment):", {error});
        res.status(500).json({"message": `ERROR: Bad query for inventory adjustment logging, please contact your system administrator`});
        return;
    }

    message += `Inventory successfully adjusted for ${ContainerID} (${scannedKeycodes} Keycodes, ${scannedUnits} units).`;

    // If task ID is provided, update the status if it's for the same container.
    if (taskId) {
        sql = `UPDATE task SET DateCompleted = NOW(), AssignedUserID = ? where ID = ? and SourceContainer = ?`;
        args = [user.id, taskId, ContainerID];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("adjust_container_inventory (update task):", {error});
            res.status(500).json({"message": `ERROR: Bad query for updating task ${taskId}, please contact your system administrator`});
            return;
        }

        if (results["affectedRows"]) {
            message += " Task complete!";
        }
    }


    res.status(200).json({"message": message});
};

exports.download_inventory_adjustment_report = async function (req, res) {
    let type = req.query.type; // Type of Report
    let from = req.query.from; // Date to Start
    let to = req.query.to; // Date to End
    let containerID = req.query.containerID; // Location
    let sql, results, args;

    if (!type || !from || !to || !containerID) {
        res.status(400).json({"message": "You must provide type, from, to, and container id"});
        return;
    }

    sql = `SELECT Timezone FROM location where ID = ?;`;
    args = [containerID];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error generating adjustment report. Please contact your system administrator"});
        return;
    }

    let timezone = results[0].Timezone;

    let fromDate = moment.tz(from, "YYYY-MM-DD", timezone);
    let toDate = moment.tz(to, "YYYY-MM-DD", timezone);
    fromDate.startOf("day");
    toDate.endOf("day");

    sql =
        `SELECT *
        FROM inventory_adjustment i
        INNER JOIN (
            SELECT ID FROM container WHERE LocationID = ?
        ) AS c ON c.ID = i.ContainerID
        WHERE IdentifierType = ?
        AND DateCreated > ?
        AND DateCreated < ?`;

    args = [containerID, type, fromDate.utc().format(), toDate.utc().format()];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error generating adjustment report. Please contact your system administrator"});
        return;
    }

    for (let result of results) {
        if (result.DateCreated) {
            result.DateCreated = moment(result.DateCreated).tz(timezone).format("llll Z") + ` (${timezone})`;
        }
        if (result.DateCompleted) {
            result.DateCompleted = moment(result.DateCompleted).tz(timezone).format("llll Z");
        }
    }

    let fileData = await csvConverter.json2csvAsync(results, {emptyFieldValue: ""});
    let fileName = "Inventory_Adjustment_" + moment(moment.now()).format("YYYY-MM-DD") + ".csv";
    fileData = Buffer.from(fileData); //, "base64");
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);
};

exports.download_inventory_report = async function (req, res) {
    let sql, results;

    sql = `
        SELECT
            i.Keycode,
            i.ContainerID,
            i.XPosition,
            i.YPosition,
            i.ZPosition,
            i.TagID,
            i.Certainty,
            i.InventoryBotID,
            productDetails.*
        FROM inventory i
        INNER JOIN (
            SELECT
                p.Keycode,
                # The quotes and equal sign are for correct formatting in excel
                GROUP_CONCAT(pb.Barcode SEPARATOR ';') AS Barcodes,
                p.Online_Name,
                pd.Name AS Department_Name,
                p.Class_Name,
                p.Secondary_Colour,
                p.Item_Size
            FROM product p
            INNER JOIN product_department pd ON p.DepartmentID = pd.ID
            INNER JOIN product_barcode pb ON p.Keycode = pb.Keycode
            GROUP BY p.Keycode
        ) productDetails ON i.Keycode = productDetails.Keycode`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error generating inventory report. Please contact your system administrator"});
        return;
    }

    // Stack exceed max depth error unless checkSchemaDifferences is set to true
    let fileData = await csvConverter.json2csvAsync(results, {emptyFieldValue: "", checkSchemaDifferences: true});
    let fileName = "Inventory_" + moment(moment.now()).format("YYYY-MM-DD") + ".csv";
    fileData = Buffer.from(fileData); //, "base64");
    let readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");

    readStream.pipe(res);
};

exports.get_map_inventory_info = async function (req, res) {
    let locationID = req.query.locationID;
    let keycodeList = req.query.keycodeArray ? req.query.keycodeArray.split(",") : [];
    let ContainerList = req.query.ContainerArray.length ? req.query.ContainerArray.split(",") : [];
    let sql, args, results;

    if (!locationID || !keycodeList.length) {
        res.status(400).json({"message": "You must provide locationID & keycodeList"});
        return;
    }

    sql = `
        SELECT i.*,
            ibm.InventoryBotID, ibm.MapUrl, ibm.MapHeight, ibm.MapWidth, ibm.CellSize, ibm.OffSetX, ibm.OffSetY
        FROM inventory i
        INNER JOIN container c ON i.ContainerID = c.ID
        LEFT JOIN inventory_bot ib ON i.InventoryBotID = ib.ID
        LEFT JOIN inventory_bot_map ibm ON ib.MapID = ibm.ID
        WHERE c.LocationID = ?
        AND i.Keycode IN (?)
    `;

    args = [locationID, keycodeList];

    if (ContainerList.length) {
        sql += ` AND ContainerID IN (?)`;
        args.push(ContainerList);
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_map_inventory_info", {error});
        res.status(500).json({"message": `Error while attempting to get inventory data for rfid map.`});
        return;
    }
    res.status(200).json({"data": results });
};

async function reset_isInventoryCounted(locationID) {
    try {
        await pool.query(`UPDATE location SET isInventoryCounted = 0 WHERE ID = ?`, [locationID]);
    } catch (error) {
        console.log(error);
    }
}

