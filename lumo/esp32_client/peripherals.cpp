#include <Arduino.h>
#include "peripherals.h"
#include "anim.h"
#include "clockkeeper.h"
#include "display.h"
#include <math.h>

Adafruit_NeoPixel pixels(NUMPIXELS, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);

// =====================================================================
//  Haptics
//
//  One pin (BUZZER_PIN, active low through a BC557) feeds the buzzer and the
//  vibration motor in parallel, so every effect is a choice of what the two
//  of them hear (see HAPTICS in config.h):
//
//   - Silent effects (every button press, notifications, reminders, the Pi's
//     patterns) hold the motor fully on, then fully off (HAPTIC_MOTOR_DC):
//     on this board, with no flyback diode, PWM starves the motor and its
//     off-times leak brush noise into the buzzer (see config.h). A steady
//     pin is silent, so strength sets how long each knock runs. Each effect
//     is a short list of frames; with HAPTIC_MOTOR_DC 0 (a diode fitted)
//     the same frames glide smoothly in strength on a 50 kHz carrier.
//   - The alarm switches the carrier to ALARM_TONE_HZ, the buzzer's own
//     pitch, and is the only thing LUMO ever lets you hear. Nothing else
//     plays over a ringing alarm.
//
//  The envelope runs on an esp_timer, not in loop(), so a slow screen redraw
//  can't stretch a glide into a step (which you would hear). The timer only
//  runs while an effect plays. Strength (0-100, from Sage) scales every
//  silent effect; 0 turns them off. At night notifications are softer.
// =====================================================================

#include <esp_timer.h>

struct HapFrame { uint8_t level; uint16_t ms; };   // glide to `level` (0-255) over `ms`
static bool nightTime();                            // the sleep schedule, set from Sage

#define EDGE  HAPTIC_EDGE_MS
#define FALL  HAPTIC_FALL_MS
// A knock: rise, hold, let go.
#define KNOCK(peak, hold)  {peak, EDGE}, {peak, hold}, {0, FALL}
#define REST(ms)           {0, ms}

// A tick opens at full power for a few ms to spin the motor up (an ERM is
// slow to start), eases down to its peak, and lets go.
static const HapFrame FX_TICK[]     = { {255, EDGE}, {255, HFX_KICK_MS}, {HFX_TICK_PEAK, EDGE},
                                        {HFX_TICK_PEAK, HFX_TICK_HOLD_MS}, {0, FALL} };
static const HapFrame FX_TAP[]      = { {255, EDGE}, {HFX_KNOCK_PEAK, EDGE}, {HFX_KNOCK_PEAK, HFX_KNOCK_HOLD_MS}, {0, FALL} };
static const HapFrame FX_HOLD[]     = { KNOCK(HFX_HOLD_PEAK * 2 / 3, 16), REST(70),
                                        {255, EDGE}, {HFX_HOLD_PEAK, EDGE}, {HFX_HOLD_PEAK, 30}, {0, FALL} };
// Notifications and reminders knock exactly twice; a reminder harder and longer.
static const HapFrame FX_NOTIFY[]   = { KNOCK(HFX_KNOCK_PEAK, HFX_KNOCK_HOLD_MS), REST(HFX_KNOCK_GAP_MS),
                                        KNOCK(HFX_KNOCK_PEAK, HFX_KNOCK_HOLD_MS) };
static const HapFrame FX_REMINDER[] = { KNOCK(HFX_REMIND_PEAK, HFX_REMIND_HOLD_MS), REST(HFX_REMIND_GAP_MS),
                                        KNOCK(HFX_REMIND_PEAK, HFX_REMIND_HOLD_MS) };
// Soft, then firm: something went through.
static const HapFrame FX_SUCCESS[]  = { KNOCK(HFX_KNOCK_PEAK / 2, 14), REST(60), KNOCK(HFX_KNOCK_PEAK, 24) };
// Three short knocks: something didn't.
static const HapFrame FX_WARNING[]  = { KNOCK(HFX_KNOCK_PEAK, 18), REST(70), KNOCK(HFX_KNOCK_PEAK, 18), REST(70),
                                        KNOCK(HFX_KNOCK_PEAK, 18) };
static const HapFrame FX_PULSE[]    = { {HFX_PULSE_PEAK, HFX_PULSE_MS * 2 / 5}, {0, HFX_PULSE_MS * 3 / 5} };
static const HapFrame FX_RAMP_UP[]  = { {HFX_RAMP_PEAK, HFX_RAMP_MS}, {0, FALL} };
static const HapFrame FX_RAMP_DOWN[]= { {HFX_RAMP_PEAK, EDGE * 2}, {0, HFX_RAMP_MS} };
static const HapFrame FX_HEARTBEAT[]= { KNOCK(HFX_BEAT_PEAK, 26), REST(90), KNOCK(HFX_BEAT_PEAK * 3 / 4, 20) };
// "beep-beep ... beep-beep" on the tone, the rhythm the light beats to.
// Short glides keep the beeps round instead of clicky.
static const HapFrame FX_ALARM[]    = { {255, 3}, {255, 124}, {0, 3}, REST(127), {255, 3}, {255, 124}, {0, 3}, REST(913) };
// The other alarm sounds picked in Sage: four quick beeps, one long rising
// beep, and three chirps (also a finished timer).
#define BEEP(ms)  {255, 3}, {255, (ms) - 6}, {0, 3}
static const HapFrame FX_CLASSIC[]  = { BEEP(90), REST(90), BEEP(90), REST(90), BEEP(90), REST(90), BEEP(90), REST(680) };
static const HapFrame FX_RISING[]   = { BEEP(420), REST(1080) };
static const HapFrame FX_CHIRP[]    = { BEEP(35), REST(55), BEEP(35), REST(55), BEEP(35), REST(900) };
#undef BEEP

