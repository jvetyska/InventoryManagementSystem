const AWS = require("aws-sdk");

const lambda = new AWS.Lambda({
  apiVersion: "2015-03-31",
  endpoint: "http://127.0.0.1:3001",
  sslEnabled: false,
  region: "us-east-1",
  accessKeyId: "any",
  secretAccessKey: "any",
});

describe("BackfillEfficacyReport", function () {
  it("Trigger BackfillEfficacyReport", async () => {
    var params = {
      FunctionName: "BackfillEfficacyReport",
    };
    let response = await lambda.invoke(params).promise();
    let data = JSON.parse(response["Payload"]);
    expect(response.StatusCode).toBe(200);
    expect(data).toBe("Done Successfully");
  });
});
