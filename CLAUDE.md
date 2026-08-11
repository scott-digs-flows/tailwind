# Tailwind

Analytics-as-code with an AI authoring surface. Business users describe what they want in plain
language; AI composes it **only** out of a governed semantic layer; the data team approves it
through a pull request. Replaces Tableau / Power BI / Looker.

**Current phase: product definition complete, architecture not started.** There is no application
code yet. The repo holds requirements, decisions, and a backlog.

## Read this first

| If you are… | Read |
|---|---|
| Anyone, first time | [docs/product/README.md](docs/product/README.md) then [00-vision.md](docs/product/00-vision.md) |
| Designing the architecture | [02-architecture-brief.md](docs/product/02-architecture-brief.md) + [08-poc-scope.md](docs/product/08-poc-scope.md) |
| Implementing a ticket | The ticket's `req_ids` in [01-requirements.md](docs/product/01-requirements.md), plus the governing ADR |
| Confused by a term | [07-domain-model.md §1](docs/product/07-domain-model.md) |

**M0–M2 is a POC** testing one hypothesis; M3–M4 is GA. `08-poc-scope.md` is a filter over the
requirements and **wins where they conflict**. Don't build GA concerns into POC work — but read
its §3, the seven things that stay despite looking like GA work because retrofitting them is a
rewrite.

## Binding constraints

From `02-architecture-brief.md §2`. These are Product decisions. If one blocks you, raise it —
don't design around it silently.

1. **Git is the source of truth for artifacts** — history and review are the mechanism, not a mirror.
2. **All numbers flow through the semantic compiler.** No path — AI, export, drill-through,
   scheduled delivery — emits SQL that bypasses it. One door.
3. **AI writes proposals, never shared state.** Its only durable output is a validated diff.
4. **RLS is enforced at compile time** from the requesting user's identity, independent of who
   authored the artifact.
5. **Spec serialization is deterministic and lossless.** Noisy diffs make the review gate theater.
6. **The serving tier is stateless.**
7. **Authors need no git account** — the app brokers PRs via a GitHub App.

Two corollaries worth internalizing:

- **Nothing in the operational database may change a number.** Git holds what humans review; the
  DB holds runtime and personal state. The security context may *restrict* rows and mask columns —
  it may never *redefine* a metric. See [07-domain-model.md §2](docs/product/07-domain-model.md).
- **The hand-written path is never second-class.** Analytics engineers must be able to do
  everything via CLI and files, with no AI involved.

## Working in this repo

**Backlog:** [`TICKETS.csv`](TICKETS.csv) — 114 tickets. Column contract and conventions in
[05-ways-of-working.md](docs/product/05-ways-of-working.md). Never renumber or reuse a ticket ID.

**Decisions:** [`docs/adr/`](docs/adr/) — numbers assigned in `02-architecture-brief.md §4`.

**Validate before committing:**

```bash
python3 scripts/validate_docs.py
```

Checks ticket schema, dependency integrity, cycles, and that every Must/Should requirement has a
ticket. It is a gate, not a suggestion — mechanical rules belong in a check rather than in
someone's memory. That is the same argument the product itself makes.

**Scope changes update the requirement doc first, then the ticket.** The docs are the contract
with the architect; drifting tickets away from them silently is how handoffs fail.

## Open questions

Nineteen tracked in [04-open-questions.md](docs/product/04-open-questions.md), each with a working
assumption. **Silence is an answer** — unchallenged assumptions get built. Still blocking M0:

- **Q-01** warehouse of record and dialect tiers ([working paper](docs/product/06-dialect-strategy.md))
- **Q-04** team size and timeline
- The OPEN integration rows in [07-domain-model.md §4](docs/product/07-domain-model.md)

## Style

Prose in docs, not bullet soup. State the reasoning, not just the conclusion. Where something is
uncertain, label it an assumption and say what would change it.
