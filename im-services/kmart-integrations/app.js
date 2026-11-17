const express = require("express");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
const INTEGRATION_DIRECTORY = "./integrations";
const bodyParser = require("body-parser");
const aws = require("aws-sdk");
const config = require("./config/config");
const  http = require('http');
const cluster = require("cluster");
global.settings = require("./config/settings.js");
const numCores = 4;

let workers = [];
// Create the server, allow CORS, and listen on port 80
const app = express();
app.use(cors());

// create server
app.server = http.createServer(app);

// set keepalive timeout for server
const KEEP_ALIVE = 2 * 60 * 1000; // 2 minutes
app.server.setTimeout(KEEP_ALIVE);
app.server.keepAliveTimeout = KEEP_ALIVE;
app.server.headersTimeout = KEEP_ALIVE;

// start server
const port = "8080";


if (cluster.isMaster) {
  console.log(`Primary ${process.pid} is running`);
  // Fork workers.
  for (let i = 0; i < numCores; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
    // create server
    app.server = http.createServer(app);
    // set keepalive timeout for server
    const KEEP_ALIVE = 2 * 60 * 1000; // 2 minutes
    app.server.setTimeout(KEEP_ALIVE);
    app.server.keepAliveTimeout = KEEP_ALIVE;
    app.server.headersTimeout = KEEP_ALIVE;

    // start server
    const port = "8080";
    app.server.listen(port, () => {
        console.log(`Started server on => http://localhost:${app.server.address().port} for Process Id ${process.pid}`);
    });

  console.log(`Worker ${process.pid} started`);
}


app.use(bodyParser.urlencoded({extended: true})); // Allow us to get data from a POST request
app.use(bodyParser.json({"limit": "100mb"}));     // Set the maximum size for a request to 100 MB

// Read the directory specified for routes, and include all JavaScript files
let files = fs.readdirSync(INTEGRATION_DIRECTORY);
files.forEach(integration => {
    let files = fs.readdirSync(`${INTEGRATION_DIRECTORY}/${integration}`);
    files.forEach(file => {
        if (file === "main.js") {
            app.use("/api", require(`${INTEGRATION_DIRECTORY}/${integration}/main.js`));
        }
    });
});

// update system settings
const updateSettings = async () => {
    let secret_name = null;
    let aws_region = null;

    try {
        if(config[process.env.ENV_TYPE] && config[process.env.ENV_TYPE].secret_name) {
            secret_name = config[process.env.ENV_TYPE].secret_name;
            aws_region = config[process.env.ENV_TYPE].aws_region;
            // fetching secrets
            let secret = await new aws.SecretsManager({region: aws_region}).getSecretValue({SecretId: secret_name}).promise();
            secret = JSON.parse(secret.SecretString);
            secret = secret[process.env.ENV_TYPE];
            global.PIMS_DB = secret.PIMS_DB;
            global.IPS_DB = secret.IPS_DB;
        } else {
            global.PIMS_DB = null;
            global.IPS_DB = null;
        }
    } catch (error) {
        console.log("error occured while fetching secrets");
        console.error(error.message);
        global.PIMS_DB = null;
        global.IPS_DB = null;
    }
};


updateSettings();

