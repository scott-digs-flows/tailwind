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
| Statuses | To Do (transition `11`) · In Progress (`21`) · **Code Review (`2`)** · **Quality Review (`3`)** · Done (`31`). Transition ids are global. Code Review and Quality Review are both in JIRA's *In Progress* category, so anything asking "has this started?" counts them as started. |
| Epic keys | E-00 `TW-1` · E-01 `TW-3` · E-02 `TW-4` · E-03 `TW-5` · E-04 `TW-6` · E-05 `TW-7` · E-06 `TW-8` · E-07 `TW-9` · E-08 `TW-10` · E-09 `TW-11` · E-10 `TW-12` · E-11 `TW-13` |

## Gotchas, all four confirmed against the live site

**1. The create-meta lies about `priority`.** `getJiraIssueTypeMetaWithFields` for Story does not
list `priority`, `components`, `fixVersions` or `versions`. But `priority` **is real and is
settable** — it defaults to Medium and accepts `additional_fields: {"priority": {"name":
"Highest"}}`. It was verified by writing to it, not by reading the metadata. `components`,
`fixVersions` and `versions` genuinely do not exist, so **milestone stays a label**.

**2. Markdown task-list syntax is silently swallowed.** `- [ ] criterion` renders as
`<li>criterion</li>` — the checkbox is gone, with no error and no warning. **Use plain `-`
bullets** for acceptance criteria. (Anything needing real checkboxes has to be written as ADF.)

**3. `&` in a summary is HTML-escaped** and stored literally as `&amp;`. Use "and", or check the
value that comes back.

**4. Statuses were added on 2026-09-15.** The board originally had only To Do / In Progress /
Done, which meant a ticket with an open PR had to sit in In Progress — every implementer hit it,
and two transitioned to Done before catching that Done falsely claims the Definition of Done.
Code Review and Quality Review now exist. Do **not** use a `review` label; that was the
workaround for their absence.

## Ticket → JIRA

| `TICKETS.csv` column | JIRA representation |
|---|---|
| `id` (`T-###`) | `legacy_id` in the meta block. **Never lost** — ADRs, commit messages and `docs/adr/*` cite `T-014` and must keep resolving. |
| `title` | `summary`, imperative, one line |
| `epic` (`E-##`) | `parent` → the Epic issue for that `E-##` |
| `milestone` (`M0`–`M4`) | label `M0` … `M4` (no `fixVersions` field exists) |
| `priority` (`P0`–`P3`) | **native `priority` field**: P0→Highest, P1→High, P2→Medium, P3→Low |
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
They go in a fenced block at the **end** of the description, which `scripts/validate_jira.py`
parses — it reads code blocks only, so a `req_ids:` written in prose cannot shadow the real one:

````
```tailwind-meta
legacy_id: T-014
req_ids: FR-SEM-01 FR-SEM-02 ADR-003
```
````

Rules: one fenced ` ```tailwind-meta ` block per issue, always last, space-separated IDs, no other
keys unless the check learns them first.

`req_ids` holds **requirement and ADR identifiers only** — `FR-…`, `NFR-…`, `ADR-…`, `Q-…`. It
never holds a ticket key. `legacy_id` is this issue's own former `T-###`, which is identity, not a
relationship.

**No relationship between two tickets is ever written as text.** `depends_on` deliberately does not
live here: dependencies are real **Blocks** links, so the board, JQL and the cycle check all read
the same graph. Epic membership is `parent`. Everything else is **Relates**. A ticket key typed into
a description is invisible to all three and goes stale the moment anything is split.

## Status

`getTransitionsForJiraIssue` against any real TW issue is the authority — a team-managed board
ships `To Do / In Progress / Done` and Scott may have added columns.

| CSV status | JIRA |
|---|---|
| `todo` | To Do |
| `in-progress` | In Progress |
| `review` | **Code Review** while a PR is open; **Quality Review** for verification after review |
| `done` | Done |
| `blocked` | Keep the current status and set `customfield_10021` (Flagged) to `Impediment` |

`blocked` as a flag rather than a status is deliberate: a blocked ticket keeps its real position on
the board, and "what is flagged" is one JQL away. Mirrors rule 3 in `05-ways-of-working.md` — you
surface the block, you do not park the ticket somewhere nobody looks.

## Other fields worth knowing

`customfield_10016` Story point estimate · `customfield_10020` Sprint · `customfield_10021` Flagged
· `customfield_10015` Start date · `customfield_10019` Rank.

Native `priority` is authoritative for P0–P3; do **not** also carry a `P0` label, or the two will
disagree and nobody will know which to believe. The project's own vocabulary still applies —
"Highest" means *P0: blocks the milestone*.

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
