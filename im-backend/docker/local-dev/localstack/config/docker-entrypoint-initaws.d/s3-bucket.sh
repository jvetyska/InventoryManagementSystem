#!/bin/bash

set -x
awslocal s3 mb s3://$IMAGE_BUCKET
awslocal s3api put-bucket-acl --bucket $IMAGE_BUCKET --acl public-read-write --region ap-southeast-2

awslocal s3 mb s3://$LOG_BUCKET
awslocal s3api put-bucket-acl --bucket $LOG_BUCKET --acl public-read-write --region ap-southeast-2

awslocal s3 mb s3://$CSV_BUCKET
awslocal s3api put-bucket-acl --bucket $CSV_BUCKET --acl public-read-write --region ap-southeast-2

awslocal s3 mb s3://$REPORT_BUCKET
awslocal s3api put-bucket-acl --bucket $REPORT_BUCKET --acl public-read-write --region ap-southeast-2

awslocal s3 mb s3://$REPLENISH_BUCKET
awslocal s3api put-bucket-acl --bucket $REPLENISH_BUCKET --acl public-read-write --region ap-southeast-2
set +x
