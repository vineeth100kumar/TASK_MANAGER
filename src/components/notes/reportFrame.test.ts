import { describe, expect, it } from 'vitest';
import { REPORT_CSP, REPORT_SANDBOX, highlightCode, normalizeLanguage } from './reportFrame';

describe('highlightCode', () => {
  it('escapes everything, so code can never become markup', () => {
    const out = highlightCode('const a = "<img src=x onerror=alert(1)>";', 'js');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).toContain('<span class="hl-k">const</span>');
    expect(out).toContain('<span class="hl-s">');
  });

  it('knows each language’s comments', () => {
    expect(highlightCode('x = 1  # note', 'python')).toContain('<span class="hl-c"># note</span>');
    expect(highlightCode('a // b', 'ts')).toContain('<span class="hl-c">// b</span>');
    expect(highlightCode('select 1 -- why', 'sql')).toContain('<span class="hl-c">-- why</span>');
    expect(highlightCode('print(len(x))', 'py')).toContain('<span class="hl-f">print</span>');
  });

  it('marks html tags and attributes', () => {
    const out = highlightCode('<a href="/x">hi</a>', 'html');
    expect(out).toContain('<span class="hl-t">a</span>');
    expect(out).toContain('<span class="hl-f">href</span>');
    expect(out).toContain('hi');
    expect(out).not.toMatch(/<a /);
  });

  it('keeps the text the same once tags are dropped', () => {
    const src = 'def f(a, b=2):\n    return a < b and "x\'y"\n';
    const text = highlightCode(src, 'py').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(text).toBe(src);
  });

  it('maps language names', () => {
    expect(normalizeLanguage('TypeScript')).toBe('js');
    expect(normalizeLanguage('language-bash')).toBe('sh');
    expect(normalizeLanguage('cpp')).toBe('c');
  });
});

describe('report frame', () => {
  it('never shares the app origin and blocks network reads', () => {
    expect(REPORT_SANDBOX).not.toContain('allow-same-origin');
    expect(REPORT_SANDBOX).not.toContain('allow-top-navigation');
    expect(REPORT_CSP).toContain("connect-src 'none'");
    expect(REPORT_CSP).toContain("default-src 'none'");
  });
});
