/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

/* Usage examples for role authentication in routes:
 * router.post("/my-route",                              MyMethod); // Public
 * router.post("/my-route", Auth(),                      MyMethod); // Anybody can call this API as long as they are logged in
 * router.post("/my-route", Auth(["admin"]),             MyMethod); // This is only available to admins
 * router.post("/my-route", Auth([]),                    MyMethod); // This isn't available to anybody (except admins), so it's the same as above
 * router.post("/my-route", Auth(["store_manager"]),     MyMethod); // This is only available to "store_manager" (and admins)
 * router.post("/my-route", Auth(["role1", "role5"]),    MyMethod); // This is only available to "role1" OR "role5" (and admins)
 *
 * Never explicity include the "admin" role when at least one other role is included
 * GOOD: Auth(["s_manager", "w_manager"])
 * BAD : Auth(["admin", "s_manager", "w_manager"])
 * GOOD: Auth(["admin"])
 * BAD : Auth([])
 */


const jwt = require("jsonwebtoken");
const expressJwt = require("express-jwt");
const unless = require("express-unless");
const logging = require("../library/logging");
const apiRequest = require("../library/apiRequest");
const ProxyAPIRequester = require("../library/proxyAPIRequest");
const logger = require("./logger")("library:auth");

function GenerateRandomDeviceToken() {return new Promise((done, fail) => {
    // The device token will have a length of 64
    let length = 64;
    let bytes  = length * 3 / 4;

    require("crypto").randomBytes(bytes, function(err, buffer) {
        done(buffer.toString("base64"));
    });
});}

async function _SaveLastLogin(UserID) {
    let sql = `Update user SET AccountLastLoggedIn = NOW() WHERE ID = ?`;

    try {
        await pool.query(sql, [UserID]);
    } catch (error) {
        logger.error("_SaveLastLogin:", {error});
    }
}

function ValidatePassword(password, passwordHash) {
    return new Promise((done, fail) => {
        require("bcryptjs").compare(password, passwordHash).then((result) => {
            if (result) {
                done(true);
            } else {
                done(false);
            }
        });
    });
}

