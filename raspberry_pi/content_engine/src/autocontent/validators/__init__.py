"""Pure-code deterministic validators for factual faithfulness and constraints."""

from typing import NamedTuple, Literal

Severity = Literal["ERROR", "WARN"]


class ValidationIssue(NamedTuple):
    severity: Severity
    code: str
    message: str
    offending_text: str | None = None
