const AWS = require("aws-sdk");
const DB = require("../lib/db");
var credentials = new AWS.SharedIniFileCredentials({ profile: "kmart" });
AWS.config.credentials = credentials;

global.beforeAll(async () => {
  try {
    let secret = await new AWS.SecretsManager({ region: "ap-southeast-2" })
      .getSecretValue({ SecretId: "kmart-local-secret" })
      .promise();
    secret = secret["SecretString"];
    let localSecret = JSON.parse(secret);
    global.config = localSecret["kmart-local"];
    global.pool = await DB.getPool(global.config);
    global.ro_pool = pool;
    global.global_req = {
      query: {
        ID: 1,
        username: "test",
      },
      headers: {
        "user-role": ["s_manager"],
        "user-id": 1,
      },
    };
    // console.log(global.pool);
    // console.log(global.config);
    console.log("Hooks Fired");
  } catch (error) {
    console.log(error);
  }
});

global.afterAll(async () => {
  console.log("Cleaning after tests");
  global.pool.end();
  console.log("Cleaned.....");
});
