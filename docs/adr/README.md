# Architecture Decision Records

One file per decision: `ADR-NNN-kebab-case-title.md`, from [TEMPLATE.md](TEMPLATE.md).

**Numbers are assigned in [02-architecture-brief.md §4](../product/02-architecture-brief.md) and
are stable.** Don't renumber, don't reuse. A decision that turns out wrong gets a new ADR marked
*Supersedes ADR-NNN*, and the old one is marked *Superseded* — the history is the point.

## Rules

1. **At least two options, honestly argued.** A one-option ADR is a note, not a decision.
2. **Record the reasoning, not just the outcome.** In a year the reasoning is the only part that
   still has value.
3. **Every ADR states a revisit trigger.** Decisions made under an open question or a planning
   assumption are provisional; say so and say what would reopen them.
4. **Write the ADR before the code it governs**, and update its ticket status when it lands.
5. **Challenge, don't work around.** If a binding constraint in
   [§2 of the architecture brief](../product/02-architecture-brief.md) makes a decision impossible,
   that's a conversation with Product — not something to design around silently.

## Status

`python3 scripts/validate_docs.py` warns for every ADR named in the brief that isn't yet written
here.

| ADR | Decision | Milestone | Status |
|---|---|---|---|
| ADR-001 | [Deployment — one VM, one Compose file, one environment](ADR-001-deployment-target-and-topology.md) | M0 | **Accepted** 2026-08-10 |
| ADR-002 | Warehouse of record; dialect support tiers | M0 | Q-01 answered: **ClickHouse**, certified by conformance (T-135/T-136). ADR to be written up. |
| ADR-003 | [Semantic engine selection — Cube Core behind a Tailwind façade](ADR-003-semantic-engine-selection.md) | M0 | **Accepted** 2026-08-10 |
| ADR-004 | [Spec format, repository layout, canonical serializer](ADR-004-spec-format-and-repository-layout.md) | M0 | **Accepted** 2026-08-10 |
| ADR-005 | [Front-end stack and chart library](ADR-005-frontend-stack-and-chart-library.md) | M0 | **Accepted** 2026-08-10 |
| ADR-006 | [Backend framework and API style](ADR-006-backend-framework-and-api-style.md) | M0 | **Accepted** 2026-08-10 |
| ADR-007 | Artifact publish mechanism | M1 | Not started |
| ADR-008 | Cache topology and RLS-safe keying | M1 | Not started |
| ADR-009 | Identity, group sync, RLS attribute model | M1 | Not started |
| ADR-010 | Git host integration and PR brokering | M2 | Not started |
| ADR-011 | AI provider, model tiering, egress policy | M2 | Not started |
| ADR-012 | Context/retrieval strategy for AI grounding | M2 | Not started |
| ADR-013 | CI rendering approach and credential boundary | M3 | Not started |
| ADR-014 | [Multi-tenancy — shared schema, tenant-scoped everything](ADR-014-multi-tenancy-model.md) | M0 | **Accepted** 2026-08-10 |
| ADR-015 | Observability stack and trace propagation | M1 | Not started |

## The M0 set is complete *(2026-08-10)*

`ADR-001`, `ADR-004`, `ADR-005`, `ADR-006` and `ADR-014` were written as **one coherent set**,
because they are interdependent in a way that makes writing them separately unsafe. The chain, so a
later reader can see what is load-bearing:

- **ADR-005** makes non-browser chart rendering a *gate* (FR-GOV-04 CI screenshots, FR-VIZ-06 PDF,
  T-129). Every library that passes it renders in **Node**.
- **ADR-004 D3** requires exactly *one* canonical spec serializer, shared by the CLI, the API, the AI
  path and the future editor — and the editor runs in a browser.
- Those two together decide **ADR-006**: TypeScript, or else two chart implementations and two
  serializers. That is why ADR-006 is not a free choice despite ADR-003 leaving the language open.
- **ADR-014** fixes the shape of the security context and the cache key that ADR-006's API and
  ADR-008's cache both depend on, and the tenant path that ADR-004's layout provides.
- **ADR-001** only has to host the result, and is deliberately the least interesting of the five.

`ADR-002` (warehouse of record) is the only M0 ADR still open, and it waits on **Q-01** from Product,
not on the architecture. Nothing above depends on it: the skeleton builds and tests against DuckDB as
the `development`-tier dialect. `ADR-008` should still wait for real volumetrics from M1
observability rather than being written against planning assumptions.

`ADR-002` (warehouse of record) *reads* as though it were circular with `ADR-003` — each doc names
the other as an input. It is not, now that ADR-003 has landed: the selected engine certifies every
`engines.yaml` candidate plus Snowflake, BigQuery and Databricks, so ADR-002 chooses freely.
Write ADR-003 first anyway, because that freedom is a result of it rather than an assumption
behind it. See [`06-dialect-strategy.md §11.6`](../product/06-dialect-strategy.md).
