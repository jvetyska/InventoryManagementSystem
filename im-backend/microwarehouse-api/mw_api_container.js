/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
const apiRequest = require("../library/apiRequest");
const authHelper = require("../library/authHelper");
const logger = require("../library/logger")("microwarehouse-api:mw_api_container");

exports.get_container = async function(req, res) {
    var container = req.query.container;
    var sql = "SELECT * FROM container WHERE ID = ?";
    var args = [container];
    var [results] = await ro_pool.query(sql, args);

    if (results.length) {
        res.status(200).json({"data": results[0]});
    } else {
        res.status(404).json({"message": "That container doesn't exist"});
    }
};

exports.get_containers = async function(req, res) {
    let isBOH           = req.query.isBOH === "true" || req.query.isBOH === 1 ? true : false;
    let isFOH           = req.query.isFOH === "true" || req.query.isFOH === 1 ? true : false;
    let isWRH           = req.query.isWRH === "true" || req.query.isWRH === 1 ? true : false;
    let isOffsite       = req.query.isOffsite === "true" || req.query.isOffsite === 1 ? true : false;
    let isSystemInv     = req.query.isSystemInv === "true" || req.query.isSystemInv === 1 ? true : false;
    let backfillEnabled = req.query.backfillEnabled === "true" || req.query.backfillEnabled === 1 ? true : false;
    let locationID      = req.query.locationID      || null;

    if (!locationID) {
        res.status(400).json({"message": `Location ID is required`});
        return;
    }

    let conditions = ["t1.SubType is null"];
    let results, args, sql;

    if (isBOH) {
        conditions.push("isBoH = true");
    }
    if (isFOH) {
        conditions.push("isFoH = true");
    }
    if (isWRH) {
        conditions.push("isWRH = true");
    }
    if (isOffsite) {
        conditions.push("isOffsite = true");
    }
    if (isSystemInv) {
        conditions.push("isSystemInv = true");
    }
    if (backfillEnabled) {
        conditions.push("backfillEnabled = true");
    }

    let conditionssql = "";
    if (conditions.length) {
        conditionssql += `WHERE ${conditions.join(" AND ")}`;
    }

    sql = `
        SELECT ct.ID as type, ct.Description, ct.SubType, group_concat(c.ID) as containers
        FROM (
            SELECT IF(ISNULL(t2.SubType), 1, 2) as IsParent,
            t1.DisplayOrder as do1, t2.DisplayOrder as do2,
            t2.ID, t2.Description, t2.SubType
            FROM container_type AS t1
            LEFT JOIN container_type AS t2 ON t1.ID = t2.ID
            ${conditionssql}
        ) as ct
        LEFT JOIN container c on c.Type = ct.ID
            AND (c.SubType = ct.SubType OR (c.SubType is null AND ct.SubType IS NULL))
            AND c.LocationID = ?
        GROUP BY ct.SubType, ct.ID
        ORDER BY ct.do1, ct.IsParent, ct.do2`;
    args = [locationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "get_containers ERROR: issue retrieving data from database"});
        return;
    }

    results.forEach((e) => e.containers = e.containers ? e.containers.split(",") : []);
    res.status(200).json({"data": results});
};

exports.get_container_types = async function(req, res) {
    let isBOH           = req.query.isBOH === "true" || req.query.isBOH === 1 ? true : false;
    let isFOH           = req.query.isFOH === "true" || req.query.isFOH === 1 ? true : false;
    let isWRH           = req.query.isWRH === "true" || req.query.isWRH === 1 ? true : false;
    let isOffsite       = req.query.isOffsite === "true" || req.query.isOffsite === 1 ? true : false;
    let isSystemInv     = req.query.isSystemInv === "true" || req.query.isSystemInv === 1 ? true : false;
    let backfillEnabled = req.query.backfillEnabled === "true" || req.query.backfillEnabled === 1 ? true : false;
    let isCreatable     = req.query.isCreatable === "true" || req.query.isCreatable === 1 ? true : false;

    let conditions = ["t1.SubType is null"];

    if (isBOH) {
        conditions.push("t2.isBoH = true");
    }
    if (isFOH) {
        conditions.push("t2.isFoH = true");
    }
    if (isWRH) {
        conditions.push("t2.isWRH = true");
    }
    if (isOffsite) {
        conditions.push("t2.isOffsite = true");
    }
    if (isSystemInv) {
        conditions.push("t2.isSystemInv = true");
    }
    if (backfillEnabled) {
        conditions.push("t2.backfillEnabled = true");
    }
    if (isCreatable) {
        conditions.push("t2.ID NOT IN ('STR','WRH')");
    }

    let conditionssql = "";
    if (conditions.length) {
        conditionssql += `WHERE ${conditions.join(" AND ")}`;
    }

    let results;

    let sql =
        `SELECT IF(ISNULL(t2.SubType), 1, 2) as IsParent, t2.ID, t2.Description, t2.SubType
        FROM container_type AS t1
        LEFT JOIN container_type AS t2 ON t1.ID = t2.ID
        ${conditionssql}
        ORDER BY t1.DisplayOrder, IsParent, t2.DisplayOrder;`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "get_container_types ERROR: issue retrieving data from database"});
        return;
    }

    let data = {};

    for (let result of results) {
        if (!result.SubType) {
            data[result.ID] = {
                type: result.ID,
                desc: result.Description,
                subTypes: []
            };
        } else {
            data[result.ID].subTypes.push({subType: result.SubType, desc: result.Description});
        }
    }

    res.status(200).json({"data": data});
};

