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
const moment = require("moment-timezone");
const logger = require("../library/logger")("microwarehouse-api:mw_api_notifications");

// you know the usual stuff, create a notification and life goes on
exports.create_note = async function(req, res) {
    let title       = helper.trimVal(req.body.title);
    let description = helper.trimVal(req.body.description);
    let link        = helper.trimVal(req.body.link) || null;
    let datePublish = helper.trimVal(req.body.datePublish);
    let roleLevel   = req.body.roleLevel || []; // array
    let roleName    = req.body.roleName || [];
    let locationID  = req.body.locationID || []; // array
    let type        = req.body.type || null;
    let quantity    = req.body.quantity || 0;
    let mustRead    = req.body.mustRead || false;
    let userObject  = authHelper.parseRole(req);
    let errMessage  = null;
    let noteDetails = [];
    let responseBe  = {};
    let roleAssignmentAllowance, roleAllowedLocations, allowedLocations;
    let sql;
    let args = [];
    let results;
    let roleLvlNameMpped2Area;
    userObject = authHelper.parseRole(req);
    // calling all the api to get the roles etc.
    try {
        userObject = authHelper.parseRole(req);
        roleAllowedLocations = (await apiRequest.get(req, "account_management/get_user_locations"))["data"];
        allowedLocations = roleAllowedLocations.locations.map(elem => { return elem.ID; });
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Error occured while performing permissions checks"});
        return;
    }


    if (!title) {
        errMessage = "Request must include Title";
        res.status(400).json({"message": errMessage});
        return;
    }

    if (!roleName.length && !roleLevel.length) {
        errMessage = "RoleName or RoleLevel must be set";
        res.status(400).json({"message": errMessage});
        return;
    }

    if (mustRead && !description) {
        errMessage = "Must provide description when RequiredToRead option is TRUE";
        res.status(400).json({"message": errMessage});
        return;
    }

    if (locationID.length === 1 && !datePublish) {
        try {
            // If no publish date is passed in and there is only one
            // location then get timezone and calculate todays date
            sql = `
                SELECT Timezone from location
                WHERE ID = ?;`;
            args = [locationID[0]];


            [results] = await pool.query(sql, args);
            let timezone = results[0].Timezone;
            datePublish = moment().tz(timezone).format("YYYY-MM-DD");
        } catch (err) {
            console.log(err);
            let errMessage = "Error occured while fetching Location Timezone";
            res.status(500).json({"message": errMessage });
            return;
        }
    }

    // set datePublish
    if (!datePublish) {
        errMessage = "Date to publish notification is required";
        res.status(400).json({"message": errMessage});
        return;
    }

    try {
        if (roleLevel.length > 0) {
            sql = `
                SELECT DISTINCT RoleLevel from user_role ur
                WHERE ur.RoleLevel in (?);`;
            args = [roleLevel];
        } else if (roleName.length > 0) {
            sql = `
                SELECT DISTINCT RoleName from user_role ur
                WHERE ur.RoleName in (?);`;
            args = [roleName];
        }

        [results] = await pool.query(sql, args);
        roleLvlNameMpped2Area = results;
    } catch (err) {
        console.log(err);
        let errMessage = "Error occured while fetching RoleArea";
        res.status(500).json({"message": errMessage });
        return;
    } finally {
        args = []; // flush the args
    }

    noteDetails.push(title);
    noteDetails.push(description);
    noteDetails.push(link);
    noteDetails.push(type);
    noteDetails.push(quantity);
    noteDetails.push(datePublish);
    noteDetails.push(userObject.id);
    noteDetails.push(mustRead);
    // RoleArea, RoleLevel, RoleName,
    // inserting into note
    try {
        sql = `INSERT INTO note (Title, Description, Link,  Type, Quantity, DatePublish, UserCreated, mustRead) VALUES (?)`;
        args = [noteDetails];
        [results] = await pool.query(sql,args);
    } catch (err) {
        console.log(err);
        let errMessage = "could not insert note";
        res.status(500).json({"message": errMessage});
        return;
    } finally {
        args = [];
    }

    let noteID = results.insertId;
    responseBe.noteID = noteID;
    args = [];
    if (locationID.length) {
        let locations = locationID;

        for (let i in locations) {
            // check if the user is trying to create note for a location that he has no right to
            if (allowedLocations.includes(locations[i])) {
                let locArr = [];
                locArr.push(noteID);
                locArr.push(locations[i]);
                args.push(locArr);
            } else {
                let errMessage = `${locations[i]} not in list of allowed locations`;
                res.status(400).json({"message": errMessage});
                return;
            }
        }

        // inserting into note_locations
        try {
            sql = `INSERT INTO note_locations (NoteID, LocationID) VALUES ?`;
            [results] = await pool.query(sql,[args]);
        } catch (err) {
            console.log(err);
            let errMessage = "Could not insert into locations";
            res.status(500).json({"message": errMessage});
            return;
        } finally {
            args = [];
        }

    }

    let allNoteRoleArgs = [];
    if (roleName.length > 0) {
        for (let i in roleLvlNameMpped2Area) {
            let noteRoleArgs = [];
            noteRoleArgs.push(noteID);
            noteRoleArgs.push(roleLvlNameMpped2Area[i].RoleName);
            // noteRoleArgs.push(roleLvlNameMpped2Area[i].RoleArea); // ask glen
            allNoteRoleArgs.push(noteRoleArgs);
        }
        sql = `INSERT INTO note_roles (NoteID, roleName) VALUES ?`;
    } else if (roleLevel.length > 0) {
        for (let i in roleLvlNameMpped2Area) {
            let noteRoleArgs = [];
            noteRoleArgs.push(noteID);
            noteRoleArgs.push(roleLvlNameMpped2Area[i].RoleLevel);
            // noteRoleArgs.push(roleLvlNameMpped2Area[i].RoleArea);
            allNoteRoleArgs.push(noteRoleArgs);
        }
        sql = `INSERT INTO note_roles (NoteID,  RoleLevel) VALUES ?`;
    }
    // inserting into note_roles
    try {
        args = [allNoteRoleArgs];

        [results] = await pool.query(sql,args);
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "DB Update Failed"});
        return;
    } finally {
        args = [];
    }
    res.status(200).json({"data": responseBe });

};

