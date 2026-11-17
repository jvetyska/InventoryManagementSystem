/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

// Setup the Express framework
const fs = require("fs");
const AWSXRay = require("aws-xray-sdk");
const express = require("express");
const { xrayEnabled, axios, AWS, http, addXrayAnnotations, instrumentDbPool  } = require("./library/xray");
const mysql = require('mysql2/promise');
global.config = require("./config/config.js");
global.settings = require("./config/settings.js");
global.roles = require("./config/roles.js");
const helper = require("./library/helperFn");
const cors = require("cors");
const app = express();
const SwaggerUI = require("swagger-ui-express");
const SwaggerJSDoc = require("swagger-jsdoc");
const logger = require("./library/logger")("app");


AWSXRay.setContextMissingStrategy("LOG_ERROR");
app.use(cors({credentials: true, origin: true, allowedHeaders: "Content-Type,Authorization,Authorization-Pin,Device-Token,Device-Location,Device-Name,User-Name"}));

const cluster = require("cluster");
let workers = [];

process.env.TZ = "UTC"; // IMPORTANT!!! - FORCE environment timezone to UTC. Otherwise mysql2 converts all returned dates and times to local TZ.

/**
 * Setup number of worker processes to share port which will be defined while setting up server
 */
const setupWorkerProcesses = function() {
    // to read number of cores on system
    // 4 threads per vCPU in Fargate
    // ContainerDefinition for WMS container value is set to 1024 or 1vCPU
    // Each vCPU appears to have 4 hyperthreads, so setting numCores should match what is set in dosa-cloudformation params for ECSAnkousContainerCPU
    let numCores = config.cluster_cores;
    // let numCores = require("os").cpus().length;
    // if (numCores > 2) {
    //     numCores = 2; // Limit to 2 max as our AWS instances max out at 2.
    // }
    logger.info(`Master cluster setting up ${numCores} workers`);

    // iterate on number of cores need to be utilized by an application
    // current example will utilize all of them
    for (let i = 0; i < numCores; i++) {
        // Creating workers and pushing reference in an array. These references can be used
        // to receive messages from workers. Also pass the worker its ID, so that only ID 0
        // will test the APIs if the environment variable "TEST_PIPELINE" is enabled.
        workers.push(cluster.fork({WORKER_ID: i}));

        // to receive messages from worker process
        workers[i].on("message", function(message) {
            console.log(message);

            // Currently, "EXIT" is only received from a child after a child completes the API tests
            // which are run when a new commit/merge is executed on Bitbucket. This lets the parent
            // know that it should exit so that Bitbucket can continue on with its script.
            if (message === "EXIT") {
                process.exit(0);
            }
        });
    }

    // process is clustered on a core and process id is assigned
    cluster.on("online", function(worker) {
        console.log(`Worker ${worker.process.pid} is listening `);
    });

    // if any of the worker process dies then start a new one by simply forking another one
    cluster.on("exit", function(worker, code, signal) {
        console.log(`Worker ${worker.process.pid} died with code: ${code} and signal ${signal}`);
        logger.info("Starting a new worker");
        workers.push(cluster.fork());
        // to receive messages from worker process
        workers[workers.length-1].on("message", function(message) {
            console.log(message);
        });
    });
};

async function InitializeLocationTimezoneMaps() {
    /* Initialize Location-Timezone maps
     * We will need to build a map of locations-to-timezones so that when one of these two methods are called...
     * 1. logging.js        => inventory_log()
     * 2. mw_api_logging.js => start_task()
     * ...they will know which timezone to use when logging information. This is a much better solution than
     * making one SQL query to get the timezone every single time one of the above API methods are called */
    global.locationTimezoneMap = {};

    let sql = `
        SELECT loc.ID, loc.Timezone
        FROM container c
        INNER JOIN location loc ON loc.ID = c.LocationID`;
    let [results] = await pool.query(sql);

    for (let row of results) {
        let id = row.ID;
        let timezone = row.Timezone;
        let location = id.split("-")[0];
        global.locationTimezoneMap[location] = {
            timezone: timezone,
            location: id
        };
    }
}

