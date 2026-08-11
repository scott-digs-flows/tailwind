# ADR-001 — Deployment: one VM, one Docker Compose file, one environment

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** Systems Architect (proposer) · Full-Stack · Product (Q-05 owner)
- **Milestone:** M0
- **Requirements:** NFR-OPS-02, NFR-SCALE-01 (Tier 2), NFR-SCALE-02, NFR-SEC-01, FR-DEV-02,
  FR-ADM-01
- **Tickets:** T-003 (produces) · constrains T-010, T-011 · related T-118

## Context

Q-05 deferred deployment, residency and egress policy for the POC and answered this ADR in advance:
*"ADR-001 still needs an answer, but a trivial one: simplest thing that runs, single environment."*
`08-poc-scope.md §2` defers availability, multi-region, zero-downtime deploys and RPO/RTO drills
outright. So the job here is to be **decisive and small**, and to avoid the one mistake that would
be expensive: a topology that has to be redesigned rather than resized.

What the deployment must actually carry, from the decisions already taken:

| Component | Source | Stateful? |
|---|---|---|
| `apps/api` — API/BFF | ADR-006 | no |
| `apps/web` — static SPA bundle | ADR-005 | no |
| `apps/render` — headless chart renderer | ADR-005 | no |
| Cube Core API instance | ADR-003 D1 | **single replica only** — see D5 |
| Postgres — operational DB, job records, audit log | ADR-014 | **yes** |
| Redis — *our* result cache and job event log | ADR-008 (provisional) | yes, but reconstructible |
| Reverse proxy / TLS | NFR-SEC-01 | no |

Two things that are deliberately **absent**: **Cube Store** and a **Cube refresh worker** (T-118, D5
below), and **Redis as a Cube dependency** — Cube dropped Redis in v0.32.0, so a stray
`CUBEJS_REDIS_*` variable now hard-errors. Our Redis is ours.

Three constraints bound the choice:

1. **NFR-SCALE-01 Tier 2 must not be precluded** — 500 named / ~50 concurrent. Q-04 puts the
   realistic population near **400 users**, so Tier 2 *is* the target and **Tier 3 (5,000) is
   speculative, not a requirement**. Designing for Tier 3 now would be exactly the premature scaling
   `02-architecture-brief.md §5.5` warns against.
2. **NFR-SCALE-02** — the app tier is stateless, all session and cache state external. That is a
   property of the *application*, and it is what makes the topology resizable regardless of what it
   runs on.
3. **NFR-OPS-02** — infrastructure as code, reproducible environments.

**Open questions this runs ahead of.** Q-01 is unanswered, and this ADR is designed so it does not
matter: the skeleton builds and tests against **DuckDB as the `development`-tier dialect**
(`06-dialect-strategy.md §11.5`), which needs no warehouse credentials and costs nothing. The cloud
provider is also unknown — the org's account and the secret-store standard are both OPEN rows in
`07-domain-model.md §4` — and D2 handles that by using almost no cloud primitives.

## Options considered

### Option A — One Linux VM running Docker Compose ✅

A single cloud VM, provisioned by Terraform, running the same `docker-compose.yml` that developers
run locally. Images built by CI and pushed to a registry; deploy is `docker compose pull && up -d`
over SSH. Caddy or Traefik terminates TLS on a real DNS name.

**Pros.** One topology description for the entire project — the compose file *is* the local dev loop
(FR-DEV-02) and *is* production, so environment drift is structurally impossible during the POC.
`engines.yaml`'s warehouse candidates already run as a Docker Compose stack, so the app and a
seeded engine can share a network with zero credential or VPC work — which is the fastest possible
path to the M0 exit criterion. Costs tens of dollars a month. A full rebuild from scratch is one
`terraform apply` plus one `docker compose up`, which is the only disaster-recovery story the POC
needs (artifacts are in git; NFR-AVAIL-03).
**Cons.** Single point of failure — no HA, and a host reboot is user-visible downtime. Vertical
scaling only, until the app tier is moved off the box. Postgres and Redis run as containers on a
mounted volume, which is fine at pilot scale and is not what anyone should run at GA. Deploying over
SSH is a script, not a platform.

### Option B — Managed Kubernetes (GKE / EKS / AKS) with Helm

Cube publishes a Helm chart; everything else is a Deployment plus a Service.

**Pros.** The honest GA answer, and choosing it now means never migrating. Rolling deploys, health
checks, horizontal scaling, secret integration and multi-replica SSE all come free rather than being
built. Cube's chart is maintained upstream.
**Cons.** A control plane, a node pool, an ingress controller, cert-manager, a secret operator and a
CI service account — a week of setup and a permanent operational surface, in a project whose entire
M0 is "one chart on a page". It also splits the dev loop from production: developers would still run
compose locally, so there would be two topology descriptions to keep in agreement, which is the
specific failure Option A avoids. Nothing in the POC requires anything Kubernetes provides.

