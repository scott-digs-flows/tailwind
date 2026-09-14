# Tailwind — Design Brief

**A description of what Tailwind is, why it is shaped this way, and what an implementing team needs
to know before writing anything.**

This is a handoff document. It assumes you are building from scratch and owe nothing to any prior
implementation. It gives you the problem, the invariants, the hard parts, the traps, and a
recommended build order — and it distinguishes throughout between **constraints you should treat as
binding** and **choices we made whose reasoning you should re-derive rather than inherit.**

---

## 1. The idea

Tailwind is analytics-as-code with an AI authoring surface. A business user describes what they want
in plain language; the AI composes it **only** out of a governed semantic layer; the data team
approves it through a pull request. Every dashboard, metric, and model is a versioned text file.

The framing that matters, and the one most likely to be lost in implementation: **the AI is not a
chatbot bolted onto a BI tool. It is a compiler from business intent into reviewable artifacts.**
Its output is a diff a human reads, not an answer a human trusts. Nothing reaches a shared audience
without passing through the same review gate the data team already trusts for code.

The claim is that self-service and a single source of truth are not a trade-off, and that the two
halves are not a compromise but the same feature. Governance is what makes AI authoring safe enough
to permit; AI authoring is what makes governance cheap enough to sustain. **Remove either half and
the remaining half stops working** — governance alone is Looker's bottleneck, AI alone is the
confident wrong number.

That failure mode is the one to design against explicitly: **a confident chart with a wrong number**,
which every demo in this category quietly avoids. The structural answer is that the AI cannot invent
a number. It can only compose metrics a human has already certified, or open a proposal for a new
one. This is a property of the architecture, not of prompt quality, and it should stay that way.

## 2. Why existing tools leave room

| Tool | Got right | Breaks on |
|---|---|---|
| **Tableau / Power BI** | Real self-service — business users genuinely build things | Ungoverned sprawl. Ten workbooks, ten definitions of "revenue". No review gate, no diff, no test. The data team becomes a help desk rather than an owner. |
| **Looker** | Definitions as code in git, reviewed and versioned | Authoring is expert-only. A business user cannot write LookML, so governance bottlenecks on exactly one team. AI is a feature, not the authoring model. |

Tailwind takes Looker's governance model and removes its bottleneck. That is the product in one
sentence — and it is also where the risk lives, because the bottleneck is removed by trusting
AI-generated specs to be *reviewable by humans in minutes*. That is an empirical claim about
reviewers, not a technical one. §10 is about how to test it before you build on it.

## 3. Who it serves

Four personas. The first two are the customers; the last two make the system trustworthy and keep it
running. Build for all four — a design that serves only the first two produces exactly the
ungoverned sprawl the product exists to fix.

**The Consumer (~80% of users).** Reads dashboards to decide things. Filters, drills, exports to a
deck. Will never write code and should never see YAML or SQL. Wins when the number is right, the
page is fast, and a follow-up question doesn't require filing a ticket.

**The Builder (~15%).** An ops, finance, or marketing analyst. Excel power user, maybe some SQL,
definitely no git. Today they export to a spreadsheet and build a shadow model because the official
dashboard doesn't answer their question. **This persona is the entire thesis. If they cannot get a
proposal merged, you have built Looker.**

**The Analytics Engineer (~5%, highest leverage).** Owns the semantic layer and reviews everything.
Wins when reviewing a proposal takes three minutes because CI already rendered it, diffed the
metric, and flagged the cost — rather than three hours of reverse-engineering. **Their hand-written
path must stay first-class: no AI required, ever.** If the command-line workflow degrades to make the
AI look better, you have lost the team that guarantees correctness — and with them, the guarantee.

**The Platform Admin.** Owns connections, identity, permissions, spend, uptime. "Nobody sees data
they shouldn't, and nobody runs a $4,000 query."

### The three loops

Organise the product around three loops of increasing commitment. **The escalator between them is
what you are actually building** — each loop must make the next one feel like the obvious next step.