// get all the notifications. go go go!
exports.get_notes = async function(req, res) {
    let noteResponse = {};
    let userObject, roleAssignmentAllowance, roleAllowedLocations, allowedLocations, allowedRoleLevels;
    let sql;
    let args = [];
    // Only get the elements that we can edit not the system generated notes

    let isEditable = helper.parseBoolean(req.query.isEditable);
    let results;
    try {
        userObject = authHelper.parseRole(req);
        roleAssignmentAllowance = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];
        roleAllowedLocations = (await apiRequest.get(req, "account_management/get_user_locations"))["data"];
        allowedLocations = roleAllowedLocations.locations.map(elem => { return elem.ID; });
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Error occured while performing permissions checks"});
        return;
    }

    args = [];

    let condition = ``;
    if (!userObject.isAdmin) {
        condition = `WHERE n.UserCreated = ${userObject.id}`;
        if (isEditable) {
            condition += ` AND n.Type is null`;
        }
    } else {
        if (isEditable) {
            condition = `WHERE n.Type is null`;
        }
    }
    sql = `
    SELECT
        n.*,
        group_concat(distinct IFNULL(nl.LocationID, n.LocationID)) as Location,
        u.FirstName,
        u.LastName,
        group_concat(distinct nr.RoleLevel) as RoleLevel,
        group_concat(distinct nr.RoleName) as RoleName,
        group_concat(distinct nr.RoleArea) as RoleArea,
        IFNULL(v.Views,0) as Views
     FROM note n
        LEFT JOIN note_locations nl ON n.ID = nl.NoteID
        LEFT JOIN note_roles nr on n.ID = nr.NoteID
        LEFT JOIN (
            SELECT NoteID, SUM(IFNULL(Viewed, 0)) as Views FROM note_view GROUP BY NoteID
        ) as v on n.ID = v.NoteID
        LEFT JOIN user u on u.ID = IFNULL(n.UserUpdated, n.UserCreated)
        LEFT JOIN user_role ur on ur.RoleLevel = nr.RoleLevel OR ur.RoleName  = nr.RoleName
        ${condition}
        GROUP BY n.ID
        ORDER BY n.DatePublish DESC, n.DateUpdated DESC;`;

    try {
        [results] = await ro_pool.query(sql,args);
        for (let result of results) {
            result.DatePublish = moment(result.DatePublish).format("YYYY-MM-DD");
        }

        res.status(200).json({"data": results});
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Error Retrieving notes"});
        return;
    }
};

// get just a particular note based on the note id that is being passed in the query parameter
exports.get_note = async function(req, res) {

    let noteResponse = {};
    let userObject, roleAssignmentAllowance, roleAllowedLocations, allowedLocations;
    let sql;
    let args = [];
    let results;
    let errMessage = null;
    let condition = "";

    let noteID = helper.trimVal(req.query.noteID) || null;
    if (!noteID) {
        errMessage = "must provide noteID";
        res.status(400).json({"message": errMessage});
        return;
    }

    try {
        userObject = authHelper.parseRole(req);
        roleAssignmentAllowance = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];
        roleAllowedLocations = (await apiRequest.get(req, "account_management/get_user_locations"))["data"];
        allowedLocations = roleAllowedLocations.locations.map(elem => { return elem.ID; });
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Error occured while performing permissions checks"});
        return;
    }
    args.push(noteID);
    if (!userObject.isAdmin) {
        condition = "AND n.UserCreated = ?";
        args.push(userObject.id);
    }
    sql = `
    SELECT
        n.*,
        group_concat(distinct nl.LocationID) as Location,
        u.FirstName,
        u.LastName,
        group_concat(distinct nr.RoleLevel) as RoleLevel,
        group_concat(distinct nr.RoleName) as RoleName,
        group_concat(distinct nr.RoleArea) as RoleArea
    FROM note n
    LEFT JOIN note_locations nl ON n.ID = nl.NoteID
    LEFT JOIN note_roles nr on n.ID = nr.NoteID
    LEFT JOIN user u on u.ID = IFNULL(n.UserUpdated, n.UserCreated)
    LEFT JOIN user_role ur on ur.RoleLevel = nr.RoleLevel OR ur.RoleName  = nr.RoleName
    WHERE n.ID = ?
    ${condition}`;

    try {
        [results] = await ro_pool.query(sql,args);
        let data = results[0];
        let locs, roles, groups;
        if (data.Location) {
            locs = data.Location.split(",");
        } else {
            locs = [];
        }
        if (data.RoleName) {
            roles = data.RoleName.split(",");
        } else {
            roles = [];
        }
        if (data.RoleLevel) {
            groups = data.RoleLevel.split(",");
        } else {
            groups = [];
        }

        let response = {
            ID: data.ID,
            Title: data.Title,
            Description: data.Description,
            Locations: locs,
            DatePublish: moment(data.DatePublish).format("YYYY-MM-DD"),
            DateCreated: data.DateCreated,
            UserCreated: data.UserCreated,
            UserUpdated: data.UserUpdated,
            FirstName: data.FirstName,
            LastName: data.LastName,
            MustRead: data.MustRead,
            Views: 0,
            Groups: groups,
            Roles: roles
        };


        res.status(200).json({"data": [response]});
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Problems Getting Note Data"});
        return;
    }

};