### Option C — Per-service managed PaaS (Fly.io / Render / Railway)

**Pros.** Managed Postgres and Redis, automatic TLS, deploy-on-push, no VM to patch. Genuinely a good
middle option and the one most likely to be right if the team is allergic to owning a host.
**Cons.** Five services to configure through a platform UI or a platform-specific manifest, so the
IaC story fragments; Cube Core needs its model directory on disk, which means baking content into the
image or attaching a volume, and then a content change requires an image build; and the network path
to a warehouse inside a corporate boundary is the platform's problem to solve rather than ours. Still
two topology descriptions. It trades a small amount of ops work for a moderate amount of
platform-specific coupling.

## Decision

**One Linux VM per environment, running the same Docker Compose file developers run locally, with
Terraform owning the VM, DNS, volume and firewall — and exactly one environment for the POC.**

### D1 — One environment, named `poc`

It is production and staging simultaneously. `08-poc-scope.md §2` defers availability, and pilot
users tolerate a restart. Preview environments per PR (FR-GOV-10) are already cut line #3 in
`03-roadmap.md`.

The important consequence: **the CI evidence pipeline must not need this environment.** Validation,
compilation, the conformance suite, metric assertions and chart rendering all run inside the GitHub
Actions runner against a seeded DuckDB in a container — no credentials, no spend, no shared state,
and no queue behind one environment. That is the payoff ADR-003 predicted from having a
`development`-tier dialect, and it is what makes a single environment viable rather than a bottleneck.

### D2 — Provider-agnostic by using almost no cloud primitives

The Terraform module uses four things: **a VM, a DNS record, a block volume, and a firewall rule.**
Every cloud has them, so whoever owns the account picks the provider by answering one variable. The
module should be under a hundred lines. Secrets are the one exception — the org standard is an OPEN
row in `07-domain-model.md §4` — so the POC reads them from an SOPS-encrypted file committed to the
repo and decrypted at deploy time, with the interface (`connections/<env>.conn.yml` naming a secret,
ADR-004 D1) unchanged when a real store arrives. **Warehouse credentials never reach the browser or
the AI provider** (FR-SEC-06); they exist only in the Cube container's environment.

This is deliberately not a recommendation of a specific cloud. Making that choice for the org would
be an architect overstepping, and the design costs nothing by deferring it.

### D3 — Why this does not preclude Tier 2

Tier 2 is 500 named / ~50 concurrent users, and NFR-SCALE-01's actual requirement is *"same
architecture across all three; scale by adding replicas, not by redesign."* That requirement is
satisfied by the **application** being stateless (NFR-SCALE-02), not by the hosting being clustered.
Concretely, the growth path is:

1. **Vertical first.** A 4–8 vCPU VM plausibly serves 50 concurrent users given an ≥85% cache hit
   rate on the `standard` class (NFR-SCALE-03) — most concurrent requests never reach the warehouse.
   The warehouse, not the app tier, is the first thing to saturate.
2. **Then horizontal, without a redesign**, because three properties are true from M0: all state is
   in Postgres and Redis, not in process (ADR-006 D3 externalizes job state specifically so SSE
   survives multiple replicas); the app is a container with no local disk dependency; and the compose
   file can scale a service to N replicas behind the same proxy on the same host before anything moves.
   **This applies to `apps/api`, `apps/web` and `apps/render` — not to Cube.** See the caveat below.
3. **Then a real orchestrator** — Option B, at GA, when NFR-AVAIL-01's 99.9% and NFR-AVAIL-02's
   zero-downtime deploys stop being deferred. The migration is a set of Deployment manifests over
   images that already exist, which is a week, not a rewrite. Note there is **no official Cube Helm
   chart** — only two explicitly community-maintained ones — so Cube's manifests are ours to write.

**The one genuine exception, and it was not in the plan.** T-118 established that Cube runs without
Cube Store only because its cache and queue driver is set to `memory`, which is **per-process**. So
**Cube cannot be replicated without Cube Store**, and OSS Cube Store has no node replication. Cube's
horizontal scaling and its availability story are therefore the same problem, and ADR-003 D1a forbids
the vendor's answer to it. Concretely: **Cube stays at one replica**, and it is the first component
that will need a real answer if Tier-2 load testing shows it saturating. Our own result cache sitting
*in front* of Cube is what makes one replica plausible at all — at an ≥85% hit rate on the `standard`
class, most requests never reach it.

**What this ADR deliberately does not do is design for Tier 3.** Per Q-04 the realistic population is
~400 users. Building for 5,000 would mean autoscaling, a queue with per-user fairness (NFR-SCALE-04),
a read-replica story and a multi-region question — all deferred, none needed, and each one a POC
killer.

### D4 — Deploy and rollback

