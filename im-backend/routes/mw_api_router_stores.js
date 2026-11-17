var api = require("../microwarehouse-api/mw_api_stores");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;
var multer = require("multer"); // Handling uploaded files, multipart/form-data
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

/**
 * @swagger
 * /api/env_settings:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - stores
 *     summary: Testing apis on KMART network
 *     description: |
 *       API to get the environment settings of the store, given store_id
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: store_id
 *         description: Store ID
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.get("/env_settings", Auth(), api.env_settings);

module.exports = router;
