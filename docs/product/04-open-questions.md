# Tailwind — Open Questions

**Status:** Draft v0.1 · Owner: Product · Answers change architecture, so answer the blocking set first.

Each question states *why it matters* (what breaks if we guess wrong), the **current working
assumption** the docs are written against, and my recommendation. If an assumption stands
unchallenged, we build to it — silence is an answer, just an expensive one to reverse.

---

## Blocking M0 kickoff

### Q-01 — What is the warehouse of record, and how many SQL dialects must GA support?
**Status: OPEN — under discussion.** The Q-02 and Q-03 decisions reshaped this question; see the
full analysis in [06-dialect-strategy.md](06-dialect-strategy.md).

**Short version:** adopting a metrics engine (Q-02) means we no longer *write* dialects — we
inherit them. The cost of a dialect shifts from implementation to **certification**: conformance
testing, a live warehouse in CI forever, a cost model, RLS primitives, and perf tuning. Meanwhile
carrying a tenant ID (Q-03) makes dialect count a market-reach question, not just an engineering
one.

**Working recommendation:** exactly **one Certified** dialect at GA, a published support-tier
model so we can name additional dialects honestly without paying for them, and a dialect
conformance suite built in M0 so the price of dialect #2 is a known number rather than an argument.

**Architect responded 2026-08-10** — [`06-dialect-strategy.md §11`](06-dialect-strategy.md). In
short: agrees with one Certified dialect but on correctness rather than cost grounds; agrees the
conformance suite belongs in M0 but repoints it (its first job is acceptance-testing the engine we
just adopted, and its M0 scope should be ~20 cases, not the full matrix — T-097 rescoped); argues
the tier should be *derived from CI* rather than declared, and that the matrix should be published
at GA rather than during the POC; adds a fourth `development` tier for the local/CI dialect; and
resolves the ADR-002 ↔ ADR-003 circularity by confirming the selected engine certifies every
`engines.yaml` candidate, so **ADR-002 is unconstrained by ADR-003**. FR-SEM-12/13 amended
accordingly. Default recommendation absent Q-07/T-088: **Trino** certified, **DuckDB**
development-tier, ClickHouse and Postgres not first.

**Sub-questions that need an answer regardless:**
- Where does the majority of existing Tableau/Power BI content point? That plus Q-07 settles
  "which one" almost by itself.
- **Is there a warehouse in the org that is not in `engines.yaml`?** If the real estate is
  Snowflake or BigQuery, the recommendation above is void.
- Does the org run dbt — and, the version of that question that actually decides anything, see
  Q-02 below.

### Q-02 — Semantic layer: adopt an existing engine, or build our own? ✅ DECIDED 2026-08-10
**Decision: adopt an existing metrics engine.** We do not build a metrics engine.
**Consequences:**
- ADR-003 becomes a *selection* decision, not a build/buy debate. Score candidates against
  FR-SEM-01…FR-SEM-05 **plus** their dialect support matrix (see Q-01) and their extension model —
  we must be able to add required metadata (FR-SEM-06) and certification states (FR-SEM-07) without
  forking.
- The adopted engine's spec becomes a hard input to ADR-004 (spec format). Do not design our spec
  format before the engine is chosen.
- **Selection made 2026-08-10** — [ADR-003](../adr/ADR-003-semantic-engine-selection.md) selects
  **Cube Core**, self-hosted under Apache-2.0, behind a Tailwind compiler façade, with a
  constrained profile of Cube's YAML as the reviewed git artifact. **Fork-risk verdict: no fork is
  needed for FR-SEM-06/07**, and it was not close for any live candidate — certification is
  metadata plus our CI plus our UI, and the only engine requirement is that it carries arbitrary
  metadata and returns it over its API, which Cube's `meta` does. Q-02 stands.
- **Sharpened, and still open:** the question as originally written — *"does the org already run
  dbt?"* — does not discriminate between the candidates. Every candidate reads dbt-built tables
  perfectly well, so dbt owning *transformation* is close to irrelevant here. The question that
  would actually change ADR-003 is narrower: **does the org already define metrics in dbt semantic
  models / MetricFlow today?** *(Reframed by the architect, 2026-08-10.)*
- ✅ **ANSWERED 2026-08-10: no.** The org uses dbt for transformations but not MetricFlow. ADR-003's
  central assumption holds, the second-definition-site risk does not exist, and the runner-up's
  strongest situational advantage does not apply. **ADR-003 is ratified and Accepted.**
  The revisit trigger is re-aimed rather than retired: **if the org later adopts dbt semantic
  models / MetricFlow metrics, reopen ADR-003** — that would create two definition sites and break
  FR-SEM-02, the constraint the product rests on.
- ✅ **Cube Core only, no premium tier** — confirmed by Product. See ADR-003 **D1a**: nothing we
  depend on is Cloud-gated (`access_policy` is Core since v1.2), with one watch item — Cube Store
  HA is Cloud-only, which is part of why T-118 matters.

