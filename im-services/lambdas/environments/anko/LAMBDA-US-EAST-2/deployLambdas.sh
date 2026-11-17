#!/bin/bash

set -euxo pipefail
cd "$(dirname "$0")"

echo "$PWD"
## Install dependancies for the layer
npm --prefix ../../../LayerDependencies/nodejs install ../../../LayerDependencies/nodejs || exit 1

aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 490619545857.dkr.ecr.us-east-2.amazonaws.com

sam build

find ../../../ -mtime +10950 -exec touch {} \;
#sam package --template-file template.yaml --s3-bucket anko-lambda-us-east-2 --output-template-file out.yaml --region us-east-2
sam deploy                              \
    --stack-name US-EAST-2-STACK        \
    --capabilities CAPABILITY_NAMED_IAM \
    --s3-bucket anko-lambda-us-east-2   \
    --region us-east-2                  \
    --no-fail-on-empty-changeset        \
    --image-repository 490619545857.dkr.ecr.us-east-2.amazonaws.com/docker-lambda \

docker rmi $(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'kafka') -f
docker system prune -f