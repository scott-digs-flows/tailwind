#!/usr/bin/env python3
"""Check the Tailwind backlog in JIRA against the product docs.

This is the port of scripts/validate_docs.py from TICKETS.csv to JIRA project TW
(05-ways-of-working.md). It exists because JIRA enforces none of the fourteen
invariants the CSV schema enforced: no requirement coverage, no dependency DAG,
no cycle detection. Moving without porting these would lose them silently, which
is the worst kind of loss -- nothing fails, the backlog just quietly stops being
trustworthy.

RUN IT DELIBERATELY. It is NOT a CI gate, and turning it into one would be a
mistake. A gate was right when the backlog was a file in this repo: a commit could
break it, so a commit should be blocked by it. Now that tickets live in JIRA the
coupling inverts -- a TypeScript change cannot create a dependency cycle, but it
could be blocked by an expired token or an Atlassian outage. A check that fails for
reasons unrelated to the change under review is one people learn to bypass, and a
bypassed check protects nothing.

Run it after a batch of backlog edits, and ALWAYS after changing
docs/product/01-requirements.md -- a new Must with no ticket is the failure this
catches most often, and nothing else will notice.

    JIRA_BASE_URL=https://scottdigsflows.atlassian.net \
    JIRA_EMAIL=you@example.com JIRA_API_TOKEN=... \
    python3 scripts/validate_jira.py

    python3 scripts/validate_jira.py --offline dump.json   # run the checks over a saved dump

Exits non-zero on any error, so it can be scripted. Warnings are advisory.

Stdlib only, deliberately: this has to run from a clean checkout with nothing
installed, so that "I'll check the backlog" is never gated on a working toolchain.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS = ROOT / "docs/product/01-requirements.md"
ARCH_BRIEF = ROOT / "docs/product/02-architecture-brief.md"
QUESTIONS = ROOT / "docs/product/04-open-questions.md"
ADR_DIR = ROOT / "docs/adr"

PROJECT = "TW"
FIELDS = ["summary", "status", "priority", "labels", "parent", "issuelinks",
          "description", "issuetype"]

REQ_RE = re.compile(r"\b(?:FR|NFR)-[A-Z0-9]+-\d+\b")
REQ_ROW_RE = re.compile(r"^\|\s*((?:FR|NFR)-[A-Z0-9]+-\d+)\s*\|\s*([MSCW])\s*\|")
ADR_RE = re.compile(r"\bADR-\d+\b")
Q_RE = re.compile(r"\bQ-\d+\b")
LEGACY_RE = re.compile(r"^legacy_id:\s*(\S+)\s*$", re.M)
REQIDS_RE = re.compile(r"^req_ids:\s*(.+?)\s*$", re.M)

MILESTONES = {"M0", "M1", "M2", "M3", "M4"}
SIZES = {"size-S", "size-M", "size-L", "size-XL"}
TYPES = {"type-feature", "type-spike", "type-adr", "type-infra", "type-discovery", "type-chore"}
ROLES = {"role-product", "role-architect", "role-fullstack", "role-data-team", "role-security"}
PRIORITIES = {"Highest", "High", "Medium", "Low"}
# type-chore and type-infra are the only routine exceptions to traceability.
TRACE_EXEMPT = {"type-chore", "type-infra"}

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# --------------------------------------------------------------------------- fetch

def _request(url: str, token: str, email: str, body: dict | None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if body else "GET")
    cred = base64.b64encode(f"{email}:{token}".encode()).decode()
    req.add_header("Authorization", f"Basic {cred}")
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def fetch_issues() -> list[dict]:
    """Every issue in the project, paged. Fails closed: no credentials, no pass."""
    base = os.environ.get("JIRA_BASE_URL", "").rstrip("/")
    email = os.environ.get("JIRA_EMAIL", "")
    token = os.environ.get("JIRA_API_TOKEN", "")
    if not (base and email and token):
        print("FATAL: JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN must all be set.\n"
              "       Failing rather than reporting a clean backlog it never looked at.",
              file=sys.stderr)
        sys.exit(2)

    issues: list[dict] = []
    cursor: str | None = None
    while True:
        body = {"jql": f"project = {PROJECT} ORDER BY key ASC",
                "fields": FIELDS, "maxResults": 100}
        if cursor:
            body["nextPageToken"] = cursor
        try:
            page = _request(f"{base}/rest/api/3/search/jql", token, email, body)
        except urllib.error.HTTPError as exc:                      # pragma: no cover
            print(f"FATAL: JIRA returned {exc.code}: {exc.read()[:400]!r}", file=sys.stderr)
            sys.exit(2)
        issues.extend(page.get("issues", []))
        cursor = page.get("nextPageToken")
        if page.get("isLast", cursor is None) or not cursor:
            break
    return issues


# --------------------------------------------------------------------------- parse

FENCE_RE = re.compile(r"```tailwind-meta\s*\n(.*?)```", re.S)


def adf_code_blocks(node, out: list[str]) -> None:
    """Collect the text of every codeBlock in an ADF document.

    The REST API returns `description` as ADF, not the markdown that was written, so
    the parse has to walk the tree. It collects code blocks ONLY: the meta block is a
    codeBlock, and scanning the whole document instead would let a `req_ids:` written
    in ordinary prose shadow the real one -- the regexes below take the first match.
    """
    if isinstance(node, list):
        for n in node:
            adf_code_blocks(n, out)
    elif isinstance(node, dict):
        if node.get("type") == "codeBlock":
            # A codeBlock's children are inline text nodes; they are one line of source
            # split by marks, so they join with nothing rather than with a newline.
            out.append("".join(
                c.get("text", "") for c in (node.get("content") or []) if isinstance(c, dict)
            ))
        else:
            adf_code_blocks(node.get("content"), out)


def meta_text(description) -> str:
    """The contents of the tailwind-meta block, whatever format the API returned."""
    if description is None:
        return ""
    if isinstance(description, str):
        # Markdown, as the MCP returns it. Take the fenced block, not the whole body.
        return "\n".join(FENCE_RE.findall(description))
    blocks: list[str] = []
    adf_code_blocks(description, blocks)
    return "\n".join(blocks)


def normalise(issue: dict) -> dict:
    f = issue.get("fields", {})
    text = meta_text(f.get("description"))
    legacy = LEGACY_RE.search(text)
    reqs = REQIDS_RE.search(text)
    links = []
    for link in f.get("issuelinks") or []:
        name = (link.get("type") or {}).get("name")
        if "inwardIssue" in link:
            links.append((name, "inward", link["inwardIssue"]["key"]))
        if "outwardIssue" in link:
            links.append((name, "outward", link["outwardIssue"]["key"]))
    return {
        "key": issue["key"],
        "summary": f.get("summary") or "",
        "type": ((f.get("issuetype") or {}).get("name")) or "",
        "status": ((f.get("status") or {}).get("name")) or "",
        "priority": ((f.get("priority") or {}).get("name")) or "",
        "labels": f.get("labels") or [],
        "parent": ((f.get("parent") or {}).get("key")),
        "links": links,
        "legacy_id": legacy.group(1) if legacy else None,
        "req_ids": (reqs.group(1).split() if reqs else []),
    }


def detect_cycles(deps: dict[str, list[str]]) -> list[list[str]]:
    """Return dependency cycles. A cycle means nothing in it can ever start."""
    cycles: list[list[str]] = []
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {n: WHITE for n in deps}

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

    for n in deps:
        if colour[n] == WHITE:
            visit(n, [n])
    return cycles


# --------------------------------------------------------------------------- checks

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", metavar="FILE",
                    help="run the checks over a saved JSON dump instead of calling JIRA")
    args = ap.parse_args()

    raw = json.load(open(args.offline)) if args.offline else fetch_issues()
    if isinstance(raw, dict):
        inner = raw.get("issues", [])
        raw = inner.get("nodes", []) if isinstance(inner, dict) else inner
    issues = [normalise(i) for i in raw]
    if not issues:
        print("FATAL: no issues returned", file=sys.stderr)
        return 2

    epics = {i["key"] for i in issues if i["type"] == "Epic"}
    tickets = [i for i in issues if i["type"] != "Epic"]

    req_priorities = {m.group(1): m.group(2)
                      for line in REQUIREMENTS.read_text().splitlines()
                      if (m := REQ_ROW_RE.match(line.strip()))}
    defined_reqs = set(req_priorities) | set(REQ_RE.findall(REQUIREMENTS.read_text()))
    defined_adrs = set(ADR_RE.findall(ARCH_BRIEF.read_text()))
    defined_qs = set(Q_RE.findall(QUESTIONS.read_text()))
    known_ids = defined_reqs | defined_adrs | defined_qs

    keys = {i["key"] for i in issues}
    referenced: set[str] = set()
    seen_legacy: dict[str, str] = {}
    deps: dict[str, list[str]] = {}

    for t in tickets:
        k = t["key"]

        # 1. the meta block must parse; it is the traceability spine
        if t["legacy_id"]:
            if t["legacy_id"] in seen_legacy:
                err(f"{k}: legacy_id {t['legacy_id']} also on {seen_legacy[t['legacy_id']]}")
            seen_legacy[t["legacy_id"]] = k

        # 2. epic parent
        if not t["parent"]:
            err(f"{k}: no epic parent")
        elif t["parent"] not in epics:
            err(f"{k}: parent {t['parent']} is not an Epic")

        # 3. the label schema carries milestone, size, type and role
        labels = set(t["labels"])
        for name, allowed in (("milestone", MILESTONES), ("size", SIZES),
                              ("type", TYPES), ("role", ROLES)):
            got = labels & allowed
            if len(got) != 1:
                err(f"{k}: expected exactly one {name} label, got {sorted(got) or 'none'}")
        if t["priority"] not in PRIORITIES:
            err(f"{k}: priority {t['priority']!r} not in {sorted(PRIORITIES)}")
        if not t["summary"].strip():
            err(f"{k}: empty summary")

        # 4. every ticket traces to a requirement, ADR or open question
        ttype = next(iter(labels & TYPES), None)
        if not t["req_ids"] and ttype not in TRACE_EXEMPT:
            err(f"{k}: no req_ids (only type-chore/type-infra may omit them)")
        for ref in t["req_ids"]:
            if ref not in known_ids:
                err(f"{k}: req_id {ref!r} is not defined in any product doc")
            referenced.add(ref)

        # 5. dependencies are Blocks links; inward means "is blocked by"
        blockers = [key for (name, direction, key) in t["links"]
                    if name == "Blocks" and direction == "inward"]
        for b in blockers:
            if b not in keys:
                err(f"{k}: blocked by {b}, which is not in this project")
        deps[k] = blockers

    # 6. no cycles -- JIRA will happily let you draw one
    for cycle in detect_cycles(deps):
        err(f"dependency cycle: {' -> '.join(cycle)}")

    # 7. nothing In Progress behind an open blocker
    status = {t["key"]: t["status"] for t in tickets}
    for t in tickets:
        if t["status"] == "In Progress":
            open_deps = [d for d in deps[t["key"]] if status.get(d) != "Done"]
            if open_deps:
                err(f"{t['key']}: In Progress but blocked by unfinished {open_deps}")

    # 8. every Must/Should requirement has at least one ticket
    for req, moscow in sorted(req_priorities.items()):
        if moscow in {"M", "S"} and req not in referenced:
            err(f"{req} is a {'Must' if moscow == 'M' else 'Should'} with no ticket")

    # 9. XL is a flag meaning "not understood well enough to start", not an estimate.
    # Only STARTED work breaches this. A finished XL is history -- erroring on it forever
    # would make the check impossible to get back to green, which is how a gate dies.
    for t in tickets:
        if "size-XL" in t["labels"] and t["status"] == "In Progress":
            err(f"{t['key']}: XL tickets must be split before work starts")

    # warnings
    for adr in sorted(defined_adrs):
        if adr not in referenced:
            warn(f"{adr} has no ticket that produces it")
    if ADR_DIR.exists():
        written = {m for f in ADR_DIR.glob("*.md") for m in ADR_RE.findall(f.name.upper())}
        for adr in sorted(defined_adrs - written):
            warn(f"{adr} is not yet written to docs/adr/")
    for t in tickets:
        if "size-XL" in t["labels"] and t["status"] == "To Do":
            warn(f"{t['key']} is XL and not yet split (fails the Definition of Ready)")

    print(f"Checked {len(tickets)} tickets in {len(epics)} epics against "
          f"{len(defined_reqs)} requirements, {len(defined_adrs)} ADRs, "
          f"{len(defined_qs)} questions.")
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
