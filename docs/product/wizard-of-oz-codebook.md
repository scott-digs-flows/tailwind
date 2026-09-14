# Wizard-of-Oz results — codebook

Controlled vocabularies for `wizard-of-oz-results.csv`. Agree these in the pre-registration
(§2 of the protocol) **before** task one. Blank means not yet recorded — no column is pre-filled
with an outcome value.

| Column | Values |
|---|---|
| `outcome` | `merged-as-is` · `merged-after-author-revision` · `merged-after-reviewer-edits` · `rejected` · `not-proposed` · `blocked-by-semantic-layer` · `correctly-refused` |
| `pr_class` | `dashboard-only` · `new-metric` · `semantic-model-change` — these route to different approvers (FR-GOV-07) and will differ sharply in merge rate and review time. Probably the most predictive variable in the study. |
| `correctness_audit_result` | `correct` · `wrong-number` · `misleading-composition` · `not-audited` |
| `task_source` | `author-own-backlog-request` (the only valid value; anything else means the task is dropped, see §5) |
| `comprehension_before_spec` / `comprehension_after_spec` | `explained-correctly` · `partial` · `could-not-explain` — the paired R6 probe |
| `wizard_timebox_blown` | `yes` · `no` — **blank until observed** |
| `planted_error` | `yes` · `no` — set during pre-registration, one task only |
| `builder_minutes` | Timed reviewer build of the same request, blind. Three tasks only; blank elsewhere. |
| `baseline_turnaround_days` | Historical data-team wall-clock. **Context only — not the comparator.** The comparator is `builder_minutes`. |

**Headline number:** count of `outcome ∈ {merged-as-is, merged-after-author-revision}`
**AND** `correctness_audit_result = correct`, over tasks that produced a PR.

`not-proposed`, `blocked-by-semantic-layer` and `correctly-refused` are excluded from that
denominator and **reported separately, always**.

Participant codes only (`A1`–`A3`, `R1`–`R2`). The mapping to real names does not live in this repo.
