---
name: ticket
description: Add, split, re-scope, or re-status tickets in TICKETS.csv. Use whenever work needs tracking - "add a ticket", "split this XL", "mark T-014 done", "what should I work on next", "what's blocked" - or when a scope change means the backlog no longer matches the requirements docs. Enforces the column contract and runs the traceability validator.
---

# Editing TICKETS.csv

`TICKETS.csv` is the backlog index. Column contract and conventions:
[docs/product/05-ways-of-working.md](../../../docs/product/05-ways-of-working.md).

**Always run `python3 scripts/validate_docs.py` after any edit.** It is the gate.

## Editing safely

The file is CSV with quoted fields. For anything beyond a single-cell change, edit it with a Python
script using the `csv` module rather than by hand — hand-editing quoted fields is how the column
contract breaks silently.

```python
import csv
rows = list(csv.DictReader(open('TICKETS.csv')))
by = {r['id']: r for r in rows}
by['T-014']['status'] = 'done'
with open('TICKETS.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
```

## Adding a ticket

- **ID:** next free `T-###`. Never reuse or renumber — IDs are referenced from ADRs and commits.
- **`req_ids` is required** (except `chore`/`infra`): every ticket traces to a requirement, ADR, or
  open question. A ticket with nothing to trace to is either missing context or shouldn't exist.
  If the work is real but no requirement covers it, **add the requirement first** — the docs are
  the contract.
- **`acceptance`:** one sentence naming an *observable behavior*. Not "implement X" — what is true
  when it's done.
- **`depends_on`:** be honest. A missing dependency surfaces as a mid-sprint surprise; a spurious
  one blocks work that could have started.
- **`milestone`:** M0–M2 is the POC, M3–M4 is GA. Check
  [08-poc-scope.md](../../../docs/product/08-poc-scope.md) before putting new work in the POC —
  the default answer for production concerns is M3.

## Splitting an XL

`XL` is a flag meaning "not understood well enough to start", not an estimate. Split it before work
begins — the validator fails an XL in `in-progress`.

When splitting: keep the original ID for the largest remaining piece, give new IDs to the rest,
carry `req_ids` to whichever child actually satisfies each requirement (don't copy them all to
every child), and wire up `depends_on` between the children.

## Status changes

Valid: `todo` → `in-progress` → `review` → `done`, with `blocked` from anywhere.

**Never move a ticket to `in-progress` while a dependency is unfinished** — the validator enforces
this. Mark it `blocked` instead. That's how Product finds out an answer is overdue, which is the
whole point.

## Answering "what's next?"

Ready = `status: todo`, all `depends_on` are `done`, size ≤ `L`, and any governing ADR is written.
Sort by milestone, then priority. Prefer tickets that unblock the most other tickets — check what
depends on each candidate before recommending.

## Scope changes

**Update the requirement doc first, then the ticket.** Tickets drifting away from
`01-requirements.md` is how a handoff quietly fails: the architect designs to one thing while the
engineer builds another.
