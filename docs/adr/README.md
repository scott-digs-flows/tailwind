# Architecture Decision Records

One file per decision: `ADR-NNN-kebab-case-title.md`, from [TEMPLATE.md](TEMPLATE.md).

**Numbers are assigned in [02-architecture-brief.md §4](../product/02-architecture-brief.md) and
are stable.** Don't renumber, don't reuse. A decision that turns out wrong gets a new ADR marked
*Supersedes ADR-NNN*, and the old one is marked *Superseded* — the history is the point.

## Rules

1. **At least two options, honestly argued.** A one-option ADR is a note, not a decision.
2. **Record the reasoning, not just the outcome.** In a year the reasoning is the only part that
   still has value.
3. **Every ADR states a revisit trigger.** Decisions made under an open question or a planning
   assumption are provisional; say so and say what would reopen them.
4. **Write the ADR before the code it governs**, and update its ticket status when it lands.
5. **Challenge, don't work around.** If a binding constraint in
   [§2 of the architecture brief](../product/02-architecture-brief.md) makes a decision impossible,
   that's a conversation with Product — not something to design around silently.

## Status

`python3 scripts/validate_docs.py` warns for every ADR named in the brief that isn't yet written
here.

| ADR | Decision | Milestone | Status |
|---|---|---|---|
| ADR-001 | Deployment target and topology | M0 | Not started |
| ADR-002 | Warehouse of record; dialect support tiers | M0 | Not started |
| ADR-003 | Semantic engine selection | M0 | Not started |
| ADR-004 | Spec format and repository layout | M0 | Not started |
| ADR-005 | Front-end stack and chart library | M0 | Not started |
| ADR-006 | Backend framework and API style | M0 | Not started |
| ADR-007 | Artifact publish mechanism | M1 | Not started |
| ADR-008 | Cache topology and RLS-safe keying | M1 | Not started |
| ADR-009 | Identity, group sync, RLS attribute model | M1 | Not started |
| ADR-010 | Git host integration and PR brokering | M2 | Not started |
| ADR-011 | AI provider, model tiering, egress policy | M2 | Not started |
| ADR-012 | Context/retrieval strategy for AI grounding | M2 | Not started |
| ADR-013 | CI rendering approach and credential boundary | M3 | Not started |
| ADR-014 | Multi-tenancy model | M0 | Not started |
| ADR-015 | Observability stack and trace propagation | M1 | Not started |

## Suggested order for M0

`ADR-003` (semantic engine) first — it constrains `ADR-004` (spec format), which constrains
everything else. `ADR-001` and `ADR-006` can run in parallel. `ADR-008` should wait for real
volumetrics from M1 observability rather than being written against planning assumptions.
