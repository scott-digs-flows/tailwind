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

Prior prototype work in this repo explored the second: [`engines.yaml`](../../engines.yaml)
describes an Iceberg lakehouse with Trino, DuckDB, ClickHouse, and Postgres all reading the same
tables. **We should write down that we are not doing single-deployment portability**, or someone
will rebuild it under the banner of "flexibility."

That said — keep the file. Product has confirmed those engines are candidates with genuine
flexibility, and the manifest carries hard-won operational detail: working DSNs, per-engine
identifier casing, ClickHouse flattening the Iceberg namespace into the table name, DuckDB's
S3 signing scope problem with the Iceberg extension. That is exactly the kind of knowledge that is
expensive to rediscover. **Read it as evidence about candidate dialects, not as a target
architecture.**

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

**Candidate set.** [`engines.yaml`](../../engines.yaml) lists engines the team has already stood up
and connected to: Trino and DuckDB over Iceberg, ClickHouse, and Postgres. Product has confirmed
flexibility — nothing here is committed. Two observations for whoever writes ADR-002:

- The manifest's own notes flag ClickHouse as *"the most idiosyncratic SQL dialect here."* By the
  §8 criterion 3 argument, that makes it a poor choice for the **first** Certified dialect even if
  it is attractive on performance — starting on an idiosyncratic dialect hides assumptions until
  dialect #2 exposes them all at once.
- Postgres is tier-`copy` in that manifest: it cannot read Iceberg natively and holds a synced
  copy. If Postgres were the Certified dialect, freshness (FR-FRESH) would be bounded by the sync
  cadence, not by the warehouse. That interacts directly with the ≤30 min `standard` requirement
  and the near-live `operational` class — worth checking before it is chosen.

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

## 10. What I need from you *(Product → Architect)*

- **Which warehouse holds the pilot subject area, and where does existing BI content point?**
  These two answers settle §8 almost entirely.
- **Does the org run dbt today?** Feeds both ADR-003 and this decision. *(Architect, 2026-08-10:
  sharpened — the answer that actually changes ADR-003 is whether the org already defines **metrics
  in dbt semantic models / MetricFlow**, not whether dbt owns transformation. See Q-02.)*
