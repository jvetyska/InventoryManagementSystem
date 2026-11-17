const authHelper = require("../library/authHelper");
const helper = require("../library/helperFn");
const logger = require("../library/logger")("microwarehouse-api:mw_api_location");

exports.get_locations = async function(req, res) {
    showArchived = helper.parseBoolean(req.query.showArchived);
    let condition = "AND loc.isArchived IS FALSE";
    if (showArchived) {
        condition = "";
    }
    var sql = `SELECT c.ID, c.Type, loc.Name, loc.InternalName FROM container c
        LEFT JOIN location loc ON loc.ID = c.ID
        WHERE c.ParentID IS NULL AND (loc.isArchived = 0 AND loc.isOpen = 1)
        ${condition}
        ORDER BY ID`;
    var args = [];
    var [results] = await ro_pool.query(sql, args);

    if (results.length) {
        res.status(200).json({"data": results});
    } else {
        res.status(404).json({"message": "Unable to find any locations"});
    }
};

exports.get_locations_by_type = async function(req, res) {
    let type = req.query.type || null;
    let warehouse = req.query.warehouse || null; // optional warehouse filter
    let open = req.query.open || null; // optional filter for only stores that are currently open to public
    let replenishEnabled = req.query.replenishEnabled || null; // optional, set to true if we want automated replenishment enabled.
    let archived = req.query.archived || null;
    let sql_filter = "";
    let sql, args, results;

    if (type == null) {
        res.status(404).json({"message": `Type is a required attribute!`});
        return;
    }

    if (warehouse != null) {
        sql_filter += "AND loc.WarehouseID = ?";
    }

    // open: 0 => All locations, 1 => Open locations, 2 => Open and Opening locations.
    if (open != null) {
        if (open == "true" || open == 1) {
            sql_filter += " AND loc.isOpen = true";
        } else if (open == 2) {
            sql_filter += " AND (loc.isOpen = true OR IFNULL(loc.DateOpen, 0) > NOW())";
        } else {
            sql_filter += " AND loc.isOpen = false";
        }
    }

    if (archived != null) {
        if (archived == 0) {
            sql_filter += " AND loc.isArchived = 0";
        }
        else if (archived == 1) {
            sql_filter += " AND loc.isArchived = 1";
        }
        else if (archived == 2) {
            sql_filter += " AND (loc.isArchived = 0 OR loc.isArchived = 1)";
        }
    }

    if (replenishEnabled != null) {
        if (replenishEnabled == "true" || replenishEnabled == 1) { // Replenished Locations
            sql_filter += " AND rs.LocationID is NOT null";
        } else { // Locations not replenished.
            sql_filter += " AND rs.LocationID is null";
        }
    }

    args = [type, warehouse];
    sql = `
        SELECT
            c.ID,
            c.Type,
            loc.WarehouseID,
            loc.Lat,
            loc.Lng,
            IFNULL(loc.isOpen, 0) AS isOpen,
            IF(rs.LocationID IS NULL, 0, 1) AS replenishEnabled,
            IF(sbs.LocationID IS NULL, 0, 1) AS replenishEnabledBackfill,
            ReplenishSchedule,
            ReplenishScheduleBackfill,
            DeliverySchedule,
            InventoryCountSchedule,
            ics.KeycodeCount AS inventoryTaskKeycodeCount,
            cal.Factor,
            loc.Name,
            loc.InternalName,
            loc.Timezone,
            loc.Address,
            loc.City,
            loc.State,
            loc.Zip,
            loc.PhoneNumber,
            loc.HoursOfOperation,
            loc.isReplenishedByMDU,
            loc.DateOpen,
            loc.DisplayOrder,
            loc.StorefrontImage,
            loc.isArchived,
            loc.maxInventoryTaskUnits,
            loc.inventoryTaskGroupSize
        FROM container c
        LEFT JOIN location loc ON loc.ID = c.ID
        LEFT JOIN (
            SELECT LocationID, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS ReplenishSchedule FROM replenish_schedule GROUP BY LocationID
        ) AS rs ON rs.LocationID = c.ID
        LEFT JOIN (
            SELECT LocationID, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS ReplenishScheduleBackfill FROM store_backfill_schedule GROUP BY LocationID
        ) AS sbs ON sbs.LocationID = c.ID
        LEFT JOIN (
            SELECT LocationID, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS DeliverySchedule FROM delivery_schedule GROUP BY LocationID
        ) AS ds ON ds.LocationID = c.ID
        LEFT JOIN (
            SELECT LocationID, KeycodeCount, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS InventoryCountSchedule FROM inventory_count_schedule GROUP BY LocationID
        ) AS ics ON ics.LocationID = c.ID
        LEFT JOIN replenish_factor_calendar cal ON cal.LocationID = c.ID AND cal.Date = DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone))
        WHERE Type = ? ${sql_filter}
        ORDER BY ID`;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_locations_by_type:", {error});
        res.status(500).json({"message": "Unable to get locations by type"});
        return;
    }

    if (results.length) {
        res.status(200).json({"data": results});
    } else {
        res.status(404).json({"message": `Unable to find any containers with the type of ${type}`});
    }
};

