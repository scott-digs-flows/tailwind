# ADR-004 — Spec format, repository layout, and the canonical serializer

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** Systems Architect (proposer) · Full-Stack · Product (reviewer)
- **Milestone:** M0
- **Requirements:** FR-SEM-01, FR-SEM-06, FR-SEM-07, FR-SEM-11, FR-VIZ-01, FR-VIZ-02, FR-DEV-03,
  FR-DEV-04, FR-FRESH-01, FR-AI-06, NFR-QUAL-01, NFR-TEN-01
- **Tickets:** T-006 (produces) · constrains T-010, T-011, T-012, T-013, T-115, T-031 · related
  T-102, T-119

## Context

ADR-003 D2 already decided the hard half: **the reviewed semantic artifact is Cube's YAML under a
constrained "Tailwind profile"**, not a Tailwind format compiled down to Cube. What is left is
everything around it, and all of it is load-bearing for the POC:

1. **Where files live** — one object per file or many, and how a tenant is separable by path
   (`07-domain-model.md §2`: deleting a tenant must not require rewriting git history).
2. **The JSON Schema strategy.** FR-SEM-11 requires identical validation in the editor, the CLI and
   CI. **Cube publishes no JSON Schema for its YAML data model**, so the schema for the semantic
   half is *ours to write and ours to maintain* against an upstream that can change under us. That
   is a real, recurring cost and it needs a stated containment strategy, not a footnote.
3. **Deterministic, lossless serialization** (NFR-QUAL-01). `08-poc-scope.md §3.2` and
   `03-roadmap.md` both name this as one of exactly two things that must not be cut for speed. The
   review model is diffs; noisy diffs make the PR gate theater and the hypothesis untestable.
4. **The freshness class must exist in the spec from day one** (FR-FRESH-01, `08-poc-scope.md §3.7`)
   even though only `standard` will work.

**Constraints that bound this** (`02-architecture-brief.md §2`): git is the source of truth (§2.1);
serialization is deterministic and lossless across the visual editor, the CLI formatter and AI
generation (§2.5). And from ADR-003: YAML only, no JavaScript models, no Jinja.

**Explicitly out of scope:** how much of the spec a non-technical author ever *sees*. That is a
product question, it is **T-122**, and it feeds ADR-005 and the visual editor — not the file format.
The format is designed for the reviewer and the analytics engineer; the author-facing projection is
a separate surface built on top of it.

**Open questions this runs ahead of:** Q-01 is unanswered. Nothing here depends on it — the layout
holds a connection *definition* per environment and the dialect is a field in it.

## Options considered

### Layout — Option A: one monorepo with a self-contained `content/` root ✅

App code, infrastructure and reviewed artifacts in one repository, with all artifacts under a single
`content/` directory that has no upward references, so it can be lifted into its own repository
later without a single path inside it changing.

**Pros.** One CI pipeline, one deploy trigger — which is precisely what the M0 exit criterion
("change a metric in a file, see the number change on the deployed page") needs. One clone for the
local dev loop (FR-DEV-02). Requirements, tickets, ADRs and artifacts stay reviewable in the same
PR, which is how this repo already works.
**Cons.** App churn and content churn share a history and a CODEOWNERS file. Every content PR runs
(or must be taught to skip) the application build. At M2 the GitHub App will be opening PRs from
business users into the repository that holds all the application code.

### Layout — Option B: two repositories from day one (`tailwind-app`, `tailwind-content`)

**Pros.** Clean review surfaces, clean CODEOWNERS, narrow GitHub App scope (T-108), and the
artifact bundle is built from a content SHA with nothing else in it. This is almost certainly the
GA shape.
**Cons.** For the POC it buys nothing and costs a cross-repo publish trigger, two CI configs, and a
version-skew problem between the schema (in the app repo) and the content it validates —
immediately, in M0, before there is any content to protect. The walking skeleton would need
cross-repo plumbing on day one to demonstrate its exit criterion.

### Schema — Option A: hand-authored JSON Schema 2020-12 as the source of truth ✅