### Q-03 — Internal platform, or a product we will sell? ✅ DECIDED 2026-08-10
**Decision: build internal-first, but carry a tenant ID from day one.** SaaS is plausible within
two years and we will not pay a rewrite to find out.
**Consequences:**
- Tenant is a first-class column/scope in: the artifact registry, cache keys, connection
  management, the RLS context, audit log, and the git layout. It is threaded through from M0, not
  added later.
- We do **not** build tenant-facing surfaces in v1 — no per-tenant branding, billing, signup, or
  admin. Isolation only.
- Every cache-key and RLS design review must answer "what happens with two tenants?" even while
  only one exists. Add a test tenant to non-prod environments from M0 so single-tenant assumptions
  cannot silently creep in — this is the only way the tax actually buys anything.
- ADR-014 is unblocked and should now document *how*, not *whether*.

### Q-05 — Deployment, data residency, AI egress ✅ DEFERRED 2026-08-10
**Decision: out of scope for the POC.** The goal is to get the product idea right; formal
Security/Legal review, egress controls, and provider contracting wait.
**Consequences:**
- This reframes the whole project as **POC-first**. Written up in
  [08-poc-scope.md](08-poc-scope.md), which the architect should read as a filter over
  `01-requirements.md`. Without it they will over-engineer against a GA spec.
- The POC must run on a **non-sensitive subject area**. That is the condition the deferral rests on
  — it is not a general exemption.
- ADR-001 still needs an answer, but a trivial one: simplest thing that runs, single environment.
- **Deferral trigger:** the moment regulated, customer, or PII data enters a dashboard, this
  question returns in full. See `08-poc-scope.md §4`.
- **Related tension:** the SaaS comment here partly walks back Q-03. Flagged and given a
  recommendation in `08-poc-scope.md §6` — awaiting confirmation.

### Q-06 — Git host and app-brokered PRs ✅ DECIDED 2026-08-10
**Decision: yes — the app brokers PRs on the author's behalf.** Business users never need a git
account. FR-GOV-01 stands as written.
**Setup runbook:** [09-git-integration-setup.md](09-git-integration-setup.md) — use a GitHub App
(not a PAT), with the exact permission set, branch protection rules, and attribution convention.
Roughly 30 minutes of org-owner work; tracked as T-108.
**Consequences:**
- The governance guarantee rests on **branch protection + CODEOWNERS**, not on application code.
  `CODEOWNERS` cannot list an app, so a human must approve — a platform-level property, which is
  the right place for it.
- Commit attribution uses git's author/committer split: author = the human, committer = the bot,
  plus trailers. The `Tailwind-Authoring: ai-assisted` trailer is how we measure the hypothesis —
  capture it from the first commit, it cannot be backfilled.
- **Still needed:** which host (runbook assumes GitHub; GitLab needs a paid tier for code-owner
  enforcement — verify), and who sits in the CODEOWNERS teams for models vs. dashboards.

---

## Blocking M1/M2, needed soon

### Q-04 — Who is on the team, and what is the target timeline?
One architect and one full-stack engineer is a very small team for this scope. Knowing headcount
and any fixed date changes what "v1" should contain. If the date is fixed and the team is two, M2
should shrink to a single subject area and the visual editor should be cut immediately rather than
optimistically scheduled.

### Q-07 — What is the pilot subject area, and who are the named pilot users?
The thesis test in M2 needs 5–10 real Morgans and 1–2 real Sams, by name, committed in advance. A
pilot without named participants slips indefinitely. It also needs a subject area whose data is
clean enough that wrong numbers are our fault, not the pipeline's.

### Q-08 — What is the migration commitment? ✅ DECIDED 2026-08-10
**Decision: coexist, with usage-driven prioritization.** Both tools run against the same warehouse.
We port what is actually used, in usage order, and let adoption pull the rest.
**Consequences:**
- FR-MIG-03 (assisted workbook conversion) stays a **spike**, not a committed feature. We are not
  building an importer.
- FR-MIG-01 (usage-based inventory) is promoted in importance: it is the input that decides all
  migration sequencing, and it should run *early* — before M4 — because it also tells us which
  subject area to pilot (Q-07).
- FR-MIG-04 (coexistence directory / authoritative-source signaling) is now required, not optional.
  Two tools showing different numbers for the same metric during coexistence is the fastest way to
  destroy trust in the new one. Users must always be able to tell which is authoritative.
- No decommission date is committed. Success metric shifts from "legacy retired" to "legacy usage
  declining" — track it (T-088).
- **Watch item:** coexistence has no natural end. Set a review checkpoint (suggest: 2 quarters
  after GA) to decide whether adoption is pulling hard enough or whether a forcing function is
  needed. Without that checkpoint, "coexist" becomes "run two BI stacks forever."

### Q-09 — How does the AI reach *documentation*, and does that documentation exist?
The brief says the AI gets "documentation and the codebase." Grounding quality is the difference
between a useful assistant and a plausible liar. Concretely: is there real documentation of models
and metrics today, or is that itself a deliverable? A semantic layer with empty description fields
produces a bad assistant no amount of prompting fixes.
**Recommendation:** Make rich descriptions a CI-enforced requirement (already FR-SEM-06) and budget
real time for backfilling them on the pilot subject area.

