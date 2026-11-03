"""Text normalization for deterministic comparison. No fuzzy matching."""

import re

# Characters to replace
CURLY_DOUBLE_QUOTES = r'[\u201c\u201d\u00ab\u00bb\u201f\u201e]'
CURLY_SINGLE_QUOTES = r'[\u2018\u2019\u201a\u201b\u02bc\u02bb`]'
DASHES = r'[\u2013\u2014\u2011\u2212\u2012\u2015]'
ZERO_WIDTH = r'[\u200b\u200c\u200d\ufeff\u200e\u200f\u2060]'


def norm(text: str) -> str:
    """Normalize text strictly for exact substring and token checking:
    - Lowercase
    - Replace curly double quotes with straight "
    - Replace curly single quotes with straight '
    - Replace em/en/minus/non-breaking dashes with -
    - Remove zero-width characters
    - Collapse all whitespace to a single space
    - Strip leading/trailing whitespace
    """
    if not text:
        return ""
    s = text.lower()
    s = re.sub(ZERO_WIDTH, '', s)
    s = re.sub(CURLY_DOUBLE_QUOTES, '"', s)
    s = re.sub(CURLY_SINGLE_QUOTES, "'", s)
    s = re.sub(DASHES, '-', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()
