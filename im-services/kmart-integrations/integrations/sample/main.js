// Standard Integration requirements
const path = require("path");
const express = require("express");
const router = express.Router();
const INTEGRATION_NAME = path.basename(path.dirname(__filename));
const config = require("./config.js");

// Requirements for this file
// const mysql = require("mysql2"); // Example

async function Main(req, res) {
    console.log("It works");
    res.status(200).send({"message": `This is a new test to see if the Sample API works`});
}

// Standard Integration route and exports; don't change this
router.get(`/${INTEGRATION_NAME}`, Main);

module.exports = router;
