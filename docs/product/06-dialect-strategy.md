# Tailwind — Dialect & Engine Strategy (Q-01 working paper)

**Status:** Open for discussion · Owner: Product + Architect
**Context:** Q-02 decided *adopt* a metrics engine. Q-03 decided *carry a tenant ID from day one*.
Both change what this question is actually asking.

---

## 1. The question has three layers, and they get conflated

| Layer | Question | Who decides |
|---|---|---|
| **Market reach** | How many warehouses must a *customer* be able to point us at? | Product |
| **Engineering cost** | How many dialects must we *certify* and keep certified? | Architect |
| **Runtime topology** | How many engines does a *single deployment* talk to? | Architect |

These are independent. A product can claim four warehouses (market), certify one and beta three
(engineering), while every deployment talks to exactly one (topology). Conflating them is how
teams accidentally sign up for a portability project they never needed.

## 2. What the Q-02 decision changed

Adopting an engine means **we no longer write SQL generation.** The dialect matrix largely comes
with the engine. That collapses the biggest line item — but it does not make dialects free, and
it introduces a new one: *we inherit someone else's support matrix and someone else's bugs.*

**This makes the engine's dialect matrix a first-class selection criterion in ADR-003, not an
afterthought.** Choosing an engine that certifies our target warehouse *and* the two most likely
future ones is worth more than a marginally nicer spec syntax.

## 3. What a dialect actually costs, post-adoption

Implementation is mostly gone. What remains is recurring:

| Cost | Notes |
|---|---|
| **A live warehouse in CI, forever** | The real recurring cost. Credentials, spend, flakiness, seeded fixture data, secret rotation. This is the line item people forget and then resent. |
| **Conformance test coverage** | Golden results for every metric shape × grain × dialect (NFR-QUAL-02). |
| **Type-system mapping** | Timestamps with/without timezone, decimal precision, JSON/struct/array handling. |
| **Time semantics** | `date_trunc` behavior, week-start conventions, fiscal calendars (FR-SEM-04). A frequent source of silently-wrong numbers. |
| **Identifier casing & quoting** | Per-engine and genuinely fiddly. |
| **NULL and division semantics** | Directly affects ratio metrics (FR-SEM-03). |
| **Cost model** | Bytes-scanned vs. credits vs. DBUs are structurally different. FR-GOV-06 and NFR-COST-01 need a *pluggable* cost interface, not one hardcoded formula. |
| **RLS primitives** | Some warehouses enforce natively, some don't. FR-SEC-04 must not depend on a feature only one engine has. |
| **Auth model** | Key-pair vs. OAuth passthrough vs. workload identity — bears directly on FR-SEC-08. |
| **Perf idioms & concurrency** | What's fast on one is slow on another; each needs its own load-test baseline (NFR-SCALE-01). |

**Implication:** dialect #2 is cheap to *make work* and expensive to *promise*. That asymmetry is
what the tier model below exploits.

## 4. Proposal A — Support tiers instead of a binary

Replace "supported / not supported" with three honest tiers:

| Tier | What we promise | What it costs us | GA count |
|---|---|---|---|
| **Certified** | Full conformance suite, live CI, cost model, RLS, perf baseline, SLA, on-call | High, recurring | **1** |
| **Beta** | Compiles and passes a smoke subset in CI. No cost model, no perf guarantee, no SLA. Labeled in-product. | Low | 0–2 |
| **Experimental** | The adopted engine claims support; we do not test it. Clearly labeled, no support. | ~0 | as inherited |

This lets us answer "do you support X?" honestly and expansively while engineering pays for one.
It also gives a clean, non-political promotion path: *a dialect becomes Certified when a named
customer or pilot needs it and the conformance suite passes.*

**Recommendation: adopt this model and publish the tiers.** It is the single highest-leverage
decision here, and it costs nothing to make now.

## 5. Proposal B — Build the conformance suite in M0

Stop arguing about the count; make the price visible.

A **dialect conformance suite** is a fixed set of semantic queries — every metric shape (simple,
ratio, filtered, derived, time-offset) × every grain × join topologies that trigger fan-out — with
expected results, run against a standard seeded dataset.

