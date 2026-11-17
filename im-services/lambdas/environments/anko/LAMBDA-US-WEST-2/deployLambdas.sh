#!/bin/bash

set -euxo pipefail
cd "$(dirname "$0")"

echo "$PWD"
## Install dependancies for the layer
npm --prefix ../../../LayerDependencies/nodejs install ../../../LayerDependencies/nodejs || exit 1

## Install dependancies for shared lambda
for dir in ../../../shared/src/*/;
do
    (cd "$dir" && npm i);
done

sam build
## Package and deploy the stack
##sam package --template-file template.yaml --s3-bucket anko-lambda-us-west-2 --output-template-file out.yaml --region us-west-2
sam deploy                              \
    --template-file template.yaml       \
    --stack-name US-WEST-2-STACK        \
    --capabilities CAPABILITY_NAMED_IAM \
    --s3-bucket anko-lambda-us-west-2   \
    --region us-west-2                  \
    --no-fail-on-empty-changeset        \