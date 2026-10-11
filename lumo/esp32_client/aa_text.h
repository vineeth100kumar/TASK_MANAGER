#pragma once
#include <Arduino.h>

// Smooth (anti-aliased) drawing for the premium clock faces.
//
// Adafruit GFX draws 1-bit pixels only, so everything here is drawn into an
// RGB565 buffer first (blending each edge pixel with what is under it) and
// then pushed to the panel in one go: no flicker, and soft edges everywhere.
// Glyphs come from aa_fonts.h, made by lumo/tools/make_aa_fonts.py.

struct AAGlyph     { uint32_t offset; uint8_t w, h; int8_t left, top; uint8_t adv; };
struct AAGlowGlyph { uint32_t offset; uint8_t w, h; };
struct AAFont {
  const uint8_t*     bits;      // 4-bit coverage, two pixels a byte
  const AAGlyph*     glyphs;
  const char*        chars;     // the characters in `glyphs`, in order ('\x7F' is '°')
  uint8_t            count;
  uint8_t            ascent;    // tallest glyph above the baseline
  uint8_t            descent;   // deepest glyph below it
  const uint8_t*     glow;      // optional soft glow, half resolution
  const AAGlowGlyph* glows;
  uint8_t            glowPad;   // how far the glow reaches past the glyph
};

// A rectangle of the screen being drawn off-screen. Coordinates passed to the
// drawing calls are screen coordinates; anything outside the rectangle is cut.
struct AASurface { uint16_t* buf; int16_t x, y, w, h; };

// Starts a surface filled with `bg`. Only one can be open at a time: the
// buffer is shared. ok is false (and nothing is drawn) when memory is short.
bool aaBegin(AASurface& s, int x, int y, int w, int h, uint16_t bg);
void aaEnd(AASurface& s);          // pushes it to the panel
void aaRelease();                  // frees the shared buffer

uint16_t aaRGB(uint8_t r, uint8_t g, uint8_t b, float k = 1.0f);   // k dims
uint16_t aaMix(uint16_t a, uint16_t b, uint8_t t);                  // t 0..255 towards b

int  aaTextWidth(const AAFont& f, const char* txt, int tracking = 0);
// Left-aligned at x on the baseline; returns the x after the text.
int  aaText(AASurface& s, int x, int baseline, const char* txt, const AAFont& f, uint16_t color, int tracking = 0);
void aaTextCentered(AASurface& s, int cx, int baseline, const char* txt, const AAFont& f, uint16_t color, int tracking = 0);
void aaTextRight(AASurface& s, int right, int baseline, const char* txt, const AAFont& f, uint16_t color, int tracking = 0);
// The glow layer of a glow font (draw it before the text itself).
void aaGlow(AASurface& s, int x, int baseline, const char* txt, const AAFont& f, uint16_t color, uint8_t strength, int tracking = 0);

void aaLine(AASurface& s, float x0, float y0, float x1, float y1, float width, uint16_t color);
void aaDisc(AASurface& s, float cx, float cy, float r, uint16_t color);
void aaRing(AASurface& s, float cx, float cy, float r, float width, uint16_t color);
void aaRoundRect(AASurface& s, float x, float y, float w, float h, float r, uint16_t color);
