#include <Arduino.h>
#include "display.h"
#include "anim.h"
#include "clockkeeper.h"
#include "faces.h"
#include "aa_text.h"
#include "ws_client.h"
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSans12pt7b.h>
#include <Fonts/FreeSans24pt7b.h>
#include <math.h>

Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC);

alignas(4) uint8_t artBuf[20004];  // drawn as uint16_t pixels
bool newArtReady = false;

static const uint16_t COLOR_BG_BLACK  = 0x0000;
static const uint16_t COLOR_BG_STEALTH= 0x0842; // Deep stealth black/navy
static const uint16_t COLOR_WHITE     = 0xFFFF;
static const uint16_t COLOR_MUTED     = 0x632C; // Slate gray
static const uint16_t COLOR_ACCENT    = 0x073F; // Electric Cyan
static const uint16_t COLOR_GREEN     = 0x07E6; // Matrix Green
static const uint16_t COLOR_RED_PULSE = 0xF8A4; // Tactical Red
static const uint16_t COLOR_RED_DARK  = 0x7800;

static ScreenMode lastModeDrawn = SCREEN_CONNECTING;

// Layouts are written for the full 240 rows; SY() maps such a row into the
// rows the case window shows (VIS_T..VIS_B, see display.h).
static constexpr int SY(int y) { return VIS_T + (y * VIS_H + 120) / 240; }
static constexpr int SH(int y, int h) { return SY(y + h) - SY(y); }
static constexpr int CAPTION_Y = VIS_B - 26;   // memory caption strip

void displayInit() {
  tft.begin();
  tft.setRotation(1); // Landscape 320x240
  tft.setSPISpeed(40000000);
  tft.fillScreen(COLOR_BG_BLACK);
}

// The cover's most vivid colour, for the light ring while music plays: each
// pixel counts by how saturated and bright it is, so a grey sleeve with one
// red stripe still gives red.
static uint8_t tintRGB[3] = { 30, 215, 96 };

static void measureArtTint() {
  const uint16_t* px = (const uint16_t*)artBuf;
  float r = 0, g = 0, b = 0, w = 0;
  for (int i = 0; i < 100 * 100; i += 3) {
    uint16_t c = px[i];
    float pr = ((c >> 11) & 31) / 31.0f, pg = ((c >> 5) & 63) / 63.0f, pb = (c & 31) / 31.0f;
    float mx = max(pr, max(pg, pb)), mn = min(pr, min(pg, pb));
    float wt = (mx - mn) * mx;                  // saturation times value
    wt *= wt;
    r += pr * wt; g += pg * wt; b += pb * wt; w += wt;
  }
  if (w < 0.5f) { tintRGB[0] = 200; tintRGB[1] = 190; tintRGB[2] = 170; return; }
  r /= w; g /= w; b /= w;
  float mx = max(r, max(g, b));
  if (mx < 0.01f) mx = 0.01f;
  tintRGB[0] = (uint8_t)(255 * r / mx);         // full brightness: the ring sets its own
  tintRGB[1] = (uint8_t)(255 * g / mx);
  tintRGB[2] = (uint8_t)(255 * b / mx);
}

void displayArtTint(uint8_t& r, uint8_t& g, uint8_t& b) {
  r = tintRGB[0]; g = tintRGB[1]; b = tintRGB[2];
}

// The cover arrives in strips (0xAA 0xBD, first row, row count, pixels) that
// each fit in one network packet. A whole 20 KB frame could arrive in pieces,
// and the websocket library then misread the stream and the clock restarted.
// Whole frames (0xAA 0xBB) are still taken if they get through.
void onNewArt(const uint8_t* data, size_t len) {
  static const size_t ROW_BYTES = 100 * 2;
  if (len >= 4 && data[0] == 0xAA && data[1] == 0xBD) {
    size_t row = data[2], rows = data[3];
    if (row + rows > 100 || len - 4 < rows * ROW_BYTES) return;
    memcpy(artBuf + row * ROW_BYTES, data + 4, rows * ROW_BYTES);
    if (row + rows == 100) { newArtReady = true; measureArtTint(); }   // the last strip completes the cover
  } else if (len >= 4 && data[0] == 0xAA && data[1] == 0xBB) {
    size_t copyLen = min(len - 4, (size_t)20000);
    memcpy(artBuf, data + 4, copyLen);
    newArtReady = true;
    measureArtTint();
  }
}

static char lastMemoryCaption[28] = "";
static uint16_t stripBuf[320 * 20]; // 12.8 KB static aligned buffer
static bool memoryImageLoaded = false;

void onNewMemoryStrip(const uint8_t* data, size_t len) {
  if (len < 8) return;
  if (data[0] != 0xAA || data[1] != 0xCC) return;

  uint16_t y_off   = data[2] | ((uint16_t)data[3] << 8);
  uint16_t strip_h = data[4] | ((uint16_t)data[5] << 8);
  uint16_t strip_w = data[6] | ((uint16_t)data[7] << 8);

  size_t expected_pixels = (size_t)strip_w * strip_h;
  if (expected_pixels > 320 * 20 || len < 8 + expected_pixels * 2) return;

  // Mark image as loaded/streaming so subsequent screen switches don't erase it with fillScreen
  memoryImageLoaded = true;

  // Safe aligned copy into SRAM buffer (fixes byte-alignment shift and prevents color distortion)
  memcpy(stripBuf, data + 8, expected_pixels * 2);

  // Stream directly into display hardware
  tft.drawRGBBitmap(0, y_off, stripBuf, strip_w, strip_h);

  // If this strip reaches the bottom, re-draw caption overlay if present
  if (y_off + strip_h > CAPTION_Y && lastMemoryCaption[0] != '\0') {
    tft.fillRect(0, CAPTION_Y, 320, 26, COLOR_BG_STEALTH);
    tft.drawFastHLine(0, CAPTION_Y, 320, tft.color565(40, 50, 65));
    tft.setFont(NULL);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_ACCENT);
    tft.setCursor(10, CAPTION_Y + 8);
    tft.print("MEMORY //");

    tft.setTextColor(COLOR_WHITE);
    tft.setCursor(72, CAPTION_Y + 8);
    tft.print(lastMemoryCaption);

    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(240, CAPTION_Y + 8);
    tft.print("<  OK  >");
  }
}

