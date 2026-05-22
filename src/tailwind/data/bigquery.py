"""BigQuery warehouse adapter. Install with the `bigquery` extra."""

from __future__ import annotations

import pandas as pd

from tailwind.data.base import Query, QueryResult


class BigQueryWarehouse:
    name = "bigquery"

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def execute(self, query: Query) -> QueryResult:
        raise NotImplementedError("Implement when BigQuery is selected as a target.")

    def list_tables(self, schema: str | None = None) -> list[str]:
        raise NotImplementedError

    def describe_table(self, table: str) -> pd.DataFrame:
        raise NotImplementedError

    def close(self) -> None:
        return None
