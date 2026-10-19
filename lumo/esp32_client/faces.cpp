#include <Arduino.h>
#include <math.h>
#include "faces.h"
#include "display.h"
#include "aa_text.h"
#include "aa_fonts.h"
#include "anim.h"

// The faces were designed for the 320x216 window the case shows; VY() maps a
// row of that design into the visible band (VIS_T..VIS_B).
static inline int VY(int y) { return VIS_T + (y * VIS_H + 108) / 216; }

// The clock faces draw on the card (display.h, fitCard): the window's rows
// and full width, or with the Even Frame on, a smaller card inside a black
// frame. FX/FY map a column/row of the 320x216 design into it; with the frame
// off they match the old window mapping exactly.
static inline int FX(int x) { FitCard c = fitCard(); return c.x + (x * c.w + 160) / 320; }
static inline int FY(int y) { FitCard c = fitCard(); return c.y + (y * c.h + 108) / 216; }
static inline bool framed() { return screenFit.frame; }
// On the card every face but Nightstand (black) takes one charcoal, and hairlines lift to stay visible.
static inline uint16_t cardBg(uint16_t own) { return framed() ? aaRGB(28, 30, 36) : own; }
static inline uint8_t lift() { return framed() ? 20 : 0; }

// The island (below, 2.15) covers the details column while it is big.
static bool detailsHidden = false;
static bool detailsDirty  = false;   // the column is free again: draw it
static bool islandDirty   = false;   // a face drew over the island: paint it again
static float faceK        = 1.0f;    // the face's brightness, for the island's colours
static void islandReset();

// The depth face draws as Monolith until the Pi's picture arrives.
bool faceIsPremium(ClockStyle style) { return style >= CLOCK_MONOLITH && style <= CLOCK_DEPTH; }
static ClockStyle drawnStyle(ClockStyle style) { return style == CLOCK_DEPTH ? CLOCK_MONOLITH : style; }

static bool  needAll    = true;
static int   lastMinute = -1;
static int   lastSecond = -1;
static float lastDim    = -1;

// Animations: every face fades in when the clock screen opens (the Dial's
// hands also spin into place), and each has its own way of turning a minute
// over. prevH/prevM are the time being animated away from.
static const unsigned long ENTER_MS = 650;
static unsigned long enterMs = 0, transMs = 0;
static bool  entryDone = true, transDone = true;
static int   shownH = -1, shownM = -1, prevH = -1, prevM = -1;

struct FaceAnim {
  float k;          // brightness: the day phase times the fade-in
  bool  all;        // redraw every band
  bool  timeBand;   // redraw the time (a minute is turning over)
  bool  second;     // a new second
  float enter;      // 0..1 through the fade-in
  float tr;         // 0..1 through the minute's turn-over (1 when idle)
};

void faceReset() {
  islandReset();
  needAll = true;
  enterMs = millis();
  entryDone = false;
  transMs = 0;
  transDone = true;
  shownH = shownM = -1;
}

static unsigned long turnMs(ClockStyle st) {
  switch (st) {
    case CLOCK_MONOLITH:   return 560;
    case CLOCK_STACKED:    return 520;
    case CLOCK_NIGHTSTAND: return 1200;
    default:               return 0;     // the Dial's hands simply move on
  }
}

// ------------------------------------------------------------- words

static const char* fullName(const char* abbr, const char* const* table, int n) {
  for (int i = 0; i < n; i++) if (strncasecmp(abbr, table[i], 3) == 0) return table[i];
  return abbr;
}
static const char* const DAYS[]   = { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };
static const char* const MONTHS[] = { "January", "February", "March", "April", "May", "June", "July",
                                      "August", "September", "October", "November", "December" };

static void upper(char* p) { for (; *p; p++) *p = toupper(*p); }

// The Pi sends "Sun" and "05 Oct"; split that into "5" and "Oct".
static void dateParts(const LumoState& s, char* day, size_t dn, char* mon, size_t mn) {
  const char* d = s.date;
  while (*d == '0') d++;
  const char* sp = strchr(d, ' ');
  size_t len = sp ? (size_t)(sp - d) : strlen(d);
  snprintf(day, dn, "%.*s", (int)len, d);
  snprintf(mon, mn, "%s", sp ? sp + 1 : "");
}

static void hourText(const LumoState& s, int h, char* buf, size_t n) {
  if (s.hour24) snprintf(buf, n, "%02d", h);
  else snprintf(buf, n, "%d", h % 12 == 0 ? 12 : h % 12);
}

static void alarmText(const LumoState& s, char* buf, size_t n, bool ampm) {
  char hs[4];
  hourText(s, s.alarm_h, hs, sizeof(hs));
  if (!s.hour24 && ampm) snprintf(buf, n, "%s:%02d %s", hs, s.alarm_m, s.alarm_h >= 12 ? "PM" : "AM");
  else snprintf(buf, n, "%s:%02d", hs, s.alarm_m);
}

static void conditionText(const LumoState& s, char* buf, size_t n) {
  snprintf(buf, n, "%s", s.weather_icon);
  for (char* p = buf; *p; p++) if (*p == '_' || *p == '-') *p = ' ';
  buf[0] = toupper(buf[0]);
}

// "London 09:50" when Sage has set a second time zone.
static bool zone2Text(const LumoState& s, const ClockNow& c, char* buf, size_t n) {
  if (!s.zone2[0]) return false;
  int mins = ((c.h * 60 + c.m + s.zone2_offset) % 1440 + 1440) % 1440;
  char hs[4];
  hourText(s, mins / 60, hs, sizeof(hs));
  snprintf(buf, n, "%s %s:%02d", s.zone2, hs, mins % 60);
  return true;
}

// Cuts `buf` at a word (or a letter) so it fits in `maxW` pixels.
static void fitText(char* buf, const AAFont& f, int maxW) {
  while (buf[0] && aaTextWidth(f, buf) > maxW) {
    char* sp = strrchr(buf, ' ');
    if (sp && sp != buf) *sp = '\0';
    else buf[strlen(buf) - 1] = '\0';
  }
}

// A full-width strip around one line of text, ready to draw into.
static bool band(AASurface& sf, int x0, int x1, int baseline, const AAFont& f, uint16_t bg) {
  return aaBegin(sf, x0, baseline - f.ascent - 1, x1 - x0, f.ascent + f.descent + 3, bg);
}

// ------------------------------------------------------------- Monolith
// One large, light time; the date above and weather and alarm below whisper.

static const uint16_t MONO_BG = 0x0841;   // (8,9,11)

// The minute turns over as a cross-fade through the background.
static void monolith(const LumoState& s, const ClockNow& c, const FaceAnim& a) {
  float k = a.k;
  bool minute = a.all;
  uint16_t bg = cardBg(MONO_BG);
  uint16_t mute = aaRGB(120, 124, 130, k), acc = aaRGB(214, 170, 110, k);
  AASurface sf;
  char buf[48], hs[4], ms[8], day[4], mon[8];

  if (minute) {
    dateParts(s, day, sizeof(day), mon, sizeof(mon));
    snprintf(buf, sizeof(buf), "%s  %s %s", fullName(s.weekday, DAYS, 7), day, fullName(mon, MONTHS, 12));
    upper(buf);
    if (band(sf, FX(0), FX(320), FY(34), AA_CAPS9, bg)) {
      aaTextCentered(sf, FX(160), FY(34), buf, AA_CAPS9, mute, 2);
      aaEnd(sf);
    }

  }

  if (a.all || a.timeBand) {
    bool old = a.tr < 0.5f && prevM >= 0;
    float fk = a.tr >= 1 ? 1.0f : easeInOutCubic(old ? 1 - a.tr * 2 : a.tr * 2 - 1);
    hourText(s, old ? prevH : c.h, hs, sizeof(hs));
    snprintf(ms, sizeof(ms), "%02d", old ? prevM : c.m);
    snprintf(buf, sizeof(buf), "%s:%s", hs, ms);
    if (band(sf, FX(0), FX(320), FY(130), AA_MONO_TIME, bg)) {
      aaTextCentered(sf, FX(160), FY(130), buf, AA_MONO_TIME, aaRGB(238, 236, 230, k * fk));
      aaEnd(sf);
    }
  }

  if (minute) {
    if (band(sf, FX(0), FX(320), FY(190), AA_BODY11, bg)) {
      if (!zone2Text(s, c, buf, sizeof(buf))) {
        char cond[16];
        conditionText(s, cond, sizeof(cond));
        snprintf(buf, sizeof(buf), "%.0f\x7F  %s", s.temp_c, cond);
      }
      fitText(buf, AA_BODY11, 100);
      aaText(sf, FX(70), FY(190), buf, AA_BODY11, mute);
      if (s.alarm_set) {
        char a[16], line[24];
        alarmText(s, a, sizeof(a), false);
        snprintf(line, sizeof(line), "Alarm %s", a);
        aaTextRight(sf, FX(250), FY(190), line, AA_BODY11, acc);
      }
      aaEnd(sf);
    }
  }

  // Seconds: a dot travelling along a hairline.
  int y = FY(160);
  if (aaBegin(sf, FX(64), y - 4, FX(256) - FX(64), 9, bg)) {
    if (s.show_seconds && c.synced) {
      aaLine(sf, FX(70), y + 0.5f, FX(250), y + 0.5f, 1.0f, aaRGB(40 + lift(), 42 + lift(), 46 + lift(), k));
      aaDisc(sf, FX(70) + (FX(250) - FX(70)) * (c.s + c.secFrac) / 60.0f, y + 0.5f, 2.3f, acc);
    }
    aaEnd(sf);
  }
}

