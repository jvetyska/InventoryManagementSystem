/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

var apiRequest = require("../library/apiRequest");
var bcrypt = require("bcryptjs");
var crypto = require("crypto");
var request = require("request");
var jwt = require("jsonwebtoken");
var authHelper = require("../library/authHelper");
var moment = require("moment");
const { default: chalk } = require("chalk");
const logger = require("../library/logger")("microwarehouse-api:mw_api_account_management");

const table = [
    "A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
    "a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z",
    "0","1","2","3","4","5","6","7","8","9","-","_"
];

function GenerateRandomApiKey() {return new Promise((done, fail) => {
    // The API Key will have a total length of 64: "api-key-" plus 56 random characters
    var length = 56;
    var bytes  = length * 3 / 4;

    crypto.randomBytes(bytes, function(err, buffer) {
        var apiKey = `api-key-${buffer.toString("base64")}`;
        done(apiKey);
    });
});}

exports.get_users = async function(req, res) {
    let data, sql, args;
    let user = authHelper.parseRole(req);

    if (user.isAdmin) {
        sql =
            `Select u.ID, Username, FirstName, LastName, GROUP_CONCAT(DISTINCT ur.UserRole) AS Roles, Email
            FROM user u
            LEFT JOIN user_roles ur ON ur.UserID = u.ID
            WHERE IsDeleted is false
            Group By u.ID
            ORDER BY u.FirstName;`;
    } else if (user.isRegionManager) {
        /*************************************************************
         *  Explaining the recursive query below.
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
        sql =
            `WITH RECURSIVE tmp_loc_tree (ID, Name, ParentID) AS
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
            Select u.ID, Username, FirstName, LastName, GROUP_CONCAT(DISTINCT ur.UserRole) AS Roles, Email, IFNULL(min(r.RoleLevel+0),20) AS rLevel
            FROM (
                SELECT *
                FROM tmp_loc_tree
                ORDER BY ParentID
            ) AS t
            LEFT JOIN location_hierarchy_locations hl ON t.ID = hl.LocationHierarchyID
            INNER JOIN user u on u.DefaultLocation = hl.LocationID OR u.RegionID = t.ID
            LEFT JOIN user_roles ur ON ur.UserID = u.ID
            LEFT JOIN user_role r ON ur.UserRole = r.RoleName
            WHERE IsDeleted is false
            GROUP BY u.ID
            HAVING rLevel >= 2
            ORDER BY u.FirstName;`;
        args = [user.id];
    } else {
        sql =
            `Select u.ID, Username, FirstName, LastName, GROUP_CONCAT(DISTINCT ur.UserRole) AS Roles, Email, IFNULL(min(r.RoleLevel+0),20) AS rLevel
            from user u
            LEFT JOIN user_roles ur ON ur.UserID = u.ID
            LEFT JOIN user_role r ON ur.UserRole = r.RoleName
            INNER JOIN (
                SELECT DefaultLocation from user WHERE ID = ?
            ) as loc on u.DefaultLocation = loc.DefaultLocation
            WHERE IsDeleted is false
            Group By u.ID
            HAVING (rLevel > 3 OR u.ID = ?)
            ORDER BY u.FirstName;`;
        args = [user.id, user.id];
    }

    try {
        [data] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_users: ", {error});
        res.status(500).json({"message": "Unable to retrieve users at this time."});
        return;
    }

    res.status(200).json({"data": data});
};

exports.get_user_details = async function(req, res) {
    // remove user_locations
    let username = req.query.username;
    let ID = parseInt(req.query.ID) || null;
    let requester = authHelper.parseRole(req);
    let sql, args, results, data, sqlWhere, sqlFilter = "";

    if (username && username != "") { // Lookup by username
        args = [username];
        sqlWhere = "u.Username = ?";
    } else if (ID != null) {
        args = [ID];
        sqlWhere = "u.ID = ?";
    } else {
        res.status(400).json({"message": "ID or username is required!"});
        return;
    }

    if (requester.isSmanager || requester.isWmanager) { // Or Store Manager can get anybody associated with the store
        sqlFilter = "HAVING rLevel >= 3";
    } else if (requester.isRegionManager) { // Or Warehouse manager can get anybody associated with the warehouse
        sqlFilter = "HAVING rLevel >= 2 ";
    } else if (!requester.isAdmin && !requester.id === ID) { // Otherwise you are not allowed!
        res.status(404).json({"message": "You don't have permission to edit this User"});
        return;
    }

    sql = `
        SELECT
            u.ID,
            u.Username,
            u.LoginBarcode,
            u.FirstName,
            u.LastName,
            u.Email,
            u.PhoneNumber,
            u.AccountCreated,
            u.AccountLastLoggedIn,
            u.DefaultLocation,
            u.RegionID,
            u.Roles,
            u.isSSO,
            IF (u.PasswordHash = '', FALSE, TRUE) AS hasPassword
        FROM (
            SELECT
                u.*,
                GROUP_CONCAT(DISTINCT ur.UserRole) AS Roles,
                IFNULL(min(r.RoleLevel+0),20) AS rLevel
            FROM user u
            LEFT JOIN user_roles ur ON ur.UserID = u.ID
            LEFT JOIN user_role r ON r.RoleName = ur.UserRole
            WHERE ${sqlWhere} AND IsDeleted = 0
            GROUP BY u.ID
            ${sqlFilter}
        ) AS u`;

    try {
        [results] = await ro_pool.query(sql, args);

        if (!results.length) {
            res.status(404).json({"message": "User not found"});
            return;
        }

        data = results[0];

        if (data.Roles) {
            data.Roles = data.Roles.split(",");
        }

        /* You must only be allowed to assign roles that are relevant to what your positions are:
         *
         * admin    : Full access
         * s_manager: RoleLevel = associate & RoleArea = STR
         * w_manager: RoleLevel = associate & RoleArea = WRH
         */
        let assignableRoles;

        if (requester.isAdmin || requester.isSmanager || requester.isWmanager || requester.isRegionManager) {
            assignableRoles = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];
        }

        res.status(200).json({"data": {
            "userData": data,
            "assignableRoles": assignableRoles
        }});
    } catch (error) {
        logger.info("get_user_details ERROR: ", {error});
        res.status(400).json({"message": "Error occured while retrieving user information."});
    }
};