exports.get_cluster_locations = async function(req, res) {
    const UNASSIGNED = "UNASSIGNED";
    let stores = {};
    let data = [];
    let sql, results;
    stores[UNASSIGNED] = []; // Keep unassigned stores in a separate bucket
    showArchived = helper.parseBoolean(req.query.showArchived);
    let condition = "AND loc.isArchived IS FALSE";
    if (showArchived) {
        condition = "";
    }

    // Return all information about warehouses and stores, ordered by cluster
    sql = `
    SELECT
        c.ID,
        c.Type,
        IFNULL(dc.isDC, false) AS isDC,
        DCLocationID,
        WarehouseID,
        IF(rs.LocationID IS NULL, 0, 1) AS replenishEnabled,
        ReplenishSchedule,
        DeliverySchedule,
        InventoryCountSchedule,
        ics.KeycodeCount AS inventoryTaskKeycodeCount,
        NULL AS Factor,
        loc.Name,
        loc.Timezone,
        loc.InternalName,
        loc.Address,
        loc.City,
        loc.State,
        loc.Zip,
        loc.PhoneNumber,
        loc.HoursOfOperation,
        loc.Lat,
        loc.StoreDefaultMDU,
        loc.Lng,
        IFNULL(loc.isOpen, 0) AS isOpen,
        loc.DaysOfCoverage,
        loc.isReplenishedByMDU,
        loc.DateOpen,
        loc.ExtAisleSource,
        loc.DisplayOrder,
        loc.DCLocationID,
        loc.StorefrontImage,
        loc.isInventoryCounted,
        loc.isCrossDockEnabled,
        loc.isArchived,
        loc.hasFHBH,
        loc.maxInventoryTaskUnits,
        loc.inventoryTaskGroupSize,
        IFNULL(ld.totalDeptsBackfilled, 0) as DeptsBackfilled
    FROM container c
    LEFT JOIN location loc ON loc.ID = c.ID
    LEFT JOIN (
        SELECT count(Distinct DepartmentID) as totalDeptsBackfilled, LocationID
        FROM location_department
        GROUP BY LocationID
    ) ld ON loc.ID = ld.LocationID
    LEFT JOIN (
        SELECT LocationID, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS ReplenishSchedule FROM replenish_schedule GROUP BY LocationID
    ) AS rs ON rs.LocationID = c.ID
    LEFT JOIN (
        SELECT LocationID, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS DeliverySchedule FROM delivery_schedule GROUP BY LocationID
    ) AS ds ON ds.LocationID = c.ID
    LEFT JOIN (
        SELECT LocationID, KeycodeCount, GROUP_CONCAT(Hour ORDER BY Hour SEPARATOR ', ') AS InventoryCountSchedule FROM inventory_count_schedule GROUP BY LocationID
    ) AS ics ON ics.LocationID = c.ID
    LEFT JOIN (
        SELECT DISTINCT DCLocationID AS ID, true AS isDC FROM location WHERE DCLocationID IS NOT NULL
    ) AS dc ON dc.ID = c.ID
    WHERE c.Type IN ('STR', 'WRH')
    ${condition}
    ORDER BY isDC DESC, Type DESC, DisplayOrder, ID;`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        logger.info("get_cluster_locations ERROR:", {error});
        res.status(500).json({"message": `An error occured while retrieving cluster locations`});
    }

    for (let location of results) {
        if (location.Type === "WRH") {
            // WRH, Add stores field and Push to data array
            stores[location.ID] = location.Stores = [];
            data.push(location);
        } else { // STR
            let associatedWrh = location.WarehouseID?location.WarehouseID:UNASSIGNED;
            if (associatedWrh in stores) {
                stores[associatedWrh].push(location);
            }
        }

        if (location.DCLocationID != null) {
            stores[location.DCLocationID].push(location);
        }
    }

    if (stores[UNASSIGNED].length) { // IF we have unassigned stores, create a fake "UNASSIGNED" warehouse
        data.push({"ID": null, "Type": UNASSIGNED, "Stores": stores[UNASSIGNED]});
    }

    res.status(200).json({"data": data});
};

