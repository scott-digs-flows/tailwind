#!/usr/bin/env bash
# Rebuilds packages/semantic/test/oracle.json from the conformance FIXTURE.
#
# Expected values are computed by querying ClickHouse directly -- never through Cube.
# An expectation produced by the thing under test proves nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/build_oracle.py
