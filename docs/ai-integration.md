# AI Integration

tailwind embeds Anthropic's Claude into the analytics UX. This doc explains how.

## What ships

| Feature | UI entry point | Module |
|---|---|---|
| Explain dashboard | "Explain this dashboard" button (AI panel) | `tailwind.ai.explain` |
| Ask the data | "Ask" tab textbox (AI panel) | `tailwind.ai.nl_query` |
| Mock up a visual | "Mockup" tab textbox (AI panel) | `tailwind.ai.mockup` |
| Submit dashboard idea | "Submit to analytics team" button | `tailwind.ai.submit` |

## Model

Default: `claude-opus-4-7` (configurable via `TAILWIND_AI_MODEL`).

We use **adaptive thinking** (`thinking={"type": "adaptive"}`) — Claude decides per-request when and how much to think. No fixed token budget.

## Prompt caching

Every AI call uses prompt-cached system prompts via `cache_control: {"type": "ephemeral"}`. System prompts live in `tailwind.ai.prompts` and are kept byte-stable so repeated calls in the same 5-minute window hit the cache (~10x cost reduction).

Rules for editing prompts:

- Don't interpolate timestamps, user IDs, or per-request data into system prompts.
- Don't reorder existing prompts; append new ones to the end of the file.
- Serialize any JSON in system prompts with sorted keys.

## Auth

`ANTHROPIC_API_KEY` is required. Loaded via `pydantic-settings`; never logged.

## GitHub integration (idea submission)

`tailwind.ai.submit` posts a structured issue to the repo named in `TAILWIND_GITHUB_REPO` using a token in `TAILWIND_GITHUB_TOKEN`. The token needs `repo:issues` write permission.

## Failure modes

- **Missing API key** — call raises `RuntimeError` with a clear message; the UI surfaces it.
- **API errors** — `anthropic.APIStatusError` is caught and logged with status + type; re-raised so callbacks can show a user-friendly error.
- **GitHub failures** — surfaced via `httpx.HTTPStatusError`.

## Extending

To add a new AI feature, follow the recipe in [architecture.md](architecture.md) → "Adding a new AI feature."
