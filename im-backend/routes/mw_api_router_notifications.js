var api = require("../microwarehouse-api/mw_api_notifications.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/notes:
 *   get:
 *     tags:
 *       - notifications
 *     summary: get notifications, intended for notification management
 *     description: |
 *       Get all notifications
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/notes", Auth(), api.get_notes);

/**
 * @swagger
 * /api/listNotifications:
 *   get:
 *     tags:
 *       - notifications
 *     summary: get notifications based on roleName and roleArea
 *     description: |
 *       notifications based on roleName and roleArea, intended for showing notifications
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: ID of the Notification you want to edit
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/listNotifications", Auth(), api.list_notifications);

/**
 * @swagger
 * /api/note:
 *   get:
 *     tags:
 *       - notifications
 *     summary: get a single notification
 *     description: |
 *       Get all notifications
 *     parameters:
 *      - name: noteID
 *        description: The ID of the note object%
 *        in: query
 *        required: false
 *        type: string
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/note", Auth(), api.get_note);

/**
 * @swagger
 * /api/getNoteOptions:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: get prvileges and options for the current user
 *     description: |
 *       get options
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/getNoteOptions", Auth(), api.get_note_options);

/**
 * @swagger
 * /api/getNoteAudienceCount:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: get notification audience count
 *     description: |
 *       get notification audience count
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               groups:
 *                 type: array
 *                 items:
 *                   type: string
 *               locations:
 *                 type: array
 *                 items:
 *                   type: string
 *             examples:
 *               groups:
 *                 value: group_1, groups_2
 *                 summary: Groups
 *               locations:
 *                 value: location_1, location_2
 *                 summary: Locations
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/getNoteAudienceCount", Auth(), api.get_note_audience_count);

/**
 * @swagger
 * /api/note:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: create new notifications
 *     description: |
 *       Insert new notifications into the database
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               datePublish:
 *                 type: string
 *               locationID:
 *                 type: array
 *                 items:
 *                   type: string
 *               link:
 *                 type: string
 *               mustRead:
 *                 type: boolean
 *               type:
 *                 type: string
 *               quantity:
 *                 type: number
 *               roleLevel:
 *                 type: array
 *                 items:
 *                   type: string
 *               roleName:
 *                 type: array
 *                 items:
 *                   type: string
 *             examples:
 *               title:
 *                 value: test
 *                 summary: Title of the notification
 *               description:
 *                 value: this is a test
 *                 summary: Your notification content
 *               datePublish:
 *                 value: 2021-08-29
 *                 summary: Date when you want this notification to be published
 *               locationID:
 *                 value: 1001-STR
 *                 summary: Location where this note is available
 *               link:
 *                 value: https://www.example.com
 *                 summary: An optional link that the webpage will go to if the user clicks on the description
 *               mustRead:
 *                 value: Must read text
 *                 summary: Team Members must read
 *               type:
 *                 value: Pick
 *                 summary: The type of note, such as "Pick" or "Inventory" for example
 *               quantity:
 *                 value: 2
 *                 summary: Quantity
 *               roleLevel:
 *                 value: 0, 1
 *                 summary: Roles Level
 *               roleName:
 *                 value: user, admin
 *                 summary: Roles to send out to
 *             required:
 *               - title
 *               - description
 *               - datePublish
 *               - locationID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/note", Auth(), api.create_note);

/**
 * @swagger
 * /api/note:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: update notifications
 *     description: |
 *       Update Existing Notification
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               datePublish:
 *                 type: string
 *               locationID:
 *                 type: array
 *                 items:
 *                   type: string
 *               link:
 *                 type: string
 *               mustRead:
 *                 type: boolean
 *               type:
 *                 type: string
 *               quantity:
 *                 type: number
 *               roleLevel:
 *                 type: array
 *                 items:
 *                   type: string
 *               roleName:
 *                 type: array
 *                 items:
 *                   type: string
 *             examples:
 *               title:
 *                 value: test
 *                 summary: Title of the notification
 *               description:
 *                 value: this is a test
 *                 summary: Your notification content
 *               datePublish:
 *                 value: 2021-08-29
 *                 summary: Date when you want this notification to be published
 *               locationID:
 *                 value: 1001-STR
 *                 summary: Location where this note is available
 *               link:
 *                 value: https://www.example.com
 *                 summary: An optional link that the webpage will go to if the user clicks on the description
 *               mustRead:
 *                 value: Must read text
 *                 summary: Team Members must read
 *               type:
 *                 value: Pick
 *                 summary: The type of note, such as "Pick" or "Inventory" for example
 *               quantity:
 *                 value: 2
 *                 summary: Quantity
 *               roleLevel:
 *                 value: 0, 1
 *                 summary: Roles Level
 *               roleName:
 *                 value: user, admin
 *                 summary: Roles to send out to
 *             required:
 *               - title
 *               - description
 *               - datePublish
 *               - locationID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/note", Auth(), api.update_note);

/**
 * @swagger
 * /api/noteViewed:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: updates the viewed and read column on the note_view table.
 *     description: |
 *       The first time the user views the note it is counted as read for that user and views
 *       Are incremented
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               noteID:
 *                 type: string
 *             examples:
 *               noteID:
 *                 value: 123
 *                 summary: ID of the Note Object
 *             required:
 *               - noteID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/noteViewed", Auth(), api.note_viewed);

/**
 * @swagger
 * /api/note:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: delete notifications
 *     description: |
 *       Delete Existing Notification
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: noteID
 *         description: ID of the Notification you want to edit
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/note", Auth(), api.delete_note);

/**
 * @swagger
 * /api/cron_update_notifications:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: Called by a cron job
 *     description: |
 *       This is called by a cron job which then calculates which task types need to have their
 *       notifications updated. For each unique task type that needs to be updated, this will
 *       call the API endpoint: updateTaskNotifications
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */

router.post("/cron_update_notifications", Auth(), api.cron_update_notifications);

/**
 * @swagger
 * /api/updateTaskNotifications:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - notifications
 *     summary: Updates the task notifications
 *     description: |
 *       Normally this API endpoint is called automatically every 5 minutes during business hours
 *       which are 6am to 9pm, Sunday to Saturday. It may also be called manually here in Swagger.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *             examples:
 *               type:
 *                 value: AvailableISP
 *                 summary: The type of the task, this can be a CSV of multiple types. For example, AvailableISP,OverHoldDateISP,OnlineOrders
 *             required:
 *               - type
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/updateTaskNotifications", Auth(), api.update_task_notifications);

module.exports = router;