Then "add a dialect" has a definition: *make the conformance suite pass, then promote a tier.*
The decision becomes a business one with a known price tag, rather than an architecture debate
re-litigated every quarter.

Build it in M0 against the one Certified dialect. It costs little extra there because we need
those golden tests anyway (T-023) — the only added work is keeping it dialect-parameterized.

**This is the concrete deliverable I'd add to the backlog regardless of which count we choose.**

## 6. Proposal C — Name the portability trap explicitly

There are two very different things called "multi-engine":

- **Multi-warehouse support** — different deployments point at different warehouses. Each
  deployment talks to one. *This is normal and is what we mean.*
- **Single-deployment portability** — the same query provably runs across several engines
  simultaneously. *Enormously more expensive, and almost no BI product needs it.*

Prior prototype work in this repo explored the second (an Iceberg lakehouse with Trino, DuckDB,
ClickHouse, and Postgres all reading the same tables). That was a lab experiment. **We should write
down that we are not doing it**, or someone will rebuild it under the banner of "flexibility."

## 7. Proposal D — The second engine you might actually want is a cache engine

Worth separating from everything above, because it's the one genuinely compelling case for a second
dialect in a *single* deployment.

NFR-PERF-01 (p95 warm < 2.5 s) and NFR-SCALE-03 (>85% cache hit) at Tier-3 scale may not be
reachable by caching results alone. The classic answer is what Tableau (Hyper) and Power BI
(VertiPaq import mode) both do: materialize an **extract** into a fast columnar engine and serve
interactive queries from it, falling back to the warehouse for cold or detailed queries.

That extract engine is, technically, a second dialect — but it is *ours*: one version, one config,
no customer variability, no auth model, no cost model. Radically cheaper than a second customer
warehouse.

**Do not decide this now.** Decide it at M3, when the Tier-2 load test (T-086) produces real
numbers. But *design for it*: keep the dialect abstraction clean enough that a serving engine can
slot in behind the compiler without touching the caching or security layers.

## 8. Which one, if one?

Decision rule, in priority order:

1. **Where does the pilot subject area's data live?** (Q-07) — the pilot cannot wait on a second
   integration.
2. **Where does the majority of existing Tableau/Power BI content point?** That is the migration
   path of least resistance (Q-08 decided coexist, which means we must read the same warehouse the
   legacy tool reads).
3. **Is the dialect representative or idiosyncratic?** Starting on a well-behaved dialect teaches
   transferable lessons; starting on an idiosyncratic one (unusual identifier casing, non-standard
   namespace flattening, unusual NULL semantics) teaches lessons that don't generalize and hides
   assumptions until dialect #2 exposes them all at once.
4. **Does the adopted engine certify it?** If our target warehouse is only Beta-tier in the engine
   we like best, that is a serious mark against that engine — not something to work around.

If (1) and (2) disagree, (2) should usually win: a pilot on a warehouse nobody else uses proves
less than a pilot on the warehouse everyone is migrating off.

## 9. Recommendation

1. **One Certified dialect at GA.** Chosen by the rule in §8.
2. **Publish the support-tier model** (§4) now. It decouples what we can claim from what we pay for.
3. **Build the dialect conformance suite in M0** (§5), dialect-parameterized from the first commit.
4. **Make the engine's dialect matrix a scored criterion in ADR-003** (§2).
5. **Write down that single-deployment portability is out of scope** (§6).
6. **Keep the dialect boundary clean enough to admit a serving/extract engine later** (§7); revisit
   at M3 with load-test data.
7. **Dialect #2 is demand-triggered, not roadmap-triggered** — a named customer or pilot need,
   priced with the conformance suite.

## 10. What I need from you

- **Which warehouse holds the pilot subject area, and where does existing BI content point?**
  These two answers settle §8 almost entirely.
- **Does the org run dbt today?** Feeds both ADR-003 and this decision.
- **Is there a known second warehouse in the org** (an acquisition, a legacy Postgres, a
  department's BigQuery)? If yes, dialect #2 is a scheduling question, not a hypothetical, and
  should enter the roadmap as Beta-tier at M3.
