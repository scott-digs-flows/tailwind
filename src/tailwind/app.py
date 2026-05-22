"""Dash app factory."""

from __future__ import annotations

import dash
import dash_mantine_components as dmc
from dash import Dash, html

from tailwind.components.layout import app_shell
from tailwind.config import settings


def create_app() -> Dash:
    app = Dash(
        __name__,
        use_pages=True,
        pages_folder="pages",
        suppress_callback_exceptions=True,
        title="tailwind — analytics",
        update_title=None,
        meta_tags=[
            {"name": "viewport", "content": "width=device-width, initial-scale=1"},
        ],
    )
    app.server.secret_key = settings.secret_key.get_secret_value()

    _register_health_check(app)

    app.layout = dmc.MantineProvider(
        theme={"primaryColor": "blue", "defaultRadius": "md"},
        children=app_shell(dash.page_container),
    )
    return app


def _register_health_check(app: Dash) -> None:
    @app.server.route("/healthz")
    def healthz() -> tuple[str, int]:  # pragma: no cover - thin wrapper
        return "ok", 200
