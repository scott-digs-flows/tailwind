# ADR-006 — Backend: TypeScript on Node with Fastify; REST + JSON Schema, with SSE as the one streaming transport

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** Systems Architect (proposer) · Full-Stack · Product (reviewer)
- **Milestone:** M0
- **Requirements:** NFR-PERF-03, NFR-SCALE-02, NFR-OPS-01, FR-SEM-11, FR-SEM-14, FR-SEM-15,
  FR-DEV-01, FR-CON-02, NFR-QUAL-01
- **Tickets:** T-008 (produces) · constrains T-010, T-011, T-014, T-116, T-129 · related T-012,
  T-013

## Context

ADR-003 deliberately left this open: Cube Core speaks HTTP, so it does not pick our language. Three
things do.

1. **NFR-PERF-03 — AI streaming.** *"A 30 s dashboard proposal needs streaming and visible progress,
   which shapes the API and the whole front-end state model. Decide this early — it is expensive to
   retrofit"* (`02-architecture-brief.md §3.4`). The transport is not the hard part; the **response
   shape** is, and it has to be decided before the first endpoint exists.
2. **NFR-QUAL-01 — one serializer.** ADR-004 D3 requires exactly one canonical YAML emitter, shared
   by the CLI, the API, the AI path and the visual editor. The editor runs in a browser. If the API
   is not the browser's language, that single implementation becomes two implementations that must
   agree byte-for-byte, and "deterministic serialization" turns into a cross-language conformance
   problem — on the one requirement `03-roadmap.md` says must not be cut for speed.
3. **FR-GOV-04 / FR-VIZ-06 — headless rendering.** ADR-005 makes non-browser chart rendering a
   *gate* on the chart library, and every library that passes it renders in **Node**. A backend in
   another language means either a Node render service anyway, or two chart implementations — and two
   chart implementations means the screenshot CI attaches to a PR is not the dashboard the user sees,
   which destroys the evidence pipeline's whole value (`08-poc-scope.md §3.5`).

**Constraints:** all numbers flow through one compiler, one door (§2.2); RLS is enforced
server-side during query construction from the requesting user's identity (§2.4); the serving tier is
stateless (§2.6). And FR-SEM-14: the security context is a required parameter of query construction
from the first query.

**Open questions:** Q-01 is unanswered and nothing here depends on it — the warehouse is reached
through Cube, and the dialect is a field in a connection definition. The observability standard is
an OPEN row in `07-domain-model.md §4`; D4 keeps that answer swappable.

## Options considered

### Option A — TypeScript on Node, Fastify ✅

One language across `apps/api`, `apps/web`, `apps/render`, `packages/spec` and `packages/cli`.

**Pros.** `packages/spec` — schemas, parser, canonical emitter, validator — is *one* build,
imported by the server, the browser, the CLI and CI. Chart rendering happens in the same runtime as
the browser's, so the CI screenshot and the user's screen come from one code path. Fastify validates
routes with Ajv against JSON Schema, which is the same validator and the same schemas ADR-004 already
publishes, so the API contract and the spec contract are one artifact rather than two. SSE, long-lived
connections and worker processes are all ordinary. Boring, mature, and the ecosystem the front end
needs anyway.
**Cons.** Node is a mediocre host for CPU-bound work — but ours is not CPU-bound: Cube compiles the
SQL, the warehouse executes it, and we shuttle JSON. Weaker data-science and LLM-tooling ecosystem
than Python. The data-team engineers splitting time onto this project (Q-04) are Python people, and
this is a genuine cost in contributor throughput.

### Option B — Python on FastAPI

**Pros.** The split-time contributors already write Python; dbt is Python; the strongest AI/LLM
tooling is Python-first, and FR-AI is the product's centre of gravity from M2. FastAPI's Pydantic
models and native async streaming are excellent, and the prior prototype work in this repo was
Python — some tacit warehouse knowledge lives there.
**Cons.** It buys a **second serializer** or a Node sidecar for `fmt`; a **second chart
implementation** or a Node render sidecar; and a duplicated set of spec types. So the realistic shape
is *Python plus Node*, which is two runtimes to deploy, two dependency trees to patch, and a
byte-equality contract between two YAML emitters — for a two-person team, in a POC. The AI ecosystem
advantage is real but it is recoverable later at low cost (see D5), whereas the serializer and
renderer duplication is paid every day from M0.

