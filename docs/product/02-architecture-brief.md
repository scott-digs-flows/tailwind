# Tailwind — Architecture Brief

**Status:** Draft v0.1 · Audience: Systems Architect (primary), Full-Stack Engineer
**Purpose:** Hand off *problems and constraints*, not solutions. Technology selection is the
architect's call. Where this document names a technology, it is an illustrative sketch to be
challenged, not a decision — the exception is the small set of constraints in §2, which come from
the product definition and are binding until renegotiated with Product.

> ⚠️ **Read [08-poc-scope.md](08-poc-scope.md) first.** M0–M2 is a POC testing one hypothesis, not
> a production system on a slower schedule. This document and `01-requirements.md` describe the GA
> target; the POC scope doc is the filter over both, and it wins where they conflict. It also
> lists the seven things that look like GA concerns but are **not deferrable**, because
> retrofitting them is a rewrite.

---

## 1. System in one picture

```
                      ┌──────────────── AUTHORING / CONTROL PLANE ────────────────┐
                      │  git repo (source of truth)                                │
   Morgan ──Propose──▶│    models/*.yml  metrics/*.yml  dashboards/*.yml  tests/   │
   Sam ────push──────▶│                                                            │
                      │  CI: validate → compile → assert → render → metric-diff    │
                      │  Review: CODEOWNERS routing, human approval                │
                      └──────────────────────────┬─────────────────────────────────┘
                                                 │ merge → publish
                                                 ▼
                      ┌──────────────── SERVING PLANE (stateless, scaled) ─────────┐
   Riley ────────────▶│  API/BFF  ──▶ Semantic compiler ──▶ SQL ──▶ Warehouse      │
                      │      │            ▲                                        │
                      │      │            │ artifact registry (published specs)    │
                      │      ├──▶ Result cache  ├──▶ Query governor / queue        │
                      │      └──▶ AuthZ + RLS context resolver                     │
                      └────────────────────────────────────────────────────────────┘
                                                 ▲
                      ┌──────────────── AI SERVICE (proposal-only) ────────────────┐
                      │  context builder → model provider → spec generator →       │
                      │  validate/compile → diff → (never writes shared state)     │
                      └────────────────────────────────────────────────────────────┘
```

**The load-bearing idea:** the control plane and serving plane are separated by a *publish* step.
Authoring throughput and consumption throughput scale independently, and a bad authoring action
cannot degrade consumption.

## 2. Binding constraints (from Product)

These are not negotiable without a Product conversation. Everything else is open.

1. **Git is the source of truth for artifacts.** Not a database with a git export. History,
   branching, and review are the actual mechanism, not a mirror of one.
2. **All numbers flow through the semantic compiler.** No code path — including AI, exports,
   drill-through, and scheduled delivery — emits SQL that bypasses it.
3. **The AI writes proposals, never shared state.** Its only durable output is a validated diff.
4. **RLS is enforced during server-side query construction**, derived from the requesting user's
   identity, independent of who authored the artifact. The predicate is injected into the generated
   SQL before execution: never applied in the browser, never a filter the client can drop, and never
   dependent on which authoring path produced the artifact.
   > *Wording clarified by Product, 2026-08-10.* This constraint previously said "at compile time,"
   > which collides with vendor vocabulary. In Cube's terms, `COMPILE_CONTEXT` is *compile-time* but
   > resolves **per tenant only** — it cannot express a per-user predicate, and forcing it to by
   > minting per-user app IDs is explicitly documented as not scaling. Per-user predicates go
   > through `access_policy` / `queryRewrite`, which Cube calls *query-time*. **That satisfies this
   > constraint** — it is still server-side, still in the generated SQL, still unbypassable — and it
   > is what ADR-003 D4 selects. Read "compile time" anywhere else in these docs as meaning this.
5. **Spec serialization is deterministic and lossless** across the visual editor, the CLI
   formatter, and AI generation. If diffs are noisy, the review gate is worthless.
6. **The serving tier is stateless.** Scale from 50 → 5,000 users by adding replicas.
7. **Authors do not need a git-host account.** The app brokers PRs via a service account and
   attributes authorship in the commit trailer.

## 3. The hard problems

These are where the design will succeed or fail. I want the architect's explicit position on each.

