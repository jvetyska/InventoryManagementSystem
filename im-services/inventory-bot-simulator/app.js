const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const responses = require("./responses.json");

const app = express();

// view engine setup
app.use(bodyParser.json());
app.use("/", express.static(path.join(__dirname, "/public")));

app.get("/*", async function(req, res) {
    let url = req.path;

    // Ignore the favicon gets that come on most requests
    if (url === "/favicon.ico") {
        return;
    }

    url = url.replace("/v1/", "");

    // Check the JSON response file
    let responseData = responses[url];

    if (!responseData) {
        let filePath;

        // Check for any of the gets which send maps/files
        switch (url) {
        case "getMap":
            filePath = "./GetMapExample.png";
            break;
        case "getRunMap":
            filePath = "./GetRunMapExample.png";
            break;
        case "getRunEvaluationMap":
            filePath = "./GetRunEvaluationMapExample.png";
            break;
        case "getRunInventoryMap":
            filePath = "./GetRunInventoryMapExample.png";
            break;
        case "getInventoryDataFile":
            filePath = "./GetInventoryDataFileExample.txt";
            break;
        default:
            // If we have checked the JSON response file and image/txt files and found nothing, the path is invalid
            console.log("Inventory Bot Get not found for URL:", url);
            res.status(400).json({"message": "Inventory Bot Get not found"});
            return;
        }

        res.status(200).sendFile(filePath, {root: __dirname});
        return;
    }

    console.log("Sending response for Inventory Bot Get URL:", url);
    res.status(200).json(responseData);
});

app.post("/*", async function(req, res) {
    let url = req.originalUrl;

    if (url[0] === "/") {
        url = url.substr(1);
    }

    console.log("Sending response for Inventory Bot POST URL:", url);
    res.status(200).json({"message": "Inventory Bot POST!"});
});

module.exports = app;