async function CreateUserSSO(ssoData, deviceLocation) {
    // Example of the object ssoData
    // StoreID             : "HO",
    // DeptName            : "TM",
    // EMPB_Code           : "F",
    // Employee_No         : "00027450",
    // RSRC_LAST_NAME      : "KALSAN",
    // RSRC_FIRST_NAME     : "VIKRAM",
    // Work_Email          : "VIKRAM.KALSAN@KMART.COM.AU",
    // Login_PSWD          : "",
    // Flag_PSWD_Reset     : false,
    // Flag_Acct_Locked    : false,
    // PSWD_Expiry_DateTime: null
    const table = [
        // Used to generate random barcodes for logging in, length is 64
        "A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
        "a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z",
        "0","1","2","3","4","5","6","7","8","9","-","_"
    ];

    // Generate a random loginBarcode for the new SSO user
    let loginBarcode = "";
    while (loginBarcode.length < 13) {
        let i = Math.floor(Math.random() * Math.floor(table.length)); // 0 - 63
        loginBarcode += table[i];
    }

    let roles = [];
    let userRolesArgs = [];
    let result, insertId, defaultLocation;

    if (deviceLocation) {
        // If the deviceLocation is provided, then we will use that
        defaultLocation = deviceLocation;
    } else if (!isNaN(ssoData.StoreID)) {
        // If the deviceLocation is NOT provided, then the "StoreID" MUST be a valid number, and that will be used
        defaultLocation = `${ssoData.StoreID}-STR`;
    } else {
        // Otherwise this will fail since there's no valid location provided
        return {
            status: "FAIL",
            message: "Unable to determine a valid location"
        };
    }

    // There are currently two different types of SSO users, "Managers" and "TM" (Team Members)
    if (ssoData.DeptName === "Managers") {
        roles.push("s_manager");
    } else if (ssoData.DeptName === "TM") {
        roles.push("s_basicaccess", "s_bulkstow", "s_inventorycount");
    } else {
        // Otherwise this will fail since there's no valid "DeptName" to determine their role
        return {
            status: "FAIL",
            message: "Unable to determine the user's role"
        };
    }

    let sql = `
        INSERT INTO user (
            Username,
            LoginBarcode,
            FirstName,
            LastName,
            Email,
            DefaultLocation,
            isSSO
        ) VALUES (?)`;
    let args = [[
        ssoData.Employee_No,     // Username is the employee ID number
        loginBarcode,            // LoginBarcode
        ssoData.RSRC_FIRST_NAME, // FirstName
        ssoData.RSRC_LAST_NAME , // LastName
        ssoData.Work_Email,      // Email
        defaultLocation,         // DefaultLocation
        1                        // isSSO flag is enabled/true
    ]];

    try {
        result = await pool.query(sql, args);
        insertId = result[0]["insertId"];
    } catch (error) {
        // If there was an SQL error, log it and return a friendly fail error to the user
        logger.error("auth.js - Authenticated an SSO user, but SQL error in creating the user:", {error});

        return {
            status: "FAIL",
            message: "A new SSO user was authenticated, but failed to be created"
        };
    }

    // Insert the role for the SSO user into the user_roles table
    sql  = "INSERT INTO user_roles (UserID, UserRole, AddedBy) VALUES ?";

    for (let role of roles) {
        userRolesArgs.push([
            insertId, // UserID
            role,     // UserRole
            0         // AddedBy (0 = system)
        ]);
    }

    try {
        await pool.query(sql, [userRolesArgs]);
    } catch (error) {
        // If there was an SQL error, log it and return a friendly fail error to the user
        logger.error("auth.js - Authenticated an SSO user, but SQL error in giving roles:", {error});

        return {
            status: "FAIL",
            message: "A new SSO user was authenticated, but failed to be created"
        };
    }

    return {
        status: "OK",
        userId: insertId,
        roles: [roles]
    };
}