exports.get_location_details = async function(req, res) {
    let location = req.query.location;
    let sql, args, results;

    if (location == null) {
        res.status(404).json({"message": `Location is a required attribute!`});
        return;
    }

    args = [location, location, location, location, location];
    sql = `
        SELECT
            c.ID,
            c.Type,
            loc.WarehouseID,
            IF(rs.LocationID IS NULL, 0, 1) AS replenishEnabled,
            IF(sbs.LocationID IS NULL, 0, 1) AS replenishEnabledBackfill,
            rs.ReplenishSchedule,
            sbs.ReplenishScheduleBackfill,
            ics.InventoryCountSchedule,
            ics.KeycodeCount AS inventoryTaskKeycodeCount,
            loc.Name,
            loc.Timezone,
            loc.InternalName,
            loc.Address,
            loc.City,
            loc.State,
            loc.Zip,
            loc.PhoneNumber,
            loc.HoursOfOperation,
            loc.Lat,
            loc.Lng,
            IFNULL(loc.isOpen, 0) AS isOpen,
            loc.DaysOfCoverage,
            loc.isReplenishedByMDU,
            loc.DateOpen,
            loc.StoreDefaultMDU,
            loc.ExtAisleSource,
            loc.DisplayOrder,
            loc.DCLocationID,
            loc.StorefrontImage,
            loc.isInventoryCounted,
            loc.isCrossDockEnabled,
            loc.isArchived,
            loc.hasFHBH,
            loc.ServerURL,
            IF(dc.ID is null, false, true) as isDC,
            ibs.hasBotSchedule,
            loc.isISPEnabled,
            loc.maxInventoryTaskUnits,
            loc.inventoryTaskGroupSize,
            h.LocationHierarchyID as ParentID,
            IF((SELECT WarehouseID FROM location WHERE ID = 'ONLINE-STR') = loc.ID, 1, 0) AS hasOnlineFullfillment
        FROM container c
        LEFT JOIN location loc ON loc.ID = c.ID
        LEFT JOIN (
            SELECT LocationID, GROUP_CONCAT(Hour SEPARATOR ', ') AS ReplenishSchedule FROM replenish_schedule WHERE LocationID = ?
        ) AS rs ON rs.LocationID = c.ID
        LEFT JOIN location dc ON loc.ID = dc.DCLocationID
        LEFT JOIN (
            SELECT LocationID, GROUP_CONCAT(Hour SEPARATOR ', ') AS ReplenishScheduleBackfill FROM store_backfill_schedule WHERE LocationID = ?
        ) AS sbs ON sbs.LocationID = c.ID
        LEFT JOIN (
            SELECT LocationID, KeycodeCount, GROUP_CONCAT(Hour SEPARATOR ', ') AS InventoryCountSchedule FROM inventory_count_schedule WHERE LocationID = ?
        ) AS ics ON ics.LocationID = c.ID
        LEFT JOIN (
            SELECT ib.LocationID, IF(count(*) > 0, true, false) AS hasBotSchedule
            FROM inventory_bot ib
            INNER JOIN inventory_take_schedule its ON its.InventoryBotID = ib.ID
            INNER JOIN store_backfill_schedule sbs ON its.BackfillScheduleID = sbs.ID
            WHERE ib.LocationID = ?
        ) as ibs ON ibs.LocationID = c.ID
        LEFT JOIN location_hierarchy_locations h ON h.LocationID = c.ID
        WHERE c.ID = ?
        GROUP BY c.ID`;

    try {
        [results] = await ro_pool.query(sql, args);

        if (results.length) {
            res.status(200).json({"data": results});
        } else {
            res.status(404).json({"message": `Location ${location} does not exist!`});
        }
    } catch (error) {
        logger.info("get_location_details ERROR: ", {error});
        res.status(500).json({"message": `Location ${location} does not exist!`});
    }
};

exports.get_store_replenishment_groups = async function(req, res) {
    let storeId = req.query.storeId || null;
    let sql, args, results;

    if (storeId) {
        sql = "SELECT LocationID, GroupID, GROUP_CONCAT(Retail_Zone_ID ORDER BY Retail_Zone_ID ASC SEPARATOR ', ') AS RetailZoneID FROM location_group WHERE LocationID = ? GROUP BY LocationID, GroupID";
        args = [storeId];
    } else {
        res.status(400).json({"message": "A storeId is required"});
        return;
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.info("get_store_replenishment_groups ERROR:", {error});
        res.status(500).json({"message": "Error occured while retrieving store replenishment groups"});
        return;
    }

    res.status(200).json({"data": results});
};

async function _updateLocationMap() {
    global.locationTimezoneMap = {};

    let sql = `
        SELECT loc.ID, loc.Timezone
        FROM container c
        INNER JOIN location loc ON loc.ID = c.LocationID`;
    let [results] = await pool.query(sql);

    for (let row of results) {
        let id = row.ID;
        let timezone = row.Timezone;
        let location = id.split("-")[0];
        global.locationTimezoneMap[location] = {
            timezone: timezone,
            location: id
        };
    }
}