// ===================== DEPTH FACE (2.9) =====================
//  A photo with the time tucked behind the person. The Pi cuts the person
//  out and draws the whole face (photo, time, person, date), then sends it as
//  strips: 0xAA 0xDE, first row (2 bytes, little-endian), row count, then
//  320 RGB565 pixels per row. Rows count from the top of the case window.
//  Two rows a message keeps each one inside a network packet (see art.py).
//  Each minute only the rows that changed come again.
//
//  The clock asks for a picture (DEPTH_NEED) when the face opens and draws
//  Monolith until one arrives. If Sage goes quiet for a few minutes the
//  photo's time would go stale, so it goes back to Monolith and asks again.
static bool depthOn = false;                // the clock screen is showing the depth face
static bool depthShowing = false;           // a picture from the Pi is on screen
static unsigned long depthLastStrip = 0;
static unsigned long depthAskedAt = 0;
static const unsigned long DEPTH_STALE_MS = 150000;   // ~2.5 minutes without a strip
static const unsigned long DEPTH_ASK_MS   = 60000;    // ask again this often while waiting
static uint16_t depthRows[320 * 2];

void onDepthStrip(const uint8_t* data, size_t len) {
  if (!depthOn || lastModeDrawn != SCREEN_CLOCK || len < 5) return;
  uint16_t y = data[2] | ((uint16_t)data[3] << 8);
  uint8_t  n = data[4];
  if (n == 0 || n > 2 || len < 5 + (size_t)n * 640 || y + n > VIS_H) return;
  memcpy(depthRows, data + 5, (size_t)n * 640);   // aligned copy, as onNewMemoryStrip does
  tft.drawRGBBitmap(0, VIS_T + y, depthRows, 320, n);
  depthShowing = true;
  depthLastStrip = millis();
}

static void depthAsk() {
  depthAskedAt = millis();
  wsSend("{\"evt\":\"DEPTH_NEED\"}");
}

// Called on the clock screen with the depth face. True while the Pi's
// picture is up (so nothing else draws); false to draw Monolith.
static bool depthTick(bool opened) {
  unsigned long now = millis();
  if (opened) {
    depthShowing = false;
    depthAsk();
  } else if (depthShowing && now - depthLastStrip > DEPTH_STALE_MS) {
    depthShowing = false;
    faceReset();
    depthAsk();
  } else if (!depthShowing && now - depthAskedAt > DEPTH_ASK_MS) {
    depthAsk();
  }
  return depthShowing;
}

void drawProgressBar(int x, int y, int w, int h, float pct, uint16_t fillColor, uint16_t bgColor) {
  pct = constrain(pct, 0.0f, 1.0f);
  int fillW = (int)(w * pct);
  if (fillW > 0) {
    tft.fillRect(x, y, fillW, h, fillColor);
  }
  if (w - fillW > 0) {
    tft.fillRect(x + fillW, y, w - fillW, h, bgColor);
  }
}

// =====================================================================
//  CLOCK SCREEN
//
//  Black canvas, one hero time, one colour. The accent follows the same
//  day-phase palette the NeoPixel ring uses, and everything dims after dark so
//  the clock is easy on the eyes on a bedside table. The time is composed in an
//  off-screen canvas and pushed in one blit, so the colon can breathe without
//  a single flicker.
// =====================================================================
static const int CLK_CANVAS_W = 280;
static const int CLK_CANVAS_H = 80;
static const int CLK_CANVAS_X = (320 - CLK_CANVAS_W) / 2;
static const int CLK_CANVAS_Y = SY(38);
static const int CLK_BAR_X = 40, CLK_BAR_W = 240, CLK_BAR_Y = SY(134), CLK_BAR_H = 3;

static GFXcanvas16* timeCanvas = nullptr;
static bool          canvasTried = false;
static unsigned long clockEnterMs = 0;
static int           clockLastBarPx = -1;
static int           clockLastMinute = -1;
static uint8_t       clockLastColonStep = 255;
static bool          clockNeedsStatic = true;
// The minute turning over: Digital rolls the digits that changed up and out,
// Minimal cross-fades them. clkPrev* is the time being animated away from.
static int           clkShownH = -1, clkShownM = -1, clkPrevH = -1, clkPrevM = -1;
static unsigned long clkTurnMs = 0;
static bool          clkTurning = false;

static inline uint16_t mix565(uint16_t a, uint16_t b, float t) {
  t = constrain(t, 0.0f, 1.0f);
  int ar = (a >> 11) & 31, ag = (a >> 5) & 63, ab = a & 31;
  int br = (b >> 11) & 31, bg = (b >> 5) & 63, bb = b & 31;
  return (uint16_t)(((int)(ar + (br - ar) * t) << 11) | ((int)(ag + (bg - ag) * t) << 5) | (int)(ab + (bb - ab) * t));
}

static uint16_t scaled565(uint8_t r, uint8_t g, uint8_t b, float k) {
  k = constrain(k, 0.0f, 1.0f);
  return tft.color565((uint8_t)(r * k), (uint8_t)(g * k), (uint8_t)(b * k));
}

static void clockPalette(const ClockNow& c, uint16_t& accent, uint16_t& ink, uint16_t& muted, const char*& greeting, float fade) {
  PhaseStyle ph = clockPhase(c.minuteOfDay);
  float dim = (0.50f + 0.50f * ph.level) * fade;       // night = calm, not dark
  accent   = scaled565(ph.r, ph.g, ph.b, dim);
  ink      = scaled565(255, 255, 255, dim);
  muted    = scaled565(150, 156, 170, dim);
  greeting = ph.greeting;
}

