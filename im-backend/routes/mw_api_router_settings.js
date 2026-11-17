const api = require("../microwarehouse-api/mw_api_settings.js");
const express = require("express");
const router = express.Router();
const Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/settings:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - settings
 *     summary: Get all Settings
 *     description: No parameters are required
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/settings", Auth(), api.get_settings);

/**
 * @swagger
 * /api/settings:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - settings
 *     summary: Update Settings
 *     description: |
 *       Update Settings
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 schema:
 *                   $ref: "#/definitions/Settings"
 *             examples:
 *               settings:
 *                 value: [{"property": "string", "category": "string", "value": "string", "type": "string"}]
 *                 summary: Array of settings
 *             required:
 *               - settings
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/settings", Auth(), api.put_settings);

/**
 * @swagger
 * /api/feature_flags:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - default
 *     summary: Get all feature flags that are currently enabled
 *     description: Get all feature flags that are currently enabled
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: getAllFlags
 *         description: Defaults to false. If this flag is passed in as true, then all feature flags will
 *                      be returned to the user instead of the ones that are just currently enabled.
 *                      Only admins have permission to use this flag
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/feature_flags", Auth(), api.get_feature_flags);

/**
 * @swagger
 * /api/db_sql_files:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - default
 *     summary: this api process the SQL folder files and does database seeding
 *     description: this api process the SQL folder files and does database seeding
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/db_sql_files", api.db_sql_files);

module.exports = router;

/**
 * @swagger
 * definitions:
 *   Settings:
 *     type: array
 *     items:
 *       type: object
 *       properties:
 *          property:
 *             type: string
 *          category:
 *             type: string
 *          value:
 *             type: string
 *          type:
 *             type: string
 */