#define FX(p) { p, (uint8_t)(sizeof(p) / sizeof((p)[0])) }
static const struct { const HapFrame* f; uint8_t n; } FX_LIB[HAP_COUNT] = {
  FX(FX_TICK), FX(FX_HOLD), FX(FX_TAP), FX(FX_NOTIFY), FX(FX_REMINDER), FX(FX_SUCCESS),
  FX(FX_WARNING), FX(FX_PULSE), FX(FX_RAMP_UP), FX(FX_RAMP_DOWN), FX(FX_HEARTBEAT), FX(FX_ALARM),
};

static const struct { const char* name; Haptic h; } FX_NAMES[] = {
  {"tick", HAP_TICK}, {"hold", HAP_HOLD}, {"tap", HAP_TAP}, {"notify", HAP_NOTIFY},
  {"double", HAP_NOTIFY}, {"reminder", HAP_REMINDER}, {"success", HAP_SUCCESS},
  {"warning", HAP_WARNING}, {"error", HAP_WARNING}, {"pulse", HAP_PULSE},
  {"ramp_up", HAP_RAMP_UP}, {"ramp_down", HAP_RAMP_DOWN}, {"heartbeat", HAP_HEARTBEAT},
};

// --- What loop() asks for (guarded by hapMux) ---
static portMUX_TYPE hapMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool hapAsk = false;
static const HapFrame* askFrames = nullptr;
static uint8_t  askCount = 0;
static bool     askLoop = false, askTone = false;
static float    askScale = 1;
static uint32_t askBuildMs = 0, askStopMs = 0;
static HapFrame pulseOne[3];                 // the Pi's plain HAPTIC {ms}

// --- The engine (only the timer touches these) ---
static esp_timer_handle_t hapTimer = nullptr;
static uint32_t hapPeriod = 0;               // the timer's period while it runs
static uint32_t hapMaxDuty = 255;            // (1 << resolution) - 1
static uint32_t hapFreq = HAPTIC_FREQ;       // knock carrier, changeable from the serial monitor
static float    hapOnDuty = HAPTIC_ON_DUTY / 100.0f;

// The most duty bits LEDC can give at `hz` from its 80 MHz clock.
static uint8_t hapResFor(uint32_t hz) {
  uint8_t r = HAPTIC_RES;
  while (r > 4 && (80000000UL >> r) < hz) r--;
  return r;
}

static void hapSetCarrier(uint32_t hz) {
  uint8_t res = hapResFor(hz);
  ledcChangeFrequency(BUZZER_PIN, hz, res);
  hapMaxDuty = (1u << res) - 1;
}
static const HapFrame* hf = nullptr;
static uint8_t  hn = 0, hi = 0;
static bool     hLoop = false, hTone = false, hOnTone = false;
static float    hScale = 1, hFrom = 0;      // on a tone, hScale is the loudest duty
static uint32_t hBuildMs = 0, hStopMs = 0;   // a tone's build-up, and a preview's length (0: until off)
static int64_t  hSegAt = 0, hStartAt = 0;
static int32_t  hDuty = -1;                  // the on-time last written, -1 = unknown

static uint8_t  hapStrength = HAPTIC_STRENGTH;
static bool     hapAlarm = false;            // loop()'s view: an alarm is ringing

static void hapWrite(uint32_t on) {          // on-time, 0..hapMaxDuty
  if ((int32_t)on == hDuty) return;
  hDuty = on;
  ledcWrite(BUZZER_PIN, hapMaxDuty - on);    // active low
}

static void hapCarrier(bool tone) {
  if (tone == hOnTone) return;
  hOnTone = tone;
  hDuty = -1;
  hapSetCarrier(tone ? ALARM_TONE_HZ : hapFreq);
}

// How long a frame lasts. With on/off drive, strength (hScale) stretches the
// parts where the motor runs; rests keep their length.
static int64_t hapSegUs(const HapFrame& f) {
  int64_t us = (int64_t)f.ms * 1000;
  if (HAPTIC_MOTOR_DC && !hTone && f.level > 0) us = (int64_t)(us * hScale);
  return us;
}

