"""Convert raw document blocks into numbered units."""

import re
from typing import List, Optional, Tuple
from pydantic import BaseModel
from .reader import RawDocument, Block
from ..validators.hedges import CAVEAT_CONNECTORS


class Unit(BaseModel):
    id: str  # e.g. "U001"
    kind: str  # "heading" | "paragraph" | "list_item" | "table_row"
    text: str
    section: Optional[str] = None


ABBREVIATIONS = (
    "e.g.", "i.e.", "mr.", "mrs.", "ms.", "dr.", "prof.",
    "u.s.", "u.k.", "inc.", "ltd.", "co.", "corp.", "etc.",
    "vs.", "jan.", "feb.", "mar.", "apr.", "jun.", "jul.", "aug.", "sep.", "sept.", "oct.", "nov.", "dec."
)


def _split_into_sentences(text: str) -> List[str]:
    """Split text into sentences without breaking on common abbreviations or numbers."""
    # Find potential sentence boundaries: period, exclamation mark, question mark followed by space
    raw_splits = re.split(r'([.!?]+\s+)', text)
    sentences: List[str] = []
    buffer = ""

    i = 0
    while i < len(raw_splits):
        part = raw_splits[i]
        sep = raw_splits[i+1] if i + 1 < len(raw_splits) else ""
        candidate = (buffer + part + sep).strip()

        # Check if candidate ends with an abbreviation
        words = part.lower().split()
        last_word = words[-1] if words else ""

        if any(last_word.endswith(abbr.rstrip('.')) for abbr in ABBREVIATIONS):
            # Do not split here; accumulate
            buffer = buffer + part + sep
        elif re.search(r'\d+\.$', part):  # Decimal or list number
            buffer = buffer + part + sep
        else:
            if candidate:
                sentences.append(candidate)
            buffer = ""
        i += 2

    if buffer.strip():
        sentences.append(buffer.strip())

    return sentences if sentences else [text]


def to_units(raw: RawDocument) -> Tuple[List[Unit], int]:
    """Convert a RawDocument into a list of numbered Units and return total word count.
    Blocks with kind="paragraph" and word count > 80 are split into sentence-level units.
    """
    units: List[Unit] = []
    counter = 1
    total_words = 0

    for block in raw.blocks:
        block_text = block.text.strip()
        if not block_text:
            continue

        words = block_text.split()
        total_words += len(words)

        if block.kind == "paragraph" and len(words) > 80:
            sentences = _split_into_sentences(block_text)
            merged_sentences: List[str] = []
            for s in sentences:
                s_clean = s.strip()
                if not s_clean:
                    continue
                # If s_clean starts with a caveat connector, do not split — keep with previous sentence
                starts_with_caveat = False
                lower_s = s_clean.lower()
                for c in CAVEAT_CONNECTORS:
                    if lower_s.startswith(c) or re.match(r'^(?:note[:\s]+|the\s+)?' + re.escape(c), lower_s):
                        starts_with_caveat = True
                        break

                if starts_with_caveat and merged_sentences:
                    merged_sentences[-1] = merged_sentences[-1] + " " + s_clean
                else:
                    merged_sentences.append(s_clean)

            for s in merged_sentences:
                units.append(
                    Unit(
                        id=f"U{counter:03d}",
                        kind=block.kind,
                        text=s,
                        section=block.section
                    )
                )
                counter += 1
        else:
            units.append(
                Unit(
                    id=f"U{counter:03d}",
                    kind=block.kind,
                    text=block_text,
                    section=block.section
                )
            )
            counter += 1

    return units, total_words
