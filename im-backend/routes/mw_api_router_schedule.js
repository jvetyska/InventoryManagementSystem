const api = require("../microwarehouse-api/mw_api_schedule.js");
const express = require("express");
const router = express.Router();
const Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/schedule:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Gets schedule by ID
 *     description: |
 *       Gets schedule by ID
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ScheduleID
 *         description: The ID of the schedule
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/schedule", Auth("s_manager", "s_region_manager"), api.get_schedule);

/**
 * @swagger
 * /api/schedules_for_location:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Get Schedules by location
 *     description: |
 *       Get Schedules by location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: The LocationID of the schedule
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/schedule/get_for_location", Auth("s_manager", "s_region_manager"), api.get_schedules_for_location);

/**
 * @swagger
 * /api/get_all_schedules:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Gets all Schedules
 *     description: |
 *       Gets all Schedules
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/schedule/get_all", Auth("s_manager", "s_region_manager"), api.get_all_schedules);

/**
 * @swagger
 * /api/schedule:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Creates or updates a schedule
 *     description: |
 *       Creates or updates a schedule
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
 *                 type: string
 *               LocationID:
 *                 type: string
 *               Hour:
 *                 type: number
 *               Minute:
 *                 type: number
 *               Sun:
 *                 type: boolean
 *               Mon:
 *                 type: boolean
 *               Tue:
 *                 type: boolean
 *               Wed:
 *                 type: boolean
 *               Thu:
 *                 type: boolean
 *               Fri:
 *                 type: boolean
 *               Sat:
 *                 type: boolean
 *               isEnabled:
 *                 type: boolean
 *               Name:
 *                 type: string
 *             examples:
 *               ID:
 *                  value: 123
 *                  summary: ID of the schedule
 *               LocationID:
 *                  value: 1001-STR
 *                  summary: ID of the location
 *               Hour:
 *                  value: 20
 *                  summary: Hour when you want to run this , its 24 hour
 *               Minute:
 *                  value: 20
 *                  summary: Minute when you want to run this
 *               Sun:
 *                  value: false
 *                  summary: set the backfill for sunday to true for given hour and minute, default value is false
 *               Mon:
 *                  value: false
 *                  summary: set the backfill for monday to true for given hour and minute, default value is false
 *               Tue:
 *                  value: false
 *                  summary: set the backfill for tuesday to true for given hour and minute, default value is false
 *               Wed:
 *                  value: false
 *                  summary: set the backfill for wednesday to true for given hour and minute, default value is false
 *               Thu:
 *                  value: false
 *                  summary: set the backfill for thursday to true for given hour and minute, default value is false
 *               Fri:
 *                  value: false
 *                  summary: set the backfill for friday to true for given hour and minute, default value is false
 *               Sat:
 *                  value: false
 *                  summary: set the backfill for saturday to true for given hour and minute, default value is false
 *               isEnabled:
 *                  value: true
 *                  summary: enable and disable this backfill schedule to run, default value is true
 *               Name:
 *                  value: Schedule Name
 *                  summary: Name of the backfill schedule, optional
 *             required:
 *               - Hour
 *               - Minute
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/schedule/upsert", Auth("s_manager", "s_region_manager"), api.upsert_schedule);

/**
 * @swagger
 * /api/schedule:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Updates a schedule
 *     description: |
 *       Updates a schedule
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of Schedule
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/schedule", Auth("s_manager", "s_region_manager"), api.delete_schedule);

/**
 * @swagger
 * /api/backfill_schedule:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Creates a Backfill Schedule
 *     description: |
 *       Creates a Backfill Schedule
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ScheduleID:
 *                 type: number
 *             examples:
 *               ScheduleID:
 *                  value: 123
 *                  summary: ID of Schedule
 *             required:
 *               - ScheduleID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/backfill_schedule", Auth("s_manager", "s_region_manager"), api.insert_backfill_schedule);

/**
 * @swagger
 * /api/stocktake_schedule:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Creates or updates a Stocktake Schedule
 *     description: |
 *       Creates or updates a Stocktake Schedule
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
 *                 type: number
 *               ScheduleID:
 *                 type: number
 *               Type:
 *                 type: string
 *               InventoryBotID:
 *                 type: number
 *               InventoryBotArea:
 *                 type: string
 *               ContainerID:
 *                 type: string
 *               MinsToComplete:
 *                 type: number
 *             examples:
 *               ID: 
 *                 value: 123
 *                 summary: ID of Stocktake Schedule
 *               ScheduleID: 
 *                 value: 123
 *                 summary: ID of Schedule
 *               Type: 
 *                 value: Backfill
 *                 summary: Type of schedule
 *               InventoryBotID: 
 *                 value: 123
 *                 summary: InventoryBotID to run
 *               InventoryBotArea: 
 *                 value: 123
 *                 summary: InventoryBotArea to run
 *               ContainerID: 
 *                 value: 123
 *                 summary: ContainerID for Manual Scan
 *               MinsToComplete: 
 *                 value: 20
 *                 summary: Minutes to complete the stocktake
 *             required:
 *               - Type
 *               - ContainerID
 *               - MinsToComplete
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/schedule/upsert_stocktake", Auth("s_manager", "s_region_manager"), api.upsert_stocktake_schedule);

/**
 * @swagger
 * /api/inventory_check_schedule:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Creates or updates an Inventory Check Schedule
 *     description: |
 *       Creates or updates an Inventory Check Schedule
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
 *                 type: number
 *               ScheduleID:
 *                 type: number
 *               Type:
 *                 type: string
 *               HoursToComplete:
 *                 type: number
 *               KeycodesToCheck:
 *                 type: number
 *             examples:
 *               ID: 
 *                 value: 123
 *                 summary: ID of Inventory Check Schedule
 *               ScheduleID: 
 *                 value: 123
 *                 summary: ID of Schedule
 *               Type: 
 *                 value: Backfill
 *                 summary: Type of schedule
 *               HoursToComplete: 
 *                 value: 20
 *                 summary: Hours to complete inventory checks to run
 *               KeycodesToCheck: 
 *                 value: 20
 *                 summary: Keycodes to check
 *             required:
 *               - Type
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/schedule/upsert_inventory_check", Auth("s_manager", "s_region_manager"), api.upsert_inventory_check_schedule);

/**
 * @swagger
 * /api/backfill_schedule:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Deletes a backfill schedule
 *     description: |
 *       Deletes a backfill schedule
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of Schedule
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/backfill_schedule", Auth("s_manager", "s_region_manager"), api.delete_backfill_schedule);

/**
 * @swagger
 * /api/stocktake_schedule:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Deletes a stocktake schedule
 *     description: |
 *       Deletes a stocktake schedule
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of Schedule
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/stocktake_schedule", Auth("s_manager", "s_region_manager"), api.delete_stocktake_schedule);

/**
 * @swagger
 * /api/inventory_check_schedule:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - schedule
 *     summary: Deletes an inventory take schedule
 *     description: |
 *       Deletes an inventory take schedule
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of Schedule
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/inventory_check_schedule", Auth("s_manager", "s_region_manager"), api.delete_inventory_check_schedule);

/**
 * @swagger
 * /api/update_inventory_snapshot:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Updates inventory_snapshot with quantity and reason from store inventory count task
 *     description: |
 *       Updates inventory_snapshot with quantity and reason from store inventory count task
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               keycode:
 *                 type: number
 *               container:
 *                 type: string
 *               physicalQuantity:
 *                 type: number
 *               referenceID:
 *                 type: number
 *               reason:
 *                 type: number
 *             examples:
 *               keycode:
 *                 value: 41315996
 *                 summary: Keycode of product being counted
 *               container:
 *                 value: 1001-BOH1
 *                 summary: container of inventory count task
 *               physicalQuantity:
 *                 value: 10
 *                 summary: physical quantity found during inventory count
 *               referenceID:
 *                 value: 123
 *                 summary: ID of the row in table backfill_schedule
 *               reason:
 *                 value: 123
 *                 summary: Reason provided if there was a delta between physical and virtual quantities
 *             required:
 *               - keycode
 *               - container
 *               - physicalQuantity
 *               - referenceID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_inventory_snapshot", Auth("s_manager", "s_region_manager"), api.update_inventory_snapshot);

/**
  * @swagger
  * /api/update_inventory_adjustment:
  *   put:
  *     security:
  *       - login: []
  *     tags:
  *       - backfill
  *     summary: Start or Resume current Inventory Adjustment
  *     description: |
  *       Start or Resume current Inventory Adjustment
  *     produces:
  *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ScheduleID:
 *                 type: number
 *               StopCurrentInventoryAdjustment:
 *                 type: boolean
 *             examples:
 *               ScheduleID:
 *                 value: 123
 *                 summary: Schedule ID of Inventory Check
 *               StopCurrentInventoryAdjustment:
 *                 value: false
 *                 summary: True to stop current inventory adjustment, False to resume
 *             required:
 *               - ScheduleID
 *               - StopCurrentInventoryAdjustment
  *     responses:
  *       200:
  *         description: OK
  */
router.put("/update_inventory_adjustment", Auth(["admin", "s_manager", "w_manager", "s_region_manager"]), api.update_inventory_adjustment);

module.exports = router;