static void hapTick(void*) {
  int64_t now = esp_timer_get_time();
  if (hapAsk) {
    portENTER_CRITICAL(&hapMux);
    hf = askFrames; hn = askCount; hLoop = askLoop; hTone = askTone; hScale = askScale;
    hBuildMs = askBuildMs; hStopMs = askStopMs;
    hapAsk = false;
    portEXIT_CRITICAL(&hapMux);
    hi = 0;
    hSegAt = hStartAt = now;
    // Glide on from wherever the motor is now, so a new effect never jumps.
    if (HAPTIC_MOTOR_DC) hFrom = (!hOnTone && hDuty > 0) ? 255 : 0;
    else hFrom = (hOnTone || hDuty <= 0) ? 0 : 255.0f * hDuty / hapMaxDuty / (hScale > 0 ? hScale : 1);
    if (hFrom > 255) hFrom = 255;
    if (hOnTone != hTone) { hapWrite(0); hapCarrier(hTone); hFrom = 0; }
  }
  if (hf && hStopMs && now - hStartAt >= (int64_t)hStopMs * 1000) hf = nullptr;   // a preview is over
  if (!hf) {
    hapCarrier(false);
    hapWrite(0);
    esp_timer_stop(hapTimer);                // idle: no ticks until the next effect
    return;
  }

  // Walk past every frame that has finished.
  while (now - hSegAt >= hapSegUs(hf[hi])) {
    hSegAt += hapSegUs(hf[hi]);
    hFrom = hf[hi].level;
    if (++hi >= hn) {
      if (!hLoop) { hf = nullptr; hapWrite(0); return; }   // the next tick goes idle
      hi = 0;
    }
  }
  const HapFrame& f = hf[hi];
  int64_t len = hapSegUs(f);
  float t = len ? (float)(now - hSegAt) / len : 1;
  t = t * t * (3 - 2 * t);                   // S-curve: no corners to click
  float level = (hFrom + (f.level - hFrom) * t) / 255.0f;

  float on;
  if (hTone) {
    // The alarm starts quieter and builds to its volume.
    float k = hBuildMs ? (float)(now - hStartAt) / (hBuildMs * 1000.0f) : 1;
    if (k > 1) k = 1;
    float vol = ALARM_START_PCT / 100.0f + (1 - ALARM_START_PCT / 100.0f) * k;
    on = level * vol * hScale;
  } else if (HAPTIC_MOTOR_DC) {
    on = level >= 0.5f ? hapOnDuty : 0;      // a knock is on at one fixed duty: see config.h
  } else {
    on = level * hScale;
  }
  hapWrite((uint32_t)(on * hapMaxDuty + 0.5f));
}

// What strength `pct` does (0 = off): with on/off drive, how much longer or
// shorter each knock runs; with PWM, the share of full power.
static float hapTop(uint8_t pct) {
  if (pct == 0) return 0;
  if (pct > 100) pct = 100;
  if (HAPTIC_MOTOR_DC) return (HAPTIC_MIN_LEN_PCT + (HAPTIC_MAX_LEN_PCT - HAPTIC_MIN_LEN_PCT) * (pct - 1) / 99.0f) / 100.0f;
  return (HAPTIC_MIN_DUTY + (HAPTIC_MAX_DUTY - HAPTIC_MIN_DUTY) * (pct - 1) / 99.0f) / 100.0f;
}

static void hapAskFor(const HapFrame* f, uint8_t n, bool loop, bool tone, float scale,
                      uint32_t buildMs = 0, uint32_t stopMs = 0) {
  portENTER_CRITICAL(&hapMux);
  askFrames = f; askCount = n; askLoop = loop; askTone = tone; askScale = scale;
  askBuildMs = buildMs; askStopMs = stopMs;
  hapAsk = true;
  portEXIT_CRITICAL(&hapMux);
  // The timer task outranks loop() on the C3's one core, so it can't be
  // stopping itself halfway through this; an already running timer just
  // picks the request up on its next tick. The alarm is audible anyway, so
  // it, like on/off drive, moves 1000 times a second; PWM glides 10000.
  if (!hapTimer) return;
  uint32_t period = (tone || HAPTIC_MOTOR_DC) ? 1000 : HAPTIC_TICK_US;
  if (esp_timer_is_active(hapTimer)) {
    if (period == hapPeriod) return;
    esp_timer_stop(hapTimer);
  }
  hapPeriod = period;
  esp_err_t err = esp_timer_start_periodic(hapTimer, period);
  if (err != ESP_OK) Serial.printf("[HAPTIC] timer didn't start (error %d)\n", (int)err);
}

void hapticInit(uint8_t strength) {
  hapStrength = strength > 100 ? 100 : strength;
  uint8_t res = hapResFor(hapFreq);
  if (!ledcAttach(BUZZER_PIN, hapFreq, res)) {
    res = 8;
    ledcAttach(BUZZER_PIN, hapFreq, res);
  }
  hapMaxDuty = (1u << res) - 1;
  ledcWrite(BUZZER_PIN, hapMaxDuty);         // off (active low)
  hDuty = 0;
  esp_timer_create_args_t args = {};
  args.callback = &hapTick;
  args.name = "haptics";
  esp_err_t err = esp_timer_create(&args, &hapTimer);
  if (err != ESP_OK) hapTimer = nullptr;     // hapticUpdate() drives it instead
  Serial.printf("[HAPTIC] pin %d, %u Hz, %u-bit, on-duty %d%%, timer %s, strength %u%%\n", BUZZER_PIN,
                (unsigned)hapFreq, res, (int)(hapOnDuty * 100 + 0.5f), hapTimer ? "ok" : "FAILED (loop fallback)", hapStrength);
}

void hapticPlay(Haptic h) {
  if (h >= HAP_COUNT) return;
  if (hapAlarm && h != HAP_ALARM) return;   // nothing talks over a ringing alarm
  if (h == HAP_ALARM) { hapticRing(TONE_PULSE, 100); return; }
  float scale = hapTop(hapStrength);
  if (scale <= 0) { Serial.println("[HAPTIC] off (strength 0 in Sage)"); return; }
  bool press = (h == HAP_TICK || h == HAP_HOLD);
  if (!press && nightTime()) scale *= HAPTIC_NIGHT_PCT / 100.0f;
  Serial.printf(HAPTIC_MOTOR_DC ? "[HAPTIC] effect %d, on/off, length %d%%\n" : "[HAPTIC] effect %d at %d%% duty\n",
                (int)h, (int)(scale * 100));
  hapAskFor(FX_LIB[h].f, FX_LIB[h].n, false, false, scale);
}

