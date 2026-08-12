#!/usr/bin/env bash
# The M0 "publish" step.
#
# Cube compiles the model ONCE at startup in production mode (CUBEJS_DEV_MODE=false),
# which is correct for us: artifacts are published deliberately, not hot-reloaded.
# ADR-007 / T-029 replaces this with an immutable per-merge bundle; until then, a
# restart is the publish.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file infra/versions.env -f infra/docker-compose.yml)

echo "validating specs (the same gate CI runs)…"
node packages/cli/src/main.ts validate content >/dev/null

echo "publishing…"
"${COMPOSE[@]}" restart cube >/dev/null
for _ in $(seq 1 60); do
  curl -sf http://localhost:4000/readyz >/dev/null 2>&1 && break
  sleep 1
done
sleep 2
echo "published."