exports.get_user_locations = async function(req, res) {
    let data, sql, args;
    let user = authHelper.parseRole(req);

    // Admins get all roles
    if (user.isAdmin) {
        try {
            sql = `
                SELECT
                    loc.ID, loc.Name, loc.isArchived, c.Type,
                    IF(loc.DCLocationID IS NULL AND c.Type = 'WRH', 1, 0) AS isDC,
                    IF((SELECT WarehouseID FROM location WHERE ID = 'ONLINE-STR') = loc.ID, 1, 0) AS hasOnlineFullfillment,
                    loc.hasFHBH,
                    loc.isISPEnabled,
                    IFNULL(u.DefaultLocation, loc.ID) as defaultLocation
                FROM location loc
                INNER JOIN container c on c.ID = loc.ID
                LEFT JOIN (
                    SELECT DefaultLocation from user where ID = ?
                ) AS u ON true`;

            args = [user.id];

            // Admins get access to all locations
            let [results] = await ro_pool.query(sql, args);
            let locations = [];
            for (let result of results) {
                locations.push({
                    "ID"                    : result["ID"],
                    "Name"                  : result["Name"],
                    "isArchived"            : result["isArchived"],
                    "Type"                  : result["Type"],
                    "isDC"                  : result["isDC"],
                    "hasOnlineFullfillment" : result["hasOnlineFullfillment"],
                    "hasFHBH"               : result["hasFHBH"],
                    "isISPEnabled"          : result["isISPEnabled"]
                });
            }

            let defaultLocation = results[0].defaultLocation;

            data = {
                "defaultLocation": defaultLocation,
                "locations"      : locations
            };
        } catch (error) {
            logger.error("get_user_locations: ", {error});
            res.status(500).json({"message": "Unable to retrieve user locations."});
            return;
        }
    } else if (user.isRegionManager) {
        // Regional Manager gets all locations under their region
        try {
            sql =
                `SELECT u.DefaultLocation
                FROM user u
                WHERE u.ID = ?`;
            args = [user.id, user.id];
            let [results] = await ro_pool.query(sql, args);

            let defaultLocation = results[0]["DefaultLocation"];

            args = [user.id];
            /*************************************************************
             *  Explaining the recursive query below.
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
            sql  = `
            WITH RECURSIVE tmp_loc_tree (ID, Name, ParentID) AS
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
                loc.ID, loc.Name, loc.isArchived, c.Type,
                IF(loc.DCLocationID IS NULL AND c.Type = 'WRH', 1, 0) AS isDC,
                IF((SELECT WarehouseID FROM location WHERE ID = 'ONLINE-STR') = loc.ID, 1, 0) AS hasOnlineFullfillment,
                loc.hasFHBH,
                loc.isISPEnabled
            FROM (
                SELECT t.*, LocationID
                FROM (
                    SELECT *
                    FROM tmp_loc_tree
                    ORDER BY ParentID
                ) AS t
                LEFT JOIN location_hierarchy_locations hl ON t.ID = hl.LocationHierarchyID
            ) AS t
            LEFT JOIN location loc ON loc.ID = t.LocationID
            INNER JOIN container c on c.ID = loc.ID
            WHERE t.LocationID IS NOT NULL;
            `;
            let [results2] = await ro_pool.query(sql, args);

            data = {
                "defaultLocation": defaultLocation,
                "locations"      : results2
            };
        } catch (error) {
            logger.error("get_user_locations: ", {error});
            res.status(500).json({"message": "Unable to retrieve user locations."});
            return;
        }
    } else {
        try {
            // Get the default location all other users
            sql = `SELECT
                u.DefaultLocation,
                loc.ID,
                loc.Name,
                loc.isArchived,
                c.Type,
                IF(loc.DCLocationID IS NULL AND c.Type = 'WRH', 1, 0) AS isDC,
                IF((SELECT WarehouseID FROM location WHERE ID = 'ONLINE-STR') = loc.ID, 1, 0) AS hasOnlineFullfillment,
                loc.hasFHBH,
                loc.isISPEnabled
            FROM user u
            INNER JOIN location loc on loc.ID = u.DefaultLocation
            INNER JOIN container c on c.ID = loc.ID
            WHERE u.ID = ?`;
            args = [user.id];

            let [results] = await pool.query(sql, args);

            data = {
                "defaultLocation": results[0].DefaultLocation,
                "locations"      : results
            };
        } catch (error) {
            logger.error("get_user_locations: ", {error});
            logger.error("User used:", {user});
            logger.error("request headers:", {requestHeaders: req.headers});
            res.status(500).json({"message": "Unable to retrieve user locations."});
            return;
        }
    }

    res.status(200).json({"data": data});
};

exports.get_available_roles = async function(req, res) {
    let userRoles = authHelper.parseRole(req);
    let allowedRoles = [];
    let sql;

    if (!userRoles["isAdmin"] && !userRoles["isWmanager"] && !userRoles["isSmanager"] && !userRoles["isRegionManager"]) {
        res.status(403).json({"message": "You don't have permission to assign any roles"});
        return;
    }

    if (userRoles.isAdmin) {
        sql = `
        SELECT RoleName
        FROM user_role
        ORDER BY RoleLevel, RoleName`;
    } else if (userRoles.isRegionManager) {
        sql = `
        SELECT RoleName
        FROM user_role
        WHERE RoleLevel+0 >= 2
        ORDER BY RoleLevel, RoleName`;
    } else if (userRoles.isSmanager || userRoles.isWmanager) {
        sql = `
        SELECT RoleName
        FROM user_role
        WHERE RoleLevel+0 > 3
        ORDER BY RoleLevel, RoleName`;
    }

    try {
        let [result] = await ro_pool.query(sql);

        for (let i of result) {
            allowedRoles.push(i["RoleName"]);
        }
    } catch (error) {
        logger.error("get_available_roles: ", {error});
        res.status(500).json({"message": "Unable to retrieve avilable roles at this time."});
        return;
    }

    res.status(200).json({"data": allowedRoles});
};

exports.create_user = async function(req, res) {
    let Username        = req.body.Username;
    let FirstName       = req.body.FirstName;
    let LastName        = req.body.LastName;
    let Email           = req.body.Email;
    let PhoneNumber     = req.body.PhoneNumber;
    let DefaultLocation = req.body.DefaultLocation;
    let Roles           = req.body.Roles || [];
    let RegionID        = req.body.RegionID;

    // Split Roles if it was passed in as a csv string instead of an array
    if (typeof Roles == "string") {
        Roles = Roles.split(",");
    }

    if (Roles.length == 0) {
        Roles = null;
    }

    // You must provide a username and first name
    if (!Username || !FirstName) {
        res.status(400).json({"message": "You must provide a username and first name"});
        return;
    }

    // The username MUST NOT contain a semicolon
    if (Username.indexOf(":") > -1) {
        res.status(400).json({"message": "The username must not contain a semicolon"});
        return;
    }

    // Check for a potential duplicate username
    try {
        let [u] = await pool.query("SELECT ID FROM user WHERE Username = ?", [Username]);

        if (u.length) {
            res.status(400).json({"message": `The username "${Username}" is already in use`});
            return;
        }
    } catch (error) {
        logger.error("create_user: ", {error});
        res.status(500).json({"message": "Unable to create user."});
        return;
    }

    // If we are assigning roles, make sure that the role(s) to assign are valid and we have permission to do so
    if (Roles) {
        let roleAssignmentAllowance = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];

        for (let role of Roles) {
            if (!roleAssignmentAllowance.includes(role)) {
                res.status(400).json({"message": `You can't assign the role ${role} either because that role doesn't exist or you don't have permission`});
                return;
            }
        }
    }

    let LoginBarcode = "";

    if (Roles.length === 1 && Roles[0] === "guest") {
        const storePrefix = DefaultLocation.substring(0, DefaultLocation.indexOf("-"));
        LoginBarcode = storePrefix;
    } else {
        // Generate a random LoginBarcode
        while (LoginBarcode.length < 13) {
            let i = Math.floor(Math.random() * Math.floor(64)); // 0 - 63
            LoginBarcode += table[i];
        }
    }

    // Check the barcode for a potential duplicate
    try {
        let [b] = await pool.query("SELECT ID FROM user WHERE LoginBarcode = ?", [LoginBarcode]);

        if (b.length) {
            res.status(400).json({"message": "Bad PIN generation, try clicking on the \"Create User\" button again"});
            return;
        }
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }

    if (!RegionID && Roles.includes("s_region_manager")) {
        // Region Managers must have RegionID
        res.status(400).json({"message": "Region Managers must have a region set."});
        return;
    }

    // All checks have passed!
    let id;

    try {
        let sql = `
            INSERT INTO user (
                Username,
                LoginBarcode,
                FirstName,
                LastName,
                Email,
                PhoneNumber,
                DefaultLocation,
                RegionID
            ) VALUES ?`;
        let args = [
            Username,
            LoginBarcode,
            FirstName,
            LastName,
            Email,
            PhoneNumber,
            DefaultLocation,
            RegionID
        ];

        id = (await pool.query(sql, [[args]]))[0]["insertId"];
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }

    if (Roles) {
        try {
            // Now that the user has been created, insert their roles into the user_roles table
            let sql  = "INSERT INTO user_roles (UserID, UserRole, AddedBy) VALUES ?";
            let args = [];

            for (let role of Roles) {
                args.push([
                    id,                    // UserID
                    role,                  // UserRole
                    req.headers["user-id"] // AddedBy
                ]);
            }

            await pool.query(sql, [args]);
        } catch (error) {
            /* Even though there was an error creating roles for the new user, this new user was
             * created in the previous SQL query which is fine, so we can go ahead and return OK
             * and the admin/manager will be advanced to the next page where they can review it
             */
            console.log(error);
        }
    }

    res.status(200).json({"message": `User "${Username}" has been created`, "data": id});
};

