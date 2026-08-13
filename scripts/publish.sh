#!/usr/bin/env bash
# The M0 "publish" step.
#
# Cube compiles the model ONCE at startup in production mode (CUBEJS_DEV_MODE=false),
# which is correct for us: artifacts are published deliberately, not hot-reloaded.
# ADR-007 / T-029 replaces this with an immutable per-merge bundle; until then, a
# restart is the publish.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file infra/versions.env -f "${TAILWIND_COMPOSE:-infra/docker-compose.yml}")

echo "validating specs (the same gate CI runs)…"
node packages/cli/src/main.ts validate content >/dev/null

echo "publishing…"
"${COMPOSE[@]}" restart cube >/dev/null

# T-118 established that /readyz passes while the model is unusable -- the container
# boots, health checks go green, and the first real query throws. So readiness is
# proven with an ACTUAL query, not with a health endpoint.
for _ in $(seq 1 60); do
  if node packages/semantic/test/manual/ping.ts >/dev/null 2>&1; then
    echo "published."
    exit 0
  fi
  sleep 1
done
echo "publish FAILED: Cube did not serve a query within 60s" >&2
exit 1
