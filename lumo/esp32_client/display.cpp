#include <Arduino.h>
#include "display.h"
#include "clockkeeper.h"
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSans12pt7b.h>
#include <Fonts/FreeSans24pt7b.h>
#include <math.h>

Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC);

uint8_t artBuf[20004];
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

void displayInit() {
  tft.begin();
  tft.setRotation(1); // Landscape 320x240
  tft.setSPISpeed(40000000);
  tft.fillScreen(COLOR_BG_BLACK);
}

void onNewArt(const uint8_t* data, size_t len) {
  if (len >= 4 && data[0] == 0xAA && data[1] == 0xBB) {
    size_t copyLen = min(len - 4, (size_t)20000);
    memcpy(artBuf, data + 4, copyLen);
    newArtReady = true;
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
  if (y_off + strip_h >= 240 && lastMemoryCaption[0] != '\0') {
    tft.fillRect(0, 214, 320, 26, COLOR_BG_STEALTH);
    tft.drawFastHLine(0, 214, 320, tft.color565(40, 50, 65));
    tft.setFont(NULL);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_ACCENT);
    tft.setCursor(10, 222);
    tft.print("MEMORY //");

    tft.setTextColor(COLOR_WHITE);
    tft.setCursor(72, 222);
    tft.print(lastMemoryCaption);

    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(240, 222);
    tft.print("<  OK  >");
  }
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
static const int CLK_CANVAS_Y = 38;
static const int CLK_BAR_X = 40, CLK_BAR_W = 240, CLK_BAR_Y = 134, CLK_BAR_H = 3;

static GFXcanvas16* timeCanvas = nullptr;
static bool          canvasTried = false;
static unsigned long clockEnterMs = 0;
static int           clockLastBarPx = -1;
static int           clockLastMinute = -1;
static uint8_t       clockLastColonStep = 255;
static bool          clockNeedsStatic = true;

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

  tft.fillRect(0, 6, 320, 26, COLOR_BG_BLACK);
  if (zone2Text(s, c, buf, sizeof(buf))) centerText(buf, 24, accent, &FreeSans9pt7b);
  else if (s.clock_style == CLOCK_DIGITAL) centerText(greeting, 24, accent, &FreeSans9pt7b);

  tft.fillRect(0, 146, 320, 36, COLOR_BG_BLACK);
  snprintf(buf, sizeof(buf), "%s, %s", s.weekday, s.date);
  centerText(buf, 172, ink, &FreeSans12pt7b);

  tft.fillRect(0, 196, 320, 38, COLOR_BG_BLACK);
  if (s.clock_style == CLOCK_DIGITAL) drawTempWithDegree(22, 224, s.temp_c, s.weather_icon, muted);
  if (s.alarm_set) {
    alarmText(s, buf, sizeof(buf));
    rightText(buf, 224, s.alarm_ringing ? COLOR_RED_PULSE : (s.clock_style == CLOCK_MINIMAL ? muted : accent));
  }
  tft.setFont(NULL);
}

// =====================================================================
//  ANALOG CLOCK: a dial above, the date and alarm (or second zone) below.
// =====================================================================
static const int DIAL_X = 160, DIAL_Y = 102, DIAL_R = 88;
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
  tft.fillRect(0, 200, 320, 40, COLOR_BG_BLACK);
  snprintf(buf, sizeof(buf), "%s, %s", s.weekday, s.date);
  tft.setFont(&FreeSans9pt7b);
  tft.setTextSize(1);
  tft.setTextColor(ink);
  tft.setCursor(22, 226);
  tft.print(buf);
  if (s.alarm_set) {
    alarmText(s, buf, sizeof(buf));
    rightText(buf, 226, s.alarm_ringing ? COLOR_RED_PULSE : accent);
  } else if (zone2Text(s, c, buf, sizeof(buf))) {
    rightText(buf, 226, muted);
  }
  tft.setFont(NULL);
}

static void drawAnalogHands(const LumoState& s, const ClockNow& c, float fade, bool force) {
  float sec = s.show_seconds ? (c.s / 60.0f) : -1.0f;
  float mn = (c.m + c.s / 60.0f) / 60.0f;
  float hr = ((c.h % 12) + c.m / 60.0f) / 12.0f;
  if (!force && sec == dialLast[2] && fabsf(mn - dialLast[1]) < 0.002f) return;

  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  if (!force) {   // wipe the hands where they were
    if (dialLast[0] >= 0) dialHand(dialLast[0], 50, 5, COLOR_BG_BLACK);
    if (dialLast[1] >= 0) dialHand(dialLast[1], 74, 3, COLOR_BG_BLACK);
    if (dialLast[2] >= 0) dialHand(dialLast[2], 80, 1, COLOR_BG_BLACK);
  }
  dialTicks(ink, mix565(COLOR_BG_BLACK, muted, 0.6f));
  dialHand(hr, 50, 5, ink);
  dialHand(mn, 74, 3, ink);
  if (sec >= 0) dialHand(sec, 80, 1, accent);
  tft.fillCircle(DIAL_X, DIAL_Y, 4, accent);
  dialLast[0] = hr; dialLast[1] = mn; dialLast[2] = sec;
}

