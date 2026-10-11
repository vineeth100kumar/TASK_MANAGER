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

bool faceIsPremium(ClockStyle style) { return style >= CLOCK_MONOLITH && style <= CLOCK_DIAL; }

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
  uint16_t bg = MONO_BG;
  uint16_t mute = aaRGB(120, 124, 130, k), acc = aaRGB(214, 170, 110, k);
  AASurface sf;
  char buf[48], hs[4], ms[8], day[4], mon[8];

  if (minute) {
    dateParts(s, day, sizeof(day), mon, sizeof(mon));
    snprintf(buf, sizeof(buf), "%s  %s %s", fullName(s.weekday, DAYS, 7), day, fullName(mon, MONTHS, 12));
    upper(buf);
    if (band(sf, 0, 320, VY(34), AA_CAPS9, bg)) {
      aaTextCentered(sf, 160, VY(34), buf, AA_CAPS9, mute, 2);
      aaEnd(sf);
    }

  }

  if (a.all || a.timeBand) {
    bool old = a.tr < 0.5f && prevM >= 0;
    float fk = a.tr >= 1 ? 1.0f : easeInOutCubic(old ? 1 - a.tr * 2 : a.tr * 2 - 1);
    hourText(s, old ? prevH : c.h, hs, sizeof(hs));
    snprintf(ms, sizeof(ms), "%02d", old ? prevM : c.m);
    snprintf(buf, sizeof(buf), "%s:%s", hs, ms);
    if (band(sf, 0, 320, VY(130), AA_MONO_TIME, bg)) {
      aaTextCentered(sf, 160, VY(130), buf, AA_MONO_TIME, aaRGB(238, 236, 230, k * fk));
      aaEnd(sf);
    }
  }

  if (minute) {
    if (band(sf, 0, 320, VY(190), AA_BODY11, bg)) {
      if (!zone2Text(s, c, buf, sizeof(buf))) {
        char cond[16];
        conditionText(s, cond, sizeof(cond));
        snprintf(buf, sizeof(buf), "%.0f\x7F  %s", s.temp_c, cond);
      }
      fitText(buf, AA_BODY11, 100);
      aaText(sf, 70, VY(190), buf, AA_BODY11, mute);
      if (s.alarm_set) {
        char a[16], line[24];
        alarmText(s, a, sizeof(a), false);
        snprintf(line, sizeof(line), "Alarm %s", a);
        aaTextRight(sf, 250, VY(190), line, AA_BODY11, acc);
      }
      aaEnd(sf);
    }
  }

  // Seconds: a dot travelling along a hairline.
  int y = VY(160);
  if (aaBegin(sf, 64, y - 4, 192, 9, bg)) {
    if (s.show_seconds && c.synced) {
      aaLine(sf, 70, y + 0.5f, 250, y + 0.5f, 1.0f, aaRGB(40, 42, 46, k));
      aaDisc(sf, 70 + 180.0f * (c.s + c.secFrac) / 60.0f, y + 0.5f, 2.3f, acc);
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
  uint16_t bg = STACK_BG;
  uint16_t ink = aaRGB(245, 243, 238, k), acc = aaRGB(255, 159, 67, k), mute = aaRGB(128, 132, 140, k);
  uint16_t rule = aaRGB(34, 36, 40, k);
  AASurface sf;
  char buf[32], hs[4], ms[8];

  char phs[4], pms[8];
  hourText(s, c.h, hs, sizeof(hs));
  snprintf(ms, sizeof(ms), "%02d", c.m);
  hourText(s, prevH >= 0 ? prevH : c.h, phs, sizeof(phs));
  snprintf(pms, sizeof(pms), "%02d", prevM >= 0 ? prevM : c.m);
  int top = VY(14), base = VY(94);
  int hBandH = base + AA_STACK_TIME.descent + 3 - top;
  if ((a.all || strcmp(phs, hs)) && aaBegin(sf, 0, top, 186, hBandH, bg)) {
    rollText(sf, 18, base, hBandH, phs, hs, a.tr, AA_STACK_TIME, ink);
    int x = 18 + aaTextWidth(AA_STACK_TIME, hs);
    if (!s.hour24) aaText(sf, x + 8, VY(28), c.h >= 12 ? "PM" : "AM", AA_SEMI11, mute);
    aaEnd(sf);
  }
  if (band(sf, 0, 186, VY(194), AA_STACK_TIME, bg)) {
    rollText(sf, 18, VY(194), sf.h, pms, ms, a.tr, AA_STACK_TIME, acc);
    aaEnd(sf);
  }

  if (!a.all) return;
  // The details column.
  const int x = 196, right = 304;
  if (!aaBegin(sf, 186, VY(26), 320 - 186, VY(196) - VY(26), bg)) return;
  char day[4], mon[8];
  dateParts(s, day, sizeof(day), mon, sizeof(mon));
  snprintf(buf, sizeof(buf), "%s", s.weekday);
  upper(buf);
  aaText(sf, x, VY(44), buf, AA_SEMI11, mute, 2);
  snprintf(buf, sizeof(buf), "%s %s", day, mon);
  aaText(sf, x, VY(69), buf, AA_DISP20, ink);
  aaLine(sf, x, VY(86) + 0.5f, right, VY(86) + 0.5f, 1.0f, rule);

  if (zone2Text(s, c, buf, sizeof(buf))) {
    char* sp = strrchr(buf, ' ');               // "London 09:50": time big, place small
    if (sp) { *sp = '\0'; aaText(sf, x, VY(113), sp + 1, AA_DISP20, ink); }
    fitText(buf, AA_BODY11, right - x);
    aaText(sf, x, VY(130), buf, AA_BODY11, mute);
  } else {
    snprintf(buf, sizeof(buf), "%.0f\x7F", s.temp_c);
    aaText(sf, x, VY(113), buf, AA_DISP20, ink);
    conditionText(s, buf, sizeof(buf));
    fitText(buf, AA_BODY11, right - x);
    aaText(sf, x, VY(130), buf, AA_BODY11, mute);
  }
  aaLine(sf, x, VY(146) + 0.5f, right, VY(146) + 0.5f, 1.0f, rule);

  if (s.alarm_set) {
    aaDisc(sf, x + 3, VY(162), 3, acc);
    alarmText(s, buf, sizeof(buf), true);
    aaText(sf, x + 12, VY(167), buf, AA_DISP14, ink);
    aaText(sf, x + 12, VY(184), "Alarm", AA_BODY11, mute);
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
  int base = VY(136), pad = f.glowPad;
  int top = base - f.ascent - pad - 1;
  if (aaBegin(sf, 0, top, 320, f.ascent + f.descent + 2 * pad + 3, bg)) {
    int x = 160 - aaTextWidth(f, buf) / 2;
    aaGlow(sf, x, base, buf, f, aaRGB(190, 85, 25, k * halo), 210);
    aaText(sf, x, base, buf, f, aaRGB(255, 150, 60, k * ink));
    aaEnd(sf);
  }

  if (minute && band(sf, 0, 320, VY(170), AA_BODY11, bg)) {
    char day[4], mon[8], date[24];
    dateParts(s, day, sizeof(day), mon, sizeof(mon));
    snprintf(date, sizeof(date), "%s %s %s", s.weekday, day, mon);
    if (s.alarm_set) {
      char a[12], line[20];
      alarmText(s, a, sizeof(a), false);
      snprintf(line, sizeof(line), "Alarm %s", a);
      int gap = 26, w = aaTextWidth(AA_BODY11, date) + gap + aaTextWidth(AA_BODY11, line);
      int x = aaText(sf, 160 - w / 2, VY(170), date, AA_BODY11, info);
      aaDisc(sf, x + gap / 2.0f, VY(170) - 3.5f, 1.3f, info);
      aaText(sf, x + gap, VY(170), line, AA_BODY11, info);
    } else {
      aaTextCentered(sf, 160, VY(170), date, AA_BODY11, info);
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
  uint16_t bg = DIAL_BG;
  uint16_t face = aaRGB(17, 19, 22), ink = aaRGB(236, 234, 228, k), mute = aaRGB(120, 124, 130, k);
  uint16_t orange = aaRGB(255, 122, 60, k);
  AASurface sf;
  char buf[32], day[4], mon[8];
  dateParts(s, day, sizeof(day), mon, sizeof(mon));

  const float R = 94.0f * VIS_H / 216;
  const float cx = 108, cy = VIS_T + VIS_H / 2.0f;
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

  if (!minute) return;
  const int x = 226, right = 316;
  if (!aaBegin(sf, 212, VY(30), 320 - 212, VY(196) - VY(30), bg)) return;
  snprintf(buf, sizeof(buf), "%s", fullName(s.weekday, DAYS, 7));
  upper(buf);
  aaText(sf, x, VY(47), buf, AA_CAPS9, mute, 2);
  snprintf(buf, sizeof(buf), "%s %s", day, mon);
  aaText(sf, x, VY(71), buf, AA_DISP20, ink);

  if (zone2Text(s, c, buf, sizeof(buf))) {
    char* sp = strrchr(buf, ' ');
    aaText(sf, x, VY(107), "ELSEWHERE", AA_CAPS9, mute, 2);
    if (sp) *sp = '\0';
    char line[40];
    snprintf(line, sizeof(line), "%s %s", sp ? sp + 1 : "", buf);
    fitText(line, AA_DISP14, right - x);
    aaText(sf, x, VY(129), line, AA_DISP14, ink);
  } else {
    aaText(sf, x, VY(107), "WEATHER", AA_CAPS9, mute, 2);
    char cond[16];
    conditionText(s, cond, sizeof(cond));
    snprintf(buf, sizeof(buf), "%.0f\x7F %s", s.temp_c, cond);
    fitText(buf, AA_DISP14, right - x);
    aaText(sf, x, VY(129), buf, AA_DISP14, ink);
  }

  if (s.alarm_set) {
    aaText(sf, x, VY(165), "ALARM", AA_CAPS9, mute, 2);
    alarmText(s, buf, sizeof(buf), true);
    aaText(sf, x, VY(187), buf, AA_DISP14, orange);
  }
  aaEnd(sf);
}

// ------------------------------------------------------------- driver

static uint16_t faceBg(ClockStyle st) {
  switch (st) {
    case CLOCK_STACKED:    return STACK_BG;
    case CLOCK_NIGHTSTAND: return NIGHT_BG;
    case CLOCK_DIAL:       return DIAL_BG;
    default:               return MONO_BG;
  }
}

void faceTick(const LumoState& s, const ClockNow& c) {
  static unsigned long lastDraw = 0;
  unsigned long now = millis();
  float enter = entryDone ? 1.0f : animProgress(enterMs, now, ENTER_MS);
  unsigned long turn = turnMs(s.clock_style);
  bool turning = !transDone;
  bool animating = enter < 1 || turning;
  if (!needAll && now - lastDraw < (animating ? 33UL : 50UL)) return;
  lastDraw = now;

  // Same day-phase dimming as the classic clock: calm at night, never dark.
  float k = 0.5f + 0.5f * clockPhase(c.minuteOfDay).level;
  bool minute = needAll || c.m != lastMinute || fabsf(k - lastDim) > 0.03f;
  bool second = minute || c.s != lastSecond;
  bool smooth = s.clock_style == CLOCK_MONOLITH && s.show_seconds;   // the dot glides

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

  FaceAnim an;
  an.enter = enter;
  an.k = k * easeInOutCubic(enter);
  an.all = minute;
  an.timeBand = turning;
  an.second = second;
  an.tr = tr;

  if (needAll) tft.fillScreen(faceBg(s.clock_style));
  switch (s.clock_style) {
    case CLOCK_MONOLITH:   monolith(s, c, an); break;
    case CLOCK_STACKED:    stacked(s, c, an); break;
    case CLOCK_NIGHTSTAND: nightstand(s, c, an); break;
    case CLOCK_DIAL:       dial(s, c, an); break;
    default: break;
  }
  needAll = false;
  lastMinute = c.m;
  lastSecond = c.s;
  if (minute && enter >= 1) lastDim = k;
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
//  reads like a real spectrum.
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

void nowPlayingReset() {
  npNeedAll = true;
  npEnterMs = millis();
  npEntered = false;
  npArtWiping = npTitleMoving = npPlayMoving = false;
  npOldTitle[0] = npOldArtist[0] = '\0';
  for (int i = 0; i < NP_BARS; i++) npBar[i] = 0;
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

// The small label over the title, with four tiny bars when playing.
static void npLabel(float k) {
  AASurface sf;
  uint16_t bg = npBg();
  int base = VY(30);
  if (!aaBegin(sf, NP_COL_X, base - 12, NP_COL_R - NP_COL_X, 15, bg)) return;
  aaText(sf, NP_COL_X, base, npPlaying ? "NOW PLAYING" : "PAUSED", AA_CAPS9, npTint(k), 2);
  aaEnd(sf);
}

static void npBars(float k, float t, float dt) {
  AASurface sf;
  uint16_t bg = npBg();
  const int x0 = 16, x1 = 304, top = VY(146), base = VY(198), refl = 8;
  if (!aaBegin(sf, x0 - 1, top - 2, x1 - x0 + 2, base - top + refl + 3, bg)) return;
  uint8_t r, g, b;
  displayArtTint(r, g, b);
  uint16_t lo = aaRGB(r, g, b, k * 0.75f);
  uint16_t hi = aaRGB(min(255, r / 2 + 128), min(255, g / 2 + 128), min(255, b / 2 + 128), k);
  const float pitch = (x1 - x0) / (float)NP_BARS, bw = pitch * 0.58f, maxH = base - top;
  float beat = powf(0.5f + 0.5f * cosf(t * 6.2831853f * 1.97f), 6.0f);   // ~118 bpm
  for (int i = 0; i < NP_BARS; i++) {
    float u = (float)i / (NP_BARS - 1);
    float target;
    if (npPlaying) {
      float body = 0.38f + 0.22f * sinf(t * (2.3f + u * 3.1f) + i * 0.71f)
                         + 0.16f * sinf(t * (5.7f - u * 2.0f) + i * 1.93f)
                         + 0.10f * sinf(t * 11.0f + i * 2.71f);
      float tilt = 1.0f - 0.45f * u;                // more energy in the lows
      target = animClamp(body * tilt + beat * (1 - u) * 0.45f);
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

  if (all) npLabel(k);

  float pm = npPlayMoving ? animProgress(npPlayMs, now, 240) : 1.0f;
  if (all || npPlayMoving) {
    npControls(k, npPlaying ? 1 - pm : pm);    // shows pause while playing
    if (pm >= 1) npPlayMoving = false;
  }

  float bdt = npLastBars ? (now - npLastBars) / 1000.0f : dt;
  if (bdt > 0.2f) bdt = 0.2f;
  npLastBars = now;
  npBars(k, t, bdt);
  npNeedAll = false;
}
