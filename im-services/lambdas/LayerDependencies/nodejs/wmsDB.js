const mysql = require('mysql2/promise');
const { instrumentDbPool } = require("./xray");
const config = require("./config.js");
let pool, prodPool;

async function getPool() {
    const configValues = await config.getConfig(process.env.NODE_ENV);

    if (!pool) {
        pool = instrumentDbPool(mysql.createPool({
            "host"    : configValues.sql_host,
            "user"    : configValues.sql_user,
            "password": configValues.sql_password,
            "database": configValues.sql_database,
            multipleStatements: true
        }));
    }

    return pool;
};

async function getProdPool() {
    const configValues = await config.getConfig(process.env.NODE_ENV);

    if (!prodPool) {
        prodPool = instrumentDbPool(mysql.createPool({
            "host"    : configValues.prod_sql_host,
            "user"    : configValues.prod_sql_user,
            "password": configValues.prod_sql_password,
            "database": configValues.prod_sql_database,
            multipleStatements: true
        }));
    }

    return prodPool;
};

async function queryWithRetries(sql, args, numberOfRetries = 5, retryDelay = 1000) {
    let results;
    const pool = await getPool();
    while (numberOfRetries > 0) {
        try {
            results = await pool.query(sql, args);
        } catch (error) {
            if (error && error.code == "ER_LOCK_DEADLOCK") {
                console.log(`queryWithRetries encountered DEADLOCK. Retrying ${numberOfRetries} more times.\n\n\n`);
                numberOfRetries--;
                await new Promise(resolve => setTimeout(resolve, retryDelay));

                continue;
            } else {
                throw error;
            }
        }

        return results;
    }
};

module.exports = {
    getPool,
    getProdPool,
    queryWithRetries,
}