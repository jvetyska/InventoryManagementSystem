var api = require("../microwarehouse-api/mw_api_help.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;
var multer = require("multer"); // Handling uploaded files, multipart/form-data
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });


/**
 * @swagger
 * /api/glossary:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Returns all the records in the glossary
 *     description: |
 *       Retrieve all the fields in the glossary
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.get("/glossary", api.get_glossary);

/**
 * @swagger
 * /api/glossary:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Create a new help record containing the title, description
 *     description:
 *       Creates a record in the database of the title, description, datecreated and dateupdated.
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ID:
 *                 type: integer
 *               Title:
 *                 type: string
 *               Description:
 *                 type: string
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: Id of the glossary term. Provide an id field if you would like to update an existing term
 *               Title:
 *                 value: placeholder
 *                 summary: Short Title of the term
 *               Description:
 *                 value: placeholder
 *                 summary: 2000 char description of the term in detail
 *             required:
 *               - Title
 *               - Description
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/glossary", Auth(["admin", "s_manager", "s_region_manager", "w_manager"]), api.post_glossary);

/**
 * @swagger
 * /api/glossary:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Deletes a glossary term
 *     description: Delete a glossary term
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: glossaryId
 *         description: glossary id
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/glossary",Auth(["admin", "s_manager", "s_region_manager", "w_manager"]), api.delete_glossary);

/**
 * @swagger
 * /api/get_help_files:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Retrieve files for type
 *     description: |
 *       Retrieve files for type
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: Type
 *         description: Video or Document
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.get("/get_help_files", api.get_help_files);

/**
 * @swagger
 * /api/get_help_file:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Retrieve file
 *     description: |
 *       Retrieve file
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ID
 *         description: ID of Video or Document
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.get("/get_help_file", api.get_help_file);

/**
 * @swagger
 * /api/update_file_order:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Updates the Display Order of files
 *     description: |
 *        Updates the Display Order of files
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               displayOrder:
 *                 schema:
 *                   $ref: "#/definitions/FileDisplayOrder"
 *             examples:
 *               displayOrder:
 *                 value: 4
 *                 summary: Array of IDs and Display Orders
 *             required:
 *               - displayOrder
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_file_order", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_file_order);

/**
 * @swagger
 * /api/upload_help_file:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Mark Video as Viewed by User.
 *     description: |
 *       Set a timestamp for a user that they have viewed this video.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: file
 *               type:
 *                 type: string
 *               format:
 *                 type: string
 *               name:
 *                 type: string
 *               order:
 *                 type: string
 *               description:
 *                 type: string
 *             examples:
 *               file:
 *                 value: placeholder
 *                 summary: File to Uploade
 *               type:
 *                 value: placeholder
 *                 summary: Type of file (document, video)
 *               format:
 *                 value: placeholder
 *                 summary: Format of file
 *               name:
 *                 value: placeholder
 *                 summary: Display Name of file
 *               order:
 *                 value: placeholder
 *                 summary: Order to display file
 *               description:
 *                 value: placeholder
 *                 summary: Description of the file
 *             required:
 *               - file
 *               - type
 *               - format
 *               - name
 *               - order
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.post("/upload_help_file", Auth(), upload.single("file"), api.upload_help_file);

/**
 * @swagger
 * /api/update_file:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - inventory
 *     summary: Updates the Display Order of files
 *     description: |
 *        Updates the Display Order of files
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
 *               description:
 *                 type: string
 *               filename:
 *                 type: string
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: The ID of file
 *               description:
 *                 value: placeholder
 *                 summary: Description of the file
 *               filename:
 *                 value: placeholder
 *                 summary: Name of the file
 *             required:
 *               - ID
 *               - filename
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_file", Auth(["s_manager", "s_region_manager", "w_manager"]), api.update_file);


/**
 * @swagger
 * /api/delete_help_file:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Deletes a file
 *     description: Delete a selected file
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: fileID
 *         description: ID of the file to delete
 *         in: query
 *         required: true
 *         type: string
 *       - name: fileName
 *         description: name of the file to delete
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/delete_help_file", Auth(["s_manager", "s_region_manager", "w_manager"]), api.delete_help_file);

/**
 * @swagger
 * /api/add_help_watched:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Add data to tables
 *     description: Add data to help_files and help_watched tables
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
 *             examples:
 *               ID:
 *                 value: 4
 *                 summary: ID of the file and User for creating/updating records
 *             required:
 *               - ID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/add_help_watched", Auth(["admin", "s_manager", "s_region_manager", "w_manager"]),api.add_help_watched);

/**
 * @swagger
 * /api/get_training_data:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - help
 *     summary: Display Training info
 *     description: |
 *       Display users who watched trining + total views
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */

router.get("/get_training_data", Auth(["admin", "s_manager", "s_region_manager", "w_manager"]), api.get_training_data);

module.exports = router;

/**
 * @swagger
 * definitions:
 *  FileDisplayOrder:
 *      type: array
 *      items:
 *          type: object
 *          properties:
 *              ID:
 *                  type: string
 *              DisplayOrder:
 *                  type: string
 */