static void centerText(const char* txt, int baseline, uint16_t color, const GFXfont* font) {
  int16_t x1, y1; uint16_t w, h;
  tft.setFont(font);
  tft.setTextSize(1);
  tft.getTextBounds(txt, 0, baseline, &x1, &y1, &w, &h);
  tft.setTextColor(color);
  tft.setCursor((320 - (int)w) / 2 - x1, baseline);
  tft.print(txt);
}

static void drawTempWithDegree(int x, int baseline, float temp, const char* cond, uint16_t color) {
  char num[12];
  snprintf(num, sizeof(num), "%.0f", temp);
  tft.setFont(&FreeSans9pt7b);
  tft.setTextSize(1);
  tft.setTextColor(color);
  tft.setCursor(x, baseline);
  tft.print(num);
  int cx = tft.getCursorX();
  tft.drawCircle(cx + 3, baseline - 9, 2, color);
  tft.setCursor(cx + 8, baseline);
  tft.print("C");
  if (cond && cond[0]) {
    char c[14];
    strncpy(c, cond, sizeof(c) - 1);
    c[sizeof(c) - 1] = '\0';
    c[0] = toupper(c[0]);
    tft.print("  ");
    tft.print(c);
  }
}

// h:m as the clock is set to show it: "18:05" or "6:05 PM".
static void formatTime(char* buf, size_t n, int h, int m, bool hour24) {
  if (hour24) {
    snprintf(buf, n, "%02d:%02d", h, m);
  } else {
    int dh = h % 12; if (dh == 0) dh = 12;
    snprintf(buf, n, "%d:%02d %s", dh, m, h >= 12 ? "PM" : "AM");
  }
}

static void rightText(const char* txt, int baseline, uint16_t color) {
  int16_t x1, y1; uint16_t w, h;
  tft.setFont(&FreeSans9pt7b);
  tft.setTextSize(1);
  tft.getTextBounds(txt, 0, baseline, &x1, &y1, &w, &h);
  tft.setTextColor(color);
  tft.setCursor(298 - (int)w - x1, baseline);
  tft.print(txt);
}

// "London 09:50": the second time zone, when Sage has set one.
static bool zone2Text(const LumoState& s, const ClockNow& c, char* buf, size_t n) {
  if (!s.zone2[0]) return false;
  int mins = ((c.h * 60 + c.m + s.zone2_offset) % 1440 + 1440) % 1440;
  char t[12];
  formatTime(t, sizeof(t), mins / 60, mins % 60, s.hour24);
  snprintf(buf, n, "%s %s", s.zone2, t);
  return true;
}

static void alarmText(const LumoState& s, char* buf, size_t n) {
  char t[12];
  formatTime(t, sizeof(t), s.alarm_h, s.alarm_m, s.hour24);
  snprintf(buf, n, "Alarm %s", t);
}

// Labels that change at most once a minute. Digital: greeting (or the second
// time zone), date, weather and alarm. Minimal: date and alarm only.
static void drawClockStatics(const LumoState& s, const ClockNow& c, float fade) {
  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  char buf[40];

  tft.fillRect(0, SY(6), 320, SH(6, 26), COLOR_BG_BLACK);
  if (zone2Text(s, c, buf, sizeof(buf))) centerText(buf, SY(24), accent, &FreeSans9pt7b);
  else if (s.clock_style == CLOCK_DIGITAL) centerText(greeting, SY(24), accent, &FreeSans9pt7b);

  tft.fillRect(0, SY(146), 320, SH(146, 36), COLOR_BG_BLACK);
  snprintf(buf, sizeof(buf), "%s, %s", s.weekday, s.date);
  centerText(buf, SY(172), ink, &FreeSans12pt7b);

  tft.fillRect(0, SY(196), 320, SH(196, 38), COLOR_BG_BLACK);
  if (s.clock_style == CLOCK_DIGITAL) drawTempWithDegree(22, SY(224), s.temp_c, s.weather_icon, muted);
  if (s.alarm_set) {
    alarmText(s, buf, sizeof(buf));
    rightText(buf, SY(224), s.alarm_ringing ? COLOR_RED_PULSE : (s.clock_style == CLOCK_MINIMAL ? muted : accent));
  }
  tft.setFont(NULL);
}

// =====================================================================
//  ANALOG CLOCK: a dial above, the date and alarm (or second zone) below.
// =====================================================================
static const int DIAL_X = 160, DIAL_Y = SY(102), DIAL_R = 88 * VIS_H / 240;
static const int HAND_H = DIAL_R * 50 / 88, HAND_M = DIAL_R * 74 / 88, HAND_S = DIAL_R * 80 / 88;
static float dialLast[3] = { -1, -1, -1 };   // hour, minute, second hand angles drawn

static void dialHand(float turns, int len, int width, uint16_t color) {
  float a = turns * 6.2831853f;
  float sx = sinf(a), cy = -cosf(a);
  int x = DIAL_X + (int)(sx * len), y = DIAL_Y + (int)(cy * len);
  for (int o = -(width / 2); o <= width / 2; o++) {
    tft.drawLine(DIAL_X + (int)(-cy * o), DIAL_Y + (int)(sx * o), x + (int)(-cy * o), y + (int)(sx * o), color);
  }
}

static void dialTicks(uint16_t major, uint16_t minor) {
  for (int i = 0; i < 60; i++) {
    float a = i / 60.0f * 6.2831853f;
    bool hour = (i % 5) == 0;
    int r0 = DIAL_R - (hour ? 10 : 4);
    tft.drawLine(DIAL_X + (int)(sinf(a) * r0), DIAL_Y - (int)(cosf(a) * r0),
                 DIAL_X + (int)(sinf(a) * DIAL_R), DIAL_Y - (int)(cosf(a) * DIAL_R), hour ? major : minor);
  }
}