exports.upsert_location_details = async function(req, res) {
    let id = req.body.location_id;
    let name = req.body.name;
    let internalName = req.body.internal_name;
    let parentID = req.body.parentID;
    let timezone = req.body.timezone;
    let address = req.body.address;
    let city = req.body.city;
    let state = req.body.state;
    let zip  = req.body.zip;
    let phoneNumber = req.body.phone_number;
    let hoursOfOperation = req.body.hours;
    let lat = req.body.lat;
    let lng = req.body.lng;
    let isOpen = req.body.is_open || 0;
    let storeDefaultMDU = req.body.StoreDefaultMDU || null;
    let isReplenishedByMDU = req.body.is_mdu || 0;
    let hasFHBH = req.body.has_fhbh || false;
    let warehouseID = req.body.warehouse_id;
    let DaysOfCoverage = req.body.days_of_coverage;
    let DateOpen = req.body.opening_date;
    let ExtAisleSource = req.body.ext_source;
    let DisplayOrder = req.body.display_order;
    let DCLocationID = req.body.DCLocationID;
    let storefrontImage = req.body.storefrontImage;
    let isCrossDockEnabled = req.body.isCrossDockEnabled || 0;
    let isArchived = req.body.isArchived || 0;
    let maxInventoryTaskUnits = req.body.maxInventoryTaskUnits || 0;
    let inventoryTaskGroupSize = req.body.inventoryTaskGroupSize || 0;
    let ServerURL = req.body.server_url || null;

    let sql, args;
    if (id == null || name == null || timezone == null) {
        res.status(400).json({"message": `Location ID, Name and Timezone are required parameters!`});
        return;
    }

    if (isOpen != null && isOpen != 0) {
        isOpen = 1;
    }

    if (isOpen == 1 && isArchived == 1) {
        return res.status(400).json({"message": `Cannot archive an open location`});
    }

    if (isReplenishedByMDU != null && isReplenishedByMDU != 0) {
        isReplenishedByMDU = 1;
    }

    // For DCLocationID, the user can select "-- none --", so set it to NULL if that was selected
    if (DCLocationID === "-- none --") {
        DCLocationID = null;
    }

    // The Associated Warehouse is optional and the user can select "-- none --", so set it to NULL if that was selected
    if (warehouseID === "-- none --") {
        warehouseID = null;
    }

    // Cross dock can only be enabled if this location is a warehouse that has a Distribution Center, OR it's a store
    if (isCrossDockEnabled && (!DCLocationID && !warehouseID)) {
        res.status(400).json({"message": "This is a DC warehouse and may not have Cross Dock enabled"});
        return;
    }

    sql = `
        INSERT INTO location
        (ID, Name, Timezone, InternalName, Address, City, State, Zip, PhoneNumber, HoursOfOperation, Lat, Lng, isOpen, StoreDefaultMDU, isReplenishedByMDU, DaysOfCoverage, DateOpen, ExtAisleSource, WarehouseID, DisplayOrder, DCLocationID, StorefrontImage, isCrossDockEnabled, isArchived, hasFHBH, maxInventoryTaskUnits, inventoryTaskGroupSize, ServerURL)
        VALUES (?)
        ON DUPLICATE KEY UPDATE
        Name = VALUES(Name),
        Timezone = VALUES(Timezone),
        InternalName = VALUES(InternalName),
        Address = VALUES(Address),
        City = VALUES(City),
        State = VALUES(State),
        Zip = VALUES(Zip),
        PhoneNumber = VALUES(PhoneNumber),
        HoursOfOperation = VALUES(HoursOfOperation),
        Lat = VALUES(Lat), Lng = VALUES(Lng),
        isOpen = VALUES(isOpen),
        StoreDefaultMDU = VALUES(StoreDefaultMDU),
        isReplenishedByMDU = VALUES(isReplenishedByMDU),
        DaysOfCoverage = VALUES(DaysOfCoverage),
        DateOpen = VALUES(DateOpen),
        ExtAisleSource = VALUES(ExtAisleSource),
        WarehouseID = VALUES(WarehouseID),
        DisplayOrder = VALUES(DisplayOrder),
        DCLocationID = VALUES(DCLocationID),
        StorefrontImage = VALUES(StorefrontImage),
        isCrossDockEnabled = VALUES(isCrossDockEnabled),
        isArchived = VALUES(isArchived),
        hasFHBH = VALUES(hasFHBH),
        maxInventoryTaskUnits = VALUES(maxInventoryTaskUnits),
        inventoryTaskGroupSize = VALUES(inventoryTaskGroupSize),
        ServerURL = VALUES(ServerURL)`;
    args = [[id, name, timezone, internalName, address, city, state, zip, phoneNumber, hoursOfOperation, lat, lng, isOpen, storeDefaultMDU, isReplenishedByMDU, DaysOfCoverage, DateOpen, ExtAisleSource, warehouseID, DisplayOrder, DCLocationID, storefrontImage, isCrossDockEnabled, isArchived, hasFHBH, maxInventoryTaskUnits, inventoryTaskGroupSize, ServerURL]];
    try {
        await pool.query(sql, args);
        //#await pool.query(sql2, args2);
        let message = `Successfuly inserted or updated Location ${id} details.`;
        await _updateLocationMap();
        res.json({"status": "OK", "message": message});
    } catch (error) {
        logger.info("upsert_location_info failed: ", {error});
        res.status(400).json({"message": `Insert/Update of Location ${id} details failed!`});
    }

    // handle parent id

    let results;
    sql = `SELECT * FROM location_hierarchy_locations WHERE LocationID = ?`;
    args = [id];
    try {
        [results] = await pool.query(sql, args);
        // This should only return 1 result
    } catch (error) {
        logger.info("upsert_location_details parentID update failed: ", {error});
    }

    if (results.length) {
        let parent = results[0].LocationHierarchyID;
        let lclID = results[0].ID;
        if (parent != parentID) {
            if (parentID != null) {
                sql = `UPDATE location_hierarchy_locations SET LocationHierarchyID = ? WHERE ID = ?`;
                args = [parentID, lclID];
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
        if (parentID) {
            sql = `INSERT INTO location_hierarchy_locations (LocationHierarchyID, LocationID) VALUES (?, ?)`;
            args = [parentID, id];
            try {
                [results] = await pool.query(sql, args);
                // This should only return 1 result if the
            } catch (error) {
                logger.info("upsert_location_details parentID update failed: ", {error});
            }
        }
    }




};

exports.get_location_departments = async function(req, res) {
    let locationID = req.query.locationID;
    let sql, args, results;

    if (!locationID) {
        res.status(400).json({"message": `locationID is required parameters!`});
        return;
    }

    sql = `
        SELECT DISTINCT pd.Name, pd.ID, p.Class_Name
        FROM product p
        INNER JOIN product_department pd on pd.ID = p.DepartmentID
        ;
        SELECT ld.*, pd.Name from location_department ld
        INNER JOIN product_department pd on pd.ID = ld.DepartmentID
        WHERE LocationID = ?
        ;`;
    args = [locationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_location_departments:", {error});
        res.status(500).json({"message": `Unable to get location depertments for location: ${locationID}`});
        return;
    }

    let data = results[0];
    let selected = results[1];


    /*if (!results.length) {
        res.status(404).json({"message": `No Department exist for location: ${locationID}.`});
    }*/
    res.status(200).json({"data": data, "selected": selected});
};

exports.update_location_departments = async function(req, res) {
    let locationID = req.body.locationID;
    let departmentNames = req.body.departmentNameArray;
    let sql, args, results;

    if (!locationID || !departmentNames || !departmentNames.length) {
        res.status(400).json({"message": `locationID and DepartmentName are required parameters!`});
        return;
    }

    sql = `
        DELETE FROM location_department WHERE LocationID = ?
        ;
        INSERT INTO location_department(LocationID, DepartmentID, ClassName)
        VALUES ?
        ;
    `;
    args = [locationID, departmentNames];
    try {

        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_location_departments:", {error});
        res.status(500).json({"message": `Unable to update location depertments for location: ${locationID}`});
        return;
    }

    if (!results[1].affectedRows) {
        res.status(400).json({"message": `Unable to update location depertments for location: ${locationID}`});
        return;
    }
    let message = `Successfuly updated Location department for location: ${locationID}.`;
    res.json({"status": "OK", "message": message});
};

exports.get_location_hierarchy = async function(req, res) {
    let sql, args, results, data;
    let unassigned = req.query.Unassigned === "true" || req.query.Unassigned === 1 ? true : false;
    let user = authHelper.parseRole(req);
    showArchived = helper.parseBoolean(req.query.showArchived);
    let condition = "AND loc.isArchived IS FALSE";
    if (showArchived) {
        condition = "";
    }

    // get user RegionID
    sql = `SELECT RegionID from user WHERE ID = ?`;
    args = [user.id];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_location_hierarchy:", {error});
        res.status(500).json({"message": "Unable to get the location hierarchy"});
        return;
    }

    let regionID = results[0].RegionID;
    /*************************************************************
     *  Explaining the recursive queries below.
     *
     *  WITH is a Common Table Expression (CTE) which is basically a
     *  view or a temporary table you can reference multiple times
     *  in the the same query unlike a temporary table. It also
     *  only works with the query it is inside unlike a temporary
     *  table that can be referenced in multiple queries.
     *
     *  RECURSIVE allows the UNION ALL to continue to Union until
     *  the lower select does not return any more rows.
     *************************************************************/
    if (regionID) {
        sql = `WITH RECURSIVE tmp_loc_tree (ID, Name, ParentID) AS
        (
        SELECT h.ID, h.Name, ParentID
            FROM location_hierarchy h
            INNER JOIN user u on u.RegionID = h.ID
            WHERE u.ID = ?
        UNION ALL
        SELECT l.ID, l.Name, l.ParentID
            FROM tmp_loc_tree AS p JOIN location_hierarchy AS l
            ON p.id = l.ParentID
        )
        SELECT
            t.*,
            loc.ID as LocationID,
            loc.Name as LocName,
            IFNULL(loc.isOpen, 0) AS isOpen,
            loc.isInventoryCounted,
            loc.StoreDefaultMDU,
            loc.isArchived,
            IFNULL(ld.totalDeptsBackfilled, 0) as DeptsBackfilled
        FROM (
            SELECT t.*, LocationID
            FROM (
                SELECT *
                FROM tmp_loc_tree
                ORDER BY ParentID
            ) AS t
            LEFT JOIN (
				SELECT lhl.* FROM location_hierarchy_locations lhl
				INNER JOIN location loc on loc.ID = LocationID
                ${condition}
            ) AS hl ON t.ID = hl.LocationHierarchyID
            UNION
            SELECT distinct null, null, null, loc.ID AS LocationID
            FROM location loc
            LEFT JOIN location_hierarchy_locations hl on hl.LocationID = loc.ID
            WHERE hl.LocationID is null
            ${condition}
        ) AS t
        LEFT JOIN location loc ON loc.ID = t.LocationID
        LEFT JOIN (
            SELECT count(Distinct DepartmentID) as totalDeptsBackfilled, LocationID
            FROM location_department
            GROUP BY LocationID
        ) ld ON loc.ID = ld.LocationID;`;
        args = [user.id];
    } else if (user.isAdmin) {
        sql = `
        WITH RECURSIVE tmp_loc_tree (ID, Name, ParentID) AS
        (
        SELECT ID, Name, ParentID
            FROM location_hierarchy
            WHERE ParentID IS NULL
        UNION ALL
        SELECT l.ID, l.Name, l.ParentID
            FROM tmp_loc_tree AS p JOIN location_hierarchy AS l
            ON p.id = l.ParentID
        )
        SELECT
            t.*,
            loc.ID as LocationID,
            loc.Name as LocName,
            IFNULL(loc.isOpen, 0) AS isOpen,
            loc.isInventoryCounted,
            loc.StoreDefaultMDU,
            loc.isArchived,
            IFNULL(ld.totalDeptsBackfilled, 0) as DeptsBackfilled
        FROM (
            SELECT t.*, LocationID
            FROM (
                SELECT *
                FROM tmp_loc_tree
                ORDER BY ParentID
            ) AS t
            LEFT JOIN (
				SELECT lhl.* FROM location_hierarchy_locations lhl
				INNER JOIN location loc on loc.ID = LocationID
                ${condition}
            ) AS hl ON t.ID = hl.LocationHierarchyID
            UNION
            SELECT distinct null, null, null, loc.ID AS LocationID
            FROM location loc
            LEFT JOIN location_hierarchy_locations hl on hl.LocationID = loc.ID
            WHERE hl.LocationID is null
            ${condition}
        ) AS t
        LEFT JOIN location loc ON loc.ID = t.LocationID
        LEFT JOIN (
            SELECT count(Distinct DepartmentID) as totalDeptsBackfilled, LocationID
            FROM location_department
            GROUP BY LocationID
        ) ld ON loc.ID = ld.LocationID`;
    } else {
        sql = `WITH RECURSIVE tmp_loc_tree (ID, Name, ParentID) AS
        (
        SELECT ID, Name, ParentID
            FROM location_hierarchy
            WHERE ParentID IS NULL
        UNION ALL
        SELECT l.ID, l.Name, l.ParentID
            FROM tmp_loc_tree AS p JOIN location_hierarchy AS l
            ON p.id = l.ParentID
        )
        SELECT
            t.*,
            loc.ID as LocationID,
            loc.Name as LocName,
            IFNULL(loc.isOpen, 0) AS isOpen,
            loc.isInventoryCounted,
            loc.StoreDefaultMDU,
            loc.isArchived,
            IFNULL(ld.totalDeptsBackfilled, 0) as DeptsBackfilled
        FROM (
            SELECT t.*, LocationID
            FROM (
                SELECT *
                FROM tmp_loc_tree
                ORDER BY ParentID
            ) AS t
            LEFT JOIN (
				SELECT lhl.* FROM location_hierarchy_locations lhl
				INNER JOIN location loc on loc.ID = LocationID
                ${condition}
            ) AS hl ON t.ID = hl.LocationHierarchyID
            UNION
            SELECT distinct null, null, null, loc.ID AS LocationID
            FROM location loc
            LEFT JOIN location_hierarchy_locations hl on hl.LocationID = loc.ID
            WHERE hl.LocationID is null
            ${condition}
        ) AS t
        LEFT JOIN location loc ON loc.ID = t.LocationID
        LEFT JOIN (
            SELECT count(Distinct DepartmentID) as totalDeptsBackfilled, LocationID
            FROM location_department
            GROUP BY LocationID
        ) ld ON loc.ID = ld.LocationID
        INNER JOIN user u on u.DefaultLocation = loc.ID
        WHERE u.ID = ?;`;
        args = [user.id];
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_location_hierarchy:", {error});
        res.status(500).json({"message": "Unable to get the location hierarchy"});
        return;
    }

    data = [];
    let UNASSIGNED = [];
    let map = {};
    let locations = {};
    // Special for managers with location of 1
    if (results.length === 1) {
        if (results[0].ID == null) {
            data.push({ Name: "Unassigned", locations: [location(results[0])] });
        } else {
            let region = group(results[0]);
            region.locations.push(location(results[0]));
            data.push(region);
        }
    } else {
        for (let result of results) {
            if (result.ID == null) {
                UNASSIGNED.push(location(result));
                continue;
            }
            if (!(result.ID in map)) {
                if (result.ParentID != null && (regionID === null || regionID !== result.ID)) {
                    let parent = map[result.ParentID];
                    let child = group(result);
                    parent.push(child);

                    map[result.ID] = child.children;
                    locations[result.ID] = child.locations;
                    if (result.LocationID) {
                        let loc = locations[result.ID];
                        loc.push(location(result));
                    }
                } else {
                    let parent = group(result);
                    data.push(parent);
                    map[result.ID] = parent.children;
                    locations[result.ID] = parent.locations;
                    if (result.LocationID) {
                        let loc = locations[result.ID];
                        loc.push(location(result));
                    }
                }
            } else {
                let loc = locations[result.ID];
                loc.push(location(result));
            }
        }
        if (UNASSIGNED.length && unassigned) {
            data.push({ Name: "Unassigned", locations: UNASSIGNED });
        }
    }

    function location(data) {
        return {
            ID: data.LocationID,
            name: data.LocName,
            isOpen: data.isOpen,
            isArchived: data.isArchived,
            MDU: data.StoreDefaultMDU,
            DeptsBackfilled: data.DeptsBackfilled
        };
    }

    function group(data) {
        return { ID: data.ID, Name: data.Name, ParentID: data.ParentID, children: [], locations: [] };
    }

    res.status(200).json({"data": data});
};

exports.get_assignable_locations = async function(req, res) {
    // Get all location hierarchy IDs without children (leaf nodes)
    let results;
    let sql = `
        SELECT lh2.ID, lh2.Name
        FROM location_hierarchy lh2
        LEFT JOIN (
            SELECT ParentID FROM location_hierarchy
        ) AS lh1 ON lh1.ParentID = lh2.ID
        WHERE lh1.ParentID IS NULL`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        logger.error("get_assignable_locations:", {error});
        res.status(500).json({"message": "Unable to get assignable locations"});
        return;
    }

    // results = results.map(obj => obj.ID);
    res.status(200).json(results);
};