// list all notifications based on your roleName or roleLevel
exports.list_notifications = async function(req, res) {
    let sql, args, results;
    let user = authHelper.parseRole(req);

    let locationID = req.query.locationID;
    let days = parseInt(req.query.days, 10);
    /*********************************************************************
     *  The Following Query has several parts to get different notes.
     *
     *  First we want to get all notes that do not have a set location
     *  If a note does not have a set location then it targets all the
     *  Members of selected roles eg. All admins, all Team Members.
     *
     *  Then we want to get all the notifications that are targeted for
     *  the current location and get those if they roles match
     *
     *  We then order these by the date and then only select the latest
     *  number within the selected number of days
     ********************************************************************/

    let condition = "";
    if (days) {
        condition = ` AND DatePublish >= DATE(CONVERT_TZ(date_add(now(), interval -? day), 'UTC', l.Timezone))`;
    }

    sql = `
    SELECT
        n.ID,
        n.Title,
        n.DatePublish,
        n.Description,
        n.Link,
        n.Type,
        n.MustRead,
        IF(nv.Read is not null, true, false) as NoteRead
    FROM (
        Select n.* from note n
        LEFT JOIN note_locations nl on n.ID = nl.NoteID
        LEFT JOIN note_roles nr on n.ID = nr.NoteID
        INNER JOIN (
            SELECT * FROM
            user_roles u
            INNER JOIN user_role ur on ur.RoleName = u.UserRole
            WHERE u.UserID = ?
        ) as ur on ur.RoleName = nr.RoleName or ur.RoleLEvel = nr.RoleLevel
        WHERE nl.NoteID is null
        UNION
        Select n.* from note n
        LEFT JOIN note_locations nl on n.ID = nl.NoteID
        LEFT JOIN note_roles nr on n.ID = nr.NoteID
        INNER JOIN (
            SELECT * FROM
            user_roles u
            INNER JOIN user_role ur on ur.RoleName = u.UserRole
            WHERE u.UserID = ?
        ) as ur on (ur.RoleName = nr.RoleName or ur.RoleLevel = nr.RoleLevel) and nl.LocationID = ?
        WHERE nl.NoteID is not null
    ) as n
    LEFT JOIN location l on l.ID = ?
    LEFT JOIN note_view nv on nv.NoteID = n.ID and nv.UserID = ?
    WHERE DATE(CONVERT_TZ(NOW(), 'UTC', l.Timezone)) >= DatePublish
    ${condition}
    GROUP BY n.ID
    ORDER BY n.DatePublish DESC, n.DateUpdated DESC
    LIMIT 10
    ;`;
    if (days) {
        args = [user.id, user.id, locationID, locationID, user.id, days];
    } else {
        args = [user.id, user.id, locationID, locationID, user.id];
    }


    try {
        [results] = await ro_pool.query(sql,args);

    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Error Retreiving Notes"});
        return;
    }

    let count = 0;
    results.map(elem => {
        if (!elem.NoteRead) {
            count ++;
        }
        elem.DatePublish = moment(elem.DatePublish).format("L");
    });

    res.status(200).json({"data": results, "unread": count});
    return;

};