### 3.1 Git as an operational datastore
Git is excellent for review and terrible as a read path for a 500-concurrent-user app.
- How do published artifacts reach the serving plane — build-and-publish an immutable bundle per
  merge commit, or read from a git-backed cache?
- What is the rollback story, and how fast?
- Concurrent authoring: two users editing the same dashboard. Branch-per-draft, optimistic
  conflict at propose-time, or an app-level lock? What does Morgan see when it conflicts — she
  will not resolve a merge conflict.
- Repo growth: thousands of specs plus rendered artifacts. Monorepo or per-domain repos? Does
  CODEOWNERS routing survive the choice?

### 3.2 The semantic compiler
The single most valuable and most dangerous component.
- **Buy vs. build is decided: we adopt** (Q-02). ADR-003 is now a *selection* exercise. Score
  candidates on FR-SEM-01…FR-SEM-05, their **dialect support matrix**, and their extension model —
  we must add required metadata (FR-SEM-06) and certification states (FR-SEM-07) without forking.
  An engine that only supports our target warehouse at beta quality is disqualifying, not a
  workaround.
- The adopted engine's spec is a hard input to ADR-004. **Do not design the spec format before the
  engine is chosen.**
- Dialect count is open (Q-01) — see `06-dialect-strategy.md`. Working position: one *Certified*
  dialect at GA, a published support-tier model, and a dialect-parameterized conformance suite
  built in M0 so the price of dialect #2 is a number rather than an argument.
- Correctness strategy: golden-file tests per dialect, plus differential testing against a
  reference implementation.
- **Out of scope, explicitly:** single-deployment multi-engine portability (the same query provably
  running across several engines at once). Multi-*warehouse* support means different deployments
  point at different warehouses. Prior prototype work in this repo explored the former; it was a
  lab experiment and is not a requirement.

### 3.3 Caching with security correctness
The p95 target is unreachable without a high cache hit rate; RLS makes caching dangerous.
- Cache key must include the user's *security context*, or one user's cached rows leak to another.
  Naive per-user keys destroy the hit rate.
- Proposed direction to evaluate: cache at the *pre-RLS* result level where the security predicate
  is a partition of the result, and apply the filter on read; fall back to per-context keys where
  it isn't. This needs a rigorous argument, not a heuristic.
- Invalidation triggers: spec version change, upstream data freshness, TTL, manual. How is
  "upstream freshness" known — polling, warehouse metadata, or an ELT-completion webhook?

**The rigorous argument, supplied** *(added by the architect, 2026-08-10, during ADR-003)*. There
is no published formal treatment of when pre-RLS caching is sound — every vendor that does it
(Looker PDTs, AtScale security-dimension aggregates) leaves verification to the operator, and the
ones that won't risk it simply refuse to cache at all (BigQuery disables both result caching and BI
Engine acceleration on any table with a row-level access policy). So here are the conditions,
stated so ADR-008 can be held to them. A cached pre-RLS result may be filtered on read **only if
all four hold**:

1. **Expressibility.** The security predicate is expressible over columns *present in the cached
   result at its cached grain*. A predicate on `owner_id` cannot be applied to a result grouped by
   `region`.
2. **Decomposability.** Every measure in the result is additive (`SUM`, `COUNT`) or re-aggregable
   (`MIN`, `MAX`) over that partition. `COUNT(DISTINCT)`, medians and percentiles are **not**
   recoverable from partitioned pre-aggregates. Note this is the same additivity constraint as the
   fan-out problem in §3.2 — both ask whether an aggregate commutes with a partition of its input,
   so the two analyses should share a test suite.
3. **Partition, not predicate.** The security rule must induce a disjoint, covering partition of
   the cached set on a grouping key, not an arbitrary row filter.
4. **No cardinality leakage.** Totals, `COUNT(*)`, ranks or percentile positions computed pre-RLS
   must not be exposed alongside the filtered rows, or the invisible rows leak through the
   aggregate.

Where any condition fails, the cache key includes the security context and that is the end of it.
**The default is per-context keying; pre-RLS caching is an optimisation that must prove all four
conditions per query shape**, and the proof belongs in ADR-008 with a test, not in a comment.

