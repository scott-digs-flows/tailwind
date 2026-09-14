# ADR-005 — Front end: React + Vite, Apache ECharts, and a headless render path with no browser

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** Systems Architect (proposer) · Full-Stack · Product (reviewer)
- **Milestone:** M0
- **Requirements:** FR-VIZ-01, FR-VIZ-03, FR-VIZ-04, FR-VIZ-05, FR-VIZ-06, FR-GOV-04, FR-CON-02,
  FR-CON-03, NFR-A11Y-01, NFR-PERF-02
- **Tickets:** T-007 (produces) · constrains T-010, T-031, T-129, T-038 · related T-122 (author-facing
  spec visibility — not this ADR), ADR-013 (CI credential boundary)

## Context

`02-architecture-brief.md §3.6` says the chart library is *"a long-lived decision"* and names four
criteria. One of them is not a criterion, it is a **gate**:

> **Charts must render outside a browser session.** FR-GOV-04 requires CI to render affected
> dashboards and attach screenshots to the PR; FR-VIZ-06 requires PDF export; T-129 makes the headless
> path an explicit deliverable. `08-poc-scope.md §3.5` puts the full CI evidence pipeline on the
> not-deferrable list, because reviewer time is the metric the hypothesis turns on.

That gate eliminates most of the field, and it has a second-order consequence that decides ADR-006:
**every library that passes it renders in Node.** A backend in another language would mean either a
Node render sidecar anyway, or two chart implementations — and two implementations means the
screenshot CI attaches to a PR is not the dashboard the user sees. An evidence pipeline that shows a
reviewer a *different* picture than the consumer gets is worse than no evidence pipeline.

The other three criteria: **FR-VIZ-03** coverage (line, bar grouped/stacked, area, scatter,
pie/donut, table, pivot table, single-value KPI, sparkline, heatmap, combo dual-axis);
**FR-VIZ-04** interactions (cross-filtering between charts, drill-down, drill-through, tooltips,
legend toggling); and **NFR-A11Y-01** WCAG 2.1 AA on the consumption path.

**Constraints.** FR-VIZ-01: dashboards are declarative specs with **no embedded SQL**. §2.2: all
numbers flow through the semantic compiler — the chart layer receives a result set and draws it, and
must not become a place where numbers are computed.

**Open questions.** Q-16 (is WCAG 2.1 AA contractual or aspirational?) is unanswered and is named in
`04-open-questions.md` as something that *"changes the chart library decision"* — see D4 for how this
ADR is built to survive either answer. Q-18 (existing design system?) is unanswered; D1 keeps it
cheap. **T-122 — how much of the spec a non-technical author sees — is explicitly not decided here**;
it shapes the authoring surface, not the rendering stack.

## Options considered

Screened against the gate first. **Plotly.js** (browser-only; static export needs the separate
Kaleido binary), **Chart.js** (canvas-only, needs a native canvas binding and cannot emit SVG),
**Highcharts** and **AG Charts Enterprise** (commercial licences for a commercial BI product — a cost
and a negotiation the POC should not acquire), and **visx / Nivo / Recharts** (React-SVG, so
server-renderable via `react-dom/server`, but each leans on DOM measurement for axes and responsive
sizing, which is exactly the part that breaks headlessly) were all screened out. Two survive.

### Option A — Apache ECharts ✅

Apache-2.0. Canvas or SVG renderer from the same option object. First-party server-side rendering
since **5.3.0**: `echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })` followed by
`chart.renderToSVGString()`. **Verified against ECharts' own handbook** — it is a *zero-dependency*
path: no DOM shim, no jsdom, no native canvas binding.

**Pros.**
- **The SSR path is first-party, documented, and produces the same chart as the browser from the same
  config object.** That is the property the evidence pipeline needs, and it is rarer than it sounds.
- Covers everything in FR-VIZ-03 except tables, pivots and the KPI tile: line, grouped and stacked
  bar, area, scatter, pie/donut, heatmap, sparkline, and dual-axis combo (multiple `yAxis` with
  mixed series types) are all core.
- **Imperative event API** (`chart.on('click' | 'brush' | 'legendselectchanged')`) hands us the data
  point and lets *our* application own filter state. For cross-filtering across a grid of charts,
  where the host must be the single source of truth (and where filter state is also URL state per
  FR-VIZ-05), an imperative event model is the right shape.
- Canvas in the browser for large series, SVG for the server — one config, two renderers, no second
  code path.
- Mature, high release cadence, very large install base including several BI products.

**Cons.**
- The option surface is enormous and loosely typed in practice. Left unmanaged, chart configuration
  sprawls across the codebase. Mitigated by D2, which we want regardless.
