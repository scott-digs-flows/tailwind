# Tailwind — Ways of Working

**Status:** Draft v0.1

## Tracking: JIRA project TW

*(Moved 2026-09-14. The reasoning below is kept because the argument is what matters, not the
outcome — and because the same trap is waiting for anyone who moves tracker again.)*

| Artifact | Role |
|---|---|
| **JIRA project `TW`** | The backlog. 12 epics, 137 tickets. One issue per ticket. |
| `docs/tickets/<ID>.md` | The **spec** — only for tickets needing more than a JIRA description. Most won't. |
| `docs/product/*.md` | The **why** — requirements referenced by ID from each issue. |

### What the move cost, and what we did about it

The original tracker was `TICKETS.csv`. **The CSV was never the asset. The schema and its validator
were.** That check enforced fourteen invariants JIRA has no concept of:

- Every ticket traces to a requirement, ADR or open question
- Every referenced ID actually exists in a product doc
- No dangling dependencies, and **no dependency cycles**
- **Every `Must`/`Should` requirement has at least one ticket**
- Nothing is in progress while a dependency is unfinished
- No `XL` ticket has started work

That is not bureaucracy. It caught two real defects: fifteen uncovered requirements including
**FR-SEM-02** — *"a metric is defined exactly once,"* the guarantee the entire product rests on,
which had no ticket at all — and the **T-120 dependency inversion**, where the ticket labelled "do
this first" was structurally unstartable behind two later-milestone tickets.

JIRA has sub-tasks and links, but no arbitrary dependency DAG check, no cycle detection and no
notion of requirement coverage. **Moving naively would have silently deleted all fourteen, and the
failure mode of losing them is invisible** — nothing breaks, the backlog just quietly stops being
trustworthy.

So the migration was not "export the CSV." It was:

1. One issue per ticket, `epic` → a JIRA Epic parent, `depends_on` → **Blocks** links, `req_ids` and
   the original `T-###` → a `tailwind-meta` block in the description.
2. **`scripts/validate_jira.py` — the same fourteen checks, against the API.** This was the actual
   cost of the migration and the part that must never be skipped. It fails closed: with no
   credentials it exits non-zero rather than passing.

   It is **run deliberately, not in CI** *(decided 2026-09-14)*. A CI gate was right when the
   backlog was a file in the checkout: a commit could break it, so a commit should be blocked by it.
   Once the backlog moved to JIRA the coupling inverted — a TypeScript change cannot create a
   dependency cycle, but it could be blocked by an expired token or an Atlassian outage. A gate that
   fails for reasons unrelated to the change under review is a gate people learn to ignore, and an
   ignored gate protects nothing. So the check runs when someone changes the requirements contract,
   and on the backlog periodically. Its owner is the delivery lead, and that is a named
   responsibility rather than a hope — see the cadence below.
3. `TICKETS.csv` deleted **in the same change that landed the check**, so the two were never both
   authoritative. That is the rule with no exceptions — two sources of truth is a state you only
   discover you were in when a number is wrong.
4. `docs/product/*` untouched as the requirements contract. Issues cite requirement IDs; the
   requirements never move.

### The field encoding

`TW` is a **team-managed** project, which has no `components`, `fixVersions` or `versions` fields.
That is why milestone is a label rather than a version.

| Was | Now |
|---|---|
| `id` (`T-###`) | `legacy_id` in the meta block — **never lost**; ADRs and commits cite it |
| `title` | `summary`, imperative, one line |
| `epic` (`E-##`) | the JIRA Epic parent |
| `milestone` | label `M0`–`M4` |
| `priority` | native **priority** field: P0→Highest, P1→High, P2→Medium, P3→Low |
| `size` | label `size-S` … `size-XL` |
| `type` | label `type-feature` · `type-spike` · `type-adr` · `type-infra` · `type-discovery` · `type-chore` |
| `owner_role` | label `role-product` · `role-architect` · `role-fullstack` · `role-data-team` · `role-security` |
| `depends_on` | **Blocks** links — inward is "is blocked by" |
| `req_ids` | the `tailwind-meta` block |
| `acceptance` | the `## Acceptance` section |
| `status` | To Do · In Progress · **Code Review** · **Quality Review** · Done. `blocked` is the **Flagged: Impediment** field, so the ticket keeps its place on the board |

### Epics

| ID | Epic | JIRA |
|---|---|---|
| E-00 | Foundations and decisions | `TW-1` |
| E-01 | Semantic layer | `TW-3` |
| E-02 | Query execution and serving | `TW-4` |
| E-03 | Dashboards and visualization | `TW-5` |
| E-04 | Consumption experience | `TW-6` |
| E-05 | AI assistance | `TW-7` |
| E-06 | Governance and the promotion loop | `TW-8` |
| E-07 | Data-team tooling | `TW-9` |
| E-08 | Security and identity | `TW-10` |
| E-09 | Admin and operations | `TW-11` |
| E-10 | Migration | `TW-12` |
| E-11 | Product and discovery | `TW-13` |

### Rules

1. **Every ticket references a requirement or an ADR.** A ticket with an empty `req_ids` is either
   missing context or shouldn't exist. Chores and infra are the only routine exceptions.
2. **`XL` is not an estimate, it's a flag.** Split before starting.
3. **No ticket enters In Progress, Code Review or Quality Review while a blocker is open** —
   flag it as an impediment instead; that's how Product finds out an answer is overdue. All
   three are "started" as far as the checks are concerned, because all three mean someone has
   begun.
4. **Changing scope changes the requirement doc first**, then the ticket. The docs are the contract
   with the architect; drifting tickets away from them silently is how handoffs fail.
5. **Relationships are links, never prose**, and **history is comments, never the description.**
   A description is always present tense and currently true.

## Definition of Ready

A ticket is pickup-ready when: acceptance criteria are unambiguous, dependencies are `done`, any
governing ADR is written, and the size is `L` or smaller.

## Definition of Done

Merged behind review; tests at the appropriate level (unit for compiler logic, integration for
warehouse paths, e2e for the promotion loop); observability in place for anything user-facing;
docs updated if behavior changed; deployed to staging and demonstrated.

## Cadence suggestion

Given a team of ~2–3 engineers plus Product, weekly is enough ceremony:

- **Monday** — 30 min: walk the TW board filtered to the active milestone; set the week. Run
  `pnpm validate:backlog` and fix anything it reports before planning on top of it.
- **Continuous** — PR review as the primary coordination mechanism.
- **Friday** — 30 min: demo whatever moved, and update `04-open-questions.md`. Any question still
  unanswered after two Fridays gets escalated with a named owner and a date.

## A note on how the team should build

Since the product's own thesis is "AI authoring plus human review," the team should work the same
way: use AI assistance freely for implementation, keep the review gate strict, and treat the
codebase's own documentation quality as a product input. If the AI can't navigate our repo, that's
early evidence it won't navigate our semantic layer either.