static void drawClockTime(const LumoState& s, const ClockNow& c, float fade, bool force) {
  // Colon breathes once per second; quantised so we only blit when it visibly changes.
  float pulse = 0.5f + 0.5f * cosf(c.secFrac * 6.2831853f);     // 1 -> 0 -> 1
  uint8_t step = (uint8_t)(pulse * 12.0f);
  if (!force && step == clockLastColonStep && fade >= 1.0f) return;
  clockLastColonStep = step;

  uint16_t accent, ink, muted; const char* greeting;
  clockPalette(c, accent, ink, muted, greeting, fade);
  uint16_t colon = mix565(COLOR_BG_BLACK, ink, 0.25f + 0.75f * pulse);

  uint8_t dispH = c.h % 12; if (dispH == 0) dispH = 12;
  char hs[4], ms[4];
  if (s.hour24) snprintf(hs, sizeof(hs), "%02d", c.h);
  else snprintf(hs, sizeof(hs), "%d", dispH);
  snprintf(ms, sizeof(ms), "%02d", c.m);

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

  int16_t x1, y1; uint16_t wh, wm, wc, hh;
  g->setFont(&FreeSans24pt7b);
  g->setTextSize(2);
  g->getTextBounds(hs, 0, baseline, &x1, &y1, &wh, &hh);
  g->getTextBounds(ms, 0, baseline, &x1, &y1, &wm, &hh);
  g->getTextBounds(":", 0, baseline, &x1, &y1, &wc, &hh);

  const int gap = 3;
  g->setTextSize(1);
  g->setFont(&FreeSans12pt7b);
  uint16_t wap = 0, hap;
  const char* ap = s.hour24 ? "" : ((c.h >= 12) ? "PM" : "AM");
  if (ap[0]) g->getTextBounds(ap, 0, baseline, &x1, &y1, &wap, &hap);
  g->setFont(&FreeSans24pt7b);
  g->setTextSize(2);

  int total = wh + gap + wc + gap + wm + (ap[0] ? 8 + wap : 0);
  int x = ox + (CLK_CANVAS_W - total) / 2;

  g->setTextColor(ink);
  g->setCursor(x, baseline);
  g->print(hs);
  x += wh + gap;
  g->setTextColor(colon);
  g->setCursor(x, baseline);
  g->print(":");
  x += wc + gap;
  g->setTextColor(ink);
  g->setCursor(x, baseline);
  g->print(ms);
  x += wm + 8;

  g->setTextSize(1);
  g->setFont(&FreeSans12pt7b);
  g->setTextColor(accent);
  g->setCursor(x, baseline);
  g->print(ap);
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
    dialLast[0] = dialLast[1] = dialLast[2] = -1;
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
    tft.setCursor(65, 220);
    tft.print("Controlled via Web Dashboard");
  }

  tft.fillRect(14, 42, 292, 18, COLOR_BG_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(14, 42);
  tft.printf("CPU Temp: %.1f C", s.cpu_temp);
  drawProgressBar(14, 64, 292, 8, s.cpu_temp / 85.0f, (s.cpu_temp > 70.0f ? COLOR_RED_PULSE : COLOR_ACCENT), tft.color565(40, 40, 50));

  tft.fillRect(14, 82, 292, 18, COLOR_BG_BLACK);
  tft.setCursor(14, 82);
  tft.printf("CPU Load: %d%%", s.cpu_pct);
  drawProgressBar(14, 104, 292, 8, s.cpu_pct / 100.0f, COLOR_GREEN, tft.color565(40, 40, 50));

  tft.fillRect(14, 122, 292, 18, COLOR_BG_BLACK);
  tft.setCursor(14, 122);
  tft.printf("RAM:      %d%%", s.ram_pct);
  drawProgressBar(14, 144, 292, 8, s.ram_pct / 100.0f, COLOR_ACCENT, tft.color565(40, 40, 50));

  tft.fillRect(14, 162, 292, 18, COLOR_BG_BLACK);
  tft.setCursor(14, 162);
  tft.printf("Disk:     %d%%", s.disk_pct);
  drawProgressBar(14, 184, 292, 8, s.disk_pct / 100.0f, COLOR_MUTED, tft.color565(40, 40, 50));
}

