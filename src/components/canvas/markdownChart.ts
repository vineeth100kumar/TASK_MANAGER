// Markdown files attached in the thinking partner. The file is cleaned up
// before it goes to the AI (structure kept, clutter dropped), and if the AI
// can't return a chart, a plain one is drawn straight from the file's headings
// and lists so there is always something on the board.
import type { EditOp } from './boardEdits';

export type ChartDetail = 'simple' | 'moderate' | 'complex';

interface Block {
  kind: 'heading' | 'item' | 'text';
  level: number; // heading depth (1-6) or list indent (0 = top level)
  text: string;
}

// Keeps headings, lists, numbered steps and sentences; drops what only makes
// sense rendered (front matter, HTML, images, link targets, code).
export function cleanMarkdown(md: string): string {
  let text = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  text = text.replace(/^---\n[\s\S]*?\n(---|\.\.\.)\n/, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '(code example)');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt.trim() ? `(picture: ${alt.trim()})` : ''));
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ''); // reference-style link targets
  text = text.replace(/<https?:\/\/[^>]+>/g, '');
  text = text.replace(/<\/?[a-z][^>]*>/gi, ' ');
  text = text.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1');
  // Tables: keep the cells, lose the ruling.
  // Tables: keep the cells as plain lines, lose the ruling. They're reference
  // material, not steps, so they don't become list items.
  text = text.replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => `Table row: ${row.split('|').map(c => c.trim()).filter(Boolean).join(' | ')}`);
  text = text.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function parseBlocks(md: string): Block[] {
  const lines = cleanMarkdown(md).split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ kind: 'text', level: 0, text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? '';
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const item = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (heading) {
      endPara();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
    } else if (line.trim() && /^\s*(=+|-+)\s*$/.test(next) && !item) {
      endPara();
      blocks.push({ kind: 'heading', level: next.trim()[0] === '=' ? 1 : 2, text: line.trim() });
      i++;
    } else if (item) {
      endPara();
      blocks.push({ kind: 'item', level: Math.floor(item[1].replace(/\t/g, '    ').length / 2), text: item[2] });
    } else if (!line.trim()) {
      endPara();
    } else if (/^\s+\S/.test(line) && blocks.length && blocks[blocks.length - 1].kind === 'item' && !para.length) {
      blocks[blocks.length - 1].text += ` ${line.trim()}`; // a list item carried onto the next line
    } else {
      para.push(line.trim().replace(/^>\s?/, ''));
    }
  }
  endPara();
  return blocks.filter(b => b.text.trim() && b.text !== '(code example)');
}

// Short, chart-sized wording that stays in the file's own words.
export function shortLabel(text: string, words = 8): string {
  let t = text.replace(/\s+/g, ' ').replace(/^(step|phase|stage)\s*\d+\s*[:.)-]?\s*/i, '').replace(/^\d+(\.\d+)*[.)]?\s+(?=\S)/, '').trim();
  t = t.split(/(?<=[.!])\s|:\s|\s[-–—]\s/)[0].replace(/[.;,:]+$/, '').trim();
  const parts = t.split(' ');
  return parts.length > words ? `${parts.slice(0, words).join(' ')}…` : t;
}

const IF_LEAD = /^(if|when|whenever|in case|unless|should)\s+(.+?)(?:,\s*|\s+then\s+)(.+)$/i;

interface Node { label: string; shape: 'box' | 'decision' | 'oval'; then?: string }

