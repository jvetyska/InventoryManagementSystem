/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/
var apiRequest = require("../library/apiRequest");
var authHelper = require("../library/authHelper");
var logging = require("../library/logging");
const logger = require("../library/logger")("microwarehouse-api:mw_api_case");

exports.get_related_keycodes = async function(req, res) {
    let keycode = req.query.keycode || null;
    let sql, args, results;

    if (!keycode) {
        res.status(400).json({"message": `A keycode MUST be provided`});
        return;
    }

    sql = `
    SELECT IFNULL(ps.Keycode, p.Keycode) AS Keycode, IFNULL(ps.Secondary_Colour, p.Secondary_Colour) AS Secondary_Colour, IFNULL(ps.Item_Size, p.Item_Size) AS Item_Size
    FROM product p
    LEFT JOIN product ps ON p.Style_ID IS NOT NULL AND p.Style_ID > 0 AND p.Style_ID = ps.Style_ID AND p.Secondary_Colour = ps.Secondary_Colour# AND p.Keycode != ps.Keycode
    WHERE p.Keycode = ?`;
    args = [keycode];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error in the SQL query; please contact engineering"});
        return;
    }

    if (results.length == 0) {
        res.status(404).json({"message": `Keycode ${keycode} was not found in the database`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.get_case_inventory = async function(req, res) {
    let barcode = req.query.barcode || null;
    let location = req.query.location || null;
    let sql, args, results;

    // Make sure that the user has declared a case
    if (!barcode) {
        res.status(400).json({"message": `A barcode/case ID MUST be provided`});
        return;
    }

    // If the user specified a location, then verify that it's valid
    if (location) {
        try {
            [results] = await ro_pool.query("SELECT ID FROM location WHERE ID = ?", [location]);
            if (results.length) {
                // Define SQL and args for searching a particular location
                sql = `
                    SELECT ContainerID, COUNT(*) AS Quantity
                    FROM inventory_case ic
                    INNER JOIN container c ON c.ID= ic.ContainerID
                    WHERE Barcode = ? AND c.LocationID = ?
                    GROUP BY ContainerID`;
                args = [barcode, location];
            } else {
                res.status(400).json({"message": `Location ${location} was not found. Please specify a valid warehouse or store ID`});
                return;
            }
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": `SQL error verifying the location ${location}`});
            return;
        }
    } else {
        // Define SQL and args for searching all locations
        sql = `
            SELECT ContainerID, COUNT(*) AS Quantity
            FROM inventory_case
            WHERE Barcode = ?
            GROUP BY ContainerID`;
        args = [barcode];
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": `SQL error getting inventory for case ${barcode}`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.get_case_barcode = async function(req, res) {
    async function GenerateBarcodeCS(keycodes) {
        // CS = General merchanise
        let results, id, barcode, variant, sql, args;
        let keycode = keycodes[0]["keycode"];
        let quantity = keycodes[0]["quantity"];
        let caseVariantToUse = null;
        let caseVariantsInUse = [];
        let caseVariants = [
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B",
            "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N",
            "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"
        ];

        // First we will need to get the case variants that are already used for
        // this particular keycode. They will be assoicated in the order of the
        // array above, from 0 to 9 to A to Z
        sql = "SELECT Barcode FROM case_barcode WHERE Barcode LIKE ? ORDER BY Barcode ASC";
        args = [`CS-%-${keycode}`];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            throw "Error in generating a CS barcode";
        }

        for (let result of results) {
            // The "barcode" variable below will be something like: CS-B-37538590
            // The important thing we need from this string is the character in-between CS- and -37538590
            // Simply split by the dash - and get index #1
            barcode = result["Barcode"];
            variant = barcode.split("-")[1];
            caseVariantsInUse.push(variant);
        }

        // Now that all case variants currently in use have been retrieved, compare it
        // against caseVariants in order to determine which case character we should use next
        for (let variant of caseVariants) {
            if (!caseVariantsInUse.includes(variant)) {
                caseVariantToUse = variant;
                break;
            }
        }

        // If all caseVariants have been used, then we'll reuse an existing barcode; the one that has the OLDEST DateUpdated
        if (caseVariantToUse == null) {
            sql = "SELECT ID, Barcode FROM case_barcode WHERE Barcode LIKE ? ORDER BY DateUpdated ASC";
            args = [`CS-%-${keycode}`];

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                console.log(error);
                throw "Error in generating a CS barcode";
            }

            // Get the id and barcode of the first row, which is the row that has the OLDEST DateUpdated
            id = results[0]["ID"];
            barcode = results[0]["Barcode"];

            // We only need to update the quantity on the row of the ID (DateUpdated gets updated automatically by the DB)
            sql = `UPDATE case_barcode SET Quantity = ? WHERE ID = ?`;
            args = [quantity, id];

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                console.log(error);
                throw "Error in generating a CS barcode";
            }

            return barcode;
        }

        return `CS-${caseVariantToUse}-${keycode}`;
    }

    async function GenerateBarcodeMX() {
        // MX = Mixed products
        let [results] = await pool.query(`CALL ${config.sql_database_for_sp}.id_generate('case_barcode', 13, 'MX-')`);
        let id = String(results[0][0]["ID"]);

        return id;
    }

    async function GenerateBarcodeCX() {
        // CX = Custom mixed products
        let [results] = await pool.query(`CALL ${config.sql_database_for_sp}.id_generate('custom_mixed', 13, 'CX-')`);
        let id = String(results[0][0]["ID"]);

        return id;
    }

    let sql, args, results;
    let keycodes = req.body.keycodes || [];
    let { quantityValidationRequired } = req.body;
    let caseBarcode = null;
    let userKeycodes = [];
    let userQuantites = [];

    // Filter out and remove all objects with a quantity of zero. A try-catch block is necessary to gaurd against malformed JSON objects
    try {
        keycodes = keycodes.filter(obj => obj["quantity"] > 0);
    } catch (error) {
        res.status(400).json({"message": `The JSON object for keycodes is malformed. An example of a correct JSON object: {"keycodes":[{"keycode":68311957,"quantity":123},{"keycode":68311964,"quantity":456}]}`});
        return;
    }

    if (keycodes.length == 0) {
        res.status(400).json({"message": "No keycodes were provided"});
        return;
    }

    // The array of objects needs to be sorted. Otherwise, if the array isn't sorted, it won't find
    // a case barcode that potentially exists. Take this array for example...
    // [ { keycode: 42608318, quantity: 1 },
    //   { keycode: 42285809, quantity: 2 } ]
    // ...and this array...
    // [ { keycode: 42285809, quantity: 2 },
    //   { keycode: 42608318, quantity: 1 } ]
    // ... even both have the same quantities for the same keycodes, they would be considered "different"
    // when MySQL does a search for keycode/quantity pairings. To fix this, simply sort the array by keycode
    keycodes = keycodes.sort((a, b) => (a.keycode > b.keycode) ? 1 : -1);

    args = [[]];
    sql = `
        SELECT
            Barcode,
            GROUP_CONCAT(Keycode)  AS ResultKeycodes,
            GROUP_CONCAT(Quantity) AS ResultQuantities
        FROM case_barcode
        WHERE Barcode IN (
            SELECT Barcode FROM case_barcode WHERE
            (Keycode, Quantity) IN (?)
        )
        GROUP BY Barcode
        ORDER BY ID DESC`;

    for (let obj of keycodes) {
        userKeycodes.push(obj.keycode);
        userQuantites.push(obj.quantity);

        args[0].push([
            obj.keycode, // Keycode
            obj.quantity // Quantity
        ]);
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": error});
        return;
    }

    for (let result of results) {
        let barcode = result["Barcode"];
        let resultKeycodes = result["ResultKeycodes"].split(",");
        let resultQuantities = result["ResultQuantities"].split(",");
        let matchFound = true;

        if (keycodes.length != resultKeycodes.length) {
            // If the number of barcodes is different, then it automatically doesn't find a match for this result
            continue;
        }

        for (let i = 0; i < keycodes.length; i++) {
            let keycodeTest  = userKeycodes[i]  == resultKeycodes[i];
            let quantityTest = userQuantites[i] == resultQuantities[i];

            if (!keycodeTest || !quantityTest) {
                matchFound = false;
                break;
            }
        }

        if (matchFound) {
            res.status(200).json({"data": barcode}); // Reuse an existing barcode
            return;
        }
    }

    // Before creating new barcode, Validation Check for the quantity inserted
    if (quantityValidationRequired) {
        res.status(200).json({"data": caseBarcode }); // Reuse an existing barcode
        return;
    }

    // If caseBarcode has NOT been defined yet, generate a new one
    if (caseBarcode == null) {
        // Determine what type of barcode this is (CS, MX, CX)
        if (keycodes.length == 1) {
            // It's doubtful that a mixed product would only have one keycode from the client but we should probably check anyways
            try {
                [results] = await pool.query("SELECT IFNULL(Style_ID, 0) AS Style_ID FROM product WHERE Keycode = ?", [keycodes[0]["keycode"]]);
            } catch (error) {
                console.log(error);
                res.status(500).json({"message": "Error checking the style id from the keycode"});
                return;
            }

            if (results[0]["Style_ID"] == 0) {
                // No style ID means this is a CS (general merchandise) barcode
                try {
                    caseBarcode = await GenerateBarcodeCS(keycodes);
                } catch (error) {
                    res.status(500).json({"message": error});
                    return;
                }
            } else {
                // A style ID means this is a MX (mixed products) barcode
                caseBarcode = await GenerateBarcodeMX();
            }
        } else if (keycodes.length > 1) {
            // More than one keycode means it will either be an MX (mixed) or CX (custom mixed)
            sql = "SELECT IFNULL(Style_ID, 0) AS Style_ID FROM product WHERE Keycode IN (?) GROUP BY Style_ID";
            args = [keycodes.map(a => a.keycode)];

            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                console.log(error);
                res.status(500).json({"message": "Error checking the style id from the keycode"});
                return;
            }

            // If the length of the results are more than one, OR if the zeroth index is 0, then it's CX (custom mixed)
            // If the length is exactly one, AND the zeroth index is not NULL, then it's MX (mixed)
            if (results.length == 0) {
                res.status(500).json({"message": "No products were found for the given barcode(s)"});
                return;
            } else if (results.length > 1 || results[0]["Style_ID"] == 0) {
                caseBarcode = await GenerateBarcodeCX(keycodes);
            } else {
                caseBarcode = await GenerateBarcodeMX(keycodes);
            }
        } else {
            res.status(400).json({"message": "Error generating a case barcode; number of keycodes is less than one"});
            return;
        }
    }

    // Now that the caseBarcode has been generated, insert rows into the table case_barcode
    sql = `INSERT INTO case_barcode (Barcode, Keycode, Quantity) VALUES ?`;
    args = [];

    for (let obj of keycodes) {
        args.push([
            caseBarcode, // Barcode
            obj.keycode, // Keycode
            obj.quantity // Quantity
        ]);
    }

    try {
        await pool.query(sql, [args]);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error writing case barcode(s); please contact your system administrator"});
        return;
    }

    // Return the brand new barcode to the user after inserting row(s) into case_barcode
    res.status(200).json({"data": caseBarcode});
};

