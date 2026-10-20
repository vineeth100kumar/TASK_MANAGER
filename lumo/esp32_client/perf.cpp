#include <Arduino.h>
#include "perf.h"
#include "display.h"

static uint32_t winStart   = 0;   // millis() the window began
static uint32_t frames     = 0;
static uint64_t frameUsSum = 0;
static uint32_t worstUs    = 0;
static uint32_t stallUs    = 0;
static uint32_t peakFps    = 0;   // the most frames in any one second of the window
static uint32_t secStart   = 0, secFrames = 0;
static uint32_t passStart  = 0, lastPass = 0, writesAtStart = 0;

void perfLoopStart() {
  uint32_t now = micros();
  if (lastPass && now - lastPass > stallUs) stallUs = now - lastPass;
  lastPass = passStart = now;
  writesAtStart = tft.writes;
  if (!winStart) winStart = secStart = millis();
}

void perfLoopEnd() {
  if (tft.writes != writesAtStart) {
    uint32_t us = micros() - passStart;
    frames++;
    frameUsSum += us;
    if (us > worstUs) worstUs = us;
    secFrames++;
  }
  uint32_t ms = millis();
  if (ms - secStart >= 1000) {
    if (secFrames > peakFps) peakFps = secFrames;
    secFrames = 0;
    secStart = ms;
  }
}

void perfReport(char* out, size_t size) {
  uint32_t ms = millis();
  uint32_t span = winStart ? ms - winStart : 0;
  float fps = span ? frames * 1000.0f / span : 0;
  float avg = frames ? (float)(frameUsSum / frames) / 1000.0f : 0;
  snprintf(out, size, "{\"fps\":%.1f,\"peakFps\":%u,\"frameMs\":%.1f,\"worstMs\":%.1f,\"stallMs\":%.1f,\"seconds\":%u}",
           fps, (unsigned)peakFps, avg, worstUs / 1000.0f, stallUs / 1000.0f, (unsigned)(span / 1000));
  winStart = secStart = ms;
  frames = 0; frameUsSum = 0; worstUs = 0; stallUs = 0; peakFps = 0; secFrames = 0;
}
