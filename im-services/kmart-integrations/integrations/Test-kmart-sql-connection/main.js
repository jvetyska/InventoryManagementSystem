// Standard Integration requirements
const path = require("path");
const express = require("express");
const router = express.Router();
const config = require("./config.js");

// Requirements for this file
// const mysql = require("mysql2"); // Example
const mssql = require("mssql");

async function Main(req, res) {
    console.log("It works");

    let mssql = await ConnectToMsSQL(config["MSSQL_IPS"]);
    let results;
    let sql = `  
                  SELECT TOP (3) soh.[Str_ID]
                  ,soh.[M_KD]
                  ,soh.[SOH]
                  ,soh.[SOO]
                  ,soh.[SIT]
                  ,(isnull(o.[StoreSales],0)+ isnull(o.[OnlineSalesReserved],0)) as 'OnlineSales'
              FROM [IPS].[dbo].[SOH] soh
              left join  [IPS].[dbo].[SOH_OnLine] o
              on soh.Str_ID = o.Str_ID and soh.M_KD = o.M_KD
              where soh.soh <> 0 AND soh.Str_ID = @StrID`;
	
    try {
        results = await mssql.request()
				.input('StrID', 1154)
				.query(sql);
        console.log(" DONE");
        console.log("results>>>>>", results);
        mssql.close(); // Close the MS SQL connection since we'll need a different connection later
    } catch (error) {
        console.log(error);
        process.exit();
    }

    res.status(200).send({"data": JSON.stringify(results) });
}

async function ConnectToMsSQL(config) {
    let host     = config.host;
    let user     = config.user;
    let password = encodeURIComponent(config.password);
    let database = config.database;
    let connectionString = `mssql://${user}:${password}@${host}/${database}?connectionTimeout=100000&request timeout=100000`;
    try {
        return await mssql.connect(connectionString);
    } catch (error) {
        console.log(error);
        process.exit();
    }
}

// Standard Integration route and exports; don't change this
router.get(`/test-kmart-sql-connection`, Main);

module.exports = router;

