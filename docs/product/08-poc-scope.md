# Tailwind — POC Scope Boundary

**Status:** Draft v0.1 · Audience: Systems Architect, Full-Stack Engineer
**Origin:** Q-05 answered "out of scope, too complicated for a POC — I mostly want to get the
product idea right."

That answer reframes the project, and the reframe is worth making explicit rather than leaving the
architect to infer it from a requirements doc that reads like a GA spec.

> **We are building a POC to test one hypothesis, not a production system on a slower schedule.**

Everything below exists so the architect knows what to *deliberately not build* — and, just as
importantly, what stays in despite being "production concerns," because retrofitting it is a
rewrite rather than an addition.

---

## 1. The hypothesis

Unchanged from `00-vision.md §7`:

> A business user, assisted by AI, can produce an analytics artifact that a data engineer is
> willing to merge — and reviewing it is faster than building it from scratch.

**POC = milestones M0 through M2.** GA concerns begin at M3. If the hypothesis fails at M2, none of
the M3+ work would have mattered.

## 2. Deferred for the POC

Not cancelled — deferred, with an explicit trigger in §4 that brings each one back.

| Area | Deferred | Why it's safe to defer |
|---|---|---|
| **Data residency & AI egress policy** (Q-05) | Formal Security/Legal review, egress controls, provider contracting | POC runs on a non-sensitive subject area. **Conditional on §3.1.** |
| **Availability** | 99.9% SLA, multi-region, zero-downtime deploys, RPO/RTO drills | Pilot users tolerate a restart. Nothing depends on it yet. |
| **Identity** | SCIM provisioning, fine-grained object permissions | Manual role assignment for ~15 pilot users. SSO itself stays (§3.3). |
| **Security assurance** | Pen test, formal threat model, column-level masking | Replace with a one-page lightweight threat model. Full review is an M3 gate. |
| **Scale** | Query queue, per-user fairness, Tier-2/3 load testing, cache pre-warm | 15 users. Measure instead of engineer (§5). |
| **Tenancy ceremony** | Two-tenant seeding in all environments, mandatory two-tenant design reviews (NFR-TEN-02) | See §6 — the tension with Q-03. |
| **Authoring polish** | Visual/WYSIWYG editor (T-038) | The AI path plus hand-editing tests the hypothesis. The editor is adoption polish. |
| **Delivery** | Scheduled subscriptions, PDF/XLSX export, embedding, alerting | Not on the hypothesis path. |
| **Operations** | Cost attribution reporting, cache admin UI, content lifecycle | Instrument (§5), don't build UI for it. |
| **Accessibility** | Formal WCAG audit | Keep colorblind-safe palettes and keyboard basics as hygiene; audit at M3. |
| **Migration** | Everything in FR-MIG except the usage inventory | The inventory stays — it picks the pilot subject area. |

## 3. Not deferrable, despite looking like GA concerns

Each of these is cheap now and a rewrite later. This list is the reason to read this document.

### 3.1 The security context, even if permissively populated
Row-level security (FR-SEC-04) may not be *exercised* in the POC if the pilot subject area has no
access differences. But the **security context must be a first-class parameter of the compiler API
and the cache key from the first query.** Populate it with a permissive predicate if you must.
Retrofitting a security dimension into a compiler and a cache is a rewrite of both — the single
most expensive thing on this page to get wrong.

### 3.2 Deterministic, lossless serialization (NFR-QUAL-01)
The entire review model is diffs. Noisy diffs mean the PR gate is theater and the hypothesis can't
be tested. This is POC-critical, not GA-critical.

### 3.3 SSO
Real business users, real data, real habits. Manual accounts distort the pilot and create a
credential-handling problem that is more work than wiring OIDC.

### 3.4 The single-definition guarantee (FR-SEM-02, T-102)
If two metrics named `revenue` can coexist during the POC, we are testing a different product.

### 3.5 The full CI evidence pipeline
Validate, compile, assert, **render screenshots**, **metric diff**. Reviewer time is the metric the
hypothesis turns on — a POC without the evidence pipeline measures the wrong thing and will
under-report the product's value.

### 3.6 Provenance badges
`Certified` / `Draft` / `AI-proposed, unreviewed`. Trust behavior is a large part of what we're
observing.

### 3.7 Freshness classes (FR-FRESH-01/02)
Declared per artifact from day one. Only `standard` needs to *work* in the POC (§7), but the class
must exist in the spec — it shapes the cache API, and cache APIs are painful to re-cut.

## 4. Triggers that end a deferral

Deferrals rot into permanent debt without a stated trigger. Any one of these fires, the
corresponding item returns to scope **before** the next release:

| Trigger | Brings back |
|---|---|
| Regulated, customer, or PII data enters a dashboard | Q-05 in full — Security/Legal review, egress policy, column masking |
| More than ~25 active users | Object permissions, query governor, availability work |
| Anyone outside the pilot team depends on a dashboard for a real decision | Availability, backup/restore, on-call |
| A second tenant or an external customer appears | The whole SaaS question (§6) |
| The pilot subject area has genuine row-level access differences | RLS enforcement, exercised and tested |
| An `operational`-class dashboard is requested | §7 |

**Suggested mechanic:** review this table at the M2 exit. It is a five-minute conversation that
prevents a year of accumulated debt.

## 5. Volumetrics: measure, don't guess (Q-19)

You didn't know the numbers. That's fine and it doesn't block anything — but the architect needs
*something* to design against, so here are planning assumptions, explicitly labelled as such.

| Dimension | Planning assumption | Confidence |
|---|---|---|
| Largest dashboard-backing table | 10⁸–10⁹ rows | Low — verify before ADR-008 |
| Typical query scan volume | ≤ 10 GB | Low |
| Result set returned to one chart | ≤ 10k rows; hard cap 50k via governor (FR-ADM-03) | Medium — this is a design choice, not a measurement |
| Metrics at POC / at GA | 20–40 / 50–200 | Medium |
| Dashboards at POC / at GA | 5–15 / 20–100 | Medium |
| Charts per dashboard | 6 | High |
| Concurrency | Per NFR-SCALE-01 tiers | High |
| Refresh cadence | 30 min (`standard`) | **Confirmed** |

**The mechanism that replaces these:** T-081 (observability) lands in M1 and captures query
latency, scan volume, result size, and cache behavior from real usage. By M1 exit these become
measurements, and ADR-008 (cache topology) should be **written or revised after that data
exists** — not before.

The two that genuinely matter early: *largest table size* and *typical scan volume*. Both are one
query against warehouse metadata. Worth ten minutes with whoever runs the warehouse before ADR-008.

## 6. The Q-03 tension — flagging, not resolving

You made two decisions that pull in opposite directions:

- **Q-03:** carry a tenant ID from day one, specifically to avoid a later rewrite.
- **Q-05 response:** *"Redesigning later for SaaS opportunities won't be a concern."*

The second walks back the reason for the first. I'd rather surface that than silently pick one.

**My recommendation — split the difference, because the two halves have wildly different costs:**

- **Keep** `tenant_id` threaded through the schema, cache keys, and security context. During a POC
  this is near-free: a column, a key component, a filter. It preserves the option.
- **Drop** the ceremony — NFR-TEN-02's two-tenant seeding in every environment, and mandatory
  two-tenant design reviews. That's real recurring effort buying insurance you've now said you
  don't need.

Net effect: you keep the cheap 80% of the option value and stop paying for the expensive 20%.
NFR-TEN-01 stays `Must` (schema-level only); NFR-TEN-02 moves to POC-deferred with the §4 trigger.

**Say so if you disagree** — the alternative (drop tenancy entirely) is also defensible and saves a
little more, it just means a genuine data-model migration if SaaS ever happens.

## 7. Operational freshness — a scope risk worth naming

Your example of a near-live dashboard was *"what do I work on next."* That is a **worklist**:
row-level, per-user, action-oriented, near-real-time. It is a different product shape from an
analytical dashboard, and it's worth being deliberate rather than absorbing it by accident.

**Why it's genuinely different:**
- Row-level detail queries, not aggregates. Semantic layers are built for aggregates; a worklist
  may fit the adopted engine awkwardly (feed into ADR-003).
- Per-user filtering makes RLS load-bearing rather than optional — it changes §3.1 from
  "design it in" to "build it now."
- Near-live means no meaningful cache, so cost scales with users × refresh rate. On a
  consumption-priced warehouse this is the most expensive thing in the product.
- It invites *"can I click to mark this done?"* — write-back. Firmly a non-goal (FR-FRESH-07), and
  the pressure will be real.

**Recommendation:**
1. Build the freshness class into the spec now (§3.7) so `operational` is expressible.
2. Make `operational` require data-team approval with cost surfaced in CI (FR-FRESH-04). This is a
   nice fit with the product thesis — the PR gate becomes the cost gate too.
3. **Do not pilot on the operational use case.** Pilot on `standard`. The hypothesis is about
   governed AI authoring; mixing in real-time muddies the result and you won't know which part
   failed.
4. Revisit `operational` at M3 alongside the extract-engine spike (T-100) — they're the same
   architectural conversation from opposite ends.

## 8. What this means for the architect

Read `01-requirements.md` as the **GA** target and this document as the **POC** filter. Where they
conflict, this document wins until M3.

Concretely: build the walking skeleton, the semantic layer, the PR loop, and the CI evidence
pipeline properly. Stub or skip availability, scale, and assurance. Keep the security context and
the freshness class in the API shape from day one even where they're inert.
