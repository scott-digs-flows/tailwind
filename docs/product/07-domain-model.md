# Tailwind — Domain Model, State Ownership & Core Flows

**Status:** Draft v0.1 · Audience: Systems Architect, Full-Stack Engineer
**Purpose:** Pin down the vocabulary, say where every piece of state lives, and specify the
promotion loop precisely enough to design against. The other docs describe this in prose; an
architect needs it as states and boundaries.

---

## 1. Glossary

Used with precision throughout the docs. Where a term is overloaded in the BI industry, the
Tailwind meaning is the one below.

| Term | Meaning |
|---|---|
| **Artifact** | Any versioned, reviewable file: a semantic model, metric, dashboard, or test. If it lives in git and a human reviews changes to it, it's an artifact. |
| **Spec** | The canonical serialized form of an artifact. Deterministic and lossless (NFR-QUAL-01). |
| **Semantic model** | A declaration of an entity, its joins, dimensions, and measures. |
| **Measure** | A raw aggregation over a column (`sum(amount)`). Not directly consumable by a chart. |
| **Metric** | A named, certified, business-meaningful quantity built from measures. **The only thing a chart or an AI answer may reference.** |
| **Draft** | An unmerged, personal work-in-progress. Lives in the operational DB, not git. Watermarked, unshareable beyond a link, never schedulable. |
| **Proposal** | A draft submitted for review — materializes as a branch, a commit, and a PR. |
| **Artifact bundle** | The immutable, compiled set of all artifacts produced by one merge commit. What the serving plane actually loads. |
| **Publish** | Promoting an artifact bundle to the serving plane. Triggered by merge, reversible by rollback. |
| **Security context** | The resolved tuple of (tenant, user identity, groups, row predicates, column masks) for one request. Input to both query compilation and cache keying. |
| **Certification** | An artifact's trust state: `certified`, `draft`, or `deprecated` (FR-SEM-07). Distinct from the *dialect* tiers below. |
| **Dialect tier** | A warehouse's support level: `certified`, `beta`, `experimental` (FR-SEM-12). |
| **Conformance suite** | The dialect-parameterized test set that *defines* what "supported" means (FR-SEM-13). |
| **Tenant** | An isolation boundary, identified by a stable lowercase slug that is also a git path segment and a cache-key namespace (ADR-014 D1). Exactly one at v1 (`internal`). Two-tenant seeding in non-prod (NFR-TEN-02) is **deferred past the POC** per `08-poc-scope.md §6`; ADR-014 §D6 substitutes three mechanical checks. |

## 2. State ownership: git vs. the operational database

The most consequential boundary in the system, and the one most likely to erode silently.

### The rule

> **If a human should review a change to it, it lives in git. If it is runtime, personal, or
> operational, it lives in the database.**
>
> **And: nothing in the database may change a number.**

That second clause is the load-bearing one. The moment a DB row can alter a computed value, you
have an ungoverned input and the entire PR gate becomes theater.

**The one deliberate nuance:** the security context *is* runtime state (derived from IdP groups)
and it *does* change what a user sees. It may **restrict rows and mask columns**. It may never
alter a metric's definition. Restriction is not redefinition — the same metric under two security
contexts must be the same metric, computed over different row sets.

### Where things live

| Git (reviewed, source of truth) | Operational DB (runtime, not reviewed) |
|---|---|
| Semantic models, dimensions, measures, metrics | Users, sessions, role assignments cached from the IdP |
| Dashboard specs | Tenants |
| Metric assertions / tests | **Drafts** and their AI conversation history |
| CODEOWNERS and review routing | Favorites, recents, collections |
| Documentation the AI grounds on | Comments and annotations |
| Connection *definitions* (non-secret) | Subscriptions and schedules |
| | Audit log, query log, cost attribution |
| | Published-bundle registry (commit SHA → bundle location) |
| | Feature flags |

**Neither:** warehouse credentials and API keys live in the secret store, referenced by both.
**Neither:** query results live in the result cache, keyed by security context (ADR-008).

### Consequences the architect should note

- **Drafts are DB state, proposals are git state.** The Propose action is the moment of
  transition, and it is the only writer from DB → git.
- Comments exist in two places by design (FR-GOV-02 mirrors them to the PR). The DB is the
  system of record for display; the git host is the system of record for the review decision.
- Deleting a tenant must not require rewriting git history. Tenant scoping in the repo layout
  (ADR-014) should keep artifacts separable by path, not interleaved.

## 3. The promotion loop as a state machine

The differentiator, specified. Every transition needs an owner in the UI and an audit event.