exports.update_profile = async function(req, res) {
    let FirstName       = req.body.FirstName;
    let LastName        = req.body.LastName;
    let Email           = req.body.Email;
    let PhoneNumber     = req.body.PhoneNumber;

    let requester = authHelper.parseRole(req);
    let sql, args, results;
    let set = {
        "FirstName"      : FirstName,
        "LastName"       : LastName,
        "Email"          : Email,
        "PhoneNumber"    : PhoneNumber
    };
    sql = "UPDATE user SET ? WHERE ID = ?";
    args = [set, requester.id];
    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("update_profile ERROR", {error});
        res.status(400).json({"message": "Error occured while attempting to update user profile!"});
        return;
    }
    if (!results.affectedRows) {
        res.status(404).json({"message": "User not found!"});
        return;
    }
    res.status(200).json({"message": "User Profile updated sucessfully."});
};

exports.update_user = async function(req, res) {
    let ID              = req.body.ID;
    let NewUsername     = req.body.NewUsername;
    let FirstName       = req.body.FirstName;
    let LastName        = req.body.LastName;
    let Email           = req.body.Email;
    let PhoneNumber     = req.body.PhoneNumber;
    let DefaultLocation = req.body.DefaultLocation;
    let Roles           = req.body.Roles || [];
    // let Locations       = req.body.Locations || [];
    let RegionID        = req.body.RegionID || null;
    let Username;

    // Split Roles if it was passed in as a csv string instead of an array
    if (typeof Roles == "string") {
        Roles = Roles.split(",");
    }

    if (Roles.length == 0) {
        Roles = null;
    }

    // Check if mandatory paramters were given
    if (!ID || !NewUsername || !FirstName) {
        res.status(400).json({"message": "You must provide a username and first name"});
        return;
    }

    // Make sure that the user that we want to update actually exists
    try {
        let [user] = await pool.query("SELECT Username FROM user WHERE ID = ?", [ID]);

        if (user.length == 0) {
            res.status(404).json({"message": `User ID ${ID} does not exist`});
            return;
        } else {
            Username = user[0]["Username"];
        }
    } catch (error) {
        logger.error("update_user: ", {error});
        res.status(500).json({"message": "Unable to update user details."});
        return;
    }

    if (NewUsername !== Username) {
        // The username MUST NOT contain a semicolon
        if (NewUsername.indexOf(":") > -1) {
            res.status(400).json({"message": "The username must not contain a semicolon"});
            return;
        }

        // Check for potential duplicate usernames
        try {
            let [u] = await pool.query("SELECT ID FROM user WHERE Username = ?", [NewUsername]);

            if (u.length) {
                res.status(400).json({"message": "That username is already in use"});
                return;
            }
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": error});
            return;
        }
    }

    // If we are assigning roles, make sure that the role(s) to assign are valid and we have permission to do so
    if (Roles) {
        let roleAssignmentAllowance = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];

        try {
            // Get already assigned roles
            let [AssignedRoles] = await pool.query("SELECT UserRole FROM user_roles WHERE UserID = ?", [ID]);
            let r = [];
            for (let role in AssignedRoles) {
                r.push(AssignedRoles[role].UserRole);
            }

            for (let role of Roles) {
                // If user already has role allow role
                if (!roleAssignmentAllowance.includes(role) && !(r.includes(role))) {
                    res.status(400).json({"message": `You can't assign the role ${role} either because that role doesn't exist or you don't have permission`});
                    return;
                }
            }
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": error});
            return;
        }
        if (!RegionID && Roles.includes("s_region_manager")) {
            // Region Managers must have RegionID
            res.status(400).json({"message": "Region Managers must have a region set."});
            return;
        }
    }



    // All checks have passed!
    // 1. UPDATE the user's data in the table: user
    // 2. DELETE all of the roles associated with the user in the table: user_roles
    // 3. INSERT all of the roles specified by the user
    let sql, args;

    try {
        let set = {
            "Username"       : NewUsername,
            "FirstName"      : FirstName,
            "LastName"       : LastName,
            "Email"          : Email,
            "PhoneNumber"    : PhoneNumber,
            "DefaultLocation": DefaultLocation,
            "RegionID"       : RegionID
            // "Locations"      : Locations.join(",")
        };
        sql = "UPDATE user SET ? WHERE ID = ?";
        args = [set, ID];
        await pool.query(sql, args);
    } catch (error) {
        logger.error("updating user", {error});
        res.status(500).json({"message": "Error occured when updating user."});
        return;
    }


    // ROLES:
    try {
        // Delete all existing roles.
        sql = `DELETE FROM user_roles WHERE UserID = ?`;
        args = [ID];
        await pool.query(sql, args);
        // If new roles provided, add them here.
        if (Roles) {
            sql = `INSERT INTO user_roles (UserID, UserRole, AddedBy) VALUES ?`;
            args = [];
            for (let role of Roles) {
                args.push([
                    ID,                    // UserID
                    role,                  // UserRole
                    req.headers["user-id"] // AddedBy
                ]);
            }
            await pool.query(sql, [args]);
        }
    } catch (error) {
        logger.error("updating roles:", {error});
        res.status(500).json({"message": "Error occured while updating user roles."});
        return;
    }

    res.status(200).json({"message": `User ${Username} has been updated`});
};