bool hapticPlayNamed(const char* name) {
  for (const auto& e : FX_NAMES) {
    if (!strcmp(name, e.name)) { hapticPlay(e.h); return true; }
  }
  return false;
}

// A single knock of `ms`, for the Pi's HAPTIC command without a pattern.
void hapticPulse(uint16_t ms) {
  if (hapAlarm) return;
  float scale = hapTop(hapStrength);
  if (scale <= 0) return;
  if (ms < EDGE) ms = EDGE;
  pulseOne[0] = {HFX_KNOCK_PEAK, EDGE};
  pulseOne[1] = {HFX_KNOCK_PEAK, ms};
  pulseOne[2] = {0, FALL};
  hapAskFor(pulseOne, 3, false, false, scale);
}

// Volume 0..100 to the tone's duty: a square wave is loudest at half duty
// (ALARM_TONE_DUTY) and gets about 20 dB quieter for every tenfold drop below
// that, so 100 is full, 50 a tenth of that and 0 silent.
static float toneDuty(uint8_t volume) {
  if (volume == 0) return 0;
  if (volume > 100) volume = 100;
  return ALARM_TONE_DUTY / 100.0f * powf(10.0f, (volume - 100) / 50.0f);
}

static const HapFrame* toneFrames(AlarmTone tone, uint8_t& n, uint32_t& buildMs) {
  // How long each sound takes to build from ALARM_START_PCT to its volume.
  switch (tone) {
    case TONE_CLASSIC: n = sizeof(FX_CLASSIC) / sizeof(HapFrame); buildMs = 8000;  return FX_CLASSIC;
    case TONE_RISING:  n = sizeof(FX_RISING)  / sizeof(HapFrame); buildMs = 60000; return FX_RISING;
    case TONE_CHIRP:   n = sizeof(FX_CHIRP)   / sizeof(HapFrame); buildMs = 6000;  return FX_CHIRP;
    default:           n = sizeof(FX_ALARM)   / sizeof(HapFrame); buildMs = ALARM_BUILD_MS; return FX_ALARM;
  }
}

void hapticRing(AlarmTone tone, uint8_t volume) {
  uint8_t n;
  uint32_t buildMs;
  const HapFrame* f = toneFrames(tone, n, buildMs);
  hapAlarm = true;
  hapAskFor(f, n, true, true, toneDuty(volume), buildMs);
}

// A few seconds of a sound at its chosen volume, to pick one in Sage. A
// button press cuts it short; a ringing alarm isn't interrupted.
void hapticPreview(AlarmTone tone, uint8_t volume, uint16_t seconds) {
  if (hapAlarm) return;
  uint8_t n;
  uint32_t buildMs;
  const HapFrame* f = toneFrames(tone, n, buildMs);
  hapAskFor(f, n, true, true, toneDuty(volume), 0, seconds * 1000UL);
}

void hapticSetStrength(uint8_t pct) {
  hapStrength = pct > 100 ? 100 : pct;
}

uint8_t hapticStrength() { return hapStrength; }

void hapticOff() {
  hapAlarm = false;
  hapAskFor(nullptr, 0, false, false, 1);
}

// Only needed if the timer couldn't be made: then loop() drives the engine
// (coarser, but still glides).
void hapticUpdate() {
  if (!hapTimer) hapTick(nullptr);

  // Tuning from the serial monitor (see HAPTICS in config.h).
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line == "buzz") { hapticSelfTest(); return; }
  if (line == "tick")  { hapticPlay(HAP_TICK); return; }
  if (line == "knock") { hapticPlay(HAP_NOTIFY); return; }
  if (line.startsWith("hz ")) {
    long hz = line.substring(3).toInt();
    if (hz < 1000 || hz > 300000 || hapAlarm) { Serial.println("[HAPTIC] hz must be 1000-300000 (and not while the alarm rings)"); return; }
    hapFreq = hz;
    hapticOff();
    if (!hOnTone) { hapSetCarrier(hapFreq); hDuty = -1; hapWrite(0); }
  } else if (line.startsWith("duty ")) {
    long d = line.substring(5).toInt();
    if (d < 1 || d > 100) { Serial.println("[HAPTIC] duty must be 1-100"); return; }
    hapOnDuty = d / 100.0f;
  } else if (line != "haptic") {
    return;
  }
  Serial.printf("[HAPTIC] carrier %u Hz (%u-bit), on-duty %d%%. Type tick or knock to feel it.\n",
                (unsigned)hapFreq, (unsigned)hapResFor(hapFreq), (int)(hapOnDuty * 100 + 0.5f));
}

// Serial "buzz" plays a plain full-power 300 ms buzz with no shaping, to tell
// a wiring problem from a tuning one.
// It bypasses the engine and its timer: the pin is held fully on (low) by
// hand, exactly as 2.6.4 did at full strength.
void hapticSelfTest() {
  Serial.printf("[HAPTIC] self test: pin %d held on for 300 ms, no engine\n", BUZZER_PIN);
  ledcWrite(BUZZER_PIN, 0);
  delay(300);
  ledcWrite(BUZZER_PIN, hapMaxDuty);
  hDuty = 0;
  Serial.println("[HAPTIC] self test done");
}