static void drawSpotifyScreen(const LumoState& s, bool full) {
  tft.setFont(NULL);

  if (full) {
    tft.fillScreen(COLOR_BG_BLACK);

    tft.setTextSize(2);
    tft.setTextColor(COLOR_GREEN);
    tft.setCursor(12, 10);
    tft.print("Now Playing");

    tft.setTextColor(COLOR_WHITE);
    tft.setCursor(255, 10);
    tft.print("LUMO");
    tft.drawFastHLine(10, 32, 300, tft.color565(40, 40, 50));

    tft.setTextSize(1);
    tft.setCursor(30, 218);
    tft.print("Controlled via Local Web Dashboard");
  }

  if (newArtReady || full) {
    tft.drawRect(10, 42, 104, 104, tft.color565(60, 60, 70));
    tft.drawRGBBitmap(12, 44, (uint16_t*)artBuf, 100, 100);
    newArtReady = false;
  }

  tft.fillRect(122, 42, 195, 104, COLOR_BG_BLACK);

  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(124, 46);
  char titleCut[16];
  strncpy(titleCut, s.sp_title, 15);
  titleCut[15] = '\0';
  tft.print(strlen(titleCut) > 0 ? titleCut : "No Track");

  tft.setTextColor(COLOR_MUTED);
  tft.setCursor(124, 72);
  char artistCut[16];
  strncpy(artistCut, s.sp_artist, 15);
  artistCut[15] = '\0';
  tft.print(strlen(artistCut) > 0 ? artistCut : "Idle");

  tft.setTextSize(1);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(124, 108);
  int curSec = s.sp_progress_ms / 1000;
  int totSec = s.sp_duration_ms / 1000;
  if (totSec > 0) {
    tft.printf("%d:%02d / %d:%02d", curSec / 60, curSec % 60, totSec / 60, totSec % 60);
  }

  tft.setTextColor(s.sp_playing ? COLOR_GREEN : COLOR_MUTED);
  tft.setCursor(124, 126);
  tft.print(s.sp_playing ? "[PLAYING]" : "[PAUSED]");

  float pct = (s.sp_duration_ms > 0) ? ((float)s.sp_progress_ms / s.sp_duration_ms) : 0.0f;
  drawProgressBar(12, 162, 296, 8, pct, COLOR_GREEN, tft.color565(40, 40, 40));

  tft.setTextColor(COLOR_MUTED);
  tft.setCursor(12, 186);
  tft.print("< Prev        OK Play/Pause        Next >");
}

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
    tft.setCursor(55, 100);
    tft.print("All tasks done!");
  } else {
    int y = 44;
    int drawn = 0;
    const int maxCharsPerLine = 44; // At textSize 1, 44 chars * 6px = 264px (fits comfortably in 320-30=290px)

    for (int i = 0; i < s.task_count && i < 5; i++) {
      if (y > 195) break;

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
    if (s.task_count > drawn && y <= 208) {
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
  tft.setCursor(65, 226);
  tft.print("Controlled via Web Dashboard");
}

// Alarm: drawn once, then only a pulsing frame and the minute change. No more
// full-screen strobing; it is urgent without being harsh.
static bool alarmNeedsStatic = true;

static void drawAlarmFrame(float pulse) {
  uint16_t col = mix565(0x2000, COLOR_RED_PULSE, pulse);
  const int t = 5;
  tft.fillRect(0, 0, 320, t, col);
  tft.fillRect(0, 240 - t, 320, t, col);
  tft.fillRect(0, t, t, 240 - 2 * t, col);
  tft.fillRect(320 - t, t, t, 240 - 2 * t, col);
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
    tft.fillScreen(COLOR_BG_BLACK);
    centerText("ALARM", 52, COLOR_RED_PULSE, &FreeSans12pt7b);
    char hint[48];
    snprintf(hint, sizeof(hint), s.local_ringing ? "RIGHT: %u more min    Other: stop" : "Press a button to stop", s.snooze_minutes);
    centerText(hint, 214, COLOR_MUTED, &FreeSans9pt7b);
    lastMin = -1;
    alarmNeedsStatic = false;
  }

  if (c.m != lastMin) {
    lastMin = c.m;
    tft.fillRect(10, 70, 300, 90, COLOR_BG_BLACK);
    uint8_t dh = c.h % 12; if (dh == 0) dh = 12;
    char tb[8];
    snprintf(tb, sizeof(tb), "%d:%02d", dh, c.m);
    int16_t x1, y1; uint16_t w, h;
    tft.setFont(&FreeSans24pt7b);
    tft.setTextSize(2);
    tft.getTextBounds(tb, 0, 140, &x1, &y1, &w, &h);
    tft.setTextColor(COLOR_WHITE);
    tft.setCursor((320 - (int)w) / 2 - x1, 140);
    tft.print(tb);
    tft.setTextSize(1);
    tft.setFont(NULL);
  }

  float pulse = 0.5f + 0.5f * sinf(now / 1000.0f * 6.2831853f * 1.6f);
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
    centerText("LUMO", 108, COLOR_WHITE, &FreeSans24pt7b);
    centerText("v" FW_VERSION, 132, COLOR_MUTED, &FreeSans9pt7b);
    if (s.pair_refused) {
      centerText("Not paired", 168, COLOR_RED_PULSE, &FreeSans12pt7b);
      centerText("Check DESK_TOKEN in secrets.h", 222, COLOR_MUTED, &FreeSans9pt7b);
    } else {
      centerText("Connecting", 168, COLOR_WHITE, &FreeSans12pt7b);
      char ipBuf[40];
      snprintf(ipBuf, sizeof(ipBuf), "%s", PI_HOSTNAME);
      centerText(ipBuf, 222, COLOR_MUTED, &FreeSans9pt7b);
    }
    tft.setFont(NULL);
    connNeedsStatic = false;
  }

  for (int i = 0; i < 3; i++) {
    float phase = now / 1000.0f * 3.2f - i * 0.7f;
    float k = 0.5f + 0.5f * sinf(phase);
    tft.fillCircle(144 + i * 16, 190, 4, mix565(COLOR_BG_STEALTH, COLOR_ACCENT, 0.15f + 0.85f * k));
  }
}

