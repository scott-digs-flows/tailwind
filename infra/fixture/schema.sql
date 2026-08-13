-- Generated from the live AdventureWorks schemas: see scripts/refresh-fixture.sh.
-- Table names carry the flattened Iceberg namespace ('raw.x') so the SAME reviewed
-- model runs here and against the real catalog, byte for byte (ADR-003 D2).
CREATE DATABASE IF NOT EXISTS datalake;

CREATE TABLE IF NOT EXISTS datalake.`raw.fact_reseller_sales` (
  `product_key` Nullable(Int32),
  `order_date_key` Nullable(Int32),
  `due_date_key` Nullable(Int32),
  `ship_date_key` Nullable(Int32),
  `reseller_key` Nullable(Int32),
  `employee_key` Nullable(Int32),
  `promotion_key` Nullable(Int32),
  `currency_key` Nullable(Int32),
  `sales_territory_key` Nullable(Int32),
  `sales_order_number` Nullable(String),
  `sales_order_line_number` Nullable(Int32),
  `revision_number` Nullable(Int32),
  `order_quantity` Nullable(Int32),
  `unit_price` Nullable(Decimal(19, 4)),
  `extended_amount` Nullable(Decimal(19, 4)),
  `unit_price_discount_pct` Nullable(Float64),
  `discount_amount` Nullable(Float64),
  `product_standard_cost` Nullable(Decimal(19, 4)),
  `total_product_cost` Nullable(Decimal(19, 4)),
  `sales_amount` Nullable(Decimal(19, 4)),
  `tax_amt` Nullable(Decimal(19, 4)),
  `freight` Nullable(Decimal(19, 4)),
  `carrier_tracking_number` Nullable(String),
  `customer_po_number` Nullable(String),
  `order_date` Nullable(DateTime64(6)),
  `due_date` Nullable(DateTime64(6)),
  `ship_date` Nullable(DateTime64(6))
) ENGINE = MergeTree ORDER BY `sales_order_number`
SETTINGS allow_nullable_key = 1;

CREATE TABLE IF NOT EXISTS datalake.`raw.fact_internet_sales` (
  `product_key` Nullable(Int32),
  `order_date_key` Nullable(Int32),
  `due_date_key` Nullable(Int32),
  `ship_date_key` Nullable(Int32),
  `customer_key` Nullable(Int32),
  `promotion_key` Nullable(Int32),
  `currency_key` Nullable(Int32),
  `sales_territory_key` Nullable(Int32),
  `sales_order_number` Nullable(String),
  `sales_order_line_number` Nullable(Int32),
  `revision_number` Nullable(Int32),
  `order_quantity` Nullable(Int32),
  `unit_price` Nullable(Decimal(19, 4)),
  `extended_amount` Nullable(Decimal(19, 4)),
  `unit_price_discount_pct` Nullable(Float64),
  `discount_amount` Nullable(Float64),
  `product_standard_cost` Nullable(Decimal(19, 4)),
  `total_product_cost` Nullable(Decimal(19, 4)),
  `sales_amount` Nullable(Decimal(19, 4)),
  `tax_amt` Nullable(Decimal(19, 4)),
  `freight` Nullable(Decimal(19, 4)),
  `carrier_tracking_number` Nullable(String),
  `customer_po_number` Nullable(String),
  `order_date` Nullable(DateTime64(6)),
  `due_date` Nullable(DateTime64(6)),
  `ship_date` Nullable(DateTime64(6))
) ENGINE = MergeTree ORDER BY `sales_order_number`
SETTINGS allow_nullable_key = 1;

CREATE TABLE IF NOT EXISTS datalake.`raw.dim_product` (
  `product_key` Nullable(Int32),
  `product_alternate_key` Nullable(String),
  `product_subcategory_key` Nullable(Int32),
  `weight_unit_measure_code` Nullable(String),
  `size_unit_measure_code` Nullable(String),
  `english_product_name` Nullable(String),
  `spanish_product_name` Nullable(String),
  `french_product_name` Nullable(String),
  `standard_cost` Nullable(Decimal(19, 4)),
  `finished_goods_flag` Nullable(Bool),
  `color` Nullable(String),
  `safety_stock_level` Nullable(Int32),
  `reorder_point` Nullable(Int32),
  `list_price` Nullable(Decimal(19, 4)),
  `size` Nullable(String),
  `size_range` Nullable(String),
  `weight` Nullable(Float64),
  `days_to_manufacture` Nullable(Int32),
  `product_line` Nullable(String),
  `dealer_price` Nullable(Decimal(19, 4)),
  `class` Nullable(String),
  `style` Nullable(String),
  `model_name` Nullable(String),
  `english_description` Nullable(String),
  `french_description` Nullable(String),
  `chinese_description` Nullable(String),
  `arabic_description` Nullable(String),
  `hebrew_description` Nullable(String),
  `thai_description` Nullable(String),
  `german_description` Nullable(String),
  `japanese_description` Nullable(String),
  `turkish_description` Nullable(String),
  `start_date` Nullable(DateTime64(6)),
  `end_date` Nullable(DateTime64(6)),
  `status` Nullable(String)
) ENGINE = MergeTree ORDER BY `product_key`
SETTINGS allow_nullable_key = 1;

CREATE TABLE IF NOT EXISTS datalake.`raw.dim_sales_territory` (
  `sales_territory_key` Nullable(Int32),
  `sales_territory_alternate_key` Nullable(Int32),
  `sales_territory_region` Nullable(String),
  `sales_territory_country` Nullable(String),
  `sales_territory_group` Nullable(String)
) ENGINE = MergeTree ORDER BY `sales_territory_key`
SETTINGS allow_nullable_key = 1;