exports.get_blank_cx_barcodes = async function(req, res) {
    let quantity = parseInt(req.body["quantity"]) || null;
    let barcodes = [];

    if (!quantity) {
        res.status(400).json({"message": "The quantity paramter must be provided"});
        return;
    }

    if (!(quantity >= 1 && quantity <= 99)) {
        res.status(400).json({"message": "The quantity must be between 1 and 99 (inclusively)"});
        return;
    }

    for (let i = 0; i < quantity; i++) {
        let [results] = await pool.query(`CALL ${config.sql_database_for_sp}.id_generate('custom_mixed', 13, 'CX-')`);
        let id = String(results[0][0]["ID"]);

        let barcode = id;

        try {
            await pool.query("INSERT INTO case_barcode (Barcode, Keycode, Quantity) VALUES (?, 0, 0)", [barcode]);
        } catch (error) {
            console.log(error);
            res.status(400).json({"message": "Error creating a blank CX barcode"});
            return;
        }

        barcodes.push(barcode);
    }

    res.status(200).json({"data": barcodes});
};

exports.get_custom_case_barcode = async function(req, res) {
    let containerId = req.body["containerId"];
    let sql, args, results, products, caseBarcode;
    let productCollection = [];

    args = [containerId];
    sql = `
        SELECT c.Type, i.Keycode, COUNT(*) AS Quantity
        FROM inventory i
        INNER JOIN container c ON c.ID = i.ContainerID
        WHERE ContainerID = ?
        GROUP BY i.Keycode`;

    try {
        [products] = await ro_pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error in creating a new barcode; please contact your system administrator"});
        return;
    }

    if (products.length == 0) {
        res.status(400).json({"message": `No products were found in the container: ${containerId}`});
        return;
    }  else if (products[0]["Type"] != "SHL") {
        res.status(400).json({"message": `Invalid container type, only shelves can be scanned. You scanned type: ${products[0]["Type"]}`});
        return;
    }

    // Generate a new CX label (CX = Custom mixed products)
    // The barcode must be exactly 13 characters, and CX- takes up 3 of those characters
    // Therefore, pad the id with zeroes on the left until id has a length of 10
    try {
        [results] = await pool.query(`CALL ${config.sql_database_for_sp}.id_generate('custom_mixed', 13, 'CX-')`);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "There was an error generating the barcode; please contact your system administrator"});
        return;
    }

    caseBarcode = results[0][0]["ID"];

    for (let product of products) {
        productCollection.push([
            caseBarcode,
            product["Keycode"],
            product["Quantity"]
        ]);
    }

    // Now that the caseBarcode has been generated, insert rows into the table case_barcode
    // 1. Create the CX label with the contents of the container and insert into case_barcode
    // 2. Delete the inventory of the container
    args = [productCollection];
    sql = `INSERT INTO case_barcode (Barcode, Keycode, Quantity) VALUES ?`;
    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error in creating a new barcode; please contact your system administrator"});
        return;
    }

    try {
        await apiRequest.delete(req, "delete_inventory_bulk", {container: containerId, process: "get_custom_case_barcode"});
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error in creating a new barcode; please contact your system administrator"});
        return;
    }

    // Send the caseBarcode to the user after we have confirmed that both creating the CX label AND deleting inventory has succeeded, send
    res.status(200).json({"data": caseBarcode});
};

