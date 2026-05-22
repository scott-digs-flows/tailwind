"""Postgres / Redshift warehouse adapter. Install with the `postgres` extra."""

from __future__ import annotations

import pandas as pd

from tailwind.data.base import Query, QueryResult


class PostgresWarehouse:
    name = "postgres"

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def execute(self, query: Query) -> QueryResult:
        raise NotImplementedError("Implement when Postgres/Redshift is selected as a target.")

    def list_tables(self, schema: str | None = None) -> list[str]:
        raise NotImplementedError

    def describe_table(self, table: str) -> pd.DataFrame:
        raise NotImplementedError

    def close(self) -> None:
        return None
