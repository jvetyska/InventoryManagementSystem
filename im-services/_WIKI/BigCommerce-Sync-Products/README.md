# BigCommerce Sync for Products

There are two variations for this project. One is in charge of synchronizing all apparel products from our database to BigCommerce. The other variation synchronizes all other non-apparel products from our database to BigCommerce.

# Configuration

The configuration is done the exact same way for both projects, so the configuration rules are documented here rather than under the sections for each project variant.

Duplicate the `config-template.js` file twice, renaming them to `config-dev.js` and `config-prod.js`. You can modify these for your development and production environments. These will be ignored by Git, and only changes to the template  file will be staged/committed.

Retrieve the SQL database information from an Anko database administrator.

You will receive the four API keys for BigCommerce (BC) when you create a new API Account at the following URL: https://anko.com/manage/settings/auth/api-accounts

If an API account already exists, it's recommended to contact somebody that already has the API keys so that extraneous accounts don't get created.

The programs can be ran by using one of two commands:
`npm run dev`
`npm run prod`
You may also specify the environment variables on the command line (which takes precedence) instead of setting them in `config-dev/prod.js`

| Environment Variable  | Description                             |
|-----------------------|-----------------------------------------|
| `sql_host`            | The location or URL of the SQL database |
| `sql_user`            | Username of the SQL database            |
| `sql_password`        | Password for the username above         |
| `sql_database`        | The name of the database to be used     |
| `store`               | BC API key for the store                |
| `token`               | BC API key for the token                |
| `client`              | BC API key for the client               |
| `secret`              | BC API key for the secret               |

# BigCommerce Product Sync (apparel)

This variation of BC Sync lives in the directory: `bigcommerce-product-sync-apparel`

## Description

Because apparel has multiple variations per product, it is much more complex to synchronize from our database to BigCommerce. These variations in clothing are the reason why we have two seperate projects for a similar task.

## Deploying

This project is deployed under/using/with TODO

# BigCommerce Product Sync (non-apparel)

This variation of BC Sync lives in the directory: `bigcommerce-product-sync`

## Description

This will synchronize all other products that aren't under the "apparel" category from our database to BigCommerce.

## Deploying

This project is deployed on AWS Lambda with the name `bigcommerce_product_sync`

It is scheduled to run every 30 minutes which is triggered by a CloudWatch rule of the same name `bigcommerce_product_sync`

---

[Click here](../README.md) to return to the index.
