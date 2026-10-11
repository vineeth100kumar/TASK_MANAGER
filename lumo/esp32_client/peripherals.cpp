#include <Arduino.h>
#include "peripherals.h"
#include "clockkeeper.h"
#include "display.h"
#include <math.h>

Adafruit_NeoPixel pixels(NUMPIXELS, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);

static unsigned long hapticEndTime = 0;
static bool hapticActive = false;

void hapticPulse(uint16_t ms) {
  ledcWrite(BUZZER_PIN, 5);
  hapticEndTime = millis() + ms;
  hapticActive = true;
}

void hapticOff() {
  ledcWrite(BUZZER_PIN, 255);
  hapticActive = false;
}

void hapticUpdate() {
  if (hapticActive && millis() >= hapticEndTime) {
    hapticOff();
  }
}

// =====================================================================
//  NeoPixel scene engine
//
//  Every scene is a pure function of time that fills a float RGB frame in
//  *perceptual* space (0..1). A final stage smooths the frame, applies gamma,
//  scales by the master brightness and error-diffuses to 8 bits, so slow fades
//  stay silky even at the very low levels a bedside light lives at.
// =====================================================================

struct Rgb { float r, g, b; };

static inline Rgb   rgb(float r, float g, float b) { Rgb c = {r, g, b}; return c; }
static inline float clamp01(float x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
static inline Rgb   mixc(Rgb a, Rgb b, float t) {
  return rgb(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}
static inline Rgb   scalec(Rgb a, float k) { return rgb(a.r * k, a.g * k, a.b * k); }
static inline Rgb   addc(Rgb a, Rgb b)    { return rgb(a.r + b.r, a.g + b.g, a.b + b.b); }

static Rgb hsv(float h, float s, float v) {
  h = h - floorf(h);
  float c = v * s;
  float x = c * (1.0f - fabsf(fmodf(h * 6.0f, 2.0f) - 1.0f));
  float m = v - c;
  float r, g, b;
  int sector = (int)(h * 6.0f);
  switch (sector) {
    case 0:  r = c; g = x; b = 0; break;
    case 1:  r = x; g = c; b = 0; break;
    case 2:  r = 0; g = c; b = x; break;
    case 3:  r = 0; g = x; b = c; break;
    case 4:  r = x; g = 0; b = c; break;
    default: r = c; g = 0; b = x; break;
  }
  return rgb(r + m, g + m, b + m);
}

// Engine state
static NeoMode  baseMode   = NEO_AUTO;
static uint8_t  baseBri    = 40;
static uint16_t baseHue    = 0;
static bool     onClock    = false;
static bool     sleeping   = false;
static bool     alarmOn    = false;
static VoiceFx  voiceFx    = VFX_NONE;
static float    voiceLevel = 0.0f;
static unsigned long pingStart = 0;
static Rgb      pingColor  = {1, 1, 1};
static bool     pingActive = false;

static Rgb      frameCur[NUMPIXELS];            // smoothed, perceptual
static float    ditherErr[NUMPIXELS][3];
static uint8_t  lastOut[NUMPIXELS][3];
static unsigned long lastFrameMs = 0;
static bool     forceShow = true;

// What the screen is showing, for the AUTO scene: each clock face and each
// screen has a light of its own (see sceneAuto).
static ScreenMode       ctxScreen = SCREEN_CONNECTING;
static const LumoState* ctx       = nullptr;
static unsigned long    ctxSince  = 0;

void initNeoPixels() {
  pixels.begin();
  pixels.setBrightness(255);   // scaling is done in the engine, in linear light
  pixels.clear();
  pixels.show();
  for (int i = 0; i < NUMPIXELS; i++) frameCur[i] = rgb(0, 0, 0);
}

void neoSetMode(NeoMode mode, uint8_t brightness, uint16_t hue) {
  baseMode = mode;
  baseBri  = brightness;
  baseHue  = hue;
}
void applyNeoPixels(NeoMode mode, uint8_t brightness, uint16_t hue) { neoSetMode(mode, brightness, hue); }
void neoSetClockScreen(bool c)  { onClock = c; }
void neoSetContext(ScreenMode screen, const LumoState& s) {
  if (screen != ctxScreen || (ctx && ctx->clock_style != s.clock_style)) ctxSince = millis();
  ctxScreen = screen;
  ctx = &s;
}
void neoSetSleep(bool s)        { sleeping = s; }
void neoSetAlarm(bool r)        { alarmOn = r; }
void neoSetVoice(VoiceFx fx, float level) { voiceFx = fx; voiceLevel = constrain(level, 0.0f, 1.0f); }
void neoPing(uint8_t r, uint8_t g, uint8_t b) {
  pingColor  = rgb(r / 255.0f, g / 255.0f, b / 255.0f);
  pingStart  = millis();
  pingActive = true;
}
void neoClear() {
  for (int i = 0; i < NUMPIXELS; i++) frameCur[i] = rgb(0, 0, 0);
  pixels.clear();
  pixels.show();
  memset(lastOut, 0, sizeof(lastOut));
}

// A bright head sweeping round the ring with a tail behind it. `pos` is in
// pixel units, so the head glides *between* LEDs instead of hopping.
static float cometAt(float pos, int i, float tailK) {
  float d = pos - i;
  const float half = NUMPIXELS / 2.0f;
  while (d >  half) d -= NUMPIXELS;
  while (d <= -half) d += NUMPIXELS;
  if (d >= 0.0f)  return expf(-d * tailK);
  if (d > -1.0f)  return 1.0f + d;   // soft leading edge
  return 0.0f;
}

static const float TWO_PI_F = 6.2831853f;

// ---- scenes ---------------------------------------------------------

static void sceneDigital(float t, Rgb* out, float& tau) {
  ClockNow now = clockNow();
  PhaseStyle ph = clockPhase(now.minuteOfDay);
  Rgb pc = rgb(ph.r / 255.0f, ph.g / 255.0f, ph.b / 255.0f);

  float breath = 0.5f - 0.5f * cosf(t * TWO_PI_F / 9.0f);
  float dayGain = 0.40f + 0.60f * ph.level;
  float glow = (0.50f + 0.14f * breath) * dayGain;
  if (sleeping) glow *= 0.30f;

  tau = 0.22f;

  float sec = now.s + now.secFrac;
  for (int i = 0; i < NUMPIXELS; i++) {
    // A slow, phase-offset shimmer keeps the base from looking like a flat fill.
    float shimmer = 0.94f + 0.06f * sinf(t * 0.7f + i * 1.05f);
    out[i] = scalec(pc, glow * shimmer);
  }

  if (!onClock) return;

  // Seconds comet: one lap a minute, brighter by day, a whisper at night.
  float cometGain = sleeping ? 0.30f : (0.35f + 0.65f * ph.level);
  Rgb cometCol = mixc(pc, rgb(1, 1, 1), 0.55f);
  float pos = sec / 60.0f * NUMPIXELS;
  for (int i = 0; i < NUMPIXELS; i++) {
    float k = cometAt(pos, i, 1.15f);
    out[i] = addc(out[i], scalec(cometCol, k * cometGain * 0.85f));
  }
  tau = 0.07f;

  // Top of the minute: the whole ring swells once.
  if (sec < 1.4f) {
    float env = sinf(3.14159f * sec / 1.4f);
    for (int i = 0; i < NUMPIXELS; i++) out[i] = addc(out[i], scalec(pc, env * 0.35f * cometGain));
  }

  // Top of the hour: a rainbow ripple turns once around the ring.
  if (now.m == 0 && sec < 4.0f && !sleeping) {
    float env = sinf(3.14159f * sec / 4.0f);
    for (int i = 0; i < NUMPIXELS; i++) {
      Rgb rb = hsv((float)i / NUMPIXELS + t * 0.35f, 0.75f, 0.9f);
      out[i] = mixc(out[i], rb, env * 0.85f);
    }
  }
}

// ---- AUTO: a light for every face and screen ----------------------

// A soft blob of light centred at `pos` (in pixels, wrapping round the ring)
// and `width` pixels wide, so a "hand" glides between LEDs.
static float blobAt(float pos, int i, float width) {
  float d = fabsf(pos - i);
  d = fmodf(d, (float)NUMPIXELS);
  if (d > NUMPIXELS / 2.0f) d = NUMPIXELS - d;
  return d >= width ? 0.0f : 0.5f + 0.5f * cosf(3.14159f * d / width);
}

static inline Rgb rgb8(uint8_t r, uint8_t g, uint8_t b) { return rgb(r / 255.0f, g / 255.0f, b / 255.0f); }
static inline float breathe(float t, float period) { return 0.5f - 0.5f * cosf(t * TWO_PI_F / period); }

// Minimal: the colour of the day, breathing slowly. Nothing moves.
static void sceneMinimal(float t, Rgb* out, float& tau, Rgb pc, float level) {
  tau = 0.3f;
  float g = (0.30f + 0.10f * breathe(t, 11.0f)) * level;
  for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(pc, g);
}

// Analog: the ring is a second dial. The hour is a warm blob in the day's
// colour, the minute a white one, and the seconds a faint glint going round.
static void sceneAnalog(const ClockNow& c, Rgb* out, float& tau, Rgb pc, float level) {
  tau = 0.08f;
  float sec = c.s + c.secFrac;
  float hr = ((c.h % 12) + c.m / 60.0f) / 12.0f * NUMPIXELS;
  float mn = (c.m + sec / 60.0f) / 60.0f * NUMPIXELS;
  float sc = sec / 60.0f * NUMPIXELS;
  for (int i = 0; i < NUMPIXELS; i++) {
    Rgb o = scalec(pc, 0.10f * level);
    o = addc(o, scalec(pc, 0.85f * level * blobAt(hr, i, 1.6f)));
    o = addc(o, scalec(rgb(1, 1, 1), 0.60f * level * blobAt(mn, i, 1.2f)));
    o = addc(o, scalec(mixc(pc, rgb(1, 1, 1), 0.5f), 0.25f * level * cometAt(sc, i, 1.6f)));
    out[i] = o;
  }
}

// Monolith: gallery light. A still, warm-white wash with the face's gold dot
// travelling round once a minute, and a soft dip as the minute cross-fades.
static void sceneMonolith(const ClockNow& c, Rgb* out, float& tau, float level) {
  tau = 0.10f;
  float sec = c.s + c.secFrac;
  float dip = sec < 0.6f ? 0.55f + 0.45f * fabsf(sec / 0.3f - 1.0f) : 1.0f;
  Rgb wash = rgb8(238, 232, 220), gold = rgb8(214, 160, 90);
  float pos = sec / 60.0f * NUMPIXELS;
  for (int i = 0; i < NUMPIXELS; i++) {
    Rgb o = scalec(wash, 0.22f * level * dip);
    out[i] = addc(o, scalec(gold, 0.75f * level * blobAt(pos, i, 1.3f)));
  }
}

// Stacked: the hour fills up in the face's orange, a sixth of the ring every
// ten minutes, over a dim warm white. The leading edge breathes.
static void sceneStacked(float t, const ClockNow& c, Rgb* out, float& tau, float level) {
  tau = 0.25f;
  Rgb base = rgb8(245, 235, 220), orange = rgb8(255, 140, 50);
  float fill = (c.m + (c.s + c.secFrac) / 60.0f) / 60.0f * NUMPIXELS;
  float edge = 0.55f + 0.45f * breathe(t, 2.4f);
  for (int i = 0; i < NUMPIXELS; i++) {
    float f = clamp01(fill - i);                 // 1 full, 0 empty, between: the edge
    float k = f >= 1 ? 0.70f : f * 0.70f * edge;
    out[i] = mixc(scalec(base, 0.22f * level), scalec(orange, level), k);
  }
}

// Nightstand: an ember. Deep amber, very low, flickering like a filament,
// and sinking and warming back up with the minute like the digits do.
static void sceneNightstand(float t, const ClockNow& c, Rgb* out, float& tau, float level) {
  tau = 0.35f;
  float sec = c.s + c.secFrac;
  float turn = sec < 1.2f ? 0.45f + 0.55f * fabsf(sec / 0.6f - 1.0f) : 1.0f;
  Rgb ember = rgb8(255, 120, 30);
  for (int i = 0; i < NUMPIXELS; i++) {
    float flick = 0.86f + 0.07f * sinf(t * 0.9f + i * 2.3f) + 0.05f * sinf(t * 2.3f + i * 0.8f)
                        + 0.02f * sinf(t * 5.1f + i * 1.7f);
    out[i] = scalec(ember, 0.20f * (0.6f + 0.4f * level) * flick * turn);
  }
}

// Dial: brushed steel with the dial's orange second hand sweeping round, and
// the hour picked out in white.
static void sceneDial(const ClockNow& c, Rgb* out, float& tau, float level) {
  tau = 0.05f;
  float sec = c.s + c.secFrac;
  float hr = ((c.h % 12) + c.m / 60.0f) / 12.0f * NUMPIXELS;
  Rgb steel = rgb8(150, 165, 185), orange = rgb8(255, 110, 45);
  for (int i = 0; i < NUMPIXELS; i++) {
    Rgb o = scalec(steel, 0.10f * level);
    o = addc(o, scalec(rgb(1, 1, 1), 0.30f * level * blobAt(hr, i, 1.0f)));
    out[i] = addc(o, scalec(orange, 0.95f * level * cometAt(sec / 60.0f * NUMPIXELS, i, 1.3f)));
  }
}

// Now playing: the cover's own colour. Playing, it breathes on a slow beat
// with a brighter swell travelling round; paused, it rests at a low glow.
static void sceneMusic(float t, Rgb* out, float& tau, bool playing) {
  uint8_t r, g, b;
  displayArtTint(r, g, b);
  Rgb tint = rgb8(r, g, b);
  if (!playing) {
    tau = 0.6f;
    float k = 0.14f + 0.06f * breathe(t, 6.0f);
    for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(tint, k);
    return;
  }
  tau = 0.07f;
  float beat = powf(breathe(t, 0.92f), 3.0f);
  float pos = fmodf(t / 3.2f, 1.0f) * NUMPIXELS;
  for (int i = 0; i < NUMPIXELS; i++) {
    float k = 0.30f + 0.20f * beat + 0.50f * blobAt(pos, i, 2.2f);
    out[i] = scalec(mixc(tint, rgb(1, 1, 1), 0.15f * beat), k);
  }
}

// System: colour from the CPU temperature (cool teal, amber, then red) with a
// comet that runs faster the busier the Pi is.
static void sceneSystem(float t, Rgb* out, float& tau, const LumoState& s) {
  tau = 0.06f;
  float heat = clamp01((s.cpu_temp - 45.0f) / 30.0f);
  Rgb col = heat < 0.5f ? mixc(rgb8(0, 220, 170), rgb8(255, 170, 30), heat * 2)
                        : mixc(rgb8(255, 170, 30), rgb8(255, 40, 20), heat * 2 - 1);
  static float phase = 0, lastT = 0;
  float dt = t - lastT; lastT = t;
  if (dt > 0 && dt < 0.2f) phase += dt / (3.5f - 2.8f * clamp01(s.cpu_pct / 100.0f));
  float pos = fmodf(phase, 1.0f) * NUMPIXELS;
  for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(col, 0.10f + 0.80f * cometAt(pos, i, 1.0f));
}

// Tasks: one light for each open task (up to six), breathing in turn. None
// left: a calm green.
static void sceneTasks(float t, Rgb* out, float& tau, const LumoState& s) {
  tau = 0.2f;
  int n = s.task_count < NUMPIXELS ? s.task_count : NUMPIXELS;
  if (n == 0) {
    for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb8(40, 230, 120), 0.20f + 0.10f * breathe(t, 7.0f));
    return;
  }
  for (int i = 0; i < NUMPIXELS; i++) {
    float k = i < n ? 0.35f + 0.45f * breathe(t - i * 0.35f, 3.0f) : 0.03f;
    out[i] = scalec(rgb8(0, 200, 255), k);
  }
}

// Connecting: a cyan light searching round the ring; refused, a slow red.
static void sceneConnecting(float t, Rgb* out, float& tau, const LumoState& s) {
  if (s.pair_refused) {
    tau = 0.3f;
    for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb8(255, 40, 30), 0.15f + 0.35f * breathe(t, 3.0f));
    return;
  }
  tau = 0.05f;
  float pos = fmodf(t / 1.6f, 1.0f) * NUMPIXELS;
  for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb8(0, 229, 255), 0.04f + 0.86f * cometAt(pos, i, 1.0f));
}

