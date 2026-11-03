"""Validator to verify that table cell pairings are not swapped or misrepresented across rows."""

import re
from typing import Any, Dict, List


def parse_table_row_pairs(text: str) -> Dict[str, str]:
    """Extract header: value pairs from formatted table row string:

    e.g. 'Review frequency: Weekly | Share reporting a profitable year: 71%'
    """
    pairs: Dict[str, str] = {}
    parts = text.split(" | ")
    for p in parts:
        if ":" in p:
            h, v = p.split(":", 1)
            pairs[h.strip()] = v.strip()
    return pairs


def validate_table_row_associations(
    slide_text: str,
    cited_quotes: List[str],
    all_table_quotes: List[str] | None = None
) -> List[Dict[str, str]]:
    """Verify that when slide text mentions table data, it does not combine a label from

    one table row with a metric/value from a different table row.
    Returns list of issues: [{'severity': 'ERROR', 'code': 'TABLE_PAIRING_MISMATCH', 'message': ...}]
    """
    issues: List[Dict[str, str]] = []
    
    # Check each cited quote that represents a table row
    table_rows = [parse_table_row_pairs(q) for q in cited_quotes if " | " in q and ":" in q]
    if not table_rows:
        return issues

    # If all_table_quotes is provided, check for cross-row swapped values
    all_table_rows = [parse_table_row_pairs(q) for q in (all_table_quotes or cited_quotes) if " | " in q and ":" in q]
    if len(all_table_rows) < 2:
        return issues

    # For each row in table, check if slide mentions this row's label but uses another row's numeric value
    for row_idx, row in enumerate(all_table_rows):
        vals = list(row.values())
        if len(vals) < 2:
            continue
        label = vals[0]
        correct_metric = vals[1]

        # If label is mentioned in slide text (case-insensitive boundary check)
        label_pattern = r'(?<!\w)' + re.escape(label.lower()) + r'(?!\w)'
        if re.search(label_pattern, slide_text.lower()):
            # Check if slide instead uses a metric from another row
            for other_idx, other_row in enumerate(all_table_rows):
                if other_idx == row_idx:
                    continue
                # Only rows of the same table (same headers) can be swapped with each other
                if list(other_row.keys()) != list(row.keys()):
                    continue
                other_vals = list(other_row.values())
                if len(other_vals) >= 2:
                    wrong_metric = other_vals[1]
                    wrong_pattern = r'(?<!\w)' + re.escape(wrong_metric.lower()) + r'(?!\w)'
                    correct_pattern = r'(?<!\w)' + re.escape(correct_metric.lower()) + r'(?!\w)'
                    # If wrong metric is present near the label and correct metric is NOT present
                    if re.search(wrong_pattern, slide_text.lower()) and not re.search(correct_pattern, slide_text.lower()):
                        issues.append({
                            "severity": "ERROR",
                            "code": "TABLE_PAIRING_MISMATCH",
                            "message": f"Table value mismatch: '{label}' is paired with '{wrong_metric}' from another row instead of source value '{correct_metric}'."
                        })

    # Header-to-column association check:
    # If slide text mentions a specific header name alongside a cell value,
    # verify that the header actually belongs to that cell's column.
    for row in table_rows:
        headers_list = list(row.keys())
        values_list = list(row.values())
        for col_idx, (hdr, val) in enumerate(row.items()):
            if not val or not hdr:
                continue
            val_pattern = r'(?<!\w)' + re.escape(val.lower()) + r'(?!\w)'
            if not re.search(val_pattern, slide_text.lower()):
                continue

            # Check if this metric is improperly paired with another column's header
            for other_idx, other_hdr in enumerate(headers_list):
                if other_idx == col_idx or len(other_hdr) < 4:
                    continue
                # If other header words appear right next to this value, and NOT next to other_val
                other_val = values_list[other_idx] if other_idx < len(values_list) else ""
                other_hdr_words = [w for w in re.findall(r'[a-zA-Z]+', other_hdr.lower()) if len(w) > 3]
                if not other_hdr_words:
                    continue
                other_key_phrase = " ".join(other_hdr_words[:2])
                phrase_near_val = re.search(re.escape(other_key_phrase) + r'[:\s—\-]+' + val_pattern, slide_text.lower()) or \
                                  re.search(val_pattern + r'\s+' + re.escape(other_key_phrase), slide_text.lower())
                if phrase_near_val and (not other_val or other_val.lower() not in slide_text.lower()):
                    issues.append({
                        "severity": "ERROR",
                        "code": "TABLE_HEADER_MISMATCH",
                        "message": f"Table header mismatch: metric '{val}' is paired with header '{other_hdr}' from column {other_idx+1} instead of its column header '{hdr}'."
                    })

    return issues