// A reminder or notification, over whatever was on screen (the sketch goes
// back to that screen when the card is answered or times out). Cards with
// actions show what LEFT, OK and RIGHT do along the bottom.
static void drawCardScreen(const LumoState& s) {
  const uint16_t panel = tft.color565(21, 26, 34);
  bool hasActions = s.act_left[0] || s.act_ok[0] || s.act_right[0];
  tft.fillScreen(COLOR_BG_BLACK);
  tft.fillRoundRect(12, 18, 296, hasActions ? 164 : 204, 10, panel);
  tft.drawRoundRect(12, 18, 296, hasActions ? 164 : 204, 10, COLOR_ACCENT);

  tft.setFont(NULL);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_ACCENT);
  tft.setCursor(28, 32);
  tft.print(s.notif_app);

  tft.setFont(&FreeSans12pt7b);
  tft.setTextColor(COLOR_WHITE);
  tft.setCursor(28, 72);
  tft.print(s.notif_title);

  // The body wraps on spaces, about 30 characters to a line, three lines.
  tft.setFont(&FreeSans9pt7b);
  tft.setTextColor(tft.color565(170, 178, 192));
  const char* p = s.notif_body;
  int y = 104;
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
    y += 24;
  }

  if (hasActions) {
    const char* labels[3] = { s.act_left, s.act_ok, s.act_right };
    const char* keys[3]   = { "<", "OK", ">" };
    for (int i = 0; i < 3; i++) {
      int x = 12 + i * 102;
      if (!labels[i][0]) continue;
      bool primary = (i == 1);
      if (primary) tft.fillRoundRect(x, 196, 92, 32, 6, COLOR_ACCENT);
      else tft.drawRoundRect(x, 196, 92, 32, 6, COLOR_MUTED);
      char text[20];
      if (i == 2) snprintf(text, sizeof(text), "%s %s", labels[i], keys[i]);   // "Snooze >"
      else snprintf(text, sizeof(text), "%s %s", keys[i], labels[i]);         // "< Tomorrow", "OK Done"
      int16_t x1, y1; uint16_t w, h;
      tft.setFont(NULL);
      tft.setTextSize(1);
      tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
      tft.setTextColor(primary ? COLOR_BG_BLACK : COLOR_WHITE);
      tft.setCursor(x + (92 - (int)w) / 2, 208);
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
    tft.setCursor(85, 115);
    tft.print("Receiving Memory Photo...");
  }

  if (s.mem_caption[0] != '\0') {
    tft.fillRect(0, 214, 320, 26, COLOR_BG_STEALTH);
    tft.drawFastHLine(0, 214, 320, tft.color565(40, 50, 65));
    tft.setFont(NULL);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_ACCENT);
    tft.setCursor(10, 222);
    tft.print("MEMORY //");

    tft.setTextColor(COLOR_WHITE);
    tft.setCursor(72, 222);
    tft.print(s.mem_caption);

    tft.setTextColor(COLOR_MUTED);
    tft.setCursor(240, 222);
    tft.print("<  OK  >");
  }
}

void displayDrawScreen(ScreenMode mode, const LumoState& s, bool forceFullRedraw) {
  if (mode != SCREEN_MEMORY) {
    memoryImageLoaded = false;
  }
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
  }
}
