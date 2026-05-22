"""Submit a dashboard idea to the analytics team as a GitHub issue."""

from __future__ import annotations

import httpx

from tailwind.ai.client import chat
from tailwind.ai.prompts import SUBMIT_IDEA
from tailwind.config import settings
from tailwind.logging import get_logger

logger = get_logger(__name__)


def submit_dashboard_idea(user_description: str) -> dict[str, str]:
    if settings.github_token is None or settings.github_repo is None:
        raise RuntimeError(
            "TAILWIND_GITHUB_TOKEN and TAILWIND_GITHUB_REPO must be set to submit ideas."
        )

    structured = chat(system=SUBMIT_IDEA, user_message=user_description)
    title, body = _split_title_body(structured)

    url = f"https://api.github.com/repos/{settings.github_repo}/issues"
    headers = {
        "Authorization": f"Bearer {settings.github_token.get_secret_value()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {"title": title, "body": body, "labels": ["dashboard-idea", "triage"]}

    response = httpx.post(url, headers=headers, json=payload, timeout=15.0)
    response.raise_for_status()
    data = response.json()
    logger.info("idea_submitted", issue_url=data["html_url"])
    return {"url": data["html_url"], "number": data["number"], "title": title}


def _split_title_body(text: str) -> tuple[str, str]:
    lines = text.strip().splitlines()
    if not lines:
        return ("Dashboard idea", text)
    title = lines[0].lstrip("# ").strip()[:80] or "Dashboard idea"
    body = "\n".join(lines[1:]).strip() or text
    return (title, body)