| Loop | Who | Duration | Governed | Output |
|---|---|---|---|---|
| **Consume** | Consumer | seconds | Yes — certified metrics only | An answer |
| **Explore** | Builder, Engineer | minutes | No — sandboxed, watermarked as draft | A private draft |
| **Promote** | Builder → Engineer | hours–days | Yes — proposal, CI, human review | A merged, shared artifact |

Loop 1 includes natural-language question answering, but answers are **compiled against the semantic
layer, never free-form SQL**. If a question cannot be answered from certified metrics, say so and
offer to start Loop 2. Do not guess. The temptation to fall back to generated SQL "just this once"
is the single most likely way this architecture gets quietly broken.

Loop 2 is deliberately uncomfortable. Drafts are shareable by link but carry a visible unreviewed
badge, and cannot be subscribed to, embedded, or scheduled. **That friction is a feature** — it is
the pressure that pushes good work into Loop 3. A draft that is too pleasant to live in is a draft
nobody promotes.

Loop 3 is the differentiator, and the part worth building carefully. The Builder clicks *Propose*;
the system opens a branch, commits the spec, and opens a pull request through a bot **on their
behalf — they never need a git account**. CI then performs the review work a human would otherwise
do by hand:

- Renders the dashboard against real data and posts screenshots to the proposal
- Diffs the metric — "this change moves FY24 revenue by −3.2%" — over a sample window
- Runs assertions the data team wrote
- Estimates query cost and flags anything above a threshold
- Reports impact — "17 dashboards depend on this dimension"

**The reviewer reads the evidence, not the YAML.** Everything else in Loop 3 is negotiable; that
sentence is the design goal. Review comments must thread back into the app so the Builder sees them
without leaving.

## 4. Shape of the system

Two planes, separated by a publish step.

The **control plane** is the repository and its CI. It holds the source of truth — models, metrics,
dashboards, tests — and runs the review gate: validate, compile, assert, render, diff. Access
control is ownership-based routing plus human approval.

The **serving plane** is stateless and horizontally scaled. It answers queries: an API resolves the
requesting user's identity into a security context; a semantic compiler turns a request plus that
context into SQL; the warehouse executes; a result cache sits in front. **It reads published
artifacts, never the repository directly.**

The **AI service** is proposal-only. It assembles context, calls a model provider, generates a spec,
validates and compiles it, and produces a diff. It has no write path to shared state and no
independent route to the warehouse.

**The load-bearing idea is the separation itself.** Authoring throughput and consumption throughput
scale independently, and no authoring action — however wrong — can degrade consumption. Everything
downstream of that split is yours to design. The split is not.

## 5. Invariants

Seven properties that must hold. Most of the architecture is downstream of them, and each one is
substantially more expensive to introduce later than to assume from the first line of code.

1. **Version control is the source of truth for artifacts.** Not a database with an export.
   History, branching and review are the actual mechanism, not a mirror of one.
2. **All numbers flow through the semantic compiler.** No path — AI, export, drill-through,
   scheduled delivery, embedded view — emits SQL that bypasses it. **One door.**
3. **AI writes proposals, never shared state.** Its only durable output is a validated diff.
4. **Row-level security is enforced server-side during query construction**, derived from the
   requesting user's identity, independent of who authored the artifact, and resolved **per request,
   not per tenant**. Never applied in the browser, never a filter a client can drop.
5. **Spec serialization is deterministic and lossless.** If diffs are noisy, the review gate is
   theater and the thesis is untestable.
6. **The serving tier is stateless.** Scale by replicas, not redesign.
7. **Authors need no account on the git host.** The application brokers proposals through a service
   identity and attributes authorship in the commit trailer.

Two corollaries resolve most design arguments before they start.

**Nothing in the operational database may change a number.** Version control holds what humans
review; the database holds runtime and personal state. The security context may *restrict* rows or
mask columns — it may never *redefine* a metric. When you are unsure where a piece of state belongs,
this is the test.

**The hand-written path is never second-class.** Every capability reachable through the AI must be
reachable through files and a CLI, by someone who never opens the web application.