// ------------------------------------------------------------- Stacked
// Hours over minutes, big and bold, with a column of details on the right.

static const uint16_t STACK_BG = 0x0021;  // (6,6,8)

// The minute turns over by rolling: the old number slides up and out as the
// new one rises in behind it (the hour too, when it changes).
static void rollText(AASurface& sf, int x, int base, int travel, const char* from, const char* to,
                     float tr, const AAFont& f, uint16_t col) {
  if (tr >= 1 || !strcmp(from, to)) { aaText(sf, x, base, to, f, col); return; }
  float e = easeInOutCubic(tr);
  int d = (int)(e * travel + 0.5f);
  aaText(sf, x, base - d, from, f, col);
  aaText(sf, x, base - d + travel, to, f, col);
}

static void stacked(const LumoState& s, const ClockNow& c, const FaceAnim& a) {
  if (!a.all && !a.timeBand) return;
  float k = a.k;
  uint16_t bg = cardBg(STACK_BG);
  uint16_t ink = aaRGB(245, 243, 238, k), acc = aaRGB(255, 159, 67, k), mute = aaRGB(128, 132, 140, k);
  uint16_t rule = aaRGB(34 + lift(), 36 + lift(), 40 + lift(), k);
  AASurface sf;
  char buf[32], hs[4], ms[8];

  char phs[4], pms[8];
  hourText(s, c.h, hs, sizeof(hs));
  snprintf(ms, sizeof(ms), "%02d", c.m);
  hourText(s, prevH >= 0 ? prevH : c.h, phs, sizeof(phs));
  snprintf(pms, sizeof(pms), "%02d", prevM >= 0 ? prevM : c.m);
  int top = FY(14), base = FY(94);
  int hBandH = base + AA_STACK_TIME.descent + 3 - top;
  if ((a.all || strcmp(phs, hs)) && aaBegin(sf, FX(0), top, FX(186) - FX(0), hBandH, bg)) {
    rollText(sf, FX(18), base, hBandH, phs, hs, a.tr, AA_STACK_TIME, ink);
    int x = FX(18) + aaTextWidth(AA_STACK_TIME, hs);
    if (!s.hour24) aaText(sf, x + 8, FY(28), c.h >= 12 ? "PM" : "AM", AA_SEMI11, mute);
    aaEnd(sf);
  }
  if (band(sf, FX(0), FX(186), FY(194), AA_STACK_TIME, bg)) {
    rollText(sf, FX(18), FY(194), sf.h, pms, ms, a.tr, AA_STACK_TIME, acc);
    aaEnd(sf);
  }

  if (!a.all || detailsHidden) return;        // (the island is covering the column)
  // The details column.
  const int x = FX(196), right = FX(304);
  if (!aaBegin(sf, FX(186), FY(26), FX(320) - FX(186), FY(196) - FY(26), bg)) return;
  char day[4], mon[8];
  dateParts(s, day, sizeof(day), mon, sizeof(mon));
  snprintf(buf, sizeof(buf), "%s", s.weekday);
  upper(buf);
  aaText(sf, x, FY(44), buf, AA_SEMI11, mute, 2);
  snprintf(buf, sizeof(buf), "%s %s", day, mon);
  aaText(sf, x, FY(69), buf, AA_DISP20, ink);
  aaLine(sf, x, FY(86) + 0.5f, right, FY(86) + 0.5f, 1.0f, rule);

  if (zone2Text(s, c, buf, sizeof(buf))) {
    char* sp = strrchr(buf, ' ');               // "London 09:50": time big, place small
    if (sp) { *sp = '\0'; aaText(sf, x, FY(113), sp + 1, AA_DISP20, ink); }
    fitText(buf, AA_BODY11, right - x);
    aaText(sf, x, FY(130), buf, AA_BODY11, mute);
  } else {
    snprintf(buf, sizeof(buf), "%.0f\x7F", s.temp_c);
    aaText(sf, x, FY(113), buf, AA_DISP20, ink);
    conditionText(s, buf, sizeof(buf));
    fitText(buf, AA_BODY11, right - x);
    aaText(sf, x, FY(130), buf, AA_BODY11, mute);
  }
  aaLine(sf, x, FY(146) + 0.5f, right, FY(146) + 0.5f, 1.0f, rule);

  if (s.alarm_set) {
    aaDisc(sf, x + 3, FY(162), 3, acc);
    alarmText(s, buf, sizeof(buf), true);
    aaText(sf, x + 12, FY(167), buf, AA_DISP14, ink);
    aaText(sf, x + 12, FY(184), "Alarm", AA_BODY11, mute);
  }
  aaEnd(sf);
}

// ------------------------------------------------------------- Nightstand
// Warm amber digits with a soft glow, and nothing else that could keep you up.

static const uint16_t NIGHT_BG = 0x0000;  // (5,3,2) rounds to black on the panel

// The minute turns over slowly, like a filament: the digits sink to an ember
// and the glow lingers a moment longer, then the new time warms back up.
static void nightstand(const LumoState& s, const ClockNow& c, const FaceAnim& a) {
  if (!a.all && !a.timeBand) return;
  float k = a.k;
  bool minute = a.all;
  uint16_t bg = NIGHT_BG;
  uint16_t info = aaRGB(150, 88, 40, k);
  AASurface sf;
  char buf[24], hs[4];

  bool old = a.tr < 0.45f && prevM >= 0;
  float ink = 1.0f, halo = 1.0f;
  if (a.tr < 1) {
    float u = old ? a.tr / 0.45f : (a.tr - 0.45f) / 0.55f;
    ink  = old ? 1 - easeInOutCubic(u) : easeInOutCubic(u);
    halo = old ? 1 - 0.7f * easeInOutCubic(u) : 0.3f + 0.7f * easeOutCubic(u);
    ink  = 0.08f + 0.92f * ink;                  // never quite out: an ember
  }
  hourText(s, old ? prevH : c.h, hs, sizeof(hs));
  snprintf(buf, sizeof(buf), "%s:%02d", hs, old ? prevM : c.m);
  const AAFont& f = AA_NIGHT_TIME;
  int base = FY(136), pad = f.glowPad;
  int top = base - f.ascent - pad - 1;
  if (aaBegin(sf, FX(0), top, FX(320) - FX(0), f.ascent + f.descent + 2 * pad + 3, bg)) {
    int x = FX(160) - aaTextWidth(f, buf) / 2;
    aaGlow(sf, x, base, buf, f, aaRGB(190, 85, 25, k * halo), 210);
    aaText(sf, x, base, buf, f, aaRGB(255, 150, 60, k * ink));
    aaEnd(sf);
  }

  if (minute && band(sf, FX(0), FX(320), FY(170), AA_BODY11, bg)) {
    char day[4], mon[8], date[24];
    dateParts(s, day, sizeof(day), mon, sizeof(mon));
    snprintf(date, sizeof(date), "%s %s %s", s.weekday, day, mon);
    if (s.alarm_set) {
      char a[12], line[20];
      alarmText(s, a, sizeof(a), false);
      snprintf(line, sizeof(line), "Alarm %s", a);
      int gap = 26, w = aaTextWidth(AA_BODY11, date) + gap + aaTextWidth(AA_BODY11, line);
      int x = aaText(sf, FX(160) - w / 2, FY(170), date, AA_BODY11, info);
      aaDisc(sf, x + gap / 2.0f, FY(170) - 3.5f, 1.3f, info);
      aaText(sf, x + gap, FY(170), line, AA_BODY11, info);
    } else {
      aaTextCentered(sf, FX(160), FY(170), date, AA_BODY11, info);
    }
    aaEnd(sf);
  }
}

// ------------------------------------------------------------- Dial
// A watch dial with a date window; the day, weather and alarm alongside.

static const uint16_t DIAL_BG = 0x0841;   // (9,10,12)

