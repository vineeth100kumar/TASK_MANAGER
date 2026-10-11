#include <Arduino.h>
#include <math.h>
#include "aa_text.h"
#include "display.h"

// One buffer, shared by every surface and grown to the largest one asked for.
static uint16_t* pool   = nullptr;
static size_t    poolPx = 0;

bool aaBegin(AASurface& s, int x, int y, int w, int h, uint16_t bg) {
  s.buf = nullptr; s.x = x; s.y = y; s.w = w; s.h = h;
  if (w <= 0 || h <= 0) return false;
  size_t need = (size_t)w * h;
  if (need > poolPx) {
    free(pool);
    pool = (uint16_t*)malloc(need * sizeof(uint16_t));
    poolPx = pool ? need : 0;
    if (!pool) return false;
  }
  s.buf = pool;
  for (size_t i = 0; i < need; i++) pool[i] = bg;
  return true;
}

void aaEnd(AASurface& s) {
  if (s.buf) tft.drawRGBBitmap(s.x, s.y, s.buf, s.w, s.h);
  s.buf = nullptr;
}

void aaRelease() {
  free(pool);
  pool = nullptr;
  poolPx = 0;
}

uint16_t aaRGB(uint8_t r, uint8_t g, uint8_t b, float k) {
  if (k < 1.0f) {
    k = k < 0.0f ? 0.0f : k;
    r = (uint8_t)(r * k); g = (uint8_t)(g * k); b = (uint8_t)(b * k);
  }
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

uint16_t aaMix(uint16_t a, uint16_t b, uint8_t t) {
  if (t == 0) return a;
  if (t == 255) return b;
  int k = t + (t >> 7);                       // 0..256
  int ar = a >> 11, ag = (a >> 5) & 63, ab = a & 31;
  int br = b >> 11, bg = (b >> 5) & 63, bb = b & 31;
  int r = ar + (((br - ar) * k) >> 8);
  int g = ag + (((bg - ag) * k) >> 8);
  int c = ab + (((bb - ab) * k) >> 8);
  return (uint16_t)((r << 11) | (g << 5) | c);
}

static inline void plot(AASurface& s, int x, int y, uint16_t c, uint8_t a) {
  x -= s.x; y -= s.y;
  if ((unsigned)x >= (unsigned)s.w || (unsigned)y >= (unsigned)s.h || !a) return;
  uint16_t* p = &s.buf[y * s.w + x];
  *p = aaMix(*p, c, a);
}

// ---------------------------------------------------------------- text

static int glyphIndex(const AAFont& f, char c) {
  if (!c) return -1;
  const char* p = strchr(f.chars, c);
  return p ? (int)(p - f.chars) : -1;
}

static int advance(const AAFont& f, char c) {
  int i = glyphIndex(f, c);
  if (i < 0) i = glyphIndex(f, ' ');
  return i < 0 ? f.ascent / 3 : f.glyphs[i].adv;
}

int aaTextWidth(const AAFont& f, const char* txt, int tracking) {
  int w = 0, n = 0;
  for (const char* p = txt; *p; p++, n++) w += advance(f, *p);
  return n ? w + tracking * (n - 1) : 0;
}

int aaText(AASurface& s, int x, int baseline, const char* txt, const AAFont& f, uint16_t color, int tracking) {
  for (const char* p = txt; *p; p++) {
    int i = glyphIndex(f, *p);
    if (i >= 0 && s.buf) {
      const AAGlyph& g = f.glyphs[i];
      const uint8_t* bits = f.bits + g.offset;
      int gx = x + g.left, gy = baseline + g.top;
      for (int row = 0; row < g.h; row++) {
        int sy = gy + row - s.y;
        if ((unsigned)sy >= (unsigned)s.h) continue;
        for (int col = 0; col < g.w; col++) {
          int k = row * g.w + col;
          uint8_t v = (k & 1) ? (bits[k >> 1] & 15) : (bits[k >> 1] >> 4);
          if (v) plot(s, gx + col, gy + row, color, v * 17);
        }
      }
    }
    x += advance(f, *p) + (p[1] ? tracking : 0);
  }
  return x;
}

void aaTextCentered(AASurface& s, int cx, int baseline, const char* txt, const AAFont& f, uint16_t color, int tracking) {
  aaText(s, cx - aaTextWidth(f, txt, tracking) / 2, baseline, txt, f, color, tracking);
}

void aaTextRight(AASurface& s, int right, int baseline, const char* txt, const AAFont& f, uint16_t color, int tracking) {
  aaText(s, right - aaTextWidth(f, txt, tracking), baseline, txt, f, color, tracking);
}

// Half-resolution glow, scaled up with bilinear filtering.
static inline int glowAt(const uint8_t* bits, int w, int h, int x, int y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  int k = y * w + x;
  return (k & 1) ? (bits[k >> 1] & 15) : (bits[k >> 1] >> 4);
}

void aaGlow(AASurface& s, int x, int baseline, const char* txt, const AAFont& f, uint16_t color, uint8_t strength, int tracking) {
  if (!f.glow || !s.buf) return;
  for (const char* p = txt; *p; p++) {
    int i = glyphIndex(f, *p);
    if (i >= 0 && f.glows[i].w) {
      const AAGlyph& g = f.glyphs[i];
      const AAGlowGlyph& gg = f.glows[i];
      const uint8_t* bits = f.glow + gg.offset;
      int ox = x + g.left - f.glowPad, oy = baseline + g.top - f.glowPad;
      for (int v = 0; v < gg.h * 2; v++) {
        // full-res pixel v sits between half-res rows j0 and j0+1 (weights in quarters)
        int jy = (2 * v - 1) >> 2, fy = (2 * v - 1) - 4 * jy;
        for (int u = 0; u < gg.w * 2; u++) {
          int jx = (2 * u - 1) >> 2, fx = (2 * u - 1) - 4 * jx;
          int a = glowAt(bits, gg.w, gg.h, jx, jy) * (4 - fx) + glowAt(bits, gg.w, gg.h, jx + 1, jy) * fx;
          int b = glowAt(bits, gg.w, gg.h, jx, jy + 1) * (4 - fx) + glowAt(bits, gg.w, gg.h, jx + 1, jy + 1) * fx;
          int val = a * (4 - fy) + b * fy;                    // 0..240
          if (val) plot(s, ox + u, oy + v, color, (uint8_t)((val * 17 / 16) * strength / 255));
        }
      }
    }
    x += advance(f, *p) + (p[1] ? tracking : 0);
  }
}

// ---------------------------------------------------------------- shapes

static inline int clamp256(int v) { return v < 0 ? 0 : (v > 256 ? 256 : v); }
static inline uint8_t a8(int cov) { return cov >= 256 ? 255 : (uint8_t)cov; }

// A straight stroke with flat ends, edges smoothed. Per pixel it is all
// integer steps, so it is quick even without a floating point unit.
void aaLine(AASurface& s, float x0, float y0, float x1, float y1, float width, uint16_t color) {
  float dx = x1 - x0, dy = y1 - y0, len = sqrtf(dx * dx + dy * dy);
  if (len < 0.01f || !s.buf) return;
  float ux = dx / len, uy = dy / len, hw = width * 0.5f;
  int minx = (int)floorf(fminf(x0, x1) - hw - 1), maxx = (int)ceilf(fmaxf(x0, x1) + hw + 1);
  int miny = (int)floorf(fminf(y0, y1) - hw - 1), maxy = (int)ceilf(fmaxf(y0, y1) + hw + 1);
  minx = max(minx, (int)s.x); maxx = min(maxx, s.x + s.w - 1);
  miny = max(miny, (int)s.y); maxy = min(maxy, s.y + s.h - 1);
  int32_t UX = lroundf(ux * 256), UY = lroundf(uy * 256);
  int32_t HW = lroundf((hw + 0.5f) * 256), LEN = lroundf(len * 256);
  for (int y = miny; y <= maxy; y++) {
    float px = minx + 0.5f - x0, py = y + 0.5f - y0;
    int32_t t = lroundf((px * ux + py * uy) * 256);
    int32_t d = lroundf((py * ux - px * uy) * 256);
    for (int x = minx; x <= maxx; x++, t += UX, d -= UY) {
      int cov = clamp256(HW - abs(d));
      if (!cov) continue;
      cov = min(cov, clamp256(t + 128));
      cov = min(cov, clamp256(LEN - t + 128));
      if (cov > 0) plot(s, x, y, color, a8(cov));
    }
  }
}

// Rows of a disc: solid in the middle, smoothed only at the two edges.
void aaDisc(AASurface& s, float cx, float cy, float r, uint16_t color) {
  if (!s.buf) return;
  int y0 = max((int)floorf(cy - r - 1), (int)s.y), y1 = min((int)ceilf(cy + r + 1), s.y + s.h - 1);
  for (int y = y0; y <= y1; y++) {
    float dy = y + 0.5f - cy;
    float hc2 = (r + 1) * (r + 1) - dy * dy;
    if (hc2 <= 0) continue;
    float hc = sqrtf(hc2);
    int xa = (int)floorf(cx - hc), xb = (int)ceilf(cx + hc);
    float inner2 = (r - 1) * (r - 1) - dy * dy;
    float ic = inner2 > 0 ? sqrtf(inner2) : -1;
    for (int x = xa; x <= xb; x++) {
      float dx = x + 0.5f - cx;
      if (ic > 0 && fabsf(dx) < ic) {
        if (x - s.x >= 0 && x - s.x < s.w && y - s.y >= 0) s.buf[(y - s.y) * s.w + (x - s.x)] = color;
        continue;
      }
      float cov = r - sqrtf(dx * dx + dy * dy) + 0.5f;
      if (cov > 0) plot(s, x, y, color, cov >= 1 ? 255 : (uint8_t)(cov * 255));
    }
  }
}

void aaRing(AASurface& s, float cx, float cy, float r, float width, uint16_t color) {
  if (!s.buf) return;
  float ro = r + width * 0.5f + 1, ri = r - width * 0.5f - 1, hw = width * 0.5f + 0.5f;
  int y0 = max((int)floorf(cy - ro), (int)s.y), y1 = min((int)ceilf(cy + ro), s.y + s.h - 1);
  for (int y = y0; y <= y1; y++) {
    float dy = y + 0.5f - cy;
    float o2 = ro * ro - dy * dy;
    if (o2 <= 0) continue;
    float oc = sqrtf(o2), i2 = ri * ri - dy * dy, ic = i2 > 0 ? sqrtf(i2) : 0;
    for (int side = -1; side <= 1; side += 2) {
      int xa = (int)floorf(cx + (side < 0 ? -oc : ic)), xb = (int)ceilf(cx + (side < 0 ? -ic : oc));
      for (int x = xa; x <= xb; x++) {
        float dx = x + 0.5f - cx;
        float cov = hw - fabsf(sqrtf(dx * dx + dy * dy) - r);
        if (cov > 0) plot(s, x, y, color, cov >= 1 ? 255 : (uint8_t)(cov * 255));
      }
    }
  }
}

void aaRoundRect(AASurface& s, float x, float y, float w, float h, float r, uint16_t color) {
  if (!s.buf) return;
  float cx = x + w / 2, cy = y + h / 2, hx = w / 2 - r, hy = h / 2 - r;
  for (int py = (int)floorf(y); py <= (int)ceilf(y + h); py++) {
    for (int px = (int)floorf(x); px <= (int)ceilf(x + w); px++) {
      float qx = fmaxf(fabsf(px + 0.5f - cx) - hx, 0), qy = fmaxf(fabsf(py + 0.5f - cy) - hy, 0);
      float cov = r + 0.5f - sqrtf(qx * qx + qy * qy);
      if (cov > 0) plot(s, px, py, color, cov >= 1 ? 255 : (uint8_t)(cov * 255));
    }
  }
}
