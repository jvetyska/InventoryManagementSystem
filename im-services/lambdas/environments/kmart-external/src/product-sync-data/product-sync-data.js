
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { axios, AWS, https } = require("/opt/nodejs/xray.js");
const logger = require('/opt/nodejs/logger.js')('kmart-external:product-sync-data'); 

let pool, SLACK_ERRORS, config;

async function GetFamilyTree() {
    let rows;
    let map = {};
    let sql = `
        SELECT
            DepartmentID,
            FamilyID,
            ClassID,
            SubClassID,
            SubSubClassID,
            DepartmentName,
            FamilyName,
            ClassName,
            SubClassName,
            SubSubClassName
        FROM product_family_tree`;

    try {
        [rows] = await pool.query(sql);
    } catch (error) {
        console.log(error);
        return;
    }

    for (let row of rows) {
        // IDs
        let departmentID  = row["DepartmentID"];
        let familyID      = row["FamilyID"];
        let classID       = row["ClassID"];
        let subClassID    = row["SubClassID"];
        let subSubClassID = row["SubSubClassID"];

        // Names
        let departmentName  = row["DepartmentName"];
        let familyName      = row["FamilyName"];
        let className       = row["ClassName"];
        let subClassName    = row["SubClassName"];
        let subSubClassName = row["SubSubClassName"];

        if (!(departmentID in map)) {
            map[departmentID] = {
                name: departmentName
            };
        }

        if (!(familyID in map[departmentID])) {
            map[departmentID][familyID] = {
                name: familyName
            };
        }

        if (!(classID in map[departmentID][familyID])) {
            map[departmentID][familyID][classID] = {
                name: className
            };
        }

        if (!(subClassID in map[departmentID][familyID][classID])) {
            map[departmentID][familyID][classID][subClassID] = {
                name: subClassName
            };
        }

        if (!(subSubClassID in map[departmentID][familyID][classID][subClassID])) {
            map[departmentID][familyID][classID][subClassID][subSubClassID] = {
                name: subSubClassName
            };
        }
    }

    return map;
}

