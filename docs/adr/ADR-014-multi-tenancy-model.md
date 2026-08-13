# ADR-014 — Multi-tenancy: shared schema, tenant-scoped everything, enforced mechanically

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** Systems Architect (proposer) · Product (Q-03 owner) · Full-Stack
- **Milestone:** M0
- **Requirements:** NFR-TEN-01, NFR-TEN-03, FR-SEM-14, FR-SEM-15, FR-SEC-04, FR-SEC-07, FR-ADM-01,
  NFR-SCALE-03
- **Tickets:** T-009 (produces) · constrains T-010, T-011, T-012, T-116 · related T-098 (deferred
  ceremony, M3)

## Context

Q-03 is decided: **internal-first, carry a tenant ID from day one.** This ADR is therefore about
*how*, not *whether*. `02-architecture-brief.md §3.7` lists the six places tenant must be a
first-class scope — artifact registry, cache keys, connection management, RLS context, audit log,
repository layout — and names the failure mode precisely:

> *decorative tenancy — a tenant column that exists but is never exercised, so single-tenant
> assumptions accumulate underneath it and the eventual second tenant is still a rewrite.*

The brief's two countermeasures against that are NFR-TEN-02: seed a second tenant in every non-prod
environment, and make "what happens with two tenants?" a mandatory design-review question.
**`08-poc-scope.md §6` defers both, and Product confirmed the deferral** (T-098 sits in M3). So this
ADR inherits an obligation: it must find a way to keep tenancy non-decorative *without* the
ceremony, because the ceremony was the plan and the plan is gone. That is the substantive work here,
and it is §D6.

Two constraints from elsewhere bound the design and must not be blurred:

- **FR-SEM-14** — the security context (tenant, subject, groups, attributes) is a required parameter
  of query construction *and* of the cache key, from the first query. A request with no resolved
  tenant is rejected.
- **FR-SEM-15** — per-user row predicates resolve **per request**, not per tenant. Cube's
  `COMPILE_CONTEXT` is per-tenant by construction and cannot satisfy this;
  `access_policy` / `query_rewrite` can (ADR-003 D4). The two mechanisms therefore have
  non-overlapping jobs, and confusing them is how this gets built wrong.

**Not in scope for v1** (NFR-TEN-03): per-tenant branding, billing, self-signup, tenant-facing
admin. Isolation only.

## Options considered

### Option A — Shared schema, `tenant_id` on every tenant-scoped table, Postgres RLS ✅

One database, one schema. Every tenant-scoped table carries `tenant_id NOT NULL` and a row-level
security policy keyed on a session variable set from the request's security context. One Cube
deployment serves all tenants, with per-tenant model files supplied through Cube's
`repository_factory`. One result cache, tenant-namespaced.

**Pros.** One migration to run, one connection pool, one deployment — which is the whole point at
POC scale. Postgres RLS puts the isolation guarantee **below** the application, so an ORM query that
forgets its `WHERE tenant_id = ?` returns zero rows rather than another tenant's rows: the failure
mode becomes visibly empty instead of invisibly wrong. Cross-tenant queries (usage analytics, admin)
remain possible where deliberately elevated.
**Cons.** A single bad `SET` or a pooled connection reused without resetting the session variable
leaks across tenants. Noisy-neighbour effects are unmitigated. `tenant_id` must be remembered on
every new table — which is exactly the decorative-tenancy risk, and why D6 exists.

### Option B — Schema-per-tenant

`tenant_acme.dashboards`, `tenant_internal.dashboards`, with `search_path` set per request.

**Pros.** Isolation is structural; forgetting a predicate is not a leak. Per-tenant backup, restore
and deletion are trivial. A convincing story to a future security reviewer.
**Cons.** Migrations become N migrations and a partial-failure state; tenant creation becomes a DDL
operation on the request path; cross-tenant reporting requires dynamic SQL or a union view; and
connection pooling across schemas is fiddly. At one tenant, all of that cost is paid and none of the
benefit is realised. It is also not a one-way door — Option A migrates *to* it if a real customer
demands it, whereas the reverse is harder.

**Database-per-tenant** was considered and is the GA escape hatch for a large or regulated customer,
not a POC shape. Recorded so it is not re-proposed as though it were new.

## Decision

