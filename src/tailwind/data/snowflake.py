"""Snowflake warehouse adapter. Install with the `snowflake` extra."""

from __future__ import annotations

from urllib.parse import parse_qs, unquote, urlparse

import pandas as pd

from tailwind.data.base import Query, QueryResult


def _parse_dsn(dsn: str) -> dict[str, str]:
    """Parse snowflake://user:password@account/database/schema?warehouse=W&role=R."""
    parsed = urlparse(dsn)
    if parsed.scheme != "snowflake":
        raise ValueError(f"Snowflake DSN must use snowflake:// scheme, got {parsed.scheme!r}")
    if not parsed.hostname:
        raise ValueError("Snowflake DSN must include an account host")
    if not parsed.username:
        raise ValueError("Snowflake DSN must include a user")

    params: dict[str, str] = {
        "account": parsed.hostname,
        "user": unquote(parsed.username),
    }
    if parsed.password:
        params["password"] = unquote(parsed.password)

    path_parts = [p for p in parsed.path.split("/") if p]
    if len(path_parts) >= 1:
        params["database"] = path_parts[0]
    if len(path_parts) >= 2:
        params["schema"] = path_parts[1]

    for key, values in parse_qs(parsed.query).items():
        if values:
            params[key] = values[0]

    return params


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
            self._conn = snowflake.connector.connect(**_parse_dsn(self._dsn))
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
