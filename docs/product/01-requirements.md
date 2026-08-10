# Tailwind — Requirements

**Status:** Draft v0.1 · Audience: Systems Architect, Full-Stack Engineer

Requirement IDs are stable and referenced by tickets (`TICKETS.csv` → `req_ids`). Priority uses
MoSCoW scoped to **v1 GA**, not to the whole roadmap.

- `M` — Must have for GA
- `S` — Should have for GA
- `C` — Could have, cut first under pressure
- `W` — Won't have in v1, recorded so it isn't re-litigated

---

## FR-SEM — Semantic layer

The heart of the system. Everything else composes against it.

| ID | Pri | Requirement |
|---|---|---|
| FR-SEM-01 | M | Semantic models are declared in version-controlled text files defining: entities, joins/relationships, dimensions, measures, and named metrics. |
| FR-SEM-02 | M | A **metric** is defined exactly once and has a single canonical definition system-wide. Two artifacts referencing `revenue` are guaranteed to compute identically. |
| FR-SEM-03 | M | Metrics support: simple aggregations, ratios, filtered measures, derived/composed metrics, and time-offset comparisons (YoY, MoM, period-to-date). |
| FR-SEM-04 | M | A canonical time spine supports date-grain rollups (day/week/month/quarter/year) and fiscal calendars. |
| FR-SEM-05 | M | The query compiler translates a semantic request (metrics + dimensions + filters + grain) into engine-specific SQL, resolving joins and preventing fan-out/chasm-trap double counting. |
| FR-SEM-06 | M | Every model, dimension, and metric carries required metadata: owner, description, certification status, and last-reviewed date. Missing metadata fails CI. |
| FR-SEM-07 | M | Certification states: `certified`, `draft`, `deprecated`. Deprecated metrics still resolve but surface a warning and a suggested replacement. |
| FR-SEM-08 | S | Metric-level assertions (golden-value tests) run in CI: `revenue[2024-Q1] == 41233190 ± 0.1%`. |
| FR-SEM-09 | S | Impact analysis: given a model/metric change, list every downstream metric and dashboard affected. |
| FR-SEM-10 | C | Column-level lineage back to warehouse source tables. |
| FR-SEM-11 | M | Specs are validated against a published JSON Schema; validation is available in-editor, in the CLI, and in CI with identical results. |
| FR-SEM-12 | M | Warehouse dialects carry a published support tier — `certified` (full conformance, live CI, cost model, RLS, perf baseline, SLA), `beta` (compiles, smoke-tested, no guarantees), `experimental` (untested, inherited from the adopted engine). Exactly one `certified` dialect at GA. |
| FR-SEM-13 | M | A dialect-parameterized conformance suite defines what "supported" means: every metric shape × grain × join topology, with expected results against a standard seeded dataset. Adding a dialect means passing it. |

## FR-FRESH — Data freshness classes

Freshness is **not** a global setting. Different dashboards have structurally different staleness
budgets, and that difference drives caching, cost, and query topology. Declaring it per artifact —
in the spec, under review — makes it a governed property rather than a knob someone quietly turns.

| ID | Pri | Requirement |
|---|---|---|
| FR-FRESH-01 | M | Every dashboard declares a **freshness class** in its spec: `batch` (≤ 24 h), `standard` (≤ 30 min, the default), or `operational` (≤ 60 s). Charts may override downward within a dashboard. |
| FR-FRESH-02 | M | The freshness class drives cache behavior automatically: `batch` = long TTL with post-ELT pre-warm; `standard` = TTL plus invalidation on upstream refresh; `operational` = micro-TTL or cache bypass. Authors do not configure caching directly. |
| FR-FRESH-03 | M | Every chart surfaces its actual as-of timestamp and its declared class, so a stale `operational` chart is visibly wrong rather than silently wrong (extends FR-CON-03). |
| FR-FRESH-04 | M | Promoting an artifact to `operational` requires data-team approval regardless of author role — it is the expensive class, and CI surfaces its projected query cost (ties to FR-GOV-06/07). |
| FR-FRESH-05 | S | Upstream refresh completion is signalled to Tailwind (ELT webhook preferred; warehouse metadata polling as fallback) and drives invalidation for `batch` and `standard`. |
| FR-FRESH-06 | S | An admin can see, per dashboard, the declared class versus the freshness actually achieved, so drift is detectable. |
| FR-FRESH-07 | W | Write-back — taking an action on a record from within a worklist. Explicit non-goal; see `00-vision.md §6`. |

## FR-VIZ — Dashboards & visualization

