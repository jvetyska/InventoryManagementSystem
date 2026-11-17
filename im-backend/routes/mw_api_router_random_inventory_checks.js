var api = require("../microwarehouse-api/mw_api_random_inventory_checks.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/create_random_inventory_checks_for_location:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - random_inventory_checks
 *       - scheduled_job
 *     summary: Creates random tasks for associates to check inventory levels at stores and warehouses
 *     description: Creates random tasks for the location given
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               LocationID:
 *                 type: string
 *             examples:
 *               LocationID:
 *                 value: 1001-STR
 *                 summary: Location Id to create random tasks for
 *             required:
 *               - LocationID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/create_random_inventory_checks_for_location", Auth(["admin"]), api.create_random_inventory_checks_for_location);

/**
 * @swagger
 * /api/create_backfill_random_inventory_checks:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - random_inventory_checks
 *       - scheduled_job
 *     summary: Creates random tasks for associates to check inventory levels after backfill is generated
 *     description: Creates random tasks for the provided schedule
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               storeBackfillScheduleID:
 *                 type: integer
 *             examples:
 *               storeBackfillScheduleID:
 *                 value: 3
 *                 summary: ID of the Backfill schedule
 *             required:
 *               - storeBackfillScheduleID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/create_backfill_random_inventory_checks", Auth(["admin"]), api.create_backfill_random_inventory_checks);

/**
 * @swagger
 * /api/create_random_inventory_checks:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - random_inventory_checks
 *       - scheduled_job
 *     summary: Creates random tasks for associates to check inventory levels at stores and warehouses
 *     description: Whenever this job is ran, up to 50 tasks will be made to check random products (at stores) or random shelves (at warehouses). This is a maximum of 50 tasks per every location.
 *     produces:
 *       - application/json
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/create_random_inventory_checks", Auth(["admin"]), api.create_random_inventory_checks);

/**
 * @swagger
 * /api/inventory_count_schedule:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - random_inventory_checks
 *     summary: Gets the inventory count schedule for a given location
 *     description: |
 *       Gets the inventory count schedule for a given location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: ID of the location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_count_schedule", Auth(["admin"]), api.get_inventory_count_schedule);

/**
 * @swagger
 * /api/inventory_count_schedule:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - random_inventory_checks
 *     summary: Updates the inventory count schedule for a provided location
 *     description: |
 *       Updates the inventory count schedule for a provided location
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               LocationID:
 *                 type: string
 *               KeycodeCount:
 *                 type: integer
 *               HoursToComplete:
 *                 type: integer
 *               Hours:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Hours'
 *                 explode: false
 *                 style: form
 *             examples:
 *               LocationID:
 *                 value: 1001-STR
 *                 summary: ID of the location
 *               KeycodeCount:
 *                 value: 3
 *                 summary: Number of keycodes to create inventory tasks for
 *               HoursToComplete:
 *                 value: 3
 *                 summary: Hours to complete checks
 *               Hours:
 *                 value: 3
 *                 summary: Select the hour(s) for when the inventory count tasks will generate
 *             required:
 *               - LocationID
 *               - KeycodeCount
 *               - HoursToComplete
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_count_schedule", Auth(["admin"]), api.update_inventory_count_schedule);

module.exports = router;

/**
 * @swagger
 * components:
 *   schemas:
 *     Hours:
 *       type: integer
 *       enum: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]
 */


