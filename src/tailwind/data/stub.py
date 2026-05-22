"""In-memory stub warehouse for local dev and tests."""

from __future__ import annotations

import time

import numpy as np
import pandas as pd

from tailwind.data.base import Query, QueryResult


class StubWarehouse:
    name = "stub"

    def execute(self, query: Query) -> QueryResult:
        start = time.perf_counter()
        rng = np.random.default_rng(seed=42)
        df = pd.DataFrame(
            {
                "period": pd.date_range("2025-01-01", periods=30, freq="D"),
                "value": rng.integers(80, 120, size=30),
            }
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
        return QueryResult(df=df, row_count=len(df), elapsed_ms=elapsed_ms)

    def list_tables(self, schema: str | None = None) -> list[str]:
        return ["example_metric"]

    def describe_table(self, table: str) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "column": ["period", "value"],
                "type": ["timestamp", "integer"],
            }
        )

    def close(self) -> None:
        return None
