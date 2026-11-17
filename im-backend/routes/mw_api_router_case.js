var api = require("../microwarehouse-api/mw_api_case.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/case/get_related_keycodes:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Gets the related keycodes from a keycode
 *     description: |
 *       Given a single keycode, this will find all related keycodes of that keycode. A related keycode is defined as having the same exact Style_ID and Secondary_Colour
 *
 *       Example: keycode = 68311957
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: keycode
 *         description: The keycode to find related keycodes for
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/case/get_related_keycodes", Auth(), api.get_related_keycodes);

/**
 * @swagger
 * /api/case/get_case_inventory:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Gets case inventory for a specific case barcode at a location
 *     description: |
 *       Gets case inventory for a specific case barcode at a location. If a location is not provided, then it will search across all locations
 *
 *       Example:
 *
 *       barcode: CS-0-42492863
 *
 *       location: FIF1-WRH
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: barcode
 *         description: The Barcode/ID of the case
 *         in: query
 *         required: true
 *         type: string
 *       - name: location
 *         description: The location to search (Warehouse or Store ID). If this isn't provided, it will search across all locations
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/case/get_case_inventory", Auth(), api.get_case_inventory);

/**
 * @swagger
 * /api/case/get_case_barcode:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Gets a barcode from the server
 *     description: |
 *       Gets a barcode from the server
 *
 *       These keycodes all have the same Style_ID and Secondary_Colour: 66619918, 66619925, 66619932, 66619949, 66619956, 66619963
 *
 *       These keycodes all have the same Style_ID and Secondary_Colour: 68311957, 68311964, 68311971, 68311988, 68311995, 68312008, 68312015
 *
 *       These keycodes all DO NOT HAVE a Style_ID: 37538590, 41140055, 42201519
 *     consumes:
 *       - application/json
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               keycodes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     keycode:
 *                       type: integer
 *                     quantity:
 *                       type: integer
 *               Password:
 *                 type: string
 *             examples:
 *               keycodes:
 *                 value: 4
 *                 summary: An array of objects, with each object describing the keycode and its quantity
 *             required:
 *               - keycodes
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/case/get_case_barcode", api.get_case_barcode);

/**
 * @swagger
 * /api/case/get_blank_cx_barcodes:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Creates 1-99 blank CX barcodes that will be updated later
 *     description: |
 *       Creates 1-99 blank CX barcodes that will be updated later
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: integer
 *             examples:
 *               quantity:
 *                 value: 4
 *                 summary: The number of blank CX barcodes to allocate
 *             required:
 *               - quantity
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/case/get_blank_cx_barcodes", api.get_blank_cx_barcodes);

/**
 * @swagger
 * /api/case/get_custom_case_barcode:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Creates a new custom mixed case based on the contents of a container
 *     description: |
 *       Creates a new custom mixed case based on the contents of a container and then deletes the virtual contents of that container after the barcode is created
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               containerId:
 *                 type: string
 *             examples:
 *               containerId:
 *                 value: 4
 *                 summary: The ID of the container to create a new custom mixed case barcode from. This MUST be a shelf. If creating the new custom mixed case barcode suceeds, then the inventory in this container will be deleted
 *             required:
 *               - containerId
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/case/get_custom_case_barcode", api.get_custom_case_barcode);

/**
 * @swagger
 * /api/case/create_case_inventory:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Inserts new row(s) into inventory_case
 *     description: |
 *       The only thing the user needs to pass in is a barcode. The barcode's associated keycodes and their quantities will be looked up in the table case_barcode and then added to the table inventory_case
 *
 *       Example barcodes: MX-0000000001, MX-0000000002, MX-0000000003, CS-0-41140055, CS-1-41140055
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               barcode:
 *                 type: string
 *               containerId:
 *                 type: string
 *             examples:
 *               barcode:
 *                 value: CX-9209302
 *                 summary: The barcode to check against the case_barcode table
 *               containerId:
 *                 value: 1001-SHL-CSK4
 *                 summary: The container ID
 *             required:
 *               - barcode
 *               - containerId
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/case/create_case_inventory", Auth(), api.create_case_inventory);

/**
 * @swagger
 * /api/case/create_case_content:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Inserts new row(s) into inventory_case
 *     description: |
 *       The only thing the user needs to pass in is a barcode. The barcode's associated keycodes and their quantities will be looked up in the table case_barcode and then added to the table inventory_case
 *
 *       Example barcodes: MX-0000000001, MX-0000000002, MX-0000000003, CS-0-41140055, CS-1-41140055
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               barcode:
 *                 type: string
 *               keycode:
 *                 type: string
 *               sourceLocation:
 *                 type: string
 *               quantity:
 *                 type: string
 *             examples:
 *               barcode:
 *                 value: CX-2393442
 *                 summary: The barcode to check against the case_barcode table
 *               keycode:
 *                 value: 13223232
 *                 summary: product keycode
 *               sourceLocation:
 *                 value: 1001-SHL-2323
 *                 summary: container where the stuff is coming from
 *               quantity:
 *                 value: 34
 *                 summary: quantity of the stuff that needs to be created
 *             required:
 *               - barcode
 *               - keycode
 *               - sourceLocation
 *               - quantity
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/case/create_case_content", Auth(), api.create_case_content);

/**
 * @swagger
 * /api/case/create_case_content_from_container:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Inserts new row(s) into inventory_case
 *     description: |
 *       The only thing the user needs to pass in is a barcode and sourceLocation
 *
 *       Example barcodes: MX-0000000001, MX-0000000002, MX-0000000003, CS-0-41140055, CS-1-41140055
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               barcode:
 *                 type: string
 *               sourceLocation:
 *                 type: string
 *             examples:
 *               barcode:
 *                 value: CX-9209302
 *                 summary: The barcode to check against the case_barcode table
 *               sourceLocation:
 *                 value: 1001-SHL-CSK4
 *                 summary: container where the stuff is coming from
 *             required:
 *               - barcode
 *               - sourceLocation
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/case/create_case_content_from_container", Auth(), api.create_case_content_from_container);

/**
 * @swagger
 * /api/case/update_blank_cx_barcode:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - case_inventory
 *     summary: Updates a blank CX barcode
 *     description: |
 *       Updates a blank CX barcode
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: data
 *         description: An array of objects, with each object describing the keycode and its quantity
 *         in: body
 *         required: true
 *         schema:
 *           $ref: "#/definitions/ObjUpdateBlankCxBarcode"
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/case/update_blank_cx_barcode", api.update_blank_cx_barcode);

module.exports = router;

/**
 * @swagger
 * definitions:
 *   ObjUpdateBlankCxBarcode:
 *     type: object
 *     properties:
 *       barcode:
 *         type: string
 *       keycodes:
 *         type: array
 *         items:
 *           type: object
 *           properties:
 *             keycode:
 *               type: integer
 *             quantity:
 *               type: integer
 *
 *   ObjGetCaseBarcode:
 *     type: object
 *     properties:
 *       quantityValidationRequired:
 *         type: boolean
 *       keycodes:
 *         type: array
 *         items:
 *           type: object
 *           properties:
 *             keycode:
 *               type: integer
 *             quantity:
 *               type: integer
 */