exports.create_case_content = async (req, res) => {

    let barcode = req.body.barcode || null; // case barcode
    let keycode = req.body.keycode || null;
    let sourceLocation = req.body.sourceLocation || null; // location where the keycode-quanity is coming from
    let quantity = req.body.quantity || null;
    let user = authHelper.parseRole(req);
    let sql, args, results, message;
    let contains_zero_keycode = false;

    try {
        if (!barcode || !keycode || !quantity || !sourceLocation) {
            message = "You must provide a barcode, keycode, sourceLocation and quantity";
            res.status(400).json({"message": message});
            return;
        }

        sql = `
            SELECT cb.Barcode, SUM(cb.Quantity) AS ItemsInCase, ic.ContainerID
            FROM case_barcode cb
            LEFT JOIN inventory_case ic ON cb.Barcode = ic.Barcode
            WHERE cb.Barcode = ?
            AND ic.ContainerID IS NULL
            GROUP BY cb.Barcode;
        `;
        args = [barcode];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            res.status(500).json({"message": error});
            return;
        }

        if (results.length == 0) {
            res.status(404).json({"message": "Either Barcode doesn't exist or already in inventory"});
            return;
        }

        sql = `SELECT * FROM inventory inv WHERE inv.ContainerID = ? AND Keycode = ?;`;
        args = [sourceLocation, keycode];


        // checking if the sourceLocation actually has inventory
        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            res.status(500).json({"message": error});
            return;
        }

        if (results.length < quantity) {
            res.status(404).json({"message": "Location has insufficient inventory. Aborting process"});
            return;
        }

        sql = `
            SELECT * FROM case_barcode cb
            WHERE cb.Barcode = ?
            AND cb.Keycode = ?
            ORDER BY Keycode ASC;
        `;
        args = [barcode, keycode];


        // checking if the keycode already exists in the caseBarcode location
        try {
            [results] = await pool.query(sql, args);

        } catch (error) {
            res.status(500).json({"message": error});
            return;
        }


        if (results.length == 0) {
            sql = `
                INSERT INTO case_barcode (Barcode, Keycode, Quantity) VALUES (?,?,?);
            `;
            args = [barcode, keycode, quantity];
        } else {
            sql = `
                UPDATE case_barcode cb
                SET cb.Quantity = (cb.Quantity + ?)
                WHERE cb.Barcode = ?
                AND cb.Keycode = ?;
            `;
            args = [quantity, barcode, keycode];
        }


        try {
            [results] = await pool.query(sql, args);

            // get_blank_cx_barcodes() inserts an entry with 0 keycode, 0 quantity. Removing that
            await remove_zero_keycode_from_cx_barcode(barcode);
            // console.log(results);
            // the items have been created, now delete it from the container they came from
            // now call delete inventory on that location
            apiRequest.delete(req, "delete_inventory_nb", {"keycode": keycode, "container": sourceLocation, "quantity": quantity, "process": "create-case-content" } );

            logging.log_inventory("INSERT", barcode, keycode, quantity, "-", sourceLocation, user.id, "case/create_case_content", "create_case");
            res.status(200).json({"message": `Created inventory of barcode ${barcode} for ${keycode}`});

        } catch (error) {
            res.status(500).json({"message": error});
            return;
        }

    } catch (err) {
        throw err;
    }
};

