var api = require("../microwarehouse-api/mw_api_replenish_order.js");
var express = require("express");
var router = express.Router();
var multer = require("multer"); // Handling uploaded files, multipart/form-data
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
//var upload = multer({"dest": "tmp/"}); // Set the temporary directory where files are uploaded
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/close_inactive_replenish_orders:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Close older Replenishment orders and orders on the blacklist.
 *     description: |
 *       Close older Replenishment orders and orders on the blacklist.
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/close_inactive_replenish_orders", Auth(["admin"]), api.close_inactive_replenish_orders);

/**
 * @swagger
 * /api/replenish_order:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *       - scheduled_job
 *     summary: Generates replenish_order table
 *     description: |
 *       Generates the replenish_order table
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               forced:
 *                 type: boolean
 *             examples:
 *               forced:
 *                  value: true
 *                  summary: Force replenishment order to run
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/replenish_order", Auth(["admin"]), api.replenish_order);

/**
 * @swagger
 * /api/replenish_order_to_task:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *       - scheduled_job
 *     summary: Creates task groups and tasks from the replenish_order table
 *     description: |
 *       Creates task groups and tasks from the replenish_order table
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               locations:
 *                 type: array
 *                 items:
 *                   type: string
 *               isManual:
 *                 type: boolean
 *               replenID:
 *                 type: string
 *               name:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum:
 *                   - Promo
 *                   - Auto
 *                   - Manual
 *             examples:
 *               locations:
 *                  value: 1001-STR, LYN1-WRH
 *                  summary: Force task creation for these location
 *               isManual:
 *                  value: true
 *                  summary: Determine if run is grouping manual or automatic
 *               replenID:
 *                  value: 123
 *                  summary: The replenishment order id to create tasks for
 *               name:
 *                  value: Big Promotion
 *                  summary: name of promotion (promo only)
 *               source:
 *                  value: Promo
 *                  summary: source of tasks (Promo, Auto, Manual)
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/replenish_order_to_task", Auth(["admin"]), api.replenish_order_to_task);

/**
 * @swagger
 * /api/generate_replenish_order_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *       - scheduled_job
 *     summary: Generates replenish_order csv file
 *     description: |
 *       Generates the replenish_order csv file
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/generate_replenish_order_csv", Auth(["admin"]), api.generate_replenish_order_csv);

/**
 * @swagger
 * /api/csv_to_replenish_order:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Ingests a .csv file and inserts replenish orders from the data inside of it
 *     description: |
 *       Ingests a .csv file and inserts replenish orders from the data inside of it
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: csvfile
 *         type: file
 *         description: The file to upload
 *       - in: formData
 *         name: ignoreExistingOrders
 *         type: boolean
 *         description: If existing orders should be ignored. By default, this value is false
 *         required: false
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/csv_to_replenish_order", Auth(["admin", "w_manager", "w_troubleshoot"]), upload.single("csvfile"), api.csv_to_replenish_order);

/**
 * @swagger
 * /api/csv_to_case_order:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Ingests a .csv file and inserts replenish orders from the data inside of it
 *     description: |
 *       Ingests a .csv file and inserts replenish orders from the data inside of it
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: csvfile
 *         type: file
 *         description: The file to upload
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/csv_to_case_order", Auth(["admin", "w_manager", "w_troubleshoot"]), upload.single("csvfile"), api.csv_to_case_order);

/**
 * @swagger
 * /api/fulfill_replenish_order:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Fulfills replenish order
 *     description: Fulfills replenish order
 *     produces:
 *       - application/json
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               source_container:
 *                 type: string
 *               target_container:
 *                 type: string
 *               backfill_flag:
 *                 type: boolean
 *             examples:
 *               source_container:
 *                  value: 1001-BOH1
 *                  summary: source container barcode
 *               targer_container:
 *                  value: 1001-BOH1
 *                  summary: target container barcode
 *               backfill_flag:
 *                  value: true
 *                  summary: its true if we are doing backfill task type
 *             required:
 *               - source_container
 *               - target_container
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/fulfill_replenish_order", Auth(["admin", "w_manager", "s_manager", "s_region_manager"]), api.fulfill_replenish_order);

/**
 * @swagger
 * /api/replenish_factor_calendar:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Get Replenish Factor Calendar for location
 *     description: |
 *       Get Replenish Factor Calendar for Past and Future 30 days, for selected location.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: Location ID barcode
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/replenish_factor_calendar", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot"]), api.get_replenish_factor_calendar);

/**
 * @swagger
 * /api/replenish_factor_calendar:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Simple way to adjust replenishment factor for location and date
 *     description: |
 *       A simple way to add entries to Replenishment Factor Calendar, per day, per location.
 *       Order will be multiplied by the factor, so 2 will double it, 0.5 will halve it.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *               factor:
 *                 type: number
 *               location:
 *                 type: string
 *             examples:
 *               date:
 *                  value: 2020-11-04
 *                  summary: Calendar Date YYYY-MM-DD
 *               factor:
 *                  value: 2
 *                  summary: replenishment * factor
 *               location:
 *                  value: 1001-STR
 *                  summary: Store location
 *             required:
 *               - date
 *               - factor
 *               - location
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/replenish_factor_calendar", Auth(["admin", "w_manager"]), api.update_replenish_factor_calendar);

/**
 * @swagger
 * /api/replenish_schedule:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Get Replenish Schedule for Location
 *     description: |
 *       Get Replenish Schedule for Location - returns list of Hours.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: location
 *         description: Location ID barcode
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/replenish_schedule", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot"]), api.get_replenish_schedule);

/**
 * @swagger
 * /api/replenish_schedule:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Update Replenishment generation Schedule by Location
 *     description: |
 *       Update Replenishment generation Schedule per Location.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               location:
 *                 type: string
 *               hours:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum:
 *                     - 0
 *                     - 1
 *                     - 2
 *                     - 3
 *                     - 4
 *                     - 5
 *                     - 6
 *                     - 7
 *                     - 8
 *                     - 9
 *                     - 10
 *                     - 11
 *                     - 12
 *                     - 13
 *                     - 14
 *                     - 15
 *                     - 16
 *                     - 17
 *                     - 18
 *                     - 19
 *                     - 20
 *                     - 21
 *                     - 22
 *                     - 23
 *                 collectionFormat: multi
 *             examples:
 *               location:
 *                 value: 1001-STR
 *                 summary: Location ID barcode
 *               hours:
 *                 value: 10
 *                 summary: Select specific hour(s) when replenishment will generate
 *             required:
 *               - location
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/replenish_schedule", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_replenish_schedule);

/**
 * @swagger
 * /api/delivery_schedule:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Get Delivery Schedule for Location
 *     description: |
 *       Get Delivery Schedule for Location - returns list of Hours.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: location
 *         description: Location ID barcode
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/delivery_schedule", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot"]), api.get_delivery_schedule);

/**
 * @swagger
 * /api/delivery_schedule:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *     summary: Update Delivery Schedule by Location
 *     description: |
 *       Update Delivery Schedule per Location.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               location:
 *                 type: string
 *               hours:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum:
 *                     - 0
 *                     - 1
 *                     - 2
 *                     - 3
 *                     - 4
 *                     - 5
 *                     - 6
 *                     - 7
 *                     - 8
 *                     - 9
 *                     - 10
 *                     - 11
 *                     - 12
 *                     - 13
 *                     - 14
 *                     - 15
 *                     - 16
 *                     - 17
 *                     - 18
 *                     - 19
 *                     - 20
 *                     - 21
 *                     - 22
 *                     - 23
 *                 collectionFormat: multi
 *             examples:
 *               location:
 *                 value: 1001-STR
 *                 summary: Location ID barcode
 *               hours:
 *                 value: 10
 *                 summary: Select specific hour(s) when truck departs
 *             required:
 *               - location
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/delivery_schedule", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_delivery_schedule);

/**
 * @swagger
 * /api/replenish_order_case:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *       - scheduled_job
 *     summary: Generates replenish_order table
 *     description: |
 *       Generates the replenish_order table
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               forced:
 *                 type: boolean
 *             examples:
 *               forced:
 *                  value: true
 *                  summary: Force replenishment order to run
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/replenish_order_case", Auth(["admin"]), api.replenish_order_case);

/**
 * @swagger
 * /api/replenish_case_to_task:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - replenish_order
 *       - scheduled_job
 *     summary: Creates task groups and tasks from the replenish_order table
 *     description: |
 *       Creates task groups and tasks from the replenish_order table
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               locations:
 *                 type: array
 *                 items:
 *                   type: string
 *               isManual:
 *                 type: boolean
 *               replenID:
 *                 type: string
 *               name:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum:
 *                   - Promo
 *                   - Auto
 *                   - Manual
 *             examples:
 *               locations:
 *                  value: 1001-STR, LYN1-WRH
 *                  summary: Force task creation for these location
 *               isManual:
 *                  value: true
 *                  summary: Determine if run is grouping manual or automatic
 *               replenID:
 *                  value: 123
 *                  summary: The replenishment order id to create tasks for
 *               name:
 *                  value: Big Promotion
 *                  summary: name of promotion (promo only)
 *               source:
 *                  value: Promo
 *                  summary: source of tasks (Promo, Auto, Manual)
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/replenish_case_to_task", Auth(["admin"]), api.replenish_case_to_task);

/**
 * @swagger
 * /api/debug_get_replen_by_productId:
 *   get:
 *     tags:
 *       - replenish_order
 *     summary: get replenishment by product ID
 *     description: |
 *       Get replenishment by productID
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: barcode
 *         description: product barcode
 *         in: query
 *         required: true
 *         type: string
 *       - name: locationID
 *         description: Warehouse Location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/debug_get_replen_by_productId", Auth(), api.debug_get_replen_by_productId);

/**
 * @swagger
 * /api/debug_replenishment:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *      - replenish_order
 *     summary: get basic debug information about replenishment by keycode/barcode, used by debug component in front-end
 *     description: |
 *       The information that this API endpoint returns based on location which are the replenishment check required and last replenishment & task information.
 *       You must provide either a Keycode OR Barcode as productID and LocationID.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ProductID
 *         description: Any product identifier, such as the barcode, keycode
 *         in: query
 *         required: true
 *         type: string
 *       - name: LocationID
 *         description: Source LocationID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/debug_replenishment", Auth(), api.debug_replenishment);

module.exports = router;
