"""Natural-language Q&A grounded in warehouse schema and sample data."""

from __future__ import annotations

import pandas as pd

from tailwind.ai.client import chat
from tailwind.ai.prompts import ANSWER_QUESTION
from tailwind.data import get_warehouse


def answer_question(question: str, table: str | None = None) -> str:
    warehouse = get_warehouse()
    tables = [table] if table else warehouse.list_tables()

    context_parts: list[str] = []
    for t in tables:
        schema = warehouse.describe_table(t)
        context_parts.append(f"Table `{t}` schema:\n{schema.to_csv(index=False)}")
    context = "\n\n".join(context_parts)

    user_message = f"Schema:\n{context}\n\nQuestion: {question}"
    return chat(system=ANSWER_QUESTION, user_message=user_message)


def render_table(df: pd.DataFrame) -> str:
    return df.to_markdown(index=False)