static void dialHand(AASurface& sf, float cx, float cy, float turns, float len, float tail, float w, uint16_t col) {
  float a = turns * 6.2831853f, sx = sinf(a), sy = -cosf(a);
  aaLine(sf, cx - sx * tail, cy - sy * tail, cx + sx * len, cy + sy * len, w, col);
}

// When the clock screen opens, the hands spin round from twelve and settle.
static void dial(const LumoState& s, const ClockNow& c, const FaceAnim& a) {
  float k = a.k;
  bool minute = a.all, second = a.second;
  uint16_t bg = cardBg(DIAL_BG);
  uint16_t face = aaRGB(17, 19, 22), ink = aaRGB(236, 234, 228, k), mute = aaRGB(120, 124, 130, k);
  uint16_t orange = aaRGB(255, 122, 60, k);
  AASurface sf;
  char buf[32], day[4], mon[8];
  dateParts(s, day, sizeof(day), mon, sizeof(mon));

  const FitCard card = fitCard();
  const float R = 94.0f * card.h / 216;
  const float cx = FX(108), cy = card.y + card.h / 2.0f;
  bool sweep = s.show_seconds && c.synced;
  if (minute || (second && sweep)) {
    int x0 = (int)(cx - R) - 2, y0 = (int)(cy - R) - 2, n = (int)(2 * R) + 5;
    if (aaBegin(sf, x0, y0, n, n, bg)) {
      aaDisc(sf, cx, cy, R, face);
      aaRing(sf, cx, cy, R, 1.2f, aaRGB(44, 47, 52, k));
      uint16_t minor = aaRGB(90, 94, 100, k);
      for (int i = 0; i < 60; i++) {
        float a = i * 6.2831853f / 60, sx = sinf(a), sy = -cosf(a);
        bool major = i % 5 == 0;
        float r0 = R - (major ? 12 : 5), r1 = R - 3;
        aaLine(sf, cx + sx * r0, cy + sy * r0, cx + sx * r1, cy + sy * r1, major ? 3.0f : 1.0f, major ? ink : minor);
      }
      float bx = cx + R * 0.53f;
      aaRoundRect(sf, bx - 13, cy - 9, 26, 18, 3, aaRGB(234, 232, 226, k));
      aaTextCentered(sf, (int)bx, (int)cy + 4, day, AA_SEMI11, aaRGB(20, 20, 22));
      aaTextCentered(sf, (int)cx, (int)(cy - R * 0.45f), "LUMO", AA_CAPS9, mute, 3);

      float sec = c.s + c.secFrac;
      float e = a.enter < 1 ? easeOutBack(a.enter) : 1.0f;
      dialHand(sf, cx, cy, e * ((c.h % 12) + c.m / 60.0f) / 12.0f, R * 0.55f, 10, 7.0f, ink);
      dialHand(sf, cx, cy, e * (c.m + (sweep ? sec : 0) / 60.0f) / 60.0f, R * 0.84f, 12, 4.5f, ink);
      if (sweep) dialHand(sf, cx, cy, e * sec / 60.0f, R * 0.90f, 20, 1.6f, orange);
      aaDisc(sf, cx, cy, 5, orange);
      aaDisc(sf, cx, cy, 2, face);
      aaEnd(sf);
    }
  }

  if (!minute || detailsHidden) return;       // (the island is covering the column)
  // With the island's dot on the right edge the column gives it room.
  const int pull = framed() && screenFit.island ? 14 : 0;
  const int x = FX(226) - pull, right = FX(316) - (pull ? 22 : 0);
  if (!aaBegin(sf, FX(212) - pull, FY(30), FX(320) - FX(212) + pull, FY(196) - FY(30), bg)) return;
  snprintf(buf, sizeof(buf), "%s", fullName(s.weekday, DAYS, 7));
  upper(buf);
  aaText(sf, x, FY(47), buf, AA_CAPS9, mute, 2);
  snprintf(buf, sizeof(buf), "%s %s", day, mon);
  aaText(sf, x, FY(71), buf, AA_DISP20, ink);

  if (zone2Text(s, c, buf, sizeof(buf))) {
    char* sp = strrchr(buf, ' ');
    aaText(sf, x, FY(107), "ELSEWHERE", AA_CAPS9, mute, 2);
    if (sp) *sp = '\0';
    char line[40];
    snprintf(line, sizeof(line), "%s %s", sp ? sp + 1 : "", buf);
    fitText(line, AA_DISP14, right - x);
    aaText(sf, x, FY(129), line, AA_DISP14, ink);
  } else {
    aaText(sf, x, FY(107), "WEATHER", AA_CAPS9, mute, 2);
    char cond[16];
    conditionText(s, cond, sizeof(cond));
    snprintf(buf, sizeof(buf), "%.0f\x7F %s", s.temp_c, cond);
    fitText(buf, AA_DISP14, right - x);
    aaText(sf, x, FY(129), buf, AA_DISP14, ink);
  }

  if (s.alarm_set) {
    aaText(sf, x, FY(165), "ALARM", AA_CAPS9, mute, 2);
    alarmText(s, buf, sizeof(buf), true);
    aaText(sf, x, FY(187), buf, AA_DISP14, orange);
  }
  aaEnd(sf);
}

// ------------------------------------------------------------- driver

static uint16_t faceBg(ClockStyle st) {
  switch (st) {
    case CLOCK_STACKED:    return cardBg(STACK_BG);
    case CLOCK_NIGHTSTAND: return NIGHT_BG;
    case CLOCK_DIAL:       return cardBg(DIAL_BG);
    default:               return cardBg(MONO_BG);
  }
}

static void faceTickInner(const LumoState& s, const ClockNow& c) {
  static unsigned long lastDraw = 0;
  unsigned long now = millis();
  float enter = entryDone ? 1.0f : animProgress(enterMs, now, ENTER_MS);
  const ClockStyle style = drawnStyle(s.clock_style);
  unsigned long turn = turnMs(style);
  bool turning = !transDone;
  bool animating = enter < 1 || turning;
  if (!needAll && now - lastDraw < (animating ? 33UL : 50UL)) return;
  lastDraw = now;

  // Same day-phase dimming as the classic clock: calm at night, never dark.
  float k = 0.5f + 0.5f * clockPhase(c.minuteOfDay).level;
  bool minute = needAll || detailsDirty || c.m != lastMinute || fabsf(k - lastDim) > 0.03f;
  bool second = minute || c.s != lastSecond;
  bool smooth = style == CLOCK_MONOLITH && s.show_seconds;   // the dot glides

  // A new minute (not the first one drawn) starts the face's turn-over.
  if (shownM >= 0 && c.m != shownM && turn && enter >= 1) {
    prevH = shownH; prevM = shownM;
    transMs = now;
    transDone = false;
    turning = true;
  }
  shownH = c.h; shownM = c.m;
  float tr = 1.0f;
  if (turning) {
    tr = animProgress(transMs, now, turn);
    if (tr >= 1) transDone = true;               // this frame draws the end state
  }
  if (!entryDone && enter >= 1) { entryDone = true; minute = true; }
  if (enter < 1) minute = true;
  if (!minute && !second && !smooth && !turning) return;

  detailsDirty = false;
  FaceAnim an;
  an.enter = enter;
  an.k = k * easeInOutCubic(enter);
  faceK = an.k;
  an.all = minute;
  an.timeBand = turning;
  an.second = second;
  an.tr = tr;

  if (needAll) {
    if (framed()) {
      FitCard card = fitCard();
      tft.fillScreen(0x0000);
      tft.fillRect(card.x, card.y, card.w, card.h, faceBg(style));
    } else {
      tft.fillScreen(faceBg(style));
    }
  }
  switch (style) {
    case CLOCK_MONOLITH:   monolith(s, c, an); break;
    case CLOCK_STACKED:    stacked(s, c, an); break;
    case CLOCK_NIGHTSTAND: nightstand(s, c, an); break;
    case CLOCK_DIAL:       dial(s, c, an); break;
    default: break;
  }
  islandDirty = true;
  needAll = false;
  lastMinute = c.m;
  lastSecond = c.s;
  if (minute && enter >= 1) lastDim = k;
}

// ------------------------------------------------------------- Island
// With the Even Frame on, a black capsule docks on the card's right edge, the
// way a phone's island grows out of its camera. Idle it is a small dot when
// something is going on (an alarm set, music, a timer). On Stacked and Dial
// music and the timer grow it into a capsule that covers the details column
// (which comes back when it shrinks); Monolith keeps just the dot, and
// Nightstand nothing, to stay dark. Sage can switch it off (Screen fit).

