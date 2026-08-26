---
name: adr
description: Write, revise, or supersede an Architecture Decision Record in docs/adr/. Use whenever a design decision needs recording, when the user says "write ADR-NNN", "decide between X and Y", "record this decision", or when implementation work reveals an undocumented architectural choice. Also use when superseding a decision that turned out wrong.
---

# Writing an ADR

ADR numbers are **pre-assigned** in [docs/product/02-architecture-brief.md §4](../../../docs/product/02-architecture-brief.md).
Look the number up there — do not invent one. If the decision isn't on that list, it may not need
an ADR; check first, and if it does, add it to the brief's table in the same change.

## Before writing

1. Read the row for this ADR in the brief's table (§4) and the matching hard problem in §3. §3 is
   where the actual difficulty is described.
2. Read the binding constraints in §2. **A decision that violates one is not available.** If the
   constraint appears wrong, say so explicitly and stop — that is a Product conversation, not
   something to route around in an ADR.
3. Read [08-poc-scope.md](../../../docs/product/08-poc-scope.md). Decisions made for the POC are
   often deliberately smaller than the GA requirement. Note which you are deciding for.
4. Check [04-open-questions.md](../../../docs/product/04-open-questions.md) for anything this
   depends on. If it depends on an unanswered question, you may still decide — but state the
   assumption and set a revisit trigger.

## Writing

Copy [docs/adr/TEMPLATE.md](../../../docs/adr/TEMPLATE.md) to
`docs/adr/ADR-NNN-kebab-case-title.md` and fill it in.

Non-negotiables:

- **At least two real options**, argued honestly. If one option is obviously right, the ADR should
  explain why the plausible alternative fails — a straw man wastes the reader's time.
- **The reasoning is the deliverable.** In a year, the outcome will be visible in the code; only
  the reasoning will be missing.
- **Consequences must include what this forecloses.** Every architectural decision closes doors;
  naming them is the difference between a decision and an assertion.
- **A concrete revisit trigger.** "Revisit if we outgrow it" is not a trigger. "Revisit when p95
  exceeds 2.5s or cache hit rate drops below 85%" is.
- **A validation method.** How will we know this was right?

## After writing

1. Update the status table in [docs/adr/README.md](../../../docs/adr/README.md).
2. Update the producing ticket in `TICKETS.csv` (`status` → `review` or `done`). Use the `ticket`
   skill.
3. If the decision answers or changes an open question, update
   [04-open-questions.md](../../../docs/product/04-open-questions.md) with a dated resolution and
   its consequences.
4. If it changes scope, update [01-requirements.md](../../../docs/product/01-requirements.md)
   **before** the tickets.
5. Run `python3 scripts/validate_docs.py`.

## Superseding

Never edit a decision to say something different. Write a new ADR with the next free number,
mark it *Supersedes ADR-NNN*, and mark the old one *Superseded by ADR-NNN*. The history of what
was believed and why is the value.
