### Building and Testing

Here's how to build and test a specific Lambda function on your local machine before it's deployed to AWS

First, make sure Docker is running on your computer

Second, change directory to somewhere with a `template.yaml` file. For example: `environments/anko/LAMBDA-US-EAST-2`

Finally, run the below command to build and invoke the function on your local machine. Make sure to replace `DatabaseCleanup` with the function that you'd like to test

`clear; rm -rf .aws-sam/; sam build DatabaseCleanup; clear; sam local invoke DatabaseCleanup`