// Memories: slow warm drifts of peach, rose and gold, like late sun.
static void sceneMemory(float t, Rgb* out, float& tau) {
  tau = 0.4f;
  const Rgb peach = rgb8(255, 150, 90), rose = rgb8(255, 90, 120), gold = rgb8(255, 190, 70);
  for (int i = 0; i < NUMPIXELS; i++) {
    float u = 0.5f + 0.5f * sinf(t * 0.21f + i * 1.1f);
    float v = 0.5f + 0.5f * sinf(t * 0.13f - i * 0.8f + 2.0f);
    out[i] = scalec(mixc(mixc(peach, rose, u), gold, v * 0.5f), 0.35f + 0.15f * sinf(t * 0.4f + i));
  }
}

static void sceneAuto(float t, Rgb* out, float& tau) {
  if (!ctx) { sceneDigital(t, out, tau); return; }
  const LumoState& s = *ctx;
  ClockNow c = clockNow();
  PhaseStyle ph = clockPhase(c.minuteOfDay);
  Rgb pc = rgb8(ph.r, ph.g, ph.b);
  float level = (0.40f + 0.60f * ph.level) * (sleeping ? 0.30f : 1.0f);

  switch (ctxScreen) {
    case SCREEN_CLOCK:
      switch (s.clock_style) {
        case CLOCK_MINIMAL:    sceneMinimal(t, out, tau, pc, level); break;
        case CLOCK_ANALOG:     sceneAnalog(c, out, tau, pc, level); break;
        case CLOCK_MONOLITH:   sceneMonolith(c, out, tau, level); break;
        case CLOCK_STACKED:    sceneStacked(t, c, out, tau, level); break;
        case CLOCK_NIGHTSTAND: sceneNightstand(t, c, out, tau, level); break;
        case CLOCK_DIAL:       sceneDial(c, out, tau, level); break;
        default:               sceneDigital(t, out, tau); break;
      }
      break;
    case SCREEN_SPOTIFY:    sceneMusic(t, out, tau, s.sp_playing); break;
    case SCREEN_SYSTEM:     sceneSystem(t, out, tau, s); break;
    case SCREEN_TASKS:      sceneTasks(t, out, tau, s); break;
    case SCREEN_CONNECTING: sceneConnecting(t, out, tau, s); break;
    case SCREEN_MEMORY:     sceneMemory(t, out, tau); break;
    case SCREEN_CARD:
      tau = 0.2f;
      for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb8(0, 229, 255), 0.25f);
      break;
    default:                sceneDigital(t, out, tau); break;
  }
  if (sleeping && ctxScreen != SCREEN_CLOCK) for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(out[i], 0.30f);

  // A new screen or face: one soft white sweep round the ring.
  float since = (millis() - ctxSince) / 1000.0f;
  if (since < 0.7f) {
    float env = sinf(3.14159f * since / 0.7f);
    float pos = since / 0.7f * NUMPIXELS;
    for (int i = 0; i < NUMPIXELS; i++)
      out[i] = addc(out[i], scalec(rgb(1, 1, 1), 0.45f * env * cometAt(pos, i, 1.4f) * (sleeping ? 0.3f : 1.0f)));
    if (tau > 0.06f) tau = 0.06f;
  }
}

