"""Top-level app shell: header, sidebar, content area, AI panel slot."""

from __future__ import annotations

import dash
import dash_mantine_components as dmc
from dash import html
from dash_iconify import DashIconify

from tailwind.components.ai_panel import ai_panel


def app_shell(page_container: html.Div) -> dmc.AppShell:
    return dmc.AppShell(
        header={"height": 60},
        navbar={"width": 240, "breakpoint": "sm"},
        aside={"width": 360, "breakpoint": "md"},
        padding="md",
        children=[
            dmc.AppShellHeader(children=_header()),
            dmc.AppShellNavbar(children=_navbar(), p="md"),
            dmc.AppShellMain(children=page_container),
            dmc.AppShellAside(children=ai_panel(), p="md"),
        ],
    )


def _header() -> dmc.Group:
    return dmc.Group(
        h="100%",
        px="md",
        justify="space-between",
        children=[
            dmc.Group(
                [
                    DashIconify(icon="tabler:wind", width=24),
                    dmc.Title("tailwind", order=3),
                ],
                gap="sm",
            ),
            dmc.Group(
                [
                    dmc.Anchor("Docs", href="/docs", size="sm"),
                    dmc.Button(
                        "Submit a dashboard idea",
                        id="open-submit-modal",
                        variant="light",
                        leftSection=DashIconify(icon="tabler:bulb"),
                    ),
                ],
                gap="md",
            ),
        ],
    )


def _navbar() -> dmc.Stack:
    nav_links = [
        _nav_link(page["name"], page["path"], page.get("icon", "tabler:chart-bar"))
        for page in dash.page_registry.values()
        if not page["path"].startswith("/_")
    ]
    return dmc.Stack(nav_links, gap="xs")


def _nav_link(label: str, href: str, icon: str) -> dmc.NavLink:
    return dmc.NavLink(
        label=label,
        href=href,
        leftSection=DashIconify(icon=icon, width=18),
        active="exact",
    )
