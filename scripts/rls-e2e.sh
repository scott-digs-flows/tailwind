#!/usr/bin/env bash
# TW-174. The end-to-end row-security proof, then its NEGATIVE CONTROL.
#
# The suite itself is `apps/api/test/e2e/rls-two-users.ts`: two principals of one tenant
# open one dashboard through the real serving path and get different rows, different
# numbers and different SQL, and a request that resolves to no tenant is refused before a
# byte reaches the engine.
#
# The control follows conformance.sh's reasoning exactly. It does not delete the policy
# or unplug `contextToGroups` -- either of those makes Cube ERROR, and a suite that only
# has to notice an error is a suite that would not notice a leak. Instead it WEAKENS the
# reviewed row filter to an empty list: every query still runs, every chart still
# renders, and the restricted reader silently sees everything. That is the shape the real
# failure takes, and if the suite still passes in that state it is testing nothing
# (T-136/T-137).
#
# Runs against the CONFORMANCE stack (infra/docker-compose.ci.yml), never the dev
# warehouse: the row differences this asserts on are a property of the committed fixture.
set -euo pipefail
cd "$(dirname "$0")/.."

export TAILWIND_COMPOSE=infra/docker-compose.ci.yml
export CUBE_URL=${CUBE_URL:-http://localhost:7401/cubejs-api/v1}
# The suite asserts on structured results, not on log lines, and the API logs a stack
# trace for every deliberate refusal. Override to `warn` when debugging a failure here.
export LOG_LEVEL=${LOG_LEVEL:-silent}

VIEW=content/tenants/internal/semantic/views/sales.view.yml
SNAP=$(mktemp)
cp "$VIEW" "$SNAP"
restore() { cp "$SNAP" "$VIEW"; rm -f "$SNAP"; ./scripts/publish.sh >/dev/null 2>&1 || true; }
trap restore EXIT

echo "=== two users, one dashboard: the model as reviewed ==="
node apps/api/test/e2e/rls-two-users.ts

echo
echo "=== negative control: the reviewed row filter weakened to nothing ==="
# The mutation asserts it actually matched. A control whose edit silently no-ops still
# "passes", and an inert control is worse than no control -- it is the same failure as a
# guard that ships complete and never fires (T-130).
python3 - "$VIEW" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
t = p.read_text()
filtered = """      - group: europe_only
        row_level:
          filters:
            - member: sales.territory_group
              operator: equals
              values:
                - Europe
"""
unfiltered = """      - group: europe_only
        row_level:
          filters:
            []
"""
if filtered not in t:
    sys.exit(f"negative control could not find the europe_only row filter in {p}: the control would be inert")
p.write_text(t.replace(filtered, unfiltered))
print("   europe_only is now unrestricted")
PY
./scripts/publish.sh >/dev/null
node apps/api/test/e2e/rls-two-users.ts --negative-control=unfiltered-policy
