# Passwords and Tokens

Whenever you create a new username/password or token that our systems use, you should document it here so that we can keep track of them all. Do NOT list any security credentials here. Instead, you should retrieve them from a person that has them saved.

# Production

## SQL Database Information

This includes four different pieces of information:
* Host/URL of the database
* Username
* Password
* Default database

Who to contact:
* Jiri Vetyska
* Leif Coleman
* Vu Dinh

## BigCommerce API Accounts

These are found on the BigCommerce dashboard under `Advanced Settings -> API Accounts`. Note that you must be logged into the owner account. There are currently six different API accounts that are created in BigCommerce:
1. ankoApp_Api (???)
2. UPS Connect (???)
3. productSyncBackend (Sarit Das) `Product-Sync`
4. product-create-and-update (Leif Coleman)
5. BC-Transaction-Sync (Leif Coleman)
6. BC-Transaction-Sync-2 (Leif Coleman)

Each API account has four different credentials associated with it:
* Store Hash (this will always be the same across all API accounts)
* Client ID
* Client Secret
* Access Token

All of these have slightly different scopes which should be appropiate for whatever job they are used in performing.

TODO for Leif: Investigate `BC-Transaction-Sync` and `BC-Transaction-Sync-2` and only use one API account.

TODO: Figure out who has the keys `ankoApp_Api` and `UPS Connect`

# Development

## SQL Database Information

The same as [SQL Database Information for Production](#SQL-Database-Information), but the URL, username, and password are different.

## BigCommerce API Accounts

The same as [BigCommerce API Accounts for Production](#BigCommerce-API-Accounts), but there is only one API account used for the developer store:
1. anko-dev-api (Leif Coleman)

This single API account has all scopes to do everything. This is acceptable for the development environment, but you should ensure that an API account with proper scopes are being used once you move from development to production.

---

[Click here](../README.md) to return to the index.
