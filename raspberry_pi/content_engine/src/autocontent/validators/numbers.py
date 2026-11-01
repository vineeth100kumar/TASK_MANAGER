"""Deterministic number validation with structured mentions and unit/class checking."""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Collection, List, Optional, Set, Tuple

from . import ValidationIssue
from .normalize import norm

CURRENCY_SYMBOLS = {'$', '€', '£', '₹'}

CANONICAL_CURRENCIES = {
    "$": "$", "usd": "$", "dollars": "$", "dollar": "$",
    "€": "€", "eur": "€", "euros": "€", "euro": "€",
    "£": "£", "gbp": "£", "pounds": "£", "pound": "£",
    "₹": "₹", "rs": "₹", "rs.": "₹", "inr": "₹", "rupees": "₹", "rupee": "₹",
}

MAGNITUDES = {
    "k": Decimal("1e3"),
    "thousand": Decimal("1e3"),
    "m": Decimal("1e6"),
    "million": Decimal("1e6"),
    "bn": Decimal("1e9"),
    "billion": Decimal("1e9"),
    "trillion": Decimal("1e12"),
    "lakh": Decimal("1e5"),
    "crore": Decimal("1e7"),
}

NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
    "million": 1000000, "billion": 1000000000, "trillion": 1000000000000,
    "dozen": 12
}

ORDINAL_WORDS = {
    "first": "1st", "second": "2nd", "third": "3rd", "fourth": "4th",
    "fifth": "5th", "sixth": "6th", "seventh": "7th", "eighth": "8th",
    "ninth": "9th", "tenth": "10th", "eleventh": "11th", "twelfth": "12th",
    "thirteenth": "13th", "fourteenth": "14th", "fifteenth": "15th",
    "sixteenth": "16th", "seventeenth": "17th", "eighteenth": "18th",
    "nineteenth": "19th", "twentieth": "20th"
}

MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"
)

YEAR_PREFIXES = ("in", "since", "by", "during", "from", "until", "to", "of", "fy")

STOP_NOUNS = {
    "of", "and", "or", "the", "a", "an", "in", "on", "at", "to",
    "for", "with", "by", "than", "is", "was", "are", "were"
}

PRONOUN_ONE_PRECEDING = {
    "no", "any", "every", "each", "the", "this", "that", "which",
    "another", "such", "a", "an", "at", "someone", "anyone", "everyone"
}

PRONOUN_ONE_FOLLOWING = {
    "of", "another", "who", "that", "idea", "thing", "way", "day"
}


@dataclass(frozen=True)
class NumMention:
    value: Decimal            # canonical numeric value, e.g. Decimal("64"), Decimal("1200000")
    cls: str                  # "percent" | "currency:<sym>" | "multiplier" | "ordinal" | "year" | "count"
    noun: Optional[str]       # only for cls == "count": lemma of the next word, else None
    raw: str                  # exact text matched, for error messages


def _clean_noun(word: str) -> Optional[str]:
    w = word.lower().strip(".,;:!?()[]{}\"'")
    if not w or not w.isalpha() or w in STOP_NOUNS:
        return None
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("es") and len(w) > 3:
        base = w[:-2]
        if base.endswith(("s", "x", "z", "ch", "sh")):
            return base
        return w[:-1]
    if w.endswith("s") and not w.endswith("ss") and len(w) > 2:
        return w[:-1]
    return w


def _get_next_noun(original_text: str, end_pos: int) -> Optional[str]:
    remaining = original_text[end_pos:].lstrip()
    if not remaining:
        return None
    if remaining[0] in ".,;:!?()[]{}\"'":
        return None
    words = []
    tokens = re.split(r"\s+", remaining[:80])
    for tok in tokens:
        clean = _clean_noun(tok)
        if clean:
            words.append(clean)
        else:
            break
        bare = tok.lower().strip(".,;:!?()[]{}\"'")
        # The first plural word is the head noun: "three founders reported that" -> founder
        if bare.endswith("s") and not bare.endswith("ss") and len(bare) > 3:
            break
        # A noun phrase never runs past punctuation ("10 paying customers. Three ...")
        if len(words) >= 3 or tok[-1] in ".,;:!?)]}\"'":
            break
    if not words:
        return None
    return words[-1]



