"""Abstract warehouse client interface."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import pandas as pd


@dataclass(frozen=True)
class Query:
    sql: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QueryResult:
    df: pd.DataFrame
    row_count: int
    elapsed_ms: float


@runtime_checkable
class WarehouseClient(Protocol):
    """Protocol every warehouse adapter must implement."""

    name: str

    def execute(self, query: Query) -> QueryResult: ...

    def list_tables(self, schema: str | None = None) -> list[str]: ...

    def describe_table(self, table: str) -> pd.DataFrame: ...

    def close(self) -> None: ...
