# Tailwind — Roadmap & Release Plan

**Status:** Draft v0.1

Milestones are sequenced by **risk retired**, not by feature area. Each has an exit criterion that
is a demonstrable behavior, not a checklist of merged tickets.

> **M0–M2 is the POC** (99 tickets); **M3–M4 is GA** (33 tickets). Per Q-05, production concerns —
> availability, scale, security assurance, authoring polish — are deliberately deferred past M2.
> See [08-poc-scope.md](08-poc-scope.md) for what's out, what stays anyway, and the triggers that
> pull deferred work back in.

Durations are deliberately omitted — they depend on team size and the answers to Q-01…Q-06.
Relative sizing is captured in `TICKETS.csv` (`size` column: S/M/L/XL).

---

## A few weeks — what actually fits

*(Added 2026-08-10 after Q-04: architect + full-stack engineer, plus a few of the ~20 data-team
engineers splitting time. Timeline "a few weeks, ASAP desired.")*

**Plainly: a few weeks does not buy M0–M2.** That is months, and split-time engineers do not add up
to whole ones — three people at 30% is ~1 FTE, interrupted by exactly the ad-hoc report demand
Tailwind exists to reduce. It buys **one** of the
following, and choosing is the most consequential decision available right now.

> **Superseded by a later decision on the same day.** Product initially chose Option A and then
> reversed to **Option B — build the M0 walking skeleton first** (see *Decision reversal* below).
> Both options are left standing as written, because the argument for Option A is still the argument
> that should reopen this if the skeleton lands and the thesis is still untested.

### Option A — Validate the thesis
Run the wizard-of-oz test (`10-wizard-of-oz-protocol.md`). No product code. With ~20 data people the
semantic-model setup is fast, and dbt's manifest bootstraps the descriptions (T-119).

**You end with:** a defensible answer on whether business users plus AI produce artifacts the data
team will merge, a `merged-and-correct` number, and a list of specific, named problems. Plus real
specs, diffs and reviewer comments to design the product around.

**You do not end with:** any software.

**Why this one.** The riskiest thing about Tailwind is not technical, and a few weeks spent on a
walking skeleton proves the pipes work — which nobody doubts — while leaving the actual bet
untested. It also guards Risk 3 in Q-04: data engineers building a self-service tool tend to build
the tool *they* would want, and this test forces contact with real business users first. If the thesis is wrong, this is the cheapest possible way to find out, and it
would save months.

### Option B — Prove the pipes ✅ **CHOSEN 2026-08-10 (reversal — this is the live decision)**
M0 walking skeleton: repo, CI, deploy, one semantic model, one dashboard spec, one real query
rendered in a browser.

**You end with:** a deployed page showing one chart where changing a metric in a file changes the
number on screen. Genuinely valuable — it de-risks the integration and forces the M0 ADRs to be
real.

**You do not end with:** auth, AI, the PR loop, or any evidence about the hypothesis.

### Option C — Both, badly
Not available. Say so out loud rather than discovering it in week three.

### Decision reversal — build first *(Product, 2026-08-10)*

**Product reversed Option A → Option B: build the M0 walking skeleton now.** The wizard-of-oz
protocol is not cancelled; it is unscheduled, and `10-wizard-of-oz-protocol.md` stays run-ready
because it needs no application code and can be run at any point.

The architect's note on this, recorded so the tradeoff is not forgotten: **Option A's argument was
never refuted, only outvoted.** The skeleton proves the pipes work, which nobody doubted, and it
does not test the hypothesis. Two consequences follow and both are actionable:

1. **The thesis risk is still open and now has no scheduled test.** It gets tested at M2 exit, which
   is months away, on a system already built. The cheap mitigation is to run the wizard-of-oz test
   *alongside* M0 — it consumes data-team time and reviewer time, not architect or full-stack time,
   so it is not competing for the scarce resource. Recommend Product schedule it in parallel rather
   than dropping it.
2. **M0's own scope must not expand to compensate.** "We are building, so let's build properly" is
   the exact pressure `08-poc-scope.md` was written against. M0 is ADR-001…ADR-006 plus ADR-014, the
   scaffold, and one chart. Everything else waits.

The five M0 ADRs written on 2026-08-10 — [ADR-001](../adr/ADR-001-deployment-target-and-topology.md),
[ADR-004](../adr/ADR-004-spec-format-and-repository-layout.md),
[ADR-005](../adr/ADR-005-frontend-stack-and-chart-library.md),
[ADR-006](../adr/ADR-006-backend-framework-and-api-style.md),
[ADR-014](../adr/ADR-014-multi-tenancy-model.md) — exist to unblock this decision.

