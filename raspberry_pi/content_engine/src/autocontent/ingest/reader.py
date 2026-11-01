"""Document reader for docx, pdf, txt, and Markdown (.md, .markdown) formats."""

from pathlib import Path
import re
from typing import List, Literal, Optional
from pydantic import BaseModel


class Block(BaseModel):
    kind: Literal["heading", "paragraph", "list_item", "table_row"]
    text: str
    section: Optional[str] = None
    level: Optional[int] = None  # heading level (1 for "#", 2 for "##", ...) when known


class RawDocument(BaseModel):
    title: Optional[str] = None
    blocks: List[Block]


def _clean_whitespace(text: str) -> str:
    """Normalize internal whitespace while keeping exact characters and punctuation."""
    return re.sub(r'[ \t\r\f\v]+', ' ', text).strip()


# Headings after which a document is only references, not content
_REFERENCE_HEADINGS = re.compile(r'^(works cited|references|sources|bibliography|citations|notes and references)$', re.I)


def _strip_md_inline(text: str) -> str:
    """Remove Markdown inline markup and citation footnote markers, keeping the words exactly.

    "**Zebronics:** grew 21%1." -> "Zebronics: grew 21%."  Footnote digits glued to a word
    ("Tamil Nadu5", "term40", "'40") would otherwise be read as real numbers.
    """
    s = re.sub(r'[!]?\[([^\]]*)\]\([^)]*\)', r'\1', text)         # links and images -> their text
    s = re.sub(r'\\([\\`*_{}\[\]()#+\-.!$|>~&])', r'\1', s)      # \$ -> $, R\&D -> R&D
    s = re.sub(r'`([^`]+)`', r'\1', s)                              # `code`
    s = re.sub(r'~~(.+?)~~', r'\1', s)                               # ~~strikethrough~~
    s = re.sub(r'(\*\*|__)(.+?)\1', r'\2', s)                       # **bold**
    s = re.sub(r'(^|[^\w*])\*(\S(?:.*?\S)?)\*(?=\W|$)', r'\1\2', s)  # *italic*
    s = re.sub(r'(?<!\w)_(\S(?:.*?\S)?)_(?!\w)', r'\1', s)          # _italic_ (not snake_case)
    s = s.replace('**', '')
    # Citation markers: digits glued to the end of a lowercase word, or after %, ), quotes, or a
    # sentence period that follows a word ("sector1", "21%1", "'A1'40", "growth.12 Next").
    s = re.sub(r'(?<=[a-z%)\]\'’”])\d{1,3}(?:,\d{1,3})*(?=[\s.,;:)]|$)', '', s)
    s = re.sub(r'(?<=[a-z]\.)\d{1,3}(?:,\d{1,3})*(?=\s|$)', '', s)
    # "FY2540" is FY25 + footnote 40; a real fiscal year is FY25 or FY2025
    s = re.sub(r'\bFY(\d{2})(\d{1,3})(?=[\s.,;:)]|$)', lambda m: m.group(0) if (m.group(1) == '20' and len(m.group(2)) == 2) else 'FY' + m.group(1), s)
    # "2025-2628" is the range 2025-26 + footnote 28; "2025-2026" is kept
    s = re.sub(r'\b((?:19|20)\d{2})-(\d{3,7})(?=[\s.,;:)]|$)', _year_range_without_footnote, s)
    # "Q2 202651" is Q2 2026 + footnote 51 (only right after a quarter, half, month or "in"/"by")
    s = re.sub(r'(\b(?:Q[1-4]|H[12]|in|by|since|until|through|early|late|mid|January|February|March|April|May|June|'
               r'July|August|September|October|November|December)\s)((?:19|20)\d{2})\d{1,3}(?=[\s.,;:)]|$)', r'\1\2', s)
    return s


def _year_range_without_footnote(m: "re.Match[str]") -> str:
    start, tail = m.group(1), m.group(2)
    if len(tail) == 4 and tail.startswith(("19", "20")):
        return m.group(0)
    end = tail[:4] if len(tail) > 4 and tail.startswith(("19", "20")) else tail[:2]
    return f"{start}-{end}"


