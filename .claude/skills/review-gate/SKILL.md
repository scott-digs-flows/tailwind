---
name: review-gate
description: Tailwind's product-specific review checklist - the seven binding constraints, the corollaries, and the repo traps a generic code review cannot know about. Use when reviewing a diff, a PR or a branch in this repo, alongside /code-review rather than instead of it; and use it on your own work before opening a PR. Also use when deciding whether a proposed design is even available under the constraints.
---

# The Tailwind review gate

`/code-review` finds correctness bugs and cleanups, and it is good at that. It cannot know that
this codebase has seven rules where a violation is not a bug you fix later — it is a product that
no longer does the thing it exists to do. **Run both.** This one first, because a diff that breaks
a constraint does not need its variable names reviewed.

Every item below is a question with a wrong answer, not a reminder to be thoughtful.

## The seven

Source: `docs/product/02-architecture-brief.md §2`. These are Product decisions. If one blocks a
good design, **say so and argue it** — that is a valuable contribution. Silently routing around one
is not, and is the single most damaging thing a reviewer can wave through.

1. **Git is the source of truth for artifacts.** Does this change make any reviewable artifact —
   model, metric, dashboard, policy — reach production by a path other than a merged commit? History
   and review are the mechanism, not a mirror of it.

2. **All numbers flow through the semantic compiler. One door.** Does any path in this diff emit
   SQL that does not go through the compiler? Check the unglamorous ones specifically, because they
   are where it leaks: CSV export, drill-through, scheduled delivery, the AI surface, a "quick"
   admin endpoint, a test helper that later gets reused in app code.

3. **AI writes proposals, never shared state.** Is the only durable output of any AI path a
   validated diff? An AI path that writes to the operational database, mutates a spec in place, or
   returns a number it computed itself has broken the governance story, whatever the UI says.

4. **RLS is enforced server-side during query construction, per request.** Is the row predicate
   resolved from the *requesting user's* identity — not the author's, not the tenant's? FR-SEM-15
   and T-117 exist because per-tenant resolution passes every obvious test and is still wrong.
   "Compile time" in the older docs means this; see `§2.4`.

5. **Spec serialization is deterministic and lossless.** Does a round-trip through the serializer
   reproduce the bytes? Key order, float formatting, unicode normalization, trailing newline, map
   ordering. Noisy diffs make the review gate theater, and this is the constraint that degrades
   quietly — nothing fails, the diffs just get worse until nobody reads them.

6. **The serving tier is stateless.** Does this introduce in-process state that two replicas would
   disagree about? Caches keyed without the security context are the dangerous case: that is not a
   scaling bug, it is cross-tenant data leakage.

7. **Authors need no git account.** Does this path require the user to have one? The app brokers
   PRs through the GitHub App.

## Two corollaries that get violated more often than the seven

- **Nothing in the operational database may change a number.** Git holds what humans review; the DB
  holds runtime and personal state. A security context may *restrict* rows and *mask* columns — it
  may never *redefine* a metric. When you see a DB read inside a calculation path, that is the
  question to ask. (`07-domain-model.md §2`)

- **The hand-written path is never second-class.** Can an analytics engineer do this entirely
  through the CLI and files, with no AI involved? A feature that only works from the assistant has
  shipped half of itself.

## Repo traps

Real, specific, and each one has already cost someone time.

- **`pnpm` 11 `allowBuilds`.** The allowlist is an **`allowBuilds` map** in `pnpm-workspace.yaml`.
  The `onlyBuiltDependencies` / `neverBuiltDependencies` *lists* that most documentation shows are
  **pnpm 10 syntax, parse cleanly, read back from `pnpm config get`, and do nothing.** A diff that
  adds one has added a no-op that looks like a fix. Never `dangerouslyAllowAllBuilds`.

- **Cube compiles the model once at startup** (`CUBEJS_DEV_MODE=false`). Anything under `content/`
  needs `./scripts/publish.sh`. A change that appears not to work is usually this. Deliberate, not
  a limitation — artifacts publish on merge; ADR-007 / T-029 replaces the restart with an immutable
  per-merge bundle.

- **Versions come from one place.** `infra/versions.env`, read by both CI and compose. A version
  pinned in a Dockerfile or workflow instead has created drift that only shows up on the VM.

- **`/readyz` is not readiness.** T-118: Cube's readiness endpoint passes while the model is
  unusable. Readiness is established with a real query.

- **The tenancy guard checks the connecting role's privileges, not just table policies.** ADR-014's
  backstop once shipped complete and inert because the app connected as a superuser, and
  superusers bypass RLS entirely. Any change to connection or migration code re-opens this.

- **A conformance suite that passes with the mechanism disabled is testing nothing.** The negative
  control runs too (T-136, T-137). If a diff touches the suite, check the negative control still
  fails.

- **Canonical formatting is a merge gate.** `cli fmt --check content` — non-canonical bytes cannot
  merge, which is what keeps every later diff in the product's history minimal.

## Severity, honestly

Separate *this breaks a binding constraint or a number* from *this is a nice improvement*. Padding
the first category to look rigorous wastes the reader's time as much as missing something does, and
it trains people to skim the gate — which is how the gate stops working.

End with a position: merge, merge with specific changes, or do not merge. If only one thing could
change, say which.