#undef EDGE
#undef FALL

// =====================================================================
//  NeoPixel scene engine
//
//  Every scene is a pure function of time that fills a float RGB frame in
//  *perceptual* space (0..1). A final stage smooths the frame, applies gamma,
//  scales by the master brightness and rounds to 8 bits with hysteresis, so a
//  still light never shimmers.
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
static uint8_t  baseBri    = 100;
static uint16_t baseHue    = 0;
static bool     onClock    = false;
static bool     sleeping   = false;
static bool nightTime() { return sleeping; }
static bool     alarmOn    = false;
static VoiceFx  voiceFx    = VFX_NONE;
static float    voiceLevel = 0.0f;
static unsigned long alarmSince;
static unsigned long pingStart = 0;
static Rgb      pingColor  = {1, 1, 1};
static bool     pingActive = false;

static Rgb      frameCur[NUMPIXELS];            // smoothed, perceptual
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
static ScreenMode prevScreen;
static ClockStyle prevStyle;
static ClockStyle ctxStyle = CLOCK_DIGITAL;
void neoSetContext(ScreenMode screen, const LumoState& s) {
  if (screen != ctxScreen || s.clock_style != ctxStyle) {
    prevScreen = ctxScreen;
    prevStyle  = ctxStyle;
    ctxSince   = millis();
  }
  ctxScreen = screen;
  ctxStyle  = s.clock_style;
  ctx = &s;
}
void neoSetSleep(bool s)        { sleeping = s; }
void neoSetAlarm(bool r) {
  if (r && !alarmOn) alarmSince = millis();
  alarmOn = r;
}
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

// ---- AUTO: one light, one motion language ---------------------------
//
// Every face and screen is described the same way: a colour, how bright it
// glows, whether it breathes, and at most one moving mark. They all share
// the same few numbers below, so the ring feels like one object whatever is
// on screen:
//  - a glow in a single colour, following the day's brightness;
//  - a slow breath (7 s, about a tenth deep), never a flicker;
//  - one soft mark, the same width everywhere, that glides between LEDs;
//  - events (a new minute, a notification, a new song) are one swell:
//    a quick rise and a long, gentle fall;
//  - changing face or screen cross-fades over 0.8 s.

static const float GLOW        = 0.85f;   // the resting glow (perceptual): bright, with room for the mark
static const float BREATH_S    = 7.0f;
static const float BREATH      = 0.10f;
static const float MARK_W      = 1.5f;    // LEDs either side the mark reaches
static const float MARK_GAIN   = 0.55f;
static const float SWELL_S     = 1.2f;
static const float SWELL_GAIN  = 0.30f;
static const float FADE_S      = 0.8f;

enum MarkKind { MARK_NONE, MARK_SECONDS, MARK_SPIN, MARK_COUNT };

struct Look {
  Rgb      color;
  float    level;      // 0..1, the day's brightness and the face's own
  bool     breathe;
  MarkKind mark;
  Rgb      markColor;
  int      count;      // MARK_COUNT: how many LEDs are lit
  bool     minuteSwell;
};

// A soft blob of light centred at `pos` (in pixels, wrapping round the ring),
// so the mark glides between LEDs instead of hopping.
static float blobAt(float pos, int i, float width) {
  float d = fabsf(pos - i);
  d = fmodf(d, (float)NUMPIXELS);
  if (d > NUMPIXELS / 2.0f) d = NUMPIXELS - d;
  return d >= width ? 0.0f : 0.5f + 0.5f * cosf(3.14159f * d / width);
}

static inline Rgb rgb8(uint8_t r, uint8_t g, uint8_t b) { return rgb(r / 255.0f, g / 255.0f, b / 255.0f); }
static inline float breathe(float t, float period) { return 0.5f - 0.5f * cosf(t * TWO_PI_F / period); }

// The one event shape: a 150 ms rise, then a long fall. u is seconds since.
static float swellAt(float u, float len) {
  if (u < 0 || u >= len) return 0;
  float rise = clamp01(u / 0.15f);
  rise = rise * rise * (3 - 2 * rise);
  float fall = 1 - u / len;
  return rise * fall * fall;
}

static Look lookFor(ScreenMode screen, const LumoState& s, const ClockNow& c, Rgb dayColor, float day) {
  Look k;
  k.color = dayColor; k.level = day; k.breathe = true;
  k.mark = MARK_NONE; k.markColor = rgb(1, 1, 1); k.count = 0; k.minuteSwell = false;
  switch (screen) {    // the clock faces have their own lights: renderFace

    case SCREEN_SPOTIFY: {
      uint8_t r, g, b;
      displayArtTint(r, g, b);
      k.color = rgb8(r, g, b);
      k.breathe = false;                          // the song's pulse is its motion (sceneAuto)
      if (!s.sp_playing) k.level = day * 0.5f;
      break;
    }
    case SCREEN_SYSTEM: {
      float heat = clamp01((s.cpu_temp - 45.0f) / 30.0f);
      k.color = heat < 0.5f ? mixc(rgb8(60, 220, 190), rgb8(255, 176, 50), heat * 2)
                            : mixc(rgb8(255, 176, 50), rgb8(255, 60, 40), heat * 2 - 1);
      break;
    }
    case SCREEN_TASKS:
      if (s.task_count == 0) {
        k.color = rgb8(70, 225, 140);             // all done: a calm green
      } else {
        k.color = rgb8(80, 200, 255);
        k.mark = MARK_COUNT;
        k.count = s.task_count < NUMPIXELS ? s.task_count : NUMPIXELS;
      }
      break;
    case SCREEN_CONNECTING:
      if (s.pair_refused) { k.color = rgb8(255, 70, 50); break; }
      k.color = rgb8(80, 200, 255);
      k.level = day * 0.5f;
      k.mark = MARK_SPIN;
      k.markColor = rgb8(150, 225, 255);
      break;
    case SCREEN_MEMORY:
      k.color = rgb8(255, 170, 120);
      break;
    case SCREEN_CARD:
      k.color = rgb8(80, 200, 255);
      break;
    default:
      break;
  }
  return k;
}