def _md_table_rows(lines: List[str]) -> Optional[List[str]]:
    """Convert a Markdown pipe table into "Header: value | Header: value" rows, else None."""
    if len(lines) < 3 or not all(l.startswith("|") for l in lines):
        return None
    if not re.match(r'^\|\s*:?-{3,}', lines[1]):
        return None

    def cells(line: str) -> List[str]:
        return [_clean_whitespace(_strip_md_inline(c)) for c in line.strip().strip("|").split("|")]

    headers = cells(lines[0])
    rows = []
    for line in lines[2:]:
        parts = []
        for idx, cell in enumerate(cells(line)):
            if not cell:
                continue
            hdr = headers[idx] if idx < len(headers) and headers[idx] else f"Column {idx+1}"
            parts.append(f"{hdr}: {cell}")
        if parts:
            rows.append(" | ".join(parts))
    return rows


MD_EXTENSIONS = (".md", ".markdown")

# Emoji and pictographs (not letters of any script): slide text never shows them, and as bullet
# markers ("🔹 Space: ...") they hide that a line is a list item.
_EMOJI = re.compile(
    '[🀀-🫿←-⇿⌀-⏿■-◿☀-➿'
    '⬀-⯿️‍⃣]+')
# Carousel scripts and content plans: "## 🚀 SLIDE 1: The Hook", "Instagram Carousel: <title>"
_SCRIPT_HEADING_PREFIX = re.compile(
    r'^(?:(?:slide|card|frame|page)\s*\d+\s*(?:[:.)\-–—]\s*|$)|'
    r'(?:instagram|linkedin|ig)?\s*(?:carousel|post|thread)(?:\s+(?:script|plan|draft|content))?\s*[:\-–—]\s*)', re.I)
# "[Visual]", "**[Graph Type: Bar Chart]**", "[Headline]": production notes of a post script.
_SCRIPT_MARKER = re.compile(r'^\[\s*([A-Za-z][A-Za-z \-/]*?)\s*(?::[^\]]*)?\]\s*(.*)$')
# Markers whose text is slide copy to keep; any other marker (Visual, Graph Type, Swipe Indicator,
# Call to Action, Image, Design...) is a design or posting instruction, not content.
_SCRIPT_COPY_MARKERS = {"headline", "sub-headline", "subheadline", "sub headline", "body", "body text",
                        "text", "copy", "hook", "point", "points", "key point", "takeaway", "stat"}
_SOURCE_LABEL = re.compile(r'^(?:sources?|references?|citations?)\s*:?\s*$', re.I)


def _strip_emoji(text: str) -> str:
    return _clean_whitespace(_EMOJI.sub(' ', text))


def _clean_md_heading(text: str) -> str:
    """"🚀 SLIDE 1: The Hook" -> "The Hook"; "Instagram Carousel: The Gold Rush" -> "The Gold Rush"."""
    text = _strip_emoji(text)
    stripped = _SCRIPT_HEADING_PREFIX.sub('', text, count=1).strip()
    return stripped or text

_MD_HEADING = re.compile(r'^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$')
_MD_LIST_ITEM = re.compile(r'^(?:[-*+•]|\d{1,3}[.)])\s+(.*)$')
_MD_RULE = re.compile(r'^(?:[-*_]\s*){3,}$')


