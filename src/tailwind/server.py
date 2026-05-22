"""WSGI entrypoint for production servers (e.g., gunicorn)."""

from __future__ import annotations

from tailwind.app import create_app
from tailwind.config import settings
from tailwind.logging import configure_logging

configure_logging(settings.log_level)

app = create_app()
server = app.server