enum IsKind { IS_NONE, IS_ALARM, IS_MUSIC, IS_TIMER };
static const int IS_DOT_W = 22, IS_DOT_H = 40, IS_BIG_W = 104, IS_BIG_H = 168;   // big: nearly the card's full height
static float isW = 0, isH = 0;               // the size drawn, easing towards the target
static int   isDrawW = -1, isDrawH = -1;     // what the panel shows now
static unsigned long isLast = 0, isLastBars = 0;
static int   isLastSec = -1;
static bool  isBlank = false;
static uint16_t isLastArt = 0;               // the cover the island last showed (display.cpp's artSerial)

static void islandReset() {
  isW = isH = 0;
  isDrawW = isDrawH = -1;
  isLastSec = -1;
  isLastArt = artSerial;
  isBlank = false;
  detailsHidden = false;
}

static IsKind islandWant(const LumoState& s, ClockStyle style) {
  if (!framed() || !screenFit.island || style == CLOCK_NIGHTSTAND) return IS_NONE;
  if (s.tm_state == TOOL_RUNNING || s.tm_state == TOOL_PAUSED) return IS_TIMER;
  if (s.sp_playing && s.sp_title[0]) return IS_MUSIC;
  if (s.alarm_set) return IS_ALARM;
  return IS_NONE;
}

static int islandTimerLeft(const LumoState& s) {           // milliseconds
  if (s.tm_state == TOOL_PAUSED) return (int)s.tm_left_ms;
  int32_t left = (int32_t)(s.tm_end - millis());
  return left < 0 ? 0 : left;
}

// The cover, n x n with rounded corners, averaged down from the 100 x 100 frame.
static void islandArt(AASurface& sf, int ox, int oy, int n, float rad) {
  const uint16_t* px = (const uint16_t*)artBuf;
  const uint8_t k = (uint8_t)(faceK * 255);
  for (int y = 0; y < n; y++) {
    int sy0 = y * 100 / n, sy1 = max(sy0 + 1, (y + 1) * 100 / n);
    for (int x = 0; x < n; x++) {
      float dx = x < rad ? rad - x - 0.5f : (x >= n - rad ? x - (n - rad) + 0.5f : 0);
      float dy = y < rad ? rad - y - 0.5f : (y >= n - rad ? y - (n - rad) + 0.5f : 0);
      float cov = 1;
      if (dx > 0 && dy > 0) cov = constrain(rad + 0.5f - sqrtf(dx * dx + dy * dy), 0.0f, 1.0f);
      if (cov <= 0) continue;
      int sx0 = x * 100 / n, sx1 = max(sx0 + 1, (x + 1) * 100 / n);
      int r = 0, g = 0, b = 0, cnt = 0;
      for (int yy = sy0; yy < sy1; yy++)
        for (int xx = sx0; xx < sx1; xx++) {
          uint16_t c = px[yy * 100 + xx];
          r += c >> 11; g += (c >> 5) & 63; b += c & 31; cnt++;
        }
      uint16_t c = (uint16_t)(((r / cnt) << 11) | ((g / cnt) << 5) | (b / cnt));
      sf.buf[(oy - sf.y + y) * sf.w + (ox - sf.x + x)] = aaMix(0x0000, c, (uint8_t)(k * cov));
    }
  }
}

static void islandPaint(const LumoState& s, IsKind kind, bool big) {
  FitCard card = fitCard();
  const int x1 = card.x + card.w, cy = card.y + card.h / 2;
  const uint16_t bg = faceBg(drawnStyle(s.clock_style));
  AASurface sf;
  const int W = (int)(isW + 0.5f), H = (int)(isH + 0.5f);
  if (isBlank) {                                    // the column the island is about to cover
    isBlank = false;
    int left = drawnStyle(s.clock_style) == CLOCK_DIAL ? FX(212) - 10 : FX(186);
    if (aaBegin(sf, left, FY(26), x1 - left, FY(196) - FY(26), bg)) aaEnd(sf);
  }
  int rw = max(W, isDrawW) + 2, rh = max(H, isDrawH) + 2;
  if (rw <= 2 || rh <= 2) { isDrawW = W; isDrawH = H; return; }
  if (!aaBegin(sf, x1 - rw, cy - rh / 2, rw, rh, bg)) return;
  isDrawW = W; isDrawH = H;
  if (W > 2 && H > 2) {
    float r = min(H / 2.0f, 18.0f);
    aaRoundRect(sf, x1 - W, cy - H / 2.0f, W + r, H, r, 0x0000);
    uint16_t white = aaRGB(238, 238, 238, faceK), muted = aaRGB(140, 144, 152, faceK);
    uint16_t amber = aaRGB(255, 159, 67, faceK), green = aaRGB(120, 200, 140, faceK);
    int x0 = x1 - W;
    if (big && W >= IS_BIG_W - 6 && H >= min(IS_BIG_H, fitCard().h - 16) - 4) {
      const int mid = x0 + W / 2, top = cy - H / 2;
      if (kind == IS_MUSIC) {
        const int n = 76, ax = mid - n / 2, ay = top + 14;
        if (artSerial) islandArt(sf, ax, ay, n, 9);
        else {
          uint8_t cr, cg, cb;
          displayArtTint(cr, cg, cb);
          aaRoundRect(sf, ax, ay, n, n, 9, aaRGB(cr, cg, cb, faceK));
        }
        char t[28];
        strlcpy(t, s.sp_title, sizeof(t));
        fitText(t, AA_BODY11, W - 16);
        aaTextCentered(sf, mid, ay + n + 18, t, AA_BODY11, white);
        if (s.sp_artist[0]) {
          char a[28];
          strlcpy(a, s.sp_artist, sizeof(a));
          fitText(a, AA_BODY11, W - 16);
          aaTextCentered(sf, mid, ay + n + 34, a, AA_BODY11, muted);
        }
        unsigned long now = millis();
        for (int i = 0; i < 5; i++) {
          float h = s.sp_playing ? 3.0f + 9.0f * fabsf(sinf(now * 0.008f + i * 1.4f)) : 2.0f;
          aaRoundRect(sf, mid - 15 + i * 6, top + H - 14 - h, 3, h, 1.0f, green);
        }
      } else if (kind == IS_TIMER) {
        int left = islandTimerLeft(s);
        float frac = s.tm_total_ms ? constrain(left / (float)s.tm_total_ms, 0.0f, 1.0f) : 0.0f;
        const int dots = 28, ringY = top + 62;
        for (int i = 0; i < dots; i++) {
          float a = i * 6.2831853f / dots;
          aaDisc(sf, mid + sinf(a) * 36, ringY - cosf(a) * 36, 2.2f, i < (int)(frac * dots + 0.5f) ? amber : aaRGB(70, 56, 40, faceK));
        }
        char t[12];
        int secs = (left + 999) / 1000;
        if (secs >= 3600) snprintf(t, sizeof(t), "%d:%02d", secs / 3600, secs / 60 % 60);
        else snprintf(t, sizeof(t), "%02d:%02d", secs / 60, secs % 60);
        aaTextCentered(sf, mid, ringY + 6, t, AA_DISP14, white);
        char lab[25];
        strlcpy(lab, s.tm_label[0] ? s.tm_label : (s.tm_state == TOOL_PAUSED ? "Paused" : "Timer"), sizeof(lab));
        fitText(lab, AA_BODY11, W - 16);
        aaTextCentered(sf, mid, top + H - 22, lab, AA_BODY11, muted);
      }
    } else if (!big || W < 40) {
      // The dot: the colour says what it stands for.
      if (W >= 12) aaDisc(sf, x0 + 9, cy, 4, kind == IS_MUSIC ? green : amber);
    }
  }
  aaEnd(sf);
}

static void islandTick(const LumoState& s) {
  const ClockStyle style = drawnStyle(s.clock_style);
  unsigned long now = millis();
  if (!islandDirty && now - isLast < 33) return;
  IsKind kind = islandWant(s, style);
  bool grows = style == CLOCK_STACKED || style == CLOCK_DIAL;
  bool big = grows && (kind == IS_MUSIC || kind == IS_TIMER);
  float tw = kind == IS_NONE ? 0 : big ? IS_BIG_W : IS_DOT_W;
  // A Fit test with big top or bottom margins shortens the card: the island stays inside it.
  float th = kind == IS_NONE ? 0 : big ? min(IS_BIG_H, fitCard().h - 16) : IS_DOT_H;

  if (big && !detailsHidden) { detailsHidden = true; isBlank = true; }
  bool moving = fabsf(tw - isW) > 0.01f || fabsf(th - isH) > 0.01f;
  if (moving) {
    isW += (tw - isW) * 0.3f; isH += (th - isH) * 0.3f;
    if (fabsf(tw - isW) < 0.6f) isW = tw;
    if (fabsf(th - isH) < 0.6f) isH = th;
  }
  if (!big && detailsHidden && isW <= IS_DOT_W + 1) {          // shrunk: the column comes back
    detailsHidden = false;
    detailsDirty = true;
  }

  bool content = false;
  if (big && !moving) {
    if (kind == IS_TIMER) {
      int sec = (islandTimerLeft(s) + 999) / 1000;
      if (sec != isLastSec) { isLastSec = sec; content = true; }
    } else if (kind == IS_MUSIC && (now - isLastBars >= 100 || isLastArt != artSerial)) {
      isLastBars = now; isLastArt = artSerial; content = true;
    }
  }
  int W = (int)(isW + 0.5f), H = (int)(isH + 0.5f);
  if (!islandDirty && !content && !isBlank && W == isDrawW && H == isDrawH) { isLast = now; return; }
  isLast = now;
  islandDirty = false;
  islandPaint(s, kind, big);
}

