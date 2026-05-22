"""Example dashboard page demonstrating the page/component pattern."""

from __future__ import annotations

import dash
import dash_mantine_components as dmc
from dash import Input, Output, callback, dcc

from tailwind.components import charts
from tailwind.services.dashboard import load_example_timeseries

dash.register_page(
    __name__,
    path="/dashboards/example",
    name="Example dashboard",
    icon="tabler:chart-line",
    title="tailwind — Example dashboard",
)


def layout() -> dmc.Stack:
    return dmc.Stack(
        gap="md",
        children=[
            dmc.Title("Example dashboard", order=2),
            dmc.Text(
                "A minimal example to demonstrate the page/component/service pattern.",
                c="dimmed",
            ),
            dmc.SegmentedControl(
                id="example-granularity",
                value="day",
                data=[
                    {"value": "day", "label": "Daily"},
                    {"value": "week", "label": "Weekly"},
                    {"value": "month", "label": "Monthly"},
                ],
            ),
            dmc.Card(
                withBorder=True,
                radius="md",
                padding="md",
                children=dcc.Graph(id="example-timeseries", config={"displaylogo": False}),
            ),
        ],
    )


@callback(
    Output("example-timeseries", "figure"),
    Input("example-granularity", "value"),
)
def _update_timeseries(granularity: str) -> object:
    df = load_example_timeseries(granularity=granularity)
    if df.empty:
        return charts.empty_state("No data available")
    return charts.line(df, x="period", y="value", title="Example metric over time")