**Shared schema with `tenant_id` on every tenant-scoped table and Postgres row-level security as the
backstop; one Cube deployment with per-tenant model paths; tenant as an explicit namespace on the
cache key rather than only a hash input; and a set of mechanical checks that replace the deferred
NFR-TEN-02 ceremony.**

### D1 — What a tenant is

An opaque, human-readable slug: `^[a-z][a-z0-9-]{1,30}$`. It is the primary key, it appears in git
paths (ADR-004 D5), in cache keys, in log lines and in URLs, so it must be filesystem- and
URL-safe and readable by a human debugging at 2am. Slugs are **never reused** after deletion. The
POC ships exactly one: `internal`.

### D2 — Tenant is resolved once, server-side, from identity — never from the client

A single `resolveSecurityContext(request) → SecurityContext` in the API derives
`SecurityContext(tenant, subject, groups, attributes)` from the authenticated principal. There is no
code path where a tenant arrives as a query parameter, a header, or a request body field. If the
tenant cannot be resolved, the request is **rejected with 403 before any handler runs** (FR-SEM-14).
In the POC, where SSO is present (`08-poc-scope.md §3.3`) but roles are assigned by hand, the tenant
claim comes from the IdP-issued token and the attributes resolve to a permissive policy — but the
resolution step, the rejection, and the object's shape are real from commit one.

The object is immutable and **branded** in the type system. The warehouse client, the compiler
façade and the cache client each accept it as a required first argument and there is **no overload
without it**. That is the whole of FR-SEM-14's "non-optional" enforced by the compiler rather than by
review.

### D3 — Cube: `COMPILE_CONTEXT` for the tenant's *model*, `access_policy` for the *user's rows*

This division is the load-bearing detail, because getting it backwards produces a system that looks
correct and violates FR-SEM-15.

| Cube hook | Job | Keyed by | Must never be used for |
|---|---|---|---|
| `repository_factory` + `COMPILE_CONTEXT` | Choose which tenant's model files compile | tenant | anything per-user |
| `context_to_app_id` | Separate compiled-model caches | tenant | — |
| `context_to_orchestrator_id` | Separate query orchestration/queue scope | tenant | — |
| `context_to_groups` | Maps the security context to the groups `access_policy` matches on | subject, groups | — |
| `access_policy` (row_level, member_level, member_masking) | The per-user predicate, declared in the reviewed model | subject, groups | tenant scoping alone |
| `query_rewrite` | The tenant predicate plus any rule not declarable | tenant **and** subject | replacing `access_policy` |

**`context_to_groups` is not optional in Cube Core, and omitting it fails open.** Cube Cloud maps
authenticated users to policy groups automatically; Core does not, and a policy that matches no group
never applies — which, against Cube's documented all-rows-public default, means every user sees
everything, silently. Relatedly, **`userAttributes` does not exist in Core** (it is Cloud-only), so
policies must reference `securityContext.*` directly. Both facts were established under T-118 and are
recorded in ADR-003 §*Correction 2*; T-116's default-deny assertion must cover the
policy-exists-but-no-group-matches case specifically, because that is the shape the failure takes.

`repository_factory` points at `content/tenants/<tenant>/semantic/`. `context_to_app_id` and
`context_to_orchestrator_id` both include the tenant — Cube's own documentation states that omitting
them leaks one tenant's data into another's cache, and ADR-003 D5 cites the open defects. Per-user
predicates go through `access_policy` and `query_rewrite`, which resolve per request. **Minting a
per-user app ID to force `COMPILE_CONTEXT` to carry a user predicate is prohibited** — Cube
documents that it does not scale, and it is the exact trap `02-architecture-brief.md §2.4` warns
about.

### D4 — Cache keys: tenant is a namespace, not just a hash input

```
key = "t:" + tenant + "|" + sha256(
          bundle_version ‖ canonical_semantic_query ‖ freshness_class ‖ security_context_digest )
```

where `security_context_digest` hashes the *resolved policy inputs* — subject, sorted group list,
sorted attribute key/value pairs — and never the raw token.

The tenant appears **outside** the hash on purpose. Three reasons: a tenant's cache can be dropped
wholesale with a prefix scan; no hash collision or truncation can ever make one tenant's key equal
another's; and a human reading a cache key can see which tenant it belongs to. The cost is a few
bytes.