void faceTick(const LumoState& s, const ClockNow& c) {
  faceTickInner(s, c);
  islandTick(s);
}

// =====================================================================
//  Now Playing
//
//  The phone's music on the clock, drawn smooth like the faces. Everything
//  that moves is a function of time:
//  - the screen fades in, the cover sliding a little way in from the left;
//  - a new cover wipes in from the top over the old one;
//  - a new title rises in as the old one lifts away, and a title too long
//    for its column scrolls slowly (pausing at the start);
//  - the play button morphs between play and pause;
//  - a row of level bars dances in the cover's colour while music plays
//    and lies down to a slow ripple when it's paused.
//  The phone sends no audio, so the bars are made up: layered waves with a
//  beat on the low bars, through a fast-attack, slow-release spring, which
//  reads like a real spectrum. Sage looks the song up (SONG_INFO), so the
//  beat runs at the song's tempo and the bars at its energy, the label
//  names its genre, and a line under the controls shows the lyrics as
//  they're sung (LYRIC), or a few facts about the song in turn.
// =====================================================================

static const int NP_ART_X = 16, NP_ART = 100;
static inline int npArtY() { return VY(14); }
static const int NP_COL_X = 132, NP_COL_R = 306;
static const int NP_BARS = 30;

static unsigned long npEnterMs = 0, npArtMs = 0, npTitleMs = 0, npPlayMs = 0;
static bool  npNeedAll = true, npEntered = false, npArtWiping = false, npTitleMoving = false, npPlayMoving = false;
static bool  npPlaying = false;
static char  npTitle[64] = "", npArtist[64] = "", npOldTitle[64] = "", npOldArtist[64] = "";
static float npBar[NP_BARS];
static unsigned long npLastBars = 0, npLastText = 0;
static char  npLabelShown[40] = "";
// The line under the controls: a lyric, or a fact about the song.
static char  npLine[100] = "", npOldLine[100] = "";
static bool  npLineLyric = false, npOldLyric = false, npLineMoving = false;
static unsigned long npLineMs = 0, npLastLine = 0, npFactMs = 0;
static uint8_t npFact = 0;

void nowPlayingReset() {
  npNeedAll = true;
  npEnterMs = millis();
  npEntered = false;
  npArtWiping = npTitleMoving = npPlayMoving = false;
  npOldTitle[0] = npOldArtist[0] = '\0';
  npLine[0] = npOldLine[0] = npLabelShown[0] = '\0';
  npLineMoving = false;
  for (int i = 0; i < NP_BARS; i++) npBar[i] = 0;
}

// The song's beat, shared with the light ring so the two move together:
// a soft pulse at the song's tempo (118 bpm when Sage hasn't said).
float nowPlayingBeat(const LumoState& s, float t) {
  float f = (s.sp_bpm ? s.sp_bpm : 118) / 60.0f;
  return powf(0.5f + 0.5f * cosf(t * 6.2831853f * f), 6.0f);
}

static uint16_t npBg() {
  uint8_t r, g, b;
  displayArtTint(r, g, b);
  return aaRGB(9 + r / 22, 10 + g / 22, 13 + b / 22);
}

static uint16_t npTint(float k) {
  uint8_t r, g, b;
  displayArtTint(r, g, b);
  return aaRGB(r, g, b, k);
}

// The cover, faded by k, with rows below `reveal` (0..1 of its height) left
// as they are on the panel: a new cover wipes down over the old one with a
// soft edge.
static void npCover(float k, float reveal, int x) {
  AASurface sf;
  int y0 = npArtY();
  int edge = 10;
  int rows = reveal >= 1 ? NP_ART : min(NP_ART, (int)(reveal * (NP_ART + edge)));
  if (rows <= 0) return;
  if (!aaBegin(sf, x, y0, NP_ART, rows, npBg())) return;
  const uint16_t* px = (const uint16_t*)artBuf;
  uint16_t bg = npBg();
  uint8_t kk = (uint8_t)(animClamp(k) * 255);
  for (int y = 0; y < rows; y++) {
    uint8_t a = kk;
    int fromEdge = rows - 1 - y;
    if (reveal < 1 && fromEdge < edge) a = (uint8_t)(a * (fromEdge + 1) / (edge + 1));
    for (int xx = 0; xx < NP_ART; xx++) sf.buf[y * NP_ART + xx] = aaMix(bg, px[y * NP_ART + xx], a);
  }
  // Rounded corners: the cover sits in the panel like a sleeve, not a sticker.
  const float r = 6;
  for (int c = 0; c < 4; c++) {
    int cx = (c & 1) ? NP_ART - 1 : 0, cy = (c & 2) ? NP_ART - 1 : 0;
    for (int dy = 0; dy < (int)r; dy++)
      for (int dx = 0; dx < (int)r; dx++) {
        int pxx = (c & 1) ? cx - dx : cx + dx, pyy = (c & 2) ? cy - dy : cy + dy;
        if (pyy >= rows) continue;
        float qx = r - dx - 0.5f, qy = r - dy - 0.5f;
        float cov = r + 0.5f - sqrtf(qx * qx + qy * qy);
        if (cov < 1) {
          uint16_t* p = &sf.buf[pyy * NP_ART + pxx];
          *p = aaMix(bg, *p, cov <= 0 ? 0 : (uint8_t)(cov * 255));
        }
      }
  }
  aaEnd(sf);
}

// A filled convex polygon with soft edges (for the play/pause morph).
static void npPoly(AASurface& sf, const float* xs, const float* ys, int n, uint16_t col) {
  float minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (int i = 0; i < n; i++) {
    minx = fminf(minx, xs[i]); maxx = fmaxf(maxx, xs[i]);
    miny = fminf(miny, ys[i]); maxy = fmaxf(maxy, ys[i]);
  }
  float area = 0;
  for (int i = 0; i < n; i++) { int j = (i + 1) % n; area += xs[i] * ys[j] - xs[j] * ys[i]; }
  float sgn = area > 0 ? 1.0f : -1.0f;
  for (int py = (int)floorf(miny) - 1; py <= (int)ceilf(maxy) + 1; py++)
    for (int px = (int)floorf(minx) - 1; px <= (int)ceilf(maxx) + 1; px++) {
      float cx = px + 0.5f, cy = py + 0.5f, d = 1e9;
      for (int i = 0; i < n; i++) {
        int j = (i + 1) % n;
        float ex = xs[j] - xs[i], ey = ys[j] - ys[i], len = sqrtf(ex * ex + ey * ey);
        if (len < 1e-3f) continue;
        float dist = sgn * (ex * (cy - ys[i]) - ey * (cx - xs[i])) / len;   // >0 inside
        d = fminf(d, dist);
      }
      float cov = d + 0.5f;
      if (cov > 0) {
        int x = px - sf.x, y = py - sf.y;
        if ((unsigned)x < (unsigned)sf.w && (unsigned)y < (unsigned)sf.h) {
          uint16_t* p = &sf.buf[y * sf.w + x];
          *p = aaMix(*p, col, cov >= 1 ? 255 : (uint8_t)(cov * 255));
        }
      }
    }
}

