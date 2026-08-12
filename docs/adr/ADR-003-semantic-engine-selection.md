# ADR-003 — Semantic engine selection: Cube Core behind a Tailwind compiler façade

- **Status:** **Accepted** — ratified by Product 2026-08-10 (see *Ratification* below)
- **Date:** 2026-08-10
- **Deciders:** Systems Architect (proposer) · Product (Q-02 owner) · Full-Stack
- **Milestone:** M0
- **Requirements:** FR-SEM-01…07, FR-SEM-11, FR-SEM-12, FR-SEM-13, FR-SEC-04, FR-SEC-05,
  FR-SEM-14, FR-FRESH-02, FR-FRESH-05, FR-DEV-01, FR-CON-02, NFR-QUAL-01, NFR-SCALE-03
- **Tickets:** T-005 (produces) · rescopes T-014, T-015, T-016, T-017, T-018, T-097 · adds T-115
  (profile lint), T-116 (access policies and default-deny) · constrains T-004, T-006, T-012, T-109

## Context

Q-02 decided on 2026-08-10 that we **adopt** a metrics engine rather than build one. This ADR is
therefore a selection, and its output is a hard input to ADR-004 (spec format) and ADR-008 (cache
topology).

It is worth being precise about what actually differs between the candidates, because the
marketing material for all of them describes the same product. Syntax is not the variable. Four
things are:

1. **What the engine does when the join graph is not a clean star.** Fan-out and chasm traps are
   where a semantic layer silently returns a wrong number, and `00-vision.md §2` names *"a confident
   chart with a wrong number"* as the failure mode the entire product is designed against. This is
   the criterion with the most spread between candidates and it is the one we weight highest.
2. **Whether a per-user security predicate is a parameter of compilation.** `08-poc-scope.md §3.1`
   makes this non-deferrable and binding constraint §2.4 makes it structural. An engine that cannot
   accept one is not a candidate.
3. **Whether we can carry our own governance metadata and certification states without forking.**
   FR-SEM-06/07. Product asked for an explicit verdict; it is in a dedicated section below.
4. **What shape of artifact a human reviews.** The whole product is a PR gate over specs. If the
   engine's spec resists byte-stable serialization (NFR-QUAL-01), the diff is noisy, the review is
   theater, and the hypothesis in `00-vision.md §7` cannot be tested.

**Constraints that bound the choice** (`02-architecture-brief.md §2`): all numbers flow through one
compiler (§2.2); RLS is enforced at compile time from the requesting user's identity, independent
of who authored the artifact (§2.4); spec serialization is deterministic and lossless (§2.5); the
serving tier is stateless (§2.6).

**POC filter** (`08-poc-scope.md`): the security context must be a first-class compiler parameter
from the first query even if permissively populated (§3.1); determinism is POC-critical, not
GA-critical (§3.2); the freshness class must exist in the spec from day one (§3.7).

### Open questions this decision runs ahead of

- **Q-01 — the warehouse of record is not chosen.** I score dialect coverage against the
  `engines.yaml` candidate set (Trino, DuckDB, ClickHouse, Postgres) plus the three warehouses most
  likely to appear later (Snowflake, BigQuery, Databricks). My position on Q-01 itself is in
  [`06-dialect-strategy.md §11`](../product/06-dialect-strategy.md).
- **Q-11 / Q-02 — "does the org run dbt?"** As posed, this question does not discriminate between
  the candidates, and I have sharpened it in `04-open-questions.md`. Running dbt as a
  *transformation* layer is close to irrelevant here: every candidate reads dbt-built tables
  perfectly well. The question that would move this decision is narrower: **does the org already
  define metrics in dbt semantic models / MetricFlow today?** If it does, the second-definition-site
  risk in Q-02 becomes real and MetricFlow's score changes materially. I assume the answer is *no*
  (a team that had already adopted MetricFlow would have said so when Q-02 was answered) and set a
  revisit trigger below.

### A landscape fact that changes how reversible this decision is

The **Open Semantic Interchange** specification reached v1.0 on 2026-01-27 and has since entered
the Apache Incubator as **Apache Ossie**. It is an Apache-2.0, YAML-based vendor-neutral spec for
datasets, metrics, dimensions, relationships and contexts, with Snowflake, dbt Labs, Databricks,
Cube, AtScale, Qlik, Lightdash and Tableau all participating. No product ships native OSI support
yet — the only working path today is the reference converters in `apache/ossie`.

This does not decide anything now, and betting the POC on an incubating spec with no shipping
implementations would be exactly the kind of novelty spend the brief warns against. But it changes
the risk profile of *any* engine choice: within a plausible horizon there will be a standard
interchange format, and an engine choice made today is more reversible than it looked a year ago.
That is a reason to (a) not agonise, and (b) shape our canonical spec so it is mechanically
convertible to OSI — an ADR-004 concern, recorded here so it is not lost.

## Selection criteria

Three **gates**. Failing one removes a candidate regardless of everything else.

| Gate | Test | Source |
|---|---|---|
| **G1 — Embeddable** | License permits embedding in a commercial hosted product, with no competing-service clause | Q-03 (SaaS plausible in two years) |
| **G2 — Security context** | A per-user row predicate can be supplied as a parameter of compilation and lands in the generated SQL, not in a post-filter | `08-poc-scope.md §3.1`, FR-SEC-04, §2.4 |
| **G3 — Programmatic** | We can compile and execute from our own service, not only via a CLI or a vendor-hosted endpoint | §2.2, FR-DEV-01 |

Seven **scored criteria**, weighted. The weights are the argument, so they are stated rather than
implied.

| # | Criterion | Weight | Why this weight |
|---|---|---|---|
| C1 | Fan-out / chasm-trap correctness (FR-SEM-05) | ×3 | The engine's only irreplaceable job. A wrong number destroys the product. |
| C2 | Metric algebra and time semantics (FR-SEM-02/03/04) | ×2 | Ratio, derived, filtered, time-offset, grain rollups, fiscal calendars. Broad but shallow spread. |
| C3 | Extension without forking (FR-SEM-06/07) | ×2 | A fork re-opens Q-02. Product asked for this explicitly. |
| C4 | Dialect matrix vs. `engines.yaml` + likely future (FR-SEM-12/13) | ×2 | `06-dialect-strategy.md §2`: we inherit the matrix, we no longer write it. Includes **"is there a zero-cost embeddable local dialect?"** — DuckDB support is what makes the conformance suite and most of the CI evidence pipeline runnable without warehouse credentials or spend (`06-dialect-strategy.md §11.5`). |
| C5 | Spec determinism and diff quality (NFR-QUAL-01, §2.5) | ×2 | The review gate is the product. |
| C6 | Freshness and cache interaction (FR-FRESH-02/05, NFR-SCALE-03) | ×1 | Matters, but ADR-008 owns the outcome and should wait for M1 data. |
| C7 | Operational cost and governance risk | ×1 | Deployment shape, maturity, vendor direction. |

## Options considered

### Option A — Cube Core, self-hosted