static void drawAnalogStatics(const LumoState& s, const ClockNow& c, float fade) {
  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  char buf[40];
  tft.fillRect(0, SY(200), 320, VIS_B - SY(200), COLOR_BG_BLACK);
  snprintf(buf, sizeof(buf), "%s, %s", s.weekday, s.date);
  tft.setFont(&FreeSans9pt7b);
  tft.setTextSize(1);
  tft.setTextColor(ink);
  tft.setCursor(22, SY(226));
  tft.print(buf);
  if (s.alarm_set) {
    alarmText(s, buf, sizeof(buf));
    rightText(buf, SY(226), s.alarm_ringing ? COLOR_RED_PULSE : accent);
  } else if (zone2Text(s, c, buf, sizeof(buf))) {
    rightText(buf, SY(226), muted);
  }
  tft.setFont(NULL);
}

// The second hand ticks like a quartz movement (a quick step and a tiny
// bounce), and when the clock screen opens the hands spin round from twelve.
static void drawAnalogHands(const LumoState& s, const ClockNow& c, float fade, bool force) {
  float tick = (c.s - 1) + easeTick(c.secFrac / 0.22f);
  float sec = s.show_seconds ? (tick < 0 ? tick + 60 : tick) / 60.0f : -1.0f;
  float mn = (c.m + c.s / 60.0f) / 60.0f;
  float hr = ((c.h % 12) + c.m / 60.0f) / 12.0f;
  float enter = animProgress(clockEnterMs, millis(), 900);
  if (enter < 1) {
    float e = easeOutBack(enter);
    hr *= e; mn *= e;
    if (sec >= 0) sec *= e;
  }
  if (!force && fabsf(sec - dialLast[2]) < 0.0004f && fabsf(mn - dialLast[1]) < 0.002f) return;

  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  {   // wipe the hands where they were
    if (dialLast[0] >= 0) dialHand(dialLast[0], HAND_H, 5, COLOR_BG_BLACK);
    if (dialLast[1] >= 0) dialHand(dialLast[1], HAND_M, 3, COLOR_BG_BLACK);
    if (dialLast[2] >= 0) dialHand(dialLast[2], HAND_S, 1, COLOR_BG_BLACK);
  }
  dialTicks(ink, mix565(COLOR_BG_BLACK, muted, 0.6f));
  dialHand(hr, HAND_H, 5, ink);
  dialHand(mn, HAND_M, 3, ink);
  if (sec >= 0) dialHand(sec, HAND_S, 1, accent);
  tft.fillCircle(DIAL_X, DIAL_Y, 4, accent);
  dialLast[0] = hr; dialLast[1] = mn; dialLast[2] = sec;
}