def _read_md(path: Path) -> RawDocument:
    """Read Markdown line by line so headings, list items and table rows stay separate blocks
    even when no blank line separates them from the text around them."""
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        lines = f.read().splitlines()

    blocks: List[Block] = []
    title: Optional[str] = None
    section: Optional[str] = None
    para: List[str] = []
    item: Optional[List[str]] = None
    table: List[str] = []
    fence: Optional[str] = None
    skipping = False  # inside a design note ("[Visual] ...") or a per-slide source list

    def inline(parts: List[str]) -> str:
        return _strip_emoji(_strip_md_inline(" ".join(parts)))

    def flush_para() -> None:
        if para:
            text = inline(para)
            if text:
                blocks.append(Block(kind="paragraph", text=text, section=section))
            para.clear()

    def flush_item() -> None:
        nonlocal item
        if item:
            text = inline(item)
            if text:
                blocks.append(Block(kind="list_item", text=text, section=section))
        item = None

    def flush_table() -> None:
        if not table:
            return
        rows = _md_table_rows(table)
        if rows is None:  # pipes but not a real table: keep it as text
            para.extend(table)
            flush_para()
        else:
            blocks.extend(Block(kind="table_row", text=r, section=section) for r in rows)
        table.clear()

    def flush_all() -> None:
        flush_table()
        flush_para()
        flush_item()

    def add_heading(text: str, level: int) -> bool:
        """Add a heading; False when it starts the bibliography (stop reading)."""
        nonlocal title, section, skipping
        flush_all()
        skipping = False
        text = _clean_md_heading(_strip_md_inline(text))
        if not text:
            return True
        if _REFERENCE_HEADINGS.match(text):
            return False
        if not title and level == 1:
            title = text
        blocks.append(Block(kind="heading", text=text, section=section, level=level))
        section = text
        return True

    for raw in lines:
        stripped = raw.strip()
        # Fenced code blocks are not prose; skip them
        fence_match = re.match(r'^(`{3,}|~{3,})', stripped)
        if fence:
            if fence_match and fence_match.group(1)[0] == fence[0] and len(fence_match.group(1)) >= len(fence):
                fence = None
            continue
        if fence_match:
            flush_all()
            fence = fence_match.group(1)
            continue

        # Blockquote text is kept without its "> " marker (reports often put whole lists in quotes)
        stripped = re.sub(r'^(?:>\s*)+', '', stripped).strip()
        if table and not stripped.startswith("|"):
            flush_table()
        if not stripped:
            flush_para()
            flush_item()
            continue
        if stripped.startswith("|"):
            flush_para()
            flush_item()
            table.append(stripped)
            continue

        # Setext headings: a single text line underlined with === or ---
        if len(para) == 1 and item is None and re.match(r'^(=+|-+)$', stripped):
            if not add_heading(para.pop(), 1 if stripped[0] == "=" else 2):
                break
            continue
        if _MD_RULE.match(stripped):
            flush_all()
            skipping = False
            continue

        m = _MD_HEADING.match(stripped)
        if m:
            if not add_heading(m.group(2), len(m.group(1))):
                break  # everything after "Works cited" is the bibliography
            continue
        if not blocks and not para and stripped.lower().startswith("title:"):
            if not add_heading(stripped[6:], 1):
                break
            continue

        # Post-script scaffolding: "[Visual]" notes and "Source:" lists are not slide content;
        # "[Headline]"/"[Body Text]" just label the copy that follows.
        bare = _clean_whitespace(_strip_md_inline(stripped))
        marker = _SCRIPT_MARKER.match(bare)
        if marker:
            flush_all()
            skipping = marker.group(1).strip().lower() not in _SCRIPT_COPY_MARKERS
            stripped = marker.group(2).strip()
            if not stripped:
                continue
        elif _SOURCE_LABEL.match(bare):
            flush_all()
            skipping = True
            continue
        if skipping:
            continue

        # A line led by an emoji bullet ("🔹 Space: ...", "✅ Print speeds ...") is a list item
        if _EMOJI.match(stripped) and _strip_emoji(stripped):
            flush_para()
            flush_item()
            item = [_EMOJI.sub(' ', stripped, count=1).strip()]
            continue

        m = _MD_LIST_ITEM.match(stripped)
        if m:
            flush_para()
            flush_item()
            item = [m.group(1)]
            continue
        if item is not None:
            item.append(stripped)  # wrapped or indented continuation of the list item
        else:
            para.append(stripped)

    flush_all()
    return RawDocument(title=title, blocks=blocks)


def _read_txt_md(path: Path) -> RawDocument:
    if path.suffix.lower() in MD_EXTENSIONS:
        return _read_md(path)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    blocks: List[Block] = []
    title: Optional[str] = None
    current_section: Optional[str] = None

    raw_paragraphs = [p.strip() for p in re.split(r'\n\s*\n', content) if p.strip()]

    for p in raw_paragraphs:
        lines = [line.strip() for line in p.splitlines() if line.strip()]
        if not lines:
            continue

        first_line = lines[0]
        # Check for explicit Title: or # header
        if first_line.lower().startswith("title:"):
            title_text = _clean_whitespace(first_line[6:])
            if not title:
                title = title_text
            blocks.append(Block(kind="heading", text=title_text, section=None))
            current_section = title_text
            remaining_lines = lines[1:]
            if remaining_lines:
                combined = _clean_whitespace(" ".join(remaining_lines))
                blocks.append(Block(kind="paragraph", text=combined, section=current_section))
            continue

        if first_line.startswith("#"):
            heading_text = _clean_whitespace(first_line.lstrip("# "))
            if not title and first_line.startswith("# "):
                title = heading_text
            blocks.append(Block(kind="heading", text=heading_text, section=current_section))
            current_section = heading_text
            remaining_lines = lines[1:]
            if remaining_lines:
                combined = _clean_whitespace(" ".join(remaining_lines))
                blocks.append(Block(kind="paragraph", text=combined, section=current_section))
            continue

        if first_line.lower().startswith("heading:"):
            heading_text = _clean_whitespace(first_line[8:])
            blocks.append(Block(kind="heading", text=heading_text, section=current_section))
            current_section = heading_text
            remaining_lines = lines[1:]
            if remaining_lines:
                combined = _clean_whitespace(" ".join(remaining_lines))
                blocks.append(Block(kind="paragraph", text=combined, section=current_section))
            continue

        # Check for table notation: "Table: Col1 | Col2"
        if first_line.lower().startswith("table:"):
            # The remaining lines are rows
            header_line = _clean_whitespace(first_line[6:])
            headers = [h.strip() for h in header_line.split("|")]
            for row_line in lines[1:]:
                row_cells = [c.strip() for c in row_line.split("|")]
                row_parts = []
                for idx, cell in enumerate(row_cells):
                    if not cell:
                        continue
                    header_label = headers[idx] if idx < len(headers) else f"Column {idx+1}"
                    row_parts.append(f"{header_label}: {cell}")
                if row_parts:
                    blocks.append(Block(kind="table_row", text=" | ".join(row_parts), section=current_section))
            continue

        # Check for list items
        if any(first_line.startswith(prefix) for prefix in ("- ", "* ", "• ")) or re.match(r'^\d+\.\s', first_line):
            for line in lines:
                clean_item = re.sub(r'^(?:[-*•]|\d+\.)\s*', '', line)
                blocks.append(Block(kind="list_item", text=_clean_whitespace(clean_item), section=current_section))
            continue

        # Regular paragraph
        combined = _clean_whitespace(" ".join(lines))
        blocks.append(Block(kind="paragraph", text=combined, section=current_section))

    return RawDocument(title=title, blocks=blocks)


