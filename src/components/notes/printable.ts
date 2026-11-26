// printable.ts - A note, an HTML report or a thought map as one clean page to print.
//
// Every kind becomes a plain A4 document: dark mode, buttons and screen layout
// are left out, and scripts are removed. The same page goes to the browser's
// Print dialog or, as HTML, to the Pi, which turns it into a PDF for the printer.

import { Note, Thought, ThoughtStatus } from '../../services/types';
import { STATUS_NAMES, countStatuses, statusOf, thoughtTree, topicsOf, type TreeNode } from './thoughtMap';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PAGE_CSS = `
@page { size: A4; margin: 16mm 15mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { background: #fff; }
`;

const NOTE_CSS = `
body.sage-print { font: 11.5pt/1.55 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 0; }
.sage-print h1.title { font-size: 22pt; margin: 0 0 4mm; line-height: 1.2; }
.sage-print h1, .sage-print h2, .sage-print h3 { break-after: avoid; }
.sage-print img { max-width: 100%; height: auto; }
.sage-print table { border-collapse: collapse; max-width: 100%; }
.sage-print td, .sage-print th { border: 1px solid #bbb; padding: 3px 7px; }
.sage-print pre { white-space: pre-wrap; word-break: break-word; font: 9.5pt/1.45 ui-monospace, Menlo, Consolas, monospace; background: #f4f4f5; padding: 3mm; border-radius: 2mm; }
.sage-print blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 4mm; color: #444; }
.sage-print .meta { color: #666; font-size: 9.5pt; margin: 0 0 6mm; }
`;

const MAP_CSS = `
.map-stats { display: flex; flex-wrap: wrap; gap: 3mm; margin: 0 0 6mm; }
.map-stats span { border: 1px solid #ccc; border-radius: 99px; padding: 1px 9px; font-size: 9.5pt; }
.topic { margin: 0 0 6mm; }
.topic h2 { font-size: 13pt; margin: 0 0 2mm; padding-bottom: 1mm; border-bottom: 2px solid var(--c, #64748b); }
.thought { margin: 0; padding: 1.2mm 0 1.2mm 0; break-inside: avoid; }
.thought .row { display: flex; gap: 2.5mm; align-items: baseline; }
.mark { flex: none; width: 5mm; text-align: center; font-weight: 700; }
.s-good .mark { color: #16a34a } .s-bad .mark { color: #dc2626 } .s-unsure .mark { color: #d97706 } .s-open .mark { color: #6b7280 }
.s-bad .text { text-decoration: line-through; color: #666; }
.kids { margin-left: 7mm; border-left: 1.5px solid #ddd; padding-left: 3mm; }
.note { margin: 0.5mm 0 0 7.5mm; color: #555; font-size: 10pt; }
`;

const MARK: Record<ThoughtStatus, string> = { good: '✓', bad: '✗', unsure: '~', open: '?' };

/** Drops scripts, frames and inline handlers. The print frame is also sandboxed, so this is tidiness, not the only guard. */
export function stripScripts(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

const bodyOf = (html: string) => {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return (m ? m[1] : html).trim();
};

function shell(title: string, css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Sage')}</title><style>${PAGE_CSS}${css}</style></head><body class="sage-print">${body}</body></html>`;
}

const when = (n: Note) => {
  const d = new Date(n.updatedAt || n.createdAt);
  return isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** An HTML report keeps its own look; only the print page rules are added and scripts dropped. */
export function reportPage(_note: Note, source: string): string {
  const clean = stripScripts(source);
  return /<\/head>/i.test(clean) ? clean.replace(/<\/head>/i, `<style>${PAGE_CSS}</style></head>`) : `<style>${PAGE_CSS}</style>${clean}`;
}

export function codePage(note: Note, source: string): string {
  const head = `<h1 class="title">${esc(note.title || 'Code')}</h1>${note.language ? `<p class="meta">${esc(note.language)}</p>` : ''}`;
  return shell(note.title, NOTE_CSS, `${head}<pre>${esc(source)}</pre>`);
}

/** A written note: its title, the date, then its formatted body. */
export function notePage(note: Note, html: string): string {
  const body = stripScripts(bodyOf(html || '')) || `<p>${esc(note.content || '')}</p>`;
  const d = when(note);
  return shell(note.title, NOTE_CSS, `<h1 class="title">${esc(note.title || 'Untitled note')}</h1>${d ? `<p class="meta">${esc(d)}</p>` : ''}${body}`);
}

/** A thought map as an indented outline: each topic a heading, each thought marked ✓ ✗ ~ ?. */
export function mapPage(note: Note, thoughts: Thought[]): string {
  const counts = countStatuses(thoughts);
  const topics = topicsOf(thoughts);
  const colorOf = (name: string) => topics.find(t => t.name.toLowerCase() === name.toLowerCase())?.color || '#64748b';
  const render = (n: TreeNode): string => {
    const s = statusOf(n.thought);
    const kids = n.children.length ? `<div class="kids">${n.children.map(render).join('')}</div>` : '';
    return `<div class="thought s-${s}"><div class="row"><span class="mark" title="${esc(STATUS_NAMES[s])}">${MARK[s]}</span><span class="text">${esc(n.thought.text)}</span></div>${n.thought.note ? `<div class="note">${esc(n.thought.note)}</div>` : ''}${kids}</div>`;
  };
  // A thought sits under the topic of the thought it grew from.
  const groups = new Map<string, TreeNode[]>();
  for (const root of thoughtTree(thoughts)) {
    const key = (root.thought.topic || '').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(root);
  }
  const rank = (k: string) => {
    const i = ['', ...topics.map(t => t.name.toLowerCase())].indexOf(k.toLowerCase());
    return i < 0 ? 999 : i;
  };
  const sections = [...groups.keys()].sort((x, y) => rank(x) - rank(y)).map(k => {
    const nodes = groups.get(k) || [];
    if (!nodes.length) return '';
    return `<section class="topic" style="--c:${colorOf(k)}">${k ? `<h2>${esc(k)}</h2>` : thoughts.length && groups.size > 1 ? '<h2>Main line</h2>' : ''}${nodes.map(render).join('')}</section>`;
  }).join('');
  const stats = (['good', 'bad', 'unsure', 'open'] as ThoughtStatus[]).filter(s => counts[s]).map(s => `<span>${MARK[s]} ${counts[s]} ${esc(STATUS_NAMES[s].toLowerCase())}</span>`).join('');
  const d = when(note);
  const body = `<h1 class="title">${esc(note.title || 'Thought map')}</h1>${d ? `<p class="meta">Thought map · ${esc(d)}</p>` : ''}${stats ? `<div class="map-stats">${stats}</div>` : ''}${sections || '<p class="meta">No thoughts yet.</p>'}`;
  return shell(note.title, NOTE_CSS + MAP_CSS, body);
}
