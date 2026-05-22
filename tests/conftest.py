"""Shared pytest fixtures."""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _stub_warehouse_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAILWIND_WAREHOUSE_TYPE", "stub")
    monkeypatch.setenv("TAILWIND_AI_ENABLED", "false")
    monkeypatch.setenv("TAILWIND_SECRET_KEY", "test-secret")
    yield


@pytest.fixture
def settings():
    from tailwind.config import get_settings

    get_settings.cache_clear()
    return get_settings()