| ID | Pri | Requirement |
|---|---|---|
| FR-VIZ-01 | M | Dashboards are declarative specs (YAML/JSON) in version control — layout, charts, filters, parameters, and semantic-layer references only. **No embedded SQL.** |
| FR-VIZ-02 | M | A visual (WYSIWYG) editor reads and writes the same canonical spec. Round-trip is lossless; serialization is deterministic (stable key order, normalized formatting) so diffs are reviewable. |
| FR-VIZ-03 | M | Chart types for v1: line, bar (grouped/stacked), area, scatter, pie/donut, table, pivot table, single-value KPI, sparkline, heatmap, and combo (dual-axis). |
| FR-VIZ-04 | M | Interactions: cross-filtering between charts, drill-down along a dimension hierarchy, drill-through to row-level detail (subject to permissions), tooltips, legend toggling. |
| FR-VIZ-05 | M | Dashboard-level filters and parameters, with defaults, URL-encoded state (shareable links), and per-user sticky state. |
| FR-VIZ-06 | M | Export: PNG/SVG per chart, CSV/XLSX per chart's underlying result set, PDF for the dashboard. Exports respect row-level security. |
| FR-VIZ-07 | S | Scheduled delivery (email/Slack) of a dashboard snapshot; subscriptions are per-user and permission-checked at send time. |
| FR-VIZ-08 | S | Conditional formatting and threshold/target markers. |
| FR-VIZ-09 | S | Responsive layout down to tablet; graceful (read-only, single-column) phone rendering. |
| FR-VIZ-10 | C | Alerting on metric thresholds/anomalies. |
| FR-VIZ-11 | C | Embedding a dashboard/chart in an internal wiki or app via signed iframe URL. |
| FR-VIZ-12 | W | Pixel-perfect paginated/print reporting. |

## FR-CON — Consumption experience

| ID | Pri | Requirement |
|---|---|---|
| FR-CON-01 | M | Home/browse: search and filter dashboards by name, owner, certification, tag, and recency. |
| FR-CON-02 | M | Every chart displays its provenance badge (`Certified` / `Draft` / `AI-proposed, unreviewed`) and a one-click "how is this calculated?" panel showing the metric definition in plain language plus the generated SQL. |
| FR-CON-03 | M | Data freshness indicator per chart (as-of timestamp of the underlying source). |
| FR-CON-04 | S | Favorites, recently viewed, and personal collections. |
| FR-CON-05 | S | Comment/annotate on a dashboard or a specific data point, with @mentions. |
| FR-CON-06 | C | "Explain this dashboard" — AI-generated plain-language summary of trends and anomalies visible on screen. |

## FR-AI — AI assistance

Applies equally to Morgan and Sam. The AI is a proposal engine, never a writer of shared state.

| ID | Pri | Requirement |
|---|---|---|
| FR-AI-01 | M | **Ask the data** (Loop 1): natural-language question → answer composed from certified metrics. The system returns the metric(s) used, the filters applied, and the generated SQL. |
| FR-AI-02 | M | If a question cannot be answered from certified metrics, the assistant says so explicitly and offers to open an exploration draft. **It must not fall back to free-form SQL over raw tables in the consumption path.** |
| FR-AI-03 | M | **Build with AI** (Loop 2): natural-language description → a draft dashboard spec, executed against real data, shown to the user with the spec diff visible. |
| FR-AI-04 | M | AI output is always a **proposed diff** to one or more spec files. The user can inspect, edit by hand, re-prompt, or discard before anything is proposed. |
| FR-AI-05 | M | AI grounding context includes: semantic layer definitions, model/metric descriptions, warehouse schema, existing dashboards as few-shot examples, and the team's authored documentation. |
| FR-AI-06 | M | AI-generated specs are validated and compiled before being shown. A spec that fails validation is repaired automatically (bounded retries) or reported as a failure — never surfaced as a broken draft. |
| FR-AI-07 | S | AI can propose a **new metric** when none exists, but such a proposal is flagged `new-metric` and requires data-team review regardless of the requester's role. |
| FR-AI-08 | S | Conversation history per draft, so a user can iterate ("make it monthly", "split by region") without re-describing. |
| FR-AI-09 | M | Per-user and per-org AI spend limits with hard cutoffs and admin visibility. |
| FR-AI-10 | S | An offline eval suite of representative questions with expected metrics/SQL, run in CI, gating prompt and model changes on a regression threshold. |
| FR-AI-11 | M | Sensitive-data controls: configurable policy governing which schema metadata and sample values may be sent to the model provider; column-level exclusion for PII. |
| FR-AI-12 | C | AI-assisted **review** — a summary comment on each PR explaining what changed in business terms. |

