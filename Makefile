.PHONY: help install dev run lint format typecheck test test-cov check clean docker-build docker-run

help:
	@echo "tailwind — common tasks"
	@echo ""
	@echo "  make install     Install runtime + dev dependencies via uv"
	@echo "  make dev         Run the Dash app in development mode (hot reload)"
	@echo "  make run         Run the Dash app via gunicorn (production)"
	@echo "  make lint        Run ruff lint checks"
	@echo "  make format      Auto-format with ruff"
	@echo "  make typecheck   Run mypy"
	@echo "  make test        Run pytest"
	@echo "  make test-cov    Run pytest with coverage report"
	@echo "  make check       Lint + typecheck + test"
	@echo "  make clean       Remove caches and build artifacts"
	@echo "  make docker-build  Build the production Docker image"
	@echo "  make docker-run    Run the app in Docker"

install:
	uv sync --all-extras

dev:
	uv run python -m tailwind

run:
	uv run gunicorn tailwind.server:server --workers 4 --bind 0.0.0.0:8050

lint:
	uv run ruff check src tests

format:
	uv run ruff format src tests
	uv run ruff check --fix src tests

typecheck:
	uv run mypy src

test:
	uv run pytest

test-cov:
	uv run pytest --cov-report=html

check: lint typecheck test

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage htmlcov coverage.xml build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} +

docker-build:
	docker build -t tailwind:latest .

docker-run:
	docker run --rm -p 8050:8050 --env-file .env tailwind:latest