async function LoginWithBasic(basic, deviceToken, deviceLocation) {
    /* Sample variables:
     * basic    | Basic Sm9obkRvZTpNeVNlY3JldDEyMw==
     * base64   | Sm9obkRvZTpNeVNlY3JldDEyMw==
     * userInfo | JohnDoe:MySecret123
     */
    let base64   = basic.split("Basic ");
    if (base64.length !== 2) {
        // Token failed to parse
        return {"status": "Error", "message": "Login failed to parse Token"};
    }
    let userInfo = Buffer.from(base64[1], "base64").toString("utf-8");
    let ssoData  = null;
    let userId, name, passwordHash, roles, defaultLocation;
    let result, sql;

    /* The username WILL NOT contain a semicolon, so it can be determined by getting split(":")[0]
     * The password is everything after the username
     *
     * Sample variables:
     * username | JohnDoe
     * password | MySecret123
     */
    let username = userInfo.split(":")[0];
    let password = userInfo.split(":").slice(1, userInfo.split(":").length).join(":");

    if (!username || !password) {
        logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
        return {"status": "Error", "message": "You provided an invalid Employee Number/password combination"};
    }

    /* First check to see if this is an SSO user. Kmart's authentication has a bug in it which completely disregards leading zeroes.
     * This means that if the user tries to login with "033102", but Kmart's API has the employee number as "00033102", the SSO
     * authentication will still be successful. We need to then set the current "username" variable to the whatever
     * the SSO reported as the Employee_No. This is to prevent any username mismatches, and to allow users flexibility
     * in entering their usernames if there are any leading zeroes
     */
    if (!isNaN(username)) {
        // The user is attempting to login to an SSO account that may or may not exist (create account if not exists)
        // If the username is a number, then the login attempt MUST be a Kmart SSO account
        try {
            // Part A: Uncomment part A, and comment part B to test on your local machine
            // let url = "https://kmart-dev.anko.com/api/CALL_FROM_Kmart_Endpoint";
            // let body = `httpMethod=GET&url=kwpsta302.core.kmtltd.net.au%3A33380%2Fapi%2FLogin%2FAuthenticateLogin%3Femployeeno%3D${username}%26login_pswd%3D${password}&endpointType=STORE`;
            // let options = {
            //     headers: {
            //         accept: "application/json",
            //         authorization: "Basic bGVpZi5jb2xlbWFuOmE=",
            //         "content-type": "application/x-www-form-urlencoded"
            //     }
            // };
            // let response = await axios.post(url, body, options);

            // Part B: Uncomment part B, and comment part A when deploying the our environments
            let kmartAuthenticationApi = `${config.kmart_auth_host}/api/Login/AuthenticateLogin`;
            let options = {
                "params": {
                    "employeeno": username,
                    "login_pswd": password
                }
            };
            let response = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.GET, ProxyAPIRequester.ENDPOINT_TYPE.STORE, kmartAuthenticationApi, options);

            if (response.status === 200) {
                /* Example response data from Kmart's API:
                 * {
                 *   StoreID             : "HO",
                 *   DeptName            : "TM",
                 *   EMPB_Code           : "F",
                 *   Employee_No         : "00027450",
                 *   RSRC_LAST_NAME      : "KALSAN",
                 *   RSRC_FIRST_NAME     : "VIKRAM",
                 *   Work_Email          : "VIKRAM.KALSAN@KMART.COM.AU",
                 *   Login_PSWD          : "",
                 *   Flag_PSWD_Reset     : false,
                 *   Flag_Acct_Locked    : false,
                 *   PSWD_Expiry_DateTime: null
                 * }
                 */
                ssoData = response.data;

                // Note: If we're testing through ProxyAPIRequester.CallAPI() then ssoData will be wrapped around another response.data
                if ("response" in ssoData) {
                    ssoData = ssoData.response.data;
                }

                // Remember that Kmart's SSO authentication ignores leading zeroes, which means it's possible for the user to login
                // with the wrong username. Update the username variable to Employee_No in order to ensure the username is correct
                username = ssoData.Employee_No;
            }
        } catch (error) {
            // The Kmart SSO Authentication API either failed, or was unreachable. Respond to the UI with a generic error
            logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
            logger.error("auth.js - An unexpected error occurred when attempting to login to an SSO account. This likely failed to reach the Kmart SSO API:", {error});
            return {"status": "Error", "message": "You provided an invalid Employee Number/password combination"};
        }
    }

    sql = `
        SELECT
            u.ID,
            u.Username,
            u.PasswordHash,
            u.DefaultLocation,
            u.IsDeleted,
            u.isSSO,
            ur.UserRole
        FROM user u
        INNER JOIN user_roles ur ON ur.UserID = u.ID
        WHERE Username = ?`;

    try {
        [result] = await ro_pool.query(sql, [username]);
    } catch (error) {
        logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
        logger.error("auth.js - Error in SQL query:", {error});
        return {"status": "Error", "message": "Error occured, unable to authenticate."};
    }

    if (result.length === 0) {
        // The user wasn't found in the database, but if they were successfully authenticated via
        // Kmart's SSO API (the ssoData variable isn't null) then an account will be created for them

        if (ssoData) {
            // Create a new SSO user since they were successfully authenticated earlier. Even though "StoreID"
            // exists in the response from the Kmart API, not all users will have this populated so it
            // isn't reliable. Instead, the default location will be based on the Device Location by the UI
            let data;

            try {
                data = await CreateUserSSO(ssoData, deviceLocation);
            } catch (error) {
                logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
                logger.error("auth.js - Thrown error from CreateUserSSO():", {error});
                return {"status": "Error", "message": "Error occured. Unable to create an SSO account."};
            }

            // CreateUserSSO will return with an object that contains a "status" property letting us know if the
            // user creation was successful or not. If the "status" is "FAIL", then it will provide a "reason" why
            if (data.status === "FAIL") {
                logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
                return {"status": "Error", "message": data.reason};
            }

            userId          = data.userId;
            name            = username;
            passwordHash    = "";
            defaultLocation = deviceLocation;
            roles           = data.roles;
        } else {
            // A non-SSO user tried to login to an account that didn't exist
            logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
            return {"status": "Error", "message": "You provided an invalid Employee Number/password combination"};
        }
    } else {
        // A user was found for the username that is attempting to be logged into
        // Don't allow the user to login if their account has been disabled. However, SSO accounts can still login
        if (result[0]["IsDeleted"]) {
            // Have SSO accounts become re-enabled
            if (result[0]["isSSO"]) {
                await pool.query(`UPDATE user SET IsDeleted = 0 WHERE Username = ?`, [username]);
            } else {
                logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", {deviceLocation});
                return {"status": "Error", "message": "This account has been disabled"};
            }
        }

        userId          = result[0]["ID"];
        name            = result[0]["Username"];
        passwordHash    = result[0]["PasswordHash"];
        defaultLocation = result[0]["DefaultLocation"];
        roles           = [];

        for (let i of result) {
            roles.push(i.UserRole);
        }

        // Validate the password for regular (non-SSO) accounts
        if (!ssoData) {
            if (!await ValidatePassword(password, passwordHash)) {
                logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", deviceLocation, ", defaultLocation:", {defaultLocation});
                return {"status": "Error", "message": "You provided an invalid Employee Number/password combination"};
            }
        }
    }

    // Verify that the device token is valid
    deviceToken = await CheckDeviceToken(roles, deviceToken);
    if (!deviceToken) {
        // Keep the error message generic enough
        logger.info("LOGIN FAILED - username:", username, ", deviceLocation:", deviceLocation, ", defaultLocation:", {defaultLocation});
        return {"status": "Error", "message": "Login Failed. Please provide correct credentials or contact administrator."};
    }

    let token = jwt.sign({
        "id"  : userId,
        "name": name,
        "role": roles
    }, config.jwt_secret,
    { expiresIn: "10h"}); // 24h = expires in 24 hours, 60 = 1 minute

    try {
        await _SaveLastLogin(userId);
    } catch (error) {
        logger.error("LoginWithBasic:", {error});
    }

    return {"status": "OK", "userId": userId, "message": token, "deviceToken": deviceToken, "defaultLocation": defaultLocation};
}