exports.create_case_content_from_container = async (req, res) => {

    let barcode = req.body.barcode || null; // case barcode
    let sourceLocation = req.body.sourceLocation || null; // location from where we are pulling the stuff
    let user = authHelper.parseRole(req);
    let sql, args, results, message;

    try {
        if (!barcode || !sourceLocation) {
            message = "You must provide a barcode and sourceLocation";
            res.status(400).json({"message": message});
            return;
        }

        sql = `
            SELECT cb.Barcode, SUM(cb.Quantity) AS ItemsInCase, ic.ContainerID
            FROM case_barcode cb
            LEFT JOIN inventory_case ic ON cb.Barcode = ic.Barcode
            WHERE cb.Barcode = ?
            AND ic.ContainerID IS NULL
            GROUP BY cb.Barcode;
        `;
        args = [barcode];

        try {
            [results] = await pool.query(sql, args);
            // console.log(results);
        } catch (error) {
            res.status(500).json({"message": error});
            return;
        }

        if (results.length == 0) {
            res.status(404).json({"message": "Either Barcode doesn't exist or already in inventory"});
            return;
        }

        sql = `
            SELECT keycode, COUNT(Keycode) AS quantity FROM inventory inv
            INNER JOIN container cnt ON cnt.ID = inv.ContainerID
            WHERE inv.ContainerID = ?
            AND cnt.Type IN ('SHL', 'CRT')
            GROUP BY Keycode;
        `;
        args = [sourceLocation];

        try {
            [results] = await pool.query(sql, args);
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": `Error: case/create_case_content_from_container`});
            return;
        }

        if (results.length == 0) {
            res.status(500).json({"message": `${sourceLocation} is empty`});
            return;
        }
        for (let r of results) {
            let keycode = r.keycode;
            let quantity = r.quantity;

            sql = `
                    SELECT * FROM case_barcode cb
                    WHERE cb.Barcode = ?
                    AND cb.Keycode = ?
                `;
            args = [barcode, keycode];

            // checking if the keycode already exists in the caseBarcode location
            try {
                [results] = await pool.query(sql, args);
            } catch (error) {
                res.status(500).json({"message": error});
                return;
            }


            if (results.length == 0) {
                sql = `
                        INSERT INTO case_barcode (Barcode, Keycode, Quantity) VALUES (?,?,?);
                    `;
                args = [barcode, keycode, quantity];
            } else {
                sql = `
                        UPDATE case_barcode cb
                        SET cb.Quantity = (cb.Quantity + ?)
                        WHERE cb.Barcode = ?
                        AND cb.Keycode = ?;
                    `;
                args = [quantity, barcode, keycode];
            }

            try {
                [results] = await pool.query(sql, args);
                // get_blank_cx_barcodes() inserts an entry with 0 keycode, 0 quantity. Removing that
                await remove_zero_keycode_from_cx_barcode(barcode);
                // the items have been created, now delete it from the container they came from
                // now call delete inventory on that location
                apiRequest.delete(req, "delete_inventory_nb", {"keycode": keycode, "container": sourceLocation, "quantity": quantity, "process": "create-case-content" } );
                logging.log_inventory("INSERT", barcode, keycode, quantity, "-", "-", user.id, "-", "case/create_case_content_from_container");
            } catch (error) {
                res.status(500).json({"message": error});
                return;
            }
        }

        res.status(200).json({"message": `Items in Location ${sourceLocation} added to Case ${barcode}`});

    } catch (error) {
        console.log(error);
        throw error;
    }



};