def _read_docx(path: Path) -> RawDocument:
    import docx
    from docx.text.paragraph import Paragraph
    from docx.table import Table

    doc = docx.Document(path)
    blocks: List[Block] = []
    title: Optional[str] = None
    current_section: Optional[str] = None

    for child in doc.element.body:
        if child.tag.endswith('p'):
            p = Paragraph(child, doc)
            text = _clean_whitespace(p.text)
            if not text:
                continue

            style_name = p.style.name.lower() if p.style else ""
            if "title" in style_name:
                if not title:
                    title = text
                blocks.append(Block(kind="heading", text=text, section=None))
                current_section = text
            elif "heading" in style_name:
                blocks.append(Block(kind="heading", text=text, section=current_section))
                current_section = text
            elif "list" in style_name or "bullet" in style_name:
                blocks.append(Block(kind="list_item", text=text, section=current_section))
            else:
                blocks.append(Block(kind="paragraph", text=text, section=current_section))

        elif child.tag.endswith('tbl'):
            table = Table(child, doc)
            if not table.rows:
                continue

            headers: List[str] = []
            start_row = 0
            first_row_cells = [cell.text.strip() for cell in table.rows[0].cells]

            # Assume first row is header
            headers = [_clean_whitespace(c) for c in first_row_cells]
            start_row = 1

            for row in table.rows[start_row:]:
                cells = [cell.text.strip() for cell in row.cells]
                # Skip duplicate cells across merged columns
                unique_cells = []
                seen_cells = set()
                for c in cells:
                    clean_c = _clean_whitespace(c)
                    if clean_c and clean_c not in seen_cells:
                        unique_cells.append(clean_c)
                        seen_cells.add(clean_c)

                row_parts = []
                for idx, cell_text in enumerate(cells):
                    clean_val = _clean_whitespace(cell_text)
                    if not clean_val:
                        continue
                    hdr = headers[idx] if idx < len(headers) and headers[idx] else f"Column {idx+1}"
                    row_parts.append(f"{hdr}: {clean_val}")

                # Avoid duplicate pairings from merged cell representation
                deduped_parts = []
                for p_part in row_parts:
                    if p_part not in deduped_parts:
                        deduped_parts.append(p_part)

                if deduped_parts:
                    blocks.append(Block(kind="table_row", text=" | ".join(deduped_parts), section=current_section))

    return RawDocument(title=title, blocks=blocks)


