var api = require("../microwarehouse-api/mw_api_logging.js");
var express = require("express");
var router = express.Router();
var multer = require("multer"); // Handling uploaded files, multipart/form-data
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/log/record_inventory_history:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - logging
 *       - scheduled_job
 *     summary: Checks the inventory across all stores and stores their quantities into the table inventory_history
 *     description: |
 *       Checks the inventory across all stores and stores their quantities into the table inventory_history
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/log/record_inventory_history", Auth(["admin"]), api.record_inventory_history);

/**
 * @swagger
 * /api/log/get_logs:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - logging
 *       - scheduled_job
 *     summary: Gets the logs from X days ago. By default it will get today's logs (UTC time) if the days_ago paramter isn't provided
 *     description: |
 *       Gets the logs from X days ago. By default it will get today's logs (UTC time) if the days_ago paramter isn't provided
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               days_ago:
 *                 type: integer
 *             examples:
 *               days_ago:
 *                 value: 1
 *                 summary: The logs to get from X days ago. Common cases are 0 for today, and 1 for yesterday
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/log/get_logs", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_logs);

/**
 * @swagger
 * /api/log/start_task:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - logging
 *     summary: start_task
 *     description: |
 *       Sends task infomation to DynamoDB
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               task:
 *                 type: string
 *               locationId:
 *                 type: string
 *             examples:
 *               task:
 *                 value: backfill
 *                 summary: type of task
 *               locationId:
 *                 value: 1001-STR
 *                 summary: Location
 *             required:
 *               - task
 *               - locationId
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/log/start_task", Auth(), api.start_task);

/**
 * @swagger
 * /api/log/rfid_print:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - logging
 *     summary: Log rfid print
 *     description: |
 *       Log rfid print
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Keycode:
 *                 type: integer
 *               Barcode:
 *                 type: integer
 *               Quantity:
 *                 type: integer
 *               EPCs:
 *                 type: string
 *               Location:
 *                 type: string
 *             examples:
 *               Keycode:
 *                 value: 232423244
 *                 summary: Keycode of tags printed
 *               Barcode:
 *                 value: 32323234323
 *                 summary: Barcode of tags printed
 *               Quantity:
 *                 value: 4
 *                 summary: Number of tags printed
 *               EPCs:
 *                 value: psoakfalfjaklsd,asljflaksdjfal
 *                 summary: EPCs (comma seperated string) of tags printed
 *               Location:
 *                 value: 1001-STR
 *                 summary: Location where tags were printed
 *             required:
 *               - Keycode
 *               - Barcode
 *               - Quantity
 *               - EPCs
 *               - Location
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/log/rfid_print", Auth(), api.log_rfid_print);

module.exports = router;
