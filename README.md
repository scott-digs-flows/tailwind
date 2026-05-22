# tailwind

**Codename:** tailwind
**Status:** scaffolded — runnable in dev mode with the stub warehouse

A production-grade data analytics and visualization web app, built with [Plotly Dash](https://dash.plotly.com/) and Python, designed to serve several hundred users inside a company. Beyond traditional dashboards, tailwind embeds AI assistance (Claude) directly into the analytics experience so users can interrogate data, prototype new visuals, and route ideas back to the analytics team.

## Goals

1. **Production-grade Dash app** — reliable, observable, and able to scale to several hundred concurrent internal users.
2. **Friendly to human developers** — clear module boundaries, conventional Python tooling, low onboarding cost.
3. **Friendly to AI coding tools** — codebase organized so AI assistants can navigate, extend, and refactor with minimal hand-holding (predictable structure, typed interfaces, small focused files).
4. **AI-native analytics features** — the app itself exposes AI capabilities to end users, not just to the developers building it.

## AI-powered user features

- **Explain this dashboard** — plain-language summary of charts, trends, and anomalies.
- **Ask the data** — natural-language Q&A grounded in the warehouse schema.
- **Mock up a visual** — describe a chart, get a structured spec back.
- **Submit a dashboard idea** — opens a GitHub issue against the analytics team's repo.

## Quick start

```bash
# 1. Install uv (https://docs.astral.sh/uv/) if needed
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Install dependencies
uv sync --all-extras

# 3. Configure environment
cp .env.example .env  # fill in ANTHROPIC_API_KEY etc. as needed

# 4. Run the dev server
make dev
```

App at <http://localhost:8050>. With no warehouse configured it uses the in-memory stub.

## Repository layout

```
tailwind/
  src/tailwind/
    app.py              # Dash app factory
    server.py           # WSGI entrypoint (gunicorn)
    config.py           # Pydantic settings
    logging.py          # structlog setup
    pages/              # One Dash page per module
    components/         # Reusable UI + design tokens
    services/           # Orchestration between pages and data/ai
    data/               # Warehouse-agnostic data layer
    ai/                 # Anthropic integrations
    assets/             # Auto-loaded CSS
  tests/
    unit/               # Fast tests, no external services
    integration/        # Marked @pytest.mark.integration
  docs/
    architecture.md
    ai-integration.md
    development.md
  .github/              # CI workflow, issue/PR templates
  Dockerfile
  docker-compose.yml
  pyproject.toml
```

## Architecture in one diagram

```
pages  ->  services  ->  data + ai
   \         |
    `---->  components (UI + tokens)
```

See [docs/architecture.md](docs/architecture.md) for the rules: pages stay thin, services orchestrate, data/ai own side effects.

## Configuration

All config is environment-driven. See `.env.example`. Key variables:

| Variable | Purpose |
|---|---|
| `TAILWIND_ENV` | `dev`, `staging`, `prod`, `test` |
| `TAILWIND_WAREHOUSE_TYPE` | `stub` (default), `snowflake`, `bigquery`, `postgres` |
| `TAILWIND_WAREHOUSE_DSN` | Connection string for non-stub warehouses |
| `ANTHROPIC_API_KEY` | Required for AI features |
| `TAILWIND_AI_MODEL` | Defaults to `claude-opus-4-7` |
| `TAILWIND_GITHUB_TOKEN`, `TAILWIND_GITHUB_REPO` | Required to submit dashboard ideas |

## Tooling

- Format/lint: `ruff` — `make format`
- Type check: `mypy` (strict) — `make typecheck`
- Tests: `pytest` with coverage — `make test`
- All three: `make check`
- Pre-commit hooks: `uv run pre-commit install`

## Deployment

The Dockerfile produces a minimal image that runs `gunicorn tailwind.server:server`. Deployment target is undecided — see the **Open questions** section. The app exposes `/healthz` for liveness probes.

## Open questions

- Which data warehouse will be the primary target (Snowflake / BigQuery / Redshift / Postgres)?
- Which deployment platform (Kubernetes / managed PaaS / on-prem)?
- AuthN/AuthZ approach (SSO, role-based access).
- Whether to layer in Anthropic's MCP servers later (for richer agentic flows).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/development.md](docs/development.md).

## License

Proprietary — internal company use.