static void renderLook(const Look& k, float t, const ClockNow& c, Rgb* out) {
  float sec = c.s + c.secFrac;
  float b = k.breathe ? 1.0f - BREATH * breathe(t, BREATH_S) : 1.0f;
  float swell = k.minuteSwell ? swellAt(sec, SWELL_S) : 0.0f;
  float glow = GLOW * k.level * b * (1 + SWELL_GAIN * swell);
  for (int i = 0; i < NUMPIXELS; i++) {
    Rgb o = scalec(k.color, glow);
    switch (k.mark) {
      case MARK_SECONDS:
        o = addc(o, scalec(k.markColor, MARK_GAIN * k.level * blobAt(sec / 60.0f * NUMPIXELS, i, MARK_W)));
        break;
      case MARK_SPIN:                              // one turn every 1.6 s, like a spinner
        o = addc(o, scalec(k.markColor, MARK_GAIN * k.level * 1.6f * cometAt(fmodf(t / 1.6f, 1.0f) * NUMPIXELS, i, 1.2f)));
        break;
      case MARK_COUNT:
        o = i < k.count ? scalec(k.color, (GLOW + 0.22f) * k.level * b) : scalec(k.color, 0.05f * k.level);
        break;
      default:
        break;
    }
    out[i] = o;
  }
}


// ---- Clock faces: each light belongs to its face ----------------------
//
// Every face opens with its own short entrance, in step with the screen's,
// then settles into one ambient motion that means something on that face.
// All of them share the glow, breath, mark width and swell above.

static inline float smooth01(float x) { x = clamp01(x); return x * x * (3 - 2 * x); }

// The ring filled to `pos` LEDs: lit behind, a soft front, faint ahead.
static float fillAt(float pos, int i, float ahead) {
  return ahead + (1 - ahead) * clamp01(pos - i);
}

