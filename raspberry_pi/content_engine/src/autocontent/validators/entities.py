"""Named entity and acronym validation."""

import re
from typing import List, Set
from . import ValidationIssue
from .normalize import norm

STOPLIST: Set[str] = {
    "i", "the", "a", "an", "and", "or", "of", "in", "to", "for",
    "on", "with", "by", "at", "from", "as", "is", "are", "was", "were",
    "be", "this", "that", "these", "those", "it", "its", "we", "our",
    "you", "your", "my", "he", "she", "they", "their", "his", "her",
    "key", "finding", "findings", "data", "overview", "summary", "notes", "report"
}


def extract_entities(text: str) -> Set[str]:
    """Find capitalized words that are not the first word of a sentence,
    plus ALL-CAPS tokens of 2+ letters (excluding stopwords).
    """
    if not text:
        return set()

    entities: Set[str] = set()

    # Split text into sentences / segments
    sentences = re.split(r'[.!?\n]+', text)
    for sentence in sentences:
        words = sentence.strip().split()
        if not words:
            continue
        # Check all-caps acronyms even if first word (e.g. "NASA announced", "AI tools")
        for i, raw_w in enumerate(words):
            # Clean punctuation from word edges
            w = re.sub(r'^[^\w]+|[^\w]+$', '', raw_w)
            if not w:
                continue
            lower_w = w.lower()
            if lower_w in STOPLIST:
                continue

            # Check if all-caps of 2+ letters
            if len(w) >= 2 and w.isupper() and w.isalpha():
                entities.add(lower_w)
            elif i > 0 and w[0].isupper() and w.isalpha():
                entities.add(lower_w)

    return entities


_SMALL_WORDS = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with", "is", "are", "not", "from", "per"}

# Ordinary English words a headline writer capitalises in a Title Case label ("Key Market Facts").
# Only these (or forms of words the source itself uses) are excused there; any other capitalised
# word, such as a company, product or person name, is still an entity that must be in the source.
COMMON_LABEL_WORDS: Set[str] = set("""
about above access act action actions advantage after age ahead all almost alone also always
amount analysis angle answer approach area areas average back bad balance base basics before
behind benefit benefits best better beyond big bigger biggest bill boom boost bottom brand breakdown
build building business businesses buy call can capital case cash catch cause change changes cheap
check choice clear clock close code cold come coming compare comparison competition context cost
costs count country crisis critical current customer customers cut cuts data deal deals decline
deep demand detail details difference different direction done down drive driver drivers early
easy economics economy edge effect end engine enter era every everything evidence example examples
expansion fact facts factor factors fail fast faster fear field fight figure figures final find
finding findings first fix floor focus follow for forward free from front full future gain gains gap
get gets give global goal goals going gold good great ground grow growing growth guide hard has have
here hidden high higher highlights hook how huge idea ideas impact important inside insight insights
is just key kind know large last late launch lead leader leaders learn lesson lessons less level
lever life like limit line list little local long look loss losses lot low lower made main major
make maker makers making many map margin margins market markets math matter matters measure meet
method metric metrics middle mistake mistakes model modern money more most move moves much must
need needs new next now number numbers offer old one only open opportunity opportunities option
options order other outlook own pace part path pattern pay people picture place plan play player
players playbook plus point points power price prices pricing problem problems profit profits
progress proof push quick race rate rates read real reality reason reasons recap recommendation
recommendations record result results return returns revenue rise rising risk risks road rule rules
run rush sales scale scene score secret see segment sell set shift short show side sign signal
simple size slow small smart snapshot space speed spend split stake stand start state stats status
step steps still stop story strategic strategy strength strong structure success supply sweet
take takeaway takeaways talk target targets test than that the thing things think this threat
ticking time tip tips today top total trade trend trends true truth turn type unit up upside use
value view volume wait want watch way ways what when where who why win window winner winners with
work works world worth year years you your
""".split())


def _stem(word: str) -> str:
    return word[:5] if len(word) >= 5 else word


def _is_ordinary_word(word: str, source_stems: Set[str]) -> bool:
    """True for a plain English word (a common label word or a form of a word the source uses,
    "grew"->no but "recommend"->"recommendations"), never for an unknown proper name."""
    return word in COMMON_LABEL_WORDS or (len(word) >= 5 and _stem(word) in source_stems)


def _title_case_label_words(text: str) -> Set[str]:
    """Lowercased words that are capitalised only because their line is a Title Case label
    ("Key Market Facts", "Cost Breakdown per Part"): a short line with no closing sentence
    punctuation where every non-small word starts with a capital."""
    words: Set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line[-1] in ".!?":
            continue
        tokens = [re.sub(r'^[^\w]+|[^\w]+$', '', t) for t in line.split()]
        tokens = [t for t in tokens if t and t.isalpha()]
        if not 2 <= len(tokens) <= 8:
            continue
        content = [t for t in tokens if t.lower() not in _SMALL_WORDS]
        if len(content) >= 2 and all(t[0].isupper() for t in content):
            words.update(t.lower() for t in content if not t.isupper())
    return words


def _clause_start_words(text: str) -> Set[str]:
    """Lowercased words capitalised only because they open a bullet or clause
    ("• Ways to compete", "...; Target drone and EV startups", "— Combine printing with..."),
    not because they are names."""
    return {m.group(1).lower() for m in re.finditer(r"(?:^|\n|[;:•—–])\s*([A-Z][a-z]+)", text)}


def check_entities(
    slide_text: str,
    cited_quotes_text: str,
    full_source_text: str
) -> List[ValidationIssue]:
    """Check each entity in slide_text:
    - in cited quotes: OK
    - only elsewhere in source: WARN
    - nowhere in source: ERROR (WARN for an ordinary word capitalised only by a Title Case label)
    """
    entities = extract_entities(slide_text)
    if not entities:
        return []

    norm_quote = norm(cited_quotes_text)
    norm_source = norm(full_source_text)

    issues: List[ValidationIssue] = []
    label_words = _title_case_label_words(slide_text) | _clause_start_words(slide_text)
    source_stems = {_stem(w) for w in re.findall(r"[a-z]+", norm_source) if len(w) >= 5}

    for ent in sorted(entities):
        pattern = r'(?:\b|\A)' + re.escape(ent) + r'(?:\b|\Z)'
        if re.search(pattern, norm_quote):
            continue
        elif re.search(pattern, norm_source):
            issues.append(
                ValidationIssue(
                    severity="WARN",
                    code="ENTITY_NOT_IN_CITED_QUOTE",
                    message=f"Entity '{ent}' appears in source document but not in cited quotes for this slide.",
                    offending_text=ent
                )
            )
        elif ent in label_words and _is_ordinary_word(ent, source_stems):
            issues.append(
                ValidationIssue(
                    severity="WARN",
                    code="TITLE_WORD_NOT_IN_SOURCE",
                    message=f"Title Case word '{ent}' does not appear in the source document.",
                    offending_text=ent
                )
            )
        else:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="ENTITY_NOT_IN_SOURCE",
                    message=f"Entity '{ent}' appears nowhere in the source document.",
                    offending_text=ent
                )
            )

    return issues
