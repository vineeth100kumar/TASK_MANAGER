"""Post spec: a Markdown file that says exactly what each slide shows.

A spec is written by a person or another AI (see POST_FORMAT.md) and turned into a finished
carousel by pure code: no AI, no rewriting. The facts in it are the author's; the checks here
are about whether the post will render well (lengths, layout fit, chart data, images).
"""

from .parser import (
    SPEC_VERSION, SLIDE_TYPES, SpecIssue, ParsedSpec,
    is_spec_text, is_spec_file, parse_spec, parse_value,
)
from .checks import check_slides, check_caption, issues_summary
from .build import build_from_spec, validate_spec_text, auto_caption

__all__ = [
    "SPEC_VERSION", "SLIDE_TYPES", "SpecIssue", "ParsedSpec",
    "is_spec_text", "is_spec_file", "parse_spec", "parse_value",
    "check_slides", "check_caption", "issues_summary",
    "build_from_spec", "validate_spec_text", "auto_caption",
]