async function LoginWithPIN(pin, deviceToken) {
    logging.log_info("LoginWithPIN. PIN:  " +  pin + ", deviceToken: " + deviceToken);

    let result;
    let sql = `
        SELECT u.ID, Username, IsDeleted, ur.UserRole, DefaultLocation FROM user u
        INNER JOIN user_roles ur ON ur.UserID = u.ID
        WHERE LoginBarcode = ?;`;

    try {
        [result] = await ro_pool.query(sql, [pin]);
    } catch (error) {
        logger.info("LOGIN FAILED - pin:", {pin});
        logger.error("auth.js - Error in SQL query:", {error});
        return {"status": "Error", "message": "Error occured. Unable to log in."};
    }

    // The PIN wasn't found in the database
    if (result.length == 0) {
        logger.info("LOGIN FAILED - pin:", {pin});
        return {"status": "Error", "message": "Invalid PIN"};
    }

    // The user's account has been disabled
    if (result[0]["IsDeleted"]) {
        logger.info("LOGIN FAILED - pin:", {pin});
        return {"status": "Error", "message": "Error occured. Unable to log in."}; // Give a generic error for better security
    }

    let userId = result[0]["ID"];
    let name   = result[0]["Username"];
    let roles  = [];

    for (let i of result) {
        // Do not allow admins to login with their PINs; they must use their username/password combination instead
        if (i.UserRole == "admin") {
            logger.info("LOGIN FAILED - pin:", pin, ", userId:", userId, ", name:", {name});
            return {"status": "Error", "message": "Error occured. Unable to log in."}; // Give a generic error for better security
        }
        roles.push(i.UserRole);
    }

    deviceToken = await CheckDeviceToken(roles, deviceToken);
    if (!deviceToken) {
        logger.info("LOGIN FAILED - pin:", pin, ", userId:", userId, ", name:", {name});
        return {"status": "Error", "message": "A manager or administrator must login to this device before associates are allowed to."};
    }

    let token = jwt.sign({
        "id"  : userId,
        "name": name,
        "role": roles
    }, config.jwt_secret);

    try {
        await _SaveLastLogin(userId);
    } catch (error) {
        logger.error("LoginWithBasic:", {error});
    }

    return {"status": "OK", "userId": userId, "message": token, "deviceToken": deviceToken, "defaultLocation": result[0]["DefaultLocation"]};
}

