#!/bin/bash


# # importing db schema
# mysql -uroot -p$MYSQL_ROOT_PASSWORD ankowhm < /import/dbSchema/schema/ankowhm.sql


# # importing db functions/procedures
# for sql_file in `ls /import/dbSchema/functions/*.sql`; do mysql -uroot -p$MYSQL_ROOT_PASSWORD ankowhm < $sql_file; done
mysql -uroot -p$MYSQL_ROOT_PASSWORD -e "SET GLOBAL LOG_BIN_TRUST_FUNCTION_CREATORS = 1;"

for sql_file in `ls /dbSchema/*.sql`; do mysql -uroot -p$MYSQL_ROOT_PASSWORD --init-command="SET FOREIGN_KEY_CHECKS=0;" ankowhm < $sql_file; done

# initialising seed data for db
mysql -uroot -p$MYSQL_ROOT_PASSWORD ankowhm < /import/init.sql