// update an exsiting notification
exports.update_note = async function(req, res) {
    let errMessage = null;
    let noteDetails = [];
    let noteRoleArgs = [];
    let responseBe = {};
    let noteID      = req.body.noteID || null;
    let title       = (helper.trimVal(req.body.title) != null) ? req.body.title : null;
    let description = (helper.trimVal(req.body.description) != null)  ? helper.trimVal(req.body.description) : null;
    let quantity    = req.body.quantity     || 0;
    let datePublish = (helper.trimVal(req.body.datePublish) != null)  ? helper.trimVal(req.body.datePublish) : null;
    let roleArea    = req.body.roleArea     || [];
    let roleLevel   = req.body.roleLevel    || [];
    let roleName    = req.body.roleName     || [];
    let locationID  = req.body.locationID   || [];
    let mustRead    = req.body.mustRead     || null;
    let today       = moment().utc();
    let roleAssignmentAllowance, roleAllowedLocations, allowedLocations, userObject;
    let sql, args, results;

    console.debug(datePublish);
    try {
        userObject = authHelper.parseRole(req);
        roleAssignmentAllowance = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];
        roleAllowedLocations = (await apiRequest.get(req, "account_management/get_user_locations"))["data"];
        allowedLocations = roleAllowedLocations.locations.map(elem => { return elem.ID; });
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Error occured while performing permissions checks"});
        return;
    }

    if (!noteID) {
        errMessage = "Request must include NoteID";
        res.status(400).json({"message": errMessage});
        return;
    }



    if (!datePublish) {
        errMessage = "DatePublish must be set";
        res.status(400).json({"message": errMessage});
        return;
    }

    try {
        noteDetails.push(title);
        noteDetails.push(description);
        noteDetails.push(quantity);
        noteDetails.push(datePublish);
        noteDetails.push(userObject.id);
        noteDetails.push(mustRead);
        noteDetails.push(noteID);
        // RoleArea, RoleLevel, RoleName,
        sql = `UPDATE note
               SET Title = ?,
               Description = ?,
               Quantity = ?,
               DatePublish = ?,
               UserUpdated = ?,
               mustRead = ?
               WHERE ID = ?`;
        args = noteDetails;
        console.debug(await pool.format(sql, args));
        [results] = await pool.query(sql,args);
        responseBe.noteID = noteID;
        args = [];
    } catch (err) {
        console.error(err);
        errMessage = " update failed";
        res.status(500).json({"message": errMessage});
        return;
    }

    try {

        // delete the existing ones. Upsert won't work here because -  we need to delete locations too when editing note
        sql = `
            DELETE nl from note_locations nl
            WHERE nl.NoteID = ?;
        `;
        args = [noteID];
        [results] = await pool.query(sql,args);
        args = [];
        for (let i in locationID) {
            let locArr = [];
            locArr.push(noteID);
            locArr.push(locationID[i]);
            args.push(locArr);
        }
        if (args.length > 0) {
            sql = `INSERT INTO note_locations (NoteID, LocationID) VALUES ?`;
            [results] = await pool.query(sql,[args]);
        }
    } catch (err) {
        console.log(err);
        errMessage = "update locations failed";
        res.status(500).json({"message": errMessage});
        return;
    }

    let allNoteRoleArgs = [];
    let roleLvlNameMpped2Area;
    args = [];


    try {
        if (roleLevel.length > 0) {
            // just to make sure that the roleLevel being passed in are infact correct values
            // and not garbage data
            sql = `
                SELECT DISTINCT RoleLevel from user_role ur
                WHERE ur.RoleLevel in (?);`;
            args = [roleLevel];
            [results] = await pool.query(sql, args);

            roleLvlNameMpped2Area = results;

            // running through the list of legit roleLevel
            for (let i in roleLvlNameMpped2Area) {
                let noteRoleArgs = [];
                noteRoleArgs.push(noteID);
                noteRoleArgs.push(roleLvlNameMpped2Area[i].RoleLevel);
                allNoteRoleArgs.push(noteRoleArgs);
            }
            sql = `
            DELETE nr FROM note_roles nr
            WHERE nr.NoteID = ?;
            INSERT INTO note_roles (NoteID,  RoleLevel) VALUES ?`;

        } else if (roleName.length > 0) {
            // just to make sure that the roleLevel being passed in are infact correct values
            // and not garbage data
            sql = `
                SELECT DISTINCT RoleName from user_role ur
                WHERE ur.RoleName in (?);`;
            args = [roleName];

            [results] = await pool.query(sql, args);

            roleLvlNameMpped2Area = results;


            // running through the list of legit roleName
            for (let i in roleLvlNameMpped2Area) {
                let noteRoleArgs = [];
                noteRoleArgs.push(noteID);
                noteRoleArgs.push(roleLvlNameMpped2Area[i].RoleName);
                allNoteRoleArgs.push(noteRoleArgs);
            }
            sql = `
            DELETE nr from note_roles nr
            WHERE nr.NoteID = ?;
            INSERT INTO note_roles (NoteID, roleName) VALUES ?`;
        }
        // roleName or roleLevel can be both empty, since it's an update
        if (roleName.length > 0 || roleLevel.length > 0) {
            args = [noteID, allNoteRoleArgs];
            [results] = await pool.query(sql,args);
        }
    } catch (err) {
        console.log(err);
        errMessage = "Error occured while fetching RoleArea";
        res.status(500).json({"message": errMessage });
        return;
    }
    res.status(200).json({"data": responseBe });
};

