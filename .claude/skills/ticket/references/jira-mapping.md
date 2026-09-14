# TW field mapping and JIRA mechanics

Everything in this file was read off the live site on 2026-09-14. Re-verify with
`getJiraIssueTypeMetaWithFields` before trusting it after a project-settings change.

## Site facts

| Thing | Value |
|---|---|
| `cloudId` | `1a4eaaaa-9409-4e9a-bbfc-2ffadfbbc3af` |
| Site | `https://scottdigsflows.atlassian.net` |
| Project key | `TW` (id `10001`), name **Tailwind** |
| Project style | **Team-managed** (`simplified: true`) — this is why the mapping below looks the way it does |
| Issue types | Epic `10007` · Story `10008` · Task `10010` · Bug `10009` · Subtask `10006` |
| Link types | Blocks `10000` · Cloners `10001` · Duplicate `10002` · Relates `10003` |

## The gotcha that shapes everything

A team-managed project's Story screen has **no `priority`, no `components`, no `fixVersions`,
no `versions`** field. They are not hidden, they do not exist — `additional_fields: {"priority":
{"name":"High"}}` fails, and `fixVersions` has nothing to point at. So the two axes you would
reach for first, **priority and milestone, are labels.**

Do not "fix" this by enabling priority in project settings without saying so. The encoding below
is what the CI check parses; changing it is a schema migration, not a preference.

## Ticket → JIRA

| `TICKETS.csv` column | JIRA representation |
|---|---|
| `id` (`T-###`) | `legacy_id` in the meta block. **Never lost** — ADRs, commit messages and `docs/adr/*` cite `T-014` and must keep resolving. |
| `title` | `summary`, imperative, one line |
| `epic` (`E-##`) | `parent` → the Epic issue for that `E-##` |
| `milestone` (`M0`–`M4`) | label `M0` … `M4` |
| `priority` (`P0`–`P3`) | label `P0` … `P3` |
| `size` (`S`/`M`/`L`/`XL`) | label `size-S` … `size-XL` |
| `type` | label `type-feature` · `type-spike` · `type-adr` · `type-infra` · `type-discovery` · `type-chore` |
| `owner_role` | label `role-product` · `role-architect` · `role-fullstack` · `role-data-team` · `role-security` |
| `depends_on` | **Blocks** issue links — see direction note below |
| `req_ids` | `req_ids` in the meta block |
| `acceptance` | The `## Acceptance` section of the description |
| `status` | Workflow status — see the status table |

Issue type: `Story` for `feature`, `Task` for `infra`/`chore`/`adr`/`discovery`/`spike`, `Bug` for
defects. The `type-*` label carries the real taxonomy; the issue type is just what JIRA's board
needs to render.

### Link direction

`createIssueLink` is easy to get backwards and a reversed dependency graph is worse than none.

> `T-011 depends_on T-010` means **T-010 blocks T-011**.
> → `type: "Blocks"`, `inwardIssue:` the **blocker** (T-010's key), `outwardIssue:` the **blocked**
> (T-011's key).

Sanity-check one link in the UI after any bulk run: the blocked issue should read *"is blocked
by"* the thing that must happen first.

## The meta block

`req_ids` and `legacy_id` are the traceability spine, and JIRA has nowhere native to put them.
They go in a fenced block at the **end** of the description, which the CI check parses:

````
```tailwind-meta
legacy_id: T-014
req_ids: FR-SEM-01 FR-SEM-02 ADR-003
```
````

Rules: one fenced ` ```tailwind-meta ` block per issue, always last, space-separated IDs, no other
keys unless the check learns them first. `depends_on` deliberately does **not** live here —
dependencies are real JIRA links so the board, JQL and the cycle check all see the same graph.

## Status

`getTransitionsForJiraIssue` against any real TW issue is the authority — a team-managed board
ships `To Do / In Progress / Done` and Scott may have added columns.

| CSV status | JIRA |
|---|---|
| `todo` | To Do |
| `in-progress` | In Progress |
| `review` | In Review if that column exists, else In Progress + label `review` |
| `done` | Done |
| `blocked` | Keep the current status and set `customfield_10021` (Flagged) to `Impediment` |

`blocked` as a flag rather than a status is deliberate: a blocked ticket keeps its real position on
the board, and "what is flagged" is one JQL away. Mirrors rule 3 in `05-ways-of-working.md` — you
surface the block, you do not park the ticket somewhere nobody looks.

## Other fields worth knowing

`customfield_10016` Story point estimate · `customfield_10020` Sprint · `customfield_10021` Flagged
· `customfield_10015` Start date · `customfield_10019` Rank.

Story points are **optional and not authoritative**. `size` is a label because `XL` is a flag
meaning "not understood well enough to start", not an estimate — putting it in a numeric field
loses exactly the thing it is there to say.

## Writing descriptions

Pass `contentFormat: "markdown"`. ADF is only worth the trouble for tables and panels; prose,
headings, lists and fenced code all survive markdown, and markdown diffs legibly when you have to
regenerate an issue.

## JQL recipes

```
project = TW AND labels = M0 AND statusCategory != Done ORDER BY labels ASC
project = TW AND labels IN (P0, P1) AND status = "To Do"
project = TW AND "Flagged[Checkboxes]" = Impediment
project = TW AND issueFunction … -- not available; do dependency reasoning client-side
project = TW AND parent = TW-3
project = TW AND text ~ "FR-SEM-02"
```

JIRA has no transitive-dependency or cycle query. That is the whole reason the check below exists.

## The migration, when it runs

`05-ways-of-working.md` is explicit that this is not "export the CSV", and that the expensive part
is not the issues:

1. **Create the 12 epics first** (`E-00`…`E-11` from `05-ways-of-working.md`), record their keys.
2. **Create issues in two passes.** Pass one creates every issue and builds the `T-###` → `TW-###`
   map. Pass two adds the Blocks links, because a link needs both ends to exist. Persist the map to
   a file as you go — a half-finished migration you cannot resume is a migration you run twice.
3. **Port the checks** — `scripts/validate_jira.py`, same fourteen invariants, reading the API.
   This is the actual cost and the part that must not be skipped.
4. **Retire `TICKETS.csv` in the same PR that lands the check.** Never run both as sources of
   truth. Until that PR merges, the CSV is still authoritative and JIRA is a rehearsal.
5. Keep `docs/product/*` untouched as the requirements contract. Issues cite requirement IDs;
   requirements never move.