**Also considered and rejected quickly.** *Next.js full-stack* — fuses the front end and the API,
makes the long-lived render worker and the streaming job model awkward, and blurs the "one door"
boundary that constraint §2.2 depends on. *NestJS* — decorator ceremony out of proportion to a POC.
*Hono* — genuinely appealing and lighter than Fastify, but its edge-runtime orientation is aimed at
a deployment model we are not using (ADR-001), and Fastify's JSON-Schema-native routing is worth more
to us than Hono's ergonomics.

## Decision

**TypeScript on Node with Fastify for the API/BFF. REST/JSON with JSON Schema as the contract, and
Server-Sent Events as the single transport for every operation that can take longer than about a
second — including, from the first commit, the shape that AI streaming will use in M2.**

### D1 — One repository, one language, one spec package

`packages/spec` is the only place specs are parsed, validated or serialized. `apps/api` and
`apps/web` import it; `packages/cli` is a thin wrapper over it so FR-DEV-01's CLI works with no
running server. This is the concrete reason Option A wins, and it is worth stating as a rule: **a
component that parses or writes a spec without importing `packages/spec` is a defect.**

### D2 — REST/JSON, not GraphQL and not tRPC

Resource-shaped endpoints described by JSON Schema, with OpenAPI generated from the route schemas.

- **Not GraphQL.** A BI product's query surface is not a graph, and GraphQL's whole value
  proposition — let the client compose the query — is the thing binding constraint §2.2 exists to
  prevent. Handing clients a composition language next to a semantic layer invites a second door.
- **Not tRPC**, despite the TypeScript monorepo making it tempting. The contract must be
  language-neutral: CI tooling consumes it, and D5 keeps open a Python AI service that would have to
  speak it. A generated OpenAPI document from Ajv-validated routes gives us the same safety with a
  contract anyone can read.

### D3 — The response and streaming shape, decided now because it is the expensive part

**Every response carries the same envelope.**

```jsonc
{
  "meta": {
    "bundle_version": "…",         // spec version actually served — FR-GOV-08, rollback
    "as_of": "2026-08-10T09:31:00Z",  // FR-CON-03, FR-FRESH-03
    "freshness": { "class": "standard", "stale": false },
    "cache": "hit",                // hit | miss | bypass
    "trace_id": "…",               // NFR-OPS-01
    "security_context_digest": "…" // proves which context produced this
  },
  "data": { }
}
```

Those fields are not decoration. `as_of` and `freshness` are FR-FRESH-03 and FR-CON-03;
`bundle_version` is what makes rollback observable; `security_context_digest` is what lets a test
assert that two users got two differently-scoped results. Adding them later means touching every
endpoint and every client call site.

**Every operation that can exceed ~1 s is a job with an event stream.**

```
POST /v1/queries              → 202 { job_id }        semantic query execution
POST /v1/proposals            → 202 { job_id }        AI draft generation (M2)
GET  /v1/jobs/{id}/events     → text/event-stream     progress | partial | token | result | error
GET  /v1/jobs/{id}            → the terminal envelope, for clients that do not stream
```

In M0 a query resolves in one round trip and the client may simply poll `GET /v1/jobs/{id}` once. The
point is that **M2's streaming AI is a new event type on an existing transport, not a new transport.**
That is the retrofit NFR-PERF-03 warns about, paid for now at the cost of one indirection.

**SSE, not WebSocket.** We only need server→client. SSE is plain HTTP, so it inherits our auth,
proxies, tracing and load balancing with no separate lifecycle; WebSocket would buy bidirectionality
we have no use for and cost a second auth path. If a genuinely bidirectional feature appears —
collaborative editing is the only plausible one, and it is not on the roadmap — that is a new ADR.

**The stream is a view over externalized job state, never over in-process state.** Job records live
in Postgres (with the event log in Redis), so any replica can serve `GET /v1/jobs/{id}/events`, and a
dropped connection resumes with `Last-Event-ID`. This is what keeps NFR-SCALE-02's stateless tier
true in the presence of long-lived connections, and it is the detail most often got wrong — an
in-memory job map works perfectly on one replica and fails the moment there are two.

### D4 — The security context is a type, not a convention

One middleware resolves `SecurityContext(tenant, subject, groups, attributes)` from the
authenticated principal (ADR-014 D2) and rejects the request if it cannot (FR-SEM-14). The context
is a **branded type**, and the compiler façade, the warehouse path and the cache client each take it
as a required first argument with no overload that omits it. Enforcement is the type checker plus one
dependency-boundary lint: nothing outside `apps/api/src/semantic/` may import the Cube client.

