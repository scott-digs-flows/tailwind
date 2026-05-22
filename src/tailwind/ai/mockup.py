"""Generate a chart spec from a natural-language description."""

from __future__ import annotations

import json
import re

from tailwind.ai.client import chat
from tailwind.ai.prompts import GENERATE_MOCKUP


def generate_mockup(description: str) -> dict[str, object]:
    raw = chat(system=GENERATE_MOCKUP, user_message=description)
    spec = _extract_json(raw)
    return {"description": raw, "spec": spec}


def _extract_json(text: str) -> dict[str, object] | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
