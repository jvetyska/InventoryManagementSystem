# Deploying a Microservice

## Description

This is a very simple tool that has been created in order to make deploying to AWS Lambda a lot faster and easier.

## Usage

Simply use this command from within the directory that you're developing in: `node ../deploy.js`

The script will zip up all of your files and then attempt to upload them to the Lambda function that has a matching name of the folder that you are in. Below is what you will see if it was successful:

```
========== START ==========
Getting current working directory ... DONE
Creating package.zip ... DONE
Deploying to AWS Lambda as sample ... DONE
Deleting package.zip ...DONE
=========== END ===========
```

If you see an error such as the one below...

```
An error occurred (ResourceNotFoundException) when calling the UpdateFunctionCode operation: Function not found: arn:aws:lambda:us-east-2:490619545857:function:hello-world
```

...then that means the Lambda function doesn't exist in AWS. Take a look at the end of the sample error above and notice how it says `hello-world` at the very end. You will either need to change the name of the directory that you're in to the name of an existing Lambda function, or create a new Lambda function with that exact same name.

# Todo

As of right now, you can only update Lambda functions that already exist. This tool is unable to create brand new Lambdas so they must be manually created instead, so it would be nice to implement this functionality.

Implement a way to deploy all microservices that belong to a Lambda function at the same time. This will be extremely useful when a configuration file is modified and you have multiple microservices that rely on the same config.

---

[Click here](../README.md) to return to the index.
