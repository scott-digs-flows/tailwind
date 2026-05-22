# Contributing to tailwind

This guide walks new contributors (human or AI) through the conventions and tooling.

## Quick start

```bash
# 1. Install uv (https://docs.astral.sh/uv/) if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Install dependencies (including dev tools and all warehouse extras)
uv sync --all-extras

# 3. Set up pre-commit hooks
uv run pre-commit install

# 4. Copy and edit environment config
cp .env.example .env

# 5. Run the dev server
make dev
```

The app is then available at <http://localhost:8050>.

## Project layout

See [docs/architecture.md](docs/architecture.md) for the full breakdown. In short:

- `src/tailwind/app.py` builds the Dash app; `src/tailwind/server.py` is the WSGI entrypoint.
- `src/tailwind/pages/` — one module per dashboard page, registered via `dash.register_page`.
- `src/tailwind/components/` — reusable Dash components and design tokens.
- `src/tailwind/data/` — warehouse-agnostic data access layer.
- `src/tailwind/ai/` — AI integrations (explain, NL query, mockup, submit).
- `src/tailwind/services/` — orchestration between pages and data/ai layers.

## Conventions

### Style and formatting

- **Formatting & linting:** [ruff](https://docs.astral.sh/ruff/). Run `make format` before committing.
- **Type checking:** [mypy](https://mypy.readthedocs.io/) in strict mode. Run `make typecheck`.
- **Tests:** [pytest](https://docs.pytest.org/). Run `make test`.
- **All three at once:** `make check`.

### Code

- Type-annotate every public function and class.
- Keep modules small and focused — one concept per file.
- Prefer pure functions in `services/` and side effects (DB, HTTP, AI) confined to `data/` and `ai/`.
- Use `structlog` for logging — never `print`.
- Never hard-code warehouse credentials, model IDs, or environment-specific values. Use `tailwind.config.settings`.

### Dash specifics

- Register pages with `dash.register_page(__name__, ...)`.
- Co-locate a page's layout and callbacks in its page module.
- Extract reusable UI into `components/`; never duplicate layout snippets across pages.
- Use design tokens (`components.tokens`) for colors and spacing — no inline hex codes.

### Commits and PRs

- Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- One logical change per PR. Keep diffs reviewable.
- Every PR must pass CI (`make check`) before merge.

## AI-assisted development

This codebase is designed to be friendly to AI coding tools. When working with AI assistants:

- Point them at [docs/architecture.md](docs/architecture.md) first.
- Ask them to follow the layering rules above.
- Treat AI-generated code with the same review rigor as human-authored code.

## Tests

- Unit tests live in `tests/unit/` and must not touch external services.
- Integration tests live in `tests/integration/` and are marked with `@pytest.mark.integration`.
- Use `pytest-mock` for mocking; do not import `unittest.mock` directly.

## Reporting issues

Open an issue on GitHub using one of the templates in `.github/ISSUE_TEMPLATE/`.