Schemas are authored as JSON Schema files, versioned in `packages/spec/schemas/v1/`, validated with
Ajv in strict mode, and TypeScript types are **generated** from them.

**Pros.** The published contract *is* the source of truth, not a by-product. FR-DEV-03 (VS Code
autocomplete via `yaml.schemas`) and FR-AI-06 (constrained generation / structured output) both
consume JSON Schema and nothing else. Language-neutral, so an AI service in another runtime
validates against the same file.
**Cons.** Hand-written schemas are more verbose than a code-first DSL, and the "no drift between
schema and types" property has to be enforced by a CI check rather than by construction.

### Schema — Option B: code-first (Zod / TypeBox) with JSON Schema generated out of it

**Pros.** One artifact to maintain, better error messages, refinements that JSON Schema cannot
express, types by construction.
**Cons.** The *published* schema becomes a generated artifact of an implementation detail, and
generators quietly emit constructs that constrained decoding and VS Code handle badly. It also
couples the contract to TypeScript at exactly the boundary (AI, CI, third-party tooling) where we
most want it neutral. Rejected, but it is a close call and the deciding factor is FR-AI-06.

## Decision

**One monorepo with a self-contained `content/` root; one object per file with a type-bearing
extension; hand-authored JSON Schema 2020-12 as the published contract with TypeScript generated
from it; and a single canonical YAML emitter in `packages/spec` that every writer — CLI, API, AI,
and the future visual editor — is required to go through.**

### D1 — Repository layout

```
tailwind/
  apps/web/                     front end (ADR-005)
  apps/api/                     API / BFF (ADR-006)
  apps/render/                  headless chart/dashboard renderer (ADR-005)
  packages/spec/                schemas + parser + canonical emitter + validator  ← the contract
    schemas/v1/*.json
  packages/semantic/            the Cube façade — the ONLY module that may reach the warehouse
  packages/charts/              spec + result set → chart config (ADR-005 D2)
  packages/cli/                 `tailwind` CLI (FR-DEV-01/04)
  infra/                        terraform + compose + versions.env (ADR-001)
  content/                      ← reviewed artifacts. Git is the source of truth (§2.1).
    tenants/
      internal/
        semantic/               the Tailwind profile of Cube YAML (ADR-003 D2)
          cubes/<domain>/<entity>.cube.yml
          views/<domain>/<name>.view.yml
          calendars/<name>.calendar.yml
        dashboards/<domain>/<slug>.dash.yml
        tests/<domain>/<slug>.assert.yml
        connections/<env>.conn.yml          definitions only — never secrets
  CODEOWNERS
```

Rules, all mechanically enforced by the validator (T-115) rather than by convention:

- **One object per file, and the filename is the object's name.** `revenue.view.yml` declares a view
  named `revenue`. This is what makes diffs small, CODEOWNERS routing precise, and concurrent
  authoring survivable — two authors touching two dashboards never touch the same file. A monolithic
  `metrics.yml` would produce a merge conflict on nearly every proposal.
- **The extension carries the type**, so a JSON Schema is attached by glob. `yaml.schemas` in
  `.vscode/settings.json` gives FR-DEV-03 for free, and the CLI picks a schema from the path with
  no front-matter and no guessing.
- **`content/` never references anything above it.** Enforced by a lint. This is what keeps Option
  B available at the cost of a `git filter-repo` and a submodule, rather than a refactor.
- **CODEOWNERS routes on `content/tenants/*/semantic/**` → data team**, everything else in
  `content/` → domain owners. FR-GOV-07 is then a platform property, not application code.
- Secrets never appear in `content/`. `connections/<env>.conn.yml` holds dialect, host and a
  **secret reference by name**; NFR-SEC-01 owns the store.

### D2 — Two schema families, one of which is a mirror we own

**Tailwind-native** (`dashboard`, `assertion`, `connection`) — we designed these, we own them
outright.

**The Cube profile** (`cube`, `view`, `calendar`) — a *restrictive* JSON Schema over the subset of
Cube's YAML that ADR-003 D2 permits. Every object is `additionalProperties: false`. That single
choice is what turns the "profile" from a style guide into a gate: a Cube key we have not vetted
does not parse, so it cannot appear in a reviewed artifact by accident, and a Cube upgrade that adds
syntax is a deliberate schema change rather than a silent widening.