A note on invariant 4, because it reliably causes confusion. It is tempting to state this as
"enforced at compile time", but that phrase collides with vendor vocabulary — semantic engines
typically offer a compile-time context that resolves **per tenant only** and cannot express a
per-user predicate. Forcing it to by minting per-user application IDs is a documented anti-pattern
that does not scale. Per-user predicates belong on the query-construction path. That still satisfies
the invariant: server-side, in the generated SQL, unbypassable by the client. **Say "during query
construction" and the ambiguity disappears.**

## 6. The hard problems

This is the section worth arguing with. Each of these is where the design succeeds or fails, and
naming them is more useful than any component diagram.

### Version control as an operational datastore

Git is excellent for review and unsuitable as a read path for a concurrent application. A publish
step is the answer, but its shape determines everything downstream: **an immutable bundle per merge
commit** (rollback is repointing at the previous bundle) versus a git-backed cache (rollback is a
revert and a rebuild). Decide the rollback story and its speed *before* the publish mechanism, not
after.

Concurrent authoring is the sharper edge. Two users editing the same dashboard: branch-per-draft,
optimistic conflict at propose time, or an application-level lock? **Whatever you choose, the
Builder will not resolve a merge conflict.** Design what they see when it happens, in product terms,
early — this is the most common place where an analytics-as-code product leaks its implementation
into the user experience.

Also plan for repository growth. Thousands of specs plus rendered artifacts, and ownership-based
review routing that has to survive whatever layout you pick.

### The semantic compiler

The most valuable and most dangerous component.

**Recommendation: adopt an engine rather than build one.** Building a semantic compiler is a
multi-year product in itself, and the market has several mature options. But adopting moves the risk
rather than removing it, so score candidates on three things and weight them honestly:

- **Dialect support for your actual warehouse.** An engine that supports your target warehouse at
  beta quality is disqualifying, not a workaround.
- **The extension model.** You will need to attach required metadata and certification states to
  every metric and dimension. If that requires a fork, you have bought a maintenance burden
  disguised as a dependency.
- **Correctness on fan-out and chasm traps.** Weight this heavily — we weighted it triple.

**Fan-out deserves its own paragraph**, because it is the correctness failure that matters most and
is least visible. When a fact table joins to another table at a different grain, naive aggregation
multiplies rows and silently inflates every additive measure. A well-designed engine detects this
from *declared join cardinality* and rewrites the query. The consequence for your model format:
**cardinality and primary keys must be mandatory, declared fields**, because a missing declaration
means the detector cannot fire — and a detector that cannot fire produces plausible, wrong numbers
rather than an error.

If you license the model format from the engine, note that the engine's spec becomes a hard input to
your own spec design. **Do not design your spec format before you have chosen the engine.**

### Caching with security correctness

Your performance target is unreachable without a high cache hit rate. Row-level security makes
caching dangerous. These two facts are in direct tension and the resolution needs to be rigorous.

A cache key must include the user's security context, or one user's rows are served to another. But
naive per-user keys destroy the hit rate, which was the entire point.

The optimisation everyone reaches for is caching a **pre-RLS** result and filtering it on read.
**There is no published formal treatment of when this is sound.** Every vendor that does it leaves
verification to the operator; at least one major warehouse refuses to cache at all on any table with
a row-level policy, which tells you how the people closest to the problem assess the risk.

So here are the conditions, written down so a design can be held to them. A cached pre-RLS result
may be filtered on read **only if all four hold**:

1. **Expressibility.** The security predicate is expressible over columns present in the cached
   result *at its cached grain*. A predicate on an owner column cannot be applied to a result
   grouped by region.
2. **Decomposability.** Every measure is additive (sum, count) or re-aggregable (min, max) over the
   partition. Distinct counts, medians and percentiles are **not** recoverable.
3. **Partition, not predicate.** The security rule induces a disjoint, covering partition on a
   grouping key — not an arbitrary row filter.
4. **No cardinality leakage.** No total, count, rank or percentile computed pre-RLS is exposed
   alongside the filtered rows, or invisible rows leak through the aggregate.