## FR-GOV — Governance & the promotion loop

The differentiator. Treat as first-class product, not plumbing.

| ID | Pri | Requirement |
|---|---|---|
| FR-GOV-01 | M | **Propose** action in-app: creates a branch, commits the spec change, and opens a PR via a service account. Authors do **not** need their own git-host account. |
| FR-GOV-02 | M | PR status is visible in-app (open / changes requested / approved / merged), with review comments mirrored bidirectionally so the author can respond without leaving Tailwind. |
| FR-GOV-03 | M | CI on every PR: schema validation, semantic compilation, metric assertions, and lint. Failing CI blocks merge. |
| FR-GOV-04 | M | CI renders affected dashboards against real data and attaches screenshots to the PR. |
| FR-GOV-05 | M | CI posts a **metric diff** for changed metric definitions — before/after values over a defined sample window, with % delta. |
| FR-GOV-06 | S | CI posts an estimated query cost/scan volume, flagging anything over an admin-set threshold. |
| FR-GOV-07 | M | CODEOWNERS-style routing: changes to semantic models require data-team approval; dashboard-only changes may be approved by a domain owner. |
| FR-GOV-08 | M | Merge to the main branch triggers deployment of the artifact to all users, with a visible changelog entry. |
| FR-GOV-09 | S | One-click rollback of a merged artifact to a prior version. |
| FR-GOV-10 | S | Ephemeral preview environment per PR so a reviewer can interact with the proposed dashboard live, not just via screenshots. |
| FR-GOV-11 | M | Full audit trail: who changed what, when, approved by whom — derived from git history and surfaced in the app UI. |

## FR-DEV — Data-team (code-first) experience

| ID | Pri | Requirement |
|---|---|---|
| FR-DEV-01 | M | A CLI supporting: validate, compile-to-SQL, run a metric query, render a dashboard locally, and run tests — with no dependence on the hosted app. |
| FR-DEV-02 | M | Local development loop: clone the repo, point at a warehouse, preview dashboards on localhost with hot reload. |
| FR-DEV-03 | M | Published JSON Schema for all spec types, enabling editor autocomplete/validation (VS Code). |
| FR-DEV-04 | S | Spec formatter (`fmt`) producing the same canonical output as the visual editor, so hand-edits and UI edits never fight. |
| FR-DEV-05 | S | Bulk/programmatic operations: generate or refactor many specs at once (e.g. rename a dimension across all dashboards). |
| FR-DEV-06 | C | Import of existing dbt model + metric metadata to bootstrap the semantic layer. |

## FR-SEC — Security, identity, access

| ID | Pri | Requirement |
|---|---|---|
| FR-SEC-01 | M | SSO via OIDC/SAML; no local password store. |
| FR-SEC-02 | M | Group/role sync from the IdP (SCIM or equivalent); Tailwind roles: Viewer, Builder, Reviewer, Admin. |
| FR-SEC-03 | M | Object-level permissions on dashboards, models, and connections (view / edit / manage). |
| FR-SEC-04 | M | **Row-level security** applied during query compilation from user attributes/groups. Never client-side, never bypassable by an authoring path. |
| FR-SEC-05 | S | Column-level security / masking for PII, honored in charts, exports, drill-through, and AI context. |
| FR-SEC-06 | M | Warehouse credentials are never exposed to the browser or to the AI provider; connections are secrets-managed and admin-scoped. |
| FR-SEC-07 | M | Immutable audit log of authentication, permission changes, query execution (user, dashboard, SQL, cost), exports, and AI prompts/responses. |
| FR-SEC-08 | S | Per-user warehouse identity passthrough (OAuth) as an alternative to a shared service account, where the warehouse supports it. |

## FR-ADM — Administration

| ID | Pri | Requirement |
|---|---|---|
| FR-ADM-01 | M | Connection management: create/test/rotate warehouse connections; scoped to environments (dev/staging/prod). |
| FR-ADM-02 | M | Usage analytics: most-viewed dashboards, unused dashboards, slowest queries, most expensive queries, AI spend by user. |
| FR-ADM-03 | S | Query governor: per-user concurrency caps, statement timeouts, and result-row limits. |
| FR-ADM-04 | S | Cache administration: view hit rate, force-invalidate, configure per-dashboard TTL and scheduled pre-warm. |
| FR-ADM-05 | C | Content lifecycle: flag dashboards unused for N days for archival. |

## FR-MIG — Migration & coexistence

