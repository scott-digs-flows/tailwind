# Tailwind — Product Definition

Handoff package for the systems architect and full-stack engineer. Read in order.

| Doc | What it answers | Primary reader |
|---|---|---|
| [00-vision.md](00-vision.md) | What we're building, for whom, why it beats Tableau/Power BI/Looker, and what v1 must prove | Everyone |
| [01-requirements.md](01-requirements.md) | Numbered functional and non-functional requirements, MoSCoW-prioritized for GA | Architect, Full-stack |
| [02-architecture-brief.md](02-architecture-brief.md) | Binding constraints, the hard problems, and the ADRs to write | Architect |
| [03-roadmap.md](03-roadmap.md) | Milestones sequenced by risk retired, with cut lines | Everyone |
| [04-open-questions.md](04-open-questions.md) | What Product still owes, with working assumptions, recommendations, and decisions taken | Product |
| [05-ways-of-working.md](05-ways-of-working.md) | Ticket tracking, definitions of ready/done, cadence | Everyone |
| [06-dialect-strategy.md](06-dialect-strategy.md) | Working paper on Q-01: warehouse support tiers, conformance testing, the portability trap | Architect |
| [07-domain-model.md](07-domain-model.md) | Glossary, git-vs-database state ownership, the promotion loop as a state machine, integration inventory | Architect, Full-stack |
| **[08-poc-scope.md](08-poc-scope.md)** | **What to deliberately not build, what stays despite looking like GA work, and the triggers that end each deferral** | **Architect — read early** |
| [09-git-integration-setup.md](09-git-integration-setup.md) | Runbook for the GitHub App that brokers PRs on an author's behalf | Product (setup), Full-stack |

Backlog lives in [`TICKETS.csv`](../../TICKETS.csv) at the repo root — 114 seeded tickets across 12
epics and 5 milestones (81 POC, 33 GA). Every requirement prioritized `Must` or `Should` has at
least one ticket; traceability is verified mechanically.

## The 60-second version

Analytics-as-code with an AI authoring surface. Business users describe what they want in plain
language; the AI composes it **only** out of a governed semantic layer; the data team approves it
through a pull request where CI has already rendered the dashboard, diffed the metric, and
estimated the cost. Self-service and a single source of truth stop being a tradeoff.

## Status

Draft v0.3 — **POC-first.** M0–M2 tests one hypothesis; GA concerns begin at M3.

**Decided 2026-08-10**
- Adopt an existing semantic engine (Q-02) — **which one is now answered**:
  [ADR-003](../adr/ADR-003-semantic-engine-selection.md) selects **Cube Core** behind a Tailwind
  compiler façade — **Accepted**, ratified by Product. Apache-2.0 open source only, no Cloud or
  premium tier (D1a). No fork is required for FR-SEM-06/07.
- dbt owns transformation but **not** metrics (Q-11, Q-02) — ADR-003's assumption holds, and the
  dbt manifest becomes a bootstrap source for documentation and the freshness signal.
- Internal-first, carry a tenant ID from day one (Q-03) — *partly in tension with Q-05; see
  [08-poc-scope.md §6](08-poc-scope.md)*
- Deployment/residency/AI-egress deferred, POC first (Q-05) → [08-poc-scope.md](08-poc-scope.md)
- The app brokers PRs; authors need no git account (Q-06) →
  [09-git-integration-setup.md](09-git-integration-setup.md)
- Coexist with legacy BI, migrate by real usage (Q-08)
- Freshness is tiered — ~30 min standard, near-live operational (Q-19) → new `FR-FRESH-*` group

**Still blocking M0 kickoff**
- **Q-01** — warehouse of record and dialect tiers. The architect has responded in
  [06-dialect-strategy.md §11](06-dialect-strategy.md); what remains is Product's answer on where
  the pilot data and the legacy BI content actually live, and whether any warehouse outside
  `engines.yaml` is in play.
- **Q-04** — team size and timeline. Decides what M2 contains.
- **Integration inventory** — the OPEN rows in [07-domain-model.md §4](07-domain-model.md).

See [04-open-questions.md](04-open-questions.md) for all nineteen.

Prior scaffolding in this repo is treated as discarded prototype work; no technology decisions are
inherited.
