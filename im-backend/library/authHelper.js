const logger = require("./logger")("library:authHelper");
// Authentication Helper functions

/**
 * parseRole
 * - parse req.headers.user-role
 * - return object
 * - use: let roles = authHelper.parseRole(req);
 * @param {*} req
 */
exports.parseRole = function(req) {
    let roles = req.headers["user-role"];
    let id = req.headers["user-id"];

    // There is an axios 0.19.2 bug causing this array to be converted to the string [object Object]
    // This header is stringified in apiRequest.js so parse it if it is a string
    if (typeof roles === "string") {
        roles = JSON.parse(roles);
    }

    let data = {
        id: id,
        isAdmin: false,
        isWmanager: false,
        isSmanager: false,
        isRegionManager: false,
        isGuest: false,
        store: false,
        warehouse: false,
        roles: roles
    };

    if (roles.indexOf("admin") >= 0) {
        data.isAdmin = true;
        data.store = true;
        data.warehouse = true;
        return data;
    }

    if (roles.indexOf("w_manager") >= 0) {
        data.isWmanager = true;
    }

    if (roles.indexOf("s_manager") >= 0) {
        data.isSmanager = true;
    }

    if (roles.indexOf("s_region_manager") >= 0) {
        data.isRegionManager = true;
    }

    if (roles.indexOf("guest") >= 0) {
        data.isGuest = true;
    }

    for (let i in roles) {
        if (roles[i].indexOf("w_") == 0)
            data.warehouse = true;
        if (roles[i].indexOf("s_") == 0)
            data.store = true;
    }

    return data;
};

exports.parseRoleFromId = async function(id) {
    let roles = [];
    let sql   = "SELECT UserRole FROM user_roles WHERE UserID = ?";
    let args  = [id];
    let results;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        return -1;
    }

    for (let role of results) {
        roles.push(role.UserRole);
    }

    let data = {
        id: id,
        isAdmin: false,
        isWmanager: false,
        isSmanager: false,
        isRegionalManager: false,
        store: false,
        warehouse: false,
        roles: roles
    };

    if (roles.indexOf("admin") >= 0) {
        data.isAdmin = true;
        data.store = true;
        data.warehouse = true;
        // return data;
    }

    if (roles.indexOf("w_manager") >= 0) {
        data.isWmanager = true;
    }

    if (roles.indexOf("s_manager") >= 0) {
        data.isSmanager = true;
    }

    if (roles.indexOf("s_region_manager") >= 0) {
        data.isSmanager = true;
    }

    for (let i in roles) {
        if (roles[i].indexOf("w_") == 0)
            data.warehouse = true;
        if (roles[i].indexOf("s_") == 0)
            data.store = true;
    }

    args = [id];
    sql  = `
        SELECT rLevel, rArea
        FROM (
            SELECT GROUP_CONCAT(ur.UserRole) as Roles, IFNULL(min(role.RoleLevel+0),20) as rLevel, GROUP_CONCAT(DISTINCT role.RoleArea) as rArea
            FROM user u
            LEFT JOIN user_roles ur ON ur.UserID = u.ID
            LEFT JOIN user_role role ON role.RoleName = ur.UserRole
            WHERE u.ID = ?
            GROUP BY u.ID
        ) as u;
    `;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        return -1;
    }

    data["rLevel"] = results[0]["rLevel"];
    data["rArea"] = results[0]["rArea"];

    if (data["rArea"])
        data["rArea"] = results[0]["rArea"].split(",");
    else
        data["rArea"] = [];

    return data;
};