def _check_magnitude(original_text: str, end_pos: int) -> Tuple[Decimal, int]:
    """Check for magnitude multiplier immediately following number."""
    remaining = original_text[end_pos:]
    # plural forms ("₹10 Crores", "5.2 Lakhs") carry the same multiplier as the singular
    match = re.match(r"^\s*(thousand|million|billion|trillion|lakh|crore|bn|k|m)s?\b", remaining, re.IGNORECASE)
    if match:
        mag_word = match.group(1).lower()
        multiplier = MAGNITUDES.get(mag_word, Decimal("1"))
        return multiplier, end_pos + match.end()
    return Decimal("1"), end_pos


def extract_number_mentions(text: str) -> List[NumMention]:
    """Extract structured numeric mentions from text following deterministic order.
    Consumes matched spans so nothing is counted twice.
    """
    if not text:
        return []

    # Separate quotes/fields are joined with newlines; mark the break so a count's
    # noun is never taken from the next quote ("...: 7\nPricing change" is not "7 changes").
    s_orig = norm(text.replace("\n", " ; "))
    chars = list(s_orig)
    mentions: List[NumMention] = []

    def mask_span(start: int, end: int):
        for i in range(start, end):
            chars[i] = " "

    def get_working() -> str:
        return "".join(chars)

    # 1. Percent: (\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b|per\s*cent\b) and number-word + percent
    rx_percent = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\s*(%|percent\b|per\s*cent\b)", re.IGNORECASE)
    for m in list(rx_percent.finditer(get_working())):
        raw_val = m.group(1).replace(",", "")
        try:
            val = Decimal(raw_val)
            mentions.append(NumMention(value=val, cls="percent", noun=None, raw=m.group(0)))
            mask_span(m.start(), m.end())
        except InvalidOperation:
            pass

    # Number words + percent (e.g. "twenty percent", "sixty four percent")
    num_word_pat = r"(?:" + "|".join(NUMBER_WORDS.keys()) + r")"
    rx_word_pct = re.compile(rf"\b({num_word_pat}(?:\s+{num_word_pat})?)\s*(%|percent\b|per\s*cent\b)", re.IGNORECASE)
    for m in list(rx_word_pct.finditer(get_working())):
        words = m.group(1).lower().split()
        val = Decimal(sum(NUMBER_WORDS.get(w, 0) for w in words))
        mentions.append(NumMention(value=val, cls="percent", noun=None, raw=m.group(0)))
        mask_span(m.start(), m.end())

    # 2. Currency: symbol before or currency word after
    rx_curr_pre = re.compile(r"([$€£₹]|\brs\.?|\binr\b|\busd\b|\beur\b|\bgbp\b)\s*(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)
    for m in list(rx_curr_pre.finditer(get_working())):
        sym_match = m.group(1).lower()
        canonical_sym = CANONICAL_CURRENCIES.get(sym_match, "$")
        val = Decimal(m.group(2).replace(",", ""))
        mag_mult, new_end = _check_magnitude(s_orig, m.end())
        val = val * mag_mult
        raw_text = s_orig[m.start():new_end]
        mentions.append(NumMention(value=val, cls=f"currency:{canonical_sym}", noun=None, raw=raw_text))
        mask_span(m.start(), new_end)

    rx_curr_post = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(dollars|rupees|euros|pounds|dollar|rupee|euro|pound)\b", re.IGNORECASE)
    for m in list(rx_curr_post.finditer(get_working())):
        word_match = m.group(2).lower()
        canonical_sym = CANONICAL_CURRENCIES.get(word_match, "$")
        val = Decimal(m.group(1).replace(",", ""))
        mag_mult, new_end = _check_magnitude(s_orig, m.end())
        val = val * mag_mult
        raw_text = s_orig[m.start():new_end]
        mentions.append(NumMention(value=val, cls=f"currency:{canonical_sym}", noun=None, raw=raw_text))
        mask_span(m.start(), new_end)

    # 4. Multiplier: (\d+(?:\.\d+)?)\s*(?:x|×|times)\b
    # "×" is not a word character, so it takes no \b after it ("a 10× margin")
    rx_mult = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:x\b|×|times\b)", re.IGNORECASE)
    for m in list(rx_mult.finditer(get_working())):
        val = Decimal(m.group(1))
        mentions.append(NumMention(value=val, cls="multiplier", noun=None, raw=m.group(0)))
        mask_span(m.start(), m.end())

    # 5. Digit ordinals: \b(\d+)(?:st|nd|rd|th)\b
    rx_ord = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b", re.IGNORECASE)
    for m in list(rx_ord.finditer(get_working())):
        val = Decimal(m.group(1))
        mentions.append(NumMention(value=val, cls="ordinal", noun=None, raw=m.group(0)))
        mask_span(m.start(), m.end())

    # 6. Year: 4-digit number from 1900 to 2100 preceded by month or year prefix, or followed by punctuation/end
    rx_year = re.compile(r"\b(19\d\d|20\d\d|2100)\b")
    for m in list(rx_year.finditer(get_working())):
        val = Decimal(m.group(1))
        start_idx = m.start()
        end_idx = m.end()

        # Check preceding context in s_orig
        pre_text = s_orig[:start_idx].rstrip()
        pre_words = re.findall(r"\b[a-zA-Z]+\b", pre_text)
        last_word = pre_words[-1].lower() if pre_words else ""

        is_year = False
        if last_word in MONTHS or last_word in YEAR_PREFIXES:
            is_year = True
        else:
            post_text = s_orig[end_idx:].lstrip()
            if not post_text or post_text[0] in ".,;:!?()[]{}\"'":
                is_year = True

        if is_year:
            mentions.append(NumMention(value=val, cls="year", noun=None, raw=m.group(0)))
            mask_span(start_idx, end_idx)

    # 7. Remaining digit numbers
    rx_digits = re.compile(r"\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b")
    for m in list(rx_digits.finditer(get_working())):
        raw_val = m.group(1).replace(",", "")
        try:
            val = Decimal(raw_val)
            mag_mult, new_end = _check_magnitude(s_orig, m.end())
            val = val * mag_mult
            raw_text = s_orig[m.start():new_end]
            noun = _get_next_noun(s_orig, new_end)
            mentions.append(NumMention(value=val, cls="count", noun=noun, raw=raw_text))
            mask_span(m.start(), new_end)
        except InvalidOperation:
            pass

    # 8. Number words: zero..twenty, thirty..ninety, hundred, thousand, etc.
    # Exclude pronoun 'one' and ordinals
    rx_words = re.compile(rf"\b({num_word_pat})\b", re.IGNORECASE)
    for m in list(rx_words.finditer(get_working())):
        w_lower = m.group(1).lower()
        start_idx = m.start()
        end_idx = m.end()

        if w_lower == "one":
            # Check pronoun exclusions (D7)
            pre_text = s_orig[:start_idx].rstrip()
            pre_words = re.findall(r"\b[a-zA-Z]+\b", pre_text)
            prev_word = pre_words[-1].lower() if pre_words else ""

            post_text = s_orig[end_idx:].lstrip()
            post_words = re.findall(r"\b[a-zA-Z]+\b", post_text)
            next_word = post_words[0].lower() if post_words else ""

            is_pre_pronoun = prev_word in PRONOUN_ONE_PRECEDING
            is_post_pronoun = (
                not post_text
                or post_text[0] in ".,;:!?()[]{}\"'"
                or next_word in PRONOUN_ONE_FOLLOWING
                or post_text.lower().startswith("of the")
            )
            if is_pre_pronoun or is_post_pronoun:
                mask_span(start_idx, end_idx)
                continue

        val = Decimal(NUMBER_WORDS[w_lower])
        mag_mult, new_end = _check_magnitude(s_orig, end_idx)
        val = val * mag_mult
        raw_text = s_orig[start_idx:new_end]
        noun = _get_next_noun(s_orig, new_end)
        mentions.append(NumMention(value=val, cls="count", noun=noun, raw=raw_text))
        mask_span(start_idx, new_end)

    return mentions


