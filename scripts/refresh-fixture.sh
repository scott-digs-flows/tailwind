#!/usr/bin/env bash
# Regenerates the conformance fixture from the live AdventureWorks catalog.
#
# Run this ONLY when the source schema changes. The fixture is committed on purpose:
# conformance must run against a fixed dataset or the oracle drifts with whatever is
# in the warehouse, and a suite whose expected values move is not a suite.
#
# Requires data-warehouse-local up with `--profile engines`.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build_fixture.py
echo "fixture refreshed -- now rebuild the oracle:"
echo "  docker compose --env-file infra/versions.env -f infra/docker-compose.ci.yml down -v"
echo "  docker compose --env-file infra/versions.env -f infra/docker-compose.ci.yml up -d"
echo "  ./scripts/refresh-oracle.sh"
