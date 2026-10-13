#pragma once
// The alarm sounds (firmware 2.11), played by the haptic engine in
// peripherals.cpp on the one pin that feeds the buzzer and the motor.
//
// The buzzer sits behind C1 (1 nF), which passes higher pitches better, and
// rings loudest near its own pitch (ALARM_TONE_HZ), so every sound stays in
// its sweet spot, 2.3-3.5 kHz. That is one musical octave's top half, so the
// sounds use real notes from it (D major): D7 E7 F#7 G7 A7. The motor shakes
// along with every note.
//
// A sound is a list of frames: glide to `level` (0-255, a share of the
// alarm's volume) over `ms`, at pitch `hz`. A rest (hz 0) keeps the last
// pitch, so the pitch only ever changes between notes. A ringing alarm loops
// its sound; a preview from Sage plays it once (one cycle) and stops.
//
// lumo/tools/alarm_sounds.py turns this file into the previews on the LUMO
// page's sound list, so what you hear in Sage is what LUMO plays.

struct HapFrame { uint8_t level; uint16_t ms; uint16_t hz; };

#define N_D7   2349
#define N_E7   2637
#define N_FS7  2960
#define N_G7   3136
#define N_A7   3520

// A plain beep: on, hold, off.
#define T_NOTE(hz, ms)       {255, 3, hz}, {255, (ms) - 6, hz}, {0, 3, hz}
// A bell: struck, then dying away (quick at first, then slow).
#define T_BELL(hz, ms)       {255, 3, hz}, {140, (ms) * 3 / 10, hz}, {40, (ms) * 7 / 10 - 6, hz}, {0, 3, hz}
// A soft note: eases in and out, at `peak`.
#define T_SOFT(hz, ms, peak) {peak, 40, hz}, {peak, (ms) - 80, hz}, {0, 40, hz}
// A chirp: three quick steps up, like a bird.
#define T_CHIRP              {255, 2, N_E7}, {255, 12, N_E7}, {255, 12, N_G7}, {255, 14, N_A7}, {0, 3, N_A7}
#define T_REST(ms)           {0, ms, 0}

// Pulse: a heartbeat "tick-tock", high then low; the light beats with it.
static const HapFrame TONE_PULSE_F[]   = { T_NOTE(N_FS7, 130), T_REST(127), T_NOTE(N_D7, 130), T_REST(913) };
// Classic: four quick beeps on the buzzer's own, loudest pitch.
static const HapFrame TONE_CLASSIC_F[] = { T_NOTE(ALARM_TONE_HZ, 90), T_REST(90), T_NOTE(ALARM_TONE_HZ, 90), T_REST(90),
                                           T_NOTE(ALARM_TONE_HZ, 90), T_REST(90), T_NOTE(ALARM_TONE_HZ, 90), T_REST(680) };
// Rising: three steps up a major chord, the top one held.
static const HapFrame TONE_RISING_F[]  = { T_NOTE(N_D7, 160), T_REST(60), T_NOTE(N_FS7, 160), T_REST(60),
                                           T_NOTE(N_A7, 280), T_REST(880) };
// Chirp: three bird-like chirps (also a finished timer).
static const HapFrame TONE_CHIRP_F[]   = { T_CHIRP, T_REST(70), T_CHIRP, T_REST(70), T_CHIRP, T_REST(900) };
// Chime: a three-note bell, high to low, ringing out.
static const HapFrame TONE_CHIME_F[]   = { T_BELL(N_A7, 420), T_BELL(N_FS7, 420), T_BELL(N_D7, 700), T_REST(1200) };
// Dawn: soft, slow notes that take two minutes to reach full volume.
static const HapFrame TONE_DAWN_F[]    = { T_SOFT(N_D7, 280, 200), T_REST(900), T_SOFT(N_FS7, 280, 200), T_REST(900),
                                           T_SOFT(N_A7, 420, 230), T_REST(1800) };
// Melody: a short morning tune that climbs and lands on the top note.
static const HapFrame TONE_MELODY_F[]  = { T_NOTE(N_D7, 150), T_REST(30), T_NOTE(N_E7, 150), T_REST(30),
                                           T_NOTE(N_FS7, 150), T_REST(30), T_NOTE(N_A7, 300), T_REST(60),
                                           T_NOTE(N_FS7, 150), T_REST(30), T_NOTE(N_A7, 450), T_REST(1100) };
// Urgent: a fast two-note warble, for heavy sleepers.
static const HapFrame TONE_URGENT_F[]  = { T_NOTE(N_E7, 70), T_NOTE(N_A7, 70), T_NOTE(N_E7, 70), T_NOTE(N_A7, 70),
                                           T_NOTE(N_E7, 70), T_NOTE(N_A7, 70), T_NOTE(N_E7, 70), T_NOTE(N_A7, 70),
                                           T_NOTE(N_E7, 70), T_NOTE(N_A7, 70), T_NOTE(N_E7, 70), T_NOTE(N_A7, 70),
                                           T_REST(450) };

#undef T_NOTE
#undef T_BELL
#undef T_SOFT
#undef T_CHIRP
#undef T_REST

// In AlarmTone order (config.h). build: how long a ringing alarm takes to
// grow from ALARM_START_PCT to its volume. name: what Sage calls it.
struct ToneDef { const char* name; const HapFrame* f; uint8_t n; uint32_t buildMs; };
#define TONE_DEF(name, frames, build) { name, frames, (uint8_t)(sizeof(frames) / sizeof(HapFrame)), build }
static const ToneDef TONE_LIB[] = {
  TONE_DEF("pulse",   TONE_PULSE_F,   ALARM_BUILD_MS),
  TONE_DEF("classic", TONE_CLASSIC_F, 8000),
  TONE_DEF("rising",  TONE_RISING_F,  60000),
  TONE_DEF("chirp",   TONE_CHIRP_F,   6000),
  TONE_DEF("chime",   TONE_CHIME_F,   30000),
  TONE_DEF("dawn",    TONE_DAWN_F,    120000),
  TONE_DEF("melody",  TONE_MELODY_F,  20000),
  TONE_DEF("urgent",  TONE_URGENT_F,  3000),
};
#undef TONE_DEF
static_assert(sizeof(TONE_LIB) / sizeof(TONE_LIB[0]) == TONE_COUNT, "one sound per AlarmTone");