static void sceneWarm(float t, Rgb* out, float& tau) {
  tau = 0.25f;
  for (int i = 0; i < NUMPIXELS; i++) {
    float flick = 0.93f + 0.04f * sinf(t * 1.3f + i * 2.1f) + 0.03f * sinf(t * 2.9f + i * 0.7f);
    out[i] = scalec(rgb(1.0f, 0.55f, 0.16f), flick);
  }
}

static void sceneColor(float t, Rgb* out, float& tau) {
  tau = 0.25f;
  Rgb c = hsv(baseHue / 360.0f, 1.0f, 1.0f);
  for (int i = 0; i < NUMPIXELS; i++) out[i] = c;
}

static void sceneBreathe(float t, Rgb* out, float& tau) {
  tau = 0.05f;
  float b = 0.5f - 0.5f * cosf(t * TWO_PI_F / 5.0f);   // 5 s inhale/exhale
  b = 0.10f + 0.90f * b * b * (3.0f - 2.0f * b);
  Rgb c = scalec(hsv(baseHue / 360.0f, 1.0f, 1.0f), b);
  for (int i = 0; i < NUMPIXELS; i++) out[i] = c;
}

static void sceneAurora(float t, Rgb* out, float& tau) {
  tau = 0.12f;
  const Rgb teal = rgb(0.0f, 0.95f, 0.65f), violet = rgb(0.55f, 0.20f, 1.0f), blue = rgb(0.10f, 0.45f, 1.0f);
  for (int i = 0; i < NUMPIXELS; i++) {
    float u = 0.5f + 0.5f * sinf(t * 0.35f + i * 0.95f);
    float v = 0.5f + 0.5f * sinf(t * 0.23f - i * 1.30f + 1.7f);
    float w = 0.55f + 0.45f * sinf(t * 0.50f + i * 0.70f + 0.6f);
    Rgb c = mixc(mixc(teal, violet, u), blue, v * 0.6f);
    out[i] = scalec(c, 0.45f + 0.55f * w);
  }
}

