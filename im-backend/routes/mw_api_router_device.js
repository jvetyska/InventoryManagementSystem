var api = require("../microwarehouse-api/mw_api_device.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/device/get_server_url_for_location:
 *   get:
 *     tags:
 *       - device
 *     summary: Gets the serverURL for a specified location ID
 *     description: Gets all devices
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: location of the serverURL
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/device/get_server_url_for_location", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_server_url_for_location);

/**
 * @swagger
 * /api/device/get_device_printers:
 *   get:
 *     tags:
 *       - device
 *     summary: Gets the device printers
 *     description: Gets the device printers
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/device/get_device_printers", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_device_printers);

/**
 * @swagger
 * /api/device/for_location:
 *   get:
 *     tags:
 *       - device
 *     summary: Gets all devices for location
 *     description: Gets all devices
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: location of the device
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/device/for_location", Auth(), api.device_for_location);

/**
 * @swagger
 * /api/device/network_connected_printers:
 *   get:
 *     tags:
 *       - device
 *     summary: Gets the network-connected printers of a specified store
 *     description: Gets the network-connected printers of a specified store
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: appServer
 *         description: App server for the networked printers. Optional parameter that will only be provided by PDTs
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/device/network_connected_printers", Auth(), api.network_connected_printers);

/**
 * @swagger
 * /api/device/network_connected_print_job:
 *   post:
 *     tags:
 *       - device
 *     summary: Sends a print request to a network printer that was discovered through the GET API network_connected_printers
 *     description: |
 *       Sends a print request to a network printer that was discovered through the GET API network_connected_printers
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               appServer:
 *                 type: string
 *               printerQueue:
 *                 type: string
 *               labelType:
 *                 type: string
 *               data:
 *                 type: string
 *             examples:
 *               appServer:
 *                 value: placeholder
 *                 summary: The app server that the printer network exists on
 *               printerQueue:
 *                 value: placeholder
 *                 summary: The printer queue on the network that this print job should be sent to
 *               labelType:
 *                 value: placeholder
 *                 summary: The label of the print job
 *               data:
 *                 value: placeholder
 *                 summary: The data to print
 *             required:
 *               - appServer
 *               - printerQueue
 *               - labelType
 *               - data
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/device/network_connected_print_job", Auth(), api.network_connected_print_job);

/**
 * @swagger
 * /api/device/update_network_printers:
 *   post:
 *     tags:
 *       - device
 *     summary: Update Network Printers
 *     description: |
 *       Update Network Printers
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
 *               fromLocation:
 *                 type: string
 *               appServer:
 *                 type: string
 *             examples:
 *               locationID:
 *                 value: placeholder
 *                 summary: storeID for which the refresh is being asked
 *               fromLocation:
 *                 value: placeholder
 *                 summary: location of the PDT i.e. - storeNumber in customdata.ini. Append -STR
 *               appServer:
 *                 value: placeholder
 *                 summary: The app server that the printer network exists on
 *             required:
 *               - locationID
 *               - fromLocation
 *               - appServer
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/device/update_network_printers", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_network_printers);

/**
 * @swagger
 * /api/device/add:
 *   put:
 *     tags:
 *       - device
 *     summary: Add device
 *     description: |
 *       Add device
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               printerName:
 *                 type: string
 *               locationID:
 *                 type: string
 *               printerType:
 *                 type: string
 *                 enum:
 *                   - Zebra Printer
 *                   - DYMO Printer
 *               ipAddress:
 *                 type: string
 *               isRFID:
 *                 type: string
 *               appServerAddr:
 *                 type: string
 *             examples:
 *               printerName:
 *                 value: placeholder
 *                 summary: name of the device
 *               locationID:
 *                 value: placeholder
 *                 summary: location of the device
 *               printerType:
 *                 value: placeholder
 *                 summary: type of the device
 *               ipAddress:
 *                 value: placeholder
 *                 summary: IP Address of the device
 *               isRFID:
 *                 value: placeholder
 *                 summary: is the device RFID?
 *               appServerAddr:
 *                 value: placeholder
 *                 summary: Public IP of the local server
 *             required:
 *               - printerName
 *               - locationID
 *               - printerType
 *               - ipAddress
 *               - isRFID
 *               - appServerAddr
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/device/add", Auth(["s_manager", "s_region_manager", "w_manager"]), api.add_device);

/**
 * @swagger
 * /api/device/upsert:
 *   put:
 *     tags:
 *       - device
 *     summary: Update device
 *     description: |
 *       Update device
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               printerName:
 *                 type: string
 *               locationID:
 *                 type: string
 *               printerType:
 *                 type: string
 *                 enum:
 *                   - Zebra Printer
 *                   - DYMO Printer
 *               ipAddress:
 *                 type: string
 *               isRFID:
 *                 type: string
 *               appServer:
 *                 type: string
 *             examples:
 *               printerName:
 *                 value: placeholder
 *                 summary: name of the device
 *               locationID:
 *                 value: placeholder
 *                 summary: location of the device
 *               printerType:
 *                 value: placeholder
 *                 summary: type of the device
 *               ipAddress:
 *                 value: placeholder
 *                 summary: IP Address of the device
 *               isRFID:
 *                 value: placeholder
 *                 summary: is the device RFID?
 *               appServer:
 *                 value: placeholder
 *                 summary: Public IP of the local server
 *             required:
 *               - printerName
 *               - locationID
 *               - printerType
 *               - ipAddress
 *               - isRFID
 *               - appServer
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/device/upsert", Auth(["s_manager", "s_region_manager", "w_manager"]), api.upsert_device);

/**
 * @swagger
 * /api/device/status:
 *   get:
 *     tags:
 *       - device
 *     summary: Gets status of device
 *     description: |
 *       Gets status of device
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: name
 *         description: name of the device
 *         in: query
 *         required: true
 *         type: string
 *       - name: locationID
 *         description: location of the device
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/device/status", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_device_status);

/**
 * @swagger
 * /api/device/delete:
 *   delete:
 *     tags:
 *       - device
 *     summary: Deletes device
 *     description: |
 *       Deletes device
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: Name
 *         description: name of the device
 *         in: query
 *         required: true
 *         type: string
 *       - name: locationID
 *         description: location of the device
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/device/delete", Auth(["s_manager", "s_region_manager", "w_manager"]), api.delete_device);

module.exports = router;
