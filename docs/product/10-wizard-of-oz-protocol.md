# Tailwind — Wizard-of-Oz Hypothesis Test (T-120)

**Status:** v2 — revised after independent product review, 2026-08-10
**Owner:** Product · **Effort:** see §11, it is not one day

---

## 1. What this decides, and what it cannot

> **A business user, assisted by AI, can produce an analytics artifact that a data engineer is
> willing to merge — and reviewing it is faster than building it from scratch.**

Nine tasks. **This is a diagnostic, not a verdict.** At n=9 the statistics cannot separate "at
target" from "at the kill line" — see §9 for the actual operating characteristics. Its job is to
find *specific, nameable problems* early and cheaply, and to produce the raw material the
interaction prototype (T-121) should be designed around. The decision remains M2's.

**The headline number is not merge rate. It is `merged AND correct`** — see §7.

## 2. Pre-registration (do this before task one)

One page, written and circulated **before** any task is selected or run. This is the difference
between evidence and anecdote for a nine-observation study run by interested parties, and it costs
an hour.

It must state: the merge denominator (§7), the outcome definitions with worked edge cases, who
adjudicates outcomes (§3), the correctness-audit procedure (§7), the planted-error specification
(§8), what counts as a completed run, and **a written prediction of the merge rate.**

Also confirm here, with a named person: **the pilot subject area contains no regulated, customer,
or PII data.** That is the standing condition on the Q-05 deferral (`08-poc-scope.md §2`), and this
protocol puts real data in front of a model provider.

## 3. Cast — five roles, not three

| Role | Who | Notes |
|---|---|---|
| **Author** ×3 | Real business users | Must be the **original requester** of their tasks (§5). Chosen from the T-092 cohort by the reviewer or Product — **not** by the operator. |
| **Wizard** | **Claude.** Not a person. | See §4. |
| **Operator** | Facilitator | Drives Claude, enforces the time-box, records. Does *not* solve problems. |
| **Reviewer** ×1–2 | Real analytics engineers | Commit to a turnaround before the run (§11). |
| **Auditor** | An analytics engineer who is **not** the reviewer | Runs the correctness audit (§7) and adjudicates outcomes from the PR record alone. |

> **Hard constraint (Q-04, 2026-08-10): neither the reviewer nor the auditor may be one of the
> engineers building Tailwind.** Some data-team engineers split time onto this project, which makes
> them invested in the result — and the most likely damaging outcome of this study is a middling
> result narrated into a pass. With ~20 data-team members, staffing around this costs nothing.
> Record in the pre-registration who is building and who is judging, and confirm they do not
> overlap.

The auditor role is not optional. The load-bearing distinction in §7 — author revision versus
reviewer edits — currently turns on whether a reviewer typed a comment or pushed a commit, and it
must not be coded by the person who ran the sessions.

## 4. The wizard is Claude, and this matters more than anything else in the document

**v1 of this protocol was ambiguous** — it listed Claude in the setup and then described a human
"playing the AI." Those produce different studies.

An analytics-literate human constrained to the semantic layer is a **ceiling estimate**. They will
out-resolve an LLM on ambiguity, on fiscal-versus-calendar, on which of two similar measures was
meant. A green from that run means *"if the AI were as good as an expert human, then…"* — a
conditional nobody remembers three months later.

**So: Claude is the wizard.** The operator types and enforces the box; they do not think for it.
**Record the full prompt and context supplied per task.** This makes the information constraint
(§6 R1) mechanically checkable rather than an honour system, and converts a conditional result into
a real one.

## 5. Tasks

Nine, from the data team's **real backlog** of ad-hoc requests. Not invented scenarios — real ones
carry real ambiguity, which is most of the difficulty.

**Hard constraint:** the author must be the **original requester**. If they are role-playing
someone else's ask, the ambiguity is gone and "did you get what you asked for?" is unanswerable.
A task with no available original requester is dropped, not reassigned.

Spread: three easy, three moderate, two hard, one that **ought to be refused** — something the
semantic layer legitimately cannot answer.

**Known selection bias, stated so it isn't argued about later:** requests reach a backlog precisely
because the business user *couldn't* self-serve and the data team judged them worth queuing. The
hard tail is disproportionately ambiguous. With 3 hard/unanswerable of 9, the realistic ceiling is
capped near 6/9 by construction. Do not read a mid result as failure without accounting for this.

## 6. Rules that keep it honest

**R1 — The wizard sees only the semantic layer, its descriptions, existing dashboards, and the
author's words.** No raw tables, no asking the data team.

When the semantic layer doesn't carry something, there are **two cases**, and v1 wrongly collapsed
them:

- **Cannot be expressed at all** → stop. Record as `blocked-by-semantic-layer`. Out of the merge
  denominator, reported separately. This is the most common production failure class and deserves
  its own number.
