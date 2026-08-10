# Tailwind — Product Vision

**Status:** Draft v0.1 · Owner: Product · Audience: Systems Architect, Full-Stack Engineer

---

## 1. The one-sentence bet

**Tailwind is analytics-as-code with an AI authoring surface: business users describe what they
want in plain language, the AI composes it out of a governed semantic layer, and the data team
approves it through a pull request.**

Every dashboard, metric, and data model is a versioned text file. The AI is not a chatbot bolted
onto a BI tool — it is a *compiler from business intent into reviewable artifacts*. Nothing reaches
a shared audience without passing through the same review gate the data team already trusts.

## 2. Why the incumbents lose

| Tool | What it got right | Where it breaks |
|---|---|---|
| **Tableau / Power BI** | Genuine self-service; business users really do build things | Ungoverned sprawl. Ten workbooks, ten definitions of "revenue." No review gate, no diff, no test. The data team becomes a help desk, not an owner. |
| **Looker** | LookML in git — definitions are code, reviewed and versioned | Authoring is expert-only. A business user cannot write LookML, so the governance model has a bottleneck of exactly one team. AI is a feature, not the authoring model. |

Tailwind's claim: **you should not have to choose between self-service and a single source of
truth.** Governance is what makes AI authoring safe, and AI authoring is what makes governance
affordable. They are the same feature.

The failure mode we are explicitly designing against is the one every AI-BI demo hides:
*a confident chart with a wrong number.* Our answer is that the AI cannot invent a number — it can
only compose metrics that a human already certified, or open a PR proposing a new one.

## 3. Users

We serve four personas. The first two are the "customers" in the brief; the last two are the
people who make the system trustworthy and keep it running.

### P1 — Riley, the Consumer *(largest population, ~80%)*
Reads dashboards to make decisions. Filters, drills, exports to a deck. Will never write code, and
should never see YAML or SQL.
- **Job:** "Tell me what happened and whether I should worry."
- **Wins when:** the number is right, the page is fast, and she can answer a follow-up question
  without filing a ticket.

### P2 — Morgan, the Builder *(the growth persona, ~15%)*
Ops/finance/marketing analyst. Excel power user, maybe some SQL, definitely no git. Today they
export to a spreadsheet and build a shadow model because the official dashboard doesn't answer
their question.
- **Job:** "Build the view I need without waiting six weeks for the data team."
- **Wins when:** they describe a dashboard, see it working against real data in minutes, and can
  ship it to their team with a "Certified" badge on it.
- **This persona is the entire product thesis.** If Morgan can't get a PR merged, we've built Looker.

### P3 — Sam, the Analytics Engineer *(~5%, highest leverage)*
Owns the semantic layer. Reviews everything. Writes models by hand when precision matters and with
AI when speed matters.
- **Job:** "Keep the definitions correct and keep the queue short."
- **Wins when:** reviewing Morgan's PR takes 3 minutes because CI already rendered it, diffed the
  metric, and flagged the cost — not 3 hours of reverse-engineering.
- **Non-negotiable:** the hand-written path must be first-class. No AI required, ever. CLI, local
  preview, real tests, real files.

### P4 — Alex, the Platform Admin
Owns connections, SSO, permissions, spend, uptime.
- **Job:** "Nobody sees data they shouldn't, and nobody runs a $4,000 query."

## 4. The three loops

Product design is organized around three loops of increasing commitment. The escalator between
them is the thing we are actually selling.

| Loop | Who | Duration | Governed? | Output |
|---|---|---|---|---|
| **1. Consume** | Riley | seconds | Yes — certified metrics only | An answer |
| **2. Explore** | Morgan, Sam | minutes | No — sandboxed, watermarked `DRAFT` | A private draft |
| **3. Promote** | Morgan → Sam | hours–days | Yes — PR + CI + human review | A merged, shared artifact |

**Loop 1** includes natural-language Q&A, but answers are *compiled against the semantic layer*,
never free-form SQL against raw tables. If the question can't be answered from certified metrics,
we say so and offer to start Loop 2 — we do not guess.

**Loop 2** is a personal workspace. Drafts are shareable by link, but every draft chart carries a
visible `DRAFT — not reviewed` badge, and drafts cannot be subscribed to, embedded, or scheduled.
This is deliberate friction: it's the pressure that pushes good work into Loop 3.

