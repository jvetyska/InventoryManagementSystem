#!/bin/bash
if [[ -z "${STACK_SUFFIX-}" ]]; then
  # Jenkins - Multibranch Pipelines
  if [[ -n "${BRANCH_NAME-}" ]]; then
    if [[ "$BRANCH_NAME" != "master" ]]; then
      STACK_SUFFIX="-${BRANCH_NAME}"
    fi
  # GNU/UNIX
  elif [[ -n "${USER-}" ]]; then
    STACK_SUFFIX="-${USER}"
  # Windows - Git Bash
  elif [[ -n "${USERNAME-}" ]]; then
    STACK_SUFFIX="-${USERNAME}"
  else
    echo "Could not cleanly determine stack suffix!" 1>&2
    exit 1
  fi
  export CFN_STACK_SUFFIX="${STACK_SUFFIX-}"
fi

export CFN_PROJECT_ID="${PROJECT_ID-}"

CFN_ECS_STACK="${PROJECT_ID}-ecs-deploy${STACK_SUFFIX-}"
CFN_ECS_STACK=$(echo $CFN_ECS_STACK)
export CFN_ECS_STACK

export CFN_NGINX_IMAGE="${NGINX_IMAGE}"
export CFN_SLAVE_IMAGE="${SLAVE_IMAGE}"
CFN_IAM_STACK="${IAM_STACK}"
CFN_IAM_STACK=$(echo $CFN_IAM_STACK)
export CFN_IAM_STACK
CFN_ELB_STACK="${ELB_STACK}"
CFN_ELB_STACK=$(echo $CFN_ELB_STACK)
export CFN_ELB_STACK
CFN_EC2_STACK="${EC2_STACK}"
CFN_EC2_STACK=$(echo $CFN_EC2_STACK)
export CFN_EC2_STACK
CFN_TASK_DEF="${TASK_DEFINITION}"
export CFN_TASK_DEF