Where any condition fails, the key includes the security context and that is the end of it. **Make
per-context keying the default and pre-RLS caching an optimisation that proves all four conditions
per query shape** — with a test, not a comment.

Note that condition 2 is the same additivity question as fan-out. Both ask whether an aggregate
commutes with a partition of its input, so **the two analyses should share a test suite.**

This is not a hypothetical risk. It is the single most repeated bug in this product category:
*something that scopes the query fails to scope the cache.* There is a Metabase CVE where cached
rows were served to an impersonated user; dbt's Semantic Layer documents that cached metrics do not
carry the security context; Cube warns that a pre-aggregation refreshed without a security context
is built with no row-level security at all and then served to everyone. **Assume your team will make
this mistake unless the cache API makes it impossible to make.**

### Freshness is not uniform

Most content tolerates roughly thirty minutes of staleness. Some operational content needs near-live
data. Three consequences:

- **Make the freshness class a declared, reviewed property of each artifact**, not a runtime knob.
  It is an input to the cache layer, so its shape must exist in the cache API from the first version
  even if only one class is exercised. Recutting a cache API later is expensive.
- **A blended cache-hit-rate target is meaningless across classes.** State targets per class and
  make your load test report them that way.
- **Near-live content has no meaningful result cache**, so its cost scales with users × refresh
  rate. On a consumption-priced warehouse this is the most expensive thing in the product. Route it
  through data-team approval with cost surfaced in review.

Decide early how upstream freshness is *known* — pipeline-completion webhook, warehouse metadata, or
polling. It constrains invalidation design.

Worth flagging as scope risk: the near-live use case is usually a per-user worklist — row-level and
action-oriented rather than aggregate. It fits a semantic layer awkwardly and it makes row-level
security load-bearing rather than optional. **Consider keeping it expressible but unimplemented in
early versions.**

### AI reliability and cost

**Context assembly is the real engineering problem, not prompting.** With a large semantic layer you
cannot put everything in the prompt, so what gets retrieved and how is the design question:
retrieval over metric and dimension descriptions, usage-frequency weighting, recent-dashboard
examples. This is also why required metadata matters twice — those descriptions are what the AI
grounds on, so a lazy one costs you at authoring time and again at generation time.

**Structured output** must conform to your schema. Choose between constrained generation and a
bounded generate-validate-repair loop, and bound the retries.

**Latency shapes your API.** A thirty-second proposal needs streaming and visible progress, which
determines your transport and your entire front-end state model. This is expensive to retrofit —
**put the streaming transport in place before you need it**, so the AI path adds an event type
rather than a transport.

**Cost control** needs per-user budgets, context caching, and a policy about which model tier handles
which task — a cheap model for classification and routing, a strong one for spec generation.

**Prompt injection through data is a live surface.** A dimension value can contain adversarial text.
Every AI surface that touches warehouse content must treat it as untrusted input. This is not
speculative for a product whose whole purpose is feeding warehouse data to a model.

### Rendering dashboards headlessly

The review gate requires CI to render real dashboards against real data. Two consequences that reach
much further than they look:

**CI needs warehouse access**, which is a meaningful security boundary decision, not a configuration
detail.

**Your chart library must render outside a browser.** This is a gate, not a preference — it is
required for review screenshots and for PDF export. It eliminates a surprising number of otherwise
attractive libraries, and it is the kind of requirement that is nearly impossible to satisfy by
swapping libraries late. Evaluate candidates against server-side rendering, cross-filtering and
drill interactions, and accessibility — not against the chart gallery.

Rendering must also be *fast*. If review is gated on a fifteen-minute job, reviewers route around it
and the gate stops being real.

### The visual editor

The hardest UI in the product, and the one to build last. **Treat the spec as the document model**
rather than syncing two representations — the editor's internal state *is* the spec. Anything else
produces round-trip loss, and round-trip loss breaks invariant 5, which breaks the review gate.

Do not build it before the spec format is stable. It is a projection of the spec; an unstable spec
means rewriting the editor.

### Multi-tenancy

If a multi-tenant future is plausible, thread a tenant identifier through from the beginning —
artifact registry, cache keys, connection management, security context, audit log, repository
layout. Retrofitting it is a rewrite of the compiler and the cache.

