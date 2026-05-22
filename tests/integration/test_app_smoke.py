from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


def test_app_factory_builds_a_dash_instance() -> None:
    from dash import Dash

    from tailwind.app import create_app

    app = create_app()
    assert isinstance(app, Dash)


def test_healthcheck_endpoint() -> None:
    from tailwind.app import create_app

    app = create_app()
    client = app.server.test_client()
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.data == b"ok"
