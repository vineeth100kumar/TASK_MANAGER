#include <Arduino.h>
#include <time.h>
#include <math.h>
#include "clockkeeper.h"

static const uint32_t DAY_MS = 86400000UL;

static bool     synced   = false;
static uint32_t baseMs   = 0;   // millis() when the clock was last set
static uint32_t baseDay  = 0;   // time of day in ms at that moment
static unsigned long lastNtpTry = 0;

void clockSync(uint8_t h, uint8_t m, uint8_t s, uint16_t ms) {
  uint32_t target = ((uint32_t)h * 3600UL + (uint32_t)m * 60UL + s) * 1000UL + ms;
  if (synced) {
    uint32_t cur = (baseDay + (millis() - baseMs)) % DAY_MS;
    int32_t diff = (int32_t)target - (int32_t)cur;
    if (diff >  (int32_t)(DAY_MS / 2)) diff -= DAY_MS;
    if (diff < -(int32_t)(DAY_MS / 2)) diff += DAY_MS;
    // Network jitter is not drift: leave the running clock alone unless it is
    // visibly off, so the seconds sweep never hiccups on a resync.
    if (abs(diff) < 250) return;
  }
  baseDay = target;
  baseMs  = millis();
  synced  = true;
}

ClockNow clockNow() {
  if (!synced && millis() - lastNtpTry > 2000) {
    lastNtpTry = millis();
    struct tm ti;
    if (getLocalTime(&ti, 0) && ti.tm_year > 120) {
      clockSync(ti.tm_hour, ti.tm_min, ti.tm_sec, 0);
    }
  }

  uint32_t dayMs = synced ? (baseDay + (millis() - baseMs)) % DAY_MS : 0;
  ClockNow c;
  uint32_t secs = dayMs / 1000UL;
  c.h = secs / 3600UL;
  c.m = (secs / 60UL) % 60UL;
  c.s = secs % 60UL;
  c.secFrac = (dayMs % 1000UL) / 1000.0f;
  c.minuteOfDay = dayMs / 60000.0f;
  c.synced = synced;
  return c;
}

// ---------------------------------------------------------------- phases
struct PhaseKey { float min; uint8_t r, g, b; float level; };

// A day in six colours: deep night, dawn peach, bright morning, cool noon,
// golden hour, sunset, dusk violet, back to night. Everything between keys
// is eased, so the light drifts rather than steps.
static const PhaseKey KEYS[] = {
  {    0, 70,  80, 190, 0.22f},   // midnight indigo
  {  300, 90,  90, 200, 0.26f},   // pre-dawn
  {  390, 255, 150, 110, 0.60f},  // dawn peach
  {  540, 255, 214, 150, 0.92f},  // morning warm white
  {  720, 190, 225, 255, 1.00f},  // noon cool white
  {  990, 255, 190,  90, 0.92f},  // golden hour
  { 1110, 255, 112,  90, 0.78f},  // sunset
  { 1200, 160, 100, 255, 0.55f},  // dusk violet
  { 1320, 80,  85, 190, 0.34f},   // night
  { 1440, 70,  80, 190, 0.22f},   // wraps to midnight
};
static const int NKEYS = sizeof(KEYS) / sizeof(KEYS[0]);

PhaseStyle clockPhase(float mod) {
  while (mod < 0) mod += 1440.0f;
  while (mod >= 1440.0f) mod -= 1440.0f;

  int i = 0;
  while (i < NKEYS - 2 && mod >= KEYS[i + 1].min) i++;
  const PhaseKey& a = KEYS[i];
  const PhaseKey& b = KEYS[i + 1];
  float t = (mod - a.min) / (b.min - a.min);
  t = t * t * (3.0f - 2.0f * t);  // smoothstep

  PhaseStyle p;
  p.r = (uint8_t)(a.r + (b.r - a.r) * t);
  p.g = (uint8_t)(a.g + (b.g - a.g) * t);
  p.b = (uint8_t)(a.b + (b.b - a.b) * t);
  p.level = a.level + (b.level - a.level) * t;

  if (mod >= 300 && mod < 720)       p.greeting = "GOOD MORNING";
  else if (mod >= 720 && mod < 1020) p.greeting = "GOOD AFTERNOON";
  else if (mod >= 1020 && mod < 1260) p.greeting = "GOOD EVENING";
  else                               p.greeting = "GOOD NIGHT";
  return p;
}