Apache-2.0 (root `LICENSE`: *"The default license throughout the repository is Apache License 2.0
unless the header or package LICENSE file specifies another license"*, with MIT as the alternate).
A Node + Rust service exposing REST (`/v1/load`, `/v1/sql`, `/v1/meta`), a Postgres-wire SQL API,
and GraphQL. The data model is declarative YAML (`cubes`, `views`, `measures`, `dimensions`,
`joins`, `access_policies`) with an optional JavaScript/Jinja escape hatch.

**Pros.**
- **Fan-out is resolved, not forbidden — and chasm traps are handled by a different, correct
  mechanism.** For fan-out, Cube detects the trap from the declared `many_to_one` / `one_to_many`
  relationships and generates a deduplication query per *multiplied measure*: distinct primary keys
  within the multiplied measure's cube, self-joined, aggregated, then joined back. For chasm,
  **multi-fact views** give each fact its own subquery aggregated to the shared dimensions, then
  combine with a `FULL JOIN` on the shared keys, choosing the root cube dynamically per query. That
  is aggregate-before-join — the mechanism the industry converged on in 2025–26 and the one being
  absorbed into warehouses themselves (Snowflake Semantic Views, GA 2026-03-02). It is plain
  `GROUP BY` + `FULL OUTER JOIN`, so it is portable across dialects, unlike Looker's symmetric
  aggregates, which are a per-dialect SQL trick with a hard ~14-digit DECIMAL ceiling and no chasm
  coverage at all. `Tesseract`, Cube's Rust SQL planner, reached GA in Cube Core v1.7 on 2026-07-08
  and is what multi-fact views require.
- **The security context is genuinely first-class, and — critically — it is declarative and
  reviewable.** `access_policy` blocks in the model declare `row_level` filters, `member_level`
  include/exclude, and `member_masking`, all parameterised by `securityContext` /
  `userAttributes`. `query_rewrite` composes an additional programmatic filter on top (both apply;
  row filters combine). `COMPILE_CONTEXT` can go further and change the dataset at model-compile
  time. This is the strongest fit of any candidate to §2.4 *and* to the product thesis: the RLS
  rule becomes an artifact in git, under CODEOWNERS, reviewed in the same PR as the metric it
  guards — rather than a predicate buried in our application code where no reviewer will see it.
  It also gives FR-SEC-05 (column masking) essentially for free, which was scheduled as a
  cut-line item.
- **Extension without forking is trivial.** Arbitrary `meta: {…}` on cubes, views, measures and
  dimensions, returned verbatim by `/v1/meta`. FR-SEM-06 metadata and FR-SEM-07 certification
  states are ordinary model content.
- **Best dialect coverage against our candidate set.** First-party drivers for Trino, DuckDB
  (and MotherDuck), ClickHouse and Postgres — all four `engines.yaml` engines — plus Snowflake,
  BigQuery, Databricks and Redshift.
- **Language-agnostic integration.** ADR-006 has not chosen a backend language; Cube over HTTP does
  not constrain it.
- **`/v1/sql` returns the generated SQL without executing it**, which serves FR-CON-02 ("how is this
  calculated?") and FR-DEV-01 (`compile-to-SQL`) directly.

**Cons.**
- **It is a separate stateful-capable service**, not a library. That is a deployment component in
  M0 and a network hop on every query.
- **It brings its own caching and wants to own it.** Cube's in-memory result cache is on by
  default and pre-aggregations materialise into Cube Store. Two caches with different
  security-context keying is precisely the FR-SEC-04 failure mode, and Cube Store is stateful,
  which rubs against §2.6. This must be actively suppressed, not merely ignored.
- **Tesseract is one month old as a GA default.** The legacy planner is already deprecated, and
  v1.7 shipped breaking changes including numeric serialisation. There is at least one open
  multi-fact codegen defect against ClickHouse (`cube-js/cube#10493`).
- **Multi-fact views carry real modelling constraints** that our conformance suite must pin: the
  query must be grouped by the join key, and the join-key time granularity must match the `GROUP BY`
  granularity or the subqueries are not merged.
- **RLS is fail-open by default.** Cube's documented default is that all rows are public and no
  filtering is applied unless a policy says otherwise. For a product whose entire claim is
  governance, a permissive default is the wrong default, and the mitigation is ours to build.
- **A compiler-enforced security model is only as strong as its narrowest bypass.**
  `CVE-2022-23510` was exactly this: a `/v1/sql-runner` endpoint shipped in Cube 0.31.23 let any
  authenticated client run arbitrary SQL, *"completely bypassing any row-level security logic
  implemented in the modeling layer."* Fixed in 0.31.24, but the class of bug is permanent and it is
  the same class as binding constraint §2.2's "one door".
- **The JavaScript/Jinja model path is a determinism hazard** if anyone uses it.
- Vendor-controlled OSS with a commercial cloud alongside it. Apache-2.0 today; nothing guarantees
  tomorrow.

### Option B — dbt MetricFlow

Apache-2.0 (relicensed from BSL; root `LICENSE` is plain Apache 2.0, © dbt Labs 2025), governed
increasingly through the OSI/Ossie initiative. A Python library — `metricflow` core, with
`dbt-metricflow` as the CLI wrapper — whose entry point is `MetricFlowEngine`, driven by a
`MetricFlowQueryRequest` carrying metrics, group-bys, `where` filters, order and limit. SQL
rendering is a distinct pipeline stage from execution, so SQL can be produced without running it.

**Pros.**
- **In-process.** No extra service, no network hop, no second deployment artifact. If ADR-006 picks
  Python, this is the cheapest possible integration and the easiest to unit-test.
- **Genuinely strong metric algebra**: simple, ratio, derived, cumulative, conversion and filtered
  metrics are all first-class, and custom calendars (fiscal year/quarter, 4-5-4) are supported from
  dbt Core 1.9 via additional time-spine models with per-granularity column mappings.
- **We would own caching entirely**, because MetricFlow has none. For our architecture that is a
  feature, not a gap — it removes the Option A hazard completely.
- **Strong standards position.** Apache-2.0, OSI/Ossie participation, and a stated re-open-sourcing
  after the closed-semantic-layer experiment. Trino, DuckDB and Postgres are all supported engines.
- dbt YAML is strict, schema-published, and never rewritten by the tool — good diff hygiene.

**Cons.**
- **This is the one that loses the decision: MetricFlow prevents fan-out by forbidding the join,
  not by resolving it.** Its join-resolution rules disallow every entity pairing that would
  multiply rows — `Primary→Foreign`, `Unique→Foreign` and `Foreign→Foreign` are all rejected as
  fan-out — and dimension resolution is capped at **two hops**. Multi-fact queries are handled by
  full outer joins with `COALESCE` on the shared dimensions, which is correct but only covers the
  conformed-dimension case. A genuine many-to-many through a bridge table is not something you
  model and query; it is something you pre-flatten upstream in dbt. For a product whose stated job
  is to replace Tableau and Looker — both of which resolve these topologies — this is an
  expressiveness ceiling that lands on the data team as "go add another dbt model," and it will
  land during the pilot, not after it.
- **No declarative security model.** RLS would be implemented by our façade appending `where`
  filters to the request. That satisfies G2 mechanically — the predicate does reach the generated
  SQL — but it puts the security rule in application code rather than in a reviewed artifact, which
  is a materially weaker reading of §2.4 and of the product's own governance thesis. The `where`
  filter syntax is also a templated expression language, so injecting an attribute-derived
  predicate is a string-construction surface we would have to harden ourselves — and
  `CVE-2025-48912` (SQL injection *through* an Apache Superset RLS policy expression) is the
  reminder that a string-built security predicate is an injection surface inside the security
  control itself. The upstream project's own hosted product currently documents that its cache is
  materialised with deployment credentials and *"we don't have the security context applied to
  those tables at query time"* — we would not inherit that cache, but it indicates where the
  project's attention has been.
- **It forces a dbt project on the repository.** MetricFlow's semantic manifest comes from a parsed
  dbt project: `dbt_project.yml`, `profiles.yml`, a models tree. ADR-004 and the tenant-separable
  git layout (`07-domain-model.md §2`) would be negotiating with dbt's conventions rather than
  choosing freely, and Sam's local loop acquires a dbt install and a `dbt parse` on every change.
- **No ClickHouse.** Seven supported engines: BigQuery, Snowflake, Databricks, Redshift, Postgres,
  DuckDB, Trino. That is fine against a Trino-first choice and fatal against a ClickHouse-first one.
- **Python-only** — it silently decides part of ADR-006.
- **Governance churn.** dbt Labs completed its merger with Fivetran on 2026-06-01, and dbt Core 2.0
  / the Fusion engine is mid-transition. Apache-2.0 and OSI stewardship mitigate this a lot, but
  the roadmap owner changed this year.

### Option C — Malloy (with Publisher)

MIT. A modern analytical *language* with a compiler, plus `Publisher`, an open-source semantic
model server exposing REST and MCP APIs and a React component library.

**Pros.**
- **The best fan-out story of the three, by construction rather than by repair.** Malloy's
  aggregate-locality rule ties every aggregate to the grain of the source it is defined against, so
  fan-out is a category error in the language rather than a bug the engine has to detect. Nested
  queries give genuinely superior multi-grain expressiveness.
- MIT, no competing-service clause, no vendor cloud to be starved by.
- DuckDB, Postgres, BigQuery, Snowflake and Trino/Presto connections.
- Publisher's MCP surface is a real asset for the FR-AI work later.

**Cons — and one of them is decisive.**
- **The spec is a programming language, not a data format.** NFR-QUAL-01 requires byte-stable
  parse→serialize→parse round-tripping, verified by a property test; FR-VIZ-02 requires a visual
  editor that reads and writes the same canonical artifact; FR-AI-06 requires AI output to be
  validated against a published JSON Schema (FR-SEM-11) before it is ever shown. Every one of those
  is straightforward over schema-validated YAML and a research project over a language: we would be
  writing and maintaining a canonical pretty-printer over someone else's AST, with comment and
  formatting preservation, and constrained AI generation would have no schema to constrain against.
  This is the single most expensive thing on `08-poc-scope.md`'s not-deferrable list, and Malloy
  makes us build it ourselves. **Gate G-adjacent: not a formal gate failure, but it is the reason
  Malloy loses.**
- **No first-class security context.** RLS would mean parameterising sources per request — closest
  to a fork of the three, and the furthest from §2.4.
- No ClickHouse. Smaller ecosystem; the semantic-model-server layer is much younger than the
  language.

### Option D — Warehouse-native semantic layers (Snowflake Semantic Views, Databricks Metric Views)

Define metrics in the warehouse and query them with SQL.

**Pros.** Zero engine to operate; the security model is the warehouse's, so FR-SEC-04 comes free
and correct; the definitions live next to the data.

**Cons — fails immediately.** None of the four `engines.yaml` candidates has one. It welds the
product to a single vendor, which contradicts the FR-SEM-12 tier model and the market-reach layer
in `06-dialect-strategy.md §1` outright. Definitions live in the warehouse, not in git, so binding
constraint §2.1 is violated at the root: the reviewed artifact and the executed artifact would be
different objects. Recorded so it is not re-proposed.

## Scoring

Scores are 0–5. `—` means the gate already removed the candidate.

| Criterion | W | Cube Core | MetricFlow | Malloy | Warehouse-native |
|---|---|---|---|---|---|
| **G1** embeddable licence | gate | ✅ Apache-2.0/MIT | ✅ Apache-2.0 | ✅ MIT | ✅ n/a |
| **G2** security context at compile time | gate | ✅ declarative + programmatic | ✅ programmatic only | ⚠️ by model parameterisation | ✅ warehouse-native |
| **G3** programmatic compile + execute | gate | ✅ REST/SQL API | ✅ Python library | ✅ Publisher REST | ❌ definitions live in the warehouse, not git — **violates §2.1** |
| C1 fan-out / chasm | ×3 | **5** resolves | 2 forbids | 5 by construction | — |
| C2 metric algebra & time | ×2 | 4 | **5** | 4 | — |
| C3 extension w/o fork | ×2 | **5** `meta` | 4 dbt `meta` | 3 annotations | — |
| C4 dialect matrix | ×2 | **5** all four + big three | 3 no ClickHouse | 3 no ClickHouse | — |
| C5 spec determinism | ×2 | 4 YAML, JS must be banned | **5** strict YAML | 1 language | — |
| C6 freshness / cache fit | ×1 | 3 must suppress its own cache | **5** none to fight | 4 | — |
| C7 ops cost & governance risk | ×1 | 3 extra service, young planner | 3 dbt project shape, vendor churn | 2 young server layer | — |
| **Weighted total** | /65 | **57** | 48 | 43 | — |

The result is clear but the margin is smaller than it looks, and it is driven almost entirely by
C1. **If C1 were weighted ×1 instead of ×3, MetricFlow would win, 42 to 47.** That is the honest
shape of this decision, and it is why the weight is argued rather than assumed: a semantic layer
that returns a defensible-but-wrong number is worse for this product than one that is awkward to
deploy, because the product's whole claim is that the number is right. Anyone who wants to overturn
this ADR should argue the weight, not the scores.

Note also what the scoring does *not* say. Malloy has the best correctness model of the three —
fan-out is a compile-time type error rather than something the engine has to detect and repair —
and it loses on a single criterion, C5, because its spec is a language. That is a real trade and
worth remembering if C5 ever stops being load-bearing.

## Decision

**Adopt Cube Core, self-hosted under Apache-2.0, as Tailwind's semantic engine — run as an internal
compiler/execution service behind a thin Tailwind façade, with a constrained profile of Cube's YAML
data model as the reviewed artifact in git, and with Cube's own caching disabled so that Tailwind's
result cache is the only cache.**

Five sub-decisions, each of which is load-bearing:

**D1 — Cube Core self-hosted, version-pinned, no Cube Cloud dependency.** Every feature this ADR
relies on (data access policies, `meta`, `/v1/sql`, custom granularities, calendar cubes,
Tesseract) is in Core. Cube Cloud's automatic IdP-group→policy mapping is the one convenience we
forgo; in Core we map the security context to groups ourselves, which we must do anyway to satisfy
ADR-009.

**D2 — The reviewed git artifact is Cube YAML under a "Tailwind profile", not a Tailwind format
translated to Cube.** The profile is a *lint*, not a fork:

- YAML only. **JavaScript models and Jinja templating are rejected by the validator.** They defeat
  NFR-QUAL-01, they defeat static JSON-Schema validation (FR-SEM-11), and they give AI-generated
  content a code-execution surface.
- A `meta` block with `owner`, `description`, `certification`, `last_reviewed` is required on every
  cube, view, measure and dimension (FR-SEM-06).
- `sql_table:` is preferred over `sql:`; a raw `sql:` source is allowed only in files owned by the
  data-team CODEOWNERS entry.
- Dashboards, freshness classes (FR-FRESH-01) and metric assertions (FR-SEM-08) stay in
  Tailwind-native specs — Cube has no opinion about any of them.
- **The single-definition guarantee (FR-SEM-02) is ours, not Cube's.** Cube lets a measure defined
  on a cube be surfaced through any number of views, which is the right factoring but does not by
  itself stop two differently-defined measures sharing a business name. T-102's rule is therefore:
  metric names are globally unique across the bundle, dashboards may reference views only, and
  cubes are private. `08-poc-scope.md §3.4` calls this non-deferrable, and this is the mechanism.

The alternative — invent a Tailwind semantic format and compile it down to Cube — was considered
and rejected for the POC. It buys engine-swap insurance we have partly bought already through
Apache Ossie, and it costs a translation layer, a second schema, and a permanent drift risk. More
importantly it breaks a governance property worth protecting: **the artifact a human reviews is
byte-for-byte the artifact that executes.** Interposing a generated intermediate weakens the audit
story that FR-GOV-11 rests on. We revisit this if and only if the trigger below fires.

**D3 — FR-SEM-06/07 ride in `meta`, enforced by our validator and surfaced through `/v1/meta`.** No
engine change. Certification is a metadata state plus a CI rule plus a UI badge, all of which are
ours. See the fork-risk verdict below.

**D4 — RLS is declarative first, programmatic second, default-deny, and the security context is a
required parameter of the façade's compile call.** `access_policy` blocks in the reviewed model
carry `row_level` predicates, `member_level` visibility and `member_masking`; `query_rewrite` adds
the tenant predicate and any non-declarable rule (the two compose with `AND`). Per
`08-poc-scope.md §3.1` the façade signature takes a `SecurityContext(tenant, subject, groups,
attributes)` from the first query and it is non-optional — in the POC it may resolve to a
permissive policy, but the parameter, the plumbing and the cache-key component exist from commit
one. **The same context object is a mandatory component of the ADR-008 cache key.**

Three guardrails come with this, because Cube's defaults are wrong for us:

- **Default-deny, enforced by us.** Cube's documented default is that all rows are public. The
  profile lint (D2) therefore requires an `access_policy` on every view, and `query_rewrite`
  rejects any query arriving without a resolved tenant rather than passing it through. A
  fail-open security layer in a governance product is a contradiction in terms.
- **Cube is not reachable except through the façade.** `CVE-2022-23510` is the standing lesson:
  when RLS lives in the compiler, any endpoint that reaches the warehouse without going through
  the compiler is a total bypass. Cube binds to the internal network only, the browser never holds
  a Cube JWT, and the SQL API / `sql-runner`-class surfaces stay disabled. This is the concrete,
  enforceable reading of binding constraint §2.2's "one door".
- **Two contexts, two SQL strings.** The M0 test in *Validation* below is what proves the parameter
  is real rather than decorative.

**D5 — Execution goes through Cube; caching does not.** Queries execute via `/v1/load` (Cube's own
docs warn that lifting the SQL out and running it directly bypasses post-processing). `/v1/sql`
serves FR-CON-02 transparency and FR-DEV-01 `compile-to-SQL` only. Cube's in-memory result cache
and pre-aggregations are **off** for the POC.

The rationale is not tidiness, it is the failure mode with the best-documented track record in this
product category: *something that scopes the query fails to scope the cache.* Metabase shipped it
as `CVE-2025-27141` (a cached question served to an impersonated user with the first user's rows).
The dbt Semantic Layer documents it as a current limitation in plain words — *"If metrics are
pulled from the cache, we don't have the security context applied to those tables at query time."*
Cube's own guidance is that omitting `context_to_app_id` / `context_to_orchestrator_id` leaks one
tenant's data to another, and a pre-aggregation refreshed without `scheduled_refresh_contexts` is
built with an `undefined` security context — that is, built with no RLS and then served to
everyone. Cube also has open multi-tenant pre-aggregation defects (`#9024`, `#9132`, `#8726`).
Running two caches with two different keying schemes multiplies the chances of exactly this. One
cache, ours, keyed on the security context.

Cube's `refresh_key` machinery is nonetheless the natural home for FR-FRESH-05 upstream freshness
signalling, and ADR-008 should re-open pre-aggregations deliberately once M1 telemetry exists — as
a *performance* decision made with data, not as a default we inherited. The soundness conditions
for the pre-RLS caching direction proposed in `02-architecture-brief.md §3.3` are now written down
there, and they are the argument ADR-008 has to satisfy.

**On freshness specifically (FR-FRESH).** No candidate engine has a concept of a freshness class,
and none should — it is a Tailwind governance property, declared per artifact and reviewed
(`08-poc-scope.md §3.7`). What the engine choice determines is only how the class is *implemented*:
with Cube's caching off, `batch` and `standard` differ purely in our TTL and invalidation policy,
which keeps FR-FRESH-02 entirely inside the cache API we control. The one thing Cube contributes is
`refresh_key: sql`, a natural place to hang the upstream-freshness probe for FR-FRESH-05 and
FR-CON-03's as-of timestamp — worth prototyping in M1 even though caching is otherwise off. The
`operational` class remains a poor fit for *any* aggregate-oriented semantic layer, per
`08-poc-scope.md §7`, and this ADR does not improve that; it is expressible in the spec and not
implemented.

## Fork-risk verdict on FR-SEM-06/07 — what Product asked for

**No fork is required, and this was not close for any of the three live candidates. The Q-02
decision stands.**

The reasoning matters more than the verdict, because "can it be extended" is the wrong question.
The right one is: *where does the certification state have to be enforced?* And the answer is that
it is enforced almost entirely in surfaces we own regardless of engine:

| FR-SEM-06/07 obligation | Where it is enforced | Engine involvement |
|---|---|---|
| Required `owner`, `description`, `certification`, `last_reviewed` | Our validator, in CI (T-019) | Must carry arbitrary metadata — Cube `meta`, dbt `meta`, Malloy annotations all do |
| Missing metadata fails CI | Our CI | None |
| `certified` / `draft` / `deprecated` states | Our validator + our registry | None — it is a value in `meta` |
| A deprecated metric still resolves | Engine resolves it normally; we attach the warning | None |
| Warning + suggested replacement surfaced | Our API and UI, from `/v1/meta` | Must expose the metadata over its API — Cube does, verbatim |
| Only `certified` metrics are AI-composable (FR-AI-01/02) | Our AI context builder | None |
| Certification authority (Q-12) | CODEOWNERS on the file | None |

The one genuine dependency is that the engine must **not** validate away unknown keys and **must**
return them over its metadata API. Cube's `meta` is explicitly documented as arbitrary and is
returned by `/v1/meta`. That is the whole requirement.

**Residual risk worth naming rather than dismissing:** `meta` is a bag of untyped values as far as
the engine is concerned, so nothing in Cube stops a bad value — the typing and the enforcement are
entirely ours. This is not a fork risk; it is a "we must actually build T-019 and T-020" risk, and
it is already ticketed. Two smaller ones: if Cube ever adds a first-class `certification` concept
we will have a migration, and if a future Cube release tightens YAML validation our profile lint
is what catches it — pin the version and treat a Cube upgrade as a change that must pass the
conformance suite (T-097).

**What would change the Q-02 answer.** Not this. The realistic route back to "build" is not
metadata; it is if the conformance suite (T-097) shows the engine returning wrong numbers on
topologies we need and the fix requires patching its SQL generation. That is the validation gate
below, and it is why the suite belongs in M0.

## Consequences

**Enables**
- Fan-out and chasm topologies are correct on day one without us writing a query planner — the
  single largest scope reduction available from the Q-02 decision. T-015 was an `XL`
  "join resolution and fan-out prevention" build ticket; it is now an `L` modelling-and-verification
  ticket, and T-014/T-016/T-017/T-018 shrink the same way. That backlog rewrite is part of this ADR,
  not a follow-up: as written, those tickets would have had an engineer building a second compiler
  next to the one we just adopted.
- FR-SEC-04 and FR-SEC-05 become *reviewed artifacts under CODEOWNERS* rather than application
  code. Column masking, previously cut-line #4 in `03-roadmap.md`, comes essentially for free.
- All four `engines.yaml` engines are reachable, so ADR-002 is not constrained by ADR-003 — see the
  ordering note in `06-dialect-strategy.md §11`.
- A zero-cost local dialect (DuckDB) means the conformance suite and most of the CI evidence
  pipeline can run without warehouse credentials or spend, which defuses much of the credential
  boundary problem in `02-architecture-brief.md §3.5`.
- ADR-006 stays open: Cube over HTTP does not pick our backend language.
- FR-CON-02 and FR-DEV-01 get their generated SQL from `/v1/sql` rather than from a bespoke
  explain path.

**Costs**
- One more deployment component (Cube API instance; refresh worker and Cube Store only if
  pre-aggregations are ever enabled) and one network hop per query. Real, and accepted.
- Recurring: tracking Cube releases. Tesseract is a young planner; every upgrade must pass T-097
  before it ships. Budget this as a standing chore, not a one-off.
- A profile lint (D2) that must be written and maintained — small, but it is net-new work that a
  naive "just use Cube's YAML" reading would not have predicted.
- We inherit Cube's bugs. `cube-js/cube#10493` (multi-fact codegen against ClickHouse) is a live
  example and a concrete reason not to make ClickHouse the first Certified dialect.

**Forecloses**
- **Cube's own caching, deliberately.** Pre-aggregations are a real performance tool that we are
  choosing not to use in the POC. If NFR-PERF-01 proves unreachable without them, ADR-008 must
  re-open it *with* a written RLS-keying argument, not by flipping a flag.
- **Semantic definitions that Cube cannot express.** We are inside its model. Anything outside it
  is either a Tailwind-side computation (which would breach §2.2 "one door") or a warehouse-side
  model change. This is the price of adopting, and it is the correct price.
- **A non-YAML authoring format.** D2 makes the reviewed artifact Cube YAML, so ADR-004's semantic
  half is largely written. ADR-004 retains full freedom over the dashboard spec, the repository
  layout, the tenant path scheme and the JSON Schema strategy.
- **Malloy's nested-query expressiveness.** Genuinely better for multi-grain analysis; we are
  trading it for a diffable artifact. Worth knowing what we gave up.

**Revisit when** — any one of these fires:

1. **T-097 fails on a topology we need** and the failure is in Cube's SQL generation rather than in
   our model. This is the one that would re-open Q-02 itself.
2. **Product answers "yes, we already define metrics in dbt semantic models today."** That is the
   fact that flips C1's dominance, because the second-definition-site risk in Q-02 would then
   outweigh the join-topology ceiling. Ask before M0 ends.
3. **Cube Core's licence changes**, or a feature this ADR depends on (`access_policy`, `meta` on
   `/v1/meta`, `/v1/sql`) moves behind Cube Cloud.
4. **Apache Ossie graduates incubation and Cube ships native OSI import/export.** At that point
   revisit D2: the canonical artifact could become OSI with Cube as a pure execution target, which
   would restore engine-swap freedom at a much lower cost than it carries today.
5. **The `operational` freshness class is requested** (`08-poc-scope.md §7`). Row-level worklists
   are a poor fit for any aggregate-oriented semantic layer; that conversation is an ADR-003
   amendment, not just an ADR-008 one.
6. **Tier-2 load testing (T-086) shows NFR-PERF-01 is unreachable** without pre-aggregations —
   re-opens D5 and feeds T-100.

## Validation

The conformance suite is the instrument. `T-097` is repointed by this ADR: its first job is not
pricing dialect #2, it is **acceptance-testing the engine we just adopted, before ADR-004 hardens
the spec around it.**

M0 exit gates, all mechanical:

1. **Correctness.** A seeded dataset (AdventureWorks DW from `engines.yaml`, already loaded on four
   engines) with expected values for: a simple additive measure; a `count_distinct`; a ratio; a
   filtered measure; a derived metric; a YoY and a period-to-date comparison — each at day, week,
   month, quarter, year and one fiscal grain. Every one of them across four join topologies: single
   fact; fact + conformed dimension; **two facts on a shared dimension (chasm)**; **fact + bridge +
   dimension (fan-out)**. Cube's generated SQL must return the expected value, and the fan-out and
   chasm cases must be *demonstrably wrong* if the declared relationships are removed — a test that
   passes when the mechanism is disabled is not testing the mechanism.
2. **Determinism.** `parse → serialize → parse` is a fixed point over generated model YAML
   (NFR-QUAL-01, T-013), and the profile lint rejects a JavaScript model and a missing `meta` block.
   The multi-fact cases must also pin Cube's documented constraints: the query is grouped by the
   join key, and the join-key time granularity matches the `GROUP BY` granularity. A test that
   only exercises the happy grain will not catch a regression in the merge logic.
3. **Security context, and default-deny.** A compile call with two different security contexts
   produces two different SQL strings with different predicates; identical semantic queries under
   different contexts produce different cache keys; and a query arriving with **no** resolved
   tenant is rejected rather than served. This test exists in M0 even though the POC's policy is
   permissive — its job is to prove the parameter is load-bearing, not that the policy is strict.
4. **Differential.** The same suite passes on DuckDB and Postgres with matching results. This is a
   correctness oracle, **not** the single-deployment portability that `06-dialect-strategy.md §6`
   rules out — the distinction is worth stating because someone will conflate them.
5. **Metadata round-trip.** A `certification: deprecated` value set in the model YAML reaches the
   API through `/v1/meta` and renders as a badge, with no engine patch in the tree. This is the
   mechanical proof of the fork-risk verdict.

If (1) or (3) fails and cannot be fixed by modelling, this ADR is wrong and Q-02 is back open.

## Notes

Primary sources consulted 2026-08-10.

- Cube licence — <https://raw.githubusercontent.com/cube-js/cube/master/LICENSE>
- Cube joins / fan and chasm trap deduplication — <https://docs.cube.dev/reference/data-modeling/joins>
- Cube data access policies (row level, member level, masking; Core vs Cloud note) —
  <https://docs.cube.dev/docs/data-modeling/data-access-policies>
- Cube security context, `query_rewrite`, `COMPILE_CONTEXT`, `context_to_app_id` —
  <https://cube.dev/docs/product/auth/context>, <https://cube.dev/docs/product/configuration/multitenancy>
- Cube `/v1/sql` (generated SQL without execution) —
  <https://docs.cube.dev/reference/core-data-apis/rest-api/reference>
- Cube custom granularities and calendar cubes —
  <https://cube.dev/blog/introducing-custom-time-dimension-granularities>,
  <https://docs.cube.dev/docs/data-modeling/concepts/calendar-cubes>
- Tesseract GA, Cube Core v1.7, 2026-07-08 —
  <https://cube.dev/blog/cube-core-v1-7-tesseract-ga-data-modeling-performance>
- Cube multi-fact views (per-fact subquery + `FULL JOIN`, documented constraints) —
  <https://docs.cube.dev/docs/data-modeling/multi-fact-views>
- Cube ClickHouse multi-fact defect — <https://github.com/cube-js/cube/issues/10493>
- Cube RLS fail-open default — <https://docs.cube.dev/docs/data-modeling/access-control/row-level-security>
- Cube multi-tenancy cache-key warning (`context_to_app_id`, `context_to_orchestrator_id`,
  `scheduled_refresh_contexts`) — <https://docs.cube.dev/embedding/multitenancy>
- `CVE-2022-23510` Cube `/v1/sql-runner` RLS bypass —
  <https://github.com/cube-js/cube/security/advisories/GHSA-6jqm-3c9g-pch7>
- `CVE-2025-27141` Metabase cached results served to an impersonated user —
  <https://github.com/metabase/metabase/security/advisories/GHSA-6cc4-h534-xh5p>
- `CVE-2025-48912` Apache Superset RLS-expression SQL injection —
  <https://github.com/advisories/GHSA-8w7f-8pr9-xgwj>
- dbt Semantic Layer cache and security context —
  <https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-cache>
- Snowflake Semantic Views rationale (fan/chasm worked examples) —
  <https://www.snowflake.com/en/blog/engineering/why-we-need-semantic-views/>
- Looker symmetric aggregates (the mechanism we are *not* relying on, and why) —
  <https://docs.cloud.google.com/looker/docs/best-practices/understanding-symmetric-aggregates>
- Malloy aggregate locality — <https://docs.malloydata.dev/documentation/language/aggregates>
- MetricFlow licence — <https://raw.githubusercontent.com/dbt-labs/metricflow/main/LICENSE>
- MetricFlow join resolution, entity-type matrix, two-hop limit —
  <https://docs.getdbt.com/docs/build/join-logic>
- MetricFlow custom calendars / time spine — <https://docs.getdbt.com/docs/build/metricflow-time-spine>
- MetricFlow architecture and `MetricFlowEngine` — <https://deepwiki.com/dbt-labs/metricflow>
- Fivetran + dbt Labs merger completed 2026-06-01 —
  <https://www.fivetran.com/press/fivetran-dbt-labs-complete-merger-to-create-the-data-infrastructure-for-trusted-ai-agents>
- Malloy — <https://github.com/malloydata/malloy>, <https://github.com/malloydata/publisher>
- Open Semantic Interchange / Apache Ossie — <https://open-semantic-interchange.org/updates/>,
  <https://ossie.apache.org/updates/>, <https://cube.dev/blog/cube-joins-snowflakes-open-semantic-interchange-launch-initiative>

**Due diligence still outstanding before this ADR moves to Accepted:** confirm no per-package
restrictive licence anywhere in the `cube-js/cube` tree (the root `LICENSE` permits per-package
overrides), and confirm `access_policy` behaviour under Cube Core specifically rather than Cube
Cloud, by running it. Both are hours of work, not days, and both belong to T-005's tail.

---

## Addendum — wider candidate survey (added by Product, 2026-08-10)

Three background research agents spawned during this ADR completed after it was written. Their
findings **do not change the decision** — recorded here because an ADR that surveyed four
candidates when ten were available is weaker than one that surveyed ten and rejected six.

### Due-diligence item 1 is now CLOSED

All **58 LICENSE files** in the `cube-js/cube` tree were enumerated and classified: **48
Apache-2.0, 10 MIT** (all MIT are `cubejs-client-*` browser SDKs and test packages). Zero hits for
`commons clause`, `business source`, `BSL`, `SSPL`, `competing`, or `non-production` across every
file. `rust/cubesql/cubesql/LICENSE` is byte-identical to canonical Apache 2.0. GitHub's API
reporting `NOASSERTION` is an artifact of the root file's dual-licence preamble, not a restriction.

**Item 2 (confirm `access_policy` under Core rather than Cloud, by running it) remains open** and
still gates Proposed → Accepted. One clarification that narrows it: Cube's own docs place data
model `access_policy` — row-level *and* member-level — in **Core since v1.2 (Feb 2025)**. The
"RBAC is Cloud-only" line on the pricing page refers to *workspace* RBAC (who logs into the Cloud
UI), which is a different feature. Verify by execution anyway.

### Six candidates not considered in the main body, and why each loses

| Candidate | Licence | Why it loses |
|---|---|---|
| **boring-semantic-layer** | MIT | The most interesting miss. 7/7 dialects, offline `.sql(dialect=)`, free-form `metadata:`, and fan-out proven numerically — it detects a mis-declared `join_one`, upgrades it to `join_many`, and **fails safe**. Loses on: **no RLS construct at all** (disqualifying under FR-SEM-14/15), 14 months old, pre-1.0, and v0.3.x is actively churning correctness fixes in the fan-out path — the exact area we would depend on. Revisit in a year. |
| **Zenlytic `metrics_layer`** | Apache-2.0 | Symmetric aggregates, but **not on Trino or Databricks** — and Trino is §11.6's recommended first dialect. No ClickHouse. Bus factor ≈ 1. |
| **Rill `runtime/metricsview`** | Apache-2.0 | Cleanest RLS seam of anything surveyed (a 3-method Go interface). But metrics views bind to **exactly one table — no join graph, so no fan-out handling at all**, and no Trino. Two disqualifications. |
| **Lightdash** | MIT core + proprietary `ee/` | Genuine dedup-CTE fan-out handling and 7/7 dialects. But the MetricQuery→SQL stage is in a `private: true` package, and **embedding plus service accounts are EE-licensed** — precisely the two things a multi-tenant sidecar needs. |
| **wren-core** (Canner) | Apache-2.0 | True in-process Rust/Python/WASM. But fan-out behaviour is **undocumented and unverified**, RLS appears to be commercial-tier, and it is SQL-in→SQL-out rather than metric-request-in→SQL-out. |
| **AtScale SML** | Apache-2.0 | The spec and SDK are open; **there is no open-source SML→SQL compiler**. Apache-2.0 buys a parser, not an engine. |

### Three findings that strengthen the decision

1. **Cube has a formal LTS programme** — v1.6.70 and v1.4.4 both patched 2026-07-28, twelve months
   of fixes per line. Directly material to **D1** (self-hosted, version-pinned): pinning does not
   mean going unpatched. Pin to an LTS line, not an arbitrary release.
2. **Only three engines surveyed cover all seven candidate dialects** — Cube, Lightdash, and
   boring-semantic-layer. Cube is the only one of the three that is fully Apache-2.0 with no
   commercial gating on the features we need, and mature. ClickHouse is the most commonly missing
   dialect (absent from Malloy, MetricFlow, and `metrics_layer`); Trino is second.
3. **Fiscal calendars are rare.** Only Cube (4-5-4 calendar cubes) and `metrics_layer` have real
   support; Malloy, MetricFlow, Lightdash, and BSL have none. **FR-SEM-04 requires them**, and the
   main body underweighted this as a differentiator.

### Two risks to carry forward

- **Façade design (D2/D5):** dialect `Query` classes for Snowflake, BigQuery, ClickHouse,
  Databricks, Redshift and Trino were **moved out of `@cubejs-backend/schema-compiler` into the
  driver packages**. A pure-library embed therefore depends on driver packages too. Feed into
  ADR-004 and the façade's dependency surface.
- **Runner-up concentration risk:** Fivetran now owns **both** dbt Labs (MetricFlow, merger
  completed 2026-06-01) and Tobiko Data (SQLMesh/SQLGlot, 2025-09-03). If ADR-003 is ever revisited
  toward MetricFlow, that is single-vendor concentration across the metrics engine and the
  transpiler simultaneously. Compounding: dbt 2.0 rebuilds dbt Core on the Rust Fusion engine, and
  Python MetricFlow's fate under it is unconfirmed.

### Provenance of this addendum

Every load-bearing claim above was verified by **direct fetch** — LICENSE files, source trees,
npm/PyPI registries, OpenAPI and proto definitions — rather than from search snippets or recall.
The licence enumeration, the LTS release dates, and the dialect coverage were checked against live
artifacts. Corporate facts cited (the Fivetran/dbt Labs merger, the Tobiko acquisition) come from
the companies' own announcements.

Soft or unconfirmed items were deliberately **excluded** from the table above rather than
laundered into it — funding totals and headcount figures for the rejected candidates rested on
aggregators and are not reproduced here. The one unconfirmed fact that bears on a rejection is
noted inline: **wren-core's fan-out behaviour is undocumented**, so it is rejected as *unverified*
rather than as *known-inadequate*. If it is ever reconsidered, that is the single experiment that
decides it.

### Update from the MetricFlow deep-dive (Product, 2026-08-10)

The last orphaned agent reported after the addendum above was written. **The decision still holds
— it turns on fan-out, and nothing here touches that.** But it corrects one rejection rationale and
adds two costs this ADR should own rather than discover in M0.

**1. MetricFlow's "#1 unknown" is largely resolved — in MetricFlow's favour.**
The main body and the wider survey both flagged *"can MetricFlow be driven without a dbt parse?"* as
the spike that would decide it. Answer: **largely yes.** The repo now ships a `sidecar/` — MetricFlow
compiled to a standalone native binary by Nuitka, speaking NDJSON over stdin/stdout, whose *only*
job is to compile metric queries to SQL without executing them (it wraps `MetricFlowEngine.explain()`).
`sql_engine` is a **per-call** parameter, so one process serves all eight dialects, and
`manifest_path` can point at a plain directory of semantic YAML — no dbt project, no `profiles.yml`,
no adapter, no warehouse connection. The core `metricflow` package has no dbt-core dependency.

**This makes the rejection cleaner, not weaker.** MetricFlow is rejected on **fan-out
expressiveness and missing ClickHouse**, not on integration friction. Anyone revisiting should
argue the ×3 fan-out weight — as the main body already says. Caveat to carry: the sidecar exists to
serve dbt Fusion, so `mf-ipc v1` is an internal contract with no published schema.

**2. Two costs of Cube this ADR under-states.**

- **Deployment shape.** Cube Core is a distributed system — API instances plus refresh worker plus
  Cube Store — not a library. The `/v1/sql` endpoint gives us generation-without-execution, but we
  would be operating much of that system purely to reach it. The in-process path
  (`@cubejs-backend/schema-compiler`) exists but is `@private`-tagged with no docs contract, and its
  dialect classes now live in the driver packages. MetricFlow's sidecar is genuinely lighter here.
  This is a real trade the ADR accepts; it should be named.
- **D5 disables a core feature of the thing we chose.** Turning Cube's caching off so Tailwind's
  cache is the only cache is correct — two caches with independent invalidation is how stale numbers
  get served — but caching *is* Cube's product. We are adopting a caching engine and switching the
  caching off. MetricFlow OSS has no cache to fight.

**3. New open question for ADR-001/ADR-008 — is Cube Store required with pre-aggregations off?**
If yes, we deploy a distributed component we have deliberately disabled, and OSS Cube Store has
**no node replication** — its own docs state that any node going down causes a complete cluster
outage, which collides with NFR-AVAIL-01. If no, that constraint largely evaporates and D5 gets
cheaper. **This is the highest-value unknown remaining on this ADR.** Tracked as **T-118**.

**4. Recommendation for ADR-004 — shape the Tailwind profile toward Apache Ossie.**
Ossie (ASF-incubating, Apache-2.0) is the emerging interchange spec for semantic models, with a
strict JSON Schema and a sanctioned `custom_extensions[]` vendor hook. It is **DRAFT (`0.2.0.dev0`)
and cannot be a contract today** — do not build on it. But shaping D2's profile to be *Ossie-ish*
costs almost nothing now and is cheap insurance against ever needing to move off Cube. Snowflake
already ingests it natively.

**5. Counterweight on the "Cube Core is being starved" worry.** dbt Labs moved MetricFlow *from* BSL
*to* Apache 2.0 in Oct 2025 — giving away more, explicitly to align with Ossie. That is a genuine
point in the runner-up's favour and should be weighed against Cube's Core-vs-Cloud gating if this
ADR is ever revisited.

---

## Ratification (Product, 2026-08-10)

**Cube Core is confirmed. The selection is closed.**

The assumption this ADR carried as its explicit revisit trigger has been answered: the org **uses
dbt for transformations but does not use MetricFlow** — no metrics are defined in dbt semantic
models today. The second-definition-site risk that would have broken FR-SEM-02 at the boundary
therefore does not exist, and the runner-up's strongest situational advantage — "you already own
the definitions" — does not apply.

The revisit trigger is not retired, only re-aimed: **if the org later adopts dbt semantic models /
MetricFlow metrics, reopen this ADR.** At that point there would be two definition sites, and
FR-SEM-02 is the constraint the whole product rests on.

### Status moved to Accepted with two checks outstanding — deliberately

Two verification items remain (§*Notes*, plus **T-118**). They are moved to follow-ups rather than
gates, because **neither failure mode reopens the selection** — each changes the design, and the
fallback is already known:

| Check | If it fails | Consequence |
|---|---|---|
| `access_policy` behaves under Core as documented (not Cloud-gated) | Fall back to `queryRewrite` for row filters | D4 loses declarative, git-reviewed RLS — a real loss against constraint §2.4, but the predicate is still server-side and unbypassable. FR-SEC-05 masking may revert to cut-line status. |
| **T-118** — Cube Store required with pre-aggregations off? ✅ **answered, see below** | — | **No, provided `CUBEJS_CACHE_AND_QUEUE_DRIVER=memory` is set explicitly.** The cost landed somewhere unexpected: that driver is per-process, so **Cube cannot be replicated without Cube Store**. NFR-AVAIL-01 and Cube's horizontal scaling are now the same M3 problem. Does not affect the POC. |

Holding the ADR at Proposed would have blocked ADR-004, which is on the critical path and needs the
engine's spec format as an input. Both checks are hours of work; run them in M0 and record the
outcome here.

### Two consequences of "dbt owns transformation" worth acting on

Confirming Q-11 does more than close a question — it hands the project two pieces of leverage that
were not in the plan:

1. **The pilot documentation backfill (T-093) may be largely bootstrappable.** dbt's `manifest.json`
   already carries model and column descriptions, tests, and ownership metadata. Generating a first
   draft of Cube cubes and `meta` blocks from it is far cheaper than authoring from scratch, and it
   directly improves AI grounding quality (FR-AI-05) — the assistant is only as good as the
   descriptions it reads. Promotes **FR-DEV-06** from `Could` with no ticket to real leverage. New
   ticket **T-119**.
2. **FR-FRESH-05 has an obvious signal source.** "How do we know upstream data is fresh?" was left
   open across three documents. The answer is **dbt run completion** — the ELT webhook the design
   already prefers over polling. T-111 updated to name it.

---

## D1a — Cube Core only. No Cloud, no premium tier, ever. (Product, 2026-08-10)

**Confirmed by Product: we use the fully open-source Apache-2.0 Cube Core and take no dependency on
any Cloud or premium feature.** This amplifies D1 from a deployment choice into a standing
constraint.

### The good news: almost nothing we need is gated

The features Cube reserves for Cloud are, with striking consistency, **the ones Tailwind is
deliberately building itself**:

| Cloud-gated | Why it doesn't bite us |
|---|---|
| Git integration, Semantic Layer Sync, Visual Modeler, Workspace IDE | This is our product. We would not use Cube's even if it were free — the git flow *is* Tailwind. |
| AI API, MCP server (Premium+), Analytics Chat, agents, NL querying | We build our own AI layer against our own semantic context. Not a substitute. |
| Workspace RBAC, SSO/SAML, Audit Log, Query History | These govern the *Cube Cloud UI*, which we do not deploy. Our SSO, audit and observability are FR-SEC-01/07 and ADR-015. |
| Performance Insights, SQL Runner, warm-up, blue-green, auto-scaling, multi-cluster | Deployment conveniences. We run our own infrastructure per ADR-001. |
| MS Fabric / SingleStore / Elasticsearch drivers, Excel & Sheets connectors | Every dialect in the `engines.yaml` candidate set — Trino, DuckDB, ClickHouse, Postgres — is Core. |

**Critically, the one feature we genuinely depend on is Core:** data-model `access_policy` —
row-level *and* member-level security — has been in Cube Core since **v1.2 (Feb 2025)**. The
"RBAC is Cloud-only" line on Cube's pricing page refers to workspace RBAC, a different feature.
D4 is safe on the free tier. *(Still verify by running it — see Ratification.)*

### Two places where "free tier" could bite

1. **Cube Store high availability is Cloud-only, and this is the real one.** OSS Cube Store has
   **no node replication** — Cube's own docs state that any node going down causes a complete
   cluster outage, and recommend Cloud if HA is required. Against NFR-AVAIL-01 (99.9%) that is a
   direct upsell path. **This is exactly why T-118 matters:** if Cube Store is not required with
   pre-aggregations disabled (D5), the concern evaporates entirely. If it is required, we have a GA
   availability problem whose vendor-supplied answer is "buy Cloud" — and we would need our own.
   T-118 is now the highest-value spike in M0 for this reason as much as any other.
2. **SSL on the SQL API is Cloud-gated.** Does not affect us — D5 uses `/v1/load`, not the SQL API,
   and TLS terminates at our own ingress. Recorded so nobody adopts the SQL API without noticing.

### The standing rule

> **No Cloud-gated Cube feature may become load-bearing.** If a design needs one, that is a signal
> to build it in Tailwind or to reconsider the engine — never to upgrade the tier.

The failure mode this guards against is gradual, not sudden: someone reaches for one convenient
gated feature, and two years later self-hosting is no longer possible. Enforced as a review
question in the profile lint's scope (**T-115**) and checked explicitly at the M0 exit.

---

## T-118 answered, plus three corrections to this ADR (Architect, 2026-08-10)

Verified against Cube's documentation, its environment-variable reference and its source tree. The
one thing not done is running it, so the *behaviour* is documented-and-source-confirmed rather than
observed; the residual checks are named at the end. T-118 was the highest-value unknown on this ADR,
and the answer is useful — but the same investigation turned up three things this ADR had wrong or
understated, and those matter more.

### T-118 — Cube Store is **not** required, conditionally, and the condition is a one-line config

`CUBEJS_CACHE_AND_QUEUE_DRIVER` takes exactly two values, `cubestore` or `memory`. It defaults to
`memory` in dev mode and **`cubestore` in production**. With the default left alone and no
`CUBEJS_CUBESTORE_HOST` set, the process boots and `/v1/meta` and `/v1/sql` answer normally — those
paths touch only the compiler — and then **`/v1/load` throws at query time**, not at startup, with
*"Cube Store was specified as queue/cache driver. Please set CUBEJS_CUBESTORE_HOST…"*. Startup emits
only a non-fatal warning, and `/readyz` and `/livez` pass. That is a nasty shape: a deployment can
look healthy and fail on the first real query.

**So: set `CUBEJS_CACHE_AND_QUEUE_DRIVER=memory` explicitly and Cube Store is not deployed.** Both
the cache and the query queue then live in-process. No refresh worker either — its documented job is
*"updates pre-aggregations and invalidates the in-memory cache in the background"*, and with no
pre-aggregations there is nothing to build; the only cost of omitting it is that refresh-key checks
happen inline on the request path. And **no Redis**: Cube removed Redis in v0.32.0 and replaced it
with Cube Store, so a stray `CUBEJS_REDIS_URL` in the environment now **hard-errors** rather than
being ignored.

Cube's own guidance is deliberately more conservative — *"In production, Cube Store must run as a
separate process"* and *"there're multiple parts of Cube which require Cube Store in production
mode. Replicating Cube instances without Cube Store can lead to source database degraded
performance, various race conditions and cached data inconsistencies."* Read carefully, **the real
constraint in that warning is replication**: the `memory` driver is per-process, so N Cube replicas
get N uncoordinated caches and queues.

**That is the finding that actually matters for ADR-001, and it is the opposite of what this ADR
assumed.** D5 said Cube's caching was off, which implied Cube was as freely replicable as the rest of
the serving tier. It is not:

> **A single Cube instance is fine and Cube Store is unnecessary. The moment Cube needs a second
> replica, Cube Store becomes required — and OSS Cube Store has no node replication.** So Cube's
> horizontal scaling and its availability story are the same problem, and D1a forbids the vendor's
> answer to it.

At Tier 2 (~50 concurrent, ≥85% hit rate in *our* cache in front of Cube) one Cube instance is
plausible, so this is a GA problem rather than a POC one. But it is a real constraint on
`02-architecture-brief.md §2.6`, it belongs in ADR-001's growth path, and it should be load-tested
before anyone assumes otherwise.

### Correction 1 — D5's "caching off" is not achievable as written, and the replacement flag changed

Cube's docs are explicit: *"There's no straightforward way to disable caching in Cube. The reason is
that Cube not only stores cached values but also uses the cache as a point of synchronization and
coordination between nodes in a cluster."* `CUBEJS_CACHE_AND_QUEUE_DRIVER=memory` **does not disable
the cache** — it relocates it into the Node process. There is no TTL-to-zero setting; entry TTL is
hardcoded at 24 h and freshness is governed by `refresh_key`, whose documented floor is one minute.
There is also a second, undocumented in-process LRU with a hard five-minute ceiling.

**And `renewQuery` — the flag this ADR would have reached for — was removed in v1.7.0.** Its
replacement is a per-request `cache` field on `/v1/load` with four modes; `no-cache` *"skips refresh
key checks. Always returns fresh data from the data source"*. **Caveat that must not be missed: it is
read-bypass, not cache-off — the result is still written back to the cache.**

**So D5's mechanism is restated as:** define no pre-aggregations; run `CACHE_AND_QUEUE_DRIVER=memory`;
and send `cache: "no-cache"` on every `/v1/load`. D5's *intent* — Tailwind's cache is the only cache
we manage, measure or rely on — is unchanged and still correct. What changes is that **Cube's cache
is inert, not absent**, and the safety property therefore has to be argued rather than assumed:

> Cube's cache is keyed on the query it executes, and D4 puts the per-user predicate **into the
> generated SQL**. Two users with different predicates therefore cannot collide in it. **That is the
> property to verify, and it matters more than whether Cube Store is deployed** — if it fails, this
> stops being tidiness and becomes FR-SEC-04.

### Correction 2 — `access_policy` in Core needs `context_to_groups`, and `userAttributes` does not exist there

This ADR's D4 describes `access_policy` blocks *"parameterised by `securityContext` /
`userAttributes`"*. **`userAttributes` is Cube Cloud only.** Cube's docs: *"The `userAttributes`
object is only available in Cube Cloud platform. If you are using Cube Core… you won't have access to
`userAttributes`. Instead, you need to use `securityContext` directly."* Policies must therefore
reference `securityContext.*`.

Worse, and this is the part with teeth: *"Cube cloud platform automatically maps authenticated users
to groups for access policies. If you are using Cube Core… you might need to map the security
context to groups manually."* The hook is **`context_to_groups`**, and it is **required in Core** —
**omit it and no access policy ever matches.** Combined with Cube's documented fail-open default
(all rows public unless a policy says otherwise), the failure mode is: *policies present in the
reviewed model, group mapping absent, and every user sees every row, silently.*

That is precisely the trap D4's "default-deny, enforced by us" guardrail exists for, and now we know
its concrete shape. **`context_to_groups` is mandatory, and T-116's default-deny assertion must cover
the case where a policy exists but no group matches.** D1a's verdict is otherwise unchanged: the
capability is genuinely in Core, only the convenience is Cloud.

### Correction 3 — "pin to an LTS line" and "use multi-fact views" are currently incompatible

D1 and D1a say pin to an LTS line. Cube's LTS programme is real — twelve months of stability and
security fixes on designated minors — and the active lines are **v1.6.x** (EOL 2027-07-10) and
**v1.4.x** (EOL 2026-10-26), with latest patches v1.6.70 and v1.4.4. There is **no `lts` Docker
tag**; you pin the minor.

But **Tesseract only became the default planner in v1.7.0**, and **multi-fact views require
Tesseract** — and multi-fact views are how Cube handles chasm traps, which is criterion C1, weighted
×3, the single reason Cube won this ADR. Both LTS lines predate v1.7.0. So the choice is:

| Option | What it means |
|---|---|
| **Pin v1.6.70 LTS** | Run Tesseract as an opt-in flag (`CUBEJS_TESSERACT_SQL_PLANNER=true`, plus `CUBEJS_TESSERACT_PRE_AGGREGATIONS=true` on that line) — i.e. run the load-bearing component in a configuration that is **not** the line's default-tested one. No Cube doc addresses this combination. |
| **Pin v1.7.x** (currently v1.7.18) | Tesseract is the tested default. Not an LTS line, so no twelve-month patch guarantee — but it is the actively developed line, so it gets fixes first, not last. |

**Architect's recommendation: pin v1.7.x, and treat the LTS constraint as satisfied-in-spirit rather
than to the letter.** The reasoning: an LTS line buys patch stability, and the risk it is protecting
against is smaller than the risk of running the component our correctness guarantee depends on in a
non-default configuration on a line where nobody tests it. The whole argument for choosing Cube was
that it resolves fan-out and chasm correctly; deliberately configuring that path off the beaten track
to satisfy a version-policy preference inverts the priority.

**This contradicts a constraint Product stated, so it needs Product's confirmation rather than the
architect's assertion.** The mitigation if Product insists on LTS: pin v1.6.70, set both Tesseract
flags, and make T-097's negative controls for fan-out and chasm a **blocking** gate on every upgrade
— which they should be anyway. Revisit when a 1.7-or-later line is designated LTS, which is the
outcome to expect and which retires this whole paragraph.

### The residual empirical checks

Narrower than T-118 originally was. All hours, and checks 2 and 3 fold into **T-116**, which is
already building a two-context harness:

1. `cubejs/cube` at the pinned version, `CUBEJS_DEV_MODE=false`,
   `CUBEJS_CACHE_AND_QUEUE_DRIVER=memory`, no cubestore container: `/v1/meta`, `/v1/sql` and
   `/v1/load` all answer. (Watch for a dev-mode false positive — the official image starts a Cube
   Store in-process when `isDockerImage()` and dev mode are both true.)
2. **The FR-SEC-04 check:** the same semantic query under two security contexts resolving to
   different `access_policy` row filters, back to back, with `cache: "no-cache"`, confirming from
   Cube's logs that both executed against the warehouse and neither was served from the other's
   cache entry.
3. **The fail-open check:** a query whose security context maps to *no* group — confirm it is
   rejected or returns nothing, rather than returning everything because no policy matched.

### Hardening baseline this produces

Recorded here because it is a direct output of the investigation, and ticketed as **T-132**:

```dotenv
CUBEJS_DEV_MODE=false
CUBEJS_CACHE_AND_QUEUE_DRIVER=memory        # or /v1/load throws at query time
CUBEJS_DEFAULT_API_SCOPES=meta,data,sql     # drops GraphQL; `jobs` is already off
CUBEJS_TESSERACT_SQL_PLANNER=true           # explicit even where it is the default
# CUBEJS_PG_SQL_PORT deliberately unset     — the Postgres-wire SQL API is off by default
# no CUBEJS_CUBESTORE_HOST, no CUBEJS_REFRESH_WORKER, no CUBEJS_REDIS_* (hard-errors)
```

plus `context_to_app_id`, `context_to_orchestrator_id`, `repository_factory` and
**`context_to_groups`** in `cube.js`, and `cache: "no-cache"` on every `/v1/load`. Two further notes:
`/v1/sql-runner` — the `CVE-2022-23510` endpoint this ADR cites — **does not exist in Cube Core at
all**; it is a Cloud UI feature, which makes D4's "one door" guardrail cheaper than feared. And there
is **no official Helm chart**, only two explicitly community-maintained ones, which is an independent
argument for ADR-001's rejection of a Kubernetes-first POC.

### One strategic note for Q-03

Cube Cloud is now itself a BI product — workbooks, dashboards, charts, and **embedded analytics**.
If Tailwind is ever sold (Q-03 keeps SaaS in the back pocket), Cube is not merely a vendor but a
**competitor in the same category**. Apache-2.0 means this is a commercial consideration rather
than a legal one — nothing in the licence restricts us — but it is a reason to keep the façade
boundary (D2) clean and the engine genuinely swappable.

---

## Version pin ratified: **v1.7.x** (Product, 2026-08-10)

The architect challenged D1a's "pin to an LTS line" and is right to. Both current LTS lines predate
v1.7.0, where Tesseract became the default planner — and **multi-fact views are how Cube handles
chasm traps**, which is the ×3-weighted criterion that won this ADR in the first place.

**Decision: pin v1.7.x.** Running the correctness-critical query planner off its tested default in
order to satisfy a version policy inverts the priority. The policy exists to protect us from
unpatched bugs; it should not push us onto a path where the mechanism we selected the engine *for*
is not the mechanism being exercised.

D1a's LTS wording is amended to: **pin an exact minor version, upgrade deliberately, and track the
LTS lines so that moving onto one becomes possible once a line ships with Tesseract as default.**
The Cloud-gating prohibition in D1a is unchanged and unaffected.

**Revisit when:** an LTS line ships with Tesseract as the default planner. Then pin to it.

*Product made this call rather than leave the scaffold blocked overnight. Reversible — say so and
the pin moves.*

---

## D4 verified in a running engine (T-116 / T-117, 2026-08-12)

The Validation clause is satisfied. `packages/semantic/test/manual/rls-check.ts` shows, against
Cube v1.7.18 over DuckDB, two users in the **same tenant** getting different row sets from one
cache-eligible query — `analyst` sees four regions, `west_only` sees one — with different
security-context digests. A per-tenant context cannot produce that, which is exactly what FR-SEM-15
forbids relying on.

Three corrections to the ADR's own assumptions, all found by running it:

1. **The config hook is `contextToGroups`, not `contextToRoles`.** Cube's current documentation says
   the latter; v1.7.18 rejects it at startup as an invalid option. Verified against the image's own
   option validator. Correction 1 predicted this hook would be load-bearing and was right about the
   consequence — without it `access_policy` matches nothing and every row is served — but the
   published name is wrong for the version we pin.
2. **Matching a policy does not grant member visibility.** `member_level` defaults closed
   independently of `row_level`, so a policy with only a row filter yields *"You requested hidden
   member"*. Default-deny is stricter than the ADR assumed, in the safe direction. Both policies now
   carry an explicit `member_level`.
3. **Default-deny surfaces as a refusal, not as zero rows.** A context whose groups match no policy
   gets an error, not an empty result set. That is better than the ADR implied — an error is louder
   than silence, and silence is how a fail-open bug survives review — but any code treating "no
   rows" as the deny signal would be wrong. The façade must treat a refusal as the expected
   deny path, and the check asserts refusal-or-empty rather than empty alone.

**Standing note for ADR-008:** the digest differs per user, so a naive per-context cache key is
correct but has a hit rate of roughly one. That is the pre-RLS caching argument in
`02-architecture-brief.md §3.3`, and it is now a measured problem rather than a predicted one.
