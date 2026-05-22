"""Dashboard explanation: summarize trends, anomalies, and meaning in plain English."""

from __future__ import annotations

import pandas as pd

from tailwind.ai.client import chat
from tailwind.ai.prompts import EXPLAIN_DASHBOARD


def explain_dashboard(title: str, description: str, df: pd.DataFrame) -> str:
    user_message = (
        f"Dashboard: {title}\n"
        f"Description: {description}\n\n"
        f"Data (CSV):\n{df.to_csv(index=False)}"
    )
    return chat(system=EXPLAIN_DASHBOARD, user_message=user_message)
