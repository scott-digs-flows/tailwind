# ADR-002 — Warehouse of record: ClickHouse, single dialect, tier computed not declared

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Product (Q-01 owner) · Systems Architect · Full-Stack
- **Milestone:** M0
- **Requirements:** FR-SEM-05, FR-SEM-12, FR-SEM-13, FR-FRESH-05, NFR-QUAL-02, NFR-OPS-02
- **Tickets:** T-004 (produces) · settles T-001 (Q-01) · evidenced by T-097, T-135, T-136 ·
  constrains T-137

## Context

This ADR was the last M0 decision left open, and it waited on Product rather than on architecture
(`docs/adr/README.md`). The working paper is
[`06-dialect-strategy.md`](../product/06-dialect-strategy.md); its central argument was that after
Q-02 (adopt an engine) we no longer *write* dialects, we **certify** them — so the cost of a dialect
is conformance testing, a live warehouse in CI forever, a cost model, RLS primitives and perf
baselines, and the count should be one at GA.

Two objections were recorded against ClickHouse before the decision, and both are retained rather
than deleted so a later reader can see what was overridden:

1. `engines.yaml`, written by this team, calls ClickHouse *"the most idiosyncratic SQL dialect
   here"* — it flattens the Iceberg namespace into the quoted table name and is case-sensitive.
   §8 criterion 3 argued that starting on an idiosyncratic dialect hides assumptions until dialect
   #2 exposes them all at once.
2. The architect's §11.6 default was **Trino** certified, ClickHouse not first, partly because Cube
   carries a known defect in **multi-fact views** — the mechanism that handles chasm traps, and the
   ×3-weighted criterion Cube won ADR-003 on.

Product chose ClickHouse anyway. The point of this ADR is that the objections were then settled by
**measurement rather than argument**, which is what T-097 exists for.

## Options considered

### Option A — Trino certified, ClickHouse later
The architect's default. Trino is Iceberg-native so freshness is not capped by a sync, and it is a
representative rather than idiosyncratic dialect, so lessons learned generalise.

**Pros.** Lower risk on the ×3 criterion; a well-behaved first dialect teaches transferable
lessons. **Cons.** It is not where the team's own analytical work points, and a pilot on a
warehouse nobody uses proves less than one on the warehouse everyone is migrating toward
(§8 criterion 2).

### Option B — ClickHouse certified, single dialect ✅
Product's choice, taken on where the data and the team's existing work actually are.

**Pros.** One warehouse, one dialect, no portability tax; it is already stood up with
AdventureWorks loaded. **Cons.** Both objections above were real and unresolved at decision time.

### Option C — ClickHouse certified, DuckDB as a `development` tier
Considered and **retired the same week**. The `development` tier existed so CI could run the
conformance suite with no warehouse credentials and no spend — an argument that assumes the
certified dialect is a *cloud* warehouse. ClickHouse runs as a container; CI starts it the way it
starts Postgres. Keeping a second dialect would have meant maintaining table-name parity forever to
buy a benefit the choice had already provided. See `06-dialect-strategy.md §12.2`.

## Decision

**ClickHouse is the warehouse of record and the only dialect. Its tier is `certified`, computed
from a conformance result on pinned versions — Cube v1.7.18, ClickHouse 26.7.3.19 — not declared.**

The tier model keeps three tiers (`certified` · `beta` · `experimental`). The fourth,
`development`, is removed: it had exactly one occupant and no longer has a reason to exist.

Tailwind does **not** run its own ClickHouse. It joins the `warehouse-net` network owned by the
`data-warehouse-local` stack and reads the Iceberg catalog attached there as `datalake`. One
warehouse, one copy of the data, nothing to drift.

### Why the objections did not bite

- **The idiosyncrasy objection did not materialise where it was expected.** ClickHouse exposes
  Iceberg tables as `datalake."raw.dim_product"` — namespace flattened into the quoted identifier —
  and Cube's `sql_table:` handled it with no special-casing. The general caution in §8 stands; it
  did not cost anything here.
- **The multi-fact objection did not appear on this topology.** The chasm cases — reseller and
  internet sales both fanning out from `dim_product`, including a three-way with a product-level
  measure — all pass. This is *absence of evidence on our model*, not proof the defect is gone; the
  conformance suite is the standing detector if it ever shows up.

## Consequences

- **Enables:** a single dialect, so no per-dialect test matrix, no cost-model abstraction pressure,
  and no portability tax on the reviewed model. ADR-002 was the last M0 blocker; 107 tickets sat
  behind Q-01.
- **Costs:** CI must run ClickHouse (T-137). Retiring the `development` tier also gives up
  **differential testing** — the same suite on two engines, disagreements as a correctness oracle.
  That is a genuine loss, accepted because T-097's negative control already covers the failure mode
  differential testing was aimed at: a mechanism that is silently not working.
- **Forecloses:** running the conformance suite without a warehouse. There is no credential-free
  path any more, and the model is not portable — `sql_table:` names tables that exist only in
  ClickHouse.
- **Revisit when:** a second warehouse appears in the estate; ClickHouse's Cube driver blocks a
  requirement; or the multi-fact defect surfaces in the conformance suite.

## Validation

Not an argument — a measurement, and it is repeatable: `./scripts/conformance.sh`.

**23/23 cases pass, and the negative control fires.** With the join cardinality deliberately
mis-declared as `one_to_one`, four trap cases fail and return numbers that look entirely plausible:

| | correct | mechanism disabled |
|---|---|---|
| order freight | 2,011,265.92 | 63,422,668.30 — 31.5× |
| order count | 3,796 | 60,855 — it counted lines |
| freight, product line `M` | 832,002.14 | 17,566,125.60 |

Expected values come from an oracle computed by querying ClickHouse **directly**, never through
Cube. The negative control is what makes the 23/23 mean anything: an earlier run passed **19/19 with
the control not firing**, because measures on dimension tables resolve to multi-fact aggregation and
never traverse the one-to-many. That run computed nothing about fan-out and would have produced a
false `certified`. T-136 added the order-header topology that makes the mechanism reachable.

**The tier is only as current as the last CI run.** Until T-137 lands, this suite runs on a
developer laptop, which means nothing prevents a model change from silently breaking fan-out
detection between commits.

## Notes

- Working paper: [`06-dialect-strategy.md`](../product/06-dialect-strategy.md), especially §11
  (architect's response), §12 (first run and its failed control), §12.1 (certification), §12.2
  (retiring the development tier).
- Q-01 record and the two overridden objections: [`04-open-questions.md`](../product/04-open-questions.md).
- The `access_policy` / `contextToGroups` findings that came out of the same integration are in
  ADR-003 §*D4 verified in a running engine*.