exports.get_case_container = async function(req, res) {
    var container = req.query.container;
    var sql = "SELECT * FROM case_barcode WHERE Barcode = ?";
    var args = [container];
    var [results] = await ro_pool.query(sql, args);

    if (results.length) {
        res.status(200).json({"data": results[0]});
    } else {
        res.status(404).json({"message": "That case container doesn't exist"});
    }
};

exports.search_containers = async function(req, res) {
    var container = req.query.container;
    var sql = "SELECT * FROM container WHERE ID LIKE ?";
    var args = [`%${container}%`];
    var [results] = await ro_pool.query(sql, args);

    if (results.length) {
        res.status(200).json({"data": results});
    } else {
        res.status(404).json({"message": `No containers like ${container} were found`});
    }
};

exports.add_container = async function(req, res) {
    let LocationID = req.body.location           || null;
    let ID         = req.body.container          || null;
    let Type       = req.body.container_type     || null;
    let isApparel  = req.body.isApparel          || "Standard";
    let ParentID   = req.body.parent             || null;
    let region     = req.body.parentID           || null; // Only used when creating a STR or WRH
    let name       = req.body.user_friendly_name || null; // Only used when creating a STR or WRH
    let timezone   = req.body.timezone           || null; // Only used when creating a STR or WRH
    let isOpen     = (req.body.is_open === undefined) ? null : req.body.is_open; // Only used when creating a STR or WRH
    let sql, args, results, message;

    // Validate parameters that are mandatory no matter what type of container that will be created
    if (!LocationID || !Type) {
        res.status(400).json({"message": `These parameters must be specified: location, container_type`});
        return;
    }

    // Creating a store/warehouse is a bit different than creating any other store type
    if (["STR", "WRH"].indexOf(Type) !== -1) {
        // Validate parameters specific for stores and warehouses
        if (name === null || timezone === null || isOpen === null) {
            res.status(400).json({"message": `Name, Timezone, and is Open are required`});
            return;
        }

        // Ensure that this location ID doesn't already exist
        try {
            [results] = await pool.query("SELECT ID FROM container WHERE ID = ?", [LocationID]);
        } catch (error) {
            logger.error("add_container:", {error});
            res.status(500).json({"message": `Unable to create location ${LocationID} with type ${Type}`});
            return;
        }

        if (results.length) {
            res.status(400).json({"message": `Location ${LocationID} already exists`});
            return;
        }

        // Verify that the Location ID matches the type (stores must have -STR in the ID, and warehouses -WRH)
        if ((Type === "STR" && !LocationID.includes("-STR")) ||
            (Type === "WRH" && !LocationID.includes("-WRH"))) {
            res.status(400).json({"message": `The Location must have the its Type included it the ID`});
            return;
        }

        args = [
            [[LocationID, Type, LocationID]],
            [[LocationID, name, timezone, name, isOpen]]
        ];
        sql = `
            INSERT INTO container (ID, Type, LocationID) VALUES ?
            ;
            INSERT INTO location (ID, Name, Timezone, InternalName, IsOpen) VALUES ?`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("add_container:", {error});
            res.status(500).json({"message": `Unable to create location ${LocationID} with type ${Type}`});
            return;
        }

        try {
            if (Type === "STR") {
                const storePrefix = LocationID.substring(0, LocationID.indexOf("-"));

                const body = {
                    Username: `${storePrefix}.guest`,
                    FirstName: "Guest",
                    DefaultLocation: LocationID,
                    Locations: [LocationID],
                    Roles: ["guest"]
                };

                await apiRequest.post(req, "account_management/create_user", body);
            }
        }
        catch (error) {
            logger.error("add_container failed to create guest account:", {error});
        }

        res.status(200).json({"message": `Location ${LocationID} has been created with type ${Type}`});

        // handle parent id

        sql = `SELECT * FROM location_hierarchy_locations WHERE LocationID = ?`;
        args = [LocationID];
        try {
            [results] = await pool.query(sql, args);
            // This should only return 1 result
        } catch (error) {
            logger.info("upsert_location_details parentID update failed: ", {error});
        }

        if (results.length) {
            let parent = results[0].LocationHierarchyID;
            let lclID = results[0].ID;
            if (parent != region) {
                if (region != null) {
                    sql = `UPDATE location_hierarchy_locations SET LocationHierarchyID = ? WHERE ID = ?`;
                    args = [region, lclID];
                    try {
                        [results] = await pool.query(sql, args);
                        // This should only return 1 result if the
                    } catch (error) {
                        logger.info("upsert_location_details parentID update failed: ", {error});
                    }
                } else {
                    sql = `DELETE FROM location_hierarchy_locations WHERE ID = ?`;
                    args = [lclID];
                    try {
                        [results] = await pool.query(sql, args);
                        // This should only return 1 result if the
                    } catch (error) {
                        logger.info("upsert_location_details parentID update failed: ", {error});
                    }
                }

            }
        } else {
            if (region) {
                sql = `INSERT INTO location_hierarchy_locations (LocationHierarchyID, LocationID) VALUES (?, ?)`;
                args = [region, LocationID];
                try {
                    [results] = await pool.query(sql, args);
                    // This should only return 1 result if the
                } catch (error) {
                    logger.info("upsert_location_details parentID update failed: ", {error});
                }
            }
        }
    } else {
        // The container_type MUST be specified
        if (!ID) {
            res.status(400).json({"message": `container must be specified for this container type`});
            return;
        }

        // Verify that the location ID exists
        try {
            [results] = await pool.query("SELECT ID FROM location");
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": "There was an error adding a container; please contact your system administrator"});
            return;
        }

        // Verify that the location that user wants to create a container in exists (BUR1-STR, LYN1-WRH, etc)
        if (!results.map(i => i.ID).includes(LocationID)) {
            res.status(400).json({"message": "That location doesn't exist"});
            return;
        }

        // Verify that the The locationID matches start of string
        if (LocationID.split("-")[0] !== ID.split("-")[0]) {
            res.status(400).json({"message": `Container Name must start with ${LocationID.split("-")[0]}`});
            return;
        }

        // Verify that the container ID is formatted correctly
        // Does not account for examples such as  1001-BOH
        //if (!containerRegex.test(ID)) {
        //    res.status(400).json({"message": "Invalid container ID format"});
        //    return;
        //}

        // Set the parent ID to the location's ID if it wasn't set
        if (!ParentID) {
            ParentID = LocationID;
        }

        args = [[ID], [ID, Type, ParentID, LocationID, isApparel]];
        sql = `
            SELECT ID FROM container WHERE ID = ?
            ;
            INSERT INTO container (ID, Type, ParentID, LocationID, isApparel) VALUES (?)
            ON DUPLICATE KEY UPDATE
            Type = VALUES(Type),
            ParentID = VALUES(ParentID),
            LocationID = VALUES(LocationID),
            isApparel = VALUES(isApparel)`;

        try {
            [results] = await pool.query(sql, args);

            if (results[0].length) {
                message = `Container ${ID} has been updated`;
            } else {
                message = `Container ${ID} has been created`;
            }

            res.status(200).json({"message": message});
        } catch (error) {
            logger.info("add_container ERROR: ", {error});
            res.status(500).json({"message": `Error while attempting to insert or update container ${ID}`});
        }
    }
};

