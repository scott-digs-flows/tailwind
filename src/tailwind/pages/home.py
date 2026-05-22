"""Home page: landing overview and links to dashboards."""

from __future__ import annotations

import dash
import dash_mantine_components as dmc
from dash_iconify import DashIconify

dash.register_page(
    __name__,
    path="/",
    name="Home",
    icon="tabler:home",
    title="tailwind — Home",
)


def layout() -> dmc.Stack:
    return dmc.Stack(
        gap="lg",
        children=[
            dmc.Title("Welcome to tailwind", order=1),
            dmc.Text(
                "Internal analytics dashboards with built-in AI assistance.",
                size="lg",
                c="dimmed",
            ),
            dmc.SimpleGrid(
                cols={"base": 1, "sm": 2, "md": 3},
                spacing="md",
                children=[
                    _feature_card(
                        "tabler:chart-dots",
                        "Explore dashboards",
                        "Browse analytics for revenue, growth, operations, and more.",
                    ),
                    _feature_card(
                        "tabler:message-chatbot",
                        "Ask the data",
                        "Get plain-language answers backed by the warehouse.",
                    ),
                    _feature_card(
                        "tabler:bulb",
                        "Submit an idea",
                        "Sketch a new dashboard and send it to the analytics team.",
                    ),
                ],
            ),
        ],
    )


def _feature_card(icon: str, title: str, description: str) -> dmc.Card:
    return dmc.Card(
        withBorder=True,
        radius="md",
        padding="lg",
        children=dmc.Stack(
            gap="sm",
            children=[
                DashIconify(icon=icon, width=28),
                dmc.Title(title, order=4),
                dmc.Text(description, size="sm", c="dimmed"),
            ],
        ),
    )
