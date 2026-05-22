"""AI assistant side panel: explain, ask, mockup, submit."""

from __future__ import annotations

import dash_mantine_components as dmc
from dash import dcc, html
from dash_iconify import DashIconify


def ai_panel() -> dmc.Stack:
    return dmc.Stack(
        gap="md",
        children=[
            dmc.Group(
                [
                    DashIconify(icon="tabler:sparkles", width=20),
                    dmc.Title("AI Assistant", order=4),
                ],
                gap="xs",
            ),
            dmc.Tabs(
                value="explain",
                children=[
                    dmc.TabsList(
                        [
                            dmc.TabsTab("Explain", value="explain"),
                            dmc.TabsTab("Ask", value="ask"),
                            dmc.TabsTab("Mockup", value="mockup"),
                        ]
                    ),
                    dmc.TabsPanel(_explain_tab(), value="explain", pt="md"),
                    dmc.TabsPanel(_ask_tab(), value="ask", pt="md"),
                    dmc.TabsPanel(_mockup_tab(), value="mockup", pt="md"),
                ],
            ),
        ],
    )


def _explain_tab() -> dmc.Stack:
    return dmc.Stack(
        [
            dmc.Text(
                "Get a plain-language summary of the current dashboard, its trends, and any anomalies.",
                size="sm",
                c="dimmed",
            ),
            dmc.Button(
                "Explain this dashboard",
                id="ai-explain-btn",
                leftSection=DashIconify(icon="tabler:wand"),
                fullWidth=True,
            ),
            dcc.Loading(html.Div(id="ai-explain-output"), type="dot"),
        ],
        gap="sm",
    )


def _ask_tab() -> dmc.Stack:
    return dmc.Stack(
        [
            dmc.Textarea(
                id="ai-ask-input",
                placeholder="Ask a question about this data — e.g., \"How does Q1 revenue compare to last year by region?\"",
                autosize=True,
                minRows=3,
            ),
            dmc.Button(
                "Ask",
                id="ai-ask-btn",
                leftSection=DashIconify(icon="tabler:send"),
                fullWidth=True,
            ),
            dcc.Loading(html.Div(id="ai-ask-output"), type="dot"),
        ],
        gap="sm",
    )


def _mockup_tab() -> dmc.Stack:
    return dmc.Stack(
        [
            dmc.Textarea(
                id="ai-mockup-input",
                placeholder="Describe a chart you want — e.g., \"Add a YoY comparison broken out by region.\"",
                autosize=True,
                minRows=3,
            ),
            dmc.Group(
                [
                    dmc.Button(
                        "Generate mockup",
                        id="ai-mockup-btn",
                        leftSection=DashIconify(icon="tabler:layout-grid"),
                    ),
                    dmc.Button(
                        "Submit to analytics team",
                        id="ai-submit-btn",
                        variant="light",
                        leftSection=DashIconify(icon="tabler:send"),
                    ),
                ],
                gap="xs",
            ),
            dcc.Loading(html.Div(id="ai-mockup-output"), type="dot"),
        ],
        gap="sm",
    )
