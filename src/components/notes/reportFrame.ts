/**
 * HTML reports and code pushed into Notes by Claude or another AI.
 *
 * A report is shown in a sandboxed frame with no access to the app: it runs in
 * its own opaque origin (no cookies, storage or parent DOM), and a content
 * policy stops it fetching anything except styles, fonts and scripts from a few
 * public CDNs. Sage's look is put in first, at the lowest specificity, so a page
 * sent with no styling of its own still looks like the rest of the app, while a
 * page that brings its own design keeps it.
 */

// The Auto colours script, run inside the frame (see contrastFix.js).
import CONTRAST_FIX_JS from './contrastFix.js?raw';

export type FrameTheme = 'light' | 'dark';

const CDNS = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com';
export const REPORT_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS} https://cdn.tailwindcss.com`,
  `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
  `font-src data: ${CDNS} https://fonts.gstatic.com`,
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

/** The sandbox flags: scripts (for charts), and links that open in a new tab. Never allow-same-origin. */
export const REPORT_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

const TOKENS: Record<FrameTheme, Record<string, string>> = {
  light: {
    bg: '#ffffff', surface: '#f5f5f7', text: '#111827', muted: '#6b7280', border: 'rgba(0,0,0,0.08)',
    accent: '#2563eb', 'accent-soft': 'rgba(37,99,235,0.1)', good: '#16a34a', warn: '#d97706', bad: '#dc2626',
    'code-bg': '#f5f5f7', 'code-text': '#1f2937',
    'hl-keyword': '#7c3aed', 'hl-string': '#15803d', 'hl-number': '#c2410c', 'hl-comment': '#9ca3af', 'hl-fn': '#2563eb', 'hl-tag': '#db2777',
  },
  dark: {
    bg: '#1c1c1e', surface: '#2c2c2e', text: '#f3f4f6', muted: '#9ca3af', border: 'rgba(255,255,255,0.08)',
    accent: '#60a5fa', 'accent-soft': 'rgba(96,165,250,0.15)', good: '#4ade80', warn: '#fbbf24', bad: '#f87171',
    'code-bg': '#111113', 'code-text': '#e5e7eb',
    'hl-keyword': '#c4b5fd', 'hl-string': '#86efac', 'hl-number': '#fdba74', 'hl-comment': '#6b7280', 'hl-fn': '#93c5fd', 'hl-tag': '#f9a8d4',
  },
};

export function themeVars(theme: FrameTheme): string {
  return Object.entries(TOKENS[theme]).map(([k, v]) => `--sage-${k}:${v};`).join('');
}

/** Code highlight colours, shared by the frame and the code view in the app. */
export const HIGHLIGHT_CSS = `
.hl-k{color:var(--sage-hl-keyword)}.hl-s{color:var(--sage-hl-string)}.hl-n{color:var(--sage-hl-number)}
.hl-c{color:var(--sage-hl-comment);font-style:italic}.hl-f{color:var(--sage-hl-fn)}.hl-t{color:var(--sage-hl-tag)}`;

