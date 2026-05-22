from __future__ import annotations

from tailwind.services.dashboard import load_example_timeseries


def test_daily_load_returns_30_rows() -> None:
    df = load_example_timeseries("day")
    assert len(df) == 30


def test_weekly_aggregates() -> None:
    df = load_example_timeseries("week")
    assert len(df) < 30
