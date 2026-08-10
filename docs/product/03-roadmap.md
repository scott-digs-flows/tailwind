# Tailwind — Roadmap & Release Plan

**Status:** Draft v0.1

Milestones are sequenced by **risk retired**, not by feature area. Each has an exit criterion that
is a demonstrable behavior, not a checklist of merged tickets.

> **M0–M2 is the POC** (81 tickets); **M3–M4 is GA** (33 tickets). Per Q-05, production concerns —
> availability, scale, security assurance, authoring polish — are deliberately deferred past M2.
> See [08-poc-scope.md](08-poc-scope.md) for what's out, what stays anyway, and the triggers that
> pull deferred work back in.

Durations are deliberately omitted — they depend on team size and the answers to Q-01…Q-06.
Relative sizing is captured in `TICKETS.csv` (`size` column: S/M/L/XL).

---

## M0 — Walking skeleton
**Risk retired:** "Can the core loop work at all?"

One hand-written semantic model, one hand-written dashboard spec, rendered in a browser from a real
warehouse query, with the SQL visible. No AI, no auth, no editor, no PR loop. Deployed to a real
environment on day one so deployment is never a late surprise.

**Exit:** A developer changes a metric definition in a file, and the deployed dashboard reflects it.
ADR-001 through ADR-006 are written and agreed.

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