static void drawClockTime(const LumoState& s, const ClockNow& c, float fade, bool force) {
  unsigned long now = millis();
  if (clkShownM >= 0 && c.m != clkShownM && fade >= 1.0f) {
    clkPrevH = clkShownH; clkPrevM = clkShownM;
    clkTurnMs = now;
    clkTurning = true;
  }
  clkShownH = c.h; clkShownM = c.m;
  bool minimal = s.clock_style == CLOCK_MINIMAL;
  bool turnFrame = clkTurning;
  float tr = 1.0f;
  if (clkTurning) {
    tr = animProgress(clkTurnMs, now, minimal ? 640 : 460);
    if (tr >= 1) clkTurning = false;            // this frame draws the end state
  }

  // Colon breathes once per second; quantised so we only blit when it visibly changes.
  float pulse = 0.5f + 0.5f * cosf(c.secFrac * 6.2831853f);     // 1 -> 0 -> 1
  uint8_t step = (uint8_t)(pulse * 12.0f);
  if (!force && !turnFrame && step == clockLastColonStep && fade >= 1.0f) return;
  clockLastColonStep = step;

  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  uint16_t colon = mix565(COLOR_BG_BLACK, ink, 0.45f + 0.55f * pulse);

  char hs[4], ms[4], phs[4], pms[4];
  auto hourStr = [&](int h, char* out) {
    int dh = h % 12; if (dh == 0) dh = 12;
    if (s.hour24) snprintf(out, 4, "%02d", h);
    else snprintf(out, 4, "%d", dh);
  };
  hourStr(c.h, hs);
  snprintf(ms, sizeof(ms), "%02d", c.m);
  hourStr(clkPrevH >= 0 ? clkPrevH : c.h, phs);
  snprintf(pms, sizeof(pms), "%02d", clkPrevM >= 0 ? clkPrevM : c.m);

  if (!canvasTried) {
    canvasTried = true;
    timeCanvas = new GFXcanvas16(CLK_CANVAS_W, CLK_CANVAS_H);
    if (timeCanvas && !timeCanvas->getBuffer()) { delete timeCanvas; timeCanvas = nullptr; }
  }

  // The canvas is the preferred path; with no heap left we draw straight to the
  // panel (it will shimmer a little, but the clock keeps working).
  Adafruit_GFX* g = timeCanvas ? (Adafruit_GFX*)timeCanvas : (Adafruit_GFX*)&tft;
  int ox = timeCanvas ? 0 : CLK_CANVAS_X;
  int oy = timeCanvas ? 0 : CLK_CANVAS_Y;
  const int baseline = oy + 72;

  if (timeCanvas) timeCanvas->fillScreen(COLOR_BG_BLACK);
  else tft.fillRect(CLK_CANVAS_X, CLK_CANVAS_Y, CLK_CANVAS_W, CLK_CANVAS_H, COLOR_BG_BLACK);

  // Each piece is placed by its ink, not its cursor: FreeSans digits carry
  // wide side bearings at size 2, and placing by cursor let the colon touch
  // the digits on either side.
  int16_t hx1, hy1, mx1, my1, ax1 = 0, ay1;
  uint16_t wh, hh, wm, hm, wap = 0, hap;
  g->setFont(&FreeSans24pt7b);
  g->setTextSize(2);
  g->getTextBounds(hs, 0, baseline, &hx1, &hy1, &wh, &hh);
  g->getTextBounds(ms, 0, baseline, &mx1, &my1, &wm, &hm);

  const char* ap = s.hour24 ? "" : ((c.h >= 12) ? "PM" : "AM");
  if (ap[0]) {
    g->setTextSize(1);
    g->setFont(&FreeSans12pt7b);
    g->getTextBounds(ap, 0, baseline, &ax1, &ay1, &wap, &hap);
  }

  const int dot = 7;                         // colon dot size
  const int apGap = ap[0] ? 12 : 0;
  int gap = 12;                              // between the digits and the colon
  int total = wh + gap + dot + gap + wm + apGap + wap;
  if (total > CLK_CANVAS_W - 4) {            // wide times ("12:58 PM") give up some air
    gap = max(5, gap - (total - (CLK_CANVAS_W - 4) + 1) / 2);
    total = wh + gap + dot + gap + wm + apGap + wap;
  }
  int x = ox + (CLK_CANVAS_W - total) / 2;

  // One group of digits (hours or minutes), mid turn-over if it changed. The
  // canvas cuts off whatever rolls past its edges; straight to the panel
  // there is no animation.
  bool animate = timeCanvas && tr < 1.0f;
  auto group = [&](const char* from, const char* to, int gx) {
    if (!animate || !strcmp(from, to)) {
      g->setTextColor(ink);
      g->setCursor(gx, baseline);
      g->print(to);
      return;
    }
    int fromX = gx;                             // the old digits leave from where the new ones land
    if (minimal) {                              // fade out, then fade in
      bool old = tr < 0.5f;
      float u = easeInOutCubic(old ? 1 - tr * 2 : tr * 2 - 1);
      g->setTextColor(mix565(COLOR_BG_BLACK, ink, u));
      g->setCursor(old ? fromX : gx, baseline);
      g->print(old ? from : to);
    } else {                                    // roll up
      int d = (int)(easeInOutCubic(tr) * CLK_CANVAS_H + 0.5f);
      g->setTextColor(ink);
      g->setCursor(fromX, baseline - d);
      g->print(from);
      g->setCursor(gx, baseline - d + CLK_CANVAS_H);
      g->print(to);
    }
  };

  g->setFont(&FreeSans24pt7b);
  g->setTextSize(2);
  group(phs, hs, x - hx1);
  x += wh + gap;

  // The colon is two squares centred on the digits, so it reads at a glance.
  int top = hy1, digitH = hh;            // bounds were taken at the baseline
  g->fillRect(x, top + digitH * 30 / 100 - dot / 2, dot, dot, colon);
  g->fillRect(x, top + digitH * 72 / 100 - dot / 2, dot, dot, colon);
  x += dot + gap;

  group(pms, ms, x - mx1);
  x += wm + apGap;

  if (ap[0]) {
    g->setTextSize(1);
    g->setFont(&FreeSans12pt7b);
    g->setTextColor(accent);
    g->setCursor(x - ax1, baseline);
    g->print(ap);
  }
  g->setFont(NULL);

  if (timeCanvas) {
    tft.drawRGBBitmap(CLK_CANVAS_X, CLK_CANVAS_Y, timeCanvas->getBuffer(), CLK_CANVAS_W, CLK_CANVAS_H);
  }
}

static void drawClockSeconds(const ClockNow& c, float fade, bool force) {
  float sec = c.s + c.secFrac;
  int px = (int)(CLK_BAR_W * sec / 60.0f);
  if (!force && px == clockLastBarPx) return;

  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  uint16_t track = mix565(COLOR_BG_BLACK, accent, 0.16f);

  if (force || px < clockLastBarPx) {
    tft.fillRoundRect(CLK_BAR_X, CLK_BAR_Y, CLK_BAR_W, CLK_BAR_H, 1, track);
    if (px > 0) tft.fillRect(CLK_BAR_X, CLK_BAR_Y, px, CLK_BAR_H, accent);
  } else if (px > clockLastBarPx) {
    int from = max(clockLastBarPx, 0);
    tft.fillRect(CLK_BAR_X + from, CLK_BAR_Y, px - from, CLK_BAR_H, accent);
  }
  clockLastBarPx = px;
}

// Called every loop while the clock is on screen; paces itself to ~30 fps.
void displayClockTick(const LumoState& s) {
  static unsigned long lastDraw = 0;
  unsigned long now = millis();
  bool entering = (now - clockEnterMs) < 700;
  if (!clockNeedsStatic && now - lastDraw < 33) return;
  lastDraw = now;

  ClockNow c = clockNow();
  if (!c.synced) {                      // no Pi yet: show whatever we were last told
    c.h = s.h; c.m = s.m; c.s = 0; c.secFrac = 0; c.minuteOfDay = s.h * 60.0f + s.m;
  }

  depthOn = s.clock_style == CLOCK_DEPTH;
  if (depthOn && depthTick(clockNeedsStatic)) {
    clockNeedsStatic = false;
    return;
  }
  if (faceIsPremium(s.clock_style)) {
    faceTick(s, c);
    clockNeedsStatic = false;
    return;
  }

  float fade = entering ? constrain((now - clockEnterMs) / 700.0f, 0.0f, 1.0f) : 1.0f;
  fade = fade * fade * (3.0f - 2.0f * fade);

  if (s.clock_style == CLOCK_ANALOG) {
    if (clockNeedsStatic || entering || c.m != clockLastMinute) {
      drawAnalogStatics(s, c, fade);
      clockLastMinute = c.m;
    }
    drawAnalogHands(s, c, fade, clockNeedsStatic || entering);
    clockNeedsStatic = false;
    return;
  }

  if (clockNeedsStatic || entering || c.m != clockLastMinute) {
    drawClockStatics(s, c, fade);
    clockLastMinute = c.m;
    clockNeedsStatic = false;
  }
  drawClockTime(s, c, fade, entering);
  if (c.synced && s.show_seconds) drawClockSeconds(c, fade, entering);
}

