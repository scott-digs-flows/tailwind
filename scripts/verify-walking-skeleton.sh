#!/usr/bin/env bash
# T-011. Proves the one thing M0 exists to prove: a hand-written change to a metric
# DEFINITION in a git-tracked file moves the number on the dashboard -- with no
# production warehouse anywhere in the loop.
set -euo pipefail
cd "$(dirname "$0")/.."

CUBE_FILE=content/tenants/internal/semantic/cubes/orders.cube.yml
API=http://localhost:7080/api

revenue() {
  curl -s -X POST "$API/v1/queries" -H 'Content-Type: application/json' \
    -d '{"query":{"view":"sales","metrics":["sales.revenue"]}}' \
  | python3 -c "import json,sys; print(round(float(json.load(sys.stdin)['data']['rows'][0]['sales.revenue']),2))"
}

# Snapshot the bytes. `git checkout --` silently no-ops on an untracked path, which
# would leave the model edited and the "revert" a lie.
SNAPSHOT=$(mktemp)
cp "$CUBE_FILE" "$SNAPSHOT"
restore() { cp "$SNAPSHOT" "$CUBE_FILE"; rm -f "$SNAPSHOT"; }
trap 'restore; ./scripts/publish.sh >/dev/null 2>&1 || true' EXIT

echo "1. revenue as currently defined (sum of amount)"
BEFORE=$(revenue); echo "   $BEFORE"

echo "2. editing the metric definition by hand: amount -> amount * quantity"
python3 - "$CUBE_FILE" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]); t = p.read_text()
t = re.sub(r'(name: revenue\n        type: sum\n        sql: )amount\n', r'\1amount * quantity\n', t)
p.write_text(t)
PY
grep -A2 'name: revenue' "$CUBE_FILE" | sed 's/^/   /'

echo "3. publishing"
./scripts/publish.sh | sed 's/^/   /'

echo "4. revenue after the change"
AFTER=$(revenue); echo "   $AFTER"

echo
if [ "$BEFORE" = "$AFTER" ]; then
  echo "FAIL: the number did not move. The file is not driving the dashboard."
  exit 1
fi
echo "PASS: editing one git-tracked file moved the number: $BEFORE -> $AFTER"
echo "      (reverting)"