`freshness_class` is in the key from day one even though only `standard` works (FR-FRESH-01/02,
ADR-004 D4) — re-cutting a cache key later invalidates every entry and, worse, invites a
compatibility shim.

The cache client's `get`/`set` signatures require the branded `SecurityContext`. There is no
`getRaw`. ADR-008 owns topology and the pre-RLS optimisation, whose four soundness conditions are
already written down in `02-architecture-brief.md §3.3`; this ADR fixes only the keying shape.

### D5 — Where else tenant appears

- **Artifact registry** — published bundles are keyed `(tenant, commit_sha)`; the serving plane loads
  a bundle for a tenant and cannot load another's. Rollback is per `(tenant, bundle)`.
- **Connections** — `content/tenants/<t>/connections/<env>.conn.yml` holds the definition; the secret
  is referenced by name. The **warehouse connection pool is keyed by tenant**, so no pooled session
  can carry a `SET` or a temp object across a tenant boundary. This is cheap now and genuinely
  awkward to retrofit.
- **Audit log** (FR-SEC-07) — `tenant_id NOT NULL` on every event, written by a logger that takes the
  security context. No security-relevant event can be written without one.
- **Observability** — `tenant` is a span attribute and a structured-log field on every request
  (NFR-OPS-01). It is deliberately **not** a metrics label at unbounded cardinality; one tenant today
  and a bounded internal set tomorrow makes that safe, and the revisit trigger below names the point
  where it stops being safe.
- **Repository layout** — ADR-004 D5.

### D6 — The three mechanical checks that replace the deferred ceremony

NFR-TEN-02 is deferred, so tenancy has to stay honest some other way. These three cost roughly a day
in total, run in CI forever, and are the reason this ADR is not decorative:

1. **A migration-time assertion.** A test enumerates every table in the schema against an explicit
   allow-list of non-tenant-scoped tables (migrations metadata, feature flags, the tenant table
   itself). Anything else must have `tenant_id NOT NULL` **and** an enabled RLS policy, or the build
   fails. A new table cannot forget tenancy, because forgetting is a red build. This is the single
   highest-value item on this page.
2. **A two-context unit test at each of the two layers where leakage actually occurs.** Two synthetic
   security contexts, `t1/alice` and `t2/bob`, over the compiler façade and the cache: different SQL
   predicates, different cache keys, and a read with `t2` never returns a `t1` entry. No second
   environment, no seeded data, no ceremony — a test file. It is the useful 5% of NFR-TEN-02.
3. **An unresolved-tenant rejection test.** A request whose principal yields no tenant is rejected
   before any handler runs (FR-SEM-14). This is also T-116's acceptance criterion; it is listed here
   because it is the check that proves D2 rather than D4.

Checks 2 and 3 are already inside T-116's scope. Check 1 is new work introduced by this ADR and is
added to T-009's tail as part of the schema bootstrap.

## Consequences

**Enables**
- A second tenant is a row, a directory and a connection record — not a migration project.
- Postgres RLS means an application bug that forgets a tenant predicate produces an empty result
  rather than a cross-tenant leak. Choosing the visibly-broken failure mode over the invisibly-wrong
  one is the same instinct as ADR-003 D4's default-deny.
- Per-tenant cache eviction and per-tenant bundle rollback for free.
- The migration path is monotone: shared schema → schema-per-tenant → database-per-tenant, each step
  taken only when a named customer requires it.

**Costs**
- Every session must `SET LOCAL app.tenant_id` inside the transaction that uses it. One helper, used
  everywhere; but a raw pool checkout that skips it is a real bug class, so the pool wrapper is the
  only sanctioned way to get a connection.
- Postgres RLS costs a small amount of planning overhead and makes some admin queries need an
  explicitly elevated role. Accepted.
- One connection pool per tenant multiplies idle connections. Irrelevant at one tenant; it is a real
  constraint at fifty, and it is a reason the GA shape is not necessarily this one.
- Noisy-neighbour isolation is absent. Out of scope per `08-poc-scope.md §2` (query governor
  deferred).

**Forecloses**
- **Cross-tenant artifacts.** No shared metric library across tenants in v1. A future one has to be
  an explicit, reviewed publish/subscribe mechanism, not an absent predicate.
- **Per-user `COMPILE_CONTEXT`.** D3 prohibits it, which forecloses model shapes that differ per
  user. That is correct — per-user *definition* differences would violate the "nothing in the
  database may change a number" rule in `07-domain-model.md §2`.
