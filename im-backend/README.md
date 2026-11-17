# AnkoUS Repository - Warehouse Management Service API

This is the Warehouse Management Service API.
The API is accessible in Swagger UI at: http://localhost:3000/api-docs/

This repository also contains the WMS UI, built in angular. 

---

## Running locally and deployment

This simplest way to get the API server started locally with the UI available all on one port:

1. run: `npm install`
2. run: `npm run buildLocal && npm run local`
3. If you don't need to re-build the UI, just run `npm run local`.
4. Open the UI on http://localhost:3000 and the API swagger on: http://localhost:3000/api-docs/

To deploy the APIs to **Elastic Beanstalk**:

1. Might have to run `eb init` for the first time.
2. For dev environment: `eb deploy`.
3. For production environment: `eb deploy anko-microwarehouse-prod-2`

To deploy the WMS UI to **S3 bucket**:

1. For dev environment: `./deployAngular`
2. For production environment: `./deployAngularProd`


## Logs 
1. run: `eb logs -g /aws/elasticbeanstalk/anko-warehouse-dev/var/log/nodejs/nodejs.log --stream`
2. if not enabled, enable logging via: `eb logs --cloudwatch-logs enable`

### Logs via SSH option:
1. You will need AWS access key .pem file in your ~/.ssh folder. Ask your teammates for it or you can download it here: https://drive.google.com/open?id=1DnVlditvU2_cvBsWAGnzYfx817IR4qow
2. Change selected EB instance with `eb use xxxxxx`
3. Run: `eb ssh`
4. Tail nodejs log: `tail -f /var/log/nodejs/nodejs.log`

---

## Run e2e testing

1. Type command "ng e2e" in project directory to run e2e testing.

## Scheduling jobs

We need to automate certain functions to periodically run at scheduled intervals. Here are some examples:
```
insert_sales_transaction | Every hour
replenish_order          | Daily at 9:50pm PST  / 4:50am GMT
replenish_order_to_task  | Daily at 10:00pm PST / 5:00am GMT
```

In order to automatically schedule functions to be called, an SNS Topic needs to be created which will ping the server.
After creating the SNS Topic, you need to create a CloudWatch rule that will automatically run it at a specified time.

Setting up an SNS Topic/Subscription:

1. Make sure that the function you want to schedule calls to is a POST request, because
   AWS' Simple Notification Service can only deliver POSTs (not GETs)

2. https://us-east-2.console.aws.amazon.com/sns/v2/home?region=us-east-2#/topics

3. Click on the **Create new topic** button:
  - **Topic name**: INFO_my_function_name
    - INFO should be the time period when the function will be called. For example, if
       you want the function "daily_log" to be called at 11:30pm every day, the entire
       topic name should be: 23-30_daily_log
  - **Display name**: Leave it blank
  - Click on the **Create topic** button

4. Check the checkbox for the topic you've just created.

5. Click on the **Actions** button followed by **Subscribe to topic**:
  - **Topic ARN**: Leave this field alone
  - **Protocol**: Change this to "HTTPS"
  - **Endpoint**: Choose the appropriate URL for the dev or prod environment
                  https://api-dev.anko.com/api/my_function_name
                  https://api.anko.com/api/my_function_name

6. Repeat step five for all endpoints.

7. When you click on the **Subscriptions** link on the left side, you should see that all subscriptions have a **Subscription ARN**. If there are any that say **"PendingConfirmation"**, then that means AWS was unable to reach the server so you'll need to investigate why. The application is setup such that it should allow all AWS subscription requests in `app.js`

8. After you've confirmed the subscription, the final step is to create a rule in CloudWatch:
https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#rules:

9. Click on the **Create rule** button.

10. For **Event Source**, click on the **Schedule** radio button and then the **Cron expression**, entering in a valid cron time that cooresponds with when you want the function to be automatically called.

11. Click the **Add target** button and then **SNS topic** from the dropdown menu that appears, selecting the **Topic** you've just created in the second dropdown menu.

12. Click on the **Configure details** button.

13. For clarity, give it the same **Name** of the SNS Topic. For the earlier example, this would be: 23-30_daily_log

14. Enter in an optional description, decide if you want the job to be actively scheduled right now, and finally click on the **Create rule** button.