static void sceneComet(float t, Rgb* out, float& tau) {
  tau = 0.04f;
  float pos = fmodf(t / 2.4f, 1.0f) * NUMPIXELS;
  Rgb c = hsv(baseHue / 360.0f, 0.85f, 1.0f);
  for (int i = 0; i < NUMPIXELS; i++) {
    float k = cometAt(pos, i, 0.85f);
    out[i] = scalec(c, 0.05f + 0.95f * k);
  }
}

static void sceneAlarm(float t, Rgb* out, float& tau) {
  tau = 0.04f;
  float p = 0.5f + 0.5f * sinf(t * TWO_PI_F * 1.6f);
  Rgb c = mixc(rgb(1.0f, 0.10f, 0.05f), rgb(1.0f, 0.55f, 0.10f), p * 0.5f);
  for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(c, 0.25f + 0.75f * p);
}

static void sceneVoice(float t, Rgb* out, float& tau) {
  tau = 0.06f;
  if (voiceFx == VFX_LISTEN) {
    float b = 0.5f - 0.5f * cosf(t * TWO_PI_F / 1.4f);
    for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb(0.1f, 1.0f, 0.4f), 0.30f + 0.70f * b);
  } else if (voiceFx == VFX_THINK) {
    float pos = fmodf(t / 0.9f, 1.0f) * NUMPIXELS;
    for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb(1.0f, 0.70f, 0.0f), 0.06f + 0.94f * cometAt(pos, i, 0.9f));
  } else {
    float wob = 0.85f + 0.15f * sinf(t * 9.0f);
    float lvl = (0.30f + 0.70f * voiceLevel) * wob;
    for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(rgb(0.2f, 0.55f, 1.0f), lvl);
  }
}