- **Is there a known second warehouse in the org** (an acquisition, a legacy Postgres, a
  department's BigQuery)? If yes, dialect #2 is a scheduling question, not a hypothetical, and
  should enter the roadmap as Beta-tier at M3.

---

## 11. Architect's response *(2026-08-10, written alongside ADR-003)*

You asked me to push back on this paper rather than accept it. Here is where I agree, where I
think it is measuring the wrong thing, and what I would change.

### 11.1 I agree with §9.1 — one Certified dialect at GA — but for a better reason than cost

The paper argues one dialect on **cost**: a live warehouse in CI forever, conformance coverage,
type mapping, cost models, RLS primitives. All true, and all recurring. But cost arguments lose to
sales pressure, and they get weaker as the team grows. The argument that survives contact with a
customer is a **correctness** one.

Dialect adapters differ precisely where wrong numbers come from: `date_trunc` and week-start
conventions, fiscal boundaries, decimal precision, NULL and division semantics in ratio metrics,
and — most of all — the SQL the engine emits to defeat fan-out and chasm traps. A second Certified
dialect does not add 50% more surface; it doubles the surface on which the product's stated core
failure mode (`00-vision.md §2`, *"a confident chart with a wrong number"*) can occur, in the exact
places that are hardest to notice. Cube has an open multi-fact code-generation defect against
ClickHouse today (`cube-js/cube#10493`) — a concrete instance of the general shape.

So: one Certified dialect, and the rule for adding #2 is not "we can afford it" but **"someone is
willing to own the wrongness risk and the conformance suite passes."** That rule keeps working when
the team is ten people.

### 11.2 The tier model is right, but it should be *computed*, not *declared*

§4 tiers dialects. Under the Q-02 decision we don't own the dialect — we own a **conformance
result**. The honest unit is `engine version × dialect × conformance-suite outcome`, and the tier
should fall out of CI rather than out of a meeting:

- **Certified** — the full suite passes on the pinned engine version, in CI, against a live
  warehouse, and there is a cost model, an RLS story and a perf baseline.
- **Beta** — the smoke subset passes in CI. Nothing else is promised.
- **Experimental** — the engine claims it; we run nothing.

This is the same argument the repo already makes about `validate_docs.py`: mechanical rules belong
in a check, not in someone's memory. It also removes the political failure mode where "Certified"
is decided by whoever is loudest in the room. **Consequence for FR-SEM-12:** the tier is a derived
property, so the requirement should say the tier is *published and mechanically derived from the
conformance suite*, not merely published. I have amended it.

### 11.3 Don't publish the tier matrix yet

§4 says publish the tiers now, and calls it the highest-leverage decision here. I'd split it:
**adopt the model now, publish the matrix at GA.** During a POC with one warehouse and zero
external customers there is nobody to publish to, and a published matrix invites "can you beta
support X?" conversations that a two-person team cannot absorb. The leverage the paper is after
comes from having the *vocabulary* and the *mechanism*; the public artifact is a GA deliverable.
Costs nothing to delay, and it keeps `08-poc-scope.md`'s discipline intact.

### 11.4 Yes, the conformance suite belongs in M0 — but its first job is not the one §5 gives it

You asked specifically. **Yes, M0** — and I'd have argued for it even if the suite bought us
nothing on dialect pricing, because §5 has the purpose slightly wrong.

Under Q-02 we have just bet the product's central correctness guarantee on **someone else's
compiler**. The conformance suite is how we verify that bet, and the moment to verify it is
*before* ADR-004 hardens the spec format around the engine and before M1 builds a serving plane on
top of it. Pricing dialect #2 is a genuine second benefit, not the reason.

That reframing changes what the suite should contain and in what order. Not "every metric shape ×
every grain × every topology" — that is a GA-sized artifact, and T-097 currently reads that way at
`L`/`P0` in a milestone that already carries six ADRs and a walking skeleton. It is exactly the
kind of well-intentioned thoroughness that kills POCs. In M0, build the ~20 cases that would
actually falsify the adoption decision:

1. **Four join topologies** — single fact; fact + conformed dimension; two facts on a shared
   dimension (chasm); fact + bridge + dimension (fan-out). These are where engines differ.
2. **The grain matrix** — day/week/month/quarter/year plus one fiscal boundary, for one measure.
3. **One of each metric shape** — additive, `count_distinct`, ratio, filtered, derived, YoY, PTD.

with a negative control: the fan-out and chasm cases must produce *wrong* numbers when the declared
relationships are removed. A test that still passes when the mechanism is disabled is not testing
the mechanism. Grow the matrix in M1 as T-015 through T-018 land.

Parameterise by dialect from the first commit — that part of §5 is exactly right and it is nearly
free.

### 11.5 A category this paper is missing: the development dialect

§4's three tiers assume every dialect is a customer's serving warehouse. One is not.

`engines.yaml` already runs **DuckDB embedded, in-process, against the same Iceberg tables** as
Trino. That makes DuckDB something the tier model has no name for: a dialect that must be
conformance-clean because our tests and our local loop depend on it, but which will never serve a
customer. It is worth naming, because it pays for itself three times over:

- The conformance suite runs on every PR at zero warehouse spend and zero flakiness.
- **Differential testing** — the same suite on DuckDB *and* Postgres, results compared — is a
  correctness oracle that catches dialect-dependent wrongness immediately, and it is cheaper than
  maintaining golden files by hand. This is *not* the single-deployment portability §6 rules out,
  and the distinction is worth writing down because someone will conflate them: we are running the
  same tests on two engines, not routing one production query to two engines.
- It substantially defuses the CI credential problem in `02-architecture-brief.md §3.5`. Most of
  the CI evidence pipeline (FR-GOV-03/04/05) can run against a seeded local DuckDB with no
  warehouse credentials in CI at all, reserving live-warehouse runs for the checks that genuinely
  need them.

**Recommendation:** add a fourth tier, `development` — conformance-clean, never customer-facing,
no cost model, no SLA. And make "does the engine support a zero-cost embeddable local dialect?" a
scored criterion for engine selection. It was, in ADR-003, and both finalists passed.

### 11.6 On §8 — which warehouse

I cannot answer §8 criteria 1 and 2; they are Q-07 and T-088 and they belong to Product. What I can
do is close the circularity and give a default.

**The circularity.** §8 criterion 4 says the engine's certification of our warehouse should
influence the warehouse choice, while §2 says the warehouse should influence the engine choice.
`docs/adr/README.md` says write ADR-003 first, but `T-004` (ADR-002) does not depend on `T-005`
(ADR-003). Resolved as follows, and the dependency is now recorded in the backlog: **ADR-003 picks
the engine that certifies the whole plausible warehouse set, and ADR-002 then picks freely from
within it.** That ordering only works if the engine's matrix is broad, which is why dialect
coverage was weighted ×2 in ADR-003 and why Cube's coverage of all four `engines.yaml` engines
mattered. It is now a fact rather than a hope: ADR-002 is unconstrained by ADR-003.

**The default, if nothing else decides it.** Of the `engines.yaml` set:

- **Trino — the default choice for the one Certified dialect.** Iceberg-native, so freshness is
  bounded by the warehouse rather than by a sync (which matters directly for FR-FRESH's ≤30 min
  `standard` class); the reference Iceberg engine in the manifest's own words; and a
  representative, well-behaved dialect, which is §8 criterion 3's requirement.
- **DuckDB — `development` tier** per §11.5. Not a serving warehouse.
- **ClickHouse — not first.** The manifest calls it *"the most idiosyncratic SQL dialect here"* and
  it is the one dialect where the engine we selected has a known multi-fact defect. Both point the
  same way.
- **Postgres — not first.** It is tier-`copy`: it cannot read Iceberg and holds a synced replica,
  so choosing it caps freshness at the sync cadence. That is a direct conflict with FR-FRESH-01,
  and it would make the POC's freshness numbers a property of `scripts/sync_postgres.py` rather
  than of Tailwind. Excellent as a *second* conformance target for differential testing.

If Q-07 or T-088 points somewhere outside this list — a Snowflake or BigQuery estate nobody
mentioned — that outranks all of the above, and the selected engine certifies those too.

### 11.7 Where I think §7 is right and worth protecting

§7's extract-engine idea is the one genuinely compelling second dialect, and the paper is right to
defer it to M3. One addition: ADR-003's decision to keep the engine's own caching **off** and let
Tailwind own the single result cache is what keeps that door open. If we let the engine's
materialisation layer own performance, an extract engine later is a fight with it rather than a
component slotted behind a clean boundary.

### 11.8 What I still need from Product

The two questions in §10 stand, and I have sharpened the dbt one in `04-open-questions.md`: the
answer that matters is not "do you run dbt?" but **"do you already define metrics in dbt semantic
models / MetricFlow today?"** Only the second would change ADR-003. Add one more:

- **Is there a warehouse in the org that is not in `engines.yaml`?** If the real estate is
  Snowflake or BigQuery, §11.6's default is void and the pilot should start there instead.

---

## §12 — First conformance run against ClickHouse (T-135, 2026-08-13)

**Result: 19/19 cases pass — and the tier is NOT certified, because the negative control failed.**

That combination is the entire reason §5 insisted on negative controls, so it is worth stating
plainly rather than burying: *a suite that still passes when the mechanism under test is disabled
is not testing the mechanism.* With `fact_reseller_sales → dim_product` deliberately mis-declared
as `one_to_one`, **all 19 cases still passed.**

### Why

The generated SQL says it exactly. On the AdventureWorks model as written:

- `product_standard_cost` alone compiles to `SELECT sum(standard_cost) FROM dim_product` — the
  one-to-many is never traversed.
- `product_standard_cost` with `reseller_sales` compiles to **multi-fact CTEs**: each cube is
  aggregated independently and the results combined.
- The one query that *would* force product → fact → territory traversal is **refused** by Cube
  (no join path between two dimension tables).

So every case labelled `fan-out` is really exercising **multi-fact aggregation**, which is a
different mechanism and one that does not depend on the declared cardinality. Cube's
deduplication-subquery path — the thing ADR-003 weighted ×3 — is never reached.

**This is a defect in our model and our cases, not in ClickHouse.** ClickHouse answered every
question correctly, including the 156×-wrong fan-out figure it avoided. But "it passed" carries no
information here, and reporting a tier on this basis would have been exactly the false green the
negative control exists to prevent.

### What the model is missing

A **header/detail topology**. The synthetic model had one (`orders_hdr` → `order_lines`, with
freight held per order). AdventureWorks as modelled has measures on *dimension* tables instead,
which Cube treats as facts — and facts never fan out into each other.

`fact_reseller_sales` does carry the ingredients: `sales_order_number` groups several
`sales_order_line_number` rows. An order-header cube derived from it, joined one-to-many to the
lines, with an order-level measure, would force the traversal.

### Consequence for the tier

**ClickHouse is `unverified`, not `certified`.** FR-SEM-12 says a tier is a computed conformance
result; this run computed nothing about fan-out. Tracked as **T-136** — restore a header/detail
topology, confirm the negative control fires, and only then compute a tier.

### Two smaller findings from the same run

- **A measure on a dimension table makes that cube a fact.** Two facts sharing a dimension each
  need a *direct* join to it, so `product cost by territory` is refused rather than answered.
  Correct behaviour — the question is genuinely ambiguous — but it is a modelling hazard worth a
  lint rule, and an argument for using a fact's own cost column instead.
- **The conformance report named the wrong dialect.** It printed `dialect=duckdb` while querying
  ClickHouse, because the label came from an env-var default rather than from the engine. A report
  that misattributes a tier to an untested warehouse is worse than no report. Now read from the
  running container.

### §12.1 — Re-run after T-136: ClickHouse is `certified`

The header/detail topology was missing, not the engine's correctness. `fact_reseller_sales`
groups several `sales_order_line_number` rows under one `sales_order_number`, so an order-header
cube derived from the fact — joined `many_to_one` from the lines — restores the traversal that
`dim_product` measures never forced.

**Result: 23/23 pass, and the negative control fires.** With the cardinality mis-declared as
`one_to_one`, four trap cases fail and return numbers that look entirely plausible:

| | correct | mechanism disabled |
|---|---|---|
| order freight | 2,011,265.92 | **63,422,668.30** (31.5×) |
| order count | 3,796 | **60,855** — it counted lines |
| freight by product line | 832,002 for line `M` | **17,566,125** |

Those are exactly the fanned-out figures the oracle predicted independently. The queries still
*ran*; they simply lied. That is the failure mode the product exists to prevent, reproducible on
demand.

**Tier: `certified`** — computed from a conformance result on a pinned engine version
(Cube v1.7.18, ClickHouse 26.7.3.19), per FR-SEM-12, not declared.

**The Q-01 objections are settled by measurement.** The architect's multi-fact defect did not
appear on this topology, and ClickHouse's flattened-namespace quirk (`datalake."raw.dim_product"`)
was handled by `sql_table:` without special casing. The idiosyncrasy argument in §8 stands as a
general caution but did not bite here.

### §12.2 — The DuckDB development tier is retired (Product, 2026-08-13)

Product's answer to Q-01 was **ClickHouse**, and DuckDB was carried forward as a `development`
tier that nobody asked for. Retiring it, because **the reasoning that justified it does not
survive the choice.**

§11.5 argued for a `development` tier so CI could run the conformance suite with *no warehouse
credentials and no spend*. That argument assumes the certified dialect is a **cloud** warehouse.
ClickHouse is a container. CI runs it the same way it runs Postgres — no credentials, no spend, no
second dialect to keep in parity.

**What retiring it costs, stated honestly:** the `development` tier was also going to buy
differential testing — the same suite on two engines, disagreements as a correctness oracle
(§11.5). That is a genuine loss. It is not worth maintaining table-name parity across two engines
forever to keep it, and T-097's negative control already covers the failure mode differential
testing was aimed at: a mechanism that silently is not working.

**The tier model keeps three tiers, not four.** `certified` · `beta` · `experimental`. The
`development` tier existed for one engine's convenience and no longer has an occupant.

**Consequence:** CI must run ClickHouse. Tracked as **T-137**, rescoped from "restore DuckDB" to
"run ClickHouse in CI". Until it lands, the conformance suite runs locally only.