def extract_number_tokens(text: str) -> Set[str]:
    """Preserved for backwards compatibility with tests."""
    mentions = extract_number_mentions(text)
    tokens: Set[str] = set()
    for m in mentions:
        # Include numeric string
        int_val = int(m.value) if m.value == int(m.value) else None
        tokens.add(str(int_val if int_val is not None else m.value))
        if m.cls == "percent":
            tokens.add("%")
        elif m.cls.startswith("currency:"):
            tokens.add(m.cls.split(":", 1)[1])
        elif m.cls == "ordinal":
            tokens.add(f"{m.value}th")
        if m.raw:
            tokens.add(m.raw.lower())
    return tokens


def check_numbers(
    slide_text: str,
    cited_quotes_text: str,
    allowed_derived_counts: Optional[Collection[int]] = None
) -> List[ValidationIssue]:
    """Check that every number mention in slide_text matches cited_quotes_text
    in value AND unit class.
    """
    slide_mentions = extract_number_mentions(slide_text)
    quote_mentions = extract_number_mentions(cited_quotes_text)

    allowed_set = set(allowed_derived_counts) if allowed_derived_counts else set()
    issues: List[ValidationIssue] = []

    for s in slide_mentions:
        matching_value_quotes = [q for q in quote_mentions if q.value == s.value]

        # 1. Check if value exists at all
        if not matching_value_quotes:
            if s.cls == "count" and s.value == int(s.value) and int(s.value) in allowed_set:
                # Allowed derived list count
                continue
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="UNSUPPORTED_NUMBER",
                    message=f"Number '{s.raw}' (value {s.value}) in slide text is not in cited quotes.",
                    offending_text=s.raw
                )
            )
            continue

        # 2. Check if unit class matches (treat 'year' and 'count' as mutually compatible)
        def is_class_compatible(c1: str, c2: str) -> bool:
            if c1 == c2:
                return True
            if {c1, c2} == {"year", "count"}:
                return True
            return False

        matching_class_quotes = [q for q in matching_value_quotes if is_class_compatible(s.cls, q.cls)]

        if not matching_class_quotes:
            q_first = matching_value_quotes[0]
            desc = q_first.cls
            if q_first.noun:
                desc += f" ({q_first.noun})"
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="NUMBER_UNIT_MISMATCH",
                    message=(
                        f"Slide has '{s.raw}' as {s.cls} but the source only has '{s.value}' as a {desc}."
                    ),
                    offending_text=s.raw
                )
            )
            continue

        # 3. If count, check if noun changed
        if s.cls == "count" and s.noun:
            all_nouns_differ = all(q.noun and q.noun != s.noun for q in matching_class_quotes if q.noun is not None)
            if all_nouns_differ and any(q.noun for q in matching_class_quotes):
                q_nouns = ", ".join(repr(q.noun) for q in matching_class_quotes if q.noun)
                issues.append(
                    ValidationIssue(
                        severity="WARN",
                        code="NUMBER_NOUN_CHANGED",
                        message=f"Slide has count {s.value} with noun '{s.noun}', but source cites {q_nouns}.",
                        offending_text=s.raw
                    )
                )

    return issues