static void drawClockScreen(const LumoState& s, bool full) {
  if (full) {
    tft.fillScreen(COLOR_BG_BLACK);
    clockEnterMs = millis();
    clockNeedsStatic = true;
    clockLastBarPx = -1;
    clockLastMinute = -1;
    clockLastColonStep = 255;
    clkShownM = -1;
    clkTurning = false;
    dialLast[0] = dialLast[1] = dialLast[2] = -1;
    faceReset();
    // The classic time canvas and the smooth faces' buffer are big; keep only
    // the one the current style uses.
    if (faceIsPremium(s.clock_style)) {
      delete timeCanvas;
      timeCanvas = nullptr;
      canvasTried = false;
    } else {
      aaRelease();
    }
  }
  displayClockTick(s);
}

static void drawSystemScreen(const LumoState& s, bool full) {
  tft.setFont(NULL);

  if (full) {
    tft.fillScreen(COLOR_BG_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(COLOR_ACCENT);
    tft.setCursor(12, 10);
    tft.print("Raspberry Pi 5 Vitals");
    tft.drawFastHLine(10, 32, 300, tft.color565(50, 50, 60));

    tft.setTextSize(1);
    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(65, SY(220));
    tft.print("Controlled via Web Dashboard");
  }

  tft.fillRect(14, SY(42), 292, 18, COLOR_BG_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(14, SY(42));
  tft.printf("CPU Temp: %.1f C", s.cpu_temp);
  drawProgressBar(14, SY(64), 292, 8, s.cpu_temp / 85.0f, (s.cpu_temp > 70.0f ? COLOR_RED_PULSE : COLOR_ACCENT), tft.color565(40, 40, 50));

  tft.fillRect(14, SY(82), 292, 18, COLOR_BG_BLACK);
  tft.setCursor(14, SY(82));
  tft.printf("CPU Load: %d%%", s.cpu_pct);
  drawProgressBar(14, SY(104), 292, 8, s.cpu_pct / 100.0f, COLOR_GREEN, tft.color565(40, 40, 50));

  tft.fillRect(14, SY(122), 292, 18, COLOR_BG_BLACK);
  tft.setCursor(14, SY(122));
  tft.printf("RAM:      %d%%", s.ram_pct);
  drawProgressBar(14, SY(144), 292, 8, s.ram_pct / 100.0f, COLOR_ACCENT, tft.color565(40, 40, 50));

  tft.fillRect(14, SY(162), 292, 18, COLOR_BG_BLACK);
  tft.setCursor(14, SY(162));
  tft.printf("Disk:     %d%%", s.disk_pct);
  drawProgressBar(14, SY(184), 292, 8, s.disk_pct / 100.0f, COLOR_MUTED, tft.color565(40, 40, 50));
}

static void drawSpotifyScreen(const LumoState& s, bool full) {
  if (full) {
    // The clock's time canvas is big; the music screen draws through aa_text.
    delete timeCanvas;
    timeCanvas = nullptr;
    canvasTried = false;
    nowPlayingReset();
  }
  nowPlayingTick(s);
}

// The music screen lives with the smooth faces (faces.cpp).
void displaySpotifyTick(const LumoState& s) { nowPlayingTick(s); }

static void drawTasksScreen(const LumoState& s) {
  tft.setFont(NULL);
  tft.fillScreen(COLOR_BG_BLACK);

  // Header
  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(12, 10);
  if (s.task_count > 0) {
    char hdr[24];
    snprintf(hdr, sizeof(hdr), "Tasks (%d)", s.task_count);
    tft.print(hdr);
  } else {
    tft.print("Tasks");
  }

  // Date indicator on the right of header if available
  if (s.date[0] != '\0') {
    tft.setTextSize(1);
    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(215, 14);
    tft.print(s.date);
  }

  tft.drawFastHLine(10, 30, 300, tft.color565(50, 50, 60));

  if (s.task_count == 0) {
    tft.setTextSize(2);
    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(55, SY(100));
    tft.print("All tasks done!");
  } else {
    int y = 44;
    int drawn = 0;
    const int maxCharsPerLine = 44; // At textSize 1, 44 chars * 6px = 264px (fits comfortably in 320-30=290px)

    for (int i = 0; i < s.task_count && i < 5; i++) {
      if (y > SY(195)) break;

      // Draw bullet indicator
      tft.setTextSize(1);
      tft.setTextColor(COLOR_ACCENT);
      tft.setCursor(12, y);
      tft.print(">");

      // Split task into up to 2 lines cleanly
      const char* taskStr = s.tasks[i];
      int len = (int)strlen(taskStr);

      char line1[48];
      char line2[48];
      line1[0] = '\0';
      line2[0] = '\0';

      if (len <= maxCharsPerLine) {
        strncpy(line1, taskStr, sizeof(line1) - 1);
        line1[sizeof(line1) - 1] = '\0';
      } else {
        // Find last space before or at maxCharsPerLine
        int splitIdx = maxCharsPerLine;
        while (splitIdx > 15 && taskStr[splitIdx] != ' ') {
          splitIdx--;
        }
        if (taskStr[splitIdx] != ' ') {
          splitIdx = maxCharsPerLine; // Fallback hard break if no space found
        }

        int copyLen = splitIdx;
        if (copyLen > (int)sizeof(line1) - 1) copyLen = sizeof(line1) - 1;
        strncpy(line1, taskStr, copyLen);
        line1[copyLen] = '\0';

        // Skip spaces for line 2
        int start2 = splitIdx;
        while (taskStr[start2] == ' ' && start2 < len) start2++;

        if (start2 < len) {
          int remLen = len - start2;
          if (remLen > maxCharsPerLine) {
            strncpy(line2, taskStr + start2, maxCharsPerLine - 3);
            line2[maxCharsPerLine - 3] = '\0';
            strcat(line2, "...");
          } else {
            strncpy(line2, taskStr + start2, sizeof(line2) - 1);
            line2[sizeof(line2) - 1] = '\0';
          }
        }
      }

      // Render Line 1 (primary title in bright white)
      tft.setTextColor(COLOR_WHITE);
      tft.setCursor(24, y);
      tft.print(line1);

      // Render Line 2 if present (secondary continuation in muted silver)
      if (line2[0] != '\0') {
        y += 11;
        tft.setTextColor(tft.color565(170, 180, 195));
        tft.setCursor(24, y);
        tft.print(line2);
      }

      y += 18;
      drawn++;
    }

    // If more tasks remain that could not fit
    if (s.task_count > drawn && y <= SY(208)) {
      tft.setTextSize(1);
      tft.setTextColor(COLOR_MUTED);
      tft.setCursor(24, y);
      char overflow[32];
      snprintf(overflow, sizeof(overflow), "+ %d more on dashboard", s.task_count - drawn);
      tft.print(overflow);
    }
  }

  tft.setTextSize(1);
  tft.setTextColor(COLOR_MUTED);
  tft.setCursor(65, VIS_B - 14);
  tft.print("Controlled via Web Dashboard");
}

// Alarm: drawn once, then only a pulsing frame and the minute change. No more
// full-screen strobing; it is urgent without being harsh.
static bool alarmNeedsStatic = true;
static unsigned long alarmShownMs = 0;

static void drawAlarmFrame(float pulse) {
  uint16_t col = mix565(0x2000, COLOR_RED_PULSE, pulse);
  const int t = 5;
  tft.fillRect(0, VIS_T, 320, t, col);
  tft.fillRect(0, VIS_B - t, 320, t, col);
  tft.fillRect(0, VIS_T + t, t, VIS_H - 2 * t, col);
  tft.fillRect(320 - t, VIS_T + t, t, VIS_H - 2 * t, col);
}

void displayAlarmReset() { alarmNeedsStatic = true; }

void displayAlarmTick(const LumoState& s) {
  static unsigned long lastDraw = 0;
  static int lastMin = -1;
  unsigned long now = millis();
  if (!alarmNeedsStatic && now - lastDraw < 50) return;
  lastDraw = now;

  ClockNow c = clockNow();
  if (!c.synced) { c.h = s.h; c.m = s.m; }

  if (alarmNeedsStatic) {
    alarmShownMs = now;
    tft.fillScreen(COLOR_BG_BLACK);
    centerText("ALARM", SY(52), COLOR_RED_PULSE, &FreeSans12pt7b);
    char hint[48];
    snprintf(hint, sizeof(hint), s.local_ringing ? "RIGHT: %u more min    Other: stop" : "Press a button to stop", s.snooze_minutes);
    centerText(hint, SY(214), COLOR_MUTED, &FreeSans9pt7b);
    lastMin = -1;
    alarmNeedsStatic = false;
  }

  if (c.m != lastMin) {
    lastMin = c.m;
    tft.fillRect(10, SY(140) - 70, 300, 90, COLOR_BG_BLACK);
    uint8_t dh = c.h % 12; if (dh == 0) dh = 12;
    char tb[8];
    snprintf(tb, sizeof(tb), "%d:%02d", dh, c.m);
    int16_t x1, y1; uint16_t w, h;
    tft.setFont(&FreeSans24pt7b);
    tft.setTextSize(2);
    tft.getTextBounds(tb, 0, SY(140), &x1, &y1, &w, &h);
    tft.setTextColor(COLOR_WHITE);
    tft.setCursor((320 - (int)w) / 2 - x1, SY(140));
    tft.print(tb);
    tft.setTextSize(1);
    tft.setFont(NULL);
  }

  // The frame beats with the motor and the light: "bu-bump" every 1.3 s.
  float u = fmodf((now - alarmShownMs) / 1000.0f, 1.3f);
  auto swell = [](float x, float len) {
    if (x < 0 || x >= len) return 0.0f;
    float r = animClamp(x / 0.15f), f = 1 - x / len;
    return r * r * (3 - 2 * r) * f * f;
  };
  float pulse = animClamp(swell(u, 0.5f) + 0.7f * swell(u - 0.26f, 0.6f));
  drawAlarmFrame(pulse);
}

// Connecting: the eyes and caption are drawn once; only three dots breathe.
static bool connNeedsStatic = true;

void displayConnectingReset() { connNeedsStatic = true; }

void displayConnectingTick(const LumoState& s) {
  static unsigned long lastDraw = 0;
  unsigned long now = millis();
  if (!connNeedsStatic && now - lastDraw < 80) return;
  lastDraw = now;

  if (connNeedsStatic) {
    tft.fillScreen(COLOR_BG_STEALTH);
    centerText("LUMO", SY(108), COLOR_WHITE, &FreeSans24pt7b);
    centerText("v" FW_VERSION, SY(132), COLOR_MUTED, &FreeSans9pt7b);
    if (s.pair_refused) {
      centerText("Not paired", SY(168), COLOR_RED_PULSE, &FreeSans12pt7b);
      centerText("Check DESK_TOKEN in secrets.h", SY(222), COLOR_MUTED, &FreeSans9pt7b);
    } else {
      centerText("Connecting", SY(168), COLOR_WHITE, &FreeSans12pt7b);
      char ipBuf[40];
      snprintf(ipBuf, sizeof(ipBuf), "%s", PI_HOSTNAME);
      centerText(ipBuf, SY(222), COLOR_MUTED, &FreeSans9pt7b);
    }
    tft.setFont(NULL);
    connNeedsStatic = false;
  }

  for (int i = 0; i < 3; i++) {
    float phase = now / 1000.0f * 3.2f - i * 0.7f;
    float k = 0.5f + 0.5f * sinf(phase);
    tft.fillCircle(144 + i * 16, SY(190), 4, mix565(COLOR_BG_STEALTH, COLOR_ACCENT, 0.15f + 0.85f * k));
  }
}

// A reminder or notification, over whatever was on screen (the sketch goes
// back to that screen when the card is answered or times out). Cards with
// actions show what LEFT, OK and RIGHT do along the bottom.
static void drawCardScreen(const LumoState& s) {
  const uint16_t panel = tft.color565(21, 26, 34);
  bool hasActions = s.act_left[0] || s.act_ok[0] || s.act_right[0];
  tft.fillScreen(COLOR_BG_BLACK);
  const int panelH = hasActions ? SH(18, 164) : SH(18, 204);
  tft.fillRoundRect(12, SY(18), 296, panelH, 10, panel);
  tft.drawRoundRect(12, SY(18), 296, panelH, 10, COLOR_ACCENT);

  tft.setFont(NULL);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_ACCENT);
  tft.setCursor(28, SY(32));
  tft.print(s.notif_app);

  tft.setFont(&FreeSans12pt7b);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(28, SY(72));
  tft.print(s.notif_title);

  // The body wraps on spaces, about 30 characters to a line, three lines.
  tft.setFont(&FreeSans9pt7b);
  tft.setTextColor(tft.color565(170, 178, 192));
  const char* p = s.notif_body;
  int y = SY(104);
  for (int line = 0; line < 3 && *p; line++) {
    while (*p == ' ') p++;
    int len = strlen(p), take = len;
    if (len > 30) {
      take = 30;
      while (take > 0 && p[take] != ' ') take--;
      if (take == 0) take = 30;
    }
    char row[32];
    strlcpy(row, p, min(take + 1, (int)sizeof(row)));
    tft.setCursor(28, y);
    tft.print(row);
    p += take;
    y += SH(104, 24);
  }

  if (hasActions) {
    const char* labels[3] = { s.act_left, s.act_ok, s.act_right };
    const char* keys[3]   = { "<", "OK", ">" };
    const int btnY = SY(196);
    for (int i = 0; i < 3; i++) {
      int x = 12 + i * 102;
      if (!labels[i][0]) continue;
      bool primary = (i == 1);
      if (primary) tft.fillRoundRect(x, btnY, 92, 32, 6, COLOR_ACCENT);
      else tft.drawRoundRect(x, btnY, 92, 32, 6, COLOR_MUTED);
      char text[20];
      if (i == 2) snprintf(text, sizeof(text), "%s %s", labels[i], keys[i]);   // "Snooze >"
      else snprintf(text, sizeof(text), "%s %s", keys[i], labels[i]);         // "< Tomorrow", "OK Done"
      int16_t x1, y1; uint16_t w, h;
      tft.setFont(NULL);
      tft.setTextSize(1);
      tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
      tft.setTextColor(primary ? COLOR_BG_BLACK : COLOR_WHITE);
      tft.setCursor(x + (92 - (int)w) / 2, btnY + 12);
      tft.print(text);
    }
  }
  tft.setFont(NULL);
}

static void drawMemoryScreen(const LumoState& s, bool full) {
  strncpy(lastMemoryCaption, s.mem_caption, sizeof(lastMemoryCaption) - 1);
  lastMemoryCaption[sizeof(lastMemoryCaption) - 1] = '\0';

  // Only fill with black and show placeholder if no memory image has been streamed yet
  if (full && !memoryImageLoaded) {
    tft.fillScreen(COLOR_BG_BLACK);
    tft.setFont(NULL);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(85, SY(115));
    tft.print("Receiving Memory Photo...");
  }

  if (s.mem_caption[0] != '\0') {
    tft.fillRect(0, CAPTION_Y, 320, 26, COLOR_BG_STEALTH);
    tft.drawFastHLine(0, CAPTION_Y, 320, tft.color565(40, 50, 65));
    tft.setFont(NULL);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_ACCENT);
    tft.setCursor(10, CAPTION_Y + 8);
    tft.print("MEMORY //");

    tft.setTextColor(COLOR_WHITE);
    tft.setCursor(72, CAPTION_Y + 8);
    tft.print(s.mem_caption);

    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(240, CAPTION_Y + 8);
    tft.print("<  OK  >");
  }
}