The failure mode this guards against is not hypothetical. It is the single most repeated bug in
this product category: *something that scopes the query fails to scope the cache.* Metabase
`CVE-2025-27141` served one user's cached rows to an impersonated user; the dbt Semantic Layer
documents today that *"If metrics are pulled from the cache, we don't have the security context
applied to those tables at query time"*; Cube warns that omitting its cache-context keys leaks one
tenant's data to another, and that a pre-aggregation refreshed without a security context is built
with no RLS at all and then served to everyone. Assume we will make this mistake unless the cache
API makes it impossible to make.

### 3.3b Freshness tiering
Freshness is not uniform (Q-19): ~30 min for most content, near-live for operational dashboards.
`FR-FRESH-*` makes the class a declared, reviewed property of each artifact rather than a runtime
knob.

- The class is an **input to the cache layer**, so it must exist in the cache API's shape from the
  first version even while only `standard` is exercised. Recutting a cache API later is expensive.
- A blended cache-hit target is meaningless across classes — NFR-SCALE-03 is now stated per class,
  and the load test must report it that way.
- `operational` has no meaningful result cache, so its cost scales with users × refresh rate. On a
  consumption-priced warehouse this is the most expensive thing in the product; FR-FRESH-04 routes
  it through data-team approval with cost surfaced in CI.
- How is upstream freshness *known*? ELT completion webhook (preferred), warehouse metadata, or
  polling (FR-FRESH-05). Pick one; it constrains invalidation design.
- **Scope risk:** the near-live use case is a per-user worklist — row-level, action-oriented, not
  aggregate. It may fit the adopted semantic engine awkwardly (feed into ADR-003) and it makes RLS
  load-bearing rather than optional. Analysis in `08-poc-scope.md §7`; recommendation is to defer
  `operational` past the POC while keeping it expressible.

### 3.4 AI reliability and cost at scale
- Context assembly is the real engineering problem, not prompting. With a large semantic layer,
  what gets retrieved and how? (Retrieval over model/metric descriptions, usage-frequency
  weighting, recent-dashboard few-shots.)
- Structured output: the AI must emit specs conforming to the JSON Schema. Constrained generation
  vs. generate-validate-repair loop, with bounded retries.
- Latency: a 30 s dashboard proposal needs streaming and visible progress, which shapes the API
  (SSE/WebSocket) and the whole front-end state model. Decide this early — it is expensive to
  retrofit.
- Cost control: per-user budgets, caching of context, and a policy for which model tier handles
  which task (cheap model for classification/routing, strong model for spec generation).
- **Prompt injection through data.** A dimension value can contain adversarial text. The AI's
  data-facing surfaces must treat warehouse content as untrusted input.

### 3.5 Rendering dashboards headlessly in CI
FR-GOV-04/05 require CI to render real dashboards against real data.
- CI needs warehouse credentials and network access to production-like data — a meaningful
  security boundary decision.
- Rendering approach (headless browser vs. server-side chart rendering), runtime budget, and
  flakiness tolerance. This must be fast enough that Sam's review isn't gated on a 15-minute job.

### 3.6 Front end
- The WYSIWYG editor with lossless round-trip to canonical YAML is the hardest UI in the product.
  The editor's internal state model *is* the spec — treat the spec as the document model rather
  than syncing two representations.
- Chart library selection is a long-lived decision: it must cover FR-VIZ-03, support
  cross-filtering and drill interactions, render server-side for CI/PDF, and meet accessibility
  requirements (NFR-A11Y-01). Evaluate against all four, not just the chart gallery.
- Consumption and authoring have very different performance profiles. Consider whether they are
  the same bundle.

### 3.7 Multi-tenancy — **decided: tenant ID from day one**
Q-03 resolved: internal-first, but SaaS is plausible within two years, so tenancy is threaded
through the data model from M0 rather than retrofitted.

**In scope now:** tenant is a first-class scope in the artifact registry, cache keys, connection
management, RLS context, audit log, and the git layout.

**Not in scope for v1:** per-tenant branding, billing, signup, or tenant-facing admin. Isolation
only.

The failure mode to design against is *decorative* tenancy — a tenant column that exists but is
never exercised, so single-tenant assumptions accumulate underneath it and the eventual second
tenant is still a rewrite. Two countermeasures:
- **Seed a second tenant in every non-prod environment from M0.** If two tenants never coexist in a
  running system, the tax buys nothing.
