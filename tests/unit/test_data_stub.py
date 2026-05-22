from __future__ import annotations

from tailwind.data import Query
from tailwind.data.stub import StubWarehouse


def test_stub_executes_and_returns_dataframe() -> None:
    warehouse = StubWarehouse()
    result = warehouse.execute(Query(sql="select 1"))
    assert result.row_count == 30
    assert set(result.df.columns) == {"period", "value"}


def test_stub_lists_tables() -> None:
    warehouse = StubWarehouse()
    assert "example_metric" in warehouse.list_tables()
