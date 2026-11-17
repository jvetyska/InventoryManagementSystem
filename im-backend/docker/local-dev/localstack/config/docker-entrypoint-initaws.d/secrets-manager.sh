#!/bin/bash

set -x
awslocal secretsmanager create-secret --name dev-secret --secret-string file:///secretsmanager/dev-secrets.json
set +x