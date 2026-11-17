# Anko Microservices

## Installing the AWS CLI on your MacBook Pro

1. Install pip: `sudo easy_install pip`
2. Install AWS CLI: `pip install awscli --upgrade --user`
3. Open this file: `~/.bash_profile`
4. Add the line below to the very top of the file: `.bash_profile`
   `export PATH=$PATH:/Users/username/Library/Python/2.7/bin/`
   (make sure you put in the correct `username`)
5. Close all terminals
6. Run this command to verify that it installed correctly: `aws --version`

#### Usage

The purpose of these microservices are to perform repetitive routine tasks on the database via API call(s) to the Anko server. The code each microservice is stored in [AWS Lambda](https://us-east-2.console.aws.amazon.com/lambda/home?region=us-east-2), and scheduling the times that it's ran is done through [CloudWatch Events](https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#events:). These tasks should take a relatively small amount of code, and everything can be contained in a single file `index.js`

A basic file should look something like the below example:

```js
var request = require('request');

part_1 = function() {
  return new Promise((done, fail) => {
    // Code
    done();
  });
};

part_2 = function() {
  return new Promise((done, fail) => {
    // Code
    done();
  });
};

exports.handler = function main() {
  part_1().then(() => part_2());
};

if (typeof process.env.local === 'string') exports.handler();
```

AWS Lambda automatically calls whatever function is bound to `exports.handler`. Since this isn't true when running/testing on your local machine, a condition on whether or not to call the function needs to be made. which in this case

`local= node index.js`

---

Create the .zip archive and then send it to AWS Lambda

```
zip -FSrX package.zip .
aws lambda update-function-code --function-name square_sync --zip-file fileb://package.zip
```

aws lambda update-function-code --function-name dev_import_sales_transaction --zip-file fileb://package.zip
aws lambda update-function-code --function-name dev_replenish_order --zip-file fileb://package.zip

var params = {
FunctionName: 'Your-Function-Name', /_ required _/
Environment: {
Variables: {
'TABLE_NAME': 'Your-New-Dynamo-Table-Name'
}
}
};
lambda.updateFunctionConfiguration(params, function(err, data) {
if (err) console.log(err, err.stack); // an error occurred
else console.log(data); // successful response
});
