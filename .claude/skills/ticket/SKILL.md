---
name: ticket
description: Write, split, re-scope, link or re-status a Tailwind ticket in JIRA project TW. Use whenever work needs tracking - "add a ticket", "write up TW-42", "split this XL", "mark it done", "what should I work on next", "what's blocked" - or when a scope change means the backlog no longer matches the requirements docs. Also covers the TICKETS.csv to JIRA migration. Enforces traceability and dependency integrity, which JIRA cannot enforce for you.
---

# Tickets

The backlog lives in **JIRA project `TW`** on `scottdigsflows.atlassian.net`. Field encoding, site
IDs, link direction, status mapping, JQL and the migration runbook are in
[references/jira-mapping.md](references/jira-mapping.md) — read it before your first write, and
re-read the mapping table before any bulk operation.

## Which system is authoritative, today

**Until `scripts/validate_jira.py` lands in CI, `TICKETS.csv` is still the source of truth and
JIRA is a rehearsal.** After it lands, the CSV is deleted in that same PR and JIRA is the backlog.

There is never a period where both are authoritative. If you find yourself writing the same change
to both because you are not sure which one counts, stop and say so — that ambiguity is the failure
mode `05-ways-of-working.md` warns about, and it is invisible until a number is wrong.

## What JIRA will not do for you

Moving off the CSV costs fourteen mechanical invariants that `scripts/validate_docs.py` enforced
and JIRA has no concept of. Two of them have already caught real defects: fifteen uncovered
requirements including **FR-SEM-02** — *"a metric is defined exactly once"*, the guarantee the
product rests on, which had no ticket at all — and the **T-120 dependency inversion**, where the
ticket labelled "do this first" was structurally unstartable behind two later-milestone tickets.

So until the ported check exists, **you are the check.** Every time you touch the backlog:

- Every ticket traces to a requirement, ADR, or open question (`req_ids` in the meta block).
  `chore` and `infra` are the only routine exceptions.
- Every referenced ID actually exists in a product doc. Grep for it; do not assume.
- No dangling dependencies and **no dependency cycles**. JIRA will happily let you draw a cycle.
- Every `Must`/`Should` requirement in `01-requirements.md` has at least one ticket.
- Nothing is In Progress while something that blocks it is open.
- No `size-XL` ticket has started work.

A gap you find here is a finding worth reporting, not a thing to quietly patch.

## Writing a ticket

The `summary` is imperative and one line. The description is:

```markdown
## Why
One or two sentences of the actual reason, tracing to the requirement. Not a restatement
of the title.

## Acceptance
The observable behavior that makes this done. Not "implement X" — what is *true* when it
is finished, in a form someone else could check.

## Notes
Only if there is something non-obvious: a trap, a decision already made, a file to start in.
```

Then the ` ```tailwind-meta ` block, last, carrying `req_ids` and `legacy_id`.

**`req_ids` is required.** A ticket with nothing to trace to is either missing context or should
not exist. If the work is real but no requirement covers it, **add the requirement first** — the
docs are the contract with the architect, and a ticket that outruns them is how a handoff fails.

**Acceptance criteria are the deliverable.** Most of the value of a ticket is a sentence someone
can disagree with. "Dashboard loads fast" is not one. "p95 for the four-chart sales dashboard is
under 2.5s against the CI ClickHouse fixture" is.

**Labels are the schema.** Every ticket gets its milestone, priority, `size-*`, `type-*` and
`role-*` labels. Missing labels are not cosmetic — they are how the backlog is queried, and an
unlabelled ticket is invisible to every planning question below.

**Dependencies are Blocks links, and the direction is easy to reverse.** Check the mapping file,
then verify one link reads correctly in the UI.

## Splitting an XL

`size-XL` is a flag meaning "not understood well enough to start", not an estimate. Split before
work begins.

Keep the original issue for the largest remaining piece, create new issues for the rest, and carry
`req_ids` to **whichever child actually satisfies each requirement** — do not copy them all to
every child, which turns the coverage check into noise. Wire up Blocks links between the children.
Preserve the original `legacy_id` on the piece that kept the issue; new children get no
`legacy_id`.

## Status changes

`To Do` → `In Progress` → `In Review` → `Done`, with the Flagged/Impediment flag from anywhere.

**Never move a ticket to In Progress while something that blocks it is open.** Flag it as an
impediment instead. That is how Product finds out an answer is overdue, which is the entire point
of tracking dependencies rather than just listing them.

When you transition an issue, say why in a comment if the reason is not obvious from the linked
PR. The board is read by people who were not in the conversation.

## Answering "what's next?"

Ready = status `To Do`, every blocker `Done`, `size-L` or smaller, and any governing ADR written.

```
project = TW AND statusCategory = "To Do" AND labels = M0 AND labels IN (P0, P1)
```

Then filter that set client-side: drop anything with an open blocker, drop `size-XL`. Sort by
milestone, then priority. **Prefer tickets that unblock the most other tickets** — check what
each candidate blocks before recommending, because the highest-priority ticket and the
highest-leverage ticket are frequently not the same one.

Recommend one, with the reason. A ranked list of nine is a way of not answering.

## Scope changes

**Update the requirement doc first, then the ticket.** `docs/product/01-requirements.md` is the
contract; `08-poc-scope.md` filters it for M0–M2 and wins where they conflict. Check that filter
before putting new work in the POC — the default answer for a production concern is M3.

## After any edit

While the CSV is still authoritative: `python3 scripts/validate_docs.py`. It is a gate, not a
suggestion. After the port: `python3 scripts/validate_jira.py`.