`SecurityContext` is derived **per request** (FR-SEM-15). The façade lives in `packages/semantic` and
its single entry point is `compileAndExecute(ctx: SecurityContext, q: SemanticQuery, f:
FreshnessClass)`. **"One door" is a module boundary, not a process boundary** — this matters, because
`apps/render` must render an *unpublished* bundle in CI (ADR-005 D3) and therefore cannot go through
the running API. So both `apps/api` and `apps/render` import the same façade package, and the
boundary lint is: **`packages/semantic` is the only module in the repository that may import the Cube
client or a database driver**, and it exports no function that omits the security context. Two
processes, one door.

Observability is OpenTelemetry SDK with an OTLP exporter and nothing vendor-specific in application
code, so ADR-015 can choose a backend later without a rewrite (`07-domain-model.md §4` still has that
row OPEN). `tenant`, `subject`, `bundle_version` and `freshness_class` are span attributes on every
request.

### D5 — Where a second language is allowed, and where it is not

**Allowed:** the AI service, from M2, behind an HTTP boundary — the architecture brief already draws
it as a separate service, it writes no shared state (§2.3), and Python's LLM ecosystem is a real
advantage there. Its obligations are that it validates against the *published* JSON Schemas
(FR-AI-06) and that it **never serializes a spec itself** — it calls the canonical formatter. That
keeps ADR-004 D3 intact.

**Not allowed:** anything on the query path, anything that parses or writes specs, and the renderer.

## Consequences

**Enables**
- One `pnpm install`, one type-check, one test runner for the whole product. For a two-person team
  this is the single largest velocity decision available.
- CI screenshots come from the same chart code as the browser, so the review evidence is honest.
- M2 AI streaming is an event type, not a transport migration.
- FR-DEV-01's CLI is a wrapper over the same library the server uses, so "the hand-written path is
  never second-class" is structural rather than aspirational.

**Costs**
- Node for CPU-bound work: acceptable today, and the escape hatch is a worker process, but it is a
  real ceiling if we ever compute in-process (which §2.2 forbids anyway).
- The split-time data-team contributors write less Python here than they would like (Q-04). Mitigate
  by pointing them at `content/` — semantic models, conformance cases, dbt bootstrap (T-119) — which
  is where their expertise actually is and which needs no application code at all.
- Ajv-based route validation plus generated OpenAPI is slightly more setup than a code-first
  framework. Paid once.

**Forecloses**
- **A Python query path.** If FR-AI or a data-science feature later wants in-process Python against
  query results, that is a new service and a new ADR, not an import.
- **WebSocket-shaped features** — bidirectional collaboration in particular — without a new decision.
- **GraphQL as a public API.** Embedding (FR-VIZ-11) will be signed REST/iframe, not a graph.

**Revisit when** — any one:
1. **First-token latency misses NFR-PERF-03's 2 s** and profiling shows the job/SSE indirection is
   the cause rather than the model provider. Then collapse the streaming AI endpoint into a direct
   SSE response and keep the job model only for queries.
2. **The AI service needs to share the result cache or the compiler façade in-process**, not over
   HTTP. That breaks D5's boundary and is a genuine reason to re-open the language question.
3. **A CPU-bound component appears on the request path** — server-side pivot over 50k rows is the
   realistic candidate — and Node cannot hold NFR-PERF-02's 800 ms. That is a worker in another
   language behind a queue, not a rewrite.
4. **Tier-2 load testing (T-086) shows SSE connection count, not query throughput, is the binding
   constraint.** At 50 concurrent users this is implausible; recorded because it is the failure mode
   nobody looks for.

## Validation

1. **T-011's walking skeleton** goes browser → API → Cube → DuckDB → cache → chart with the envelope
   in D3 populated, including `as_of` and `cache`, with no warehouse credentials anywhere.
2. **A compile call cannot be written without a security context** — deleting the argument is a
   type error, and the boundary lint fails if any module outside `packages/semantic` imports the Cube
   client or a database driver. Asserted in T-116.
3. **A job's event stream survives a replica change**: start a stream against one replica, kill it,
   reconnect with `Last-Event-ID`, and receive the remaining events. Two containers on one host is
   enough to test it, and it is the check that proves D3's externalized-state claim.
4. The generated OpenAPI document validates, and one endpoint's request body is rejected by the same
   schema in the API, the CLI and CI (FR-SEM-11).
5. A trace for one dashboard load spans app → façade → Cube → warehouse with `tenant` and
   `bundle_version` present (NFR-OPS-01).