// The controls under the title: previous, play/pause, next. `m` morphs the
// middle icon, 0 = pause bars, 1 = play triangle.
static void npControls(float k, float m) {
  AASurface sf;
  int cy = VY(118), cx = NP_COL_X + 54;
  uint16_t bg = npBg();
  if (!aaBegin(sf, NP_COL_X, cy - 18, 120, 37, bg)) return;
  uint16_t ink = aaRGB(236, 234, 228, k), mute = aaRGB(130, 134, 142, k);
  aaDisc(sf, cx, cy, 16, ink);
  // pause: two bars; play: the same two shapes become the halves of a triangle
  float e = easeInOutCubic(m);
  auto L = [](float a, float b, float t) { return a + (b - a) * t; };
  float s = 6.5f;
  float lx[4] = { L(cx - 5.5f, cx - 4.5f, e), L(cx - 1.5f, cx + 1.25f, e), L(cx - 1.5f, cx + 1.25f, e), L(cx - 5.5f, cx - 4.5f, e) };
  float ly[4] = { L(cy - s, cy - s - 1, e), L(cy - s, cy - 3.6f, e), L(cy + s, cy + 3.6f, e), L(cy + s, cy + s + 1, e) };
  float rx[4] = { L(cx + 1.5f, cx + 1.0f, e), L(cx + 5.5f, cx + 7.5f, e), L(cx + 5.5f, cx + 7.5f, e), L(cx + 1.5f, cx + 1.0f, e) };
  float ry[4] = { L(cy - s, cy - 3.9f, e), L(cy - s, cy, e), L(cy + s, cy, e), L(cy + s, cy + 3.9f, e) };
  npPoly(sf, lx, ly, 4, bg);
  npPoly(sf, rx, ry, 4, bg);
  // previous and next: two small triangles each, pointing outwards
  for (int dir = -1; dir <= 1; dir += 2) {
    float bx = cx + dir * 40;
    for (int j = 0; j < 2; j++) {
      float x0 = bx + dir * (j * 7.0f - 7.0f), x1 = x0 + dir * 7.0f;
      float tx[3] = { x0, x0, x1 }, ty[3] = { cy - 5.5f, cy + 5.5f, (float)cy };
      npPoly(sf, tx, ty, 3, mute);
    }
  }
  aaEnd(sf);
}

// Title and artist, mid-change if `tr` < 1, the title scrolling if it is too
// long for the column.
static void npText(float k, float tr, unsigned long now) {
  AASurface sf;
  uint16_t bg = npBg();
  const int colW = NP_COL_R - NP_COL_X;
  // The title has a band of its own, so a title rising in stays inside it.
  int top = VY(66) - AA_DISP20.ascent - 2, bottom = VY(66) + AA_DISP20.descent + 2;
  auto title = [&](const char* t, int dy, float kk) {
    int w = aaTextWidth(AA_DISP20, t);
    int off = 0;
    if (w > colW) {                       // scroll: wait 1.8 s, glide, loop with a gap
      const int gap = 40;
      float cycle = (w + gap) / 26.0f + 1.8f;
      float u = fmodf((now - npTitleMs) / 1000.0f, cycle) - 1.8f;
      off = u > 0 ? (int)(u * 26.0f) : 0;
      aaText(sf, NP_COL_X - off + w + gap, VY(66) + dy, t, AA_DISP20, aaRGB(244, 242, 236, k * kk));
    }
    aaText(sf, NP_COL_X - off, VY(66) + dy, t, AA_DISP20, aaRGB(244, 242, 236, k * kk));
  };
  auto artist = [&](const char* a, float kk) {
    char buf[64];
    snprintf(buf, sizeof(buf), "%s", a);
    fitText(buf, AA_BODY11, colW);
    aaText(sf, NP_COL_X, VY(88), buf, AA_BODY11, aaRGB(150, 154, 162, k * kk));
  };
  bool moving = tr < 1 && npOldTitle[0];
  if (aaBegin(sf, NP_COL_X, top, colW, bottom - top, bg)) {
    if (!moving) {
      title(npTitle[0] ? npTitle : "Nothing playing", 0, 1);
    } else {
      float e = easeInOutCubic(tr);
      int travel = bottom - top, lift = (int)(e * travel);
      title(npOldTitle, -lift, 1 - e);
      title(npTitle, travel - lift, e);
    }
    aaEnd(sf);
  }
  if (aaBegin(sf, NP_COL_X, bottom, colW, VY(92) - bottom, bg)) {
    if (!moving) artist(npArtist[0] ? npArtist : "Play something on your phone", 1);
    else artist(tr < 0.5f ? npOldArtist : npArtist, tr < 0.5f ? 1 - tr * 2 : tr * 2 - 1);
    aaEnd(sf);
  }
}

// The small label over the title: the genre and tempo once Sage knows them.
static void npLabelText(const LumoState& s, char* out, size_t n) {
  if (!npPlaying) { strlcpy(out, "PAUSED", n); return; }
  if (!s.sp_genre[0]) { strlcpy(out, "NOW PLAYING", n); return; }
  char raw[40];
  if (s.sp_bpm) snprintf(raw, sizeof(raw), "%s  %u BPM", s.sp_genre, s.sp_bpm);
  else snprintf(raw, sizeof(raw), "%s", s.sp_genre);
  size_t j = 0;                                   // the caps font: A-Z, 0-9 and spaces
  for (size_t i = 0; raw[i] && j + 1 < n; i++) {
    char c = toupper((unsigned char)raw[i]);
    out[j++] = (isalnum((unsigned char)c) ? c : ' ');
  }
  out[j] = '\0';
  while (j > 1 && aaTextWidth(AA_CAPS9, out, 2) > NP_COL_R - NP_COL_X) out[--j] = '\0';
}

static void npLabel(float k, const char* text) {
  AASurface sf;
  uint16_t bg = npBg();
  int base = VY(30);
  if (!aaBegin(sf, NP_COL_X, base - 12, NP_COL_R - NP_COL_X, 15, bg)) return;
  aaText(sf, NP_COL_X, base, text, AA_CAPS9, npTint(k), 2);
  aaEnd(sf);
}

// The line under the controls. Lyrics are bright and centred, the size
// stepping down for a long line; facts are quieter. A line too long for the
// screen glides along after a moment. A new line rises in as the old one
// lifts away, like lyrics in a music app.
static const int NP_LINE_X0 = 16, NP_LINE_X1 = 304;
static inline int npLineBase() { return VY(156); }

static const AAFont& npLineFont(const char* t, bool lyric) {
  if (lyric && aaTextWidth(AA_DISP14, t) <= NP_LINE_X1 - NP_LINE_X0) return AA_DISP14;
  return lyric ? AA_SEMI11 : AA_BODY11;
}

static void npLineDraw(AASurface& sf, const char* t, bool lyric, int dy, float kk, float k, unsigned long since) {
  if (!t[0]) return;
  const AAFont& f = npLineFont(t, lyric);
  const int w = aaTextWidth(f, t), colW = NP_LINE_X1 - NP_LINE_X0;
  int x = NP_LINE_X0 + (colW - w) / 2;
  if (w > colW) {                                 // wait, then glide to the end and stay
    float u = since / 1000.0f - 1.2f;
    int off = u > 0 ? (int)fminf(u * (lyric ? 40.0f : 26.0f), (float)(w - colW)) : 0;
    x = NP_LINE_X0 - off;
  }
  uint16_t col = lyric ? aaRGB(244, 242, 236, k * kk) : aaMix(npBg(), npTint(1), (uint8_t)(200 * k * kk));
  aaText(sf, x, npLineBase() + dy, t, f, col);
}

static void npLineTick(const LumoState& s, float k, bool all, unsigned long now) {
  // What the line should say now.
  const char* want = "";
  bool lyric = false;
  if (s.sp_lyrics && s.sp_lyric[0]) {
    want = s.sp_lyric; lyric = true;
  } else if (s.sp_fact_count) {
    if (npFact >= s.sp_fact_count) npFact = 0;
    const char* f = s.sp_facts[npFact];
    int over = aaTextWidth(AA_BODY11, f) - (NP_LINE_X1 - NP_LINE_X0);
    float hold = 9.0f + (over > 0 ? over / 26.0f : 0);
    if (!npLineLyric && !strcmp(npLine, f) && now - npFactMs > hold * 1000) {
      npFact = (npFact + 1) % s.sp_fact_count;
      f = s.sp_facts[npFact];
    }
    want = f;
  }
  if (strcmp(want, npLine) || lyric != npLineLyric) {
    strlcpy(npOldLine, npLine, sizeof(npOldLine));
    npOldLyric = npLineLyric;
    strlcpy(npLine, want, sizeof(npLine));
    npLineLyric = lyric;
    npLineMs = npFactMs = now;
    npLineMoving = !all;
  }

  float tr = npLineMoving ? animProgress(npLineMs, now, 420) : 1.0f;
  bool scrolling = aaTextWidth(npLineFont(npLine, npLineLyric), npLine) > NP_LINE_X1 - NP_LINE_X0
                   && now - npLineMs < 30000;
  if (!(all || npLineMoving || (scrolling && now - npLastLine >= 40))) return;
  npLastLine = now;

  AASurface sf;
  int top = npLineBase() - AA_DISP14.ascent - 3, bottom = npLineBase() + AA_DISP14.descent + 2;
  if (!aaBegin(sf, NP_LINE_X0, top, NP_LINE_X1 - NP_LINE_X0, bottom - top, npBg())) return;
  if (tr >= 1) {
    npLineDraw(sf, npLine, npLineLyric, 0, 1, k, now - npLineMs);
    npLineMoving = false;
  } else {
    float e = easeInOutCubic(tr);
    int travel = bottom - top;
    npLineDraw(sf, npOldLine, npOldLyric, -(int)(e * travel * 0.6f), 1 - e, k, 0);
    npLineDraw(sf, npLine, npLineLyric, (int)((1 - e) * travel * 0.6f), e, k, 0);
  }
  aaEnd(sf);
}

