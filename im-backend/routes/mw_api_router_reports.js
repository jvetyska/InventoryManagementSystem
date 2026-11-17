var api = require("../microwarehouse-api/mw_api_reports.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/reports/dashboard:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: get Ops dashboard information
 *     description: |
 *       Return Order fulfillment information for Warehouse and Store Ops.
 *       Data returned is task_group specific based on DueDate and values are individual units of product.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: Warehouse Location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/dashboard", Auth(["s_manager", "s_region_manager", "w_manager"]), api.reports_get_dashboard);

/**
 * @swagger
 * /api/reports/inventory_discrepancies:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Get suspicious inventory adjustments.
 *     description: |
 *       Looks for inventory adjustments in the last 3 days with 0 expected items but 2 or more items found.
 *       Returns these inventory adjustments including the person involved, the cart of the item, and the date
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: Warehouse Location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/inventory_discrepancies", Auth(["s_manager", "s_region_manager", "w_manager"]), api.reports_get_inventory_discrepancies);

/**
 * @swagger
 * /api/reports/performance_reports_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Produces a .csv file and populates it in the same format that the download expects.
 *     description: |
 *       Gets reports on inventory data in a range of days. Outputs data as CSV file.
 *     produces:
 *       - text/csv
 *     parameters:
 *       - name: StartDate
 *         description: First day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: EndDate
 *         description: Last day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: LocationID
 *         description: Location to find reports
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/performance_reports_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.reports_get_performance_reports_csv);

/**
 * @swagger
 * /api/reports/get_rfid_tagging_report:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Get inventory reports.
 *     description: |
 *       Gets reports on inventory data in a range of days
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: StartDate
 *         description: First day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: EndDate
 *         description: Last day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: LocationID
 *         description: Location to find reports
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/get_rfid_tagging_report", Auth(), api.get_rfid_tagging_report);

/**
 * @swagger
 * /api/reports/get_performance_reports:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Get inventory reports.
 *     description: |
 *       Gets reports on inventory data in a range of days
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: StartDate
 *         description: First day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: EndDate
 *         description: Last day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: LocationID
 *         description: Location to find reports
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/get_performance_reports", Auth(), api.get_performance_reports);

/**
 * @swagger
 * /api/reports/get_inventory_report_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Get inventory reports.
 *     description: |
 *       Gets reports on inventory data in a range of days
 *     produces:
 *       - text/csv
 *     parameters:
 *       - name: Date
 *         description: Day to get reports. Must have format YYYY-MM-DD
 *         in: query
 *         required: true
 *         type: string
 *       - name: LocationID
 *         description: Location to find reports
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/get_inventory_report_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_report_csv);

/**
 * @swagger
 * /api/reports/send_barcodes_to_email:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: send a list of barcode from the scanner to an email
 *     description: |
 *       send barcodes to email
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               barcodes:
 *                 type: string
 *               email:
 *                 type: string
 *             examples:
 *               barcodes:
 *                  value: 123456, 654321
 *                  summary: array of barcodes
 *               email:
 *                  value: abc@example.com
 *                  summary: email to send the list of barcodes
 *             required:
 *               - barcodes
 *               - email
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/reports/send_barcodes_to_email", Auth(), api.send_barcodes_to_email);

/**
 * @swagger
 * /api/reports/prepare_rfid_email:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: send a list of barcode from the scanner to an email
 *     description: |
 *       send barcodes to email
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *               rfidList:
 *                 type: string
 *             examples:
 *               from:
 *                  value: abc@example.com
 *                  summary: from of email
 *               to:
 *                  value: abc@example.com
 *                  summary: to of email
 *               subject:
 *                  value: Subject of Email
 *                  summary: subject of email
 *               body:
 *                  value: Content of email
 *                  summary: body of email
 *               rfidList:
 *                  value: 41315996, 41369915
 *                  summary: list of keycodes
 *             required:
 *               - from
 *               - to
 *               - subject
 *               - body
 *               - rfidList
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/reports/prepare_rfid_email", Auth(), api.prepareRFIDEmail);

/**
 * @swagger
 * /api/reports/send_email:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: send a list of barcode from the scanner to an email
 *     description: |
 *       send barcodes to email
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *               files:
 *                 type: string
 *               fileData:
 *                 type: string
 *             examples:
 *               from:
 *                  value: abc@example.com
 *                  summary: from of email
 *               to:
 *                  value: abc@example.com
 *                  summary: to of email
 *               subject:
 *                  value: Subject of Email
 *                  summary: subject of email
 *               body:
 *                  value: Content of email
 *                  summary: body of email
 *               files:
 *                  value: file.fileformat, file2.format2
 *                  summary: attachments for the email
 *               fileData:
 *                  value: file.fileformat, file2.format2
 *                  summary: attachments for the email
 *             required:
 *               - from
 *               - to
 *               - subject
 *               - body
 *               - files
 *               - fileData
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/reports/send_email", Auth(), api.sendEmail);

/**
 * @swagger
 * /api/reports/inbound:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: get Ops inboard dashboard information
 *     description: |
 *       Return Order fulfillment information for Warehouse and Store Ops.
 *       Data returned is task_group specific based on DueDate and values are individual units of product.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: Warehouse Location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/inbound", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inbound_dashboard);

/**
 * @swagger
 * /api/reports/backfill_dashboard:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: get Ops backfill dashboard information
 *     description: |
 *       Return Order fulfillment information for Back-house/front-house enabled location Ops.
 *       Data returned is task_group specific based on DueDate and values are individual units of product.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: LocationID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/backfill_dashboard", Auth(), api.get_backfill_dashboard);

/**
 * @swagger
 * /api/reports/stocktake_dashboard:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: get Ops stocktake dashboard information
 *     description: |
 *       Return stocktake Inventory type task information for a given location.
 *       Data returned is task specific information like DueDate, total units in task, taskgroupIds, etc.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: LocationID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/stocktake_dashboard", Auth(), api.get_stocktake_dashboard);

/**
 * @swagger
 * /api/reports/generate_backfill_efficacy_report:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Generates a report of backfill efficacy and uploads it to an S3 bucket in AWS
 *     description: |
 *       Generates a report of backfill efficacy and uploads it to an S3 bucket in AWS
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: locationID for which backfill efficacy report should be generated
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/generate_backfill_efficacy_report", Auth(), api.generate_backfill_efficacy_report);

/**
 * @swagger
 * /api/reports/list_backfill_efficacy_reports:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Gets a list of recent backfill efficacy reports so that the user may download the recent report that they choose
 *     description: |
 *       Gets a list of recent backfill efficacy reports so that the user may download the recent report that they choose
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: BucketPrefixAndKeyName
 *         description: provide the prefix of key name to reuse this api for multiple purpose
 *         in: query
 *         required: true
 *         type: string
 *       - name: LocationID
 *         description: LocationID
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/list_backfill_efficacy_reports", Auth(["s_manager", "s_region_manager", "w_manager"]), api.list_backfill_efficacy_reports);

/**
 * @swagger
 * /api/reports/download_backfill_efficacy_report:
 *   get:
 *     security: []
 *     x-roles: []
 *     tags:
 *       - reports
 *     summary: Downloads a backfill efficacy report
 *     description: |
 *       Downloads a backfill efficacy report
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: FileName
 *         description: The file name of the backfill efficacy report to download
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/download_backfill_efficacy_report", api.download_backfill_efficacy_report);

/**
 * @swagger
 * /api/reports/get_active_users:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Gets the current active users
 *     description: Gets the current active users. Active is defined as a user that currently has a task assigned to them
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: The ID of the current location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/get_active_users", Auth(), api.get_active_users);

/**
 * @swagger
 * /api/reports/get_active_user_task:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Gets the current task that a user is working on, or tasks for all users if a UserID isn't provided
 *     description: |
 *       Gets the current task that a user is working on/assigned to them, or gets the tasks that all users are working on if a UserID isn't provided.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: UserID
 *         description: The ID of a user
 *         in: query
 *         required: false
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/get_active_user_task", Auth(), api.get_active_user_task);

/**
 * @swagger
 * /api/reports/inventory_bot:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: get inventory bot dashboard information
 *     description: |
 *       Return the inventory bot status, run start and end time, next schedule run, location map, last run map
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: LocationID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/inventory_bot", Auth(), api.get_inventory_bot_dashboard);

/**
 * @swagger
 * /api/reports/filtered_rfid_tags_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Get filtered EPC tags for location
 *     description: |
 *       Get filtered EPC tags for location
 *     produces:
 *       - text/csv
 *     parameters:
 *       - name: LocationID
 *         description: LocationID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/reports/filtered_rfid_tags_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_filtered_rfid_tags_csv);

module.exports = router;

/**
 * @swagger
 * definitions:
 *   rfidemail:
 *     type: object
 *     properties:
 *       from:
 *         type: string
 *       to:
 *         type: string
 *       subject:
 *         type: string
 *       body:
 *         type: string
 *       rfidlist:
 *         type: array
 *         items:
 *           type: object
 *           properties:
 *             Barcode:
 *               type: string
 *             EPC:
 *               type: string
 *             Certainty:
 *               type: integer
 */