const getConfig = async ()=> {
    try {
        let secret = await new AWS.SecretsManager({region: global.config.aws_region}).getSecretValue({SecretId: global.config.secret_name}).promise();
        secret = JSON.parse(secret.SecretString);
        return Object.assign({}, global.config, secret[global.config.env_type]);
    } catch (error) {
        logger.info("From Layers get AWS secret Error", {error});
    }
};

/**
 * Setup an express server and define port to listen all incoming requests for this application
 */
const setUpExpress = () => {
    // create server
    app.server = http.createServer(app);
    if (xrayEnabled) {
        app.use(AWSXRay.express.openSegment(`Dosa-${config.env_type}`));
        app.use(addXrayAnnotations);
    }
    setTimeout(async function() {
        global.pool = instrumentDbPool(mysql.createPool({
            host: config.sql_host,
            user: config.sql_user,
            password: config.sql_password,
            database: config.sql_database,
            multipleStatements: true,
            connectionLimit: config.mysql.db_connection_limit,
            queueLimit: config.mysql.db_queue_limit
        }));

        global.ro_pool = instrumentDbPool(mysql.createPool({
            host: config.sql_host_ro,
            user: config.sql_user,
            password: config.sql_password,
            database: config.sql_database,
            multipleStatements: true,
            connectionLimit: config.mysql.db_ro_connection_limit,
            queueLimit: config.mysql.db_ro_queue_limit
        }));

        logger.info("DB_pool created...");
        await helper.updateSystemSettings();
        await InitializeLocationTimezoneMaps();

        // If TEST_PIPELINE is enabled, and this is the first worker (0th index)
        if (parseInt(process.env.TEST_PIPELINE) === 1 && parseInt(process.env.WORKER_ID) === 0) {
            // Fork a new node process, running testapi.js
            let child = require("child_process").fork("test/testapi.js");
            child.on("exit", function() {
                // The child has exited; either all tests have completed or there was an error
                // Regardless, tell the parent to exit now so that Bitbucket can continue with its script
                process.send("EXIT");
            });
        }
    }, 100);

    // Configure bodyParser settings for the application
    var bodyParser = require("body-parser");
    app.use(bodyParser.urlencoded({extended: true})); // Allow us to get data from a POST request
    // Along with this limit, also set the nginx limit client_max_body_size which can be found in .ebextensions/01_files.config
    app.use(bodyParser.json({"limit": "100mb"}));     // Set the maximum size for a request to 100 MB
    app.use(bodyParser.raw({type: function(req) {     // Get raw data buffer when AWS sends a subscription confirmation
        return req.headers["x-amz-sns-message-type"] == "SubscriptionConfirmation";
    }}));

    // Intercept requests to confirm AWS SNS subscriptions
    app.use(async function(req, res, next) {
        if (req.headers["x-amz-sns-message-type"] && req.headers["x-amz-sns-message-type"] == "SubscriptionConfirmation") {
            var body = JSON.parse(req.body.toString("utf-8"));
            var SubscribeURL = body["SubscribeURL"];
            await axios.get(SubscribeURL);
            res.status(200).json({"message": "OK"});
            return;
        }
        next();
    });

    // Set the default scheme to be either HTTP or HTTPS depending on if the api_host is local or not
    var schemes;
    if (config.api_host.indexOf("localhost") != -1)
        schemes = ["http", "https"];
    else
        schemes = ["https", "http"];

    var SetupRoutes = function(file, data) {
        return new Promise((done) => {
            // Loop through and use all of the routes in routes dir
            const routeFolder = "./routes/";

            fs.readdir(routeFolder, (err, files) => {
                files.forEach(file => {
                    if (file.indexOf(".js") > -1) {
                        app.use("/api", require(routeFolder + file));
                    }
                });

                done();
            });
        });

    };

    const options = {
        definition: {
            openapi: "3.0.1",
            info: {
                title: `Ankous APIs${(config.isProduction === false ? ` [DEVELOPMENT]` : "")}`,
                version:"3.0.0",
                description: "Ankous API Server"
            },
            tags: [
                // Put the tag blocks in a custom order for displaying on the Swagger page
                {"name": "inventory_bot"},
                {"name": "backfill"},
                {"name": "account_management"},
                {"name": "location"},
                {"name": "logging"},
                {"name": "replenish_order"},
                {"name": "taskgroup"},
                {"name": "task"},
                {"name": "product"},
                {"name": "inventory"},
                {"name": "schedule"},
                {"name": "random_inventory_checks"},
                {"name": "container"},
                {"name": "device"},
                {"name": "help"},
                {"name": "scheduled_job"},
                {"name": "debug"},
                {"name": "cross_dock"},
                {"name": "case_inventory"},
            ],
            servers: [{
                url: config.api_host
            }],
            components: {
                securitySchemes: {
                    login: {
                        type: 'http',
                        scheme: 'basic'
                    }
                }
              },
              security: [{
                login: []
              }]
        },
        apis: ["./routes/*.js"]
    }

    const specs = SwaggerJSDoc(options);

    const SwaggerUIOptions = {
        explorer: true
    };

    app.use("/api-docs", SwaggerUI.serve, SwaggerUI.setup(specs, SwaggerUIOptions))

    SetupRoutes();

    app.disable("x-powered-by");

    // routes
    //setRouter(app);

    // set keepalive timeout for server
    const KEEP_ALIVE = 2 * 60 * 1000; // 2 minutes
    app.server.setTimeout(KEEP_ALIVE);
    app.server.keepAliveTimeout = KEEP_ALIVE;
    app.server.headersTimeout = KEEP_ALIVE;

    // start server
    const port = process.env.PORT || "3000";
    app.server.listen(port, () => {
        console.log(`Started server on => http://localhost:${app.server.address().port} for Process Id ${process.pid}`);
    });

    // in case of an error
    app.on("error", (appErr, appCtx) => {
        console.error("app error", appErr.stack);
        console.error("on url", appCtx.req.url);
        console.error("with headers", appCtx.req.headers);
    });

    if (xrayEnabled) {
        app.use(AWSXRay.express.closeSegment());
    }
};