static void npBars(const LumoState& s, float k, float t, float dt) {
  AASurface sf;
  uint16_t bg = npBg();
  const int x0 = 16, x1 = 304, top = VY(166), base = VY(198), refl = 8;
  if (!aaBegin(sf, x0 - 1, top - 2, x1 - x0 + 2, base - top + refl + 3, bg)) return;
  uint8_t r, g, b;
  displayArtTint(r, g, b);
  uint16_t lo = aaRGB(r, g, b, k * 0.75f);
  uint16_t hi = aaRGB(min(255, r / 2 + 128), min(255, g / 2 + 128), min(255, b / 2 + 128), k);
  const float pitch = (x1 - x0) / (float)NP_BARS, bw = pitch * 0.58f, maxH = base - top;
  float beat = nowPlayingBeat(s, t);
  float drive = 0.75f + 0.5f * s.sp_energy;          // a calm song moves less
  for (int i = 0; i < NP_BARS; i++) {
    float u = (float)i / (NP_BARS - 1);
    float target;
    if (npPlaying) {
      float body = 0.38f + 0.22f * sinf(t * (2.3f + u * 3.1f) + i * 0.71f)
                         + 0.16f * sinf(t * (5.7f - u * 2.0f) + i * 1.93f)
                         + 0.10f * sinf(t * 11.0f + i * 2.71f);
      float tilt = 1.0f - 0.45f * u;                // more energy in the lows
      target = animClamp((body * tilt + beat * (1 - u) * 0.45f) * drive);
    } else {
      target = 0.05f + 0.05f * (0.5f + 0.5f * sinf(t * 1.4f - u * 6.0f));   // a slow ripple
    }
    float rate = target > npBar[i] ? 0.045f : 0.22f;   // fast up, slow down
    npBar[i] += (target - npBar[i]) * (1 - expf(-dt / rate));
    float h = fmaxf(3.0f, npBar[i] * maxH);
    float x = x0 + i * pitch + (pitch - bw) / 2;
    uint16_t col = aaMix(lo, hi, (uint8_t)(animClamp(npBar[i]) * 200));
    aaRoundRect(sf, x, base - h, bw, h, bw / 2, col);
    aaRoundRect(sf, x, base + 2, bw, fminf(h * 0.18f, (float)refl), bw / 2, aaMix(bg, col, 60));   // reflection
  }
  aaEnd(sf);
}

void nowPlayingTick(const LumoState& s) {
  static unsigned long lastDraw = 0;
  unsigned long now = millis();
  if (!npNeedAll && now - lastDraw < 33) return;
  float dt = (now - lastDraw) / 1000.0f;
  if (dt > 0.2f || dt <= 0) dt = 0.033f;
  lastDraw = now;
  float t = now / 1000.0f;

  bool all = npNeedAll;
  // What changed since the last frame starts its animation.
  if (strcmp(s.sp_title, npTitle) || strcmp(s.sp_artist, npArtist)) {
    if (!npNeedAll && npTitle[0]) {
      strlcpy(npOldTitle, npTitle, sizeof(npOldTitle));
      strlcpy(npOldArtist, npArtist, sizeof(npOldArtist));
      npTitleMoving = true;
    }
    strlcpy(npTitle, s.sp_title, sizeof(npTitle));
    strlcpy(npArtist, s.sp_artist, sizeof(npArtist));
    npTitleMs = now;
  }
  if (s.sp_playing != npPlaying) {
    npPlaying = s.sp_playing;
    if (!npNeedAll) { npPlayMoving = true; npPlayMs = now; }
    all = true;                                  // the label changes too
  }
  if (newArtReady) {
    newArtReady = false;
    if (!npNeedAll) { npArtWiping = true; npArtMs = now; all = true; }   // new tint for the page
  }

  float enter = npEntered ? 1.0f : animProgress(npEnterMs, now, 500);
  if (enter >= 1 && !npEntered) { npEntered = true; all = true; }
  float k = easeOutCubic(enter);
  if (enter < 1) all = true;

  if (npNeedAll) tft.fillScreen(npBg());
  else if (npArtWiping && now - npArtMs < 30) {   // the page takes the new cover's tint; the old cover stays to be wiped over
    uint16_t bg = npBg();
    int ay = npArtY();
    tft.fillRect(0, 0, 320, ay, bg);
    tft.fillRect(0, ay + NP_ART, 320, 240 - ay - NP_ART, bg);
    tft.fillRect(0, ay, NP_ART_X, NP_ART, bg);
    tft.fillRect(NP_ART_X + NP_ART, ay, 320 - NP_ART_X - NP_ART, NP_ART, bg);
  }

  // the cover
  if (all || npArtWiping) {
    float reveal = 1;
    if (npArtWiping) {
      reveal = easeInOutCubic(animProgress(npArtMs, now, 520));
      if (reveal >= 1) npArtWiping = false;
    }
    int x = NP_ART_X - (int)((1 - k) * 18);
    if (enter < 1) tft.fillRect(0, npArtY(), NP_ART_X + NP_ART + 2, NP_ART, npBg());
    npCover(k, reveal, x);
  }

  // the title and artist (redrawn while changing or scrolling)
  float tr = npTitleMoving ? animProgress(npTitleMs, now, 460) : 1.0f;
  bool scrolling = aaTextWidth(AA_DISP20, npTitle) > NP_COL_R - NP_COL_X;
  if (all || npTitleMoving || (scrolling && now - npLastText >= 40)) {
    npText(k, tr, now);
    npLastText = now;
    if (tr >= 1) npTitleMoving = false;
  }

  char label[40];
  npLabelText(s, label, sizeof(label));
  if (all || strcmp(label, npLabelShown)) {
    npLabel(k, label);
    strlcpy(npLabelShown, label, sizeof(npLabelShown));
  }

  npLineTick(s, k, all, now);

  float pm = npPlayMoving ? animProgress(npPlayMs, now, 240) : 1.0f;
  if (all || npPlayMoving) {
    npControls(k, npPlaying ? 1 - pm : pm);    // shows pause while playing
    if (pm >= 1) npPlayMoving = false;
  }

  float bdt = npLastBars ? (now - npLastBars) / 1000.0f : dt;
  if (bdt > 0.2f) bdt = 0.2f;
  npLastBars = now;
  npBars(s, k, t, bdt);
  npNeedAll = false;
}

// ------------------------------------------------------------- Timer, stopwatch, world
// Firmware 2.7. Sage keeps the timer and stopwatch (desk/tools.py) and says
// where they stand; these screens count between its messages. Each band is
// redrawn only when what it shows changes.

static const uint16_t TOOL_BG = 0x0841;
static bool toolAll = true;
static char toolTitleShown[32], toolBigShown[24], toolHintShown[64];
static int  toolBarShown = -1, toolLapsShown = -1, toolMinuteShown = -1;
static uint16_t toolInkShown = 0;

void toolScreenReset() {
  toolAll = true;
  toolTitleShown[0] = toolBigShown[0] = toolHintShown[0] = '\0';
  toolBarShown = toolLapsShown = toolMinuteShown = -1;
}

// "4:59", or past an hour "1:02" with the seconds apart (":34"); the
// stopwatch adds tenths (".7") under an hour.
static void splitTime(uint32_t ms, bool tenths, char* big, size_t bn, char* small, size_t sn) {
  unsigned long secs = ms / 1000;
  unsigned long h = secs / 3600, m = (secs / 60) % 60, sec = secs % 60;
  if (h) {
    snprintf(big, bn, "%lu:%02lu", h, m);
    snprintf(small, sn, ":%02lu", sec);
  } else {
    snprintf(big, bn, "%lu:%02lu", m, sec);
    if (tenths) snprintf(small, sn, ".%lu", (unsigned long)(ms / 100) % 10);
    else small[0] = '\0';
  }
}

static void toolLine(const char* text, int baseline, const AAFont& f, uint16_t color, char* shown, size_t n) {
  if (!toolAll && strcmp(text, shown) == 0) return;
  strlcpy(shown, text, n);
  AASurface sf;
  if (band(sf, 0, 320, baseline, f, TOOL_BG)) {
    char fitted[64];
    strlcpy(fitted, text, sizeof(fitted));
    fitText(fitted, f, 300);
    aaTextCentered(sf, 160, baseline, fitted, f, color);
    aaEnd(sf);
  }
}

