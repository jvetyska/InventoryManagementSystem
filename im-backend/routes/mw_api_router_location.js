const api = require("../microwarehouse-api/mw_api_location.js");
const express = require("express");
const router = express.Router();
const Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/get_locations:
 *   get:
 *     security: []
 *     tags:
 *       - container
 *     summary: get container information
 *     description: |
 *       Get the locations of all containers that have a NULL parent, location should be open and not archived.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: isArchived
 *         description: Include Archived locations
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_locations", api.get_locations);

/**
 * @swagger
 * /api/get_locations_by_type:
 *   get:
 *     security: []
 *     tags:
 *       - container
 *     summary: get container information
 *     description: |
 *          Get container infromation from the specified type
 *          Example:  type=STR
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: type
 *         description: type
 *         in: query
 *         required: true
 *         type: string
 *         enum:
 *           - STR
 *           - WRH
 *       - name: warehouse
 *         description: filter by warehouse
 *         in: query
 *         required: false
 *         type: string
 *         enum:
 *           - LYN1-WRH
 *           - FIF1-WRH
 *       - name: open
 *         description: Filter locations currently open. 0 => All locations. 1 => Open locations. 2 => Open and Opening locations.
 *         in: query
 *         required: false
 *         type: number
 *       - name: archived
 *         description: Filter locations currently archived 0 => Un-archived locations. 1 => archived locations. 2 => All locations archived as well as un-archived
 *         in: query
 *         required: false
 *         type: number
 *       - name: replenishEnabled
 *         description: filter only locations currently replenished
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_locations_by_type", api.get_locations_by_type);

/**
 * @swagger
 * /api/get_cluster_locations:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get location information organized by clusters
 *     description: |
 *          Get location information organized by clusters
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: isArchived
 *         description: Include Archived locations
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_cluster_locations", Auth(), api.get_cluster_locations);

/**
 * @swagger
 * /api/get_location_details:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: Returns expanded location details
 *     description: |
 *          Returns full location details. As long as container exists, location can be empty and will be returned as valid response.
 *          Example:  location=MIL1-STR
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: location
 *         description: Location ID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_location_details", Auth(), api.get_location_details);

/**
 * @swagger
 * /api/get_store_replenishment_groups:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get store replenishment groups
 *     description: |
 *       Gets the store replenishment groups from a provided store ID
 *     parameters:
 *       - name: storeId
 *         description: The ID of the store
 *         in: query
 *         required: true
 *         type: string
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_store_replenishment_groups", Auth(), api.get_store_replenishment_groups);

/**
 * @swagger
 * /api/upsert_location_details:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: insert/update location details
 *     description: |
 *       Update Insert/Update Location Details
 *       Example:  locationID = LYN1-STR, Name = Lynwood Store, Address: ...
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
 *               location_id:
 *                 type: string
 *               name:
 *                 type: string
 *               internal_name:
 *                 type: string
 *               parentID:
 *                 type: string
 *               timezone:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip:
 *                 type: string
 *               phone_number:
 *                 type: string
 *               hours:
 *                 type: string
 *               lat:
 *                 type: integer
 *               lng:
 *                 type: integer
 *               is_open:
 *                 type: boolean
 *               store_default_mdu:
 *                 type: integer
 *               is_mdu:
 *                 type: boolean
 *               has_fhbh:
 *                 type: boolean
 *               warehouse_id:
 *                 type: string
 *               days_of_coverage:
 *                 type: integer
 *               opening_date:
 *                 type: string
 *               ext_source:
 *                 type: string
 *               display_order:
 *                 type: integer
 *               DCLocationID:
 *                 type: string
 *               storefrontImage:
 *                 type: string
 *               isCrossDockEnabled:
 *                 type: boolean
 *               isArchived:
 *                 type: boolean
 *               maxInventoryTaskUnits:
 *                 type: integer
 *               inventoryTaskGroupSize:
 *                 type: integer
 *               server_url:
 *                 type: string
 *             examples:
 *               location_id:
 *                 value: placeholder
 *                 summary: location barcode
 *               name:
 *                 value: placeholder
 *                 summary: user friendly name
 *               internal_name:
 *                 value: placeholder
 *                 summary: friendly name for internal use
 *               parentID:
 *                 value: placeholder
 *                 summary: ID of the parent
 *               timezone:
 *                 value: placeholder
 *                 summary: timezone of the location
 *               address:
 *                 value: placeholder
 *                 summary: street address
 *               state:
 *                 value: placeholder
 *                 summary: state
 *               zip:
 *                 value: placeholder
 *                 summary: zip code
 *               phone_number:
 *                 value: placeholder
 *                 summary: phone number
 *               hours:
 *                 value: placeholder
 *                 summary: description of hours of operations
 *               lat:
 *                 value: placeholder
 *                 summary: Latitude of location
 *               lng:
 *                 value: placeholder
 *                 summary: Longitude of location
 *               is_open:
 *                 value: placeholder
 *                 summary: Is the location currently open for business?
 *               store_default_mdu:
 *                 value: placeholder
 *                 summary: The store's default MDU
 *               is_mdu:
 *                 value: placeholder
 *                 summary: Is the replenished by mdu
 *               has_fhbh:
 *                 value: placeholder
 *                 summary: Is the replenished by mdu
 *               warehouse_id:
 *                 value: placeholder
 *                 summary: Warehouse associated with this store
 *               days_of_coverage:
 *                 value: placeholder
 *                 summary: Multiplier for replenishment
 *               opening_date:
 *                 value: placeholder
 *                 summary: Date Store Opens
 *               ext_source:
 *                 value: placeholder
 *                 summary: External Aisle Source (Deprecated)
 *               display_order:
 *                 value: placeholder
 *                 summary: Display Order of store location (used for anko.com)
 *               DCLocationID:
 *                 value: placeholder
 *                 summary: Distribution Center associated with this store (Deprecated)
 *               storefrontImage:
 *                 value: placeholder
 *                 summary: Image for storefront of location (used for anko.com)
 *               isCrossDockEnabled:
 *                 value: placeholder
 *                 summary: Is Crossdock enabled at location (Deprecated)
 *               isArchived:
 *                 value: placeholder
 *                 summary: Is the location Archived
 *               maxInventoryTaskUnits:
 *                 value: placeholder
 *                 summary: Max Inventory Task Units
 *               inventoryTaskGroupSize:
 *                 value: placeholder
 *                 summary: The number of keycodes to Group by
 *               server_url:
 *                 value: placeholder
 *                 summary: Server URL
 *             required:
 *               - location_id
 *               - name
 *               - timezone
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/upsert_location_details", Auth(["s_manager", "s_region_manager", "w_manager", "s_region_manager"]), api.upsert_location_details);

/**
 * @swagger
 * /api/get_location_departments:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: get location department information
 *     description: |
 *       Get location department information
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: locationID
 *         description: locationID for which you want to get department name
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_location_departments", Auth(), api.get_location_departments);

/**
 * @swagger
 * /api/update_location_departments:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - container
 *     summary: update location department information
 *     description: |
 *       update location department infromation
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
 *               departmentNameArray:
 *                 type: array
 *                 items:
 *                   type: array
 *                   items:
 *                     type: string
 *             examples:
 *               locationID:
 *                 value: placeholder
 *                 summary: locationID for which you want to update department name
 *               departmentNameArray:
 *                 value: placeholder
 *                 summary: |
 *                   EX. ['WMS BOTTOMS', 'WMS FOOTWEAR']
 *             required:
 *               - locationID
 *               - departmentNameArray
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_location_departments", Auth(), api.update_location_departments);

/**
 * @swagger
 * /api/get_location_hierarchy:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - location
 *     summary: Returns a JSON object in tree format the hierarchy based on the user level and their hierarchy assignment
 *     description: |
 *       Returns a JSON object in tree format the hierarchy based on the user level and their hierarchy assignment
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: Unassigned
 *         description: Include Unassigned locations
 *         in: query
 *         required: false
 *         type: boolean
 *       - name: isArchived
 *         description: Include Archived locations
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_location_hierarchy", Auth(), api.get_location_hierarchy);

/**
 * @swagger
 * /api/get_assignable_locations:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - location
 *     summary: Get all location hierarchy IDs without children (leaf nodes)
 *     description: |
 *       Get all location hierarchy IDs without children (leaf nodes)
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_assignable_locations", Auth(["admin", "s_manager", "s_region_manager", "w_manager",]), api.get_assignable_locations);

/**
 * @swagger
 * /api/get_unassigned_locations:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - location
 *     summary: Get all IDs in the location table that aren't in the location_hierarchy_locations table
 *     description: |
 *       Get all IDs in the location table that aren't in the location_hierarchy_locations table
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_unassigned_locations", Auth(["admin", "s_manager", "s_region_manager", "w_manager",]), api.get_unassigned_locations);

/**
 * @swagger
 * /api/upsert_location_hierarchy:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - location
 *     summary: Creates or updates a hierarchical location
 *     description: |
 *       Creates a new or updates an existing hierarchical location. Specify either LocationHierarchyID or ParentID,
 *       but not both. You may specify neither of them in order to create a new top-level hierarchical location
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Name:
 *                 type: integer
 *               LocationHierarchyID:
 *                 type: string
 *               ParentID:
 *                 type: string
 *             examples:
 *               Name:
 *                 value: placeholder
 *                 summary: Name to give a new hierarchical location or to update an existing one
 *               LocationHierarchyID:
 *                 value: placeholder
 *                 summary: The ID of the Location Hierarchy to update
 *               ParentID:
 *                 value: placeholder
 *                 summary: The parent ID of the new location hierarchy. This is optional and will create a new top-level hierarchical location if left NULL
 *             required:
 *               - Name
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/upsert_location_hierarchy", Auth(["admin", "s_region_manager"]), api.upsert_location_hierarchy);

/**
 * @swagger
 * /api/assign_locations_to_hierarchy:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - location
 *     summary: Assign a store location to an existing hierarchical location
 *     description: |
 *       Assigns IDs of store locations to an existing hierarchical location.
 *       Only levels with no children may have a location assigned.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               LocationHierarchyID:
 *                 type: integer
 *               description:
 *                 type: string
 *             examples:
 *               LocationHierarchyID:
 *                 value: 4
 *                 summary: The ID of the Location Hierarchy. This level MUST NOT have any children
 *               StoreIDs:
 *                 value: placeholder
 *                 summary: A csv of the Store Location IDs that will be assigned to the above Location Hierarchy ID. Not providing this paramter will remove all locations
 *             required:
 *               - LocationHierarchyID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/assign_locations_to_hierarchy", Auth(["admin", "s_region_manager"]), api.assign_locations_to_hierarchy);

/**
 * @swagger
 * /api/delete_location_hierarchy:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - location
 *     summary: Deletes a hierarchical location
 *     description: |
 *       Deletes an existing hierarchical location. The structure MUST be empty or else an error will be returned.
 *       This means that the hierarchical location MUST NOT have and children, and MUST NOT have any locations assigned to it in location_hierarchy_locations
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationHierarchyID
 *         description: The ID of the Location Hierarchy
 *         in: query
 *         required: true
 *         type: number
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_location_hierarchy", Auth(["admin", "s_region_manager"]), api.delete_location_hierarchy);

module.exports = router;