exports.get_unassigned_locations = async function(req, res) {
    // Get all IDs in the location table that aren't in the location_hierarchy_locations table
    let results;
    let sql = `
        SELECT loc.ID
        FROM location loc
        LEFT JOIN location_hierarchy_locations lhl ON lhl.LocationID = loc.ID
        WHERE lhl.LocationID IS NULL`;

    try {
        [results] = await ro_pool.query(sql);
    } catch (error) {
        logger.error("get_unassigned_locations:", {error});
        res.status(500).json({"message": "Unable to get unassigned locations"});
        return;
    }

    results = results.map(obj => obj.ID);
    res.status(200).json(results);
};

exports.upsert_location_hierarchy = async function(req, res) {
    let name = req.body.Name;                      // Name to set in a new node, or update in an existing node
    let id = req.body.LocationHierarchyID || null; // [UPDATE] ID of the Location Hierarchy to update
    let parentId = req.body.ParentID || null;      // [UPDATE/INSERT] The parent ID of the new location hierarchy; optional and will create a new top-level hierarchical location if left NULL
    let sql, args, results, message;

    // Specifying a Location Hierarchy ID means that we'll update a currently-existing node
    if (id) {
        let optionalSql = ``;
        args = [name];

        if (parentId !== id) {
            optionalSql = `, ParentID = ?`;
            args.push(parentId);
        }

        sql = `UPDATE location_hierarchy SET Name = ? ${optionalSql} WHERE ID = ?`;
        args.push(id);

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("upsert_location_hierarchy:", {error});
            res.status(500).json({"message": `Unable to update ${name}`});
            return;
        }

        if (results.affectedRows === 1) {
            res.status(200).json({"message": `Name has been updated to ${name}`});
        } else {
            res.status(400).json({"message": `That ID does not exist`});
        }
    } else {
        /* Not specifying an ID means that we'll create a new node
         * Data Validations:
         * 1. There can only be a maximum of three levels. This means that we must prevent the creation of new location hierarchies
         *    if the desired parent ID has a grandparent, so the first step must be to check for existence of a grandparent.
         *    If there are no rows/results, then that means req.body.ParentID is NULL and the user wants to create a new
         *    top-level hierarchy. If there is a row/result and it's NULL, then that means it has a parent, but not a grandparent.
         *    If there is a row/result and ParentID isn't NULL, then that means it has a grandparent and we must reject this request
         *
         * 2. If the user provided a Parent ID, then the respective ID must exist in the table location_hierarchy
         */
        let args = [parentId, parentId];
        let sql = `
            SELECT lh2.ParentID
            FROM location_hierarchy lh
            INNER JOIN location_hierarchy lh2 ON lh2.ID = lh.ParentID
            WHERE lh.ID = ?
            LIMIT 1 # We don't need more than one row to perform this check
            ;
            SELECT ID FROM location_hierarchy WHERE ID = ?`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("upsert_location_hierarchy:", {error});
            res.status(500).json({"message": "Unable to check the depth of location hierarchy"});
            return;
        }

        if (results[0].length && results[0][0].ParentID) {
            // Validate data for the first case
            res.status(400).json({"message": "Unable to create location hierarchies this deep"});
            return;
        } else if (parentId && results[1].length === 0) {
            // Validate data for the second case
            res.status(400).json({"message": "No location hierarchy found to make that a parent"});
            return;
        }

        // We may now insert into the database as the data has been validated
        args = [name, parentId, parentId];
        sql = `
            INSERT INTO location_hierarchy (Name, ParentID) VALUES (?, ?)
            ;
            SELECT Name FROM location_hierarchy WHERE ID = ? LIMIT 1`;

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            logger.error("upsert_location_hierarchy:", {error});
            res.status(500).json({"message": `Unable to create ${name}`});
            return;
        }

        message = `Location Hierarchy ${name} has been created`;

        if (results[1].length) {
            message += ` with parent "${results[1][0].Name}"`;
        }

        res.status(200).json({"message": message});
    }
};