```
                    ┌─────────┐
   AI or hand edit  │  DRAFT  │◀──────────────┐
        ──────────▶ │ (DB)    │               │ author revises
                    └────┬────┘               │
                 Propose │                    │
                         ▼                    │
                  ┌─────────────┐   fail   ┌──┴────────────┐
                  │  PROPOSED   │─────────▶│ CHANGES_      │
                  │ (PR open,   │◀─────────│ REQUESTED     │
                  │  CI running)│  re-push └───────────────┘
                  └──────┬──────┘                  ▲
                    CI ok│                         │ reviewer rejects
                         ▼                         │
                  ┌─────────────┐──────────────────┘
                  │  APPROVED   │
                  └──────┬──────┘
                    merge│
                         ▼
                  ┌─────────────┐   rollback   ┌──────────────┐
                  │  PUBLISHED  │─────────────▶│ ROLLED_BACK  │
                  └─────────────┘              └──────────────┘

   Any state before PUBLISHED ──author or reviewer closes──▶ ABANDONED
```

### Transition specifications

| Transition | Trigger | System does | Author sees |
|---|---|---|---|
| → `DRAFT` | AI generation or hand edit | Persist draft + conversation to DB | Live preview, `DRAFT` watermark |
| `DRAFT` → `PROPOSED` | Author clicks **Propose** | Branch, commit (attributed to author in trailer), PR via service account (FR-GOV-01) | PR link, CI progress, in-app status |
| `PROPOSED` → `PROPOSED` | CI completes | Attach screenshots (FR-GOV-04), metric diff (FR-GOV-05), cost estimate (FR-GOV-06) | Rendered evidence, pass/fail |
| `PROPOSED` → `CHANGES_REQUESTED` | Reviewer requests changes, **or CI fails** | Mirror comments to app (FR-GOV-02) | Comments inline on the draft, not raw YAML |
| `CHANGES_REQUESTED` → `PROPOSED` | Author revises and re-proposes | Amend branch, re-run CI | Updated evidence |
| `PROPOSED` → `APPROVED` | Reviewer approves per CODEOWNERS (FR-GOV-07) | Enable merge | Approval, who approved |
| `APPROVED` → `PUBLISHED` | Merge to main | Build immutable bundle, publish, changelog (FR-GOV-08) | "Live" state, changelog entry |
| `PUBLISHED` → `ROLLED_BACK` | Admin rollback (FR-GOV-09) | Repoint serving to prior bundle | Notification to author and owner |
| any → `ABANDONED` | Close without merge | Close PR, retain draft in DB | Draft still editable |

### Edge cases the design must answer

These are the ones that will surface in week two of implementation, not week twenty.

1. **Concurrent edits.** Two authors propose changes to the same dashboard. Morgan will not resolve
   a merge conflict. Options: branch-per-draft with optimistic detection at Propose time and an
   app-mediated "your draft is based on an older version — rebase preview?" flow. Needs a decision.
2. **CI fails *after* approval.** Approval must not be a merge authorization that outlives a
   failing check.
3. **The PR is edited outside the app.** Sam pushes a fix directly to Morgan's branch — a good and
   expected behavior. The app must reconcile, not overwrite.
4. **The PR is merged outside the app.** The app cannot assume it is the only actor; publish must
   be driven by the merge webhook, not by the in-app button.
5. **Author departs.** Ownership of a merged artifact (Q-17) and of an orphaned open PR.
6. **Rollback of a bundle containing several merges.** Is rollback per-artifact or per-bundle?
   Per-bundle is simpler and safer; per-artifact is what users will ask for.
7. **A draft references a metric that is deprecated or deleted before merge.** CI must catch it;
   the author needs a comprehensible message, not a compiler error.

## 4. Integration inventory

Every external dependency, with its status. Anything `OPEN` is a question, not an assumption.

| System | Purpose | Requirements | Status |
|---|---|---|---|
| Identity provider | SSO, group sync | FR-SEC-01/02 | **OPEN** — which IdP, SCIM available? |
| Git host | Artifact storage, PR review, webhooks | FR-GOV-01/02, ADR-010 | **OPEN (Q-06)** — and can we hold a service account? |
| Warehouse | Query execution | FR-SEM-05, ADR-002 | **OPEN (Q-01)** |
| Model provider | AI features | FR-AI-*, ADR-011 | **OPEN (Q-05)** — egress policy dependent |
| Secret store | Warehouse credentials, API keys | FR-SEC-06, NFR-SEC-01 | **OPEN** — existing standard? |
| CI system | The review gate | FR-GOV-03/04/05 | **OPEN** — assumed same as git host |
| Email / Slack | Subscriptions, notifications | FR-VIZ-07 | **OPEN** — which channels are sanctioned? |
| Observability stack | Logs, traces, metrics | NFR-OPS-01, ADR-015 | **OPEN** — existing standard? |
| dbt | Upstream transformation + metadata | Q-11, FR-DEV-06 | **OPEN** — in use? |
| Data catalog | Lineage, discovery | FR-SEM-10 | Not required for v1 |

**Note for the architect:** an integration marked OPEN is a design risk, not a config detail. The
git host and secret store answers in particular can invalidate an ADR after it's written.
