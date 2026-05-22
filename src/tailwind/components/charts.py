"""Plotly chart factory helpers with consistent theming."""

from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from tailwind.components.tokens import Color, Font

_LAYOUT_DEFAULTS: dict[str, Any] = {
    "font": {"family": Font.FAMILY, "color": Color.NEUTRAL_900},
    "plot_bgcolor": Color.SURFACE,
    "paper_bgcolor": Color.SURFACE,
    "margin": {"l": 40, "r": 16, "t": 32, "b": 40},
    "colorway": [Color.PRIMARY, Color.SUCCESS, Color.WARNING, Color.DANGER, Color.NEUTRAL_500],
    "xaxis": {"gridcolor": Color.NEUTRAL_100, "zeroline": False},
    "yaxis": {"gridcolor": Color.NEUTRAL_100, "zeroline": False},
}


def line(df: pd.DataFrame, x: str, y: str, **kwargs: Any) -> go.Figure:
    fig = px.line(df, x=x, y=y, **kwargs)
    fig.update_layout(**_LAYOUT_DEFAULTS)
    return fig


def bar(df: pd.DataFrame, x: str, y: str, **kwargs: Any) -> go.Figure:
    fig = px.bar(df, x=x, y=y, **kwargs)
    fig.update_layout(**_LAYOUT_DEFAULTS)
    return fig


def empty_state(message: str) -> go.Figure:
    fig = go.Figure()
    fig.add_annotation(
        text=message,
        xref="paper",
        yref="paper",
        x=0.5,
        y=0.5,
        showarrow=False,
        font={"size": 14, "color": Color.NEUTRAL_500},
    )
    fig.update_layout(**_LAYOUT_DEFAULTS, xaxis_visible=False, yaxis_visible=False)
    return fig