static void renderFace(ClockStyle style, const LumoState& s, const ClockNow& c, float t, float since,
                       Rgb dayColor, float day, Rgb* out) {
  const float N = (float)NUMPIXELS;
  float sec  = c.s + c.secFrac;
  float b    = 1.0f - BREATH * breathe(t, BREATH_S);
  float glow = GLOW * day * b;
  float swell = swellAt(sec, SWELL_S);
  bool  secs = s.show_seconds;

  switch (style) {
    case CLOCK_MINIMAL: {
      // The hour filling up: one LED every ten minutes, the front easing on
      // as the minutes pass. It only swells on the hour. Opens from the
      // middle outwards.
      float hour = (c.m + sec / 60.0f) / 60.0f * N;
      float sw = (c.m == 0) ? swell : 0;
      for (int i = 0; i < NUMPIXELS; i++) {
        float open = smooth01((since - fabsf(i - (N - 1) / 2) * 0.12f) / 0.6f);
        out[i] = scalec(dayColor, glow * fillAt(hour, i, 0.35f) * open * (1 + SWELL_GAIN * sw));
      }
      break;
    }
    case CLOCK_MONOLITH: {
      // Gallery white rising out of the dark, then the gold dot: the seconds,
      // or the minute when seconds are hidden.
      float rise = smooth01(since / 1.2f);
      float dot  = smooth01((since - 0.9f) / 0.5f);
      float pos  = secs ? sec / 60.0f * N : (c.m + sec / 60.0f) / 60.0f * N;
      Rgb white = rgb8(236, 228, 214), gold = rgb8(222, 168, 96);
      for (int i = 0; i < NUMPIXELS; i++)
        out[i] = addc(scalec(white, glow * rise * (1 + SWELL_GAIN * swell)),
                      scalec(gold, MARK_GAIN * day * dot * blobAt(pos, i, MARK_W)));
      break;
    }
    case CLOCK_STACKED: {
      // The minute as an odometer: the ring fills an LED every ten seconds,
      // and on the minute it rolls away as the digits roll, then fills again.
      // Opens with the LEDs rolling on one after another.
      Rgb orange = rgb8(255, 140, 56);
      float fill = sec / 60.0f * N;
      float roll = clamp01(sec / 0.52f);              // the digits' roll, 520 ms
      for (int i = 0; i < NUMPIXELS; i++) {
        float v = fillAt(fill, i, 0.35f);
        if (roll < 1) {                                // the full ring rolls off, LED by LED
          float off = smooth01(roll * (N + 1) - i);
          v = 1 - (1 - 0.35f) * off;
          if (fill > i) v = fmaxf(v, fillAt(fill, i, 0.35f));
        }
        float open = smooth01((since - i * 0.09f) / 0.35f);
        out[i] = scalec(orange, glow * v * open);
      }
      break;
    }
    case CLOCK_NIGHTSTAND: {
      // An ember: low amber, a very slow breath, nothing moving. It wakes
      // gently, over two and a half seconds.
      float ember = 1.0f - 0.16f * breathe(t, 12.0f);
      float rise = smooth01(since / 2.5f);
      for (int i = 0; i < NUMPIXELS; i++)
        out[i] = scalec(rgb8(255, 112, 28), GLOW * day * 0.8f * ember * rise);
      break;
    }
    case CLOCK_DIAL: {
      // The dial's hands on the ring: a bright steel minute hand, and the
      // orange second hand sweeping round. Both spin in from twelve with the
      // hands on screen.
      float e = easeOutBack(since / 0.65f);
      float mn = (c.m + sec / 60.0f) / 60.0f * N * e;
      float sc = sec / 60.0f * N * e;
      Rgb steel = rgb8(196, 204, 214), orange = rgb8(255, 110, 45);
      float base = smooth01(since / 0.5f);
      for (int i = 0; i < NUMPIXELS; i++) {
        Rgb o = scalec(steel, glow * 0.6f * base * (1 + SWELL_GAIN * swell));
        o = addc(o, scalec(steel, 0.35f * day * blobAt(mn, i, MARK_W)));
        if (secs) o = addc(o, scalec(orange, MARK_GAIN * day * blobAt(sc, i, MARK_W)));
        out[i] = o;
      }
      break;
    }
    case CLOCK_ANALOG: {
      // The second hand on the ring, ticking like the quartz hand on screen,
      // and spinning in from twelve with it when the clock opens.
      Rgb mark = mixc(dayColor, rgb(1, 1, 1), 0.5f);
      float tick = (c.s - 1) + easeTick(c.secFrac / 0.22f);
      if (tick < 0) tick += 60;
      float pos = (secs ? tick : c.m + sec / 60.0f) / 60.0f * N * easeOutBack(since / 0.9f);
      float base = smooth01(since / 0.5f);
      for (int i = 0; i < NUMPIXELS; i++)
        out[i] = addc(scalec(dayColor, glow * base * (1 + SWELL_GAIN * swell)),
                      scalec(mark, MARK_GAIN * day * blobAt(pos, i, MARK_W)));
      break;
    }
    case CLOCK_DIGITAL:
    default: {
      // The light comes on round the ring as the digits fade in, then the
      // seconds glide round it and every minute swells once.
      Rgb mark = mixc(dayColor, rgb(1, 1, 1), 0.5f);
      float pos = (secs ? sec : c.m + sec / 60.0f) / 60.0f * N;
      float on = since / 0.6f * (N + 1);
      float dot = smooth01((since - 0.5f) / 0.4f);
      for (int i = 0; i < NUMPIXELS; i++)
        out[i] = addc(scalec(dayColor, glow * smooth01(on - i) * (1 + SWELL_GAIN * swell)),
                      scalec(mark, MARK_GAIN * day * dot * blobAt(pos, i, MARK_W)));
      break;
    }
  }
}

// One screen's light, whatever the screen: the clock faces above, the
// rest from their Look.
// The timer's ring is what's left of it: amber, emptying as it runs down
// (still while paused). The stopwatch's is a teal dot going round once a
// minute, like a second hand, standing still when it's stopped.
static void renderTool(ScreenMode screen, const LumoState& s, float t, float day, Rgb* out) {
  const float N = (float)NUMPIXELS;
  float b = 1.0f - BREATH * breathe(t, BREATH_S);
  if (screen == SCREEN_TIMER) {
    Rgb amber = rgb8(255, 160, 50);
    float left = 0;
    if (s.tm_state == TOOL_RUNNING) left = (float)(int32_t)(s.tm_end - millis());
    else if (s.tm_state == TOOL_PAUSED) left = s.tm_left_ms;
    float frac = s.tm_total_ms ? clamp01(left / s.tm_total_ms) : 0;
    bool idle = s.tm_state == TOOL_IDLE;
    for (int i = 0; i < NUMPIXELS; i++) {
      float lit = idle ? 0.35f : fillAt(frac * N, i, 0.06f);
      out[i] = scalec(amber, (GLOW + 0.15f) * day * (s.tm_state == TOOL_PAUSED ? 1.0f : b) * lit);
    }
    return;
  }
  Rgb teal = rgb8(60, 220, 190);
  uint32_t ms = s.sw_base_ms + (s.sw_running ? millis() - s.sw_mark : 0);
  float pos = fmodf(ms / 60000.0f, 1.0f) * N;
  for (int i = 0; i < NUMPIXELS; i++) {
    Rgb o = scalec(teal, GLOW * 0.6f * day * b);
    if (ms) o = addc(o, scalec(teal, MARK_GAIN * day * blobAt(pos, i, MARK_W)));
    out[i] = o;
  }
}

static void renderScreen(ScreenMode screen, const LumoState& s, const ClockNow& c, float t, float since,
                         Rgb dayColor, float day, Rgb* out) {
  if (screen == SCREEN_CLOCK) renderFace(s.clock_style, s, c, t, since, dayColor, day, out);
  else if (screen == SCREEN_TIMER || screen == SCREEN_STOPWATCH) renderTool(screen, s, t, day, out);
  else renderLook(lookFor(screen, s, c, dayColor, day), t, c, out);
}

static uint8_t       tintSeen[3] = { 0, 0, 0 };
static unsigned long tintSwellAt = 0;