function _generateRandom(length) {
    var result           = "";
    var characters       = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

exports.add_container_generate = async function(req, res) {
    let locationID = req.body.locationID         || null; // parent ID
    let type       = req.body.type               || null;
    let subType    = req.body.subtype            || null;
    let qty        = req.body.quantity           || 1;
    let sql, args, results;

    if (!locationID || !type) {
        res.status(400).json({"message": `Location ID and type are required`});
        return;
    }
    if (type === "STR" || type === "WRH") {
        res.status(400).json({"message": `STR and WRH are not allowed types`});
        return;
    }
    if (qty > 20) {
        res.status(400).json({"message": `You can only create 20 containers at a time`});
        return;
    }

    sql = `SELECT Priority FROM container_type WHERE ID = ? `;
    args = [type];

    if (subType) {
        sql += `AND SubType = ? `;
        args.push(subType);
    }
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("add_container_generate(select priority):", {error});
        res.status(500).json({"message": `Error when trying to create containers`});
        return;
    }

    let priority = results[0] && results[0].Priority ? results[0].Priority : 1;

    let containers = [];
    let createdContainers = [];
    if (!subType) {
        // geneate 4 random alphanumeric code
        for (let x = 0; x < qty; x++) {
            // generate 4 character code here
            let code = _generateRandom(4);
            // Not sure about parentID
            containers.push([`${locationID.split("-")[0]}-${type}-${code}`, type, subType, priority, locationID, locationID]);
            createdContainers.push(`${locationID.split("-")[0]}-${type}-${code}`);
        }

    } else {
        try {
            sql = `CALL ${config.sql_database_for_sp}.container_id_generate(?,?,?,?)`;
            args = [locationID, type, subType, qty];
            [results] = await pool.query(sql, args);

            if (results[0].length && results[0][0].FinalResultString) {
                let codes = (results[0][0].FinalResultString).split(",");
                for (let code of codes) {
                    containers.push([`${locationID.split("-")[0]}-${type}-${code}`, type, subType, priority, locationID, locationID]);
                    createdContainers.push(`${locationID.split("-")[0]}-${type}-${code}`);
                }
            }
        } catch (error) {
            logger.error("add_container_generate(select priority):", {error});
            res.status(500).json({"message": `Error when trying to create containers`});
            return;
        }

    }

    try {
        sql = `INSERT INTO container (ID, Type, SubType, Priority, ParentID, LocationID) VALUES ?`;
        args = [containers];
        await pool.query(sql, args);
    } catch (error) {
        logger.error("add_container_generate:", {error});
        res.status(500).json({"message": `Error when trying to create containers`});
        return;
    }

    res.status(200).json({"message": `${containers.length} containers Sucessfully Generated`, data: createdContainers});
};

