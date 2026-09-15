---
name: implement-ticket
description: Take a Tailwind ticket from ready to reviewable - read its requirements and governing ADR, build it, test it at the right level, run every gate CI runs, open the PR and move the JIRA issue. Use when picking up a TW ticket, when the user says "implement TW-42" or "build this", and before opening any PR in this repo so the Definition of Done is actually met rather than approximated.
---

# Implementing a ticket

## Before writing code

**Check it is actually ready.** Definition of Ready: acceptance criteria unambiguous, every blocker
`Done`, any governing ADR written, `size-L` or smaller. A `size-XL` ticket is a flag that it is not
understood well enough to start — split it with the `ticket` skill first, do not start it carefully.

If a blocker is open, do not start. Flag the issue as an impediment and say what is missing. Starting
anyway is how a dependency inversion becomes a mid-sprint surprise.

**Read, in this order:**

1. The issue — its `req_ids` meta block is the point of the ticket, not decoration.
2. Each requirement in `docs/product/01-requirements.md`, filtered by `08-poc-scope.md §3` if this
   is M0–M2. The POC filter **wins where they conflict**, and its §3 lists the seven things that
   stay despite looking like GA work because retrofitting them is a rewrite.
3. The governing ADR in `docs/adr/`. Its *Consequences* section names what the decision forecloses —
   that is usually where the implementation constraint actually is.
4. The neighbouring code. Match its idiom, comment density and naming. This repo comments *why*,
   often at length, and a diff of bare mechanics will read as foreign.

**If the requirement and the ticket disagree, stop.** Update the requirement doc first, then the
ticket, then build. Scope drifting from the docs is how the architect designs one thing while the
engineer builds another.

## Claim the ticket before the first commit

The board must say what is actually happening. Before you branch, do both of these — the
mechanics (sprint field, transition ids, the JQL that finds the active sprint) are in the `ticket`
skill's mapping file, and the `ticket` skill itself is the authority if the two disagree:

1. **Put it in the active sprint** if it is not there already. Read the sprint off the issue's
   `customfield_10020`; if the active sprint is missing, set that field to the active sprint's id.
   If there is **no active sprint**, stop and say so — you cannot start one from here, and a
   ticket worked outside any sprint is invisible to the burndown.
2. **Transition it to `In Progress`** (transition `21`). Never leave a ticket at `To Do` while a
   branch for it exists; that is the most common way the board stops describing reality.

If the ticket is already in the sprint and already `In Progress`, do nothing — both are idempotent
and re-writing them only adds noise to the issue history.

Do **not** claim a ticket that has an open blocker. The ready check above already stopped you; if
it did not, flag the issue as an impediment instead of starting.

## Building

Branch from `main`. Small, coherent commits.

**Where things go** — `apps/api` Fastify, `apps/web` React+Vite, `apps/render` headless ECharts,
`packages/spec` schemas + canonical serializer, `packages/semantic` the Cube façade,
`packages/charts` the chart adapter, `packages/cli` the authoring CLI, `content/` reviewed
artifacts. `packages/spec` is shared — a change there lands in the API, the CLI and CI at once, so
treat its surface as an interface, not an implementation detail.

**Tests at the level the thing actually fails at:**

| What you changed | Test |
|---|---|
| Compiler / serializer / spec logic | Unit. Round-trip the serializer on anything touching bytes. |
| Anything reaching the warehouse | Integration against the CI ClickHouse fixture — not a mock. A mocked dialect proves nothing about a dialect. |
| The promotion loop | e2e. |
| A dialect behaviour | The conformance suite, **and check the negative control still fails.** A suite that passes with the mechanism disabled is testing nothing. |

Anything user-facing needs observability in place before it is done — that is in the Definition of
Done, not a follow-up.

## The gates, before the PR

Run what CI runs, in this order. Fixing these locally costs minutes; finding them in CI costs a
round trip, and finding them after merge costs the review gate's credibility.

```bash
pnpm install --frozen-lockfile
pnpm -r --if-present typecheck
pnpm -r --if-present build
pnpm -r --if-present test
node packages/cli/src/main.ts validate content     # FR-SEM-11: same validator app + CLI use
node packages/cli/src/main.ts fmt --check content  # ADR-004 D3: non-canonical bytes cannot merge
docker compose --env-file infra/versions.env -f infra/docker-compose.yml config --quiet
```

If you touched dialect or model behaviour, also `./scripts/conformance.sh` against the CI stack.

The backlog check is **not** in this list, because it is not in CI: `pnpm validate:backlog` reads
JIRA and is run deliberately. Run it if your change touched a ticket or `01-requirements.md` — a new
Must with no ticket is what it catches, and nothing else will.

If you edited anything under `content/`, remember Cube compiles the model **once at startup** —
run `./scripts/publish.sh` or the change will appear not to work and you will debug the wrong
thing for twenty minutes.

Never add a dependency build script by editing `onlyBuiltDependencies`; that is pnpm 10 syntax and
is **silently ignored** here. Use `pnpm approve-builds <pkg>`, which edits the `allowBuilds` map.

## Self-review, then the PR

Run the `review-gate` skill on your own diff before opening the PR. It is the cheapest place to
catch a binding-constraint violation, and the most expensive place to miss one.

The PR body says **what changed and why**, cites the JIRA key and the requirement IDs, and names
what you did *not* do and why. Reviewers route by `CODEOWNERS`: anything under
`content/tenants/*/semantic/**` goes to the data team, because that is where a definition can
change a number.

Then transition the issue to **`Code Review`** (transition `2`) and put the PR URL in a comment.
An open PR is `Code Review`, not `In Progress` and not `Done`: `In Progress` says nobody can
review yet, `Done` claims a Definition of Done that has not been met. If you are handing back
without a PR — blocked, or scaled down — leave the status where it is and say so in the comment.

## Done

Per `05-ways-of-working.md`: merged behind review, tests at the appropriate level, observability in
place for anything user-facing, docs updated if behavior changed, deployed to staging and
demonstrated. Move the issue to Done only when that is all true — not when the code is written.

If part of the ticket turned out to be blocked or wrong, finish everything else in full and say
plainly what you left and why. Scaling a ticket down is Product's call, not yours.
