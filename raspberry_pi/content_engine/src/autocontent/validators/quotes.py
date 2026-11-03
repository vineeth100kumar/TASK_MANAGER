"""Quote verification against unit text."""

from .normalize import norm


def verify_quote(quote: str, unit_text: str) -> bool:
    """Verify that quote is a strict substring of unit_text after normalization,
    and has between 3 and 60 words.
    """
    if not quote or not unit_text:
        return False
    words = quote.split()
    if len(words) < 3 or len(words) > 60:
        return False
    return norm(quote) in norm(unit_text)