**The failure mode to design against is *decorative* tenancy**: a tenant column that exists but is
never exercised, so single-tenant assumptions accumulate underneath it and the second tenant is
still a rewrite. The thorough countermeasure is to run two tenants in every non-production
environment. The cheap countermeasure, if that is too much ceremony early, is a small set of
mechanical checks: assert at migration time that every tenant-scoped table has the column and an
enabled policy; unit-test the compiler and cache layers with two contexts; and test that an
unresolved tenant is rejected rather than defaulted. **The cheap version catches most of what the
thorough version catches**, and is about a day of work.

## 7. Technology choices, and which parts transfer

We made a specific set of choices. **The reasoning transfers; the conclusions may not.** Re-derive
them against your team's skills and your warehouse — but do read the chain below, because one of
these decisions looks arbitrary and is not.

| Area | What we chose | Why |
|---|---|---|
| Semantic engine | An Apache-2.0 engine, self-hosted, behind a thin façade of our own | Adopting beats building; the façade means the vendor's model format never becomes our public API |
| Warehouse | One dialect, single warehouse of record | Dialect count is a cost multiplier on the conformance suite, cost model, and security primitives. **One at launch.** |
| Language | TypeScript end-to-end | See the chain below — this was not a free choice |
| Charts | A library that renders in Node | Required by CI screenshots and PDF |
| Deployment | The simplest thing that runs the whole stack | Deployment complexity is not where this product's risk lives |

**The chain that forces the language.** Requiring CI screenshots and PDF export makes non-browser
chart rendering a gate, and every library that passes that gate renders in Node. Separately,
deterministic serialization requires exactly *one* canonical serializer, shared by the CLI, the API,
the AI path, and the eventual visual editor — and the editor runs in a browser. Those two together
mean one language end-to-end, or else **two chart implementations and two serializers that must
agree byte-for-byte forever.** If your team's strength is elsewhere, you can choose differently —
but you are choosing to maintain those duplicates, and you should do so knowingly.

**Two constraints worth carrying regardless of what you pick.**

*Use the open-source tier only, and enforce it mechanically.* If a vendor's paid tier offers a
tempting feature, the moment it becomes load-bearing your architecture has a licence dependency
nobody voted on. A lint that rejects paid-tier configuration keys costs an afternoon and removes the
question permanently.

*Pin the semantic engine to an exact minor version.* Reach for a vendor's long-term-support line by
reflex and you can easily land on one that predates the query planner handling the very cases you
selected the engine for. **Pin to the version you tested the hard cases against.**

## 8. What is expensive to retrofit

If you take one section from this document, take this one. Everything here is cheap to include from
the start and a rewrite to add later. Under schedule pressure these are exactly what gets cut, and
cutting them is how the product fails slowly.

**The security context as a parameter of query construction and of the cache key.** You may populate
it permissively at first — but get the *shape* right immediately. Adding it later is a rewrite of
both the compiler and the cache.

**Deterministic, lossless serialization.** The review gate is diffs. Noisy diffs make the gate
theater, which makes the thesis untestable, which means you cannot tell whether the product works.

**One route to the warehouse.** The moment there are two, the governance guarantee is gone —
and the second one always arrives as a reasonable-sounding exception.

**A streaming transport.** Put it in before the AI needs it, so the AI path adds an event type
rather than a transport.

**The freshness class in the cache API's shape.** Even if only one class is ever exercised early.

**A cache whose API makes context-free keying impossible.** Not a cache with a documented
convention about context. See §6.

**The conformance suite.** Discussed in §9 — the argument for building it before you need it is that
it is what tells you whether anything else works.

## 9. Two principles that cost us to learn

Both are about *how you know something works*, and both generalise well beyond the incidents that
produced them.

### Assert the negative, or you have asserted nothing

A security control that is completely inert looks identical, from the outside, to one that works —
because the authorised user sees their data in both cases. Confirming that the *right* user sees the
*right* rows tells you nothing at all. **The test that means something is that the wrong user sees
nothing.**