**Loop 3** is the differentiator. Morgan clicks **Propose**; Tailwind opens a branch, commits the
spec, and opens a PR through a bot on their behalf. **Morgan never needs a git account.** CI then
does the review work a human would otherwise do by hand:

- **Renders the dashboard** against real data and posts screenshots to the PR.
- **Diffs the metric** — "this change moves FY24 revenue by −3.2%" — over a sample window.
- **Runs assertions** the data team wrote (`revenue_2024_q1 == 41_233_190 ± 0.1%`).
- **Estimates query cost** and flags anything above a threshold.
- **Runs impact analysis** — "17 dashboards depend on `dim_customer.segment`."

Sam reviews the *evidence*, not the YAML. Comments thread back into the app so Morgan sees them
without leaving Tailwind.

## 5. Product principles

1. **The semantic layer is the only way to compute a number.** No chart, AI response, or export
   bypasses it. This is the constraint that makes everything else safe.
2. **AI proposes, humans dispose.** Every AI action produces a diff, never a direct write to a
   shared artifact or a database.
3. **Text files are the source of truth.** The visual editor is a view over canonical YAML, not a
   separate format. Round-trip must be lossless and serialization deterministic, or the diff is
   worthless and the PR gate collapses.
4. **Provenance is always visible.** Every number carries a badge: `Certified`, `Draft`, or
   `AI-proposed, unreviewed`. Ambiguity about trust is a product bug.
5. **Governance is enforced at compile time, in the serving plane.** Row/column security is applied
   when the query is built — not filtered in the browser, and not dependent on which authoring path
   produced the chart.
6. **The hand-written path is never second-class.** If Sam's CLI workflow degrades to make the AI
   look better, we've lost the team that guarantees correctness.
7. **Slow is broken.** A governed number nobody waits for is a spreadsheet export in disguise.

## 6. Explicit non-goals for v1

Naming these protects the roadmap. Each is a defensible "later," not "never."

- **Not** a general SQL IDE or notebook environment.
- **Not** a data ingestion / ELT / transformation orchestrator. We consume a warehouse someone else
  loads. (dbt runs upstream of us, not inside us.)
- **Not** a data catalog or lineage product — we integrate with one, we don't become one.
- **Not** pixel-perfect paginated reporting (the Power BI Report Builder / Crystal use case).
- **Not** external/customer-facing embedded analytics with per-tenant branding.
- **Not** a Tableau workbook importer in v1 (see Q-08 — this may be forced on us by migration).
- **Not** offline or native mobile apps; responsive web only.

## 7. What v1 has to prove

The riskiest assumption in this entire product is not technical. It is:

> **A business user, assisted by AI, can produce an analytics artifact that a data engineer is
> willing to merge — and reviewing it is faster than building it from scratch.**

If that's false, Tailwind is an expensive Looker. Everything in the M0–M2 milestones exists to test
that assumption with a handful of real users before we build for thousands.

**Kill criteria for the thesis:** if, after 30 real Morgan-authored PRs, the merge rate is below
50% or median reviewer time exceeds the time Sam would have spent building it himself, we stop and
redesign the authoring model rather than scaling it.

## 8. Success metrics

| Horizon | Metric | Target |
|---|---|---|
| **Thesis (M2)** | Business-authored PRs merged without a rewrite | ≥ 60% |
| | Median reviewer time per business-authored PR | ≤ 10 min |
| **Adoption (M3)** | Weekly active consumers / licensed users | ≥ 40% |
| | Distinct business users who merged ≥ 1 artifact / quarter | ≥ 25% of Morgan population |
| **Trust** | Metric-definition conflicts found in production | 0 (structurally impossible by design) |
| | Corrections to a certified metric after merge | ≤ 5% of merges |
| **Health** | p95 warm dashboard load | < 2.5 s |
| | Cache hit rate on dashboard queries | > 85% |
| | Data-team hours/week spent on ad-hoc report requests | ↓ 50% vs. baseline |

Baselines for the last row must be captured **before** rollout — see `T-002`.

## 9. Clean slate

This definition assumes **no inherited technology decisions**. Prior scaffolding in this repo
(a Plotly Dash app, an Iceberg/Trino/DuckDB engine manifest) is treated as discarded prototype
work — useful as evidence of what was explored, binding on nothing. Every stack choice is open and
belongs to the architect, constrained only by the requirements in `01-requirements.md`.

One naming note: the codename **tailwind** collides with Tailwind CSS, which will be confusing in a
repo likely to use it. Cheap to change now, expensive after launch — see Q-14.
