"""Structured table processing, column type detection, and presentation formatting."""

import re
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field


def detect_column_type(values: List[str]) -> str:
    """Detect data type of a column from its cell values:

    'percentage', 'currency', 'date', 'numeric', 'label', or 'text'.
    """
    clean_vals = [v.strip() for v in values if v and v.strip()]
    if not clean_vals:
        return "text"

    pct_count = sum(1 for v in clean_vals if re.search(r'^\d+(?:\.\d+)?\s*%$', v) or v.endswith('%'))
    curr_count = sum(
        1 for v in clean_vals
        if re.search(r'^[\$€£₹]\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*[kmbKMB]|(?:\s*(?:million|billion|thousand)))?$', v, re.I)
        or re.search(r'^\d+(?:,\d{3})*(?:\.\d+)?(?:\s*[kmbKMB]|(?:\s*(?:million|billion|thousand)))?\s*[\$€£₹]$', v, re.I)
    )
    date_count = sum(1 for v in clean_vals if re.search(r'^(?:19|20)\d{2}(?:-\d{2})?$', v) or re.search(r'^Q[1-4](?:\s*(?:19|20)?\d{2})?$', v, re.I))
    num_count = sum(1 for v in clean_vals if re.search(r'^-?\d+(?:,\d{3})*(?:\.\d+)?$', v))

    total = len(clean_vals)
    if pct_count / total >= 0.6:
        return "percentage"
    if curr_count / total >= 0.6:
        return "currency"
    if date_count / total >= 0.6:
        return "date"
    if num_count / total >= 0.6:
        return "numeric"

    avg_len = sum(len(v) for v in clean_vals) / total
    if avg_len <= 35:
        return "label"
    return "text"


class ParsedTable(BaseModel):
    headers: List[str]
    rows: List[List[str]]
    col_types: List[str] = Field(default_factory=list)

    def format_row_for_slide(self, row: List[str]) -> str:
        """Format a single table row cleanly for display on a carousel slide."""
        n_cols = len(row)
        if n_cols == 0:
            return ""
        if n_cols == 1:
            return row[0].strip()

        if n_cols == 2:
            label, val = row[0].strip(), row[1].strip()
            if not label or not val:
                return label or val

            value_header = self.headers[1].strip() if len(self.headers) > 1 else ""
            generic_words = {"value", "amount", "figure", "number", "data", "total"}

            # If header is empty or generic, keep compact format
            if not value_header or value_header.lower() in generic_words:
                return f"{label} — {val}"

            # Count-vs-percent guard: if col 1 is numeric and any other col is percentage
            is_count = False
            if len(self.col_types) > 1 and self.col_types[1] == "numeric":
                is_count = True
            elif re.search(r'^-?\d+(?:,\d{3})*(?:\.\d+)?$', val) and not val.endswith('%'):
                is_count = True

            has_percent_col = any(t == "percentage" for t in self.col_types) or any(
                '%' in c for r in self.rows for c in r if c != val
            )

            if is_count and has_percent_col:
                # Derive noun from header: look for plural/count nouns or last noun
                nouns = re.findall(r'[a-zA-Z]+', value_header)
                count_noun = ""
                # Check for explicit plural/count terms
                for n in nouns:
                    n_low = n.lower()
                    if n_low in {"founders", "owners", "respondents", "users", "clients", "companies", "startups", "businesses", "participants", "people"}:
                        count_noun = n_low
                        break
                if not count_noun and nouns:
                    # Pick last noun/word
                    count_noun = nouns[-1].lower()
                unit_str = f" {count_noun}" if count_noun else f" ({value_header})"
                return f"{label}: {val}{unit_str}"

            # General non-generic 2-col formatting: "<label>: <val> <short_header>"
            short_header = self._shorten_header(value_header)
            formatted = f"{label}: {val} {short_header}".strip()

            # Check 70-char limit
            if len(formatted) <= 70:
                return formatted

            # Fallback for long string: "<label> — <val> (<value_header truncated>)"
            fallback = f"{label} — {val} ({short_header[:25]}...)"
            if len(fallback) <= 70:
                return fallback
            raise ValueError(f"Formatted table row exceeds 70 characters: '{formatted}'")

        if n_cols == 3:
            col0, col1, col2 = (c.strip() for c in row[:3])
            hdr1 = self.headers[1].strip() if len(self.headers) > 1 else ""
            hdr2 = self.headers[2].strip() if len(self.headers) > 2 else ""
            generic_words = {"value", "amount", "figure", "number", "data", "total", ""}

            # If headers are non-generic and columns are numeric/percent, carry headers
            is_col1_metric = (len(self.col_types) > 1 and self.col_types[1] in ("percentage", "currency", "numeric")) or any(ch in col1 for ch in "%$€£")
            is_col2_metric = (len(self.col_types) > 2 and self.col_types[2] in ("percentage", "currency", "numeric")) or any(ch in col2 for ch in "%$€£")

            if hdr1.lower() not in generic_words and hdr2.lower() not in generic_words and (is_col1_metric or is_col2_metric):
                s_hdr1 = self._shorten_header(hdr1)
                s_hdr2 = self._shorten_header(hdr2)
                res = f"{col0} — {s_hdr1}: {col1}, {s_hdr2}: {col2}"
                if len(res) <= 70:
                    return res

            if col2:
                return f"{col0} — {col1} ({col2})"
            return f"{col0} — {col1}"

        # 4+ columns
        col0 = row[0].strip()
        parts = []
        for i in range(1, n_cols):
            val = row[i].strip()
            if not val:
                continue
            hdr = self.headers[i] if i < len(self.headers) else f"Col{i+1}"
            parts.append(f"{hdr}: {val}")
        return f"{col0} — " + ", ".join(parts)

    def _shorten_header(self, header: str) -> str:
        """Shorten header to <= 4 words, dropping leading filler words if remaining is meaningful."""
        words = header.split()
        if not words:
            return ""

        filler_words = {"share", "reporting", "a", "an", "the", "of", "number", "count", "percentage", "proportion", "percent", "rate"}

        # Strip leading filler words if remaining has at least 1 content word
        idx = 0
        while idx < len(words) and words[idx].lower() in filler_words:
            idx += 1

        remaining = words[idx:] if idx < len(words) else words
        # Take at most 4 words
        shortened = remaining[:4]
        return " ".join(shortened).lower()

    def get_row_pairs(self, row: List[str]) -> Dict[str, str]:
        """Return mapping of header name to cell value for grounding verification."""
        pairs: Dict[str, str] = {}
        for idx, val in enumerate(row):
            hdr = self.headers[idx] if idx < len(self.headers) and self.headers[idx] else f"Column {idx+1}"
            pairs[hdr] = val.strip()
        return pairs


def parse_table_data(headers: List[str], rows: List[List[str]]) -> ParsedTable:
    """Parse raw headers and rows, detect column types, and return ParsedTable."""
    clean_headers = [h.strip() for h in headers]
    clean_rows: List[List[str]] = []

    for r in rows:
        clean_r = [c.strip() for c in r]
        # Pad row if shorter than headers
        while len(clean_r) < len(clean_headers):
            clean_r.append("")
        clean_rows.append(clean_r)

    # Detect types per column
    col_types: List[str] = []
    n_cols = len(clean_headers)
    for c_idx in range(n_cols):
        col_vals = [r[c_idx] for r in clean_rows if c_idx < len(r)]
        col_types.append(detect_column_type(col_vals))

    return ParsedTable(headers=clean_headers, rows=clean_rows, col_types=col_types)