async function SynchronizeProducts(familyTree) {
    // Three main steps to synchronizing the products
    // 1. TRUNCATE the tables import_product and import_product_attr
    // 2. INSERT data into the two above tables for importing
    // 3. UPDATE/INSERT to the main tables import_product and import_product_attr
    // Three main steps to synchronizing the products
    // 1. TRUNCATE the tables import_product and import_product_attr
    // 2. INSERT data into the two above tables for importing
    // 3. UPDATE/INSERT to the main tables import_product and import_product_attr

    try {
        await pool.query(`
            TRUNCATE TABLE import_product
            ;
            TRUNCATE TABLE import_product_attr`);
    } catch (error) {
        console.log(error);
        return;
    }

    let page = 0;
    const agent = new https.Agent({
        rejectUnauthorized: false
    });

    // The Kmart API will get product information in batches of 100,000 products with each call from their IPS database
    // This is much safer than getting all product information at once, because the program may run out of memory
    while (true) {
        let productsArray = [];
        let products = {};
        let response, rows;

        try {
            response = await axios.get(`${config.integrationAPI}/product-sync?page=${page}`, { httpsAgent: agent });
            rows = response.data.data;
            page++;
            console.log("Fetching Page " + page);
        } catch (error) {
            console.log(error.message);
            return;
        }

        if (rows.length === 0) {
            // We have finished getting every single product from Kmart's SQL Database
            break;
        }

        // 1. Get the list of all keycodes and other necessary attributes from an API
        // 2. Daily, we should insert all data for new keycodes, and update attributes for keycodes that had changes
        // 3. Create better logic for image updates. Store the last 64 bytes of the image data and use that for comparison (if they are the same, no update needed)
        // Parse the product data that was received from Kmart in batches of up to 100,000 at a time
        for (let row of rows) {
            // A lot of columns in Kmart's MS SQL database have extra spaces after the data, so it would be best to trim all of the text
            let keycode         = row["Keycode"];                                                              // This is a number in the DB, can't trim numbers
            let barcode         = row["Barcode"];                                                              // This is a number in the DB, can't trim numbers
            let styleID         = row["Style_ID"];                                                             // This is a number in the DB, can't trim numbers
            let costPrice       = row["Cost_Price"]             ? row["Cost_Price"].toFixed(2)         : null; // This is a decimal in the DB, make sure it's rounded to 2 points
            let retailPrice     = row["Retail_Price"]           ? row["Retail_Price"].toFixed(2)       : null; // This is a decimal in the DB, make sure it's rounded to 2 points
            let productStatus   = row["Product_Status"];                                                       // This is a number in the DB, can't trim numbers
            let productName     = row["Product_Name"]           ? row["Product_Name"].trim()           : null;
            let departmentID    = row["Department_ID"]          ? row["Department_ID"].trim()          : null;
            let minorID         = row["Minor_ID"]               ? row["Minor_ID"].trim()               : null;
            let familyID        = row["Family_ID"]              ? row["Family_ID"].trim()              : null;
            let classID         = row["Class_ID"]               ? row["Class_ID"].trim()               : null;
            let subClassID      = row["Sub_Class_ID"]           ? row["Sub_Class_ID"].trim()           : null;
            let subSubClassID   = row["Sub_Sub_Class_ID"]       ? row["Sub_Sub_Class_ID"].trim()       : null;
            let secondaryColour = row["Secondary_Colour"]       ? row["Secondary_Colour"].trim()       : null;
            let itemSize        = row["Item_Size"]              ? row["Item_Size"].trim()              : null;
            let buRBUName       = row["Business_Unit_RBU_Name"] ? row["Business_Unit_RBU_Name"].trim() : null;
            let description     = row["Description"]            ? row["Description"].trim()            : null;
            let fixture         = row["Fixture"]                ? row["Fixture"].trim()                : null;
            let recall          = row["Recall"]                 ? row["Recall"].trim()                 : null;

            // Skip products that don't have a keycode and barcode
            if (!keycode || !barcode) {
                continue;
            }

            // Skip this product if the keycode and barcode match, or if it's a bad barcode (8 characters or less)
            if (String(keycode) === String(barcode) || String(barcode).length <= 8) {
                continue;
            }

            // Remap fixture to the appropriate value
            switch (fixture) {
                case "FLAT":
                case "TBLE": {
                    fixture = "T";
                    break;
                }
                case "RGLR":
                case "END":
                case null:
                case "": {
                    fixture = "R";
                    break;
                }
                default: {
                    //console.log(`ERROR: Unexpected fixture. The fixture was: ${fixture}`);
                    //process.exit();
                    break;
                }
            }

            // The column "recall" will either be a "Y" for yes, or "N" for no. Flip it to a flag (true/false) depending on it's Y/N value
            recall = (recall === "Y" ? 1 : 0);

            // Set defaults
            let departmentName  = null;
            let familyName      = null;
            let className       = null;
            let subClassName    = null;
            let subSubClassName = null;

            if (departmentID in familyTree) {
                departmentName = familyTree[departmentID]["name"];

                if (familyID in familyTree[departmentID]) {
                    familyName = familyTree[departmentID][familyID]["name"];

                    if (classID in familyTree[departmentID][familyID]) {
                        className = familyTree[departmentID][familyID][classID]["name"];

                        if (subClassID in familyTree[departmentID][familyID][classID]) {
                            subClassName = familyTree[departmentID][familyID][classID]["name"];

                            if (subSubClassID in familyTree[departmentID][familyID][classID][subClassID]) {
                                subSubClassName = familyTree[departmentID][familyID][classID][subClassID]["name"];
                            }
                        }
                    }
                }
            }

            products[keycode] = {
                barcode        : barcode,
                productName    : productName,
                departmentID   : departmentID,
                minorID        : minorID,
                familyID       : familyID,
                classID        : classID,
                subClassID     : subClassID,
                subSubClassID  : subSubClassID,
                departmentName : departmentName,
                familyName     : familyName,
                className      : className,
                subClassName   : subClassName,
                subSubClassName: subSubClassName,
                styleID        : styleID,
                secondaryColour: secondaryColour,
                itemSize       : itemSize,
                costPrice      : costPrice,
                retailPrice    : retailPrice,
                buRBUName      : buRBUName,
                description    : description,
                fixture        : fixture,
                recall         : recall,
                productStatus  : productStatus
            };
        }

        // Prepare the data for queries that will be executed in the Anko MySQL database
        for (let keycode in products) {
            let product         = products[keycode];
            let barcode         = product["barcode"];
            let productName     = product["productName"];
            let departmentID    = product["departmentID"];
            let minorID         = product["minorID"];
            let familyID        = product["familyID"];
            let classID         = product["classID"];
            let subClassID      = product["subClassID"];
            let subSubClassID   = product["subSubClassID"];
            let departmentName  = product["departmentName"];
            let familyName      = product["familyName"];
            let className       = product["className"];
            let subClassName    = product["subClassName"];
            let subSubClassName = product["subSubClassName"];
            let styleID         = product["styleID"];
            let secondaryColour = product["secondaryColour"];
            let itemSize        = product["itemSize"];
            let costPrice       = product["costPrice"];
            let retailPrice     = product["retailPrice"];
            let buRBUName       = product["buRBUName"];
            let description     = product["description"];
            let fixture         = product["fixture"];
            let recall          = product["recall"];
            let productStatus   = product["productStatus"];

            productsArray.push([
                keycode,
                barcode,
                productName,
                departmentID,
                minorID,
                familyID,
                classID,
                subClassID,
                subSubClassID,
                departmentName,
                familyName,
                className,
                subClassName,
                subSubClassName,
                styleID,
                secondaryColour,
                itemSize,
                costPrice,
                retailPrice,
                buRBUName,
                description,
                fixture,
                recall,
                productStatus
            ]);
        }

        let args1 = [];
        let args2 = [];
        let args3 = [];
        let sql1 = `
            INSERT IGNORE INTO import_product (
                Keycode,
                APN,
                Product_Name,
                DepartmentID,
                Class_Name,
                Sub_Class_Name,
                Sub_Sub_Class_Name,
                Product_Status,
                Business_Unit_RBU_Name,
                Description,
                Item_Size,
                Cost_Price_Aus,
                Sell_Price_Aus,
                Secondary_Colour,
                Style_ID,
                isRecall
            ) VALUES ?`;

        let sql2 = `
            INSERT IGNORE INTO import_product_attr (
                Keycode,
                APN,
                Department_ID,
                Minor_Department_ID,
                Family_ID,
                Class_ID,
                Fixture_Code
            ) VALUES ?`;

        let sql3 = `
            INSERT IGNORE INTO product_barcode (
                Keycode,
                Barcode
            )
            VALUES ?
            ON DUPLICATE KEY UPDATE
                Keycode = VALUES(Keycode)`;

        while (productsArray.length) {
            let product = productsArray.pop();

            /* Referencing properties may seem odd by retrieving them from a specified
             * index instead of using an array of objects, but because there are so many
             * rows to deal with at one time (over 650,0000), the program runs out of
             * memory and crashes if we were to use an array of objects. Since a simple
             * array uses a lot less memory, this alternative solution will work fine.
             * In hindsight, it would have been better to perform updates in batches of
             * a constant value, such as 100,000 or less
             *
             * Index 0 : keycode
             * Index 1 : barcode
             * Index 2 : productName
             * Index 3 : departmentID
             * Index 4 : minorID
             * Index 5 : familyID
             * Index 6 : classID
             * Index 7 : subClassID
             * Index 8 : subSubClassID
             * Index 9 : departmentName
             * Index 10: familyName
             * Index 11: className
             * Index 12: subClassName
             * Index 13: subSubClassName
             * Index 14: styleID
             * Index 15: secondaryColour
             * Index 16: itemSize
             * Index 17: costPrice
             * Index 18: retailPrice
             * Index 19: buRBUName
             * Index 20: description
             * Index 21: fixture
             * Index 22: recall
             * Index 23: productStatus
             */

            args1.push([
                product[0],  // Keycode
                product[1],  // APN
                product[2],  // Product_Name
                product[3],  // DepartmentID
                product[11], // Class_Name
                product[12], // Sub_Class_Name
                product[13], // Sub_Sub_Class_Name
                product[23], // Product_Status
                product[19], // Business_Unit_RBU_Name
                product[20], // Description
                product[16], // Item_Size
                product[17], // Cost_Price_Aus
                product[18], // Sell_Price_Aus
                product[15], // Secondary_Colour
                product[14], // Style_ID
                product[22] // isRecall
             ]);

            args2.push([
                product[0], // Keycode
                product[1], // APN
                product[3], // Department_ID
                product[4], // Minor_Department_ID
                product[5], // Family_ID
                product[6], // Class_ID
                product[21] // Fixture_Code
            ]);

            args3.push([
                product[0], // Keycode
                product[1]  // Barcode
            ]);
        }

        await pool.query(sql1, [args1]);
        await pool.query(sql2, [args2]);
        await pool.query(sql3, [args3]);
    }

    // 1. UPDATE existing rows that have matching keycodes across the import_product and product tables
    // 2. INSERT new rows from import_product into the product table (existing rows will be ignored)
    try {
        await pool.query(`
            UPDATE product p
            INNER JOIN import_product ip USING (Keycode)
            SET
                p.Product_Name = ip.Product_Name,
                p.Country_of_Origin = ip.Country_of_Origin,
                p.Retail_Zone_Name = ip.Retail_Zone_Name,
                p.Retail_Zone_ID = ip.Retail_Zone_ID,
                p.Retail_Mod_Code = ip.Retail_Mod_Code,
                p.Class_Name = ip.Class_Name,
                p.Program = ip.Program,
                p.Loading_Capacity = ip.Loading_Capacity,
                p.Instore_Item_Depth = ip.Instore_Item_Depth,
                p.Instore_Item_Height = ip.Instore_Item_Height,
                p.Instore_Item_Width = ip.Instore_Item_Width,
                p.Item_Size = ip.Item_Size,
                p.US_Size = ip.US_Size,
                p.Weight = ip.Weight,
                p.Online_Name = ip.Online_Name,
                p.Pack_Size = ip.Pack_Size,
                p.Primary_Colour = ip.Primary_Colour,
                p.Secondary_Colour = ip.Secondary_Colour,
                p.Cost_Price_Aus = ip.Cost_Price_Aus,
                p.Sell_Price_Aus = ip.Sell_Price_Aus,
                p.Sell_Price_Usd = ip.Sell_Price_Usd,
                p.Discount_Price_Usd = ip.Discount_Price_Usd,
                p.Style_ID = ip.Style_ID,
                p.Style_Name = ip.Style_Name,
                p.Anko_Last_Shipped_At = ip.Anko_Last_Shipped_At,
                p.Average_units_per_transaction = ip.Average_units_per_transaction,
                p.Capacity = ip.Capacity,
                p.Diameter = ip.Diameter,
                p.\`Outer_Carton_Depth_(cms)\` = ip.\`Outer_Carton_Depth_(cms)\`,
                p.\`Outer_Carton_Height_(cms)\` = ip.\`Outer_Carton_Height_(cms)\`,
                p.\`Outer_Carton_Width_(cms)\` = ip.\`Outer_Carton_Width_(cms)\`,
                p.Outer_Carton_Weight = ip.Outer_Carton_Weight,
                p.ImageChanged = ip.ImageChanged,
                p.\`ANKO_On-Show_Period\` = ip.\`ANKO_On-Show_Period\`,
                p.Online_Fulfilment_Channel = ip.Online_Fulfilment_Channel,
                p.ANKO_On_Show_Month = ip.ANKO_On_Show_Month,
                p.Retail_Store_Pres_Type = ip.Retail_Store_Pres_Type,
                p.US_Overall_Test_Result_CONFIRMED = ip.US_Overall_Test_Result_CONFIRMED,
                p.In_US_Range = ip.In_US_Range,
                p.Sub_Class_Name = ip.Sub_Class_Name,
                p.Sub_Sub_Class_Name = ip.Sub_Sub_Class_Name,
                p.Product_Status = ip.Product_Status,
                p.ANKO_US_Season = ip.ANKO_US_Season,
                p.DateSeasonStart = ip.DateSeasonStart,
                p.Description = ip.Description,
                p.Sell_Price_Discount_Pct = ip.Sell_Price_Discount_Pct,
                p.Discount_Amount = ip.Discount_Amount,
                p.Sell_Price_Discount_Amt = ip.Sell_Price_Discount_Amt,
                p.unitsPerTransaction = ip.unitsPerTransaction,
                p.isSaleFinal = ip.isSaleFinal,
                p.isRecall = ip.isRecall,
                p.Business_Unit_RBU_Name = ip.Business_Unit_RBU_Name,
                p.DepartmentID = ip.DepartmentID
            ;
            INSERT IGNORE INTO product (
                APN,
                Keycode,
                Product_Name,
                Country_of_Origin,
                Retail_Zone_Name,
                Retail_Zone_ID,
                Retail_Mod_Code,
                Class_Name,
                Program,
                Loading_Capacity,
                Instore_Item_Depth,
                Instore_Item_Height,
                Instore_Item_Width,
                Item_Size,
                US_Size,
                Weight,
                Online_Name,
                Pack_Size,
                Primary_Colour,
                Secondary_Colour,
                Cost_Price_Aus,
                Sell_Price_Aus,
                Sell_Price_Usd,
                Discount_Price_Usd,
                Style_ID,
                Style_Name,
                Anko_Last_Shipped_At,
                Average_units_per_transaction,
                Capacity,
                Diameter,
                \`Outer_Carton_Depth_(cms)\`,
                \`Outer_Carton_Height_(cms)\`,
                \`Outer_Carton_Width_(cms)\`,
                Outer_Carton_Weight,
                ImageChanged,
                \`ANKO_On-Show_Period\`,
                Online_Fulfilment_Channel,
                ANKO_On_Show_Month,
                Retail_Store_Pres_Type,
                US_Overall_Test_Result_CONFIRMED,
                In_US_Range,
                Sub_Class_Name,
                Sub_Sub_Class_Name,
                Product_Status,
                ANKO_US_Season,
                DateSeasonStart,
                Description,
                Sell_Price_Discount_Pct,
                Discount_Amount,
                Sell_Price_Discount_Amt,
                unitsPerTransaction,
                isSaleFinal,
                isRecall,
                Business_Unit_RBU_Name,
                DepartmentID
            )
            SELECT
                APN,
                Keycode,
                Product_Name,
                Country_of_Origin,
                Retail_Zone_Name,
                Retail_Zone_ID,
                Retail_Mod_Code,
                Class_Name,
                Program,
                Loading_Capacity,
                Instore_Item_Depth,
                Instore_Item_Height,
                Instore_Item_Width,
                Item_Size,
                US_Size,
                Weight,
                Online_Name,
                Pack_Size,
                Primary_Colour,
                Secondary_Colour,
                Cost_Price_Aus,
                Sell_Price_Aus,
                Sell_Price_Usd,
                Discount_Price_Usd,
                Style_ID,
                Style_Name,
                Anko_Last_Shipped_At,
                Average_units_per_transaction,
                Capacity,
                Diameter,
                \`Outer_Carton_Depth_(cms)\`,
                \`Outer_Carton_Height_(cms)\`,
                \`Outer_Carton_Width_(cms)\`,
                Outer_Carton_Weight,
                ImageChanged,
                \`ANKO_On-Show_Period\`,
                Online_Fulfilment_Channel,
                ANKO_On_Show_Month,
                Retail_Store_Pres_Type,
                US_Overall_Test_Result_CONFIRMED,
                In_US_Range,
                Sub_Class_Name,
                Sub_Sub_Class_Name,
                Product_Status,
                ANKO_US_Season,
                DateSeasonStart,
                Description,
                Sell_Price_Discount_Pct,
                Discount_Amount,
                Sell_Price_Discount_Amt,
                unitsPerTransaction,
                isSaleFinal,
                isRecall,
                Business_Unit_RBU_Name,
                DepartmentID
            FROM import_product;
            INSERT INTO product_attr (Keycode,
                                APN,
                                Department_ID,
                                Minor_Department_ID,
                                Family_ID,
                                Class_ID,
                                Fixture_Code)
                Select Keycode, APN, Department_ID, Minor_Department_ID, Family_ID, Class_ID, Fixture_Code FROM import_product_attr
                ON DUPLICATE KEY UPDATE
                Keycode=VALUES(Keycode),
                APN=VALUES(APN),
                Department_ID=VALUES(Department_ID),
                Minor_Department_ID=VALUES(Minor_Department_ID),
                Family_ID=VALUES(Family_ID),
                Class_ID=VALUES(Class_ID),
                Fixture_Code=VALUES(Fixture_Code);`);
    } catch (error) {
        console.log(error.message);
        return;
    }
}

exports.handler = async (event) => {
    try {
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slackHookErrors;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;
        pool = await db.getPool();
        const familyTree = await GetFamilyTree();
        logger.info('Family Tree fetched');
        await SynchronizeProducts(familyTree);
    } catch (error) {
        console.log(error);
        let slackMessage;
        slackMessage = `*Product Sync Data*\n`;
        slackMessage += `:x: Failed: There was an error with product sync lambda in the ${process.env.NODE_ENV} environment\n`;
        slackMessage += "```" + error + "```";
        await axios.post(SLACK_ERRORS, {text: slackMessage});
        throw error;
    }

};