void displayDrawScreen(ScreenMode mode, const LumoState& s, bool forceFullRedraw) {
  if (mode != SCREEN_MEMORY) {
    memoryImageLoaded = false;
  }
  if (mode != SCREEN_CLOCK) depthOn = false;
  bool modeChanged = (mode != lastModeDrawn) || forceFullRedraw;
  lastModeDrawn = mode;

  switch (mode) {
    case SCREEN_CARD:
      drawCardScreen(s);
      break;
    case SCREEN_CLOCK:
      drawClockScreen(s, modeChanged);
      break;
    case SCREEN_SYSTEM:
      drawSystemScreen(s, modeChanged);
      break;
    case SCREEN_SPOTIFY:
      drawSpotifyScreen(s, modeChanged);
      break;
    case SCREEN_TASKS:
      drawTasksScreen(s);
      break;
    case SCREEN_ALARM:
      if (modeChanged) displayAlarmReset();
      displayAlarmTick(s);
      break;
    case SCREEN_CONNECTING:
      if (modeChanged) displayConnectingReset();
      displayConnectingTick(s);
      break;
    case SCREEN_MEMORY:
      drawMemoryScreen(s, modeChanged);
      break;
    case SCREEN_TIMER:
    case SCREEN_STOPWATCH:
    case SCREEN_WORLD:
      if (modeChanged) {
        tft.fillScreen(0x0841);
        toolScreenReset();
      }
      toolScreenTick(mode, s);
      break;
  }
}
