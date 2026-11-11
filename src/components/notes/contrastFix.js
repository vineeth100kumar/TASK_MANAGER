/* Runs inside a report's sandboxed frame (Auto colours). Finds text, and chart
 * labels in SVG, that is too hard to read on what is behind it and gives it a
 * readable shade of its own colour, so a blue heading stays blue. Plain script,
 * loaded as text: the helpers are tested in reportFrame.test.ts. */

function parseColor(value) {
  const m = String(value || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(v => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)));
  if (p.length < 3 || p.slice(0, 3).some(isNaN)) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
}

/** `top` painted over an opaque `bottom`. */
function blend(top, bottom) {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function luminance(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function toHsl(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl(h, s, l) {
  const hue = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a: 1 };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255, a: 1 };
}

/** The same hue, made lighter or darker (whichever way reads on `bg`) until it reaches `min`. */
function readableOn(fg, bg, min) {
  if (contrast(fg, bg) >= min) return fg;
  const { h, s, l } = toHsl(fg);
  const up = luminance(bg) < 0.18;
  for (let step = 1; step <= 20; step++) {
    const next = Math.max(0, Math.min(1, up ? l + (1 - l) * step / 20 : l * (1 - step / 20)));
    const c = fromHsl(h, Math.min(s, 0.85), next);
    if (contrast(c, bg) >= min) return c;
  }
  return up ? { r: 243, g: 244, b: 246, a: 1 } : { r: 17, g: 24, b: 39, a: 1 };
}

/** Colours a gradient passes through, so text on it is checked against the worst one. */
function gradientStops(image) {
  return (String(image).match(/rgba?\([^)]+\)/g) || []).map(parseColor).filter(Boolean);
}

const css = c => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

function runContrastFix() {
  const doc = document;
  const dark = doc.documentElement.dataset.theme === 'dark';
  const sageBg = dark ? { r: 28, g: 28, b: 30, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  const LIMIT = 6000;

  // What is behind an element: its backgrounds, see-through ones blended, down to Sage's page.
  // Returns a list (more than one for a gradient), or null behind a picture.
  const behind = el => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const st = getComputedStyle(e);
      const img = st.backgroundImage;
      if (img && img !== 'none') {
        if (/url\(/.test(img)) return null;
        const stops = gradientStops(img);
        if (stops.length) { layers.push(stops); break; }
      }
      const c = parseColor(st.backgroundColor);
      if (c && c.a > 0) { layers.push([c]); if (c.a >= 0.99) break; }
    }
    let base = [sageBg];
    for (let i = layers.length - 1; i >= 0; i--) {
      const next = [];
      for (const top of layers[i]) for (const b of base) next.push(top.a >= 0.99 ? { ...top, a: 1 } : blend(top, b));
      base = next;
    }
    return base;
  };

  const ownText = el => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  };

  const check = (el, prop) => {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return;
    if (st.webkitBackgroundClip === 'text' || st.backgroundClip === 'text') return;  // gradient text
    let fg = parseColor(prop === 'fill' ? st.fill : st.color);
    if (!fg || fg.a === 0) return;
    const bgs = behind(el);
    if (!bgs) return;
    const size = parseFloat(st.fontSize) || 16;
    const min = size >= 24 || (size >= 18.5 && parseInt(st.fontWeight, 10) >= 600) ? 3 : 4.5;
    // A see-through colour is judged as it looks; the worst background decides.
    const worst = bgs.reduce((w, b) => (contrast(blend(fg, b), b) < contrast(blend(fg, w), w) ? b : w), bgs[0]);
    fg = blend(fg, worst);
    if (contrast(fg, worst) >= min) return;
    // Fixed text aims past the bare minimum so it reads comfortably, not just legally.
    el.style.setProperty(prop, css(readableOn(fg, worst, min === 3 ? 4.5 : 7)), 'important');
    el.setAttribute('data-sage-recoloured', '');
  };

  const fix = root => {
    let n = 0;
    const scope = root && root.nodeType === 1 ? root : doc.body;
    const all = [scope, ...scope.querySelectorAll('*')];
    for (const el of all) {
      if (++n > LIMIT) break;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
        if (/^(text|tspan|textPath)$/.test(el.tagName) && el.textContent.trim()) check(el, 'fill');
        continue;
      }
      if (el.closest('pre, canvas') || !ownText(el)) continue;
      check(el, 'color');
    }
  };

  let timer = null;
  const pending = new Set();
  const later = node => {
    if (node) pending.add(node);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const nodes = pending.size && pending.size < 50 ? [...pending] : [doc.body];
      pending.clear();
      for (const node of nodes) if (node.isConnected) fix(node);
    }, 150);
  };

  const start = () => {
    fix(doc.body);
    // Charts and pages that draw late, or add content as they run.
    addEventListener('load', () => later());
    setTimeout(() => later(), 1200);
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(n => later(n.nodeType === 1 ? n : n.parentElement));
        else if (r.attributeName !== 'data-sage-recoloured' && !(r.attributeName === 'style' && r.target.hasAttribute('data-sage-recoloured'))) later(r.target);
      }
    }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  };
  if (doc.readyState === 'loading') addEventListener('DOMContentLoaded', start); else start();
}

if (typeof document !== 'undefined' && document.documentElement && document.documentElement.hasAttribute('data-sage-frame')) runContrastFix();