### Consequence of the build-team answer
Because a few data-team engineers split time onto Tailwind (Q-04), the semantic-model setup the
wizard-of-oz test needs is staffed by people who already know the data — the fastest possible path.
But note the constraint in `10-wizard-of-oz-protocol.md §3`: **whoever builds cannot judge.** The
test's reviewer and auditor must come from the data-team members *not* working on Tailwind.

### What must not be cut for speed

"ASAP" is exactly the pressure that erodes `08-poc-scope.md §3`. Two of those seven are genuinely
irreversible and cost almost nothing now:

- **The security context as a parameter of query construction and the cache key** — populate it
  permissively, but get the *shape* right. Retrofitting it later is a rewrite of the compiler and
  the cache.
- **Deterministic, lossless serialization** — the review gate is diffs. Noisy diffs mean the gate is
  theater and the thesis is untestable.

Everything else in §3 can be argued about. These two cannot be added cheaply later.

## M0 — Walking skeleton
**Risk retired:** "Can the core loop work at all?"

One hand-written semantic model, one hand-written dashboard spec, rendered in a browser from a real
warehouse query, with the SQL visible. No AI, no auth, no editor, no PR loop. Deployed to a real
environment on day one so deployment is never a late surprise.

**Exit:** A developer changes a metric definition in a file, and the deployed dashboard reflects it.
ADR-001, ADR-003, ADR-004, ADR-005, ADR-006 and ADR-014 are written and agreed (all are, as of
2026-08-10); ADR-002 lands when Q-01 is answered and does not gate the exit.

## M1 — Governed consumption
**Risk retired:** "Can we serve real users trustworthy numbers, fast?"

Real users get real value here even with zero authoring capability. This milestone is shippable on
its own to a pilot group.

- Semantic layer with the metric coverage needed for one real subject area
- Dashboard rendering: core chart types, filters, cross-filtering, drill-down
- SSO, roles, object permissions, **row-level security**
- Result cache, query governor, observability
- Provenance badges and "how is this calculated?"
- The CLI and local dev loop for the data team

**Exit:** A pilot group of ~20 real consumers uses Tailwind instead of the legacy tool for one
subject area for two weeks, and the numbers are verified to match. p95 warm load < 2.5 s.

## M2 — AI authoring + the promotion loop
**Risk retired:** *the core product thesis.* "Will a data engineer merge what a business user's AI
produced?"

This is the milestone that decides whether the product is real. It is scoped narrowly on purpose:
a small number of real business users, one subject area, and heavy instrumentation of the review
experience.

- Ask-the-data over certified metrics (FR-AI-01/02)
- Build-with-AI producing draft dashboard specs (FR-AI-03/04)
- Draft workspace with `DRAFT` watermarking
- **Propose → PR** via service account (FR-GOV-01/02)
- CI: validate, compile, assert, **render screenshots**, **metric diff**
- In-app review status and comment mirroring

**Exit:** 30 business-authored PRs. ≥ 60% merged without a rewrite, median reviewer time ≤ 10 min.
See the kill criteria in `00-vision.md §7` — if these are missed, the authoring model gets
redesigned before anything scales.

## M3 — Production hardening & scale
**Risk retired:** "Does it hold up at hundreds of users and real content volume?"

- Visual (WYSIWYG) editor with lossless round-trip
- Scheduled delivery/subscriptions, exports, conditional formatting
- Preview environments per PR, rollback, impact analysis
- Admin surfaces: usage analytics, cache admin, cost attribution, AI spend
- Performance and load testing to Tier 2 (500 named / 50 concurrent)
- Accessibility pass on the consumption path
- Threat model, pen test

**Exit:** Tier-2 load test passes with NFR-PERF targets met. Security review signed off. GA.

## M4 — Migration & scale-out
**Risk retired:** "Can the organization actually leave Tableau/Power BI?"

- Legacy inventory and usage-based prioritization
- Side-by-side validation harness
- Coexistence directory and authoritative-source signaling
- Tier-3 scale work (5,000 named / 500 concurrent) informed by real Tier-2 telemetry
- Alerting, embedding, and the remaining `Could-have` set as demand dictates

**Exit:** The first legacy subject area is decommissioned, with sign-off from its business owner.

---

## Cut lines under schedule pressure

In order, first to go:

1. Visual editor (M3) — the AI path plus hand-editing covers authoring; the editor is adoption
   polish, not thesis-critical.
2. Scheduled delivery and exports beyond CSV.
3. Preview environments (FR-GOV-10) — screenshots plus metric diff carry most of the review value.
4. Column-level security (FR-SEC-05), *only* if no PII is in scope for the pilot subject area.

**Never cut:** row-level security, the metric diff in CI, provenance badges, or deterministic
serialization. Each is load-bearing for trust, and each is far more expensive to add later than to
build now.
