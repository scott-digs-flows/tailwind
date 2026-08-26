# Tailwind — Ways of Working

**Status:** Draft v0.1

## Tracking: why not just a CSV

You suggested `TICKETS.csv`. I've built it, with one addition, because a flat CSV alone breaks in a
predictable way: a ticket that needs three paragraphs of acceptance criteria turns into an
unreadable quoted blob, and two people editing the same file produce a merge conflict on every row.

**The setup:**

| Artifact | Role |
|---|---|
| `TICKETS.csv` | The **index** — one row per ticket, tracking fields only. Opens in any spreadsheet, sorts and filters, diffs legibly in git. |
| `docs/tickets/<ID>.md` | The **spec** — only for tickets that need more than a sentence. Most won't. |
| `docs/product/*.md` | The **why** — requirements referenced by ID from the CSV. |

This keeps the whole project in one repo, reviewable by the same PR process the product itself is
built around — which is a fitting way to build this particular product, and means the AI tooling
you plan to point at the codebase can read the backlog too.

### When to move to GitHub Issues

*(Revised 2026-08-10 — the original trigger was headcount, which is the wrong variable.)*

**The CSV is not the asset. The schema and `scripts/validate_docs.py` are.** The check enforces
fourteen invariants that GitHub Issues has no concept of:

- Every ticket traces to a requirement, ADR, or open question
- Every referenced ID actually exists in a product doc
- No dangling dependencies, and **no dependency cycles**
- **Every `Must`/`Should` requirement has at least one ticket**
- Nothing is `in-progress` while a dependency is unfinished
- No `XL` ticket has started work

That is not bureaucracy. It has caught two real defects already: fifteen uncovered requirements
including **FR-SEM-02** — *"a metric is defined exactly once,"* the guarantee the entire product
rests on, which had no ticket at all — and the **T-120 dependency inversion** where the ticket
labelled "do this first" was structurally unstartable behind two later-milestone tickets.

GitHub has sub-issues and Projects custom fields, but no arbitrary dependency DAG, no cycle
detection, and no notion of requirement coverage. Move naively and all fourteen checks are silently
gone — and the failure mode of losing them is invisible, which is the worst kind.

**The trigger is not team size. It is: when tickets start being *worked* rather than *planned*.**

Everything Issues is good at — assignees, notifications, `Closes #123`, linking a PR to the work it
implements, concurrent edits without merge conflicts on one file — pays off during implementation.
Everything the CSV is good at — schema, traceability, living in the same PR as the docs it must stay
consistent with — pays off during planning. Right now there are 132 tickets and zero lines of
application code, so the value is entirely in coherence.

**Concretely: move at the start of M0 implementation** (T-010, the repo scaffold), which is also
when T-108 gives us the GitHub App anyway.

**The migration is not "export the CSV."** It is:

1. Script the port — one issue per ticket, `epic` → label, `milestone` → milestone, `req_ids` and
   `depends_on` into a structured block in the issue body.
2. **Port the validator to run as a GitHub Action against the API**, parsing that block. This is the
   actual cost of the migration and the part that must not be skipped. Budget it as a real ticket,
   not a footnote.
3. Keep `docs/product/*` as the requirements contract. Issues reference requirement IDs; the
   requirements never move.
4. Retire `TICKETS.csv` in the same PR that lands the Action — never run both as sources of truth.

**One argument in favour of moving that has nothing to do with tooling:** the team would then live
in the same PR-review surface it is asking Morgan and Sam to live in. If that experience is bad for
us, it is early signal about the product. Worth something — just not worth losing the checks for.

### `TICKETS.csv` columns

| Column | Meaning |
|---|---|
| `id` | `T-###`, stable forever. Never renumber or reuse. |
| `epic` | `E-##`, see the epic list below. |
| `milestone` | `M0`–`M4`, per `03-roadmap.md`. |
| `title` | Imperative, one line. |
| `type` | `feature` · `spike` · `adr` · `infra` · `discovery` · `chore` |
| `priority` | `P0` blocks the milestone · `P1` in scope · `P2` nice-to-have · `P3` backlog |
| `size` | `S` (<1d) · `M` (1–3d) · `L` (~1wk) · `XL` (needs splitting before it's picked up) |
| `status` | `todo` · `in-progress` · `blocked` · `review` · `done` |
| `owner_role` | `product` · `architect` · `fullstack` · `data-team` · `security` |
| `depends_on` | Space-separated ticket IDs. |
| `req_ids` | Space-separated requirement/ADR IDs from `01-requirements.md` / `02-architecture-brief.md`. |
| `acceptance` | One sentence: the observable behavior that makes this done. |

### Epics

| ID | Epic |
|---|---|
| E-00 | Foundations & decisions |
| E-01 | Semantic layer |
| E-02 | Query execution & serving |
| E-03 | Dashboards & visualization |
| E-04 | Consumption experience |
| E-05 | AI assistance |
| E-06 | Governance & promotion loop |
| E-07 | Data-team tooling |
| E-08 | Security & identity |
| E-09 | Admin & operations |
| E-10 | Migration |
| E-11 | Product & discovery |

### Rules

1. **Every ticket references a requirement or an ADR.** A ticket with an empty `req_ids` is either
   missing context or shouldn't exist. Chores and infra are the only routine exceptions.
2. **`XL` is not an estimate, it's a flag.** Split before starting.
3. **No ticket enters `in-progress` while `blocked` dependencies are open** — surface the block
   instead; that's how Product finds out an answer is overdue.
4. **Changing scope changes the requirement doc first**, then the ticket. The docs are the contract
   with the architect; drifting tickets away from them silently is how handoffs fail.

## Definition of Ready

A ticket is pickup-ready when: acceptance criteria are unambiguous, dependencies are `done`, any
governing ADR is written, and the size is `L` or smaller.

## Definition of Done

Merged behind review; tests at the appropriate level (unit for compiler logic, integration for
warehouse paths, e2e for the promotion loop); observability in place for anything user-facing;
docs updated if behavior changed; deployed to staging and demonstrated.

## Cadence suggestion

Given a team of ~2–3 engineers plus Product, weekly is enough ceremony:

- **Monday** — 30 min: walk `TICKETS.csv` filtered to the active milestone; set the week.
- **Continuous** — PR review as the primary coordination mechanism.
- **Friday** — 30 min: demo whatever moved, and update `04-open-questions.md`. Any question still
  unanswered after two Fridays gets escalated with a named owner and a date.

## A note on how the team should build

Since the product's own thesis is "AI authoring plus human review," the team should work the same
way: use AI assistance freely for implementation, keep the review gate strict, and treat the
codebase's own documentation quality as a product input. If the AI can't navigate our repo, that's
early evidence it won't navigate our semantic layer either.
