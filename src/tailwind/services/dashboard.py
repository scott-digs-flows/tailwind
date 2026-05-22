"""Dashboard-page service functions. Pages stay thin; orchestration lives here."""

from __future__ import annotations

import pandas as pd

from tailwind.data import Query, get_warehouse


def load_example_timeseries(granularity: str = "day") -> pd.DataFrame:
    warehouse = get_warehouse()
    sql = "SELECT period, value FROM example_metric ORDER BY period"
    result = warehouse.execute(Query(sql=sql))
    df = result.df.copy()
    if granularity == "week":
        df = df.set_index("period").resample("W").sum().reset_index()
    elif granularity == "month":
        df = df.set_index("period").resample("ME").sum().reset_index()
    return df