// mark particular note as viewed
exports.note_viewed = async function(req, res) {
    let NoteID = req.body.NoteID;
    let user = authHelper.parseRole(req);
    let sql, args;
    if (!NoteID) {
        res.status(400).json({"message": "NoteID and UserId are required"});
    }

    // First Time the Note is viewed it counts and read
    sql = `INSERT INTO note_view VALUES (?,?,1,1) ON DUPLICATE KEY UPDATE Viewed=Viewed + 1;`;
    args = [NoteID,user.id];
    try {
        await pool.query(sql,args);
        res.status(200).json({"message": "Views Updated"});
        return;
    } catch (err) {
        console.log(err);
        res.status(500).json({"message": "Unable to update views on notes"});
        return;
    }
};

// delete an existing note. RIP note
exports.delete_note = async function (req, res) {
    let errMessage = null;
    let userObject, sql, args;
    // calling all the api to get the roles etc.
    try {
        userObject = authHelper.parseRole(req);
    } catch (err) {
        console.log(err);
        res.status(400).json({"message": "Error occured while performing permissions checks"});
        return;
    }
    let noteID = helper.trimVal(req.query.noteID) || null;
    if (!noteID) {
        errMessage = "must provide noteID";
        res.status(400).json({"message": errMessage});
        return;
    }
    // dude can do whatever.
    if (userObject.isAdmin) {
        // delete from note_locations and then note
        // NOTE: Delete cascades to other notification tables due to foreign key
        sql = `
                DELETE FROM note n
                WHERE n.ID = ?;
            `;
        args = [noteID];
    } else if (userObject.isWmanager || userObject.isSmanager) {
        // managers can only delete their own notes
        // NOTE: Delete cascades to other notification tables due to foreign key
        sql = `
                DELETE FROM note n
                WHERE n.ID = ? AND n.UserCreated = ?;
            `;
        args = [noteID, userObject.id];
    } else {
        // anyone else should have no rights, whatsoever to delete notes
        errMessage = "Delete not permitted";
        res.status(400).json({"message": errMessage});
        return;
    }
    try {
        let [results] = await pool.query(sql, args);
        if (results.affectedRows === 0) {
            // this would be a restrictions violations
            errMessage = `Couldn't delete note or it doesn't exist`;
            res.status(400).json({"message": errMessage});
            return;
        }
        res.status(200).json({"message": `${noteID} has been deleted`});
    } catch (err) {
        console.log(err);
        errMessage = "An error occured while deleting the note";
        res.status(500).json({"message": errMessage});
        return;
    }
};

