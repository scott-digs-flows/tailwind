"""Anthropic client wrapper with prompt-cached system prompts and adaptive thinking."""

from __future__ import annotations

from functools import lru_cache

import anthropic

from tailwind.config import settings
from tailwind.logging import get_logger

logger = get_logger(__name__)


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    if settings.anthropic_api_key is None:
        raise RuntimeError("ANTHROPIC_API_KEY must be set to use AI features.")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key.get_secret_value())


def chat(
    *,
    system: str,
    user_message: str,
    max_tokens: int = 16000,
    thinking: bool = True,
) -> str:
    """One-shot chat call. System prompt is prompt-cached so repeated calls are cheap."""
    client = get_client()
    kwargs: dict[str, object] = {
        "model": settings.ai_model,
        "max_tokens": max_tokens,
        "system": [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [{"role": "user", "content": user_message}],
    }
    if thinking:
        kwargs["thinking"] = {"type": "adaptive"}

    try:
        response = client.messages.create(**kwargs)
    except anthropic.APIStatusError as exc:
        logger.error("anthropic_api_error", status=exc.status_code, type=exc.type)
        raise

    logger.info(
        "anthropic_call",
        cache_read=response.usage.cache_read_input_tokens,
        cache_creation=response.usage.cache_creation_input_tokens,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
    return "".join(block.text for block in response.content if block.type == "text")