async function CheckDeviceToken(roles, deviceToken) {
    /* The Device Token feature is temporarily disabled and will now automatically allow users to login without forcing a manager/admin to login first
     *
     * According to Jira Ticket: ANKO-1045
     * - We have a feature where we only allow the token login if a manager or admin login on the device first.
     *   This is needed for us because we're on a public internet, but not for Kmart that's on an internal network.
     *   For now, let's turn it off and deploy quickly. Ideally we need to make this conditional per account,
     *   so it applies to Anko WMS, but not to Kmart */
    return "1";

    /* Get the roles associated with the user. If they are NOT an admin or manager,
     * it will be required to check if the deviceToken exists in the database.
     * If they user is an admin or manager, create a deviceToken and pass it to the client
     * If the user is a guest, they may login regardless of deviceToken
     */

    const managerRoles = ["admin", "s_manager", "w_manager", "s_region_manager"];
    const isManager = roles.some(r => managerRoles.includes(r));

    // A guest must only one role, "guest"
    const guestRoles = "guest";
    const isGuest = roles[0] === guestRoles && roles.length === 1;

    let result;
    if (isManager) {
        // Check if the token exists. If it doesn't create it
        try {
            [result] = await pool.query("SELECT * FROM device WHERE Token = ?", [deviceToken]);

            if (result.length) {
                return deviceToken;
            } else {
                // Create a new token
                let newDeviceToken = await GenerateRandomDeviceToken();
                let sql  = "INSERT INTO device (Token, CreatedBy, IPAddress, UserAgent, ExpirationDate) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))";
                var args = [
                    newDeviceToken, // Token
                    null,           // TODO: CreatedBy
                    null,           // TODO: IPAddress
                    null            // TODO: UserAgent
                ];

                await pool.query(sql, args);
                return newDeviceToken;
            }
        } catch (error) {
            logger.info("CheckDeviceToken ERROR:", {error});
            return false;
        }
    } else if (isGuest) {
        // Guest users may log in regardless of their device token
        return deviceToken;
    } else {
        if (!deviceToken) {
            return false;
        }

        try {
            [result] = await pool.query("SELECT * FROM device WHERE Token = ?", [deviceToken]);
        } catch (error) {
            logger.info("CheckDeviceToken ERROR:", {error});
        }

        if (result.length) {
            return deviceToken;
        } else {
            return false;
        }
    }
}