// Turns a step into a node; "If X, do Y" becomes a decision with Y on its Yes side.
function toNode(text: string): Node {
  const plain = text.replace(/\s+/g, ' ').trim();
  const cond = plain.match(IF_LEAD);
  if (cond) {
    const question = cond[1].toLowerCase() === 'unless' ? `${cond[2]}?` : `${cond[2].replace(/[?.]$/, '')}?`;
    return { label: capital(shortLabel(question.replace(/\?$/, ''), 7)) + '?', shape: 'decision', then: capital(shortLabel(cond[3])) };
  }
  if (/\?$/.test(plain)) return { label: capital(shortLabel(plain.replace(/\?$/, ''), 7)) + '?', shape: 'decision' };
  return { label: capital(shortLabel(plain)), shape: 'box' };
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const LIMITS: Record<ChartDetail, number> = { simple: 5, moderate: 12, complex: 30 };

// A plain top-to-bottom chart of the file: a start, the steps in order, an end.
// Simple keeps one shape per section, Moderate the main points of each,
// Complex every step, with "if" steps as decisions.
export function markdownChart(md: string, detail: ChartDetail, fileName = ''): { ops: EditOp[]; count: number } {
  const blocks = parseBlocks(md);
  const headings = blocks.filter(b => b.kind === 'heading');
  const topLevel = headings.length ? Math.min(...headings.map(h => h.level)) : 0;
  // A single top heading is the document's title; its sections are one level down.
  const titleBlock = headings.filter(h => h.level === topLevel).length === 1 ? headings.find(h => h.level === topLevel) : undefined;
  const sectionLevel = titleBlock ? Math.min(...(headings.filter(h => h.level > topLevel).map(h => h.level)), 7) : topLevel;
  const title = titleBlock?.text || fileName.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ') || 'Start';

  // Group the file into sections, each with its steps.
  const sections: Array<{ heading?: string; items: Block[] }> = [];
  let current: { heading?: string; items: Block[] } = { items: [] };
  for (const b of blocks) {
    if (b === titleBlock) continue;
    if (b.kind === 'heading' && b.level <= sectionLevel) {
      if (current.heading || current.items.length) sections.push(current);
      current = { heading: b.text, items: [] };
    } else if (b.kind === 'heading') {
      current.items.push({ kind: 'item', level: 0, text: b.text });
    } else if (b.kind === 'item') {
      current.items.push(b);
    }
  }
  if (current.heading || current.items.length) sections.push(current);

  const limit = LIMITS[detail];
  let texts: string[] = [];
  if (detail === 'simple') {
    texts = sections.some(s => s.heading)
      ? sections.filter(s => s.heading).map(s => s.heading!)
      : sections.flatMap(s => s.items.filter(i => i.level === 0).map(i => i.text));
  } else {
    const perSection = detail === 'moderate' ? Math.max(2, Math.floor(limit / Math.max(1, sections.length))) : Infinity;
    for (const s of sections) {
      const items = s.items.filter(i => detail === 'complex' || i.level === 0);
      if (detail === 'complex' && s.heading && items.length) texts.push(s.heading);
      if (items.length) texts.push(...items.slice(0, perSection).map(i => i.text));
      else if (s.heading) texts.push(s.heading);
    }
  }
  // No headings or lists at all: fall back to the file's sentences.
  if (!texts.length) {
    texts = blocks.filter(b => b.kind === 'text').flatMap(b => b.text.split(/(?<=[.!?])\s+/)).filter(t => t.split(' ').length >= 3);
  }
  texts = texts.slice(0, limit);
  if (!texts.length) return { ops: [], count: 0 };

  const ops: EditOp[] = [];
  let n = 0;
  const add = (label: string, shape: Node['shape']) => {
    const ref = `f${++n}`;
    ops.push({ op: 'add_node', ref, label, shape });
    return ref;
  };
  const edge = (from: string, to: string, label?: string) => ops.push({ op: 'add_edge', from, to, ...(label ? { label } : {}) });

  let prev = add(capital(shortLabel(title)), 'oval');
  // A decision waiting for its No side, which goes to whatever comes next.
  let pendingNo: string | null = null;
  for (const t of texts) {
    const node = detail === 'simple' ? { label: capital(shortLabel(t)), shape: 'box' as const } : toNode(t);
    const ref = add(node.label, node.shape);
    edge(prev, ref, pendingNo === prev ? 'Yes' : undefined);
    if (pendingNo && pendingNo !== prev) edge(pendingNo, ref, 'No');
    pendingNo = null;
    prev = ref;
    if (node.shape === 'decision') {
      if (node.then) {
        const yes = add(node.then, 'box');
        edge(ref, yes, 'Yes');
        pendingNo = ref;
        prev = yes;
      } else {
        pendingNo = ref;
      }
    }
  }
  const end = add('Done', 'oval');
  edge(prev, end, pendingNo === prev ? 'Yes' : undefined);
  if (pendingNo && pendingNo !== prev) edge(pendingNo, end, 'No');
  return { ops, count: n };
}
