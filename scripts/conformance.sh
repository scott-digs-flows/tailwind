#!/usr/bin/env bash
# T-097. Runs the conformance suite, then the NEGATIVE CONTROL.
#
# The architect's point when rescoping this ticket: "a test that still passes when the
# declared relationships are removed isn't testing the mechanism." So the control does
# not delete the join -- that only produces errors. It MIS-DECLARES the cardinality as
# one_to_one, so every query still runs and the fan-out silently returns wrong numbers.
# If the suite still passes in that state, it is testing nothing.
set -euo pipefail
cd "$(dirname "$0")/.."

LINES=content/tenants/internal/semantic/cubes/order_lines.cube.yml
SNAP=$(mktemp)
cp "$LINES" "$SNAP"
restore() { cp "$SNAP" "$LINES"; rm -f "$SNAP"; ./scripts/publish.sh >/dev/null 2>&1 || true; }
trap restore EXIT

echo "=== conformance: engine as declared ==="
node packages/semantic/test/conformance/run.ts

echo
echo "=== negative control: cardinality mis-declared as one_to_one ==="
python3 - "$LINES" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
p.write_text(p.read_text().replace('relationship: many_to_one', 'relationship: one_to_one'))
PY
./scripts/publish.sh >/dev/null 2>&1
sleep 2
node packages/semantic/test/conformance/run.ts --negative-control
