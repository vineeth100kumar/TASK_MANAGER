import { describe, expect, it } from 'vitest';
import src from './contrastFix.js?raw';
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

// The frame script's helpers, loaded the way the frame loads them (as plain text).
const fx = new Function(`${src}; return { parseColor, blend, contrast, readableOn, toHsl, gradientStops };`)();
const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
const SAGE_DARK = rgb(28, 28, 30);

describe('auto colours', () => {
  it('reads every computed colour form', () => {
    expect(fx.parseColor('rgb(51, 51, 51)')).toEqual(rgb(51, 51, 51));
    expect(fx.parseColor('rgba(0, 0, 0, 0.5)')).toEqual(rgb(0, 0, 0, 0.5));
    expect(fx.parseColor('rgb(10 20 30 / 40%)')).toEqual(rgb(10, 20, 30, 0.4));
    expect(fx.parseColor('transparent')).toBeNull();
    expect(fx.gradientStops('linear-gradient(rgb(0, 0, 0), rgba(255, 255, 255, 0.5))')).toHaveLength(2);
  });

  it('lifts the screenshot colours to readable on dark, keeping their hue', () => {
    for (const hex of [[44, 62, 80], [52, 73, 94], [51, 51, 51], [41, 128, 185]]) {
      const fg = rgb(hex[0], hex[1], hex[2]);
      const fixed = fx.readableOn(fg, SAGE_DARK, 4.5);
      expect(fx.contrast(fixed, SAGE_DARK)).toBeGreaterThanOrEqual(4.5);
      if (hex[0] !== hex[1]) expect(Math.abs(fx.toHsl(fixed).h - fx.toHsl(fg).h)).toBeLessThan(0.02);
    }
  });

  it('darkens light text on a light page, and leaves readable text alone', () => {
    const white = rgb(255, 255, 255);
    const fixed = fx.readableOn(rgb(220, 220, 220), white, 4.5);
    expect(fx.contrast(fixed, white)).toBeGreaterThanOrEqual(4.5);
    const fine = rgb(17, 24, 39);
    expect(fx.readableOn(fine, white, 4.5)).toBe(fine);
  });

  it('always ends readable, even for mid grey on mid grey', () => {
    const bg = rgb(128, 128, 128);
    for (const fg of [rgb(120, 120, 120), rgb(140, 100, 100), rgb(255, 0, 0)]) {
      expect(fx.contrast(fx.readableOn(fg, bg, 3), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('judges see-through colours as they look', () => {
    const faded = fx.blend(rgb(255, 255, 255, 0.2), SAGE_DARK);
    expect(fx.contrast(faded, SAGE_DARK)).toBeLessThan(3);
  });
});
