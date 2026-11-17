const api = require("../microwarehouse-api/mw_api_cross_dock.js");
const express = require("express");
const router = express.Router();
const Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/cross_dock/replenish_order:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - cross_dock
 *     summary: Generates replenishment for Cross-Dock Enabled stores after a bulk-stow is performed
 *     description: |
 *       After a user bulk-stows to a warehouse RCV location, this API will be automatically be called on
 *       the container ID to generate replenishment for the stores that have isCrossDockEnabled set to True
 *     parameters:
 *       - name: ContainerID
 *         description: The warehouse container that was just bulk-stowed to
 *         in: formData
 *         required: true
 *         type: string
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/cross_dock/replenish_order", Auth(), api.cross_dock_replenish_order);

/**
 * @swagger
 * /api/cross_dock/replenish_order_to_task:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - cross_dock
 *     summary: Generates tasks from replenishment for Cross-Dock Enabled stores
 *     description: |
 *       Generates tasks from replenishment for Cross-Dock Enabled stores
 *     parameters:
 *       - name: LocationID
 *         description: The warehouse ID that will perform Cross-Dock task creation. You may also use an RCV container ID to get the same results
 *         in: formData
 *         required: true
 *         type: string
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/cross_dock/replenish_order_to_task", Auth(), api.cross_dock_replenish_order_to_task);

/**
 * @swagger
 * /api/cross_dock/get_locations:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - cross_dock
 *     summary: TODO
 *     description: |
 *       Gets a list of current target locations for the provided RCV location which will be Cross Dock-enabled stores.
 *       This will also include the warehouse itself if we need to keep products in the warehouse location.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: SourceContainer
 *         description: ID of the RCV container
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/cross_dock/get_locations", Auth(), api.cross_dock_get_locations);

/**
 * @swagger
 * /api/cross_dock/get_task:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - cross_dock
 *     summary: TODO
 *     description: |
 *       TODO
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: SourceContainer
 *         description: ID of the RCV container. You must provide this AND the Barcode if you aren't providing a TaskID
 *         in: query
 *         required: false
 *         type: string
 *       - name: Barcode
 *         description: Barcode/SKU of the product (can also be a keycode). You must provide this AND the SourceContainer if you aren't providing a TaskID
 *         in: query
 *         required: false
 *         type: integer
 *       - name: TaskID
 *         description: ID the task. SourceContainer and Keycode will be ignored if you provide this
 *         in: query
 *         required: false
 *         type: integer
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/cross_dock/get_task", Auth(), api.cross_dock_get_task);

/**
 * @swagger
 * /api/cross_dock/update_task:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - cross_dock
 *     summary: TODO
 *     description: |
 *       TODO
 *     parameters:
 *       - name: SourceContainer
 *         description: RCV location
 *         in: formData
 *         required: true
 *         type: string
 *       - name: TargetContainer
 *         description: CRT of destination
 *         in: formData
 *         required: true
 *         type: string
 *       - name: Quantity
 *         description: Number of products
 *         in: formData
 *         required: true
 *         type: integer
 *       - name: Barcode
 *         description: Barcode/SKU of the product (can also be a keycode)
 *         in: formData
 *         required: true
 *         type: integer
 *       - name: TaskID
 *         description: ID of the task
 *         in: formData
 *         required: false
 *         type: integer
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/cross_dock/update_task", Auth(), api.cross_dock_update_task);

module.exports = router;
