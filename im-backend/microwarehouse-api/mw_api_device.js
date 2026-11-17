const helper = require("../library/helperFn");
const apiRequest = require("../library/apiRequest");
const ProxyAPIRequester = require("../library/proxyAPIRequest");
const logger = require("../library/logger")("microwarehouse-api:mw_api_device");

exports.get_server_url_for_location = async function(req, res) {
    let locationID = req.query.locationID || null; // Required
    let sql, args, results, serverURL;

    if (!locationID) {
        res.status(400).json({"message": "locationID is a required parameter!"});
        return;
    }

    args = [locationID];
    sql = `SELECT ServerURL FROM location WHERE ID = ?`;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_server_url_for_location", {error});
        res.status(500).json({"message": `Error while getting the serverURL for the location`});
        return;
    }

    if (results.length === 0) {
        res.status(404).json({"message": `No serverURL was found for the current location`});
        return;
    } else {
        serverURL = results[0]["ServerURL"];
    }

    res.status(200).json({"data": serverURL});
};

exports.get_device_printers = async function(req, res) {
    let results;

    try {
        [results] = await ro_pool.query(`SELECT Name FROM device_printer_type`);
    } catch (error) {
        logger.error("get_device_printers", {error});
        res.status(500).json({"message": `Error while getting the device printers`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.update_network_printers = async function(req, res) {
    const LocationID = helper.trimVal(req.body.locationID);
    const appServer = helper.trimVal(req.body.appServer);
    const fromLocation = helper.trimVal(req.body.fromLocation);
    let sql, args, networkPrinters;
    let results = [];
    if (!LocationID && !appServer && !fromLocation) {
        res.status(400).json({"message": "locationID and appServer are required parameters!"});
        return;
    }
    if (fromLocation !==  LocationID) {
        res.status(400).json({"message": `Cannot update printers of ${LocationID} from ${fromLocation}`});
        return;
    }
    try {
        networkPrinters = await apiRequest.get(req, "device/network_connected_printers", {appServer: appServer});
        for (let printer of networkPrinters.data) {
            /* Example of a printer object:
             * {
             *   PrinterID          : 1,
             *   PrinterType        : "BOP",
             *   PrinterDisplaySeqID: 1,
             *   PrinterDescription : "Back office printer #1",
             *   PrinterQueue       : "KV1156NM010",
             *   PrinterIP          : 10.119.236.52
             * }
             */

            // Some properties don't exist from the network_connected_printers API, so they'll be an empty string.
            // The property "networkPrinter" will be set to true so that the frontend can easily identify devices
            // that were discovered over the network, as those will be handled different when executing a print request
            let PrinterIP = (printer.PrinterIP == undefined || printer.PrinterIP == null) ? null : printer.PrinterIP;
            if (printer.PrinterType == "RFID") {
                results.push([printer.PrinterQueue, LocationID, printer.PrinterType, appServer, 1, PrinterIP]);
            }
        }
    } catch (error) {

        // An error occurring from the network_connected_printers API should not stop
        // this device_for_location API from returning any valid data it may have, so
        // we don't respond and return with an error-code status
        logger.error("update_network_printers", {error});
        res.status(500).json({"message": "Failed to update the Network Printers"});
        return;
    }
    // Delete all network printers for location and insert new printers
    sql = `
        INSERT INTO device_integration (Name, LocationID, Type, PrintServer, isRFID, IPAddress)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        Type=VALUES(Type),
        PrintServer=VALUES(PrintServer),
        isRFID=VALUES(isRFID),
        IPAddress=VALUES(IPAddress);`;
    args = [results];
    try {
        if (results.length > 0) {
            [results] = await pool.query(sql, args);
        }
    } catch (error) {
        logger.error("update_network_printers", {error});
        res.status(500).json({"message": "Failed to update the Network Printers"});
        return;
    }
    res.status(200).json({"message": "Network Printers Updated."});
};

exports.device_for_location = async function(req, res) {
    const LocationID = helper.trimVal(req.query.locationID);
    let sql, args, results;

    if (!LocationID) {
        res.status(400).json({"message": "locationID is a required parameter!"});
        return;
    }

    args = LocationID;
    sql = `
        SELECT
            di.Name,
            di.LocationID,
            di.Type,
            di.IPAddress,
            di.isRFID,
            loc.ServerURL AS ServerPublicIP,
            di.PrintServer
        FROM device_integration di
        INNER JOIN location loc ON loc.ID = di.LocationID
        WHERE loc.ID = ?`;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("device_get_available", {error});
        res.status(500).json({"message": `Error while attempting to get devices.`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.network_connected_printers = async function(req, res) {
    let appServer = req.query.appServer || null; // Required
    let data;
    logger.info("STARTING: network_connected_printers");
    console.log(`appServer: ${appServer}`);
    if (!appServer) {
        res.status(400).json({"message": "An appServer must be provided"});
        return;
    }
    let appServerFQDN = `${appServer}${config.kmart_store_api_domain}`;
    try {
        // Example of appServer: kv1154na001.core.kmtltd.net.au:33383
        let kmartApi = `${appServerFQDN}/api/str/Store/StorePrinters`;
        console.log(`>>>>> KmartAPI >>>>> ${kmartApi}`);
        let response = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.GET, ProxyAPIRequester.ENDPOINT_TYPE.STORE, kmartApi, {});
        console.log(`>>>>> Status >>>>> ${response.status}`);

        if (response.status === 200) {
            /* The response is an array of objects which are structured below:
             * {
             *   PrinterID          : 1,
             *   PrinterType        : "BOP",
             *   PrinterDisplaySeqID: 1,
             *   PrinterDescription : "Back office printer #1",
             *   PrinterQueue       : "KV1156NM010",
             *   PrinterIP          : 10.119.236.52
             * }
             */
            data = response.data;
            console.log(data);
            // Note: If we're testing through ProxyAPIRequester.CallAPI() then ssoData will be wrapped around another response.data
            if ("response" in data) {
                data = data.response.data;
            }
        } else {
            console.log(response);
            res.status(500).json({message: "Unable to retrieve data from the integration API"});
            return;
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({message: "Unable to retrieve data from the integration API"});
        return;
    }

    res.status(200).json({data: data});
};

exports.network_connected_print_job = async function(req, res) {
    let appServer = req.body.appServer || null;
    let printerQueue = req.body.printerQueue || null;
    let labelType = req.body.labelType || null;
    let data = req.body.data || null;
    let zplData;

    if (!appServer || !printerQueue || !labelType || !data) {
        res.status(400).json({message: "All body properties are required: appServer, printerQueue, labelType, data"});
        return;
    }

    if (labelType === "username") {
        try {
            zplData = helper.GenerateUsernameZPL(data);
        } catch (error) {
            res.status(400).json({message: error});
            return;
        }
    } else if (labelType === "product") {
        try {
            zplData = helper.GenerateProductBarcodeZPL(data);
        } catch (error) {
            res.status(400).json({message: error});
            return;
        }
    } else {
        res.status(400).json({message: "Invalid label type, it must be either 'username' or 'product'"});
        return;
    }

    // Example of appServer: kv1154na001.core.kmtltd.net.au:33383
    // Derive the appServerID from the appServer
    let appServerID = appServer.split(".")[0];
    let printerName = `\\\\${appServerID}\\\\${printerQueue}`;
    let body = {
        PrinterName: printerName,
        Data: zplData,
    };

    /* Sample API call with body
     * POST: https://kv1154na001.core.kmtltd.net.au:33383/api/Printing/PrintJob
     * Body:
     * {
     *     PrinterName: "\\\\kv1154na001\\\\KV1154WP011",
     *     Data: "^XA^FO80,10,0^A1,14,14^FDRED DOUGH TUB^FS^FO80,40,0^A1,12,12^FD42369561^FS^FO220,40,0^A1,12,12^FDnull^FS^FO80,55,0^A1,10,10^FDNO SIZE^FS^FO220,55,0^A1,10,10^FDRED^FS^FO80,70,2^A1,10,10^FDPRESCHOOL TOYS^FS^FO140,90^BY2^BEN,30,Y,N^FD934110401685^FS^RFW,H^FD30363a22c001a577d739d99c^FS^XZ"
     * }
     */

    try {
        // Uncomment this and comment the above when deploying the our environments
        let kmartApi = `${appServer}/api/Printing/PrintJob`;
        let response = await ProxyAPIRequester.CallAPI(ProxyAPIRequester.HTTP_METHOD.POST, ProxyAPIRequester.ENDPOINT_TYPE.STORE, kmartApi, body);

        if (response.status !== 200) {
            console.log(response);
            res.status(500).json({message: "Failed to send print request to the networked printer"});
            return;
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({message: "Failed to send print request to the networked printer"});
        return;
    }

    res.status(200).json({message: "The print request has successfully been sent to the queue"});
};

exports.add_device = async function(req, res) {
    const locationID = req.body.locationID || null;   // Required
    const printerName = req.body.printerName || null; // Required
    const printerType = req.body.printerType || null; // Required
    const ipAddress = req.body.ipAddress || null;     // Either
    const appServerAddr = req.body.appServerAddr || null; // Or
    const isRFID = req.body.isRFID || 0;
    let sql, results, args;

    // Validate required parameters
    if (!printerName || !locationID) {
        res.status(400).json({"message": `Missing required parameters: name, locationID`});
        return;
    }

    if (!ipAddress && !appServerAddr) {
        res.status(400).json({"message": `Either ipAddress or appServerAddr must be present`});
        return;
    }

    sql = `
        SELECT *
        FROM device_integration di
        WHERE di.LocationID = ? AND di.Name = ?`;

    args = [locationID, printerName];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("get_device_status", {error});
        res.status(500).json({"message": `Error while attempting to get device status.`});
        return;
    }

    if (results.length) {
        res.status(500).json({"message": `Printer already exists.`});
        return;
    }

    args = [printerName, locationID, printerType, ipAddress, appServerAddr, isRFID];
    sql = `
        INSERT INTO device_integration (Name, LocationID, Type, ipAddress, PrintServer, isRFID) VALUES (?);`;

    try {
        await pool.query(sql, [args]);
    } catch (error) {
        logger.error("add_device", {error});
        res.status(500).json({"message": `Error while updating an existing device, please contact your system administrator`});
        return;
    }

    res.status(200).json({"message": "Device Updated Sucessfully!"});
};

exports.upsert_device = async function(req, res) {
    const locationID = req.body.LocationID || null;   // Required
    const printerName = req.body.printerName || null; // Required
    const printerType = req.body.printerType || null; // Required
    const ipAddress = req.body.ipAddress || null;     // Either
    const appServer = req.body.appServer || null;     // Or
    const isRFID = req.body.isRFID || 0;
    let sql, args;

    // Validate required parameters
    if (!printerName || !locationID) {
        res.status(400).json({"message": `Missing required parameters: ipAddress, name, locationID`});
        return;
    }

    if (!ipAddress && !appServer) {
        res.status(400).json({"message": `Either ipAddress or appServerAddr must be present`});
    }

    args = [printerName, locationID, printerType, ipAddress, appServer, isRFID];
    sql = `
        INSERT INTO device_integration (Name, LocationID, Type, ipAddress, PrintServer, isRFID)
        VALUES (?)
        ON DUPLICATE KEY UPDATE
        Type=VALUES(Type),
        ipAddress=VALUES(ipAddress),
        PrintServer=VALUES(PrintServer),
        isRFID=VALUES(isRFID);`;
    try {
        await pool.query(sql, [args]);
    } catch (error) {
        logger.error("update_device", {error});
        res.status(500).json({"message": `Error while updating an existing device, please contact your system administrator`});
        return;
    }
    res.status(200).json({"message": "Device Updated Sucessfully!"});
};

exports.delete_device = async function(req, res) {
    const Name = req.query.Name; // Required
    const LocationID = req.query.locationID; // Required
    let sql, args, results;

    // Validate required parameters
    if (!Name && !LocationID) {
        res.status(400).json({"message": `Missing required parameter: Name, LocationID`});
        return;
    }

    args = [LocationID, Name];
    sql = `DELETE FROM device_integration WHERE LocationID = ? AND Name = ?`;

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("delete_device", {error});
        res.status(500).json({"message": `Error while attempting to delete device, please contact your system administrator`});
        return;
    }

    if (results.affectedRows) {
        res.status(200).json({"message": "Successfully deleted device!"});
    } else {
        res.status(404).json({"message": `${Name} wasn't found`});
    }
};

exports.get_device_status = async function(req, res) {
    const Name = req.query.Name;
    const LocationID = req.query.LocationID;
    let sql, args, results;

    args = [LocationID, Name];
    sql = `
        SELECT
            di.ID,
            di.Name,
            di.LocationID,
            di.Type,
            di.IPAddress,
            di.isRFID,
            loc.ServerURL AS ServerPublicIP,
            di.PrintServer
        FROM device_integration di
        INNER JOIN location loc ON loc.ID = di.LocationID
        WHERE di.LocationID = ? AND di.Name = ?`;

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_device_status", {error});
        res.status(500).json({"message": `Error while attempting to get device status.`});
        return;
    }

    if (!results.length) {
        res.status(404).json({"message": `${Name} not found`});
        return;
    }

    res.status(200).json({"data": results[0]});
};