exports.update_user_password = async function(req, res) {
    let ID = req.body.ID;
    let Password = req.body.Password;

    // Check if the User's ID exists
    try {
        let sql = "SELECT ID FROM user WHERE ID = ?";
        let args = [ID];
        let [result] = await pool.query(sql, args);

        if (!result.length) {
            res.status(404).json({"message": `User ID: ${ID} does not exist`});
            return;
        }
    } catch (error) {
        logger.error("update_user_password: ", {error});
        res.status(500).json({"message": "Unable to update user's password."});
        return;
    }

    let requester = authHelper.parseRole(req);
    let allowed = _check_user_permission(requester, ID);

    if (allowed) {
        try {
            let PasswordHash = bcrypt.hashSync(Password, 10);
            let sql  = "UPDATE user SET PasswordHash = ? WHERE ID = ?";
            let args = [PasswordHash, ID];
            await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": error});
            return;
        }
    } else {
        res.status(400).json({"message": "You don't have permission to do this"});
        return;
    }

    res.status(200).json({"message": "Password changed"});
};

exports.update_user_login_barcode = async function(req, res) {
    let ID = req.body.ID;
    let LoginBarcode = "";

    // Check if the user provided an ID
    if (!ID) {
        res.status(400).json({"message": "You must provide an ID"});
        return;
    }

    // Check if the provided user ID actually exists
    try {
        let [result] = await pool.query("SELECT ID FROM user WHERE ID = ?", [ID]);

        if (!result.length) {
            res.status(400).json({"message": "That user ID doesn't exist"});
            return;
        }
    } catch (error) {
        console.log(error);
        res.status(400).json({"message": error});
        return;
    }

    let requester = authHelper.parseRole(req);
    let allowed = _check_user_permission(requester, ID);

    if (allowed) {
        try {
            // Generate a random LoginBarcode
            while (LoginBarcode.length < 13) {
                let i = Math.floor(Math.random() * Math.floor(64)); // 0 - 63
                LoginBarcode += table[i];
            }

            // Update the LoginBarcode in the database
            try {
                let sql  = "UPDATE user SET LoginBarcode = ? WHERE ID = ?";
                let args = [LoginBarcode, ID];
                await pool.query(sql, args);
            } catch (error) {
                console.log(error);
                res.status(400).json({"message": error});
                return;
            }
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": error});
            return;
        }
    } else {
        res.status(400).json({"message": "You don't have permission to do this"});
        return;
    }

    res.status(200).json({"message": "Barcode generated and updated in the database", "data": LoginBarcode});
};

