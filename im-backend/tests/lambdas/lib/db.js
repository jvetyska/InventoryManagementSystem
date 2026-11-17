var db = require("mysql2");

process.env.TZ = "UTC";
let pool,localPool;

exports.getPool = async function(config) {
    localPool = db.createPool({
        host: config.sqlHost,
        user: config.sqlUser,
        password: config.sqlPassword,
        database: config.sqlDatabase,
        multipleStatements: true,
        connectionLimit: 20,
        queueLimit: 10
    });
    pool = localPool.promise();
    return pool;
};