- **No keyboard navigation of data points.** It ships `aria` labels and `decal` texture patterns for
  colourblind safety, and generates a text description of the chart, but arrow-key traversal of a
  series is not there. Nothing in this field ships it; see D4.
- **PNG is not zero-dependency.** Either rasterise the SVG (resvg or sharp) or use ECharts' canvas
  renderer with `node-canvas`, which is a native binding. Prefer the rasteriser: it keeps one
  renderer, and SVG stays the primary artifact. One dependency, not a second renderer.

### Option B — Vega-Lite / Vega

BSD-3-Clause. A grammar of graphics: a declarative chart spec compiled by Vega-Lite into a Vega
dataflow, rendered by Vega. `View.toSVG()` works in plain Node with Vega's own SVG renderer — no
jsdom, no canvas.

**Pros.**
- **The cleanest headless story of anything surveyed**, and the one place it is unambiguously better
  than ECharts.
- Enormous chart coverage from a small, composable grammar; faceting and layering give combo and
  small-multiple charts nearly free.
- A declarative spec is philosophically aligned with a product whose whole premise is declarative,
  reviewable artifacts — and it is JSON, so it is diffable.

**Cons — and the first one is decisive.**
- **Vega-Lite has a data-transform language.** `transform`, `aggregate`, `window`, `calculate` and
  `joinaggregate` compute values *in the chart*. Binding constraint §2.2 says every number flows
  through the semantic compiler; §2.1 says the reviewed artifact is the executed artifact. A chart
  grammar that can aggregate is a second, ungoverned computation site sitting directly in the
  artifact — and the temptation to make the Vega-Lite spec *be* our dashboard spec (it is JSON, it is
  declarative, it looks like a free win) is exactly how that would happen. We would have to lint a
  large fraction of the grammar out of existence to keep the governance guarantee, which is a worse
  version of the profile-lint work ADR-003 D2 already committed us to for Cube.
- **Its selection model wants to own interaction state.** Vega-Lite's `params`/selections are designed
  so the spec coordinates its own filtering. Ours must be owned by the host application, because
  filter state is also URL state, cross-chart state and per-user sticky state (FR-VIZ-05). Bridging
  through signals is possible and it is a permanent impedance mismatch.
- Weaker at the mundane BI affordances — a data grid, a pivot, a KPI tile, a dense dashboard of a
  dozen charts kept interactive — and less predictable performance at higher point counts.

## Decision

**React 19 + TypeScript + Vite for the application; Apache ECharts for charts, behind a narrow
in-house adapter; TanStack Table for the table and pivot; and a headless render service that produces
SVG through ECharts' server-side renderer with no browser involved.**

### D1 — Application shell

- **React + TypeScript + Vite**, one SPA. React because the ecosystem the rest of this needs (grids,
  headless primitives, the eventual editor) lives there, and because ADR-006 already made the whole
  stack TypeScript.
- **TanStack Query** for server state, **URL as the source of truth for filter and parameter state.**
  FR-VIZ-05 requires shareable URL-encoded state; making the URL the state rather than a projection of
  it is much cheaper now than later, and it makes cross-filtering debuggable.
- **One bundle, code-split by route.** `02-architecture-brief.md §3.6` asks whether consumption and
  authoring should be separate bundles. They should not be, yet — one build, route-level code
  splitting, and revisit if the authoring routes measurably harm consumption load time. Two bundles
  now would be a build-system decision made before there is any authoring code to weigh.
- **Styling: Tailwind CSS plus headless primitives (Radix), pending Q-18.** If the org already has a
  design system, we adopt it; the chart layer and the spec layer are deliberately independent of that
  choice, so Q-18's answer cannot invalidate anything else in this ADR.
- **Not Next.js.** ADR-006 D2 explains why the API is a separate long-lived service; a second server
  framework in front of it would buy SSR we do not need for an authenticated internal app.

### D2 — Charts go through a narrow adapter, not through ECharts directly

`packages/charts` exposes one function per chart type in FR-VIZ-03, taking **our** chart spec plus a
result set and returning an ECharts option object. Application code never constructs an ECharts option
inline, and `echarts` is imported in exactly one package.

Three things this buys, in order of importance:

1. **The browser and the render service produce the same picture**, because they call the same
   function. This is the entire justification for the CI evidence pipeline being trustworthy.
2. **The dashboard spec stays small and governed.** Chart configuration is a bounded vocabulary that a
   reviewer can hold in their head and a JSON Schema can describe (ADR-004), rather than a passthrough
   of a thousand-key vendor option object. It also keeps FR-VIZ-01's "no embedded SQL" honest by
   leaving no place for computation to hide.
3. **Replacing the chart library later is bounded** — one package, one import site.

Coverage, stated plainly so nobody discovers a gap in M1:

| FR-VIZ-03 type | Rendered by |
|---|---|
| line · bar (grouped/stacked) · area · scatter · pie/donut · heatmap · sparkline · combo dual-axis | ECharts |
| table · pivot table | **TanStack Table** (MIT), headless — we own the markup, which is also what makes it accessible and server-renderable |
| single-value KPI | a React component. It is text, not a chart. |

M0 ships four (line, bar, table, KPI) per T-031. The rest land in M1.

### D3 — The headless render path: no browser, and the dashboard is composed server-side

`apps/render` is a Node service and a CLI entry point. Given a dashboard spec, a bundle version and a
security context, it:

1. executes each chart's semantic query by **importing `packages/semantic`, the same façade module the
   API imports** — same one door, same RLS, same cache (§2.2, FR-SEM-14). It deliberately does *not*
   call the running API, because in CI it must render a bundle that has not been published yet;
   ADR-006 D4 states the boundary as a module rule rather than a process rule for exactly this
   reason;
2. builds each chart's option through `packages/charts` and calls ECharts' SSR renderer to get an
   **SVG string** per chart;
3. **composes those SVGs into the dashboard's declared grid layout itself**, because we own the layout
   spec, and emits one SVG, one PNG (via a rasteriser), or a PDF.

**There is no headless browser in M0–M2.** That is the substantive decision here, and the reason is
`02-architecture-brief.md §3.5`: *"this must be fast enough that Sam's review isn't gated on a
15-minute job."* A Node process rendering eight SVGs is seconds; Playwright plus a real page load is a
minute or more, plus a browser download in CI, plus the font and timing flakiness that makes
screenshot jobs the least-trusted check on any PR. Rendering the grid ourselves is only possible
*because* the dashboard spec is declarative — which is a nice illustration that the product's core
constraint pays for itself somewhere unexpected.

Two consequences to accept explicitly:

- **The composed image is not a pixel-exact capture of the browser.** It is the same charts in the
  same grid. For a metric-diff and layout review that is what is needed; if pixel fidelity is ever
  required, Playwright becomes an *additional* path at M3 and **ADR-013 owns that call**.
- **Fonts must be pinned and bundled.** SVG text metrics depend on the font being present, so the
  render image ships exactly one font family and the browser uses the same one, self-hosted. Skipping
  this produces label wrapping that differs between CI and the browser, which is the sort of bug that
  costs a day and destroys confidence in the screenshots.

### D4 — Accessibility: do the cheap 80% now, and keep Q-16 from being expensive

NFR-A11Y-01 is `Should`, and `08-poc-scope.md §2` defers the formal audit to M3 while keeping
*"colorblind-safe palettes and keyboard basics as hygiene."* Q-16 could still promote AA to
contractual. Three things make that answer cheap either way, and two of them are nearly free:

1. **A data-table fallback for every chart, from M0.** Every chart already has its result set, and
   TanStack Table already renders it as real semantic HTML. This single measure carries most of
   WCAG's substance for data visualisation, and it is a toggle plus a component. It also does
   double duty as FR-CON-02's "how is this calculated?" surface and as CSV export.
2. **A colourblind-safe default palette, plus ECharts `decal` patterns** so series are distinguishable
   without colour. A palette decision costs an afternoon now and is a find-and-replace across every
   dashboard later.
3. **Keyboard traversal of data points, at M1.** No library in this field ships it, so it is ours
   either way. Built into the chart wrapper — focusable chart, arrow keys move a cursor along the
   series, an `aria-live` region announces the point — it is a couple of days. Retrofitted into a
   wrapper that was never focusable, it is a rewrite of the interaction layer. **This is the one
   accessibility item worth pulling forward past the POC filter**, and the reason is structural, not
   compliance.

If Q-16 comes back *contractual*, the remaining work is an audit and remediation, not a library
change. That is the point: this ADR is built so Q-16's answer cannot reopen it.

### D5 — Interactions

Cross-filtering, drill-down and drill-through (FR-VIZ-04) are **application state, not chart state**.
ECharts events emit a data point; a dashboard-level reducer turns it into a filter, writes it to the
URL, and every chart re-queries through the API. Drill-through to row-level detail is a separate
query through the same façade, so it inherits RLS with no special casing — which is what §2.2 and
FR-SEC-04 require, and the reason it must never be a client-side unfiltering of data already fetched.

NFR-PERF-02's 800 ms cached-interaction target is therefore a cache-and-API property, not a rendering
one; the chart re-render is milliseconds.

### D6 — The visual editor is not in this ADR

FR-VIZ-02's WYSIWYG editor is M3 and cut line #1 in `03-roadmap.md`. Two things are settled anyway
and should not be re-litigated when it starts: its state model **is** the spec (`§3.6` — one
representation, not two synced ones), and it writes through ADR-004's canonical serializer like every
other writer. Nothing else about it is decided here, and **T-122** owns the question of what an author
sees.

