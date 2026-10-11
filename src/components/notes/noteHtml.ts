/** Helpers for the formatted note body: cleaning stored HTML and shrinking images. */

const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

/**
 * Notes are stored as HTML and come back from sync, so anything that could run
 * code is removed before it is shown: script-like tags, on* handlers and
 * javascript: links. Images may only be inline data or http(s).
 */
export function sanitizeNoteHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (DROP_TAGS.has(child.tagName)) { child.remove(); continue; }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on')) child.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:')) child.removeAttribute(attr.name);
        else if (name === 'src' && child.tagName === 'IMG' && !/^(data:image\/|https?:)/.test(value)) child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * Reads an image file and scales it down so a photo doesn't fill several sheet
 * cells: at most 1280px on the long side, JPEG unless it has transparency.
 */
export async function imageFileToDataUrl(file: File, maxSide = 1280): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return src;
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
  if (keepAlpha && hasTransparency(ctx, w, h)) return canvas.toDataURL('image/png');
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * 16) if (data[i] < 250) return true;
  return false;
}

/** The note's text for previews and search, without tags. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.innerText ?? doc.body.textContent ?? '').trim();
}
