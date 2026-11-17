// Standard Integration requirements
const path = require("path");
const express = require("express");
const router = express.Router();
const INTEGRATION_NAME = path.basename(path.dirname(__filename));
const config = require("./config.js");
const mssql = require("mssql");

const ROW_LIMIT = 100000; // Retrieve up to 100,000 rows at a time

async function ConnectToMsSQL() {
    // Create a connection to Kmart's MSSQL database
    let host     = (IPS_DB) ? IPS_DB.host : config.host;
    let user     = (IPS_DB) ? IPS_DB.user : config.user;
    let password = (IPS_DB) ? encodeURIComponent(IPS_DB.password) : encodeURIComponent(config.password);
    let database = (IPS_DB) ? IPS_DB.database : config.database;
    let connectionString = `mssql://${user}:${password}@${host}/${database}`;

    try {
        await mssql.connect(connectionString);
        console.log(`Connected to ${host}`);
    } catch (error) {
        console.log("ERROR: Error connecting to MSSQL Server");
        console.log(error.message);
        console.log(error.code);
        throw error;
    }
}

async function Get(req, res) {
    const pageNumber = req.query.page || 0;
    let results;

    // Get the Product Data from Kmart's MS SQL database that will need to be synced to the Anko MySQL DB
    // Note: There are currently 1,224,612 products in Kmart's MS SQL database
    try {
        await ConnectToMsSQL();
    } catch (error) {
        console.error(error.message);
        res.status(500).json({message: `Unable to connect to the MS SQL Database: ${error}`});
        return;
    }

    try {
        const rowOffset = ROW_LIMIT * pageNumber;
        results = await mssql.query(`
            SELECT
                k.M_KD              AS Keycode,
                a.M_APN             AS Barcode,
                k.C_KD_STAT         AS Product_Status,
                k.T_PLU_DESC_KD     AS Product_Name,
                k.C_MDEPT           AS Department_ID,
                k.C_MCHL_TWO        AS Minor_ID,
                k.C_MCHL_THREE      AS Family_ID,
                k.C_MCHL_FOUR       AS Class_ID,
                k.C_MCHL_FIVE       AS Sub_Class_ID,
                k.C_MCHL_SIX        AS Sub_Sub_Class_ID,
                k.M_STYLE           AS Style_ID,
                k.N_ABBR_COLR       AS Secondary_Colour,
                k.N_ABBR_SIZE       AS Item_Size,
                k.A_CHRG_OUT_COST   AS Cost_Price,
                k.A_PR_POS          AS Retail_Price,
                rbu.N_RBU           AS Business_Unit_RBU_Name,
                k.T_PLU_DESC_KD     AS Description,
                k.C_KD_FIXTURE_TYPE AS Fixture,
                F_KD_RECALL         AS Recall
            FROM IPS.dbo.SLT200 k
            INNER JOIN IPS.dbo.SLT201 a ON k.M_KD = a.M_KD AND k.M_KD != a.M_APN
            INNER JOIN IPS.dbo.SLT420 d ON d.C_MDEPT = k.C_MDEPT
            INNER JOIN IPS.dbo.RBU    rbu ON rbu.M_RBU = d.M_RBU
            ORDER BY k.M_KD ASC
            OFFSET ${rowOffset} ROWS
            FETCH NEXT ${ROW_LIMIT} ROWS ONLY;`);

        mssql.close();
        console.log(`Fetched next ${ROW_LIMIT} rows of data`);
    } catch (error) {
        console.log(error);
        res.status(500).json({message: `Error occured while running query: ${error.message}`});
        return;
    }

    res.status(200).json({data: results.recordset});
}

async function Post(req, res) {
    res.status(400).json({message: "This API endpoint must be called through a GET request"});
}

// Standard Integration route and exports; don't change this
router.get(`/${INTEGRATION_NAME}`, Get);
router.post(`/${INTEGRATION_NAME}`, Post);

module.exports = router;
