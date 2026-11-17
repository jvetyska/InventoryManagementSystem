# BigCommerce Sync for Transactions

## Configuration

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

## Description

Because this project utilizes webhooks, it needs to be running 24/7 in its own server.

Here are [the documentation pages](https://developer.bigcommerce.com/api-docs/getting-started/webhooks/about-webhooks) for BigCommerce's webhooks.

Anko's webhooks for BigCommerce are currently setup to be sent to this url: `transaction-sync.anko.com`

If this url is to be changed, modifications for its record set must be made in AWS Route 53.

Whenever a transaction occurs for Anko's online BigCommerce store, BigCommerce will ping our url at `transaction-sync.anko.com`

## Deploying

This project is deployed on the Elastic Beanstalk with the name `transaction-sync`

---

[Click here](../README.md) to return to the index.
