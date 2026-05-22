# Architecture

This document explains how tailwind is organized so both human and AI contributors can navigate the code with confidence.

## Layering

```
+--------------------------------------------------------------+
|  pages/         (Dash layouts + callbacks per dashboard)     |
+--------------------------------------------------------------+
|  components/    (reusable UI: layout, charts, ai_panel, ...) |
+--------------------------------------------------------------+
|  services/      (orchestration: combine data + AI for pages) |
+--------------------------------------------------------------+
|  data/   |  ai/                                              |
|  (warehouse adapters)  |  (Anthropic client, prompts, GH)   |
+--------------------------------------------------------------+
|  config/         (env-driven settings, logging)              |
+--------------------------------------------------------------+
```

Rules:

- **Pages don't talk to `data/` or `ai/` directly.** They call `services/`. This keeps callbacks short and easy to test.
- **`services/` is pure-Python.** It can be unit-tested without spinning up Dash.
- **`data/` and `ai/` own their side effects.** Network calls, SQL, and Anthropic API calls live there and nowhere else.
- **`components/` knows nothing about data.** Charts take a DataFrame; they don't fetch one.

## Key modules

| Module | Responsibility |
|---|---|
| `tailwind.app` | Dash app factory. Wires the shell layout and registers the health check. |
| `tailwind.server` | WSGI entrypoint for gunicorn. |
| `tailwind.config` | Pydantic settings loaded from environment / `.env`. Singleton via `lru_cache`. |
| `tailwind.logging` | structlog setup (JSON to stdout). |
| `tailwind.components.layout` | App shell: header, sidebar, AI panel. |
| `tailwind.components.tokens` | Design tokens (colors, spacing, radius, typography). |
| `tailwind.components.charts` | Plotly chart factories with consistent theming. |
| `tailwind.data.base` | `WarehouseClient` protocol + `Query` / `QueryResult` dataclasses. |
| `tailwind.data.registry` | `get_warehouse()` factory; returns the configured adapter. |
| `tailwind.ai.client` | Anthropic client wrapper with prompt-cached system prompts. |
| `tailwind.ai.prompts` | All system prompts in one place. Edits hit prompt-cache invariants — keep stable. |

## Configuration

All runtime configuration is driven by environment variables prefixed with `TAILWIND_` (plus `ANTHROPIC_API_KEY` for the AI layer). See `.env.example`.

- Secrets are typed as `pydantic.SecretStr` — they never appear in logs by accident.
- `tailwind.config.settings` is a process-wide singleton; call `get_settings.cache_clear()` in tests when you need to reload.

## Adding a new dashboard page

1. Create `src/tailwind/pages/<name>.py`.
2. Call `dash.register_page(__name__, path=..., name=..., icon=..., title=...)` at module top.
3. Define a `layout()` callable returning a Dash component tree.
4. Define callbacks via `@callback(...)`. Keep them thin — push logic into `services/`.
5. If the page needs new data, add a function in `services/` that calls the warehouse and returns a DataFrame.

## Adding a new warehouse adapter

1. Create `src/tailwind/data/<warehouse>.py` exporting a class that satisfies the `WarehouseClient` protocol.
2. Add a literal to `WarehouseType` in `config.py`.
3. Add a `match` arm in `data/registry.py`.
4. Add a `[project.optional-dependencies]` entry in `pyproject.toml`.

## Adding a new AI feature

1. Add a system prompt to `src/tailwind/ai/prompts.py`. Keep it stable — prompt caching depends on byte-for-byte stability.
2. Add a thin function module in `src/tailwind/ai/<feature>.py` that calls `tailwind.ai.client.chat`.
3. Export it from `tailwind.ai.__init__`.
4. Wire it into a UI control in `components/ai_panel.py` and a callback in the appropriate page.

## Caching, observability, scale

- **Prompt caching** is set up automatically — system prompts use `cache_control: ephemeral`.
- **Structured logs** go to stdout as JSON; integrate with whatever log aggregator the deployment platform provides.
- **The Flask server** under Dash is WSGI-compatible — scale horizontally with gunicorn workers behind a load balancer.