exports.delete_user = async function(req, res) {
    let ID = parseInt(req.query.ID);
    let sql, args, rows;

    // Check if the user provided an ID
    if (!ID) {
        res.status(500).json({"message": "You must provide a user ID to delete"});
        return;
    }

    let requester = authHelper.parseRole(req);
    let allowed = _check_user_permission(requester, ID);

    // Verify the user's permissions to delete another user
    if (!allowed) {
        res.status(401).json({"message": `You are not authorized to remove user ID #${ID}`});
        return;
    }

    // Verify that the user ID exists in the database
    args = [ID];
    sql = `SELECT ID FROM user WHERE ID = ?`;

    try {
        [rows] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_user:", {error});
        res.status(500).json({"message": `Error while trying to delete user ID #${ID}`});
        return;
    }

    if (rows.length) {
        args = [ID];
        sql = `UPDATE user SET isDeleted = TRUE WHERE ID = ?`;
    } else {
        res.status(400).json({"message": `The user ID #${ID} doesn't exist`});
        return;
    }

    try {
        await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_user:", {error});
        res.status(500).json({"message": `Error while trying to delete user ID #${ID}`});
        return;
    }

    res.status(200).json({"message": `User ID #${ID} has been removed`});
};

async function _check_user_permission(requester, userID) {
    // Check requester has permission to alter the user
    if (requester.id == userID || requester.isAdmin) {
        return true;
    } else {
        let userToUpdate = await authHelper.parseRoleFromId(userID);

        // Managers can alter associates
        if ((requester.isWmanager || requester.isSmanager) && userToUpdate.rLevel > 3) {
            return true;
        }

        // Regional Managers can alter all except admin
        if (requester.isRegionManager && userToUpdate.rLevel >= 2) {
            return true;
        }
    }
    return false;
}