Pending Q-08; scope may expand significantly.

| ID | Pri | Requirement |
|---|---|---|
| FR-MIG-01 | M | Inventory tooling: enumerate existing Tableau/Power BI content with usage stats to prioritize what actually needs porting (expect a long tail of dead reports). |
| FR-MIG-02 | S | Side-by-side validation harness: run a legacy report and its Tailwind equivalent and diff the numbers, as migration acceptance evidence. |
| FR-MIG-03 | C | Assisted conversion: parse a legacy workbook into a *starting-point* Tailwind spec for human completion. Explicitly not a lossless importer. |
| FR-MIG-04 | S | Coexistence period: Tailwind and the legacy tool run against the same warehouse; a directory page indicates the authoritative source per subject area. |

---

## Non-functional requirements

Scale target is stated as three steps because the architecture must not need a rewrite between them.

| ID | Pri | Requirement |
|---|---|---|
| NFR-PERF-01 | M | p95 warm dashboard load (cache hit) < 2.5 s; p95 cold < 8 s. |
| NFR-PERF-02 | M | p95 interaction latency (filter/cross-filter, cached) < 800 ms. |
| NFR-PERF-03 | S | AI first-token < 2 s; complete draft dashboard proposal p95 < 30 s, with streaming progress. |
| NFR-SCALE-01 | M | Tier 1: 50 named users. Tier 2: 500 named / ~50 concurrent. Tier 3: 5,000 named / ~500 concurrent, ~50 dashboard-query QPS at peak. Same architecture across all three; scale by adding replicas, not by redesign. |
| NFR-SCALE-02 | M | Application tier is stateless and horizontally scalable; all session/cache state is external. |
| NFR-SCALE-03 | M | Result cache with correctness-safe invalidation keyed on spec version + data freshness + the requesting user's security context. Hit-rate targets are **per freshness class**: `batch` > 95%, `standard` > 85%, `operational` not applicable. A blended target is meaningless and must not be used as a load-test criterion. |
| NFR-SCALE-04 | S | Query queue with per-user fairness so one heavy user cannot starve the tenant. |
| NFR-AVAIL-01 | M | 99.9% monthly availability for the consumption path. Degraded mode: if the AI provider or git host is down, viewing and filtering still work. |
| NFR-AVAIL-02 | M | Zero-downtime deploys; artifact deployment (a merge) never interrupts active sessions. |
| NFR-AVAIL-03 | S | RPO ≤ 1 h, RTO ≤ 4 h for application state. Artifacts are in git and therefore inherently recoverable. |
| NFR-TEN-01 | M | Tenant is a first-class scope in the artifact registry, cache keys, connection management, RLS context, audit log, and repository layout. *(Q-03 decided: internal-first, tenant-ready.)* |
| NFR-TEN-02 | M | Every non-production environment runs with at least two tenants seeded from M0, so single-tenant assumptions cannot accumulate undetected. |
| NFR-TEN-03 | W | Tenant-facing surfaces — per-tenant branding, billing, self-signup, tenant admin — are out of scope for v1. Isolation only. |
| NFR-SEC-01 | M | Encryption in transit (TLS 1.2+) and at rest. Secrets in a managed secret store, never in the repo or images. |
| NFR-SEC-02 | M | Dependency and container scanning in CI; no known criticals shipped to production. |
| NFR-SEC-03 | S | Pen-test and threat model completed before GA. Prompt-injection via warehouse *data* (not just user input) is in scope for the threat model. |
| NFR-COST-01 | S | Per-query cost attribution to user and dashboard; monthly warehouse and AI spend reporting with alert thresholds. |
| NFR-OPS-01 | M | Structured logging, distributed tracing across app → compiler → warehouse, and RED metrics per endpoint. Every query traceable to a user, dashboard, and spec version. |
| NFR-OPS-02 | M | Infrastructure as code; reproducible environments for dev/staging/prod. |
| NFR-OPS-03 | S | Feature flags for progressive rollout of AI features and new chart types. |
| NFR-A11Y-01 | S | WCAG 2.1 AA for the consumption path: keyboard navigation, screen-reader labels on charts, colorblind-safe default palettes, data-table fallback for every chart. |
| NFR-A11Y-02 | C | WCAG 2.1 AA for the authoring path. |
| NFR-QUAL-01 | M | Deterministic, byte-stable spec serialization — verified by a property test (parse → serialize → parse is a fixed point). The entire review model depends on this. |
| NFR-QUAL-02 | S | Semantic compiler has golden-file tests per supported SQL dialect. |
