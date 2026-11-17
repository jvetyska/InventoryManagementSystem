#!/bin/bash -e

# If you want to run deploy from your local desktop use:  ./infra-deploy-lambda.sh ENVIRONMENT=<uat,dev,prod>


function full_help {
  cat << "TXT"
Infrastructure Deployment tool for deploying CloudFormation stacks using SAM .

It will follow the -g (guided) Option of SAM deployment

Additional functionalities:


Available flags:

-n) *required* The name of the CloudFormation stack
-f) *required* Template to be used for sam build
-d) Override the template path from templates
-p) The JSON file containing the parameters to be applied to the stack. e.g.
    `-p lambda-dev-prod` when you wish to use parameters/lambda-prod.json
-s) S3 bucket name for the Lambda Build
-i) Kafka Image


To create ChangeSet:

e.g. For dev environment

./infra-deploy-lambda.sh -n dosa-dev-lambda	-f lambda -p lambda-dev -s kmart-dosa-dev-lambda-stack -i dev-dosa-kafka-lambda



TXT
}

cd lambdas/environments/kmart-external/AP-SOUTHEAST-2

while getopts "n:f:p:s:i:h" opt; do
  case $opt in
    n)
      NAME=$OPTARG
      ;;
    f)
      FILE_SUFFIX="yaml"
      TEMPLATE_FILE="${PWD}/${OPTARG}.${FILE_SUFFIX}"
      ;;
    p)
      PARAMETER_FILE="params/${OPTARG}.json"
      ;;
    s)
      S3BUCKET=$OPTARG
      ;;
    i)
      KAFKAIMAGE=$OPTARG
      ;;
    h)
      full_help
      exit 2
      ;;
  esac
done

echo "$PWD"
## Install dependancies for the layer
npm --prefix ../../../LayerDependencies/nodejs install ../../../LayerDependencies/nodejs || exit 1

LambdaECRUriBase=$(aws cloudformation describe-stacks --stack-name dosa-ecr-lambda --query "Stacks[*].Outputs[?OutputKey=='KafkaLambdaRepoURI'].OutputValue[]" --output text)

aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin $LambdaECRUriBase

#Building the package using the referenced lambda file
sam build -t $TEMPLATE_FILE

find ../../../ -mtime +10950 -exec touch {} \;

#converting the Json into Parameter file for sam compatible parameters
SAM_PARAMETERS=$( cat ${PARAMETER_FILE}| jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' )

## Package and deploy the stack
sam deploy                                              \
    --stack-name $NAME        \
    --capabilities CAPABILITY_NAMED_IAM                 \
    --s3-bucket $S3BUCKET        \
    --region ap-southeast-2                             \
    --parameter-overrides  $SAM_PARAMETERS              \
    --no-fail-on-empty-changeset                        \
    --image-repository $LambdaECRUriBase/$KAFKAIMAGE          \


DOCKER_IMAGE_CLEAN=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'kafka')
#Condition added to avoid build failure if the image has been deleted by other sources
if [[ ! -z $DOCKER_IMAGE_CLEAN ]]; then
  docker rmi $DOCKER_IMAGE_CLEAN -f
fi