static void sceneAuto(float t, Rgb* out, float& tau) {
  tau = 0.06f;
  ClockNow c = clockNow();
  PhaseStyle ph = clockPhase(c.minuteOfDay);
  Rgb dayColor = rgb8(ph.r, ph.g, ph.b);
  // Full strength all day; only softer while you sleep.
  float day = sleeping ? 0.45f : 1.0f;
  if (!ctx) {
    Look k = { dayColor, day, true, MARK_NONE, rgb(1, 1, 1), 0, false };
    renderLook(k, t, c, out);
    return;
  }
  const LumoState& s = *ctx;
  float since = (millis() - ctxSince) / 1000.0f;
  renderScreen(ctxScreen, s, c, t, since, dayColor, day, out);

  // A new face or screen cross-fades from the last one.
  if (since < FADE_S) {
    LumoState was = s;
    was.clock_style = prevStyle;
    Rgb from[NUMPIXELS];
    renderScreen(prevScreen, was, c, t, 10.0f, dayColor, day, from);
    float e = clamp01(since / FADE_S);
    e = e * e * (3 - 2 * e);
    for (int i = 0; i < NUMPIXELS; i++) out[i] = mixc(from[i], out[i], e);
  }

  // A new song (the cover's colour changed) swells once, like a new minute.
  if (ctxScreen == SCREEN_SPOTIFY) {
    uint8_t r, g, b;
    displayArtTint(r, g, b);
    if (r != tintSeen[0] || g != tintSeen[1] || b != tintSeen[2]) {
      if (tintSeen[0] | tintSeen[1] | tintSeen[2]) tintSwellAt = millis();
      tintSeen[0] = r; tintSeen[1] = g; tintSeen[2] = b;
    }
    float sw = tintSwellAt ? swellAt((millis() - tintSwellAt) / 1000.0f, SWELL_S) : 0;
    // While it plays, the cover's colour flows slowly round the ring: a
    // lighter tint drifts through the deeper one, like light through stained
    // glass. It keeps no tempo (the clock can't hear the music), so it never
    // fights the song; pausing holds it still where it is.
    static float flow = 0, lastT = 0;
    float dt = t - lastT;
    lastT = t;
    if (s.sp_playing && dt > 0 && dt < 0.5f) flow += dt / 14.0f;      // once round every 14 s
    for (int i = 0; i < NUMPIXELS; i++) {
      Rgb deep = scalec(out[i], 0.75f), light = mixc(out[i], rgb(1, 1, 1), 0.35f);
      float a = (flow + (float)i / NUMPIXELS) * TWO_PI_F;
      float w = 0.5f + 0.5f * sinf(a);                                // one light crest going round
      w = w * w * (3 - 2 * w);
      float shimmer = 0.5f + 0.5f * sinf(flow * TWO_PI_F * 2.3f - i * 1.1f);   // a second, slower layer
      Rgb c = mixc(deep, light, 0.75f * w + 0.25f * shimmer * w);
      out[i] = scalec(c, 1 + SWELL_GAIN * 1.5f * sw);
    }
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

// A sunrise that beats with the haptic heartbeat: over the first 30 s the
// light climbs from a low ember to warm white, and each "bu-bump" of the
// motor is a double swell of light at the same moment (see HAP_ALARM).
static void sceneAlarm(float t, Rgb* out, float& tau) {
  tau = 0.03f;
  float since = (millis() - alarmSince) / 1000.0f;
  float rise = clamp01(since / 30.0f);
  rise = rise * rise * (3 - 2 * rise);
  Rgb c = mixc(rgb8(255, 80, 20), rgb8(255, 214, 170), rise);
  float u = fmodf(since, 1.3f);
  float beat = swellAt(u, 0.5f) + 0.7f * swellAt(u - 0.26f, 0.6f);
  float k = (0.25f + 0.55f * rise) * (1 + 0.6f * beat);
  for (int i = 0; i < NUMPIXELS; i++) out[i] = scalec(c, k);
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
  float master = (baseBri > 100 ? 100 : baseBri) / 100.0f;   // 100% is the LEDs' full power

  if (alarmOn) {
    sceneAlarm(t, target, tau);
    master = 1.0f;
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
      float e = swellAt(el, 1.2f);                 // the same swell as every other event
      for (int i = 0; i < NUMPIXELS; i++) target[i] = mixc(target[i], pingColor, e * 0.85f);
    }
  }

  // No dithering: on six LEDs at bedside levels, toggling a channel between
  // two neighbouring values every frame reads as a shimmer of colour. Each
  // channel instead holds its value until the target has moved well past it
  // (hysteresis), so a still light is perfectly still and a fade steps once.
  float a = 1.0f - expf(-dt / tau);
  bool changed = forceShow;
  for (int i = 0; i < NUMPIXELS; i++) {
    float* cur = &frameCur[i].r;
    const float* tg = &target[i].r;
    for (int c = 0; c < 3; c++) {
      cur[c] += (tg[c] - cur[c]) * a;
      float f = 255.0f * master * powf(clamp01(cur[c]), 2.2f);
      int last = lastOut[i][c];
      if (fabsf(f - last) > 0.65f || (f < 0.35f && last != 0)) {
        int q = (int)(f + 0.5f);
        if (q > 255) q = 255;
        if (q != last) { lastOut[i][c] = (uint8_t)q; changed = true; }
      }
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
