#pragma once
#include <Arduino.h>
#include <math.h>

// Easing for the screen animations. Every animation is a pure function of the
// time since it started, so a slow frame never makes one stutter or overrun:
// it just lands a little further along.

// The steady beat screens draw on (2.18). Each screen keeps its own `next`;
// framePace says whether it's time to draw and moves `next` on by `period`,
// so frames land on the beat instead of drifting with loop()'s work. A screen
// that falls a whole beat behind starts the beat again from now rather than
// rushing to catch up. frameWakeAt is the soonest beat any screen wants:
// loop() sleeps until then (at most LOOP_IDLE_MS).
extern uint32_t frameWakeAt;

static inline void frameWant(uint32_t at) {
  if ((int32_t)(at - frameWakeAt) < 0) frameWakeAt = at;
}

static inline bool framePace(uint32_t& next, uint32_t now, uint32_t period, bool force = false) {
  if (!force && (int32_t)(now - next) < 0) { frameWant(next); return false; }
  next += period;
  if ((int32_t)(now - next) >= 0 || force) next = now + period;
  frameWant(next);
  return true;
}

static inline float animClamp(float t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }

// 0..1 through an animation that started at `start` and lasts `ms`.
static inline float animProgress(unsigned long start, unsigned long now, unsigned long ms) {
  return animClamp((float)(now - start) / (float)ms);
}

static inline float easeOutCubic(float t) { t = 1 - animClamp(t); return 1 - t * t * t; }
static inline float easeInOutCubic(float t) {
  t = animClamp(t);
  return t < 0.5f ? 4 * t * t * t : 1 - powf(-2 * t + 2, 3) / 2;
}
// Overshoots a touch and settles, like a watch hand finding its mark.
static inline float easeOutBack(float t) {
  t = animClamp(t) - 1;
  const float c = 1.4f;
  return 1 + (c + 1) * t * t * t + c * t * t;
}
// A quartz tick: most of the move in the first 120 ms, a tiny bounce after.
static inline float easeTick(float t) {
  t = animClamp(t);
  if (t < 0.6f) return easeOutCubic(t / 0.6f) * 1.04f;
  return 1.04f - 0.04f * easeOutCubic((t - 0.6f) / 0.4f);
}
