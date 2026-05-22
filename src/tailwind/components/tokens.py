"""Design tokens: colors, spacing, typography. Single source of truth for styling."""

from __future__ import annotations

from typing import Final


class Color:
    PRIMARY: Final = "#2563eb"
    PRIMARY_HOVER: Final = "#1d4ed8"
    SUCCESS: Final = "#16a34a"
    WARNING: Final = "#d97706"
    DANGER: Final = "#dc2626"
    NEUTRAL_900: Final = "#0f172a"
    NEUTRAL_700: Final = "#334155"
    NEUTRAL_500: Final = "#64748b"
    NEUTRAL_300: Final = "#cbd5e1"
    NEUTRAL_100: Final = "#f1f5f9"
    NEUTRAL_50: Final = "#f8fafc"
    SURFACE: Final = "#ffffff"


class Space:
    XS: Final = "0.25rem"
    SM: Final = "0.5rem"
    MD: Final = "1rem"
    LG: Final = "1.5rem"
    XL: Final = "2rem"
    XXL: Final = "3rem"


class Radius:
    SM: Final = "0.25rem"
    MD: Final = "0.5rem"
    LG: Final = "1rem"


class Font:
    FAMILY: Final = (
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
        "'Helvetica Neue', Arial, sans-serif"
    )
    MONO: Final = "ui-monospace, 'SFMono-Regular', Menlo, monospace"