// gets audience
exports.get_note_audience_count = async function (req, res) {
    let groups = req.body.groups || [];
    let locations = req.body.locations || [];
    let sql, args, results, conditions;
    args = [];

    let roleMap = {
        "admin": 1,
        "rm": 2,
        "manager": 3,
        "associate": 4
    };

    if (!groups.length) {
        res.status(200).json({"message": "Selected roles(s) are required to Calculate Audience"});
        return;
    }

    if (!Array.isArray(groups)) {
        groups = [groups];
    }

    if (!Array.isArray(locations)) {
        locations = [locations];
    }

    conditions = [];

    for (let group of groups) {
        conditions.push(roleMap[group]);
    }

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
    if (locations.length) {
        sql = `
        WITH RECURSIVE tmp_loc_tree (ID, Name, ParentID) AS
        (
        SELECT h.ID, h.Name, h.ParentID
            FROM location_hierarchy h
            INNER JOIN location_hierarchy_locations loc on loc.LocationHierarchyID = h.ID
            WHERE loc.LocationID in (?)
        UNION ALL
        SELECT l.ID, l.Name, l.ParentID
            FROM tmp_loc_tree AS p JOIN location_hierarchy AS l
            ON p.ParentID = l.ID
        )
        SELECT COUNT(*) AS audience, GROUP_CONCAT(FullName) AS AudienceNames
        FROM (
            SELECT *
            FROM (
                SELECT u.ID, CONCAT(u.FirstName, ' ', u.LastName) AS FullName, IFNULL(min(ur.RoleLevel+0),20) as rLevel, u.DefaultLocation
                FROM tmp_loc_tree t
                INNER JOIN user u on u.RegionID = t.ID
                INNER JOIN user_roles urs ON urs.UserID = u.ID
                INNER JOIN user_role ur ON ur.RoleName = urs.UserRole
                WHERE u.IsDeleted IS FALSE
                GROUP BY u.ID
                HAVING rLevel = 2
                ORDER BY ParentID
            ) as rm
            UNION ALL
            SELECT *
            FROM
            (
                SELECT u.ID, CONCAT(u.FirstName, ' ', u.LastName) AS FullName, IFNULL(min(ur.RoleLevel+0),20) as rLevel, u.DefaultLocation
                FROM user u
                INNER JOIN user_roles urs ON urs.UserID = u.ID
                INNER JOIN user_role ur ON ur.RoleName = urs.UserRole
                WHERE u.IsDeleted IS FALSE
                GROUP BY u.ID
                HAVING (rLevel IN (3, 4) AND DefaultLocation in (?)) || rLevel = 1
                ORDER BY u.FirstName ASC, u.LastName ASC
            ) as tm
        ) as x
        WHERE rLevel in (?)`;
        args = [locations, locations, conditions];
    } else {
        sql = `
        SELECT COUNT(*) AS audience, GROUP_CONCAT(FullName) AS AudienceNames
        FROM (
            SELECT u.ID, CONCAT(u.FirstName, ' ', u.LastName) AS FullName, IFNULL(min(ur.RoleLevel+0),20) as rLevel, u.DefaultLocation
            FROM user u
            INNER JOIN user_roles urs ON urs.UserID = u.ID
            INNER JOIN user_role ur ON ur.RoleName = urs.UserRole
            WHERE u.IsDeleted IS FALSE
            GROUP BY u.ID
            HAVING rLevel IN (?)
            ORDER BY u.FirstName ASC, u.LastName ASC
        ) AS u`;
        args = [conditions];
    }

    try {
        [results] = await ro_pool.query(sql, args);
        if (locations.length) {
            res.status(200).json({"message": `Based on your targeting criteria, your message will reach up to ${results[0].audience} users`, "audience": results[0].AudienceNames});
        } else {
            res.status(200).json({"message": `Based on your targeting criteria, your message will reach ${results[0].audience} users`, "audience": results[0].AudienceNames});
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": error});
        return;
    }
};

// get user options
exports.get_note_options = async function (req, res) {
    let userObject = authHelper.parseRole(req);
    let permittedLevels;

    if (userObject.isAdmin) {
        permittedLevels = ["admin", "associate", "manager"];
    } else if (userObject.isSmanager || userObject.isWmanager) {
        permittedLevels = ["associate", "manager"];
    } else {
        res.status(403).json({"message": "You need to be a manager or admin to do this request"});
        return;
    }

    try {
        let roles = (await apiRequest.get(req, "account_management/get_available_roles"))["data"];
        let groups = permittedLevels;
        let availablelocations = (await apiRequest.get(req, "account_management/get_user_locations"))["data"];
        let locations = [availablelocations.defaultLocation];
        for (let loc of availablelocations.locations) {
            if (!locations.includes(loc.ID)) {
                locations.push(loc.ID);
            }
        }
        const data = {
            groups: groups,
            roles: roles,
            locations: locations
        };

        res.status(200).json({"data": data});
        return;
    } catch (err) {
        console.log(err);
        let errMessage = "Error while fetching user options";
        res.status(500).json({"message": errMessage});
        return;
    }
};

exports.cron_update_notifications = async function (req, res) {
    let results;

    try {
        [results] = await pool.query("SELECT Type, IntervalMinutes FROM note_task_schedule WHERE DateNextRun <= NOW()");
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in cron_update_notifications"});
    }

    let sql = "";
    let args = [];
    let typesToUpdate = [];

    for (let row of results) {
        let type = row["Type"];
        let intervalMinutes = row["IntervalMinutes"];

        // Calculate the next time that this task should be checked
        let dateNextRun = moment().add(intervalMinutes, "minutes").utc().format("YYYY-MM-DD HH:mm:ss");

        sql += "UPDATE note_task_schedule SET DateNextRun = ? WHERE Type = ?;";
        args.push(dateNextRun, type);
        typesToUpdate.push(type);
    }

    if (args.length === 0) {
        res.status(200).json({"message": "There are no notification tasks to check for updates at this current time"});
        return;
    }

    // Update the column DateNextRun in note_task_schedule, settting the date(s) to the next time they should run
    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in cron_update_notifications"});
    }

    // No need to await here since we don't care about the responses
    try {
        apiRequest.get(req, "update_task_notifications", {"type": typesToUpdate.join(",")});
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "cron_update_notifications Error: Unable to complete update_task_notifications"});
    }

    res.status(200).send();
};