## Consequences

**Enables**
- FR-GOV-04 screenshots and FR-VIZ-06 PDF from one code path, in seconds, with no browser in CI.
- T-031 and T-129 can proceed in parallel — the renderer is the same adapter the browser uses.
- All of FR-VIZ-03 covered by three components with a combined licence cost of zero.
- A bounded chart vocabulary in the spec, which the AI has to compose against in M2 (FR-AI-03). A
  smaller vocabulary is a materially easier generation target.

**Costs**
- **We own the dashboard layout compositor** in the render path. Real work, and it must track the grid
  layout in the browser or the two diverge. Bounded, because we also own the layout spec.
- **We own keyboard accessibility for charts.** Nobody gives us this.
- One rasteriser dependency for PNG, and one pinned font in the render image.
- The adapter is indirection: adding a chart type means touching `packages/charts` rather than a
  component. That is the intended trade.

**Forecloses**
- **Chart-level data transformation.** No aggregation, no window functions, no computed fields in the
  chart layer, ever. That is §2.2 and it is the main reason Option B lost.
- **Pixel-perfect print/paginated reporting** (already FR-VIZ-12, `Won't`).
- Chart types outside ECharts' repertoire — Sankey, chord, geographic maps are all present, so this is
  a narrow foreclosure; a genuinely novel visualisation would need a second library and would be a
  new decision.
- 3D and WebGL-scale point counts (millions of marks). Not on the roadmap; noted because someone will
  ask.

**Revisit when** — any one:
1. **The composed CI image is judged not to represent the dashboard** by a reviewer in the M2 review
   instrumentation. That is direct evidence against D3, and the answer is Playwright as an additional
   path under ADR-013 — not a chart-library change.
2. **A required FR-VIZ-03 chart type cannot be rendered by the SSR path** even though it works in the
   browser. That would be an ECharts defect and it is the one failure that reopens Option A itself.
3. **Q-16 comes back contractual *and* an audit finds ECharts' rendered output structurally
   unfixable** — e.g. canvas-only output with no accessible equivalent. D4's data-table fallback is
   the designed answer, so this is unlikely; recorded because Q-16 is explicitly named as able to
   change this decision.
4. **Interaction latency (NFR-PERF-02, 800 ms) is missed and profiling implicates chart re-render**
   rather than the query path. Then the answer is incremental updates via `setOption` merge, and only
   if that fails is it a library question.
5. **The authoring bundle measurably degrades consumption load time.** Split the bundles then, per D1.

## Validation

1. **T-129:** a dashboard spec renders to an image in a Node process with no browser installed, and
   the SVG for a given chart is **byte-identical** between the render service and a browser snapshot
   of the same config. Byte-identical is the strong form and it is achievable because both call the
   same adapter with the same font; if it proves unachievable, assert visual equivalence and say so.
2. **T-031:** line, bar, table and KPI render from a declarative spec against live query results on a
   grid layout.
3. **Cross-filter round trip:** clicking a bar writes a filter to the URL, every other chart
   re-queries, and pasting the URL into a fresh session reproduces the state exactly (FR-VIZ-05).
4. **Accessibility hygiene, in CI from M0:** every chart has a data-table equivalent reachable without
   a pointer; an automated axe pass on the dashboard route has no violations outside the chart canvas;
   the default palette passes a colourblind simulation check.
5. **Render performance:** an eight-chart dashboard renders headlessly in under 10 s including
   queries, measured in CI. If the evidence pipeline is slower than that, reviewers will route around
   it, and `08-poc-scope.md §3.5` stops being satisfied in practice even if it is satisfied on paper.

## Notes

- The four criteria and the "evaluate against all four, not just the chart gallery" instruction —
  `02-architecture-brief.md §3.6`; the CI rendering constraints — `§3.5`.
- The evidence pipeline as non-deferrable — `08-poc-scope.md §3.5`.
- ECharts licence (Apache-2.0) and server-side rendering —
  <https://github.com/apache/echarts/blob/master/LICENSE>,
  <https://echarts.apache.org/handbook/en/how-to/cross-platform/server/>
- ECharts accessibility (`aria`, `decal`) — <https://echarts.apache.org/en/option.html#aria>
- Vega-Lite licence and transforms (the reason it loses) — <https://github.com/vega/vega-lite/blob/main/LICENSE>,
  <https://vega.github.io/vega-lite/docs/transform.html>
- TanStack Table (MIT) — <https://github.com/TanStack/table/blob/main/LICENSE>
- ADR-006 — the language decision this gate drives.
- ADR-013 will own the CI credential boundary and any later headless-browser path.
