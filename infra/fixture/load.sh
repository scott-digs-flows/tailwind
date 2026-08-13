#!/bin/bash
# ClickHouse initdb.d runs *.sql then *.sh. The fixture CSVs are mounted read-only.
set -e
for t in dim_product dim_sales_territory fact_reseller_sales fact_internet_sales; do
  clickhouse-client --query "INSERT INTO datalake.\`raw.${t}\` FORMAT CSVWithNames" < "/fixture/${t}.csv"
done
echo "conformance fixture loaded"
