var api = require("../microwarehouse-api/mw_api_debug");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;
var multer = require("multer"); // Handling uploaded files, multipart/form-data
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

/**
 * @swagger
 * /api/CALL_FROM_Kmart_Endpoint:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - debug
 *     summary: Testing apis on KMART network
 *     description: |
 *       A way for us to test kmart api response from anko network
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               httpMethod:
 *                 type: string
 *                 enum:
 *                   - GET
 *                   - POST
 *                   - PUT
 *                   - DELETE
 *               url:
 *                 type: string
 *               endpointType:
 *                 type: string
 *                 enum:
 *                   - TORY
 *                   - STORE
 *                   - INTEGRATION
 *             examples:
 *               httpMethod:
 *                 value: GET
 *                 summary: Kmart internal URL
 *               url:
 *                 value: password
 *                 summary: Kmart internal URL
 *               endpointType:
 *                 value: password
 *                 summary: Type of endpoint TORY or STORE or INTEGRATION
 *             required:
 *               - httpMethod
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.post("/CALL_FROM_Kmart_Endpoint", Auth(["admin"]), api.call_from_kmart_endpoint);


/**
 * @swagger
 * /api/api_gateway_lambda_test:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - debug
 *     summary: Testing api gateway
 *     description: |
 *       A way for us to test api gateway is working inside VPC
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *             examples:
 *               url:
 *                 value: www.kmart.com.au
 *                 summary: Kmart internal URL
 *             required:
 *               - url
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ERROR
 */
router.post("/api_gateway_lambda_test", Auth(["admin"]), api.api_gateway_lambda_test);

module.exports = router;
