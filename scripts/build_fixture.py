"""Extract a referentially consistent conformance fixture (see refresh-fixture.sh)."""
import os, subprocess, pathlib

BT = chr(96)
SRC = 'dwl-clickhouse'          # the data-warehouse-local container
OUT = pathlib.Path('infra/fixture')
ORDERS = 400

def ch(q):
    r = subprocess.run(['docker', 'exec', SRC, 'clickhouse-client', '--password',
                        os.environ.get('CLICKHOUSE_PASSWORD', 'clickhouse'), '--query', q],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'ClickHouse error: {r.stderr[:300]}')
    return r.stdout

def tbl(n): return f'raw.{n}'

# Whole ORDERS, then every line belonging to them, then only the products and
# territories those lines reference. Sampling lines independently would destroy the
# header/detail and chasm structure the suite exists to test.
orders = ch(f'SELECT DISTINCT sales_order_number FROM {tbl("fact_reseller_sales")} '
            f'ORDER BY sales_order_number LIMIT {ORDERS} FORMAT TSV').split()
inlist = ','.join(f"'{o}'" for o in orders)

def dump(name, query):
    data = ch(query + ' FORMAT CSVWithNames')
    (OUT / f'{name}.csv').write_text(data)
    return data.count('\n') - 1

counts = {
  'fact_reseller_sales': dump('fact_reseller_sales',
      f'SELECT * FROM {tbl("fact_reseller_sales")} WHERE sales_order_number IN ({inlist})'),
  'fact_internet_sales': dump('fact_internet_sales',
      f'SELECT * FROM {tbl("fact_internet_sales")} WHERE product_key IN ('
      f' SELECT DISTINCT product_key FROM {tbl("fact_reseller_sales")} '
      f' WHERE sales_order_number IN ({inlist})) LIMIT 3000'),
  'dim_product': dump('dim_product', f'SELECT * FROM {tbl("dim_product")}'),
  'dim_sales_territory': dump('dim_sales_territory', f'SELECT * FROM {tbl("dim_sales_territory")}'),
}

# DDL generated from the REAL schemas: a fixture whose types differ from production
# tests a different engine behaviour.
order_by = {'fact_reseller_sales': 'sales_order_number', 'fact_internet_sales': 'sales_order_number',
            'dim_product': 'product_key', 'dim_sales_territory': 'sales_territory_key'}
ddl = ["-- Generated from the live AdventureWorks schemas: see scripts/refresh-fixture.sh.",
       "-- Table names carry the flattened Iceberg namespace ('raw.x') so the SAME reviewed",
       "-- model runs here and against the real catalog, byte for byte (ADR-003 D2).",
       "CREATE DATABASE IF NOT EXISTS datalake;", ""]
for t, ob in order_by.items():
    cols = [l.split('\t')[:2] for l in ch(f'DESCRIBE TABLE {tbl(t)}').strip().splitlines()]
    body = ',\n  '.join(f'{BT}{n}{BT} {ty}' for n, ty in cols)
    # Nullable sort keys are inherited from the source; MergeTree needs to be told.
    ddl.append(f'CREATE TABLE IF NOT EXISTS {tbl(t)} (\n  {body}\n) ENGINE = MergeTree '
               f'ORDER BY {BT}{ob}{BT}\nSETTINGS allow_nullable_key = 1;\n')
(OUT / 'schema.sql').write_text('\n'.join(ddl))
print('fixture rows:', ', '.join(f'{k}={v}' for k, v in counts.items()))