// :where() keeps every rule at zero specificity, so the page's own CSS wins.
const BASE_CSS = `
:where(html){background:var(--sage-bg);color:var(--sage-text);-webkit-text-size-adjust:100%}
:where(body){margin:0;padding:24px clamp(16px,4vw,40px) 48px;font:15px/1.6 "Inter Variable",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:860px;overflow-wrap:anywhere}
:where(h1,h2,h3,h4){line-height:1.25;letter-spacing:-0.01em;margin:1.6em 0 .5em;font-weight:700}
:where(h1){font-size:1.75em;margin-top:.2em}:where(h2){font-size:1.35em}:where(h3){font-size:1.1em}
:where(p,ul,ol,blockquote,table,pre,figure){margin:0 0 1em}
:where(ul,ol){padding-left:1.4em}:where(li){margin:.2em 0}
:where(a){color:var(--sage-accent);text-decoration:none}:where(a:hover){text-decoration:underline}
:where(strong,b){font-weight:650}
:where(small,figcaption,caption){color:var(--sage-muted);font-size:.85em}
:where(hr){border:0;border-top:1px solid var(--sage-border);margin:2em 0}
:where(img,svg,video,canvas){max-width:100%;height:auto}
:where(img){border-radius:12px}
:where(blockquote){margin-left:0;padding:.6em 1em;border-left:3px solid var(--sage-accent);background:var(--sage-accent-soft);border-radius:0 12px 12px 0}
:where(table){border-collapse:separate;border-spacing:0;width:100%;font-size:.92em;border:1px solid var(--sage-border);border-radius:12px;overflow:hidden}
:where(th,td){padding:8px 12px;text-align:left;border-bottom:1px solid var(--sage-border);vertical-align:top}
:where(th){background:var(--sage-surface);font-weight:600;font-size:.85em;color:var(--sage-muted);text-transform:uppercase;letter-spacing:.04em}
:where(tr:last-child td){border-bottom:0}
:where(code,kbd,samp){font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
:where(:not(pre)>code){background:var(--sage-surface);padding:.12em .4em;border-radius:6px}
:where(pre){background:var(--sage-code-bg);color:var(--sage-code-text);border:1px solid var(--sage-border);border-radius:14px;padding:14px 16px;overflow-x:auto;line-height:1.5;tab-size:4}
:where(pre code){background:none;padding:0;font-size:.86em}
:where(details){border:1px solid var(--sage-border);border-radius:12px;padding:.5em 1em;margin-bottom:1em}
:where(summary){cursor:pointer;font-weight:600}
:where(button,input,select,textarea){font:inherit;color:inherit}
:where(button){background:var(--sage-accent);color:#fff;border:0;border-radius:10px;padding:6px 14px;cursor:pointer}
:where(mark){background:rgba(250,204,21,.45);color:inherit;border-radius:3px}
${HIGHLIGHT_CSS}`;

const LANG_ALIASES: Record<string, string> = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', json: 'js',
  py: 'py', python: 'py', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', yaml: 'sh', yml: 'sh', toml: 'sh', ruby: 'sh', rb: 'sh',
  sql: 'sql', html: 'html', xml: 'html', svg: 'html', vue: 'html',
};
const KEYWORDS = new Set((
  'abstract and as async await break case catch class const continue def default del delete do elif else enum export extends ' +
  'false final finally fn for from func function global go if impl import in instanceof interface is lambda let match mod ' +
  'new nil none None not null or package pass private protected pub public raise return self static struct super switch this ' +
  'throw true True False try type typeof undefined unsigned use var void volatile while with yield int float double char bool ' +
  'string auto long short byte const_cast include define echo then fi done esac local export select insert update delete where ' +
  'join on group by order having limit values into create table drop alter primary key not'
).split(' '));

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function normalizeLanguage(lang?: string | null): string {
  return LANG_ALIASES[String(lang || '').toLowerCase().replace(/^language-/, '')] || 'c';
}

