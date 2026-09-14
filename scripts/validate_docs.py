#!/usr/bin/env python3
"""Validate TICKETS.csv against the product docs.

Mechanical rules belong in a check, not in a prompt. This is the same argument the
product itself makes: guardrails beat good intentions. Run it in CI.

    python3 scripts/validate_docs.py

Exits non-zero on any error. Warnings do not fail the build.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TICKETS = ROOT / "TICKETS.csv"
REQUIREMENTS = ROOT / "docs/product/01-requirements.md"
ARCH_BRIEF = ROOT / "docs/product/02-architecture-brief.md"
QUESTIONS = ROOT / "docs/product/04-open-questions.md"
ADR_DIR = ROOT / "docs/adr"

COLUMNS = [
    "id", "epic", "milestone", "title", "type", "priority", "size",
    "status", "owner_role", "depends_on", "req_ids", "acceptance",
]

ENUMS = {
    "type": {"feature", "spike", "adr", "infra", "discovery", "chore"},
    "priority": {"P0", "P1", "P2", "P3"},
    "size": {"S", "M", "L", "XL"},
    "status": {"todo", "in-progress", "blocked", "review", "done"},
    "owner_role": {"product", "architect", "fullstack", "data-team", "security"},
    "milestone": {"M0", "M1", "M2", "M3", "M4"},
}

REQ_RE = re.compile(r"\b(?:FR|NFR)-[A-Z0-9]+-\d+\b")
# Requirement tables are "| FR-SEM-01 | M | text |" -- capture the MoSCoW priority.
REQ_ROW_RE = re.compile(r"^\|\s*((?:FR|NFR)-[A-Z0-9]+-\d+)\s*\|\s*([MSCW])\s*\|")
ADR_RE = re.compile(r"\bADR-\d+\b")
Q_RE = re.compile(r"\bQ-\d+\b")
TICKET_ID_RE = re.compile(r"^T-\d{3}$")
EPIC_RE = re.compile(r"^E-\d{2}$")

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def load_requirement_priorities() -> dict[str, str]:
    """Map requirement ID -> MoSCoW priority, from the requirement tables."""
    priorities: dict[str, str] = {}
    for line in REQUIREMENTS.read_text().splitlines():
        m = REQ_ROW_RE.match(line.strip())
        if m:
            priorities[m.group(1)] = m.group(2)
    return priorities


def detect_cycles(deps: dict[str, list[str]]) -> list[list[str]]:
    """Return dependency cycles, if any. A cycle means nothing can ever start."""
    cycles: list[list[str]] = []
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {node: WHITE for node in deps}

    def visit(node: str, path: list[str]) -> None:
        colour[node] = GREY
        for nxt in deps.get(node, []):
            if nxt not in colour:
                continue
            if colour[nxt] == GREY:
                cycles.append(path[path.index(nxt):] + [nxt] if nxt in path else [node, nxt])
            elif colour[nxt] == WHITE:
                visit(nxt, path + [nxt])
        colour[node] = BLACK

    for node in deps:
        if colour[node] == WHITE:
            visit(node, [node])
    return cycles


def main() -> int:
    if not TICKETS.exists():
        print(f"FATAL: {TICKETS} not found", file=sys.stderr)
        return 2

    req_priorities = load_requirement_priorities()
    defined_reqs = set(req_priorities) | set(REQ_RE.findall(REQUIREMENTS.read_text()))
    defined_adrs = set(ADR_RE.findall(ARCH_BRIEF.read_text()))
    defined_qs = set(Q_RE.findall(QUESTIONS.read_text()))
    known_ids = defined_reqs | defined_adrs | defined_qs

    with TICKETS.open(newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != COLUMNS:
            err(f"column mismatch\n    expected: {COLUMNS}\n    found:    {reader.fieldnames}")
            return report()
        rows = list(reader)

    seen: set[str] = set()
    deps: dict[str, list[str]] = {}
    referenced: set[str] = set()

    for row in rows:
        tid = row["id"]

        if not TICKET_ID_RE.match(tid):
            err(f"{tid}: id must match T-###")
        if tid in seen:
            err(f"{tid}: duplicate ticket id")
        seen.add(tid)

        if not EPIC_RE.match(row["epic"]):
            err(f"{tid}: epic must match E-## (got {row['epic']!r})")

        for field, allowed in ENUMS.items():
            if row[field] not in allowed:
                err(f"{tid}: {field}={row[field]!r} not in {sorted(allowed)}")

        if not row["title"].strip():
            err(f"{tid}: empty title")
        if not row["acceptance"].strip():
            err(f"{tid}: empty acceptance criteria")

        # Rule 1 in 05-ways-of-working.md: every ticket traces to a requirement or ADR.
        ids = row["req_ids"].split()
        if not ids and row["type"] not in {"chore", "infra"}:
            err(f"{tid}: no req_ids (only chore/infra may omit them)")
        for ref in ids:
            if ref not in known_ids:
                err(f"{tid}: req_id {ref!r} is not defined in any product doc")
            referenced.add(ref)

        deps[tid] = row["depends_on"].split()

    for tid, targets in deps.items():
        for target in targets:
            if target not in seen:
                err(f"{tid}: depends_on {target!r} which does not exist")

    for cycle in detect_cycles(deps):
        err(f"dependency cycle: {' -> '.join(cycle)}")

    # Rule 3: a ticket cannot be in-progress while a dependency is unfinished.
    status = {r["id"]: r["status"] for r in rows}
    for row in rows:
        if row["status"] == "in-progress":
            open_deps = [d for d in deps[row["id"]] if status.get(d) != "done"]
            if open_deps:
                err(f"{row['id']}: in-progress but depends on unfinished {open_deps}")

    # Every Must/Should requirement needs at least one ticket. Could/Won't may be bare.
    for req, moscow in sorted(req_priorities.items()):
        if moscow in {"M", "S"} and req not in referenced:
            err(f"{req} is a {'Must' if moscow == 'M' else 'Should'} with no ticket")

    # Each ADR should have a ticket that produces it.
    for adr in sorted(defined_adrs):
        if adr not in referenced:
            warn(f"{adr} has no ticket that produces it")

    # An ADR referenced by a ticket should eventually exist on disk.
    if ADR_DIR.exists():
        written = {m for f in ADR_DIR.glob("*.md") for m in ADR_RE.findall(f.name.upper())}
        for adr in sorted(defined_adrs - written):
            warn(f"{adr} is not yet written to docs/adr/")

    # XL is a flag, not an estimate (rule 2).
    for row in rows:
        if row["size"] == "XL" and row["status"] in {"in-progress", "review"}:
            err(f"{row['id']}: XL tickets must be split before work starts")

    print(f"Checked {len(rows)} tickets against {len(defined_reqs)} requirements, "
          f"{len(defined_adrs)} ADRs, {len(defined_qs)} questions.")
    return report()


def report() -> int:
    for w in warnings:
        print(f"  warn:  {w}")
    for e in errors:
        print(f"  ERROR: {e}", file=sys.stderr)
    if errors:
        print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)", file=sys.stderr)
        return 1
    print(f"OK - {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