This generalises to every mechanism whose job is to prevent something: row-level security, tenant
isolation, cost limits, the paid-tier lint, the one-door guarantee. For each, write the test that
fails if the mechanism is removed. If no such test exists, you do not know the mechanism works — you
know only that it has not visibly broken.

The most instructive way this bites: a database's row-level security can be enabled, forced, and
correctly written, and still be bypassed entirely because the connecting role holds a privilege that
ignores it. Every positive check passes. **Run your application on a role that has no such
privilege, and prove it by trying.**

### A test suite that passes with its mechanism disabled is testing nothing

Build a conformance suite for the correctness properties that matter — fan-out, chasm traps, grain
rollups — with expected values computed by querying the warehouse **directly**, never through the
semantic layer. Otherwise your oracle inherits the bugs it is supposed to detect.

Then add a **negative control**: a mode that deliberately breaks the mechanism, which the suite must
detect. Run it in CI alongside the real suite.

This is not belt-and-braces. It is possible to write a conformance suite that passes completely with
fan-out detection disabled, because a plausible-looking model topology can route every query around
the one-to-many join the detector guards. Such a suite measures nothing and certifies confidently.
**Change the model until the control fires**, and keep it firing.

The numbers are worth internalising, because they show what "wrong" looks like here: with join
cardinality mis-declared, a freight measure reported **31.5× its true value** and an order count
silently counted line items instead of orders. Neither looks wrong on a chart. Both would survive
any review that did not have a number to compare against.

### The corollary for the product itself

**Mechanical rules belong in a check, not in someone's memory.** This is the argument the product
makes to its own users — that a review gate with automated evidence beats a careful reviewer — so
apply it internally or the product does not believe its own thesis. Every rule stated in a document
and enforced by nothing will be violated, and the violation will be found late.

## 10. The assumption everything rests on

> **A business user, assisted by AI, can produce an analytics artifact that a data engineer is
> willing to merge — and reviewing it is faster than building it from scratch.**

If this is false, you have built an expensive Looker. Every other risk in this document is a matter
of engineering competence. This one is not, and **it is not a technical risk at all** — it is a claim
about what human reviewers will accept.

**This can be tested before you write any application code**, and we recommend doing so. Set up a
semantic model over a real subject area, have real business users describe what they want, have
someone play the role of the AI by hand-authoring specs from those descriptions, and have a real
data engineer review the results without knowing which is which. You end with a merge rate, a median
review time, and a list of specific named problems — plus real specs, diffs, and reviewer comments to
design the product around.

Two design notes if you run it. **Whoever builds cannot judge** — the reviewer must be someone not
working on the product. And instrument the *review experience* heavily, not just the outcome; the
reason a proposal was rejected is worth more than the rejection rate.

The cost is data-team and reviewer time rather than engineering time, so it does not compete for the
scarce resource, and it can run in parallel with early construction.

**Define the kill criteria before you start, and write them down.** Ours: after 30 real
business-authored proposals, if the merge rate is below 50% or median reviewer time exceeds the time
the engineer would have spent building it themselves, **the authoring model gets redesigned rather
than scaled.** A thesis with no falsification condition is a belief.

There is a real counter-argument to testing first, and it deserves to be stated honestly: building a
thin end-to-end path proves the integration works, forces the architecture decisions to become
concrete, and produces something demonstrable. Both arguments are good. What is not defensible is
building for months *without deciding* which one you are doing.

## 11. Suggested build order

Sequenced by **risk retired**, not by feature area. Each stage's exit is a demonstrable behaviour
rather than a list of completed work.

**Stage 0 — the walking skeleton.** *Retires: can the core loop work at all?* One hand-written
semantic model, one hand-written dashboard spec, rendered in a browser from a real warehouse query,
with the generated SQL visible. No AI, no authentication, no editor, no proposal loop. Deploy it to
a real environment on day one so deployment is never a late surprise. **Exit: a developer changes a
metric definition in a file and the deployed dashboard reflects it.**