exports.create_case_inventory = async function(req, res) {
    let barcode = req.body.barcode || null;
    let containerId = req.body.containerId || null;
    let user = authHelper.parseRole(req);
    let sql, args, results, message;

    if (!barcode || !containerId) {
        message = "You must provide a barcode and containerId";
        res.status(400).json({"message": message});
        return;
    }

    sql = `SELECT ID FROM case_barcode WHERE Barcode = ?`;
    args = [barcode];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": error});
        return;
    }

    if (results.length == 0) {
        res.status(404).json({"message": "That barcode doesn't exist"});
        return;
    }

    sql = `INSERT INTO inventory_case (Barcode, ContainerID, UserID) VALUES (?,?,?)`;
    args = [barcode, containerId, user.id];

    try {
        await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": error});
        return;
    }

    logging.log_inventory("INSERT", barcode, "", "-", containerId, "-", user.id,"-", "case/create_case_inventory");
    res.status(200).json({"message": `Created inventory of barcode ${barcode} from pallet ${containerId}`});
};

/* ***********************************************************************************************************************************
 *
 * Deprecated:
 * Reason:
 *       | create_case_content() / create_case_content_from_container() does the same thing as update_blank_cx_barcode()
 *       | Above mentioned function also takes sourceLocation, and removes the inventory from the sourceLocation after
 *       | putting them into the cx-barcode.
 *
 * ***********************************************************************************************************************************/
