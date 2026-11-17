# Upstream Replenishment For MCC and CMI

This project is a lambda function that runs daily and generates replenishment reports. This has three different lambdas CMIReplenAWS, CMIEmailReplenishment and MCCRequestReplenishment. 

#Description

## CMIReplenAWS
    
    This file goes though the products and uses the Average Weekly Sales to calculate replenishment for the CMI and MCC and store the CMI information in a CSV and the MCC information in a JSON file and upload them to the S3 bucket python-inout-file/JavaScriptReplenishment


## CMIEmailReplenishment

    This file pulls the CSV generated from the CMIReplenAWS from the S3 bucket and generates and sends an email with the information to the CMI.

## MCCRequestReplenishment

    This file pulls the JSON generated from the CMIReplenAWS from the S3 bucket and sends it to the MCC API. Not currently up due to changes Currently happening at the MCC due to formating. 

#todo