CI on `main`: build → test → push images tagged with the commit SHA → `docker compose pull && up -d`
over SSH. Rollback is re-deploying the previous SHA, which is a one-line command. **Artifact rollback
is a different and faster thing** — repointing the serving plane at a previous bundle (FR-GOV-09,
ADR-007) — and keeping the two separate matters, because 90% of rollbacks will be content, not code.

Deploys are not zero-downtime (NFR-AVAIL-02 is deferred): compose replaces containers and active
requests drop. A ~5 second interruption on a pilot deployment is acceptable and saying so plainly is
better than pretending otherwise.

### D5 — Cube Core's footprint, and T-118

ADR-003 D5 disables pre-aggregations, so the question is whether Cube Core still requires **Cube
Store** — which matters here because OSS Cube Store has no node replication, making it a
single-point-of-failure component we would be operating for a feature we deliberately disabled.
**T-118 is answered** — see ADR-003 §*T-118 answered*. **Cube Store is not required**, and neither is
a refresh worker, on one condition: `CUBEJS_CACHE_AND_QUEUE_DRIVER=memory` must be set **explicitly**,
because the production default is `cubestore` and the failure mode is nasty — the container boots,
`/readyz` passes, `/v1/meta` answers, and then `/v1/load` throws at query time. So the compose file
loses two services, and gains one environment variable that must never be dropped. T-132 owns that
config as a checked-in file rather than tribal knowledge.

The cost is the replication caveat in D3: `memory` is per-process, so buying our way out of Cube Store
buys a single-replica Cube. That is the right trade for the POC and it is a named GA problem rather
than a discovered one.

## Consequences

**Enables**
- A real deployed URL in days, so "deployment is never a late surprise" (`03-roadmap.md` M0) is
  actually true.
- One topology description shared by the dev loop and production, so FR-DEV-02 and the deployment are
  the same artifact and cannot drift.
- CI with no cloud dependency and no warehouse credentials, because DuckDB is in the runner.
- Tens of dollars a month, and no cloud account negotiation on the critical path.

**Costs**
- No HA, no zero-downtime deploys, visible downtime during deploys and reboots. Explicitly accepted
  under `08-poc-scope.md §2`.
- Postgres and Redis are self-managed containers. Backups are a `pg_dump` on a cron to object
  storage — do write it, because losing the audit log and the bundle registry costs more than the
  hour it takes.
- SSH-based deployment is a script that will need replacing at GA.
- Vertical scaling has a ceiling, and nobody will notice it until a load test.

**Forecloses**
- Multi-region and residency-specific placement, until Q-05 returns. That is the intended deferral.
- Any *per-service* horizontal scaling story before the app tier moves off the single host — the app
  is ready for it, the host is not.
- Serverless / scale-to-zero hosting: Cube Core and a long-lived SSE tier are both a poor fit, and
  ADR-006 D3 assumes a persistent process.

**Revisit when** — any one:
1. **More than ~25 active users**, per `08-poc-scope.md §4`. That trigger already brings back
   availability work, and it is the point where a single host stops being defensible.
2. **Anyone outside the pilot team depends on a dashboard for a real decision.** Same trigger table.
   Availability becomes a real requirement and Option B becomes the answer.
3. **The p95 warm target (2.5 s) is missed and profiling implicates host contention** rather than the
   warehouse or the cache. Vertical resize first; if that does not fix it, split the app tier out.
4. **Regulated, customer or PII data enters a dashboard** — Q-05 returns in full and the deployment
   target becomes a Security conversation, not an architecture one.
5. **A second tenant that is not us appears** — ADR-014's trigger, and it makes one shared host a
   commercial rather than technical problem.

## Validation

1. **A commit to `main` builds, tests, and deploys to the `poc` environment, reachable over HTTPS on
   a real DNS name** — T-010's acceptance criterion, and the honest test of this ADR.
2. **`terraform destroy` then `terraform apply` then deploy** reproduces the environment from nothing
   in under an hour, with only secrets supplied out of band (NFR-OPS-02).
3. **CI passes with no cloud credentials and no warehouse credentials in the runner's environment** —
   assert it by failing the job if warehouse secrets are present in the DuckDB-only workflow.
4. **The app tier survives being run at two replicas** on the single host: an SSE stream started
   against one replica resumes against the other (ADR-006 D3). This is the cheap test that Tier 2 is
   not precluded, and it should be run in M0 while it is trivial, not at M3 when it is not.
5. A restart of the whole stack loses no operational state: drafts, audit rows and the bundle
   registry survive; the result cache does not need to.

## Notes

- Q-05 deferral and its "trivial answer" instruction — `04-open-questions.md`.
- Deferred availability/scale scope and the trigger table — `08-poc-scope.md §2`, `§4`.
- Tier definitions — NFR-SCALE-01; Tier-2 sizing rationale — Q-04 consequence 2.
- DuckDB as the `development` tier and the CI-credential payoff — `06-dialect-strategy.md §11.5`.
- Cube Store HA limitation and the Cloud upsell it creates — ADR-003 D1a; spike is T-118.
