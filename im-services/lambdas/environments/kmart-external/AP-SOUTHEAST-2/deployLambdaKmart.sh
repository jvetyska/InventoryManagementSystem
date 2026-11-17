#!/bin/bash

# If you want to run deploy from your local desktop use:  ./deployLambdaKmart.sh -e dev
# -e flag takes environment value (dev, stg, prod) you want to deploy.
set -euxo pipefail

while getopts e: option
do
case "${option}"
in
e) envType=${OPTARG};;
?) echo "No -${OPTARG} argument found.";;
esac
done

cd "$(dirname "$0")"

echo "$PWD"
## Install dependancies for the layer
npm --prefix ../../../LayerDependencies/nodejs install ../../../LayerDependencies/nodejs || exit 1

PARAMS_FILE="$(cat params/${envType})"

aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin 495621338632.dkr.ecr.ap-southeast-2.amazonaws.com

sam build

find ../../../ -mtime +10950 -exec touch {} \;
## Package and deploy the stack
sam deploy                                              \
    --stack-name kmart-${envType}-lambda-stack          \
    --capabilities CAPABILITY_NAMED_IAM                 \
    --s3-bucket kmart-${envType}-lambda-stack           \
    --region ap-southeast-2                             \
    --parameter-overrides  $PARAMS_FILE                 \
    --no-fail-on-empty-changeset                        \
    --image-repository 495621338632.dkr.ecr.ap-southeast-2.amazonaws.com/kmart-${envType}-kafka-lambda \

docker rmi $(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'kafka') -f
docker system prune -f