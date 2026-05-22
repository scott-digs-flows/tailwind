"""Warehouse factory — returns a client based on settings.warehouse_type."""

from __future__ import annotations

from functools import lru_cache

from tailwind.config import settings
from tailwind.data.base import WarehouseClient


@lru_cache(maxsize=1)
def get_warehouse() -> WarehouseClient:
    match settings.warehouse_type:
        case "stub":
            from tailwind.data.stub import StubWarehouse

            return StubWarehouse()
        case "snowflake":
            from tailwind.data.snowflake import SnowflakeWarehouse

            return SnowflakeWarehouse(dsn=_dsn())
        case "bigquery":
            from tailwind.data.bigquery import BigQueryWarehouse

            return BigQueryWarehouse(dsn=_dsn())
        case "postgres":
            from tailwind.data.postgres import PostgresWarehouse

            return PostgresWarehouse(dsn=_dsn())


def _dsn() -> str:
    if settings.warehouse_dsn is None:
        raise RuntimeError(
            f"TAILWIND_WAREHOUSE_DSN must be set for warehouse_type={settings.warehouse_type!r}"
        )
    return settings.warehouse_dsn.get_secret_value()
