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
| **[10-wizard-of-oz-protocol.md](10-wizard-of-oz-protocol.md)** | **Run-ready test of the central hypothesis with no application code** — do this first | **Product** |

Authoring a model or dashboard by hand: [`content/README.md`](../../content/README.md). These
documents record *decisions*; that one records *how to do the thing*.

Backlog lives in [`TICKETS.csv`](../../TICKETS.csv) at the repo root — 132 tickets across 12
epics and 5 milestones (99 POC, 33 GA). Every requirement prioritized `Must` or `Should` has at
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
- Internal-first, carry a tenant ID from day one (Q-03) — the tension with Q-05 is **resolved**:
  keep `tenant_id` threaded through, drop the two-tenant ceremony
  ([08-poc-scope.md §6](08-poc-scope.md)), and substitute three mechanical checks
  ([ADR-014](../adr/ADR-014-multi-tenancy-model.md) §D6).
- Deployment/residency/AI-egress deferred, POC first (Q-05) → [08-poc-scope.md](08-poc-scope.md)
- The app brokers PRs; authors need no git account (Q-06) →
  [09-git-integration-setup.md](09-git-integration-setup.md)
- Coexist with legacy BI, migrate by real usage (Q-08)
- Freshness is tiered — ~30 min standard, near-live operational (Q-19) → new `FR-FRESH-*` group
- Team and timeline (Q-04) — architect plus full-stack, a few data-team engineers splitting time,
  "a few weeks". **Tier 2 (500 named / 50 concurrent) is the sizing target; Tier 3 is speculative and
  must not be designed for.**
- **Build first, not validate first** — Product reversed the 2026-08-10 wizard-of-oz decision in
  favour of the **M0 walking skeleton** → [03-roadmap.md §Decision reversal](03-roadmap.md). The
  wizard-of-oz protocol is unscheduled, not cancelled, and the recommendation is to run it in
  parallel because it costs data-team time, not build-team time.
- **The M0 architecture set is written** — ADR-001, ADR-004, ADR-005, ADR-006 and ADR-014, written as
  one coherent set on 2026-08-10 → [docs/adr/README.md](../adr/README.md). Stack: TypeScript
  end-to-end (Fastify API, React + Vite front end), Apache ECharts with a no-browser headless render
  path, Cube Core behind the Tailwind façade, one VM running one Docker Compose file.

**Decided since**
- **Cube pinned to v1.7.x** — "an LTS line" was incompatible with multi-fact views, the chasm-trap
  mechanism that won ADR-003. See [ADR-003 §Version pin](../adr/ADR-003-semantic-engine-selection.md).
- **Q-01 answered: ClickHouse**, single dialect, `certified` by a computed conformance result —
  [ADR-002](../adr/ADR-002-warehouse-of-record-and-dialect-tiers.md). The DuckDB `development` tier
  was retired: ClickHouse runs as a container, so CI needs no cloud credentials and a second
  dialect bought nothing ([§12.2](06-dialect-strategy.md)).
- **The M0 ADR set is complete.** ADR-001, 002, 003, 004, 005, 006, 014.

**Still open, and all Product's**
- **Integration inventory** — the OPEN rows in [07-domain-model.md §4](07-domain-model.md). Secret
  store and observability standards are the two that can still invalidate an ADR.
- **T-108** the GitHub App, **T-002** pre-rollout baselines (they expire once behaviour changes),
  and the wizard-of-oz chain (T-120–T-127) if the thesis test is wanted before M2.

See [04-open-questions.md](04-open-questions.md) for all nineteen.

Prior scaffolding in this repo is treated as discarded prototype work; no technology decisions are
inherited.
