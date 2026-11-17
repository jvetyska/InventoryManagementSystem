var api = require("../microwarehouse-api/mw_api_performance_reporting.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/generate_performance_report_data:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - reports
 *     summary: Generates performance report data, updating the SQL table report_performance
 *     description: |
 *       Queries DynamoDB tables for the current UTC days extending to the earliest and latest timezones.
 *       From the data found, it generates performance report data which is then inserted/updated into
 *       the SQL table report_performance
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/generate_performance_report_data", Auth(["s_manager", "s_region_manager", "w_manager"]), api.generate_performance_report_data);

module.exports = router;