Because Cube publishes no schema, three containment measures come with this and are part of the
decision, not follow-ups:

1. **The Cube version is pinned in exactly one place** — `infra/versions.env` — read by compose, by
   CI, and stamped into each profile schema as `x-tailwind-cube-version`. A Cube bump that does not
   also touch the schemas fails CI. There is no `lts` Docker tag, so the pin is an exact minor;
   **which** minor is contested and argued in ADR-003 §*Correction 3* (LTS lines predate the release
   where Tesseract became the default, and multi-fact views require Tesseract).
2. **A Cube upgrade must pass the conformance suite (T-097) before it ships.** ADR-003 already
   budgets this as a standing chore; this ADR makes the schema part of what the chore covers.
3. **Keep the mirror minimal.** We schematize only what the profile allows. The cost of the mirror
   scales with the surface we permit, so permitting less is the primary cost control — which happens
   to be the same instinct that produced the profile in the first place.

Every file carries `spec_version: 1`. Schemas have stable `$id`s
(`https://schemas.tailwind.internal/v1/dashboard.json`), are published as a build artifact, and an
unknown `spec_version` is rejected rather than best-effort parsed. TypeScript types are generated
into `packages/spec/src/generated/` and committed; CI fails if regeneration produces a diff.

Two forward-looking constraints, both nearly free now and expensive later:

- **Keep the schemas usable for constrained generation** (FR-AI-06): no unbounded recursion, no
  top-level `oneOf` where a discriminated `const` field will do, no `$dynamicRef`. Providers'
  structured-output modes reject or degrade on those, and finding out at M2 would be a schema
  rewrite.
- **All Tailwind-specific metadata lives under a single `meta.tailwind` namespace** rather than
  scattered custom keys. ADR-003's note on Apache Ossie recommends shaping the profile so it maps to
  a sanctioned vendor-extension hook later; one namespace is the whole cost of that option.

### D3 — The canonical emitter, and the property that actually gets tested

One implementation, in `packages/spec`, used by the CLI (`tailwind fmt`), the API, the AI path and
the future editor. There is no second serializer anywhere in the system — this is the single
strongest reason the stack is one language (ADR-006).

Canonical form:

- UTF-8, no BOM, LF, exactly one trailing newline, 2-space indent, no tabs.
- Block style only. **No flow collections, no anchors, no aliases, no merge keys, no multi-document
  files.** Each is a legal YAML construct whose diff behaviour is bad or whose expansion is
  non-obvious to a reviewer.
- **Key order is schema-declared order, not alphabetical.** `name` and `meta` first, then the
  schema's property order. Alphabetical is deterministic but scrambles meaning; schema order is
  deterministic *and* readable, and it is stable because the schema is versioned.
- One quoting rule, applied by a single function: plain scalars unless quoting is required;
  YAML-1.1-ambiguous scalars (`yes`, `no`, `on`, `off`, `null`, bare versions, leading zeros) always
  quoted. Numbers in shortest round-trip form, never exponent notation.
- `description` and any prose field longer than 80 characters is emitted as a block scalar, so prose
  diffs are line-wise instead of one enormous changed line.
- **Comments are preserved**, attached to the node that follows them, via a comment-aware document
  model. An author's `# fiscal year starts in February` must survive a round trip through the app,
  or hand-authors will stop using the formatter and the canonical form dies.

NFR-QUAL-01 says "parse → serialize → parse is a fixed point". That is necessary but not
sufficient, so **T-013 tests two properties** over generated specs:

1. **Idempotence:** `fmt(fmt(x)) == fmt(x)` byte-for-byte.
2. **Semantic preservation:** `parse(fmt(x))` deep-equals `parse(x)`, comments included.

And CI runs `tailwind fmt --check` over `content/`, so non-canonical bytes cannot be merged. That
check is what makes every subsequent diff in the product's history minimal, and it costs one CI
step.

### D4 — Freshness class, present from day one, honest about not working

