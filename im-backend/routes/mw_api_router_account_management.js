var api = require("../microwarehouse-api/mw_api_account_management.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;
var Login = require("../library/auth.js").Login;

/**
 * @swagger
 * /api/account_management/get_users:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Gets the information of all users
 *     description: No parameters are required
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/account_management/get_users", Auth(["s_manager", "w_manager", "s_region_manager"]), api.get_users);

/**
 * @swagger
 * /api/account_management/get_user_details:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Gets detailed information of a single user
 *     description: Gets detailed information of a single user
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: The ID of the user to get
 *         in: query
 *         required: false
 *         type: integer
 *       - name: username
 *         description: The ID of the user to get
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/account_management/get_user_details", Auth(), api.get_user_details);

/**
 * @swagger
 * /api/account_management/get_user_locations:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Returns a user's locations
 *     description: Returns the locations available for a user to utilize
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/account_management/get_user_locations", Auth(), api.get_user_locations);

/**
 * @swagger
 * /api/account_management/get_available_roles:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Determines what roles the user can assign to others
 *     description: Determines what roles the user can assign to others
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/account_management/get_available_roles", Auth(["s_manager", "w_manager", "s_region_manager"]), api.get_available_roles);

/**
 * @swagger
 * /api/account_management/create_user:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Updates the data of a user
 *     description: Updates an existing user from the given parameters
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Username:
 *                 type: string
 *               FirstName:
 *                 type: string
 *               LastName:
 *                 type: string
 *               Email:
 *                 type: string
 *               PhoneNumber:
 *                 type: string
 *               DefaultLocation:
 *                 type: string
 *               RegionID:
 *                 type: integer
 *               Roles:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum:
 *                     - admin
 *                     - s_manager
 *                     - s_inventorycount
 *                     - w_manager
 *                     - w_troubleshoot
 *                     - w_receive
 *                     - w_stow
 *                     - w_pick
 *                     - w_onlineorders
 *                     - w_pack
 *                     - w_bulkstow
 *                     - w_inventorycount
 *                     - w_removeinventory
 *             examples:
 *               Username:
 *                 value: JohnDoe
 *                 summary: The username to assign to the newly created user; this must be unique across all users
 *               FirstName:
 *                 value: john
 *                 summary: The user's first name
 *               LastName:
 *                 value: doe
 *                 summary: The user's last name
 *               Email:
 *                 value: johndoe@gmail.com
 *                 summary: The user's email address. This must be unique across all users
 *               PhoneNumber:
 *                 value: 1001-STR
 *                 summary: ID of the location
 *               DefaultLocation:
 *                 value: 1001-STR
 *                 summary: The Default Location setting for this user
 *               RegionID:
 *                 value: 3
 *                 summary: The ID of the region that the user is in
 *               Roles:
 *                 value: s_manager, w_pack
 *                 summary: The roles that a user has
 *             required:
 *               - Username
 *               - FirstName
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/account_management/create_user", Auth(["s_manager", "w_manager", "s_region_manager"]), api.create_user);

/**
 * @swagger
 * /api/account_management/update_user:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Updates the data of a user
 *     description: Updates an existing user from the given parameters
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ID:
 *                 type: integer
 *               NewUsername:
 *                 type: string
 *               FirstName:
 *                 type: string
 *               LastName:
 *                 type: string
 *               Email:
 *                 type: string
 *               PhoneNumber:
 *                 type: string
 *               DefaultLocation:
 *                 type: string
 *               RegionID:
 *                 type: integer
 *               Roles:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum:
 *                     - admin
 *                     - s_manager
 *                     - s_inventorycount
 *                     - w_manager
 *                     - w_troubleshoot
 *                     - w_receive
 *                     - w_stow
 *                     - w_pick
 *                     - w_onlineorders
 *                     - w_pack
 *                     - w_bulkstow
 *                     - w_inventorycount
 *                     - w_removeinventory
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: The ID of the user that will updated
 *               NewUsername:
 *                 value: john2332
 *                 summary: A username to assign the currently-existing user; this must be unique across all users
 *               FirstName:
 *                 value: john
 *                 summary: The user's first name
 *               LastName:
 *                 value: doe
 *                 summary: The user's last name
 *               Email:
 *                 value: johndoe@gmail.com
 *                 summary: The user's email address. This must be unique across all users
 *               PhoneNumber:
 *                 value: 1001-STR
 *                 summary: ID of the location
 *               DefaultLocation:
 *                 value: 1001-STR
 *                 summary: The Default Location setting for this user
 *               RegionID:
 *                 value: 3
 *                 summary: The ID of the region that the user is in
 *               Roles:
 *                 value: s_manager, w_pack
 *                 summary: The roles that a user has
 *             required:
 *               - ID
 *               - FirstName
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/account_management/update_user", Auth(["s_manager", "w_manager", "s_region_manager"]), api.update_user);

/**
 * @swagger
 * /api/account_management/update_profile:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Updates the logged in user's profile
 *     description: Updates logged in user's profile details.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               FirstName:
 *                 type: string
 *               LastName:
 *                 type: string
 *               Email:
 *                 type: string
 *               PhoneNumber:
 *                 type: string
 *             examples:
 *               FirstName:
 *                 value: john
 *                 summary: The user's first name
 *               LastName:
 *                 value: doe
 *                 summary: The user's last name
 *               Email:
 *                 value: johndoe@gmail.com
 *                 summary: The user's email address. This must be unique across all users
 *               PhoneNumber:
 *                 value: 1001-STR
 *                 summary: ID of the location
 *             required:
 *               - FirstName
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/account_management/update_profile", Auth(), api.update_profile);

/**
 * @swagger
 * /api/account_management/update_user_password:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Updates the data of a user
 *     description: Updates an existing user from the given parameters
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ID:
 *                 type: integer
 *               Password:
 *                 type: string
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: The ID of the user that have its password updated
 *               Password:
 *                 value: password
 *                 summary: The new password that will be set to the user
 *             required:
 *               - ID
 *               - Password
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/account_management/update_user_password", Auth(), api.update_user_password);

/**
 * @swagger
 * /api/account_management/update_user_login_barcode:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Updates the login barcode of a user
 *     description: Updates the login barcode of a user
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ID:
 *                 type: integer
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: The ID of the user that will have its login barcode updated
 *             required:
 *               - ID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/account_management/update_user_login_barcode", Auth(["s_manager", "w_manager", "s_region_manager"]), api.update_user_login_barcode);

/**
 * @swagger
 * /api/account_management/delete_user:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - account_management
 *     summary: Deletes a user
 *     description: The user deleted is specified from a single parameter
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: The ID of the user to delete
 *         in: query
 *         required: true
 *         type: integer
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/account_management/delete_user", Auth(["s_manager", "w_manager", "s_region_manager"]), api.delete_user);

// This method SHOULD NOT be available in Swagger
router.post("/account_management/login", Login);

module.exports = router;