## Notes

- ADR-003 — Cube over HTTP explicitly leaves the backend language open; ADR-003 D4 requires the
  façade signature to take the security context.
- ADR-004 D3 — the single canonical serializer; this is the constraint that decides the language.
- ADR-005 — the headless-render gate; the second constraint that decides the language.
- `02-architecture-brief.md §3.4` — the streaming/latency warning this ADR answers.
- Fastify JSON Schema validation — <https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/>
- SSE (`text/event-stream`) and `Last-Event-ID` — <https://html.spec.whatwg.org/multipage/server-sent-events.html>

---

## Staffing input, considered; decision held with one concession (Product, 2026-08-10)

This ADR was written without one fact: **the ~20-person data team writes Python daily and TypeScript
rarely.** Product raised it and asked directly why not Python on the backend. Recording the exchange,
because the decision held for a reason that is not "we already started."

**The Python case that applies:** staffing, and it is real. **The ones that do not:** dbt owns
transformation (Q-11) so there is no dataframe work; the backend is thin — auth, security context,
cache, HTTP orchestration; and Cube is reached over HTTP, so it constrains the backend language not
at all.

**What settled it.** 26 of the 99 POC tickets are JS-pinned *regardless* of backend language —
`packages/spec` (the canonical emitter NFR-QUAL-01 depends on), `packages/charts`, `apps/render`, and
the CLI, all pinned by the browser editor and the headless-render gate. So the choice was never
*Python or TypeScript*; it was **TypeScript, or TypeScript and Python.** Python would not spare the
team TypeScript, it would add a second language and a second deployment shape on top of it.

Backend work that is genuinely language-flexible is ~30 POC tickets, and its character is HTTP, auth,
cache keys and orchestration — precisely where language matters least. There is very little
data-shaped code in the backend, by constraint (§2.2 forbids a second computation site).

**The concession, and it is a real one.** `tailwind fmt` is the canonicalizer, which makes it a
*boundary* rather than a monopoly:

- **Single implementation required:** the canonical emitter and the chart→config mapping. Both JS.
- **Language-neutral:** the JSON Schema contract. Any language can validate against it.
- **Therefore:** a Python tool may read specs and emit *rough* YAML, then pipe through
  `tailwind fmt` to canonicalize and the schema to validate.

So **data-team-facing tooling may be Python where that is natural** — T-119 (dbt manifest bootstrap)
is native Python territory, as is the AI eval harness, and `scripts/validate_docs.py` already is.
The application is TypeScript; the tooling boundary is `fmt` plus the schema.

**Mitigation for the residual staffing cost.** The friction for Python engineers is the *toolchain*,
not the language — Fastify with JSON Schema has no decorators, no DI container, no ORM. Keep the
toolchain minimal, one command to run everything, documented. The data team's real touchpoints are
the Cube YAML profile and the CLI, not the API.

**Revisit when:** data-team contributors are measurably blocked by the language, or the headless
render gate (ADR-005) is dropped. Either reopens this.

---

## D3 amendment: `as_of` may be null, and says why (T-109, 2026-08-13)

D3 types `as_of` as a `string`. In practice the engine frequently does not report a refresh time,
and the implementation filled the gap with `new Date()` — which asserts that the numbers are as
fresh as the page load. That is the most confidently wrong thing a BI tool can say, and it was
being said on every response.

**Amended envelope:**

```jsonc
"as_of": "2026-08-13T09:31:00Z" | null,   // the DATA's as-of, never the request time
"freshness": {
  "class": "standard",
  "stale": false,                          // null when unknowable
  "as_of_source": "engine" | "unknown",
  "max_staleness_seconds": 1800            // what the class PROMISES
}
```

Three properties worth keeping: `null` is a first-class answer rather than a fallback; `stale` is
`null` when as-of is unknown, because **absence of information is not evidence of freshness**; and
`max_staleness_seconds` makes the class's promise inspectable, so FR-FRESH-06's declared-versus-
achieved monitoring has something to compare against.

Derivation lives in one place — `packages/spec/freshness.ts` — so ADR-008's cache reads a policy
rather than re-deciding what `standard` means. The UI renders "as-of unknown" instead of a
fabricated timestamp.

**This is honest, not fixed.** Every response currently reports `as_of_source: "unknown"`, because
the real signal is upstream refresh completion — dbt run completion, per FR-FRESH-05 — which
arrives with T-111. The value of the amendment is that the gap is now visible instead of papered
over.