exports.delete_container = async function(req, res) {
    const containerID = req.query.container;
    const locationID = req.query.locationID;
    const force = req.query.force === "true" || req.query.isBOH === 1 ? true : false;
    let user = authHelper.parseRole(req);
    const userID = user.id;
    let sql, args, results;

    if (!locationID || !containerID) {
        res.status(400).json({"message": `Location ID AND ContainerID are required`});
        return;
    }
    sql = `
        SELECT * FROM user_locations WHERE UserID = ? AND Location = ?
        ;
        SELECT * FROM inventory WHERE ContainerID = ?
        ;
        SELECT * FROM inventory_bot_boundary ibb
        INNER JOIN inventory_bot ib ON ib.DefaultMap = ibb.Map AND ib.LocationID = ibb.LocationID
        WHERE ContainerID = ?
        ;
        SELECT * FROM inventory_take_schedule WHERE ContainerID = ?
        ;
        SELECT * FROM inventory_bot_area iba
        INNER JOIN inventory_bot ib on ib.DefaultMap = iba.Map
        WHERE ContainerID = ?;`;
    args = [userID, locationID, containerID,containerID, containerID, containerID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_container(container delete validation)", {error});
        res.status(400).json({"message": `Unable to Delete container: ${containerID}.`});
        return;
    }

    let validUserLocation = results[0];
    let isContainerEmpty = results[1];
    let isContainerInUseForBoundary = results[2];
    let isContainerInUseForInventoryTake = results[3];
    let isContainerInUseForArea = results[4];

    // Admins do not have set location so if user is admin skip check.
    if (!validUserLocation.length && !user.isAdmin) {
        res.status(400).json({"message": `User doesn't have permission to delete container: ${containerID} for Location: ${locationID}.`});
        return;
    }

    if (isContainerInUseForBoundary.length || isContainerInUseForArea.length) {
        res.status(400).json({"message": `Unable to delete container ${containerID} because it is used by RFID robot. Please use Bot Management and select another container.`});
        return;
    }

    if ( isContainerInUseForInventoryTake.length) {
        res.status(400).json({"message": `Unable to delete container ${containerID} because it is used for manual RFID scanning. Please use Inventory Task Management and select another container.`});
        return;
    }

    if (user.isAdmin && force) {
        if (isContainerEmpty.length) {
            sql = `
                DELETE from inventory where containerID = ?;`;
            args = [containerID];

            try {
                await pool.query(sql, args);
            } catch (error) {
                logger.error("delete_container", {error});
                res.status(400).json({"message": `Unable to force delete inventory for container: ${containerID}.`});
                return;
            }
        }
    } else {
        if (isContainerEmpty.length) {
            res.status(400).json({"message": `Unable to delete container ${containerID} because it contains inventory. Please stow the inventory to another container.`});
            return;
        }
    }


    sql = `
        UPDATE inventory_bot_boundary ibb
        INNER JOIN inventory_bot ib ON ib.DefaultMap != ibb.Map
        SET ibb.ContainerID = NULL
        WHERE ibb.ContainerID = ?
        ;
        UPDATE inventory_bot_area iba
        INNER JOIN inventory_bot ib ON ib.DefaultMap != iba.Map
        SET iba.ContainerID = NULL
        WHERE iba.ContainerID = ?
        ;
        DELETE from container where ID = ?;`;
    args = [containerID, containerID, containerID];

    try {
        await pool.query(sql, args);
        res.status(200).json({"message": `Successfully Deleted Container ${containerID}`});
    } catch (error) {
        logger.error("delete_container", {error});
        res.status(400).json({"message": `Unable to Delete container: ${containerID}.`});
        return;
    }
};