exports.update_task_notifications = async function (req, res) {
    let types = helper.trimVal(req.body.type) || null; // CSV of types

    if (!types) {
        res.status(400).json({"message": "The type of the task must be specified"});
        return;
    }

    types = types.split(","); // Transform the CSV into an array so that we can easily check every type that was passed in

    if (types.includes("Pick")) {
        return; // We're only testing Wall2Wall for now. This return statement will be removed at a later time after it's completed
        // eslint-disable-next-line no-unreachable
        let title = `Task: Pick`;
        let link = "/picktasks";
        let type = "Pick";
        let area = "WRH";
        let noteId, locationId, previousQuantity, currentQuantity, results;

        let sql = `
            # Query 1: Get all existing notifications for this task type
            SELECT ID, LocationID, Quantity FROM note WHERE Type = 'Pick'
            ;
            # Query 2: Get the quantity of all existing picks right now
            TODO`;

        try {
            [results] = await pool.query(sql);
        } catch (error) {
            logger.error("update_task_notifications for Pick", {error});
            res.status(500).json({"message": "There was an error updating the notifications"});
            return;
        }

        // Compare the existing notifications with the existing tasks
        for (let row of results) {
            let noteObj = {
                "noteId": row["NoteID"],
                "title": title,
                "link": link,
                "locationId": row["LocationID"],
                "type": type,
                "previousQuantity": row["PreviousQuantity"],
                "currentQuantity": row["CurrentQuantity"],
                "area": area
            };

            manage_task_notification(req, noteObj);
        }
    }

    if (types.includes("Wall2Wall")) {
        let results;
        let sql = `
            SELECT
                LocationID,
                NoteID,
                IFNULL(MAX(PreviousQuantity), 0) AS PreviousQuantity,
                IFNULL(MAX(CurrentQuantity), 0) AS CurrentQuantity
            FROM (
                SELECT nl.LocationID, Quantity AS PreviousQuantity, NULL AS CurrentQuantity, ID AS NoteID
                FROM note n
                INNER JOIN note_locations nl on nl.NoteID = n.ID
                WHERE Type = 'Wall2Wall'
                UNION
                SELECT ID AS LocationID, NULL AS PreviousQuantity, isInventoryCounted AS CurrentQuantity, NULL AS NoteID
                FROM location
                WHERE isInventoryCounted = 1
            ) AS t
            GROUP BY LocationID`;

        try {
            [results] = await pool.query(sql);
        } catch (error) {
            logger.error("update_task_notifications for Wall2Wall", {error});
            res.status(500).json({"message": "There was an error updating the notifications"});
            return;
        }

        for (let row of results) {
            let noteObj = {
                "noteId": row["NoteID"],
                "title": `Wall-to-wall stock take is now open at ${row["LocationID"]}. Click here to start!`,
                "link": "/store/wall-to-wall-inventory",
                "locationId": row["LocationID"],
                "type": "Wall2Wall",
                "previousQuantity": row["PreviousQuantity"],
                "currentQuantity": row["CurrentQuantity"],
                "area": "STR"
            };

            manage_task_notification(req, noteObj);
        }
    }

    if (types.includes("Inventory")) {
        // Generate these notes early in the morning using the existing cron job
        let resultsStore, resultsWarehouse;
        // The first query is to get store information. Second query is for warehouse
        let sql = `
            SELECT
                LocationID,
                NoteID,
                IFNULL(MAX(PreviousQuantity), 0) AS PreviousQuantity,
                IFNULL(MAX(CurrentQuantity), 0) AS CurrentQuantity
            FROM (
                SELECT nl.LocationID, n.Quantity AS PreviousQuantity, NULL AS CurrentQuantity, n.ID AS NoteID
                FROM note n
                INNER JOIN note_locations nl on nl.NoteID = n.ID
                INNER JOIN container c ON c.ID = nl.LocationID
                WHERE n.Type = 'Inventory' AND c.Type = 'STR'
                UNION
                SELECT tg.SourceLocation AS LocationID, NULL AS PreviousQuantity, COUNT(*) AS CurrentQuantity, NULL AS NoteID
                FROM task_group tg
                INNER JOIN task t ON t.TaskGroupID = tg.ID
                INNER JOIN container c ON c.ID = tg.SourceLocation
                WHERE tg.Type = 'Inventory' AND t.DateCompleted IS NULL AND c.Type = 'STR'
                GROUP BY tg.SourceLocation
            ) AS t
            GROUP BY LocationID
            ;
            SELECT
                LocationID,
                NoteID,
                IFNULL(MAX(PreviousQuantity), 0) AS PreviousQuantity,
                IFNULL(MAX(CurrentQuantity), 0) AS CurrentQuantity
            FROM (
                SELECT nl.LocationID, n.Quantity AS PreviousQuantity, NULL AS CurrentQuantity, n.ID AS NoteID
                FROM note n
                INNER JOIN note_locations nl on nl.NoteID = n.ID
                INNER JOIN container c ON c.ID = nl.LocationID
                WHERE n.Type = 'Inventory' AND c.Type = 'WRH'
                UNION
                SELECT tg.SourceLocation AS LocationID, NULL AS PreviousQuantity, COUNT(*) AS CurrentQuantity, NULL AS NoteID
                FROM task_group tg
                INNER JOIN task t ON t.TaskGroupID = tg.ID
                INNER JOIN container c ON c.ID = tg.SourceLocation
                WHERE tg.Type = 'Inventory' AND t.DateCompleted IS NULL AND c.Type = 'WRH'
                GROUP BY tg.SourceLocation
            ) AS t
            GROUP BY LocationID`;

        try {
            let [results] = await pool.query(sql);
            resultsStore = results[0];
            resultsWarehouse = results[1];
        } catch (error) {
            logger.error("update_task_notifications for Inventory", {error});
            res.status(500).json({"message": "There was an error updating the notifications"});
            return;
        }

        // Example of results. A note will be created for LYN2-STR, deleted for BUR1-STR, and updated for TOT1-STR
        // LocationID | NoteID |  PreviousQuantity | CurrentQuantity
        // LYN2-STR   | NULL   |  0                | 57
        // BUR1-STR   | 101    |  17               | 0
        // TOT1-STR   | 102    |  23               | 10
        for (let row of resultsStore) {
            let noteObj = {
                "noteId": row["NoteID"],
                "title": `There are ${row["CurrentQuantity"]} Inventory tasks`,
                "link": "/store/store-inventory-tasks",
                "locationId": row["LocationID"],
                "type": "Inventory",
                "previousQuantity": row["PreviousQuantity"],
                "currentQuantity": row["CurrentQuantity"],
                "area": "STR"
            };

            manage_task_notification(req, noteObj);
        }

        // Example of results. A note will be created for LYN1-WRH
        // LocationID | NoteID |  PreviousQuantity | CurrentQuantity
        // LYN1-WRH   | NULL   |  0                | 6
        for (let row of resultsWarehouse) {
            let noteObj = {
                "noteId": row["NoteID"],
                "title": `There are ${row["CurrentQuantity"]} Inventory tasks`,
                "link": "/wms/inventory-tasks-list",
                "locationId": row["LocationID"],
                "type": "Inventory",
                "previousQuantity": row["PreviousQuantity"],
                "currentQuantity": row["CurrentQuantity"],
                "area": "WRH"
            };

            manage_task_notification(req, noteObj);
        }
    }

    if (types.includes("Reprice")) {
        let results;
        let sql = `
            SELECT
                LocationID,
                NoteID,
                IFNULL(MAX(PreviousQuantity), 0) AS PreviousQuantity,
                IFNULL(MAX(CurrentQuantity), 0) AS CurrentQuantity
            FROM (
                SELECT LocationID, Quantity AS PreviousQuantity, NULL AS CurrentQuantity, ID AS NoteID
                FROM note
                WHERE Type = 'Reprice'
                UNION
                SELECT t.TargetContainer AS LocationID, NULL AS PreviousQuantity, COUNT(*) AS CurrentQuantity, NULL AS NoteID
                FROM task_group tg
                INNER JOIN task t ON t.TaskGroupID = tg.ID
                WHERE tg.Type = 'Reprice' AND t.DateCompleted IS NULL
                GROUP BY t.TargetContainer
            ) AS t
            GROUP BY LocationID`;

        try {
            [results] = await pool.query(sql);
        } catch (error) {
            logger.error("update_task_notifications for Reprice", {error});
            res.status(500).json({"message": "There was an error updating the notifications"});
            return;
        }

        // Example of results. A note will be created for LYN2-STR, deleted for BUR1-STR, and updated for TOT1-STR
        // LocationID | NoteID |  PreviousQuantity | CurrentQuantity
        // LYN2-STR   | NULL   |  0                | 10
        // BUR1-STR   | 101    |  25               | 0
        // TOT1-STR   | 102    |  16               | 8
        for (let row of results) {
            let noteObj = {
                "noteId": row["NoteID"],
                "title": `There are ${row["CurrentQuantity"]} Keycodes that need to be Repriced`,
                "link": "/store/reprice-tasks",
                "locationId": row["LocationID"],
                "type": "Reprice",
                "previousQuantity": row["PreviousQuantity"],
                "currentQuantity": row["CurrentQuantity"],
                "area": "STR"
            };

            manage_task_notification(req, noteObj);
        }
    }

    if (types.includes("Cleanup")) {
        // Delete any notes that are more than 14 days past their Publish Date. This will be a daily task
        try {
            await pool.query(`DELETE FROM note WHERE DatePublish < NOW() - INTERVAL 14 DAY`);
        } catch (error) {
            logger.error("update_task_notifications for Cleanup", {error});
            res.status(500).json({"message": "There was an error deleting the notifications"});
            return;
        }
    }

    res.status(200).json({"message": "Type notifications have been updated"});
};

