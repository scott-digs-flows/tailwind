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

A ticket is read by someone who was not in the conversation, often months later, often in a hurry.
Write for that person. **Short and clear beats complete.**

### Summary

An imperative verb and an outcome, in plain language, around eight words.

> ✅ `Cache query results without leaking rows between users`
> ❌ `Implement RLS-safe cache keying per ADR-008 §3`
> ❌ `Cache layer` — a topic, not a deliverable

If the summary needs an "and", it is usually two tickets.

### Description

**Two sections. Aim for under 150 words.** If you need more, the ticket is too big or the reasoning
belongs in a doc you link to.

```markdown
## Goal
One or two plain sentences: what will be true when this is done, and why anyone cares.
No jargon the reader cannot resolve from this page alone.

## Acceptance
- [ ] An observable statement someone else could check
- [ ] Another, if genuinely separate
```

Add a `## Notes` section **only** for something non-obvious that would otherwise cost the
implementer an hour — a known trap, a decision already made, the file to start in. Three sentences
at most. It is not a place for background reading.

Then the ` ```tailwind-meta ` block, last, carrying `req_ids` and `legacy_id`.

### Write so anyone can understand it

This product has heavy vocabulary — semantic layer, RLS, fan-out, freshness class, promotion loop.
The ticket is not where a reader should learn it. Expand a term once in plain words, or link
`07-domain-model.md §1` and move on. A stakeholder should be able to read the Goal and know whether
they care.

Prefer the concrete: *"a user in the West territory never sees East rows, even on a cache hit"*
over *"enforce tenant-scoped predicate resolution at the caching boundary."*

### Acceptance criteria are the ticket

Most of a ticket's value is a sentence someone can disagree with. Each one is **observable,
checkable, and true-or-false** — not a task list.

> ✅ `p95 for the four-chart sales dashboard is under 2.5s against the CI ClickHouse fixture`
> ✅ `Editing a metric in content/ and running publish.sh changes the number on the dashboard`
> ❌ `Dashboard loads fast`
> ❌ `Write unit tests` — that is how, not what

Use Given/When/Then only when the setup genuinely matters. Usually a checkbox is clearer.

## What does not go in the description

Two rules, and they are absolute because breaking them is what turns a ticket into an archaeology
site.

**1. Related tickets go in JIRA's Linked Issues, never in the text.** Blocks, is blocked by,
relates to, duplicates — all of it is a link. A ticket key typed into the description is invisible
to the board, to JQL, to dependency checking, and it goes stale silently the moment anything is
split or re-scoped.

- `depends_on` → **Blocks** links. Direction is easy to reverse; see the mapping file.
- Same-area or informative relationships → **Relates**.
- Epic membership → the `parent` field, not a sentence.
- Governed by an ADR? Link to the ADR's own ticket with **Relates**, and put the ADR's ID in
  `req_ids`.

The one exception is `req_ids` in the meta block, which holds **requirement and ADR identifiers,
not ticket keys** — JIRA has nowhere native to put them and the coverage check has to parse them
somewhere. `legacy_id` is this ticket's own former `T-###`, also identity rather than a
relationship. Neither is a back door for "see also TW-42".

**2. History goes in comments. The description is always present tense and currently true.**

When scope changes, **rewrite the description so it describes the ticket as it now is**, then add a
comment saying what changed and why. Never leave a trail in the description:

> ❌ `UPDATE 2026-09-14: we dropped the Redis option, see below. ~~Original scope: …~~`

A description carrying its own edit history stops being a specification and becomes a puzzle, and
the reader cannot tell which paragraph is still true. JIRA already keeps the full field history, so
the audit trail is not lost — you are only choosing where people read it.

Comment, don't edit into the description: scope changes and why, decisions made in discussion,
what blocked it and what unblocked it, status changes whose reason is not obvious from the linked
PR, and anything you discovered that changes the estimate.

## INVEST

Test a ticket against these before you save it. Where one fails, either fix the ticket or say
plainly why it is acceptable here.

| | |
|---|---|
| **I**ndependent | Can this be built without waiting on something not yet started? Real dependencies exist in this project — when one is genuine, make it a **Blocks link**, do not pretend it is absent. Ordering that is merely convenient is not a dependency. |
| **N**egotiable | Does it state the *outcome* rather than the implementation? Prescribe a solution only when the solution is the decision — and then say which ADR decided it. |
| **V**aluable | Can you name who is better off? "Refactor the adapter" is valuable only if you can finish the sentence. Enabling work is legitimate; say what it enables. |
| **E**stimable | Could someone sizing this say `S`/`M`/`L` without guessing? If not, the unknown is the real work — write a `type-spike` first. |
| **S**mall | `size-L` or under, or it is not ready to pick up. `size-XL` is a flag meaning "not understood well enough to start". |
| **T**estable | Does each acceptance criterion have an observation that settles it? If nobody could prove it false, it is a wish. |

## The rest of the schema

**`req_ids` is required.** A ticket with nothing to trace to is either missing context or should
not exist. If the work is real but no requirement covers it, **add the requirement first** — the
docs are the contract with the architect, and a ticket that outruns them is how a handoff fails.

**Labels are the schema.** Every ticket gets its milestone, priority, `size-*`, `type-*` and
`role-*` labels. Missing labels are not cosmetic — they are how the backlog is queried, and an
unlabelled ticket is invisible to every planning question below.

## Worked example

> **Summary** `Keep cached results from leaking rows between users`
>
> **Goal**
> Two people looking at the same dashboard can be entitled to different rows. Today a cached
> result could be handed to the second person unchanged. This makes the cache aware of who is
> asking, so that never happens.
>
> **Acceptance**
> - [ ] Two users with different row entitlements never receive each other's cached rows
> - [ ] A repeat query by the *same* user still returns from cache
> - [ ] An integration test covers both, against the CI ClickHouse fixture
>
> **Links** — is blocked by TW-31 (security context in the compiler API) · relates to TW-9 (ADR-008)
> **Labels** — `M1` `P0` `size-M` `type-feature` `role-fullstack`
>
> ```tailwind-meta
> legacy_id: T-046
> req_ids: FR-SEM-15 NFR-SEC-04 ADR-008
> ```

Note what is absent: no restatement of the title, no ADR summary, no ticket keys in the prose, no
edit history, and nothing a reader needs a glossary for.

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