exports.update_blank_cx_barcode = async function(req, res) {
    let barcode = req.body["barcode"] || null;
    let keycodes = req.body["keycodes"] || null;
    let collection = [];
    let results;

    if (!req.body || !barcode || !keycodes) {
        res.status(400).json({"message": `You must pass in data, example: {"barcode": "CX-0000000015", "keycodes": [{"keycode": 46821575, "quantity": 2},{...}]}`});
        return;
    }

    console.log(barcode);
    console.log(keycodes);

    // Verify that the user passed in a CX barcode, and that this CX barcode exists
    if (barcode.substring(0, 2) != "CX") {
        res.status(400).json({"message": "You are only allowed to update CX barcodes"});
        return;
    } else {
        try {
            [results] = await pool.query("SELECT ID FROM case_barcode WHERE Barcode = ?", [barcode]);
        } catch (error) {
            console.log(error);
            res.status(500).json({"message": "Error getting the barcode, please contact your system administrator"});
            return;
        }
    }

    if (results.length == 0) {
        res.status(400).json({"message": `Barcode ${barcode} doesn't exist`});
        return;
    }

    // Iterate through the keycode array and push each keycode/quantity pair into our collection
    for (let obj of keycodes) {
        collection.push([barcode, obj["keycode"], obj["quantity"]]);
    }

    let args = [barcode, collection];
    let sql = `
        DELETE FROM case_barcode WHERE Barcode = ?
        ;
        INSERT INTO case_barcode (Barcode, Keycode, Quantity) VALUES ?`;

    try {
        // await pool.query(sql, args);
    } catch (error) {
        console.log(error);
        res.status(500).json({"message": "Error updating the barcode, please contact your system administrator"});
        return;
    }

    res.status(200).json({"message": `Barcode ${barcode} has been updated`});
};

let remove_zero_keycode_from_cx_barcode = async (barcode) => {

    let sql = `
        DELETE FROM case_barcode
        WHERE Barcode = ?
        AND Keycode = 0`;

    let args = [barcode];
    let results;
    try {

        [results] = await pool.query(sql, args);
        console.log(results);
        return results;

    } catch (error) {
        console.log(error);
        throw error;
    }

};