/**
 * Setup server either with clustering or without it
 * @param isClusterRequired
 * @constructor
 */
const setupServer = (isClusterRequired) => {
    // if it is a master process then call setting up worker process
    if (isClusterRequired && cluster.isMaster) {
        setupWorkerProcesses();
    } else {
        // to setup server configurations and share port address for incoming requests
        setUpExpress();
    }
};

/*
 * Load the config into global scope, setup logging and
 * configure and run the ExpressJS server hosing the API.
 */
const startup = async() => {
    global.config = await getConfig();

    logger.info("CONFIG VALUE SQL_HOST: ", {sqlHost: config.sql_host});
    logger.info("CONFIG VALUE API_HOST: ", {apiHost: config.api_host});
    logger.info("CONFIG VALUE IS_CLUSTER_ENABLED: ", {clusterEnabled: config.is_cluster_enabled});
    logger.info("ENV_TYPE", {envType: process.env.ENV_TYPE});

    setupServer(config.is_cluster_enabled);
};

(() => {
    const logSetupCompletion = () => {
        const msg = cluster.isMaster ?
            "Master process setup complete" :
            "Worker process setup complete";
        logger.info(msg);
    };

    if (xrayEnabled) {
        const xrayNs = AWSXRay.getNamespace();
        xrayNs.run(async function () {
            const startupTrace = new AWSXRay.Segment(`Dosa-${config.env_type}`);
            try {
                AWSXRay.setSegment(startupTrace);
                await startup();
                logSetupCompletion();
            } finally {
                startupTrace.close();
            }
        });
    } else {
        startup().then(logSetupCompletion);
    }
})();

// In order to get full screen working on the scanners, this specific JSON data needs to be reachable at this exact URL: /.well-known/assetlinks.json
app.get("/.well-known/assetlinks.json", async function(req, res) {
    res.status(200).json([{
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
            namespace: "android_app",
            package_name: "com.anko.TeamConnector",
            sha256_cert_fingerprints: ["4D:5C:1F:0F:F5:F1:96:83:76:91:A6:6B:9A:4D:D2:9C:41:3F:88:8A:6E:49:E8:4A:DC:65:67:89:65:73:7E:C8"]
        }
    }]);
});

module.exports = app;