/** A small, safe highlighter: escapes the code and wraps comments, strings, numbers and keywords in spans. */
export function highlightCode(code: string, language?: string | null): string {
  const lang = normalizeLanguage(language);
  if (lang === 'html') {
    return code.replace(/<!--[\s\S]*?-->|<\/?[\w:-]+(?:\s+[\w:@.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+|</g, tok => {
      if (tok.startsWith('<!--')) return `<span class="hl-c">${esc(tok)}</span>`;
      if (tok.length > 1 && tok.startsWith('<')) {
        const [, open, name, rest] = tok.match(/^(<\/?)([\w:-]+)([\s\S]*)$/)!;
        const attrs = esc(rest).replace(/(\s)([\w:@.-]+)(=)("[^"]*"|'[^']*')?/g, (_m, sp, attr, eq, val) => `${sp}<span class="hl-f">${attr}</span>${eq}${val ? `<span class="hl-s">${val}</span>` : ''}`);
        return `${esc(open)}<span class="hl-t">${name}</span>${attrs}`;
      }
      return esc(tok);
    });
  }
  const comment = lang === 'py' || lang === 'sh' ? '#[^\\n]*' : lang === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|#(?:include|define|if|endif|ifdef|ifndef|pragma)[^\\n]*';
  const strings = lang === 'py' ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|' : '';
  const re = new RegExp(`(${comment})|(${strings}"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$][\\w$]*)`, 'g');
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    last = m.index! + m[0].length;
    const [tok, c, s, n, f, w] = m;
    if (c) out += `<span class="hl-c">${esc(tok)}</span>`;
    else if (s) out += `<span class="hl-s">${esc(tok)}</span>`;
    else if (n) out += `<span class="hl-n">${tok}</span>`;
    else if (f) out += KEYWORDS.has(f) ? `<span class="hl-k">${f}</span>` : `<span class="hl-f">${f}</span>`;
    else if (w && (KEYWORDS.has(w) || (lang === 'sql' && KEYWORDS.has(w.toLowerCase())))) out += `<span class="hl-k">${w}</span>`;
    else out += esc(tok);
  }
  return out + esc(code.slice(last));
}

/**
 * How a report's own colours meet Sage's theme:
 * - auto: keep the page's design, but any text that would be hard to read on
 *   what is behind it (dark text on Sage's dark page, say) is recoloured;
 * - sage: the page's colours are dropped and Sage's are used throughout;
 * - original: exactly as the page set them.
 */
export type ColorMode = 'auto' | 'sage' | 'original';

// Forced Sage colours. Charts (svg, canvas) and images keep theirs.
const SAGE_COLORS_CSS = `
html,body{background:var(--sage-bg)!important;color:var(--sage-text)!important}
body *:not(svg):not(svg *):not(canvas):not(img):not(video):not(pre *){color:inherit!important;background-color:transparent!important;border-color:var(--sage-border)!important;text-shadow:none!important}
body :is(header,section,article,aside,nav,footer,div,table,details)[style*="background"],body :is(.card,.box,.panel,.callout){background-color:var(--sage-surface)!important}
body :is(h1,h2,h3,h4,h5,h6,strong,b,th){color:var(--sage-text)!important}
body :is(small,figcaption,caption,th){color:var(--sage-muted)!important}
body :is(a,a *){color:var(--sage-accent)!important}
body th{background-color:var(--sage-surface)!important}
body pre{background:var(--sage-code-bg)!important;color:var(--sage-code-text)!important}
body :not(pre)>code{background:var(--sage-surface)!important}
body blockquote{background:var(--sage-accent-soft)!important;border-color:var(--sage-accent)!important}`;



/**
 * The whole document the frame shows: the report parsed (never run here), with
 * Sage's policy, theme and base styles put first in its head, links opening in
 * a new tab, and its unstyled code blocks highlighted.
 */
export function buildReportDocument(html: string, theme: FrameTheme, mode: ColorMode = 'auto'): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const head = doc.head;
  const add = (el: Element) => head.insertBefore(el, head.firstChild);
  const style = doc.createElement('style');
  style.textContent = `:root{${themeVars(theme)}color-scheme:${theme}}${BASE_CSS}`;
  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');
  const viewport = doc.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', 'width=device-width, initial-scale=1');
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', REPORT_CSP);
  // Inserted last-to-first so the policy ends up the very first thing in the head.
  for (const el of [style, viewport, base, csp]) add(el);
  if (!head.querySelector('meta[charset]')) {
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    add(charset);
  }
  doc.documentElement.setAttribute('data-theme', theme);
  doc.documentElement.setAttribute('data-sage-frame', '');
  doc.documentElement.classList.toggle('dark', theme === 'dark');
  // Highlight code blocks that came as plain text; ones already marked up are left as sent.
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    const target = pre.querySelector(':scope > code') || pre;
    if (target.children.length) continue;
    const lang = (target.className.match(/(?:language|lang)-([\w+#-]+)/) || pre.className.match(/(?:language|lang)-([\w+#-]+)/) || [])[1];
    target.innerHTML = highlightCode(target.textContent || '', lang);
  }
  if (mode === 'sage') {
    // Last in the head and !important, so it beats the page's own styles.
    const force = doc.createElement('style');
    force.textContent = SAGE_COLORS_CSS;
    head.appendChild(force);
  }
  if (mode === 'auto') {
    const fixer = doc.createElement('script');
    fixer.textContent = CONTRAST_FIX_JS;
    (doc.body || doc.documentElement).appendChild(fixer);
  }
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