- **Unbounded-cardinality tenant metrics labels**, until someone deliberately re-opens it.

**Revisit when** — any one:
1. **A second tenant appears that is not us** — an external customer or an acquisition. That fires
   `08-poc-scope.md §4`, reinstates NFR-TEN-02 (T-098), and re-opens Option B.
2. **Tenant count exceeds ~10.** Per-tenant connection pools and per-tenant Cube model compilation
   both stop being free around there. Cube documents this directly: each distinct `context_to_app_id`
   or `context_to_orchestrator_id` value allocates its own model compile cache, SQL compile cache,
   query queue and in-memory result cache, *"ranging from single-digit MBs on the lower end and dozens
   of MBs on the higher end"* — linear, in one process, on one host (ADR-001). Cube's own mitigation is
   to bucket tenants or shard them across nodes, and sharding across nodes reintroduces the Cube Store
   requirement (ADR-003 §T-118).
3. **A tenant requires data residency or a dedicated key.** Straight to database-per-tenant; shared
   schema cannot answer it.
4. **A security review rejects application-mediated isolation.** Option B exists for exactly this
   conversation, and D1's slug-as-schema-name choice keeps it a mechanical migration.

## Validation

1. **The three checks in D6**, all in CI, all failing loudly when broken. Check 1 is validated by
   adding a tenant-scoped table without `tenant_id` and confirming a red build.
2. A query with two different security contexts produces two different SQL predicates and two
   different cache keys (T-116, and ADR-003's *Validation* item 3).
3. A request with no resolvable tenant returns 403 and never reaches a handler.
4. A `t2` cache read after a `t1` write returns a miss, asserted directly on the key.
5. `SET LOCAL app.tenant_id` coverage: a test that checks out a connection outside the wrapper fails.

## Notes

- Q-03 decision and consequences — `04-open-questions.md`.
- The decorative-tenancy failure mode and the two countermeasures — `02-architecture-brief.md §3.7`.
- The deferral of the ceremony and its trigger — `08-poc-scope.md §6`, `§4`.
- Tenant-separable git layout requirement — `07-domain-model.md §2`.
- Cube multi-tenancy hooks and the cache-key leak warning — <https://docs.cube.dev/embedding/multitenancy>,
  <https://cube.dev/docs/product/configuration/multitenancy>
- Postgres row-level security — <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>

---

## The RLS backstop is decorative unless the app is a non-superuser (2026-08-12, found in T-024)

D-whatever-number this ADR gives it: **the application must never connect to Postgres as the
database owner.**

The first implementation created `query_log` with `ENABLE ROW LEVEL SECURITY` *and*
`FORCE ROW LEVEL SECURITY`, wrote a tenant-isolation policy, and set the tenant per transaction with
`set_config(..., true)`. Every part of that was correct, and it isolated nothing: a session with
`tailwind.tenant_id = 'other-co'` still saw every `internal` row.

The cause is that `POSTGRES_USER` is a **superuser**, and superusers bypass row-level security
entirely. `FORCE ROW LEVEL SECURITY` closes the *owner* loophole, not the *superuser* one. The
policy was live, the grants were right, and the guard was inert.

**What we do now.** Migration `002_app_role.sql` creates `tailwind_app` — `LOGIN`, explicitly
`NOBYPASSRLS` — granted `SELECT, INSERT` on `query_log` and nothing else. Two connection strings:
`DATABASE_ADMIN_URL` for DDL at boot, `DATABASE_URL` for everything the app does afterwards.

Two properties fall out, both verified rather than assumed:

- A wrong-tenant or unset-tenant session reads **zero** rows.
- `DELETE FROM query_log` as the app role is **permission denied**, so FR-SEC-07's "immutable audit
  log" is enforced by a withheld grant rather than by a promise.

**Why this is worth a section rather than a commit message.** It is the exact failure shape this
project keeps meeting: a security control that is present, reviewable, and does nothing. It was
found only by *asserting the negative* — querying as the wrong tenant and checking for zero — which
is the same discipline as T-097's negative control and the planted error in the wizard-of-oz
protocol. **T-130's schema guard must therefore check the connecting role's privileges, not only the
table's policies.** A guard that inspects `pg_policies` and stops there would have passed this
schema.