// The big time, with its small part (seconds past an hour, or tenths) after it.
static void toolBig(uint32_t ms, bool tenths, uint16_t ink) {
  char big[12], small[8], key[24];
  splitTime(ms, tenths, big, sizeof(big), small, sizeof(small));
  snprintf(key, sizeof(key), "%s%s", big, small);
  if (!toolAll && ink == toolInkShown && strcmp(key, toolBigShown) == 0) return;
  strlcpy(toolBigShown, key, sizeof(toolBigShown));
  toolInkShown = ink;
  const AAFont& f = AA_MONO_TIME;
  const int base = VY(124);
  AASurface sf;
  if (!aaBegin(sf, 0, base - f.ascent - 1, 320, f.ascent + f.descent + 3, TOOL_BG)) return;
  int wb = aaTextWidth(f, big), ws = small[0] ? aaTextWidth(AA_DISP20, small) + 4 : 0;
  int x = 160 - (wb + ws) / 2;
  x = aaText(sf, x, base, big, f, ink);
  if (small[0]) aaText(sf, x + 4, base, small, AA_DISP20, aaMix(ink, TOOL_BG, 70));
  aaEnd(sf);
}

static void timerScreen(const LumoState& s) {
  uint32_t left = 0;
  if (s.tm_state == TOOL_RUNNING) left = (int32_t)(s.tm_end - millis()) > 0 ? s.tm_end - millis() : 0;
  else if (s.tm_state == TOOL_PAUSED) left = s.tm_left_ms;
  else if (s.tm_state == TOOL_IDLE) left = s.tm_total_ms;
  const uint16_t white = aaRGB(236, 239, 244), muted = aaRGB(120, 128, 140), amber = aaRGB(255, 166, 64);

  toolLine(s.tm_label[0] ? s.tm_label : "Timer", VY(34), AA_SEMI11, muted, toolTitleShown, sizeof(toolTitleShown));

  uint16_t ink = white;
  if (s.tm_state == TOOL_PAUSED) ink = muted;
  else if (s.tm_state == TOOL_IDLE) ink = aaRGB(70, 76, 86);
  else if (s.tm_state == TOOL_DONE) {
    float k = 0.5f + 0.5f * sinf(millis() / 1000.0f * 6.2831853f * 1.2f);
    ink = aaMix(amber, white, (uint8_t)(k * 200));
  }
  // Rounded up, so "0:00" shows only when it has run out.
  toolBig(s.tm_state == TOOL_RUNNING || s.tm_state == TOOL_PAUSED ? ((left + 999) / 1000) * 1000 : left, false, ink);

  // What's left, as a bar.
  int fill = s.tm_total_ms && s.tm_state != TOOL_IDLE ? (int)(240.0f * left / s.tm_total_ms + 0.5f) : 0;
  if (toolAll || fill != toolBarShown) {
    toolBarShown = fill;
    AASurface sf;
    const int y = VY(150);
    if (aaBegin(sf, 36, y - 4, 248, 9, TOOL_BG)) {
      aaRoundRect(sf, 40, y - 2, 240, 4, 2, aaRGB(32, 36, 44));
      if (fill > 1) aaRoundRect(sf, 40, y - 2, fill, 4, 2, amber);
      aaEnd(sf);
    }
  }

  const char* hint = s.tm_state == TOOL_RUNNING ? "OK pause    < cancel    > 1 more min"
                   : s.tm_state == TOOL_PAUSED  ? "OK carry on    < cancel"
                   : s.tm_state == TOOL_DONE    ? "Time's up. Press any button."
                   : "OK starts it again. Set timers in Sage.";
  toolLine(hint, VY(196), AA_BODY11, s.tm_state == TOOL_DONE ? amber : muted, toolHintShown, sizeof(toolHintShown));
}

static void stopwatchScreen(const LumoState& s) {
  uint32_t ms = s.sw_base_ms + (s.sw_running ? millis() - s.sw_mark : 0);
  const uint16_t white = aaRGB(236, 239, 244), muted = aaRGB(120, 128, 140), teal = aaRGB(70, 220, 190);
  toolLine("Stopwatch", VY(34), AA_SEMI11, muted, toolTitleShown, sizeof(toolTitleShown));
  toolBig(ms, true, s.sw_running || ms == 0 ? white : muted);

  // The last laps, newest first, numbered as Sage counts them.
  int laps = s.sw_lap_count * 8 + s.sw_lap_shown;
  if (toolAll || laps != toolLapsShown) {
    toolLapsShown = laps;
    AASurface sf;
    const int top = VY(140), h = VY(188) - top;
    if (aaBegin(sf, 0, top, 320, h, TOOL_BG)) {
      int rows = min((int)s.sw_lap_shown, 3);
      for (int i = 0; i < rows; i++) {
        int idx = s.sw_lap_shown - 1 - i;
        char name[12], big[12], small[8], t[24];
        snprintf(name, sizeof(name), "Lap %u", (unsigned)(s.sw_lap_count - i));
        splitTime(s.sw_laps[idx], true, big, sizeof(big), small, sizeof(small));
        snprintf(t, sizeof(t), "%s%s", big, small);
        int base = top + 13 + i * 16;
        uint16_t c = i == 0 ? teal : muted;
        aaText(sf, 96, base, name, AA_BODY11, c);
        aaTextRight(sf, 224, base, t, AA_BODY11, c);
      }
      aaEnd(sf);
    }
  }

  const char* hint = s.sw_running ? "OK pause    > lap" : ms ? "OK carry on    < reset" : "OK start";
  toolLine(hint, VY(204), AA_BODY11, muted, toolHintShown, sizeof(toolHintShown));
}

static void worldScreen(const LumoState& s, const ClockNow& c) {
  if (!toolAll && c.m == toolMinuteShown) return;
  toolMinuteShown = c.m;
  const uint16_t white = aaRGB(236, 239, 244), muted = aaRGB(120, 128, 140), line = aaRGB(30, 34, 42);
  toolLine("World", VY(26), AA_SEMI11, muted, toolTitleShown, sizeof(toolTitleShown));
  if (!s.wc_count) {
    toolLine("Add places on the LUMO page in Sage", VY(118), AA_BODY11, muted, toolHintShown, sizeof(toolHintShown));
    toolAll = false;
    return;
  }
  int here = c.h * 60 + c.m;
  int rows = s.wc_count + 1;
  int rowH = (VY(210) - VY(40)) / rows;
  for (int r = 0; r < rows; r++) {
    int mins = here + (r ? s.wc_offset[r - 1] : 0);
    int dayShift = mins < 0 ? -1 : mins >= 1440 ? 1 : 0;
    mins = (mins % 1440 + 1440) % 1440;
    char hs[4], t[16], sub[32];
    hourText(s, mins / 60, hs, sizeof(hs));
    if (s.hour24) snprintf(t, sizeof(t), "%s:%02d", hs, mins % 60);
    else snprintf(t, sizeof(t), "%s:%02d %s", hs, mins % 60, mins >= 720 ? "PM" : "AM");
    if (r == 0) {
      snprintf(sub, sizeof(sub), "%s", s.weekday);
    } else {
      int off = s.wc_offset[r - 1], a = abs(off);
      const char* day = dayShift < 0 ? "Yesterday" : dayShift > 0 ? "Tomorrow" : "Today";
      if (!off) snprintf(sub, sizeof(sub), "%s, same time", day);
      else if (a % 60) snprintf(sub, sizeof(sub), "%s, %d:%02d %s", day, a / 60, a % 60, off > 0 ? "ahead" : "behind");
      else snprintf(sub, sizeof(sub), "%s, %d h %s", day, a / 60, off > 0 ? "ahead" : "behind");
    }
    AASurface sf;
    int top = VY(40) + r * rowH;
    if (aaBegin(sf, 0, top, 320, rowH, TOOL_BG)) {
      if (r) aaLine(sf, 24, top + 0.5f, 296, top + 0.5f, 1, line);
      int mid = top + rowH / 2;
      aaText(sf, 24, mid - 2, r ? s.wc_name[r - 1] : "Here", AA_SEMI11, r ? white : muted);
      aaText(sf, 24, mid + 14, sub, AA_BODY11, muted);
      aaTextRight(sf, 296, mid + 8, t, AA_DISP20, r ? white : muted);
      aaEnd(sf);
    }
  }
}

void toolScreenTick(ScreenMode screen, const LumoState& s) {
  static unsigned long last = 0;
  unsigned long now = millis();
  if (!toolAll && now - last < 40) return;   // ~25 fps is plenty
  last = now;
  if (screen == SCREEN_TIMER) timerScreen(s);
  else if (screen == SCREEN_STOPWATCH) stopwatchScreen(s);
  else if (screen == SCREEN_WORLD) {
    ClockNow c = clockNow();
    if (!c.synced) { c.h = s.h; c.m = s.m; }
    worldScreen(s, c);
  }
  toolAll = false;
}