**Stage 1 — governed consumption.** *Retires: can we serve real users trustworthy numbers, fast?*
Enough metric coverage for one real subject area; core chart types with filters, cross-filtering and
drill-down; identity, roles, object permissions and **row-level security**; result cache, query
governor, observability; provenance badges and "how is this calculated?"; and the CLI and local
development loop for the data team. **Exit: a pilot group uses this instead of their legacy tool for
one subject area for two weeks, and the numbers are verified to match.**

This stage is independently valuable — real users get real value with zero authoring capability.
That makes it a genuine fallback position if the thesis fails, and it is worth protecting that
property as you build.

**Stage 2 — AI authoring and the promotion loop.** *Retires: the thesis.* Question-answering over
certified metrics; AI-generated draft dashboard specs; a draft workspace with watermarking; propose
-to-pull-request via a service identity; CI that validates, compiles, asserts, renders screenshots
and diffs metrics; in-app review status and comment mirroring. **Exit: the kill criteria in §10,
measured.** Scope this narrowly on purpose — a small number of real users, one subject area, heavy
instrumentation of the review experience.

**Stage 3 — production hardening.** *Retires: does it hold at real scale and content volume?* The
visual editor, scheduled delivery and exports, preview environments and impact analysis, admin
surfaces for usage and spend, load testing, an accessibility pass on the consumption path, threat
model and penetration test.

**Stage 4 — migration.** *Retires: can the organisation actually leave the incumbent?* Legacy
inventory and usage-based prioritisation, side-by-side validation, coexistence signalling, alerting
and embedding as demand dictates.

**Two sequencing traps worth stating explicitly.** Do not build the visual editor before the spec
format is stable. Do not defer row-level security or the cache — both constrain the compiler's API
surface, and both are rewrites to add.

**And a cut order, decided in advance rather than under pressure.** First to go: the visual editor,
then scheduled delivery and exports beyond CSV, then per-proposal preview environments, then
column-level security if no sensitive data is in the pilot's scope. **Never cut: row-level security,
the metric diff in CI, provenance badges, or deterministic serialization.** Each is load-bearing for
trust, and each is far more expensive to add later than to build now.

## 12. Non-goals

Naming these protects the roadmap. Each is a defensible *later*, not a *never* — but treat them as
out of scope until something forces the question.

Tailwind is **not** a general SQL IDE or notebook environment; **not** an ingestion, ELT or
transformation orchestrator (it consumes a warehouse someone else loads — a transformation tool runs
upstream, not inside); **not** a data catalog or lineage product (integrate with one, don't become
one); **not** pixel-perfect paginated reporting; **not** customer-facing embedded analytics with
per-tenant branding; **not** a workbook importer for the incumbent tool; and **not** offline or
native mobile — responsive web only.

Migration pressure is the most likely source of a forced change here, specifically around workbook
import.

## 13. Questions you will have to answer for yourselves

These are genuinely open, and the answers depend on your organisation rather than on the design.

**Which warehouse, and how many dialects.** One at launch is a strong recommendation; *which* one
should follow where your data and your team's existing work actually are. Certify it against a
conformance suite and let the support tier be a **computed result rather than a declared claim.**

**Where secrets live, and what the observability standard is.** Both can invalidate an architectural
decision after it is written. Answer them early even though they feel like operational detail.

**Sizing.** Design for the population you actually have. Ensure the architecture does not *preclude*
an order of magnitude more; do not design *for* it. Treat any scale number as untested until you
have telemetry.

**How much AI egress your organisation tolerates.** This shapes provider selection, model tiering,
and whether warehouse data can appear in a prompt at all.

**Whether the review bottleneck moves rather than disappears.** The thesis says AI removes the
authoring bottleneck. It is worth asking early whether that simply relocates the queue to review —
and instrumenting for it, because the answer determines whether the product scales past its first
team.

Finally, one piece of hard-won process advice. **The documents are the contract, and they decay in a
way code does not.** Nothing in CI catches a paragraph that has quietly become false after a system
changes underneath it. Whatever your equivalent of this brief is, schedule its re-reading against
the running system, or it will confidently mislead the next team.