exports.assign_locations_to_hierarchy = async function(req, res) {
    let id = req.body.LocationHierarchyID || null;
    let storeIds = req.body.StoreIDs || null; // CSV of store IDs
    let locationHierarchyLocations = [];
    let sql, args, results;

    if (!id) {
        res.status(400).json({"message": "The Location Hierarchy ID must be defined"});
        return;
    }

    /* All levels allow the association of locations, but ONLY levels with NO children will be allowed to assign locations.
     * Once a level has a location assigned, it will NOT allow additional creation of children (EXCEPT for the top-level).
     * One single location should be assigned to a child, and all children's locations will be recorded in the top-level
     *
     * Data Validations:
     * 1. The location hierarchy ID must exist and not have any children.
     *    If this query returns zero rows, then no location hierarchy was found...
     *
     * 2. ...If lh2.ParentID has a value, then that location hierarchy currently has
     *    a child and therefore you can't assign a location to it
     *
     * 3. All store IDs must exist
     *
     * 4. Get all locations that are currently assigned. Because locations can only be assigned once, the number of rows returned
     *    must be zero. If it's greater than zero, the user will be alerted as to which locations have already been assigned
     */
    if (storeIds) {
        // Transform the CSV into an array of strings if the user supplied that parameter
        storeIds = storeIds.split(",");
        args = [id, storeIds, id, storeIds];
        sql = `
            SELECT lh2.ParentID
            FROM location_hierarchy lh
            LEFT JOIN location_hierarchy lh2 ON lh2.ParentID = lh.ID
            WHERE lh.ID = ?
            LIMIT 1 # Only one row is needed to validate the data
            ;
            # Get the number of valid store IDs
            SELECT ID FROM location WHERE ID IN (?)
            ;
            SELECT LocationID FROM location_hierarchy_locations WHERE LocationHierarchyID != ? AND LocationID IN (?)`;
    } else {
        // If the user didn't supply any storeIds, then there's no need to perform
        // the check on with the second query since the locations will be removed
        args = [id];
        sql = `
            SELECT lh2.ParentID
            FROM location_hierarchy lh
            LEFT JOIN location_hierarchy lh2 ON lh2.ParentID = lh.ID
            WHERE lh.ID = ?
            LIMIT 1 # Only one row is needed to validate the data`;
    }

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_location_hierarchy:", {error});
        res.status(500).json({"message": "Unable to update %NAME%"});
        return;
    }

    if (results[0].length === 0) {
        // Validation check to make sure the ID exists
        res.status(400).json({"message": "That location hierarchy ID does not exist"});
        return;
    } else if (results[0][0].ParentID !== null) {
        // Validation check to make sure you can't assign a location to a hierarchy that has children
        res.status(400).json({"message": "You can't assign a location to a hierarchy that has children"});
        return;
    } else if (storeIds && storeIds.length !== results[1].length) {
        // Validation check if the user specified at least one store ID
        res.status(400).json({"message": "At least one store ID is invalid"});
        return;
    } else if (storeIds && results[2].length) {
        // Validation check to make sure that the user didn't try to assign a location that has already been assigned
        results = results[2].map(obj => obj.LocationID);
        res.status(400).json({"message": `These stores have already been assigned: ${results.join(", ")}`});
        return;
    }

    // We may now assign the location to the hierarchy as the data has been validated
    // Only perform the INSERT sql if the user wanted
    if (storeIds) {
        for (let row of results[1]) {
            locationHierarchyLocations.push([
                id,
                row.ID
            ]);
        }

        // Clear all store location IDs for the specified LocationHierarchyID before inserting the store IDs the user passed in
        args = [id, locationHierarchyLocations];
        sql = `
            DELETE FROM location_hierarchy_locations WHERE LocationHierarchyID = ?
            ;
            INSERT INTO location_hierarchy_locations (LocationHierarchyID, LocationID) VALUES ?`;
    } else {
        // The user didn't pass in any store IDs, so all stores will be removed from this LocationHierarchyID
        args = [id];
        sql = `DELETE FROM location_hierarchy_locations WHERE LocationHierarchyID = ?`;
    }

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("update_location_hierarchy:", {error});
        res.status(500).json({"message": "Unable to create locations for %NAME%"});
        return;
    }

    res.status(200).json({"message": "The locations have been successfully updated for %NAME%"});
};

