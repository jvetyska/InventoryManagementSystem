var api = require("../microwarehouse-api/mw_api_inventory_bot.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/inventory_bot/for_location:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets all inventory bots for location
 *     description: Gets all inventory bots
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: location of the inventory bot
 *         in: query
 *         required: true
 *         type: string
 *       - name: debugFlag
 *         description: flag default set to false, but if set to true it won't call tory api's in api call
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/for_location", Auth(), api.inventory_bot_for_location);

/**
 * @swagger
 * /api/inventory_bot/add:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Add inventory bot
 *     description: |
 *       Add inventory bot
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               locationID:
 *                 type: string
 *               ipAddress:
 *                 type: string
 *             examples:
 *               locationID:
 *                 value: placeholder
 *                 summary: location of the inventory bot
 *               ipAddress:
 *                 value: placeholder
 *                 summary: IP Address of the inventory bot
 *             required:
 *               - locationID
 *               - ipAddress
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/add", Auth(["s_manager", "s_region_manager", "w_manager"]), api.add_inventory_bot);

/**
 * @swagger
 * /api/inventory_bot/{id}/update:
 *   put:
 *     tags:
 *       - inventory_bot
 *     summary: Update inventory bot
 *     description: |
 *       Update inventory bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ipAddress:
 *                 type: string
 *               locationID:
 *                 type: string
 *               defaultMap:
 *                 type: string
 *               name:
 *                 type: string
 *             examples:
 *               ipAddress:
 *                 value: placeholder
 *                 summary: IP Address of the inventory bot
 *               locationID:
 *                 value: placeholder
 *                 summary: locationID of the inventory bot
 *               defaultMap:
 *                 value: placeholder
 *                 summary: DefaultMap of the inventory bot
 *               name:
 *                 value: placeholder
 *                 summary: inventory bot Name
 *             required:
 *               - ipAddress
 *               - locationID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_bot/:id/update", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_inventory_bot);

/**
 * @swagger
 * /api/inventory_bot/{id}/status:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets status of inventory bot
 *     description: |
 *       Gets status of inventory bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/status", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_status);

/**
 * @swagger
 * /api/inventory_bot/{id}/areas:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets areas of inventory bot
 *     description: |
 *       Gets areas of inventory bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/areas", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_areas);

/**
 * @swagger
 * /api/inventory_bot/{location}/location_areas:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets areas of inventory bot by location
 *     description: |
 *       Gets areas of inventory bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: location
 *         description: id of location
 *         in: path
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:location/location_areas", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_areas_by_location);

/**
 * @swagger
 * /api/inventory_bot/{id}/maps:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets maps of inventory bot
 *     description: |
 *       Gets maps of inventory bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/maps", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_maps);

/**
 * @swagger
 * /api/inventory_bot/{id}/location_details:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot location details
 *     description: |
 *       Gets inventory bot location details
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *       - name: location
 *         description: name of inventory bot location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/location_details", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_location_details);

/**
 * @swagger
 * /api/inventory_bot/{id}/delete:
 *   delete:
 *     tags:
 *       - inventory_bot
 *     summary: Deletes inventory bot
 *     description: |
 *       Deletes inventory bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/inventory_bot/:id/delete", Auth(["s_manager", "s_region_manager", "w_manager"]), api.delete_inventory_bot);

/**
 * @swagger
 * /api/inventory_bot/{id}/process_status:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Updates inventory bot process status
 *     description: |
 *       Updates inventory bot process status
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               runName:
 *                 type: string
 *               taskConfig:
 *                 type: string
 *               isManualRun:
 *                 type: boolean
 *             examples:
 *               status:
 *                 value: placeholder
 *                 summary: status of inventory bot
 *               runName:
 *                 value: placeholder
 *                 summary: Run Name of inventory bot process status change
 *               taskConfig:
 *                 value: placeholder
 *                 summary: Task Config of run changing
 *               isManualRun:
 *                 value: 1
 *                 summary: True if the inventory bot run was triggered manually
 *             required:
 *               - status
 *               - runName
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/process_status", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_process_status);

/**
 * @swagger
 * /api/inventory_bot/{inventoryBotID}/bot_process:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot process details
 *     description: |
 *       Gets inventory bot process details
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: inventoryBotID
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *       - name: name
 *         description: name of inventory bot run
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:inventoryBotID/bot_process", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_process_details);

/**
 * @swagger
 * /api/inventory_bot/{id}/schedule:
 *   put:
 *     tags:
 *       - inventory_bot
 *     summary: Updates inventory bot schedule
 *     description: |
 *       Updates inventory bot schedule
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               taskConfig:
 *                 type: string
 *               schedule:
 *                 type: array
 *                 items:
 *                   type: array
 *                   items:
 *                     type: integer
 *             examples:
 *               taskConfig:
 *                 value: placeholder
 *                 summary: taskConfig of schedule item
 *               schedule:
 *                 value: placeholder
 *                 summary: |
 *                   The new schedule in Timezone of the robot.
 *                   0(Monday) to 6(Sunday)
 *                   EX. [0:[23], 1:[5, 23], 2:[23], 3:[], 4:[], 5:[23], 6:[4, 23]]
 *             required:
 *               - Password
 *               - schedule
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_bot/:id/schedule", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_inventory_bot_schedule);

/**
 * @swagger
 * /api/inventory_bot/{id}/start:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Starts Inventory Bot
 *     description: Starts Inventory Bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               taskConfig:
 *                 type: string
 *             examples:
 *               taskConfig:
 *                 value: placeholder
 *                 summary: TaskConfig of inventory bot process status change
 *             required:
 *               - taskConfig
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/start", Auth(["s_manager", "s_region_manager", "w_manager", "s_bot_mng"]), api.inventory_bot_start);

/**
 * @swagger
 * /api/inventory_bot/{id}/stop:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Stops Inventory Bot
 *     description: Stops Inventory Bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/stop", Auth(["s_manager", "s_region_manager", "w_manager", "s_bot_mng"]), api.inventory_bot_stop);

/**
 * @swagger
 * /api/inventory_bot/{id}/to_charger:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Sends Inventory Bot to charger
 *     description: Sends Inventory Bot to charger
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/to_charger", Auth(["s_manager", "s_region_manager", "w_manager", "s_bot_mng"]), api.inventory_bot_to_charger);

/**
 * @swagger
 * /api/inventory_bot/{id}/get_map:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets store map from Inventory Bot
 *     description: Gets store map from Inventory Bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/get_map", api.inventory_bot_get_map);

/**
 * @swagger
 * /api/inventory_bot/{id}/get_map_metadata:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets map metadata from Inventory Bot
 *     description: Gets map metadata from Inventory Bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/get_map_metadata", api.inventory_bot_get_map_metadata);

/**
 * @swagger
 * /api/inventory_bot/{id}/retrieve_data:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Retrieves inventory bot data
 *     description: Retrieves inventory bot data
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/retrieve_data", Auth(["s_manager", "s_region_manager", "w_manager"]), api.inventory_bot_retrieve_data);

/**
 * @swagger
 * /api/inventory_bot/{id}/upsert_area:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Inserts or Updates inventory bot area
 *     description: |
 *       Inserts or Updates inventory bot area
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               area:
 *                 type: string
 *               containerID:
 *                 type: string
 *               maxRunDurationMinutes:
 *                 type: integer
 *             examples:
 *               area:
 *                 value: placeholder
 *                 summary: new area of the inventory bot
 *               containerID:
 *                 value: placeholder
 *                 summary: new area container id
 *               maxRunDurationMinutes:
 *                 value: 12
 *                 summary: maximum run duration of Inventory Bot run in minutes
 *             required:
 *               - area
 *               - containerID
 *               - maxRunDurationMinutes
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/upsert_area", Auth(["s_manager", "s_region_manager", "w_manager"]), api.inventory_bot_upsert_area);

/**
 * @swagger
 * /api/inventory_bot/{id}/delete_area:
 *   delete:
 *     tags:
 *       - inventory_bot
 *     summary: Deletes inventory bot area
 *     description: |
 *       Deletes inventory bot area
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: ID of the inventory bot
 *         in: path
 *         required: true
 *         type: number
 *       - name: area
 *         description: new area of the inventory bot
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/inventory_bot/:id/delete_area", Auth(["s_manager", "s_region_manager", "w_manager"]), api.inventory_bot_delete_area);

/**
 * @swagger
 * /api/inventory_bot/{id}/new_areas:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot new areas
 *     description: |
 *       Gets inventory bot new areas that are not in our DB
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/new_areas", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_new_areas);

/**
 * @swagger
 * /api/inventory_bot/{id}/get_boundaries:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot boundaries
 *     description: |
 *       Gets inventory bot boundaries
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *       - name: map
 *         description: name of inventory bot map
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/get_boundaries", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_boundaries);

/**
 * @swagger
 * /api/inventory_bot/{id}/create_boundary:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Create inventory bot map boundary
 *     description: |
 *       Create inventory bot map boundary
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               createBoundaryObject:
 *                 schema:
 *                   $ref: "#/definitions/createBoundaryObj"
 *             examples:
 *               createBoundaryObject:
 *                 value: placeholder
 *                 summary: object to create boundary
 *             required:
 *               - createBoundaryObject
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/create_boundary", Auth(["s_manager", "s_region_manager", "w_manager"]), api.inventory_bot_create_boundary);

/**
 * @swagger
 * /api/inventory_bot/{id}/update_boundary:
 *   put:
 *     tags:
 *       - inventory_bot
 *     summary: Create inventory bot map boundary
 *     description: |
 *       Create inventory bot map boundary
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               updateBoundaryObject:
 *                 schema:
 *                   $ref: "#/definitions/updateBoundaryObj"
 *             examples:
 *               updateBoundaryObject:
 *                 value: placeholder
 *                 summary: object to create boundary
 *             required:
 *               - updateBoundaryObject
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_bot/:id/update_boundary", Auth(["s_manager", "s_region_manager", "w_manager"]), api.inventory_bot_update_boundary);

/**
 * @swagger
 * /api/inventory_bot/{id}/delete_boundary:
 *   delete:
 *     tags:
 *       - inventory_bot
 *     summary: Deletes inventory bot boundary
 *     description: |
 *       Deletes inventory bot boundary
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot boundary
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/inventory_bot/:id/delete_boundary", Auth(["s_manager", "s_region_manager", "w_manager"]), api.inventory_bot_delete_boundary);

/**
 * @swagger
 * /api/inventory_bot/get_data:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot data
 *     description: |
 *       Gets inventory bot data which is in csv format
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: query
 *         required: true
 *         type: number
 *       - name: mapAreaName
 *         description: map area name
 *         in: query
 *         required: true
 *         type: string
 *       - name: location
 *         description: name of inventory bot location
 *         in: query
 *         required: false
 *         type: string
 *       - name: inventoryName
 *         description: name of the inventory run
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/get_data", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_data);


/**
 * @swagger
 * /api/inventory_bot/{id}/upload_map:
 *   put:
 *     tags:
 *       - inventory_bot
 *     summary: Upload inventory bot map to s3
 *     description: |
 *       Upload inventory bot map to s3
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               inventory:
 *                 type: string
 *               taskConfig:
 *                 type: string
 *             examples:
 *               inventory:
 *                 value: placeholder
 *                 summary: inventory name
 *               taskConfig:
 *                 value: placeholder
 *                 summary: task config
 *             required:
 *               - inventory
 *               - taskConfig
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_bot/:id/upload_map", Auth(["s_manager", "s_region_manager", "w_manager"]), api.upload_inventory_bot_map);

/**
 * @swagger
 * /api/inventory_bot/{id}/get_location_map_s3:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Retrive the inventory bot location map from s3
 *     description: |
 *       Retrive the inventory bot location map from s3
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/get_location_map_s3", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_location_map_s3);

/**
 * @swagger
 * /api/inventory_bot/{id}/runs:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets Distinct run names of inventory bot for Area from inventory_rfid_history table
 *     description: |
 *       Gets Distinct run names of inventory bot for Area
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *       - name: areaName
 *         description: name of the area (KmartMockBOH, KmartMockStore)
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/runs", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_run_name);

/**
 * @swagger
 * /api/inventory_bot/map_metadata:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot map metadata
 *     description: |
 *       Gets inventory bot map metadata
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: mapID
 *         description: mapID of Inventory Bot map
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/map_metadata", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_map_metadata);

/**
 * @swagger
 * /api/inventory_bot/inventory_bot_webhook:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Post api for inventory bot webhook handler
 *     description: |
 *       Post api for inventory bot webhook handler
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Inventory:
 *                 type: string
 *               RobotName:
 *                 type: string
 *               Status:
 *                 type: string
 *               Finished:
 *                 type: boolean
 *             examples:
 *               Inventory:
 *                 value: placeholder
 *                 summary: Inventory run name
 *               RobotName:
 *                 value: placeholder
 *                 summary: Name of inventory bot
 *               Status:
 *                 value: placeholder
 *                 summary: Status of inventory bot run
 *               Finished:
 *                 value: placeholder
 *                 summary: Is inventory bot finished
 *             required:
 *               - Inventory
 *               - RobotName
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/inventory_bot_webhook", api.inventory_bot_webhook);

/**
 * @swagger
 * /api/inventory_bot/{id}/run_data:
 *   get:
 *     tags:
 *       - inventory_bot
 *     summary: Gets inventory bot run data from inventory_rfid_history table
 *     description: |
 *       Gets inventory bot run data
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *       - name: areaName
 *         description: name of the area (KmartMockBOH, KmartMockStore)
 *         in: query
 *         required: true
 *         type: string
 *       - name: runName
 *         description: run Name (Inventory Name)
 *         in: query
 *         required: true
 *         type: string
 *       - name: keycode
 *         description: Keycode
 *         in: query
 *         required: false
 *         type: string
 *       - name: barcode
 *         description: barcode
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_bot/:id/run_data", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_inventory_bot_run_data);

/**
 * @swagger
 * /api/inventory_bot/{id}/update_failure_reason:
 *   put:
 *     tags:
 *       - inventory_bot
 *     summary: Update inventory bot failure reason
 *     description: |
 *       Update inventory bot failure reason
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               RunName:
 *                 type: string
 *               Reason:
 *                 type: string
 *               Comment:
 *                 type: string
 *               Reason Type:
 *                 type: string
 *             examples:
 *               RunName:
 *                 value: placeholder
 *                 summary: Run Name
 *               Reason:
 *                 value: placeholder
 *                 summary: Reason Inventory Bot Failed
 *               Comment:
 *                 value: placeholder
 *                 summary: Comment on Inventory Bot Failure
 *               Reason Type:
 *                 value: placeholder
 *                 summary: Indicates if this reason was detected automatically (auto) or manually by an associate (manual)
 *             required:
 *               - RunName
 *               - Reason
 *               - Reason Type
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_bot/:id/update_failure_reason", Auth(), api.update_inventory_bot_failure_reason);

/**
 * @swagger
 * /api/inventory_bot/{id}/turn_off_brakes:
 *   post:
 *     tags:
 *       - inventory_bot
 *     summary: Starts Inventory Bot
 *     description: Starts Inventory Bot
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: id of inventory bot
 *         in: path
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/inventory_bot/:id/turn_off_brakes", Auth(["s_manager", "s_region_manager", "w_manager", "s_bot_mng"]), api.inventory_bot_turn_off_brakes);

module.exports = router;


/**
 * @swagger
 * definitions:
 *   createBoundaryObj:
 *     type: object
 *     properties:
 *       name:
 *         type: string
 *       map:
 *         type: string
 *       containerID:
 *         type: string
 *       boundaryPosition:
 *         type: object
 *         properties:
 *           point1X:
 *             type: number
 *           point2X:
 *             type: number
 *           point1Y:
 *             type: number
 *           point2Y:
 *             type: number
 *       mapPosition:
 *         type: object
 *         properties:
 *           mapLeft:
 *             type: number
 *           mapTop:
 *             type: number
 *           mapHeight:
 *             type: number
 *           mapWidth:
 *             type: number
 *     example:
 *       name: great boundary
 *       map: lynnwood
 *       containerID: LYN2-STR
 *       area: "store_hybridtraversal"
 *       boundaryPosition:
 *         point1X: 24.4
 *         point2X: 28.0
 *         point1Y: 12.3
 *         point2Y: 28.3
 *       mapPosition:
 *         mapLeft: 10
 *         mapTop: 12
 *         mapHeight: 3
 *         mapWidth: 4
 *
 *   updateBoundaryObj:
 *     type: object
 *     properties:
 *       name:
 *         type: string
 *       containerID:
 *         type: string
 *       boundaryPosition:
 *         type: object
 *         properties:
 *           point1X:
 *             type: number
 *           point2X:
 *             type: number
 *           point1Y:
 *             type: number
 *           point2Y:
 *             type: number
 *       mapPosition:
 *         type: object
 *         properties:
 *           mapLeft:
 *             type: number
 *           mapTop:
 *             type: number
 *           mapHeight:
 *             type: number
 *           mapWidth:
 *             type: number
 *     example:
 *       name: great boundary
 *       containerID: LYN2-STR
 *       boundaryPosition:
 *         point1X: 24.4
 *         point2X: 28.0
 *         point1Y: 12.3
 *         point2Y: 28.3
 *       mapPosition:
 *         mapLeft: 10
 *         mapTop: 12
 *         mapHeight: 3
 *         mapWidth: 4
 */
