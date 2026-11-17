var api = require("../microwarehouse-api/mw_api_inventory.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/container_inventory:
 *   get:
 *     tags:
 *       - inventory
 *     summary: get current inventory of container
 *     description: |
 *       Get current container inventory
 *       Example: container barcode = 555555
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: container bacode
 *         in: query
 *         required: true
 *         type: string
 *       - name: getLocationInventory
 *         description: If true, then force select inventory data instead of a location's containers
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/container_inventory", Auth(), api.get_container_inventory);

/**
 * @swagger
 * /api/stow_locations:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Get locations to stow within store or warehouse
 *     description: |
 *       Get locations to stow within store or warehouse
 *
 *       Example: barcode = 023100109251; location = LYN1-WRH
 *
 *       Returns all containers where the product is located
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: barcode
 *         description: barcode of requested item
 *         in: query
 *         required: true
 *         type: string
 *       - name: location
 *         description: Store or Warehouse where to search
 *         in: query
 *         required: true
 *         type: string
 *       - name: isCase
 *         description: If we want to get stow locations for cases; defaults to false
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/stow_locations", Auth(), api.get_stow_locations);

/**
 * @swagger
 * /api/product_inventory:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: get inventory of selected product within store or warehouse
 *     description: |
 *       Get inventory of selected product within store or warehouse
 *
 *       You must provide either a Keycode OR ProductID. If both are provided, then the ProductID parameter will be ignored
 *       Example:    barcode = 023100109251;  location = Warehouse;
 *       Returns all containers where the product is located
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: keycode
 *         description: keycode of requested item
 *         in: query
 *         required: false
 *         type: string
 *       - name: location
 *         description: Store or Warehouse where to search
 *         in: query
 *         required: true
 *         type: string
 *       - name: container_type
 *         description: Restrict results to specific type
 *         in: query
 *         required: false
 *         type: string
 *       - name: get_available
 *         description: Return only available units in inventory
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/product_inventory", Auth(), api.get_product_inventory);

/**
 * @swagger
 * /api/inventory_by_style:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: get inventory of selected product group with the same style ID at current location
 *     description: |
 *       get inventory of selected product group with the same style ID at current location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: style
 *         description: Style ID of the Product
 *         in: query
 *         required: true
 *         type: integer
 *       - name: location
 *         description: Store or Warehouse for inventory numbers
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_by_style", Auth(), api.get_inventory_by_style);

/**
 * @swagger
 * /api/cluster_inventory:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: get Inventory information for each location in the cluster
 *     description: |
 *       get inventory count for each location in the cluster.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: barcode
 *         description: barcode of requested item
 *         in: query
 *         required: false
 *         type: string
 *       - name: keycode
 *         description: keycode of requested item
 *         in: query
 *         required: false
 *         type: string
 *       - name: location
 *         description: Store or Warehouse where to search
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/cluster_inventory", Auth(), api.get_cluster_inventory);

/**
 * @swagger
 * /api/cart_inventory:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: get current inventory for a cart
 *     description: |
 *       Get current Cart inventory
 *       Data is based on associated tasks
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: cart bacode
 *         in: query
 *         required: true
 *         type: string
 *       - name: taskID
 *         description: Optional associated task ID
 *         in: query
 *         required: false
 *         type: integer
 *       - name: noVerification
 *         description: Remove Verification
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/cart_inventory", Auth(), api.get_cart_inventory);

/**
 * @swagger
 * /api/inventory_overages:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: get inventory overages
 *     description: |
 *       get inventory overages for target container
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: target container
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/inventory_overages", Auth(), api.get_inventory_overages);

/**
 * @swagger
 * /api/create_inventory:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Insert new product into inventory
 *     description: |
 *       Insert new product into inventory
 *       Example:  barcode = 555555; container = 2-13-A;
 *       Adds Product 555555 into container 2-13-A.
 *
 *       You must provide either keycode or barcode. If both are provided, it defaults to keycode
 *     consumes:
 *       - application/x-www-form-urlencoded
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
 *                 type: string
 *               barcode:
 *                 type: string
 *               container:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               process:
 *                 type: string
 *             examples:
 *               keycode:
 *                 value: placeholder
 *                 summary: keycode of a product to add into inventory
 *               barcode:
 *                 value: placeholder
 *                 summary: barcode of a product to add into inventory, OR a barcode of a case to add into inventory_case
 *               container:
 *                 value: placeholder
 *                 summary: container barcode where product is being added to
 *               quantity:
 *                 value: placeholder
 *                 summary: the amount of products to create which defaults to 1 if not provided
 *               process:
 *                 value: placeholder
 *                 summary: the name of the process which called insert_inventory
 *             required:
 *               - container
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/create_inventory", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot", "w_receive", "w_receivecase"]), api.create_inventory);

/**
 * @swagger
 * /api/adjust_inventory:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Updates inventory for a product
 *     description: |
 *       This user will specify an exact amount of products for a loction. This API
 *       will call either create_inventory or delete_inventory the appropriate amount
 *       of times in order to update the virtual inventory.
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
 *                 type: integer
 *               container:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               task_id:
 *                 type: integer
 *               restricted:
 *                 type: boolean
 *               process:
 *                 type: string
 *               reason:
 *                 type: string
 *             examples:
 *               barcode:
 *                 value: placeholder
 *                 summary: the barcode/product id
 *               container:
 *                 value: placeholder
 *                 summary: container where the product will have its quantity be updated
 *               quantity:
 *                 value: placeholder
 *                 summary: the amount of products to move which defaults to 1 if not provided
 *               task_id:
 *                 value: placeholder
 *                 summary: task id
 *               restricted:
 *                 value: placeholder
 *                 summary: restricted to elevated permission
 *               process:
 *                 value: placeholder
 *                 summary: the name of the process which called adjust_inventory
 *               reason:
 *                 value: placeholder
 *                 summary: user chosen reason for inventory discrepancy between Anko inventory and external inventory (Kmart inventory)
 *             required:
 *               - barcode
 *               - container
 *               - quantity
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/adjust_inventory", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot", "s_inventorycount", "w_inventorycount"]), api.adjust_inventory);

/**
 * @swagger
 * /api/adjust_shelf_inventory:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Updates inventory for specific shelf all at once
 *     description: |
 *       This API accepts list of inventory of an entire shelf passed in as JSON object.
 *       It will then remove inventory for the shelf and add inventory as specified.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ContainerID:
 *                 type: string
 *               Data:
 *                 type: string
 *               TaskID:
 *                 type: string
 *               Process:
 *                 type: string
 *             examples:
 *               ContainerID:
 *                 value: placeholder
 *                 summary: the ContainerID of the Shelf
 *               Data:
 *                 value: placeholder
 *                 summary: JSON array of Barcode/Quantity values
 *               TaskID:
 *                 value: placeholder
 *                 summary: Optional associated Task ID to be completed.
 *               Process:
 *                 value: placeholder
 *                 summary: the name of the process which called adjust_shelf_inventory
 *             required:
 *               - ContainerID
 *               - Data
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/adjust_shelf_inventory", Auth(["w_manager", "w_inventorycount", "w_troubleshoot"]), api.adjust_shelf_inventory);

/**
 * @swagger
 * /api/reconcile_inventory:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Reconcile Inventory of source container
 *     description: |
 *       Gets inventory and inventory overages and then inserts those into the inventory adjustment table and then deletes inventory
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               container:
 *                 type: string
 *               Process:
 *                 type: string
 *             examples:
 *               container:
 *                 value: placeholder
 *                 summary: container
 *               Process:
 *                 value: placeholder
 *                 summary: the name of the process which called w-inv-reconcile
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/reconcile_inventory", Auth(), api.reconcile_inventory);

/**
 * @swagger
 * /api/move_inventory:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Move product from source container into target container
 *     description: |
 *       Move product from source container into target container
 *       If TaskID is provided, move inventory reserved for that task.
 *       Otherwise, move available inventory if possible.
 *       Example:  barcode = 555555; source_container = 2-13-A; target_container = 2-12-D;
 *       Assigns Product 555555 from 2-13-A to 2-12-D.
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
 *                 type: integer
 *               keycode:
 *                 type: integer
 *               source_container:
 *                 type: string
 *               target_container:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               task_id:
 *                 type: integer
 *               process:
 *                 type: string
 *               allowOverage:
 *                 type: boolean
 *               inAvailableOnly:
 *                 type: boolean
 *             examples:
 *               barcode:
 *                 value: 232323
 *                 summary: product barcode
 *               keycode:
 *                 value: 232323
 *                 summary: product keycode
 *               source_container:
 *                 value: placeholder
 *                 summary: container barcode where product is being moved FROM
 *               target_container:
 *                 value: placeholder
 *                 summary: container barcode where product is being moved TO
 *               quantity:
 *                 value: 4
 *                 summary: the amount of products to move which defaults to 1 if not provided
 *               task_id:
 *                 value: 4
 *                 summary: Task ID under which this inventory is reserved. (Does not work with inAvailableOnly)
 *               process:
 *                 value: placeholder
 *                 summary: the name of the process which called move_inventory
 *               allowOverage:
 *                 value: 1
 *                 summary: allow move inventory to create inventory if does not exist
 *               inAvailableOnly:
 *                 value: 1
 *                 summary: Only allow user to use available quantity (Does not work with TaskID)
 *             required:
 *               - source_container
 *               - target_container
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/move_inventory", Auth(), api.move_inventory);

/**
 * @swagger
 * /api/move_inventory_rfid:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Move product from source container into target container via RFID antennas
 *     description: |
 *       Move product from source container into target container
 *       If TaskID is provided, move inventory reserved for that task.
 *       Otherwise, move available inventory if possible.
 *       Example:  barcode = 555555; tagid: E1938172727; source_container = 2-13-A; target_container = 2-12-D;
 *       Assigns Product 555555 from 2-13-A to 2-12-D.
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
 *                 type: integer
 *               keycode:
 *                 type: integer
 *               tagid:
 *                 type: string
 *               source_container:
 *                 type: string
 *               target_container:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               task_id:
 *                 type: integer
 *             examples:
 *               barcode:
 *                 value: 232323
 *                 summary: product barcode
 *               keycode:
 *                 value: 232323
 *                 summary: product keycode
 *               tagid:
 *                 value: 232323
 *                 summary: product RFID tag identifier
 *               source_container:
 *                 value: placeholder
 *                 summary: container barcode where product is being moved FROM
 *               target_container:
 *                 value: placeholder
 *                 summary: container barcode where product is being moved TO
 *               quantity:
 *                 value: 4
 *                 summary: the amount of products to move which defaults to 1 if not provided
 *               task_id:
 *                 value: 4
 *                 summary: Task ID under which this inventory is reserved. (Does not work with inAvailableOnly)
 *             required:
 *               - barcode
 *               - keycode
 *               - tagid
 *               - source_container
 *               - target_container
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/move_inventory_rfid", Auth(), api.move_inventory_rfid);

/**
 * @swagger
 * /api/move_inventory_bulk:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Move all products from source container into target container
 *     description: |
 *       Move all products from source container into target container
 *       Example: source_container = 2-13-A; target_container = 2-12-D;
 *       Assigns all products in container 2-13-A to container 2-12-D
 *     produces:
 *       - application/json
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
 *               process:
 *                 type: string
 *             examples:
 *               source_container:
 *                 value: placeholder
 *                 summary: container barcode where product is being moved FROM
 *               target_container:
 *                 value: placeholder
 *                 summary: container barcode where product is being moved TO
 *               process:
 *                 value: placeholder
 *                 summary: Task ID under which this inventory is reserved. (Does not work with inAvailableOnly)
 *             required:
 *               - source_container
 *               - target_container
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/move_inventory_bulk", Auth(["w_manager", "s_manager", "s_region_manager", "w_bulkstow", "s_bulkstow"]), api.move_inventory_bulk);

/**
 * @swagger
 * /api/reserve_inventory:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Reserve Inventory for a Task
 *     description: |
 *       Reserve specific amount of inventory for a task.
 *       Returns Results from sql update, use data.affectedRows value.
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
 *                 type: integer
 *               keycode:
 *                 type: integer
 *               container:
 *                 type: string
 *               task_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *             examples:
 *               barcode:
 *                 value: 423242424
 *                 summary: product barcode to reserve
 *               keycode:
 *                 value: placeholder
 *                 summary: product keycode to reserve
 *               container:
 *                 value: placeholder
 *                 summary: container where to reserve the inventory
 *               task_id:
 *                 value: placeholder
 *                 summary: Task ID under which this inventory is reserved.
 *               quantity:
 *                 value: placeholder
 *                 summary: Quantity of inventory to reserve.
 *             required:
 *               - container
 *               - task_id
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/reserve_inventory", Auth(["admin"]), api.reserve_inventory);

/**
 * @swagger
 * /api/delete_inventory:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Remove product from inventory
 *     description: |
 *       Remove product from inventory
 *       Example:  barcode = 555555; container = 2-13-A;
 *       Removes Product 555555 from 2-13-A.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: barcode
 *         description: product barcode
 *         in: query
 *         required: false
 *         type: string
 *       - name: keycode
 *         description: product keycode
 *         in: query
 *         required: false
 *         type: number
 *       - name: container
 *         description: container barcode where product is being REMOVED from
 *         in: query
 *         required: true
 *         type: string
 *       - name: quantity
 *         description: the amount of products to remove which defaults to 1 if not provided
 *         in: query
 *         required: false
 *         type: string
 *       - name: process
 *         description: the name of the process which called delete_inventory
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_inventory", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot", "w_removeinventory"]), api.delete_inventory);

/**
 * @swagger
 * /api/delete_inventory_nb:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Remove product from inventory - Non-blocking version
 *     description: |
 *       Remove product from inventory - does not check current inventory level.
 *       Logs the actual requested quantity and the quantity deleted.
 *       Removes Product 555555 from 2-13-A.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: barcode
 *         description: product barcode
 *         in: query
 *         required: false
 *         type: string
 *       - name: keycode
 *         description: product keycode
 *         in: query
 *         required: false
 *         type: number
 *       - name: container
 *         description: container barcode where product is being REMOVED from
 *         in: query
 *         required: true
 *         type: string
 *       - name: quantity
 *         description: the amount of products to remove which defaults to 1 if not provided
 *         in: query
 *         required: false
 *         type: integer
 *       - name: process
 *         description: the name of the process which called delete_inventory_nb
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_inventory_nb", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot", "w_removeinventory"]), api.delete_inventory_nb);

/**
 * @swagger
 * /api/delete_inventory_bulk:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Remove all products in a Container from inventory
 *     description: |
 *       Remove all products in a Container from inventory - does not check current inventory level.
 *       Logs the actual requested quantity and the quantity deleted.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: container
 *         description: container barcode where product is being REMOVED from
 *         in: query
 *         required: true
 *         type: string
 *       - name: task_id
 *         description: Associated task ID
 *         in: query
 *         required: false
 *         type: integer
 *       - name: process
 *         description: the name of the process which called delete_inventory_bulk
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_inventory_bulk", Auth(["s_manager", "s_region_manager", "w_manager", "w_troubleshoot", "w_removeinventory"]), api.delete_inventory_bulk);

/**
 * @swagger
 * /api/debug_get_inventory:
 *   get:
 *     tags:
 *       - inventory
 *     summary: get inventory
 *     description: |
 *       Get current  inventory
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
 *       - name: isCase
 *         description: is it a case
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/debug_get_inventory", Auth(), api.debug_get_inventory);

/**
 * @swagger
 * /api/inventory_cases_to_eaches:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Breaks Cases down to individual keycodes
 *     description: |
 *       Breaks Cases down to individual keycodes
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ContainerID:
 *                 type: string
 *               process:
 *                 type: string
 *             examples:
 *               ContainerID:
 *                 value: placeholder
 *                 summary: Container
 *               process:
 *                 value: placeholder
 *                 summary: Description of the file
 *             required:
 *               - ContainerID
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/cases_to_eaches", Auth(), api.inventory_cases_to_eaches);

/**
 * @swagger
 * /api/inventory_delivery:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Updates delivery or pickup
 *     description: |
 *          Updates delivery or pickup in the task table
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ContainerID:
 *                 type: string
 *               LocationID:
 *                 type: string
 *               Status:
 *                 type: string
 *               process:
 *                 type: string
 *             examples:
 *               ContainerID:
 *                 value: placeholder
 *                 summary: Container that is being delivered
 *               LocationID:
 *                 value: placeholder
 *                 summary: Location that it is being delivered to
 *               Status:
 *                 value: placeholder
 *                 summary: Either PICKEDUP or DELIVERED to determine which type to do
 *               process:
 *                 value: placeholder
 *                 summary: the name of the process which called inventory cases to eaches
 *             required:
 *               - ContainerID
 *               - LocationID
 *               - Status
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/inventory_delivery", Auth(), api.inventory_delivery);

/**
 * @swagger
 * /api/start_store_inventory_count:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Enables wall-to-wall inventory counting
 *     description: |
 *          Enables wall-to-wall inventory counting for a store by setting the flag "isInventoryCounted" to true
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
 *             examples:
 *               locationID:
 *                 value: placeholder
 *                 summary: ID of the store
 *             required:
 *               - locationID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/start_store_inventory_count", Auth(["s_manager", "s_region_manager"]), api.start_store_inventory_count);

/**
 * @swagger
 * /api/store_inventory_count:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Records quantity for wall-to-wall inventory counting
 *     description: |
 *          Records the quantity of a product for wall-to-wall inventory counting
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
 *               keycode:
 *                 type: integer
 *               quantity:
 *                 type: string
 *               quantityOverride:
 *                 type: boolean
 *             examples:
 *               locationID:
 *                 value: placeholder
 *                 summary: ID of the store
 *               keycode:
 *                 value: 23242323
 *                 summary: Keycode of the product
 *               quantity:
 *                 value: 3
 *                 summary: Quantity of the product, defaulting to 1 if this parameter is not provided
 *               quantityOverride:
 *                 value: placeholder
 *                 summary: Defaults to false. If this is true, then the quantity will be set exactly to the specified number, instead of being added to the current existing count
 *             required:
 *               - locationID
 *               - keycode
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/store_inventory_count", Auth(), api.store_inventory_count);

/**
 * @swagger
 * /api/store_inventory_count:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Gets the Current information about w2w inventory count
 *     description: |
 *          Gets the Current information about w2w inventory count
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: ID of the store
 *         in: formData
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/store_inventory_count", Auth(), api.store_inventory_details);

/**
 * @swagger
 * /api/end_store_inventory_count:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Completes wall-to-wall inventory counting
 *     description: |
 *          Completes wall-to-wall inventory counting for a store by setting the flag "isInventoryCounted" to false
 *          and performing various other actions such as updating inventory if it's within a certain threshold,
 *          creating inventory tasks if it is outside the threshold, grouping any inventory tasks it may have created,
 *          and sending a log file to S3 anko-whm-logging/wall-to-wall-thresholds on the status of all thresholds.
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
 *               action:
 *                 type: string
 *                 enum:
 *                   - cancel
 *                   - overThreshold
 *               recountKeycodes:
 *                 type: array
 *                 items:
 *                   type: string
 *             examples:
 *               locationID:
 *                 value: placeholder
 *                 summary: ID of the store
 *               action:
 *                 value: placeholder
 *                 summary: Optional parameter defaulting to null. "cancel" will cancel the store's inventory count. "overThreshold" will
 *               recountKeycodes:
 *                 value: placeholder
 *                 summary: An array of keycodes that will be recounted, meaning inventory tasks will be created for each keycode
 *             required:
 *               - locationID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/end_store_inventory_count", Auth(["s_manager", "s_region_manager"]), api.end_store_inventory_count);

/**
 * @swagger
 * /api/adjust_container_inventory:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Updates inventory for a product
 *     description: |
 *        Adjust container inventory called after rfid get_inventory_data
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Body:
 *                 schema:
 *                   $ref: "#/definitions/AdjustContainerInventory"
 *             examples:
 *               Body:
 *                 value: 4
 *                 summary: Two properties; the first is a ContainerID, and the second is an array of objects that contain properties Barcode, EPC, and Certainty. Keycode is optional
 *             required:
 *               - Body
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/adjust_container_inventory", Auth(), api.adjust_container_inventory);

/**
 * @swagger
 * /api/download_inventory_adjustment_report:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Generates inventory adjustment csv file
 *     description: |
 *       Generates the inventory adjustment csv file
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: type
 *         description: type of adjustment
 *         in: query
 *         required: true
 *         type: string
 *       - name: from
 *         description: Start Date
 *         in: query
 *         required: true
 *         type: string
 *       - name: to
 *         description: End Date
 *         in: query
 *         required: true
 *         type: string
 *       - name: containerID
 *         description: containerID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/download_inventory_adjustment_report", Auth(["admin"]), api.download_inventory_adjustment_report);

/**
 * @swagger
 * /api/download_inventory_report:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Generates inventory file
 *     description: |
 *       Generates the inventory file
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/download_inventory_report", Auth(["admin"]), api.download_inventory_report);

/**
 * @swagger
 * /api/map_inventory_info:
 *   get:
 *     tags:
 *       - inventory
 *     summary: Gets the Current inventory information for the rfid map
 *     description: |
 *       Gets the Current inventory information for the rfid map
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: ID of the store
 *         in: query
 *         required: true
 *         type: string
 *       - name: keycodeArray
 *         description: comma seperated keycode list
 *         in: query
 *         required: true
 *         type: array
 *         items:
 *           type: string
 *       - name: ContainerArray
 *         description: comma seperated Container list to get only keycode in that container
 *         in: query
 *         required: false
 *         type: array
 *         items:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/map_inventory_info", Auth(), api.get_map_inventory_info);



module.exports = router;

/**
 * @swagger
 * definitions:
 *   AdjustContainerInventory:
 *     type: object
 *     properties:
 *       ContainerID:
 *         type: string
 *       Data:
 *         type: array
 *         items:
 *           type: object
 *           properties:
 *             Barcode:
 *               type: string
 *             EPC:
 *               type: string
 *             Certainty:
 *               type: string
 *     example:
 *       ContainerID: TST1-BOH-A1
 *       Data:
 *         - Barcode: 9311103396770
 *           EPC: 32163A22CAFDE8000000271A
 *           Certainty: 0.4
 *         - Barcode: 9311103396770
 *           EPC: 32163A22CAFDE80000004550
 *           Certainty: 0.5
 *         - Barcode: 9311103396787
 *           EPC: 32163A22CAFDE8000000987F
 *           Certainty: 0.6
 */
