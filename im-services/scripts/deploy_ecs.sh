#!/bin/bash

# http://blog.kablamo.org/2015/11/08/bash-tricks-eux/
set -euxo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. scripts/stack_name_vars.sh


NONPRIV_ROLE_NAME="infra-cfnrole-${PROJECT_ID}-nonprivileged"
PARAMS_FILE="CloudFormation/params/${ENVIRONMENT}/${AWS_DEFAULT_REGION}.yml"
# cfn_manage delete-stack --stack-name "$CFN_ECS_STACK"
cfn_manage deploy-stack \
  --stack-name "$CFN_ECS_STACK" \
  --template-file 'CloudFormation/templates/ecs.yml' \
  --parameters-file "$PARAMS_FILE" \
  --role-name "$NONPRIV_ROLE_NAME"    
   

  

  