void neoTick() {
  unsigned long ms = millis();
  if (ms - lastFrameMs < 16) return;
  float dt = (ms - lastFrameMs) / 1000.0f;
  if (dt > 0.1f) dt = 0.1f;
  lastFrameMs = ms;
  float t = ms / 1000.0f;

  Rgb target[NUMPIXELS];
  float tau = 0.2f;
  float master = (baseBri / 100.0f) * 0.60f;   // linear-light ceiling, 100% ~= 60% duty

  if (alarmOn) {
    sceneAlarm(t, target, tau);
    master = 0.55f;
  } else if (voiceFx != VFX_NONE) {
    sceneVoice(t, target, tau);
  } else {
    switch (baseMode) {
      case NEO_OFF:
        for (int i = 0; i < NUMPIXELS; i++) target[i] = rgb(0, 0, 0);
        tau = 0.3f;
        break;
      case NEO_WARM:    sceneWarm(t, target, tau);    break;
      case NEO_COLOR:   sceneColor(t, target, tau);   break;
      case NEO_BREATHE: sceneBreathe(t, target, tau); break;
      case NEO_AURORA:  sceneAurora(t, target, tau);  break;
      case NEO_COMET:   sceneComet(t, target, tau);   break;
      case NEO_ALARM:   sceneAlarm(t, target, tau);   break;
      case NEO_AUTO:
      default:          sceneAuto(t, target, tau);    break;
    }
  }

  // Notification ping rides on top of whatever is playing.
  if (pingActive) {
    float el = (ms - pingStart) / 1000.0f;
    if (el > 1.2f) {
      pingActive = false;
    } else {
      float e = sinf(TWO_PI_F * el / 0.6f);
      if (e > 0) for (int i = 0; i < NUMPIXELS; i++) target[i] = mixc(target[i], pingColor, e * 0.9f);
    }
  }

  float a = 1.0f - expf(-dt / tau);
  bool changed = forceShow;
  for (int i = 0; i < NUMPIXELS; i++) {
    float* cur = &frameCur[i].r;
    const float* tg = &target[i].r;
    float* er = ditherErr[i];
    for (int c = 0; c < 3; c++) {
      cur[c] += (tg[c] - cur[c]) * a;
      float v = clamp01(cur[c]);
      float f = 255.0f * master * powf(v, 2.2f) + er[c];
      int q = (int)f;
      if (q > 255) q = 255;
      er[c] = f - q;
      if (er[c] > 1.0f) er[c] = 1.0f;
      if (lastOut[i][c] != (uint8_t)q) { lastOut[i][c] = (uint8_t)q; changed = true; }
    }
    pixels.setPixelColor(i, lastOut[i][0], lastOut[i][1], lastOut[i][2]);
  }

  if (changed) {
    pixels.show();
    forceShow = false;
  }
}

