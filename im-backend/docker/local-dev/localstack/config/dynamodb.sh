#!/bin/bash

set -x
awslocal dynamodb create-table --cli-input-json file:///dynamodb/dev-task-log-table.json

awslocal dynamodb create-table --cli-input-json file:///dynamodb/dev-inventory-log-table.json

awslocal dynamodb create-table --cli-input-json file:///dynamodb/dev-performance-log-table.json
set +x