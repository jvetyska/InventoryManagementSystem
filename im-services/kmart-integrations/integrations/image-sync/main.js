// Standard Integration requirements
const path = require("path");
const express = require("express");
const router = express.Router();
const INTEGRATION_NAME = path.basename(path.dirname(__filename));
const config = require("./config.js");
const mssql = require("mssql");



async function ConnectToMsSQL() {
    // Create a connection to Kmart's MSSQL database
    let host     = (PIMS_DB) ? PIMS_DB.host : config.host;
    let user     = (PIMS_DB) ? PIMS_DB.user : config.user;
    let password = (PIMS_DB) ? encodeURIComponent(PIMS_DB.password)  : encodeURIComponent(config.password);
    let database = (PIMS_DB) ? PIMS_DB.database : config.database;
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

    try {
        await ConnectToMsSQL();
        const keycode = req.query.keycode || null;
        if (keycode === null) {
            res.status(400).json({data: "Invalid keycode"});
            return;
        }

        results = await mssql.query(`
            SELECT
                pik.M_KD AS Keycode,
                p.IMAGE AS Image
            FROM Kmart_PIM.dbo.ProductImageKeycode pik
            INNER JOIN Kmart_PIM.dbo.ProductImage p ON p.ProductImageId = pik.ProductImageID
            WHERE pik.M_KD = ${keycode};`);
        console.log(`Image data fetched.. for ${keycode}`);
    } catch (error) {
        console.log(error.message);
        console.log(error.code);
        res.status(500).json({message: error.message});
        return;
    }

    res.status(200).json({data: results.recordset});
}

async function Post(req, res) {
    try {
        await ConnectToMsSQL();
    } catch (error) {
        res.status(500).json({message: `Unable to connect to the MS SQL Database: ${error}`});
        return;
    }

    const keycodes = req.body.keycodes;
    const argKeycodes = keycodes.join(",");

    try {
        results = await mssql.query(`
            SELECT
                pik.M_KD AS Keycode,
                HASHBYTES('MD5', CONVERT(VARCHAR(8000), p.IMAGE)) AS ImageHash
            FROM Kmart_PIM.dbo.ProductImageKeycode pik
            INNER JOIN Kmart_PIM.dbo.ProductImage p ON p.ProductImageId = pik.ProductImageID
            WHERE pik.M_KD IN (${argKeycodes});`);
    } catch (error) {
        console.log(error);
        res.status(500).json({message: error.message});
        return;
    }

    res.status(200).json({data: results.recordset});
}

router.get(`/${INTEGRATION_NAME}`, Get);
router.post(`/${INTEGRATION_NAME}`, Post);

module.exports = router;
