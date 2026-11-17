# Kmart Integrations

One EC2 server will be dedicated for Kmart Integrations. These will be jobs specialized for Kmart. One example (and the only current integration) is `product-sync` which will synchronize products FROM Kmart's MS SQL database to Anko's MySQL database.

Kmart Integrations is structured by having a Node Express server route to the various jobs that it contains. If you want to execute the `product-sync` job, then you will make a `POST` request to `/api/product-sync`.

Though these jobs may be run manually by calling a `POST` on them, they will typically be ran at regularly scheduled intervals through the help of cron jobs.

Each integration will have its own directory within `integrations` because of the different resources that could be unique for it. Every integration must have at least one file called `main.js` which will contain the route. You may add any other relevant files (configurations, CSVs, etc) in this directory and have `main.js` handle them as needed.
