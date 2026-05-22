# Development guide

## Prerequisites

- Python 3.12
- [uv](https://docs.astral.sh/uv/) (recommended) or pip
- An Anthropic API key for AI features (optional for non-AI work)

## Setup

```bash
git clone <repo>
cd tailwind
uv sync --all-extras
cp .env.example .env  # then fill in keys you need
uv run pre-commit install
```

## Run

```bash
make dev        # development server with hot reload (port 8050)
make run        # gunicorn production server
make test       # pytest
make check      # lint + typecheck + test
make format     # auto-fix lint and format
```

## Layout

See [architecture.md](architecture.md).

## Daily workflow

1. Pull main; run `uv sync --all-extras` if `pyproject.toml` changed.
2. Branch off main with a descriptive name (`feat/`, `fix/`, `refactor/`).
3. Run `make dev` and iterate.
4. Before pushing, run `make check`.
5. Open a PR using the template in `.github/pull_request_template.md`.

## Working with the stub warehouse

The default warehouse is `stub` — an in-memory generator that returns deterministic mock data. Use it for UI work, tests, and local development without warehouse credentials.

To point at a real warehouse, set `TAILWIND_WAREHOUSE_TYPE=snowflake|bigquery|postgres` and `TAILWIND_WAREHOUSE_DSN=...` in `.env`, and install the matching extra (`uv sync --extra snowflake`).

## Debugging tips

- All logs are JSON on stdout. Pipe to `jq` for human-readable output: `make dev | jq .`
- Dash's hot reload restarts the app on file changes; AI prompt-cache warm-ups will be lost across restarts. This is expected.
- The Anthropic SDK's `_request_id` is logged on every AI call — include it when reporting issues.
