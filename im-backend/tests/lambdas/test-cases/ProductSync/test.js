const AWS = require("aws-sdk");

/***
sam local invoke ProductSyncData --profile kmart --parameter-overrides 'ParameterKey=ClientName,ParameterValue=kmart ParameterKey=EnvironmentType,ParameterValue=local'
***/

const lambda = new AWS.Lambda({
  apiVersion: "2015-03-31",
  endpoint: "http://127.0.0.1:3001",
  sslEnabled: false,
  region: "us-east-1",
  accessKeyId: "any",
  secretAccessKey: "any",
});

describe("ProductSyncData Lambda", function () {
  it("Trigger ProductSync", async () => {
    var params = {
      FunctionName: "ProductSyncData",
    };
    let [results] = await global.pool.query("select * from user LIMIT 1");
    let response = await lambda.invoke(params).promise();
    expect(response.StatusCode).toBe(200);
  });
});