exports.delete_location_hierarchy = async function(req, res) {
    let id = req.query.LocationHierarchyID || null;
    let results;

    if (!id) {
        res.status(400).json({"message": "The Location Hierarchy ID must be defined"});
        return;
    }

    /* The structure MUST be empty or else an error will be returned. This means that the hierarchical location
     * MUST NOT have any children, and MUST NOT have any locations assigned to it in location_hierarchy_locations.
     * Both queries MUST be NULL, which means there are no children for this hierarchy.
     * Note that there is one exception for the root node; you may delete a root node in order to change the
     * base structure in which it will set the children node's parents to NULL
     */
    let args = [id, id, id];
    let sql = `
        SELECT ID
        FROM location_hierarchy
        WHERE ParentID = ?
        LIMIT 1 # Only one row is needed to validate the data
        ;
        SELECT ID
        FROM location_hierarchy_locations
        WHERE LocationHierarchyID = ?
        LIMIT 1 # Only one row is needed to validate the data
        ;
        # Special exception for the root node
        SELECT ID
        FROM location_hierarchy
        WHERE ID = ? AND ParentID IS NULL`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_location_hierarchy:", {error});
        res.status(500).json({"message": "Unable to validate structure of the location hierarchy"});
        return;
    }

    if (results[0].length) {
        /* Validate data for the first case. Normally we're unable to delete nodes with children,
         * but there's an exception for the root node which can be deleted to change the base structure.
         * This will set the children node's parents to NULL */
        if (results[2].length) {
            // This is a root node so it can be deleted. Set the children node's parents to NULL
            args = [id];
            sql = `UPDATE location_hierarchy SET ParentID = NULL WHERE ParentID = ?`;

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                logger.error("delete_location_hierarchy:", {error});
                res.status(500).json({"message": "Unable to set children node's parents to null"});
                return;
            }
        } else {
            res.status(400).json({"message": "Unable to delete that location hierarchy because it contains children"});
            return;
        }
    } else if (results[1].length) {
        // Validate data for the second case
        res.status(400).json({"message": "Unable to delete that location hierarchy because it contains store locations"});
        return;
    }

    // We may now delete the location hierarchy as the data has been validated
    args = [id];
    sql = `DELETE FROM location_hierarchy WHERE ID = ?`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_location_hierarchy:", {error});
        res.status(500).json({"message": "Unable to delete the location hierarchy"});
        return;
    }

    res.status(200).json({"message": "The location hierarchy has been successfully deleted"});
};