### Q-10 — What is the RLS attribute model?
How is "this user may see these rows" expressed today — IdP group membership, a mapping table in
the warehouse, or per-report filters maintained by hand? This determines the identity contract and
whether we can enforce security centrally at all. If it is currently "per-report filters maintained
by hand," we should say plainly that we are *replacing* that with a central model, and budget for
it.

### Q-11 — Does an existing dbt/ELT pipeline own the transformation layer? ✅ ANSWERED 2026-08-10
**Yes — dbt owns transformation.** The non-goal in `00-vision.md §6` now has organizational
backing, not just a bullet in a doc.
**Consequences, both favourable:**
- **T-093 (documentation backfill) is largely bootstrappable.** dbt's `manifest.json` already
  carries model and column descriptions, tests and ownership. Generating draft cubes and `meta`
  blocks from it beats authoring from scratch and directly improves AI grounding (FR-AI-05) — the
  assistant is only as good as the descriptions it reads. **FR-DEV-06 promoted from an unticketed
  `Could` to real leverage; new ticket T-119.**
- **FR-FRESH-05 has its signal source: dbt run completion.** "How do we know upstream data is
  fresh?" was open across three docs. It is the ELT webhook the design already preferred over
  polling. T-111 updated.
- Note this is the *transformation* question. The one that could have reopened ADR-003 was
  narrower — metrics defined in dbt semantic models / MetricFlow — and the answer to that is
  **no**. See Q-02.

---

### Q-19 — Volumetrics and integration inventory ⚠️ PARTIALLY ANSWERED 2026-08-10
**Answered:** freshness is **tiered**, not uniform — ~30 minutes for most content, near-live for
operational dashboards ("what do I work on next"). This is more architecturally significant than a
sizing number and produced a new requirement group, **FR-FRESH**, plus a scope-risk analysis in
[08-poc-scope.md §7](08-poc-scope.md). Freshness class is declared per artifact in the spec, so
it's reviewed rather than configured, and promoting a dashboard to `operational` needs data-team
approval with cost surfaced in CI.

**Still unknown:** dataset sizes ("could be large or small"). Not a blocker — planning assumptions
are recorded in [08-poc-scope.md §5](08-poc-scope.md) and replaced by real measurements once T-081
(observability) lands in M1. **ADR-008 (cache topology) should be written or revised after that
data exists.**

**Worth ten minutes before ADR-008:** largest dashboard-backing table size, and typical query scan
volume. Both are one query against warehouse metadata, and they're the two that actually move the
cache design.

**Still open below:** the integration inventory. An architect cannot pick a secret store or an
observability stack without knowing the org standard.

**Warehouse**
- Total size, and size of the largest tables likely to back a dashboard.
- Typical and worst-case scan volume per dashboard query.
- Typical result-set size returned to a chart (rows × columns).
- Refresh cadence, and how "data is fresh as of X" is currently known (FR-CON-03).
- Concurrency limits and current peak utilization.

**Content**
- How many dashboards exist in Tableau/Power BI today, and how many are viewed monthly? *(The gap
  between those two numbers is the migration plan — see Q-08.)*
- Expected count of semantic models and metrics at GA, and at two years.
- Expected dashboards per user, and charts per dashboard.

**Users**
- Named users and expected peak concurrency at each of the three scale tiers.
- Geographic distribution — does anything need multi-region?

**Integrations** — every row marked OPEN in `07-domain-model.md §4`: IdP and whether SCIM is
available, secret store standard, observability standard, sanctioned notification channels, CI
system, and whether dbt is in use (also Q-11).

## Answer before GA

### Q-12 — Certification authority: who may mark a metric `certified`?
A named role, or the CODEOWNER of the file? I recommend CODEOWNERS-based, so authority lives in the
repo and is auditable rather than in a UI permission somebody forgets to revoke.

### Q-13 — What is the SLA for reviewing a business-user PR?
Morgan's experience is defined by this number, and it is an organizational commitment, not a
technical one. A 3-day median review turns the escalator into a staircase and adoption dies. Needs
the data team's manager to own a target.

### Q-14 — Product name?
`tailwind` collides with Tailwind CSS. Cheap to change now, painful after launch.

### Q-15 — What is the AI budget per user per month?
Sets the model-tiering strategy and the hard cutoffs in FR-AI-09. Needs a number, even a rough one.

### Q-16 — Accessibility obligation: is WCAG 2.1 AA contractual or aspirational?
Contractual changes the chart library decision (ADR-005), which is expensive to revisit later.

### Q-17 — What happens to a merged dashboard's *owner*?
When Morgan proposes a dashboard and Sam merges it, who is on the hook when it breaks in six
months? I recommend the proposing author remains the owner, with the data team owning only the
semantic layer beneath it — otherwise every merge silently transfers maintenance load to the data
team and they will (correctly) start rejecting PRs.

### Q-18 — Is there an existing design system or component library to inherit?
Affects front-end estimates and the visual editor's build cost.
