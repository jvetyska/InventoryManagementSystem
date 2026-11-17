const TAG = "persist-products-to-db";
const db = require("/opt/nodejs/wmsDB.js");
const getConfig = require("/opt/nodejs/config.js");
const { AWS } = require("/opt/nodejs/xray.js");
const slack = require("/opt/nodejs/slack.js");
const awsApiHelper = require("/opt/nodejs/awsApiHelper.js");
const logger = require("/opt/nodejs/logger.js")(`${TAG}`);
const sqlQueries = require("./sqlQueries");
let pool, SLACK_ERRORS, SLACK_NOTIFICATIONS, config, sqlServerConnPool, slackReportingURL, IPS_DB, sqlConfig, sqs, sqsURL, s3, s3BucketName, familyTreeMap;


async function setup() {
    const fnName = "setup";
    try {
        logger.startTrace(`${fnName}`);
        pool = await db.getPool();
        config = await getConfig.getConfig(process.env.NODE_ENV);
        SLACK_ERRORS = config.slack_channel_errors;
        SLACK_NOTIFICATIONS = config.slack_channel_notifications;
        slackReportingURL = config.slackReportingURL;
        s3BucketName = config.bucket.productSync;
        sqsURL = config.compare_pims_image_sqs_url;
        AWS.config = new AWS.Config();
        AWS.config.region = config.region;
        sqs = new AWS.SQS({apiVersion: '2012-11-05'});
        s3 = new AWS.S3({apiVersion: "2006-03-01"});
        familyTreeMap = await getFamilyTree();
        logger.info(TAG, "Setup Complete");
        logger.endTrace(`${fnName}`);
    } catch (err) {
        throw err;
    }
}

async function getFamilyTree() {
    let rows;
    let map = {};
    const fnName = "getFamilyTree";
    try {
        logger.startTrace(fnName);
        [rows] = await pool.query(sqlQueries.getFamilyTreeQuery());
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
        logger.info(`${TAG}:${fnName}`, " familyTree fetched");
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
    logger.info(TAG, "getFamilyTree executed successfully");
    return map;
}

async function processProductData(familyTree, productList) {

    const fnName = "processProductData";
    try {
        logger.startTrace(fnName);
        logger.info(`${TAG}:${fnName}`, " processProductData starting");
        let mainProductsArr = [];
        let mainProductAttrArr = [];
        let mainProductBarcodeArr = [];

        for (let row of productList) {
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
                logger.info(TAG, `ERR_EQU_LEN: rejecting Keycode ${keycode}`);
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
                    //logger.info(`ERROR: Unexpected fixture. The fixture was: ${fixture}`);
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

            let localProduct = [];
            let localProductAttr = [];
            let localProductBarcode = [];
            localProduct.push(
                keycode,
                barcode,
                productName,
                departmentID,
                className,
                subClassName,
                subSubClassName,
                productStatus,
                buRBUName,
                description,
                itemSize,
                costPrice,
                retailPrice,
                secondaryColour,
                styleID,
                recall
            );

            localProductAttr.push(
                keycode,
                barcode,
                departmentID,
                minorID,
                familyID,
                classID,
                fixture
            );
            localProductBarcode.push(
                keycode,
                barcode
            );
            mainProductsArr.push(localProduct);
            mainProductAttrArr.push(localProductAttr);
            mainProductBarcodeArr.push(localProductBarcode);
        }
        if(mainProductsArr.length > 0) {
            await pool.query(sqlQueries.getInsertToProductTblQuery(), [mainProductsArr]);
            logger.info(`${TAG}:${fnName}`, "product table updated");
        }
        if(mainProductAttrArr.length > 0) {
            await pool.query(sqlQueries.getInsertToProductAttrTblQuery(), [mainProductAttrArr]);
            logger.info(`${TAG}:${fnName}`, "product_attr table updated");
        }
        if(mainProductBarcodeArr.length > 0) {
            await pool.query(sqlQueries.getInsertProductsBarcodeTblQuery(), [mainProductBarcodeArr]);
            logger.info(`${TAG}:${fnName}`, "product_barcode table updated");
        }
        logger.info(`${TAG}:${fnName}`, ` updated ${productList.length} products`);
        await slack.report(TAG, SLACK_NOTIFICATIONS, 200, ` updated ${productList.length} products`);
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }

}

async function downloadJSONFromS3(body) {
    const fnName = "downloadJSONFromS3";
    try {
        logger.startTrace(fnName);
        let s3Response = JSON.parse(body);
        let s3Params = {
            Bucket: s3BucketName,
            Key: s3Response.Key,
        }
        let s3Object = await s3.getObject(s3Params).promise();
        let data = s3Object.Body.toString("utf8");
        let jsonData = JSON.parse(data);
        await processProductData(familyTreeMap, jsonData.productData);
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}

async function pushKeyToNextQueue(dataStr) {
    const fnName = "pushKeyToNextQueue";
    try {
        logger.startTrace(fnName);
        let params = {
            MessageBody: dataStr,
            QueueUrl: sqsURL
        }
        await sqs.sendMessage(params).promise();
        logger.info(`${TAG}:${fnName}`, " message pushed to SQS");
        logger.endTrace(fnName);
    } catch (err) {
        throw err;
    }
}

exports.handler = async (event) => {
    const fnName = "handler";
    try {
        logger.startTrace(fnName);
        await setup();
        logger.info(event);
        await downloadJSONFromS3(event.Records[0].body);
        let s3Response = JSON.parse(event.Records[0].body);
        await awsApiHelper.sendSqsMessage(sqsURL, s3Response);
        // await slack.report(TAG, SLACK_NOTIFICATIONS, 200, "success");
        logger.endTrace(fnName);
        return {"statusCode": 200};
    } catch (err) {
        logger.error(`${TAG}:${fnName}`, err);
        await slack.report(TAG, SLACK_ERRORS, 500, err.message);
        return {"statusCode": 500, "error": err.message};
    }
};