Every dashboard spec requires a `freshness` block. `class` is one of `batch | standard |
operational`, default `standard`; charts may override downward only. `operational` **validates
against the schema and is rejected by the validator** with a message naming FR-FRESH-04 and
`08-poc-scope.md §7`. That distinction matters: the class is expressible in the format from commit
one, so the cache API can take it (FR-FRESH-02) and no re-cut is needed later, while nobody can ship
a dashboard whose freshness promise we do not keep.

### D5 — Tenancy path separability

`content/tenants/<tenant>/…`, one directory per tenant, no interleaving. A tenant is a path prefix,
so removing one is `git rm -r` plus a registry delete — no history rewrite
(`07-domain-model.md §2`), and promoting a tenant to its own repository is a directory move. The
POC ships exactly one tenant, `internal`. ADR-014 owns everything else about tenancy.

## Consequences

**Enables**
- T-012 (schemas) and T-013 (serializer) can start immediately; they are the first real code in the
  repo and everything else depends on them.
- FR-DEV-03 editor validation is a glob mapping, not a language server.
- Reviewable diffs on day one, which is the precondition for testing the hypothesis at all.
- Constrained AI generation in M2 has a schema to constrain against, with no schema work at M2.

**Costs**
- **We maintain a JSON Schema mirror of an undocumented upstream YAML dialect.** Real recurring
  cost, bounded by the three measures in D2. This is the single most likely thing in this ADR to be
  underestimated.
- Generated types must be regenerated and committed; one more CI check.
- `additionalProperties: false` means a legitimate new Cube feature is blocked until we widen the
  schema. That friction is deliberate.

**Forecloses**
- Any second serializer, in any language. A component that writes specs without going through
  `packages/spec` is a defect, not a shortcut.
- Multi-object files, anchors and YAML aliases — including for genuinely repetitive models, where
  authors will want them. The answer is a generator or a Cube-side abstraction, not an anchor.
- A non-YAML authoring format, already foreclosed by ADR-003 D2.

**Revisit when** — any one:
1. **A content PR takes longer than ~3 minutes of CI, or a non-engineer's PR triggers an application
   build.** That is the trigger to split `content/` into its own repository. Expected at M2 kickoff;
   ADR-010 owns the call, and D1's no-upward-references rule is what keeps it cheap.
2. **A Cube minor release changes YAML we mirror**, and the profile schema needs widening more than
   twice in one quarter. At that frequency, hand-maintaining the mirror loses to generating it from
   Cube's own TypeScript types, however unpleasant that is.
3. **Apache Ossie graduates and Cube ships native OSI import/export** — ADR-003 revisit trigger 4.
   The canonical artifact could become Ossie, and `meta.tailwind` is the seam that makes it cheap.
4. **A reviewer says the diffs are unreadable** in the M2 review instrumentation. That is direct
   evidence against D3 and it outranks any argument here.

## Validation

1. **T-013's two properties**, over `fast-check`-generated specs, in CI. Not a hand-written example
   suite — determinism failures live in the cases nobody thought of.
2. `tailwind fmt --check` is clean on `content/`, and a deliberately un-canonical file fails the
   build.
3. A spec with an unvetted Cube key, a JavaScript model, a missing `meta` block, or
   `freshness.class: operational` is rejected **identically** by the app, the CLI and CI — same
   message, same exit condition (T-115, FR-SEM-11).
4. A comment written by hand survives: read a spec through the API, write it back, and the comment
   and byte layout are unchanged.
5. VS Code offers completion for a `.dash.yml` from a clean clone with no extra setup beyond the
   committed workspace settings.

## Notes

- ADR-003 D2 (the Tailwind profile), D5 (caching), and the Ossie note in its final addendum are the
  direct inputs to this ADR.
- `07-domain-model.md §2` — the git/DB boundary and the tenant-separability requirement.
- Cube's data-model reference is the source for the profile mirror; it is documentation, not a
  schema, which is the reason D2 exists — <https://docs.cube.dev/reference/data-modeling/syntax>
- JSON Schema 2020-12 — <https://json-schema.org/draft/2020-12/release-notes>