async function manage_task_notification(req, noteObj) {
    let noteId = noteObj["noteId"];
    let title = noteObj["title"];
    let link = noteObj["link"];
    let locationId = noteObj["locationId"];
    let type = noteObj["type"];
    let previousQuantity = noteObj["previousQuantity"];
    let currentQuantity = noteObj["currentQuantity"];
    let area = noteObj["area"];
    let action;

    if (currentQuantity === 0 && noteId) {
        action = "DELETE"; // We must delete the note if it exists, but has no quantity
    } else if (currentQuantity > 0 && !noteId) {
        action = "CREATE"; // We must create a new note if it doesn't exist, and has quantity
    } else if (currentQuantity !== previousQuantity) {
        action = "UPDATE"; // If we aren't creating or deleting, then we're updating
    } else {
        return;
    }

    console.log(`${action} notification: Changing quantity from ${previousQuantity} to ${currentQuantity}`);

    if (action === "DELETE") {
        try {
            await apiRequest.delete(req, "note", {"noteID": noteId});
        } catch (error) {
            logger.error("manage_task_notification for DELETE", {error});
        }
    } else if (action === "CREATE") {
        // Create the note if it doesn't exist and needs to be created
        let data = {
            "title": title,
            "locationID": [locationId],
            "quantity": currentQuantity,
            "datePublish": moment().format(),
            "type": type,
            "link": link,
            "roleLevel": ["admin", "manager", "associate"],
            "roleArea": [area]
        };

        try {
            await apiRequest.post(req, "note", data);
        } catch (error) {
            logger.error("manage_task_notification for CREATE", {error});
        }
    } else if (action === "UPDATE") {
        // Update the note if it already exists and needs to be updated
        let title = `Task: ${type}`;
        let data = {
            "noteID": noteId,
            "title": title,
            "locationID": [locationId],
            "quantity": currentQuantity,
            "datePublish": moment().format()
        };

        try {
            await apiRequest.put(req, "note", data);
        } catch (error) {
            logger.error("manage_task_notification for UPDATE", {error});
        }
    }
}
