"""Snowflake warehouse adapter. Install with the `snowflake` extra."""

from __future__ import annotations

import pandas as pd

from tailwind.data.base import Query, QueryResult


class SnowflakeWarehouse:
    name = "snowflake"

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._conn: object | None = None

    def _connect(self) -> object:
        if self._conn is None:
            try:
                import snowflake.connector  # type: ignore[import-not-found]
            except ImportError as exc:
                raise RuntimeError(
                    "snowflake-connector-python not installed. Install with: uv sync --extra snowflake"
                ) from exc
            self._conn = snowflake.connector.connect(connection_string=self._dsn)
        return self._conn

    def execute(self, query: Query) -> QueryResult:
        raise NotImplementedError("Implement when Snowflake is selected as a target.")

    def list_tables(self, schema: str | None = None) -> list[str]:
        raise NotImplementedError

    def describe_table(self, table: str) -> pd.DataFrame:
        raise NotImplementedError

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()  # type: ignore[attr-defined]
            self._conn = None
