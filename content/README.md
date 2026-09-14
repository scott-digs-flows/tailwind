# Authoring guide — the hand-written path

Everything under `content/` is a **reviewed artifact**. Git is the source of truth (binding
constraint 1), so a change here is a pull request, and the gates below are what a reviewer trusts
instead of reading every line.

This is the path an analytics engineer takes with no AI involved. `00-vision.md` calls it
non-negotiable and first-class: *"if Sam's CLI workflow degrades to make the AI look better, we've
lost the team that guarantees correctness."*

---

## Where things live

```
content/tenants/<tenant>/
  semantic/
    cubes/<name>.cube.yml          a table, its measures and dimensions   PRIVATE
    views/<name>.view.yml          the certified surface dashboards see   PUBLIC
    calendars/<name>.calendar.yml  custom granularities and fiscal years
  dashboards/<name>.dashboard.yml  layout + charts
  tests/<name>.assert.yml          golden-value assertions
  connections/<env>.conn.yml       dialect and host; secret REFERENCES only, never secrets
```

**One object per file, and the filename is the object's name.** `revenue.view.yml` declares a view
called `revenue`. That is what keeps diffs small, makes CODEOWNERS routing precise, and lets two
authors edit two dashboards without touching the same file.

**The extension carries the type**, so the right JSON Schema attaches by glob — the CLI never has
to guess, and neither does your editor.

---

## The loop

```bash
# 1  write or edit files under content/
# 2  check them — schema + profile lint, the same gate CI runs
node packages/cli/src/main.ts validate content

# 3  normalise to canonical bytes (reorders keys, quotes ambiguous scalars)
node packages/cli/src/main.ts fmt content

# 4  publish — Cube compiles the model ONCE at startup
./scripts/publish.sh

# 5  look at it
open http://localhost:7080
```

Step 4 is not a workaround. `CUBEJS_DEV_MODE=false` is deliberate: artifacts are published on
merge, not hot-reloaded. ADR-007 / T-029 replaces the restart with an immutable per-merge bundle.

**Before opening a PR**, run the conformance suite too. It catches the class of change that
validates cleanly and still returns wrong numbers:

```bash
./scripts/conformance.sh      # 23 cases + the negative control
```

---

## Adding a dimension to an existing star — worked example

Say `raw.dim_reseller` should be queryable alongside reseller sales.

**1 — the cube.** Private, because dashboards see views only.

```yaml
cubes:
  - name: dim_reseller
    sql_table: raw.dim_reseller
    public: false
    meta:
      tailwind:
        spec_version: 1
        owner: data-team
        description: AdventureWorks reseller dimension. One row per reseller.
        certification: certified
    measures:
      - name: reseller_count        # globally unique across the whole bundle
        type: count
        meta:
          tailwind: { spec_version: 1, owner: data-team, description: Number of resellers., certification: certified }
    dimensions:
      - name: reseller_key
        sql: reseller_key
        type: number
        primary_key: true           # required on anything joined, or fan-out cannot be detected
        meta:
          tailwind: { spec_version: 1, owner: data-team, description: Reseller surrogate key., certification: certified }
```

**2 — the join, declared on the MANY side.** Many sales lines per reseller, so it goes on the fact:

```yaml
    joins:
      - name: dim_reseller
        relationship: many_to_one
        sql: '{CUBE}.reseller_key = {dim_reseller}.reseller_key'
```

**3 — expose it through the view.** Nothing is visible to a dashboard until it is included here:

```yaml
      - join_path: fact_reseller_sales.dim_reseller
        includes:
          - reseller_count
          - reseller_name
          - business_type
```

**4 — use it in a dashboard.** Members are always `view.member`:

```yaml
  - id: by_business_type
    title: Reseller sales by business type
    type: bar
    layout: { x: 0, y: 12, w: 6, h: 5 }
    query:
      view: sales
      metrics: [sales.reseller_sales]
      dimensions: [sales.business_type]
```

---

## Five rules that will bite you

**1. `meta.tailwind` is required on the cube AND every measure AND every dimension.**
`spec_version`, `owner`, `description`, `certification`. Verbose on purpose (FR-SEM-06) — and those
descriptions are what the AI grounds on later, so a lazy one costs you twice.

**2. `spec_version` lives inside `meta.tailwind` on cubes and views — never at the top level.**
Cube whitelists top-level keys and rejects anything else outright. Dashboards are Tailwind-native,
Cube never parses them, so *they* keep it top-level. The inconsistency is real; see ADR-004's
amendment for why byte-for-byte execution made it the lesser evil.

**3. Metric names are globally unique across the entire bundle.** Two `revenue`s that disagree is
the failure this product exists to prevent (FR-SEM-02), so the lint names both files and fails.

**4. Declare joins from the MANY side.** `fact → dim` is `many_to_one`. Reverse it and Cube's
fan-out detector **silently does not fire** — queries still run and quietly return inflated numbers.
That is what T-097's negative control exists to catch, and it is why `primary_key: true` is
mandatory on anything joined.

**5. Views need an `access_policy`, and it needs `member_level`.** Cube's own default is that all
rows are public, so default-deny is ours to enforce. Matching a policy does not by itself grant
member visibility — omit `member_level` and you get *"You requested hidden member"*.

---

## What the gates check

| Command | Catches | Misses |
|---|---|---|
| `validate` | Shape and policy: unknown keys, Jinja, missing metadata, non-view metric refs, duplicate metrics, Cloud-gated keys, executable model files | Whether the numbers are right |
| `fmt --check` | Non-canonical bytes | Anything semantic |
| `./scripts/conformance.sh` | **Wrong numbers** — fan-out, chasm traps, grain rollups | Anything not modelled as a case |
| `./scripts/publish.sh` | Whether Cube actually accepts the model | Everything above |

A spec can be well-formed, correctly owned, properly certified — and still report revenue 31× too
high. `validate` will pass it. Only conformance won't.

---

## When it goes wrong

| Message | What it means |
|---|---|
| `unknown key 'x' — not permitted by the Tailwind profile` | A Cube key we haven't vetted. Deliberate: an unreviewed key can't reach a reviewed artifact by accident. |
| `Unexpected YAML key: spec_version` | Top-level `spec_version` on a cube or view. Move it into `meta.tailwind`. |
| `metric 'x' is also defined in …` | Rule 3. Both sites are named; either can be the one that moves. |
| `Can't find join path to join 'a','b'` | No path between two cubes, or two facts sharing a dimension where one lacks a direct join. Sometimes correct — "product cost by territory" has no single right answer, so Cube refuses rather than inventing one. |
| `You requested hidden member: 'x'` | `member_level` missing from the policy, or the caller's groups match no policy at all. Default-deny working. |
| `Cube Store was specified as queue/cache driver` | `CUBEJS_CACHE_AND_QUEUE_DRIVER=memory` got dropped. Note it fails at **query** time, not startup — `/readyz` stays green. |
| Charts break right after `publish.sh` | Cube recompiles on restart. `publish.sh` waits for a real query, not `/readyz`, so if it says `published.` the model is genuinely serving. |

---

## Related

- Spec format and layout — [ADR-004](../docs/adr/ADR-004-spec-format-and-repository-layout.md)
- The Cube profile and why it's a lint rather than a fork — [ADR-003](../docs/adr/ADR-003-semantic-engine-selection.md) D2
- Warehouse and dialect tier — [ADR-002](../docs/adr/ADR-002-warehouse-of-record-and-dialect-tiers.md)
- Why the conformance suite has a negative control — [06-dialect-strategy.md §5, §12](../docs/product/06-dialect-strategy.md)