# "$65 billion to $66 billion", "19% to 21%", "₹500 - ₹1,000 Crore", "10-12%" (not "FY24–25", "2025-26")
_RANGE_NUM = r"[$€£₹]?\s?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|billion|million|crore|lakh|thousand|bn|mn|cr|k)?"
RANGE_RE = re.compile(r"(?<![\w.])(" + _RANGE_NUM + r")\s*(?:to|-|–|—)\s*(" + _RANGE_NUM + r")(?!\w)(?!\.\d)", re.I)


def _digits(s: str) -> str:
    m = re.search(r"\d[\d,]*(?:\.\d+)?", s)
    return m.group(0).replace(",", "") if m else ""


def find_ranges(text: str) -> List[Tuple[str, str, int, int]]:
    """(low, high, start, end) for every numeric range in the text, skipping year spans."""
    out = []
    for m in RANGE_RE.finditer(text):
        low, high = m.group(1).strip(), m.group(2).strip()
        before = text[max(0, m.start() - 3):m.start()].lower()
        if re.search(r"(fy|q[1-4]|h[12])\s?$", before):
            continue
        if re.fullmatch(r"(?:19|20)\d{2}", _digits(low)) and not re.search(r"[$€£₹%]", m.group(0)):
            continue
        out.append((low, high, m.start(), m.end()))
    return out


def check_ranges(slide_text: str, cited_quotes_text: str) -> List[ValidationIssue]:
    """ERROR 'RANGE_HALF' when the slide uses one end of a range from the source without the
    other ("$65 billion" from "$65 billion to $66 billion"): half a range is a new, firmer number."""
    issues: List[ValidationIssue] = []
    slide_digits = [d.replace(",", "") for d in re.findall(r"\d[\d,]*(?:\.\d+)?", slide_text)]
    quote_digits = [d.replace(",", "") for d in re.findall(r"\d[\d,]*(?:\.\d+)?", cited_quotes_text)]
    ranges = find_ranges(cited_quotes_text)
    in_ranges = [d for low, high, _, _ in ranges for d in (_digits(low), _digits(high))]
    for low, high, _, _ in ranges:
        lo, hi = _digits(low), _digits(high)
        if lo == hi:
            continue
        for kept, lost, kept_raw in ((lo, hi, low), (hi, lo, high)):
            # Only when that number appears in the quotes solely as part of a range
            if kept in slide_digits and lost not in slide_digits and quote_digits.count(kept) == in_ranges.count(kept):
                issues.append(ValidationIssue(
                    severity="ERROR", code="RANGE_HALF",
                    message=f"slide uses '{kept_raw}' from the range '{low} to {high}' without its other end",
                    offending_text=kept_raw))
                break
    return issues
