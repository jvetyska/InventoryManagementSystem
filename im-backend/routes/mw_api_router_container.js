var api = require("../microwarehouse-api/mw_api_container.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/get_container:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get container information
 *     description: |
 *       Get container infromation at specified location
 *       Example:  container = 12-A; location = SeattleStore
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: container
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_container", Auth(), api.get_container);

/**
 * @swagger
 * /api/get_containers:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get list of containers
 *     description: |
 *       get list of containers at specified location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: locationID
 *         in: query
 *         required: false
 *         type: string
 *       - name: isBOH
 *         description: is Back of House
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isFOH
 *         description: is Front of House
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isWRH
 *         description: is Warehouse
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isOffsite
 *         description: is Offsite
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isSystemInv
 *         description: is System inventory
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: backfillEnabled
 *         description: is backfill enabled
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_containers", Auth(), api.get_containers);

/**
 * @swagger
 * /api/get_container_types:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get container types
 *     description: |
 *       Get list of container types
 *       Example:  OTH, STR,...
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: isBOH
 *         description: is Back of House
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isFOH
 *         description: is Front of House
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isWRH
 *         description: is Warehouse
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isOffsite
 *         description: is Offsite
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isSystemInv
 *         description: is System inventory
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: backfillEnabled
 *         description: is backfill enabled
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_container_types", Auth(), api.get_container_types);

/**
 * @swagger
 * /api/get_case_container:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get case container information
 *     description: |
 *       Get container infromation at specified location
 *       Example:  container = 12-A; location = SeattleStore
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: container
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_case_container", Auth(), api.get_case_container);

/**
 * @swagger
 * /api/search_containers:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: search for containers
 *     description: |
 *       Search containers in the system.
 *       Example:  label = % to get all containers
 *       Example:  label = A% to get all containers with labels starting with A
 *     parameters:
 *       - name: container
 *         description: label
 *         in: query
 *         required: true
 *         type: string
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/search_containers", Auth(), api.search_containers);

/**
 * @swagger
 * /api/add_container:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: create new container
 *     description: |
 *       Create or Update a container of any type
 *       For locations, Also call /upsert_location_details to provide additional details
 *       Example:  container = 2-12-A; parent = 2-12; container_type = shelf; location = Warehouse
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
 *               container:
 *                 type: string
 *               parent:
 *                 type: string
 *               parentID:
 *                 type: integer
 *               container_type:
 *                 type: string
 *                 enum:
 *                   - SHL
 *                   - RSV
 *                   - CRT
 *                   - TOT
 *                   - MOD
 *                   - OTH
 *                   - WRH
 *                   - STR
 *               location:
 *                 type: string
 *               isApparel:
 *                 type: boolean
 *               user_friendly_name:
 *                 type: string
 *               timezone:
 *                 type: string
 *               is_open:
 *                 type: boolean
 *               warehouse:
 *                 type: string
 *             examples:
 *               container:
 *                 value: 1001-STR
 *                 summary: container barcode
 *               parent:
 *                 value: 1001-WRH
 *                 summary: Parent container barcode
 *               parentID:
 *                 value: 4
 *                 summary: ID of the parent container
 *               container_type:
 *                 value: STR
 *                 summary: type of container, for example, shelf, rack, tote, cart etc.
 *               location:
 *                 value: lynnwood
 *                 summary: Physical store or warehouse location of container
 *               isApparel:
 *                 value: 1
 *                 summary: Is the container apparel
 *               user_friendly_name:
 *                 value: lynnwood
 *                 summary: User Friendly name of store
 *               timezone:
 *                 value: UTC
 *                 summary: Timezone of str
 *               is_open:
 *                 value: 1
 *                 summary: Is the Store open
 *               warehouse:
 *                 value: 1001-WRH
 *                 summary: Warehouse associated to the store
 *             required:
 *               - container
 *               - container_type
 *               - location
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/add_container", Auth(["s_manager", "w_manager", "s_region_manager"]), api.add_container);

/**
 * @swagger
 * /api/add_container_generate:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: create new container
 *     description: |
 *       Create or Update a container of any type
 *       For locations, Also call /upsert_location_details to provide additional details
 *       Example:  container = 2-12-A; parent = 2-12; container_type = shelf; location = Warehouse
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
 *               quantity:
 *                 type: integer
 *               type:
 *                 type: string
 *                 enum:
 *                   - SHL
 *                   - RSV
 *                   - CRT
 *                   - TOT
 *                   - MOD
 *                   - OTH
 *                   - WRH
 *                   - STR
 *               subtype:
 *                 type: string
 *               locationID:
 *                 type: string
 *             examples:
 *               quantity:
 *                 value: 4
 *                 summary: Quantity of containers to create
 *               type:
 *                 value: TOT
 *                 summary: type of container, for example, shelf, rack, tote, cart etc.
 *               subtype:
 *                 value: MEZ
 *                 summary: type of container, for example, MEZ, DMG, CNC etc.
 *               locationID:
 *                 value: 1001-STR
 *                 summary: Physical store or warehouse location of container
 *             required:
 *               - quantity
 *               - type
 *               - locationID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/add_container_generate", Auth(["s_manager", "w_manager", "s_region_manager"]), api.add_container_generate);

/**
 * @swagger
 * /api/delete_container:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: delete one container
 *     description: |
 *       Delete one container
 *       Example: container = 12-A; location = SeattleStore;
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: container
 *         in: query
 *         required: true
 *         type: string
 *       - name: locationID
 *         description: locationID
 *         in: query
 *         required: true
 *         type: string
 *       - name: force
 *         description: force deletion of the container
 *         in: formData
 *         required: false
 *         type: boolean
 *       - name: isBOH
 *         description: is the container Back of House
 *         in: formData
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_container", Auth(["s_manager", "w_manager", "s_region_manager"]), api.delete_container);

module.exports = router;