async function GetJsonWebToken(req, res, next) {
    let token = req.headers.authorization || "";
    // Adding a special override so that we can pass auth token in the url, needed for downloadable files (csv):
    if (token == "" && req.query && req.query.token != null) {
        req.headers.authorization = "Bearer " + req.query.token;
        next();
        return;
    }

    if (req.headers["system-token"] == config.system_token) {
        next();
        return;
    }

    /* Using a JSON Web Token is the typical way for users to make
     * requests to the server. The only exception is when they login
     */
    if (token.substring(0, 6) == "Bearer") {
        next();
        return;
    }

    /* Check if the user sent us an API Key instead of a JWT. If they
     * sent us an API Key, check that it exists and set "token" to be
     * a proper JWT assuming that the API Key is valid. If the API Key
     * is invalid, then the server will respond with "Invalid API Key"
     */
    if (token.substring(0, 7) == "api-key") {
        if (token == config.system_token) {
            /* Create an array of roles from the header's user-role string, and give
             * the user temporary admin permission if they don't have it already
             */
            let roleArray = ["admin"];
            // let roleArray = req.headers["user-role"].split(", ");
            // if(roleArray.indexOf("admin") == -1)
            //     roleArray.push("admin");

            token = "Bearer " + jwt.sign({
                "id"  : "0",
                "name": "system",
                "role": roleArray
            }, config.jwt_secret);

            req.headers.authorization = token;
            next();
            return;
        } else {
            return res.status(403).json({"message": "Bad API Key"});
        }
    }

    /* The only time Basic username/password credentials will
     * be used is when you're using the Swagger interface
     */
    if (token.substring(0, 5) == "Basic") {
        var response = await LoginWithBasic(token);

        if (response.status == "OK") {
            req.headers.authorization = `Bearer ${response.message}`;
            next();
            return;
        } else {
            return res.status(403).json({"message": response.message});
        }
    }

    return res.status(403).json({"message": "Bad authentication method"});
}

async function CheckRoles(req, res, next) {
    if (req.headers["system-token"] == config.system_token) {
        next();
        return;
    }
    let roles = this.roles;
    let userRoles = req.user.role;
    let authenticated = false;
    // If there are no role requirements, then allow the user to perform the API call
    if (roles == null) {
        authenticated = true;
    }
    // If the user is an admin, then they are allowed
    else if (userRoles.indexOf("admin") > -1) {
        authenticated = true;
    }
    // If the user has at least one of the required roles needed to perform the API call
    else if (userRoles.some(r => roles.includes(r))) {
        authenticated = true;
    }
    if (authenticated) {
        req.headers["user-id"]   = req.user.id;
        req.headers["user-name"] = req.user.name;
        req.headers["user-role"] = req.user.role;
        
        next();
    } else {
        // The user is not authorized to perform this API call
        return res.status(403).json({"message": "Unauthorized"});
    }
}

exports.Auth = function (roles = null) {
    return [
        // Step 1: Translate Basic or Api Key to a JWT if needed
        GetJsonWebToken,
        // Step 2: Verify that the JWT's signature is valid
        expressJwt({secret: config.jwt_secret}).unless({
            custom: (req) => {
                if (req.headers["system-token"] == config.system_token) {
                    return true;
                }
                else
                    return false;
            }
        }),

        // Step 3: Verify that the user has appropriate roles
        CheckRoles.bind({"roles": roles})
    ];
};

exports.Login = async function (req, res, next) {
    // Only attempt one login method (LoginWithBasic) if "pin" and "basic" were supplied
    let pin            = req.headers["authorization-pin"];
    let basic          = req.headers["authorization"];
    let deviceToken    = req.headers["device-token"];
    let deviceLocation = req.headers["device-location"]; // This is only relevant to logging in via SSO through LoginWithBasic()
    let result;

    try {
        if (basic) {
            result = await LoginWithBasic(basic, deviceToken, deviceLocation);

            if (result.status == "Error") {
                res.status(400).json({"message": result.message});
                return;
            }
            res.status(200).json({"userId": result.userId, "message": result.message, "deviceToken": result.deviceToken, "defaultLocation": result.defaultLocation});
            return;
        } else if (pin) {
            result = await LoginWithPIN(pin, deviceToken);
            if (result.status == "Error") {
                res.status(400).json({"message": result.message});
                return;
            }
            res.status(200).json({"userId": result.userId, "message": result.message, "deviceToken": result.deviceToken, "defaultLocation": result.defaultLocation});
            return;
        }
    } catch (error) {
        logger.error("auth.js Login: ", {error});
        res.status(500).json({"message": "Error occured while attempting to log in."});
        return;
    }

    // Fallback in case the user submitted nothing
    res.status(400).json({"message": "Invalid credentials"});
};
