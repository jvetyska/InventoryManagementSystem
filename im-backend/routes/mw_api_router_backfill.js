const api = require("../microwarehouse-api/mw_api_backfill.js");
const express = require("express");
const router = express.Router();
const Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/get_backfill_schedule:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Gets the backfill replenishment schedule for a given location
 *     description: |
 *       Gets the backfill replenishment schedule for a given location
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
router.get("/get_backfill_schedule", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.get_backfill_schedule);

/**
 * @swagger
 * /api/get_all_inventory_tasks:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Gets inventory tasks for all locations
 *     description: |
 *       Gets inventory tasks for all locations
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_all_inventory_tasks", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.get_all_inventory_tasks);

/**
 * @swagger
 * /api/add_backfill_schedule:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: add new backfill Schedule for the provided location
 *     description: |
 *       add new backfill Schedule for the provided location
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
 *               Hour:
 *                 type: integer
 *               Minute:
 *                 type: integer
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
 *               IsEnabled:
 *                 type: boolean
 *               Name:
 *                 type: string
 *             examples:
 *               LocationID:
 *                 value: 1001-STR
 *                 summary: ID of the location
 *               Hour:
 *                 value: 4
 *                 summary: Hour when you want to run this , its 24 hour
 *               Minute:
 *                 value: 4
 *                 summary: Minute when you want to run this
 *               Sun:
 *                 value: 0
 *                 summary: Tset the backfill for sunday to true for given hour and minute, default value is false
 *               Mon:
 *                 value: 1
 *                 summary: set the backfill for monday to true for given hour and minute, default value is false
 *               Tue:
 *                 value: 1
 *                 summary: set the backfill for tuesday to true for given hour and minute, default value is false
 *               Wed:
 *                 value: 1
 *                 summary: set the backfill for wednesday to true for given hour and minute, default value is false
 *               Thu:
 *                 value: 1
 *                 summary: set the backfill for thursday to true for given hour and minute, default value is false
 *               Fri:
 *                 value: 1
 *                 summary: set the backfill for friday to true for given hour and minute, default value is false
 *               Sat:
 *                 value: 0
 *                 summary: set the backfill for saturday to true for given hour and minute, default value is false
 *               IsEnabled:
 *                 value: 1
 *                 summary: enable and disable this backfill schedule to run, default value is true
 *               Name:
 *                 value: New schedule
 *                 summary: Name of the backfill schedule, optional
 *             required:
 *               - LocationID
 *               - Hour
 *               - Minute
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/add_backfill_schedule", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.add_backfill_schedule);

/**
 * @swagger
 * /api/update_backfill_schedule:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Updates backfill Schedule for the provided location
 *     description: |
 *       Updates backfill Schedule for the provided location
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
 *                 type: integer
 *               Minute:
 *                 type: integer
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
 *               IsEnabled:
 *                 type: boolean
 *               Name:
 *                 type: string
 *             examples:
 *               ID:
 *                 value: 3
 *                 summary: ID of row that you are updating
 *               LocationID:
 *                 value: 1001-STR
 *                 summary: ID of the location
 *               Hour:
 *                 value: 4
 *                 summary: Hour when you want to run this , its 24 hour
 *               Minute:
 *                 value: 4
 *                 summary: Minute when you want to run this
 *               Sun:
 *                 value: 0
 *                 summary: Tset the backfill for sunday to true for given hour and minute, default value is false
 *               Mon:
 *                 value: 1
 *                 summary: set the backfill for monday to true for given hour and minute, default value is false
 *               Tue:
 *                 value: 1
 *                 summary: set the backfill for tuesday to true for given hour and minute, default value is false
 *               Wed:
 *                 value: 1
 *                 summary: set the backfill for wednesday to true for given hour and minute, default value is false
 *               Thu:
 *                 value: 1
 *                 summary: set the backfill for thursday to true for given hour and minute, default value is false
 *               Fri:
 *                 value: 1
 *                 summary: set the backfill for friday to true for given hour and minute, default value is false
 *               Sat:
 *                 value: 0
 *                 summary: set the backfill for saturday to true for given hour and minute, default value is false
 *               IsEnabled:
 *                 value: 1
 *                 summary: enable and disable this backfill schedule to run, default value is true
 *               Name:
 *                 value: New schedule
 *                 summary: Name of the backfill schedule, optional
 *             required:
 *               - ID
 *               - LocationID
 *               - Hour
 *               - Minute
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/update_backfill_schedule", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.update_backfill_schedule);

/**
 * @swagger
 * /api/update_inventory_check:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Updates backfill Schedule for the provided location
 *     description: |
 *       Updates backfill Schedule for the provided location
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
 *               inventoryCheckType:
 *                 type: string
 *               keycodesToCheck:
 *                 type: integer
 *               hoursToComplete:
 *                 type: integer
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: ID of row that you are updating
 *               inventoryCheckType:
 *                 value: standard
 *                 summary: type of inventory check
 *               keycodesToCheck:
 *                 value: 4
 *                 summary: number of keycodes to check
 *               hoursToComplete:
 *                 value: 4
 *                 summary: number of hours to complete inventory check.
 *             required:
 *               - ID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/update_inventory_check", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.update_inventory_check);


/**
 * @swagger
 * /api/delete_backfill_schedule:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Deletes backfill schedule for the given location
 *     description: |
 *       Deletes backfill schedule for the given location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of backfill schedule
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_backfill_schedule",  Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.delete_backfill_schedule);

/**
 * @swagger
 * /api/get_inventory_take_schedule:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Gets the inventory take schedule for a given backfill schedule ID
 *     description: |
 *       Gets the inventory take schedule for a given backfill schedule ID
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: BackFillScheduleID
 *         description: Provide the Backfill Schedule ID for which you want to get the inventory take schedule
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_inventory_take_schedule", Auth(["admin", "s_manager", "w_manager", "s_region_manager"]), api.get_inventory_take_schedule);

/**
 * @swagger
 * /api/add_inventory_take_schedule:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Add inventory take schedule for the given backfill schedule ID
 *     description: |
 *       Add inventory take schedule for the given backfill schedule ID
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               BackFillScheduleID:
 *                 type: integer
 *               Type:
 *                 type: string
 *                 enum:
 *                   - InventoryBot
 *                   - Manual
 *                   - RealtimeRFID
 *               InventoryBotID:
 *                 type: integer
 *               InventoryBotArea:
 *                 type: string
 *               Hour:
 *                 type: integer
 *               Minute:
 *                 type: integer
 *               minsToComplete:
 *                 type: integer
 *               ContainerID:
 *                 type: string
 *             examples:
 *               BackFillScheduleID:
 *                 value: 4
 *                 summary: Provide the Backfill Schedule ID for which you want to get the inventory take schedule
 *               Type:
 *                 value: standard
 *                 summary: source of inventory take process (InventoryBot, Manual, RealtimeRFID)
 *               InventoryBotID:
 *                 value: 4
 *                 summary: if the inventory take process is InventoryBot, than provide the inventoryBotID
 *               InventoryBotArea:
 *                 value: 4
 *                 summary: if the inventory take process is InventoryBot, than provide the inventory bot area
 *               Hour:
 *                 value: 4
 *                 summary: Hour when you want to run this , its 24 hour
 *               Minute:
 *                 value: 1
 *                 summary: Minute when you want to run this
 *               minsToComplete:
 *                 value: 4
 *                 summary: Minute to complete scan
 *               ContainerID:
 *                 value: 1001-BOH1
 *                 summary: id of container
 *             required:
 *               - BackFillScheduleID
 *               - Type
 *               - Hour
 *               - Minute
 *               - minsToComplete
 *               - ContainerID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/add_inventory_take_schedule", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.add_inventory_take_schedule);

/**
 * @swagger
 * /api/update_inventory_take_schedule:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Update inventory take schedule
 *     description: |
 *       Update inventory take schedule
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
 *               BackFillScheduleID:
 *                 type: integer
 *               Type:
 *                 type: string
 *                 enum:
 *                   - InventoryBot
 *                   - Manual
 *                   - RealtimeRFID
 *               InventoryBotID:
 *                 type: integer
 *               InventoryBotArea:
 *                 type: string
 *               Hour:
 *                 type: integer
 *               Minute:
 *                 type: integer
 *               minsToComplete:
 *                 type: integer
 *               ContainerID:
 *                 type: string
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: ID of the inventory table schedule to update
 *               BackFillScheduleID:
 *                 value: 4
 *                 summary: Provide the Backfill Schedule ID for which you want to get the inventory take schedule
 *               Type:
 *                 value: standard
 *                 summary: source of inventory take process (InventoryBot, Manual, RealtimeRFID)
 *               InventoryBotID:
 *                 value: 4
 *                 summary: if the inventory take process is InventoryBot, than provide the inventoryBotID
 *               InventoryBotArea:
 *                 value: 4
 *                 summary: if the inventory take process is InventoryBot, than provide the inventory bot area
 *               Hour:
 *                 value: 4
 *                 summary: Hour when you want to run this , its 24 hour
 *               Minute:
 *                 value: 1
 *                 summary: Minute when you want to run this
 *               minsToComplete:
 *                 value: 4
 *                 summary: Minute to complete scan
 *               ContainerID:
 *                 value: 1001-BOH1
 *                 summary: id of container
 *             required:
 *               - ID
 *               - BackFillScheduleID
 *               - Type
 *               - Hour
 *               - Minute
 *               - minsToComplete
 *               - ContainerID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/update_inventory_take_schedule", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.update_inventory_take_schedule);

/**
 * @swagger
 * /api/delete_inventory_take_schedule:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: delete the inventory take schedule
 *     description: |
 *       delete the inventory take schedule
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of the inventory table schedule to delete
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_inventory_take_schedule", Auth(["admin","s_manager", "w_manager", "s_region_manager"]), api.delete_inventory_take_schedule);

/**
 * @swagger
 * /api/backfill/update_count_task:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Updates a Backfill Count Task
 *     description: |
 *       Updates a Backfill Count Task with data that the user has collected from an RFID scan.
 *       This will set the inventory in the container associated with the task with whatever
 *       products are received to the backend from the RFID scan.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               taskID:
 *                 type: string
 *               process:
 *                 type: string
 *               products:
 *                 type: array
 *                 items:
 *                   type: string
 *             examples:
 *               taskID:
 *                 value: 3
 *                 summary: The ID of the Backfill Count Task
 *               process:
 *                 value: s-backfill
 *                 summary: process calling this api
 *               products:
 *                 value: 18392832039,32938203902
 *                 summary: barcodes of products
 *             required:
 *               - taskID
 *               - products
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/backfill/update_count_task", Auth(), api.backfill_update_count_task);

/**
 * @swagger
 * /api/generate_backfill_replenishment:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Generates backfill replenishment tasks for "hasFHBH" stores that are currently scheduled for a replenish
 *     description: |
 *       Generates backfill replenishment tasks for "hasFHBH" stores that are currently scheduled for a replenish
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
 *                 value: 4
 *                 summary: ID of the row in table store_backfill_schedule for which backfill replenishment should be generated
 *             required:
 *               - storeBackfillScheduleID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/generate_backfill_replenishment", Auth(["admin"]), api.generate_backfill_replenishment);

/**
 * @swagger
 * /api/update_store_inventory_snapshot:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Updates store_inventory_snapshot with quantity and reason from store inventory count task
 *     description: |
 *       Updates store_inventory_snapshot with quantity and reason from store inventory count task
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
 *                 type: integer
 *               container:
 *                 type: integer
 *               physicalQuantity:
 *                 type: integer
 *               referenceID:
 *                 type: integer
 *               reason:
 *                 type: string
 *               customReason:
 *                 type: string
 *             examples:
 *               keycode:
 *                 value: 4
 *                 summary: Keycode of product being counted
 *               container:
 *                 value: 100-SHL-KDSO
 *                 summary: container of inventory count task
 *               physicalQuantity:
 *                 value: 4
 *                 summary: physical quantity found during inventory count
 *               referenceID:
 *                 value: 3
 *                 summary: ID of the row in table store_backfill_schedule
 *               reason:
 *                 value: reason
 *                 summary: Reason provided if there was a delta between physical and virtual quantities
 *               customReason:
 *                 value: reason
 *                 summary: Custom Reason provided if there was a delta between physical and virtual quantities
 *             required:
 *               - keycode
 *               - container
 *               - physicalQuantity
 *               - referenceID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_store_inventory_snapshot", Auth(), api.update_store_inventory_snapshot);

/**
 * @swagger
 * /api/get_debug_backfill_tasks:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - backfill
 *     summary: Gets Backfill Tasks for dubugging for given keycode and location
 *     description: |
 *       Gets Backfill Tasks for dubugging for given keycode and location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: location to get tasks from
 *         type: string
 *         required: true
 *         in: query
 *       - name: keycode
 *         description: keycode of tasks
 *         type: number
 *         required: true
 *         in: query
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_debug_backfill_tasks", Auth(["admin", "s_manager", "w_manager", "s_region_manager"]), api.get_debug_backfill_tasks);

/**
 * @swagger
 * /api/update_current_inventory_adjustment:
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
 *               BackfillScheduleID:
 *                 type: integer
 *               StopCurrentInventoryAdjustment:
 *                 type: boolean
 *             examples:
 *               BackfillScheduleID:
 *                 value: 4
 *                 summary: Backfill Schedule ID
 *               StopCurrentInventoryAdjustment:
 *                 value: 1
 *                 summary: True to stop current inventory adjustment, False to resume
 *             required:
 *               - BackfillScheduleID
 *               - StopCurrentInventoryAdjustment
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_current_inventory_adjustment", Auth(["admin", "s_manager", "w_manager", "s_region_manager"]), api.update_current_inventory_adjustment);

module.exports = router;