// =====================================================================
//  Button ladder
// =====================================================================
// OK reports on release, so a long hold can be told apart: held for
// HOLD_OK_MS it is BTN_HOLD_OK (once), shorter it is BTN_OK.
Button readButton() {
  static Button lastStable = BTN_NONE;
  static unsigned long pressStart = 0;
  static unsigned long lastRepeat = 0;
  static bool holdSent = false;

  const unsigned long HOLD_START_MS  = 350;
  const unsigned long HOLD_REPEAT_MS = 120;

  int raw = analogRead(BUTTON_PIN);
  float v = (raw / 4095.0f) * 3.3f;

  Button cur = BTN_NONE;
  if (fabs(v - V_OK) <= V_TOL)        cur = BTN_OK;
  else if (fabs(v - V_UP) <= V_TOL)   cur = BTN_UP;
  else if (fabs(v - V_DOWN) <= V_TOL) cur = BTN_DOWN;
  else if (fabs(v - V_LEFT) <= V_TOL) cur = BTN_LEFT;
  else if (fabs(v - V_RIGHT) <= V_TOL)cur = BTN_RIGHT;

  if (cur != BTN_NONE && lastStable == BTN_NONE) {
    lastStable = cur;
    pressStart = millis();
    lastRepeat = millis();
    holdSent = false;
    return cur == BTN_OK ? BTN_NONE : cur;
  }

  if (cur == BTN_NONE && lastStable != BTN_NONE) {
    Button released = lastStable;
    lastStable = BTN_NONE;
    return (released == BTN_OK && !holdSent) ? BTN_OK : BTN_NONE;
  }

  if (cur == BTN_OK && lastStable == BTN_OK && !holdSent && millis() - pressStart >= HOLD_OK_MS) {
    holdSent = true;
    return BTN_HOLD_OK;
  }

  if ((cur == BTN_UP || cur == BTN_DOWN) && cur == lastStable) {
    unsigned long now = millis();
    if (now - pressStart > HOLD_START_MS && now - lastRepeat > HOLD_REPEAT_MS) {
      lastRepeat = now;
      return cur;
    }
  }

  return BTN_NONE;
}
