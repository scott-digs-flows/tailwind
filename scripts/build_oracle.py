"""Compute conformance expectations directly from the fixture (see refresh-oracle.sh)."""
import json, subprocess, pathlib

BT = chr(96)
CONTAINER = 'tailwind-conformance-clickhouse-1'
def tbl(n): return f'datalake.{BT}raw.{n}{BT}'
R, I, P, T = (tbl('fact_reseller_sales'), tbl('fact_internet_sales'),
              tbl('dim_product'), tbl('dim_sales_territory'))
HDR = f'(SELECT sales_order_number, sum(freight) AS order_freight FROM {R} GROUP BY sales_order_number)'

def ch(q):
    r = subprocess.run(['docker', 'exec', CONTAINER, 'clickhouse-client', '--query', q + ' FORMAT TSV'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'ClickHouse error: {r.stderr[:300]}')
    return r.stdout.strip()

r2 = lambda s: round(float(s), 2)
def grouped(q):
    out = {}
    for line in ch(q).splitlines():
        if not line:
            continue
        k, _, v = line.rpartition('\t')
        out[k] = r2(v)
    return out

o = {
  'total_reseller_sales': r2(ch(f'SELECT sum(sales_amount) FROM {R}')),
  'total_internet_sales': r2(ch(f'SELECT sum(sales_amount) FROM {I}')),
  'reseller_line_count': int(ch(f'SELECT count() FROM {R}')),
  'internet_line_count': int(ch(f'SELECT count() FROM {I}')),
  'product_count': int(ch(f'SELECT count() FROM {P}')),
  'territory_count': int(ch(f'SELECT count() FROM {T}')),
  'total_product_standard_cost': r2(ch(f'SELECT sum(standard_cost) FROM {P}')),
  'order_count': int(ch(f'SELECT count(DISTINCT sales_order_number) FROM {R}')),
  'total_order_freight': r2(ch(f'SELECT sum(order_freight) FROM {HDR}')),
}
o['reseller_sales_by_product_line'] = grouped(
  f"SELECT ifNull(p.product_line,''), sum(f.sales_amount) FROM {R} f "
  f"INNER JOIN {P} p ON f.product_key = p.product_key GROUP BY 1 ORDER BY 1")
o['standard_cost_by_product_line_dedup'] = grouped(
  f"SELECT ifNull(product_line,''), sum(standard_cost) FROM {P} GROUP BY 1 ORDER BY 1")
o['reseller_sales_by_country'] = grouped(
  f"SELECT t.sales_territory_country, sum(f.sales_amount) FROM {R} f "
  f"INNER JOIN {T} t ON f.sales_territory_key = t.sales_territory_key GROUP BY 1 ORDER BY 1")
# Each ORDER counted once per product line it touches -- the deduplicated truth.
o['order_freight_by_product_line_dedup'] = grouped(
  f"SELECT product_line, sum(order_freight) FROM ("
  f"  SELECT DISTINCT f.sales_order_number, ifNull(p.product_line,'') AS product_line "
  f"  FROM {R} f INNER JOIN {P} p ON f.product_key = p.product_key) d "
  f"INNER JOIN {HDR} h ON d.sales_order_number = h.sales_order_number GROUP BY 1 ORDER BY 1")
# The WRONG answers, kept so the negative control's output is recognisable.
o['order_freight_IF_FANNED_OUT'] = r2(ch(
  f'SELECT sum(h.order_freight) FROM {R} f INNER JOIN {HDR} h ON f.sales_order_number = h.sales_order_number'))
o['standard_cost_IF_FANNED_OUT'] = r2(ch(
  f'SELECT sum(p.standard_cost) FROM {R} f INNER JOIN {P} p ON f.product_key = p.product_key'))

pathlib.Path('packages/semantic/test/oracle.json').write_text(json.dumps(o, indent=2) + '\n')
print(f"oracle rebuilt from the fixture: {o['order_count']} orders, "
      f"{o['reseller_line_count']} lines, freight {o['total_order_freight']} "
      f"(fanned out: {o['order_freight_IF_FANNED_OUT']})")
