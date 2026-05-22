from __future__ import annotations

from tailwind.config import Settings


def test_defaults_load() -> None:
    s = Settings()
    assert s.warehouse_type in ("stub", "snowflake", "bigquery", "postgres")
    assert s.port == 8050


def test_warehouse_type_override(monkeypatch) -> None:
    monkeypatch.setenv("TAILWIND_WAREHOUSE_TYPE", "snowflake")
    s = Settings()
    assert s.warehouse_type == "snowflake"