- **Make "what happens with two tenants?" a mandatory question in every cache-key and RLS design
  review.** These are the two layers where cross-tenant leakage would actually occur.

> ⚠️ **Both countermeasures are NFR-TEN-02, and `08-poc-scope.md §6` recommends deferring them past
> the POC** — keeping `tenant_id` threaded through (the cheap 80%) and dropping the ceremony (the
> expensive 20%). That recommendation is awaiting Product's confirmation. Until it is confirmed,
> read this paragraph as the GA target and `08-poc-scope.md §6` as the POC filter, per the rule in
> the callout at the top of this document. *(Contradiction flagged by the architect, 2026-08-10.)*

## 4. Decisions to record as ADRs

Numbered so tickets can reference them. Each needs a written ADR before the corresponding milestone
starts.

| ADR | Decision | Needed by |
|---|---|---|
| ADR-001 | Deployment target and topology (K8s / managed PaaS / on-prem) | M0 |
| ADR-002 | Warehouse(s) supported at GA; dialect support tiers | M0 |
| ADR-003 | Semantic engine **selection** (adopt decided; which one is open) | M0 |
| ADR-004 | Spec format and file layout; JSON Schema strategy | M0 |
| ADR-005 | Front-end stack and chart library | M0 |
| ADR-006 | Backend language/framework and API style | M0 |
| ADR-007 | Artifact publish mechanism (git → serving plane) | M1 |
| ADR-008 | Cache topology and RLS-safe keying strategy | M1 |
| ADR-009 | Identity, group sync, and RLS attribute model | M1 |
| ADR-010 | Git host integration and PR brokering (service account, attribution, webhooks) | M2 |
| ADR-011 | AI provider, model tiering, and data-egress policy | M2 |
| ADR-012 | Context/retrieval strategy for AI grounding | M2 |
| ADR-013 | CI rendering approach and credential boundary | M3 |
| ADR-014 | Multi-tenancy model — *how*, not whether (Q-03 decided) | M0 |
| ADR-015 | Observability stack and trace propagation | M1 |

## 5. Sequencing guidance for the architect

Build the **walking skeleton end-to-end before building any layer well.** The riskiest integration
is: *browser → API → semantic compiler → warehouse → cache → chart*, plus *AI → spec → validate →
PR → CI → publish*. Get one trivial dashboard and one trivial AI-authored PR through both paths
before investing in chart variety, editor polish, or admin surfaces.

Specific traps to avoid, in priority order:

1. **Do not build the visual editor before the spec format is stable.** The editor is a projection
   of the spec; an unstable spec means rewriting the editor.
2. **Do not defer RLS.** Retrofitting security context into a compiler and cache layer is a rewrite
   of both. Design the security context in from the first query.
3. **Do not defer the cache.** Its keying strategy constrains the compiler's API surface.
4. **Do not let the AI path grow its own query execution.** The moment there are two ways to reach
   the warehouse, the governance guarantee is gone. One door.
5. **Do not scale prematurely.** Tier 1 (50 users) is a single-region, small deployment. The
   requirement is that the *architecture* permits Tier 3, not that Tier 3 is provisioned at launch.

## 6. What Product owes the architect

Tracked in `04-open-questions.md`.

**Decided:** Q-02 (adopt a semantic engine) · Q-03 (tenant ID from day one — but see the tension
flagged in `08-poc-scope.md §6`) · Q-05 (**deferred — POC first**, which reframes the project;
read `08-poc-scope.md`) · Q-06 (**yes**, the app brokers PRs; runbook in
`09-git-integration-setup.md`) · Q-08 (coexist, usage-driven migration) · Q-19 (partially —
freshness is tiered; sizing to be measured, not guessed).

**Still blocking M0 kickoff:**
- **Q-01** — warehouse of record and dialect tiers. See `06-dialect-strategy.md`; this is a
  conversation to have *with* the architect, not a prerequisite handed to them.
- **Q-04** — team size and timeline. Scoping, not architecture, but it decides what M2 contains.
- **Integration inventory** — the OPEN rows in `07-domain-model.md §4`. Secret store and
  observability standards in particular can invalidate an ADR after it's written.

Everything else can be answered in parallel with M0.