def _read_pdf(path: Path) -> RawDocument:
    import pdfplumber

    blocks: List[Block] = []
    title: Optional[str] = None
    current_section: Optional[str] = None

    with pdfplumber.open(path) as pdf:
        num_pages = len(pdf.pages)
        page_lines: List[List[str]] = []
        page_tables: List[List[List[List[Optional[str]]]]] = []

        # 1. Collect all lines and tables
        line_occurrences: dict[str, int] = {}
        all_table_cell_texts: set[str] = set()

        for page in pdf.pages:
            tables = page.extract_tables() or []
            page_tables.append(tables)
            for tbl in tables:
                for row in tbl:
                    for cell in row:
                        if cell:
                            all_table_cell_texts.add(_clean_whitespace(cell).lower())

            raw_text = page.extract_text() or ""
            lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
            page_lines.append(lines)
            for line in set(lines):
                line_occurrences[line] = line_occurrences.get(line, 0) + 1

        # 2. Process each page
        for p_idx, lines in enumerate(page_lines):
            # Process tables on this page first or interleaved
            tables = page_tables[p_idx]
            for tbl in tables:
                if not tbl:
                    continue
                headers = [_clean_whitespace(c or "") for c in tbl[0]]
                for row in tbl[1:]:
                    row_parts = []
                    for idx, cell in enumerate(row):
                        clean_val = _clean_whitespace(cell or "")
                        if not clean_val:
                            continue
                        hdr = headers[idx] if idx < len(headers) and headers[idx] else f"Column {idx+1}"
                        row_parts.append(f"{hdr}: {clean_val}")
                    if row_parts:
                        blocks.append(Block(kind="table_row", text=" | ".join(row_parts), section=current_section))

            # Filter out headers/footers (>50% pages) and bare page numbers
            filtered_lines: List[str] = []
            for line in lines:
                clean_l = _clean_whitespace(line)
                if not clean_l:
                    continue
                # Bare page number or "Page N" / "Page N of M"
                if re.match(r'^(page\s+\d+(\s+(of|/)\s+\d+)?|\d+)$', clean_l, re.IGNORECASE):
                    continue
                # Repeats across > 50% of pages
                if num_pages > 1 and line_occurrences.get(line, 0) > (num_pages * 0.5):
                    continue
                # Avoid line if it's identical to a table cell
                if clean_l.lower() in all_table_cell_texts:
                    continue
                filtered_lines.append(clean_l)

            # De-hyphenate across lines ("commu-\nnication" -> "communication")
            merged_lines: List[str] = []
            i = 0
            while i < len(filtered_lines):
                cur = filtered_lines[i]
                if cur.endswith('-') and i + 1 < len(filtered_lines):
                    # Check if next line starts with lowercase
                    next_l = filtered_lines[i+1]
                    cur = cur[:-1] + next_l
                    i += 2
                    merged_lines.append(cur)
                else:
                    merged_lines.append(cur)
                    i += 1

            # Group into paragraphs or detect headings
            # Heading heuristic: short (<= 8 words or <= 50 chars), no final punctuation (. ? ! :)
            j = 0
            while j < len(merged_lines):
                line = merged_lines[j]
                words = line.split()
                is_heading_candidate = (
                    len(words) <= 8
                    and len(line) <= 50
                    and not line.endswith(('.', '?', '!', ':'))
                    and (j + 1 < len(merged_lines))
                )

                if is_heading_candidate:
                    if not title and len(blocks) == 0:
                        title = line
                    blocks.append(Block(kind="heading", text=line, section=current_section))
                    current_section = line
                    j += 1
                else:
                    # Merge consecutive non-heading lines into paragraph
                    para_lines = [line]
                    j += 1
                    while j < len(merged_lines):
                        nxt = merged_lines[j]
                        nxt_words = nxt.split()
                        if (len(nxt_words) <= 8 and len(nxt) <= 50 and not nxt.endswith(('.', '?', '!', ':'))):
                            break
                        para_lines.append(nxt)
                        j += 1
                    para_text = _clean_whitespace(" ".join(para_lines))
                    if para_text:
                        blocks.append(Block(kind="paragraph", text=para_text, section=current_section))

    return RawDocument(title=title, blocks=blocks)


def read_document(path: str | Path) -> RawDocument:
    """Read a document from disk (.docx, .pdf, .txt, .md, .markdown).
    Raises ValueError if fewer than 40 words extracted.
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = file_path.suffix.lower()
    if ext == ".docx":
        raw = _read_docx(file_path)
    elif ext == ".pdf":
        raw = _read_pdf(file_path)
    elif ext == ".txt" or ext in MD_EXTENSIONS:
        raw = _read_txt_md(file_path)
    else:
        raise ValueError(f"Unsupported document format: {ext}. Supported: .docx, .pdf, .txt, .md, .markdown")

    # Word count check
    total_words = sum(len(b.text.split()) for b in raw.blocks)
    if total_words < 40:
        raise ValueError("This looks like a scanned or empty document. OCR is not supported yet.")

    return raw