- **Can be expressed by proposing a new metric** → **do it.** This is the product's designed path
  (`00-vision.md §2`: *"compose metrics a human already certified, **or open a PR proposing a new
  one**"*). Flag it `new-metric` per FR-AI-07 and record `pr_class`. It is simultaneously Morgan's
  highest-value PR class and Sam's highest-risk one, and v1's rule forbade exercising it.

**R2 — The author is not coached.** Ambiguity gets a clarifying question or a visibly surfaced
assumption. Never a quiet "we know what they meant."

**R3 — Ten minutes per wizard turn, hard.** Blowing it is a recorded outcome, not a reason to
continue. §9 acts on this.

**R4 — Merge decisions are real,** into a repo that serves pilot dashboards. Ask explicitly: *would
you merge this into production?* **Subject to the revert protocol in §8.**

**R5 — Freeze the semantic model before the tasks are chosen.** Tag the commit, record the tag,
and have it built by **someone other than the operator**. Otherwise coverage gets fitted to the
test set and the study measures nothing. This is the largest false-green mechanism in the design.

**R6 — Spec visibility is probed within-task, not between.** For every task: show the chart, ask
the comprehension question, *then* show the spec, ask again. Nine paired observations instead of
four-versus-five unpaired, and it answers the more useful question — does the spec *add*
understanding? This gates T-122, which now feeds ADR-005 and the visual editor rather than the file
format (ADR-004 was decoupled 2026-08-10) — it still gates an architecture decision and deserves the
better design.

## 7. Measurement

### The headline: merged AND correct

**Every merged artifact gets an independent correctness audit** by the auditor (§3), after the run,
against the original request. This is the most important change from v1.

Reason: a semantic model fitted to the tasks, a generous colleague reviewer, and an over-capable
wizard all inflate merge rate. **None of them can inflate "merged and correct."** It is the only
number a false green cannot survive, and it directly measures the failure mode the whole product
exists to prevent — *a confident chart with a wrong number* (`00-vision.md §2`).

### The denominator, defined

**Merge rate denominator = tasks that produced a PR.** These are reported separately and never
silently folded in:

| Category | Counts toward merge rate? |
|---|---|
| `merged-as-is` | ✅ numerator |
| `merged-after-author-revision` | ✅ numerator |
| `merged-after-reviewer-edits` | ❌ in denominator, **not** numerator — if the reviewer fixes it, reviewing wasn't faster than building |
| `rejected` | ❌ in denominator |
| `not-proposed` | Excluded. Reported separately with reason. |
| `blocked-by-semantic-layer` | Excluded. Reported separately — this is a first-class finding. |
| `correctly-refused` | Excluded. **Correct behaviour, not failure.** (WOZ-09) |

v1 left these undefined, which meant the person who wanted a green would have decided the
denominator afterwards.

### The second clause needs a counterfactual arm

The hypothesis says reviewing is faster than **building**. `00-vision.md §7`'s kill criterion is
explicitly *"the time Sam would have spent building it himself."*

Historical data-team turnaround is **not that** — it is wall-clock latency dominated by queue time.
A three-week turnaround on forty minutes of work is normal, and comparing 7 reviewer-minutes
against it produces a flattering, meaningless ratio.

**Fix:** on **three** of the nine tasks, the reviewer builds the artifact themselves from the same
written request, timed, blind to the wizard's version. A couple of hours, and it is the only honest
comparator. Record `builder_minutes`.

### Reviewer time: recorded, not gated

There is **no CI evidence pipeline in this test** — no screenshots, no metric diff, no cost
estimate. `08-poc-scope.md §3.5` says a review without it "measures the wrong thing," and the
≤10 min target in `00-vision.md §8` assumes it exists.

So: **record reviewer time as a baseline to beat, do not gate on it.** State plainly what evidence
the reviewer received. If the operator hand-produces evidence artifacts, that is real unnamed work
*and* it hand-makes the very thing whose value is being measured — decide deliberately and write it
down.

Use **start/stop timestamps**, not recalled minutes. Recall is biased low and it is a headline
number.

### Also record

Author time to a proposable draft · iteration turns · time-box blowouts · reviewer wall-clock and
active time · what the reviewer looked at **first** · what they wanted but couldn't check ·
comprehension before and after seeing the spec (R6) · `pr_class` · `run_order`.

## 8. The planted error — a secondary probe, with a revert plan

v1 called this "the single most informative thing in the protocol." **It isn't, and that claim is
withdrawn.** It is one binary observation whose result is chosen by whoever picks the error: a 0.3%
filter slip is uncatchable and guarantees red; a doubled revenue is obvious and guarantees green.
The correctness audit (§7) supersedes it — roughly six observations instead of one.

Keep it as a secondary probe, but **pre-register the error class** (§2), and plant the *right* kind.
A wrong metric *definition* is what FR-GOV-05's metric diff is designed to catch. The residual
failure mode the design does **not** prevent is a correctly-computed certified metric composed into
a misleading answer — right numbers, wrong grain, wrong filter, wrong population. Plant that.

**Revert protocol — mandatory, with a named owner:**
1. If the planted error merges, **revert within one hour** of the merge decision.
2. Disclose to the reviewer the same day.
3. Disclose to anyone who saw the dashboard.
4. Record it. A knowingly-false number in front of real users is not acceptable collateral for a
   product whose entire claim is that this cannot happen.

## 9. Reading the result — diagnostic, not go/no-go

**The words "green" and "red" belong to M2.** At n=9, treating tasks as independent (they are not —
effective n is nearer 3, nested in three authors and one or two reviewers):

| True merge rate | P(observe ≥6/9) | P(observe ≤3/9) |
|---|---|---|
| 0.4 — below the kill line | 9.9% | 48.3% |
| 0.5 — **at** the kill line | **25.4%** | 25.4% |
| 0.6 — at target | 48.3% | **9.9%** |
| 0.7 | 73.0% | 2.5% |

A product sitting exactly on the kill line looks like a pass a quarter of the time. A product
exactly at target fails to clear the bar **more than half** the time. Observed 6/9 has a 95%
interval of roughly 35–88%. These bands overlap almost completely.

**So read it as a diagnostic:**

| Observation | Read |
|---|---|
| No blocker found; merged-and-correct is a clear majority; no systemic pattern in the debriefs | **Proceed to M0/M1.** Use the qualitative findings to shape T-121. |
| Specific recurring problems — grounding gaps, missing evidence, one failure mode repeating | **Fix those first.** Usually cheap and usually not the thesis. |
| The loop is visibly broken — reviewer edits dominate, or authors can't get to a proposable draft | **Stop and redesign the authoring model** before building it. |
| **Merged artifacts fail the correctness audit** | **The most serious outcome available**, whatever the merge rate. The review gate is not working, and that is the product's core promise. |
| Time-box blown on a majority of turns | **Discount the entire run.** R3 says a result built on expert fiddling is a lie; §9 acts on it. |

Note: `00-vision.md §7`'s kill line is **below 50% at n=30**. v1 of this document stated `<40%` and
misattributed it to §7. Corrected — no threshold here is a kill criterion.

## 10. Debrief

**Author:** Did you get what you asked for? What did you fight? Could you explain what was produced
well enough to defend it — *before* and *after* seeing the spec? Would you have shipped it? What
would you have done if Tailwind didn't exist?

**Reviewer:** What did you check first, and why? What did you want to check but couldn't? How does
this compare to building it yourself? What would make this a two-minute review? What would make you
stop accepting these?

## 11. What this actually costs

**v1 said "~1 day setup." That was wrong by roughly an order of magnitude.**

Setup item "a semantic model with real descriptions" is **T-093 — milestone M2, size L**, behind
three M1 tickets. Self-hosted Cube carries an unrun M0 spike (T-118) and an outstanding ADR-003
verification item. **Realistic setup: one to three weeks** of data-team and architect time before
task one.

**Run cost, excluding setup: roughly 30 person-hours** — authors ~9h, reviewers ~6h, operator ~14h,
auditor ~4h.

**Work that must be assigned to a named person before starting:** build the semantic model (not the
operator, per R5) · select and vet the nine tasks · compute the per-task baseline (T-002) · produce
whatever review evidence the reviewer gets · record every turn, with a stated medium · open the PRs
(no bot exists yet, so this is manual) · adjudicate outcomes (auditor) · run the correctness audit ·
write the verdict.

**Get a reviewer turnaround commitment before the run.** Nine tasks × up to three rounds at "+1 day"
is two to three weeks elapsed, not one. That is Q-13 / T-096, and it is unanswered.

**Decouple from Cube if Cube isn't ready.** This test does not need it — the wizard can produce a
hand-written query and a chart, and the reviewed artifact is still a diffable spec. Keeping the two
coupled means an ADR-003 surprise blocks the hypothesis test for no benefit to the hypothesis.

## 12. Where findings go

Numbers → `wizard-of-oz-results.csv` and the thesis metrics in `00-vision.md §8` · what reviewers
looked at first → FR-GOV-04/05 · semantic-layer gaps → T-093 / T-119 · comprehension pairs →
**T-122**, which gates ADR-004 · everything else → **T-121** · anything learned running Cube →
ADR-003's outstanding checks and **T-118**.

One more: if `merged-after-reviewer-edits` turns out to be common, that is a **product design gap**,
not just a bad score — `07-domain-model.md §3`'s state machine has no state for a reviewer pushing
to the branch. Flag it.

## 13. Participant data

Use **participant codes** (`A1`, `A2`, `A3`, `R1`, `R2`) in the results sheet. The code-to-name
mapping stays **out of the repo**.

The sheet is a timed, git-versioned, permanent performance record of three colleagues, and one task
involves deliberately deceiving a reviewer. Before the run: a short written consent note saying what
is captured, who sees it, how long it is kept, and that participation is voluntary. This is not
ceremony — these people have to keep working here afterwards.
