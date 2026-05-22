"""AI integrations: explain dashboards, answer questions, mock up visuals, submit ideas."""

from tailwind.ai.explain import explain_dashboard
from tailwind.ai.mockup import generate_mockup
from tailwind.ai.nl_query import answer_question
from tailwind.ai.submit import submit_dashboard_idea

__all__ = [
    "answer_question",
    "explain_dashboard",
    "generate_mockup",
    "submit_dashboard_idea",
]
