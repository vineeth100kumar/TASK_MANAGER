#pragma once
#include <Arduino.h>

// Free-running wall clock with sub-second resolution. The Pi sends the time once
// a minute; between those messages the ESP32 counts on its own so seconds and
// animations never wait on the network. It also keeps the weekday, and when
// the Pi has been silent for a while it sets itself from internet time (in
// the UTC offset the Pi last gave), so a clock cut off from Sage neither
// drifts nor rings an alarm on the wrong day.
struct ClockNow {
  uint8_t  h, m, s;
  float    secFrac;      // 0..1 progress through the current second
  float    minuteOfDay;  // 0..1440, fractional
  bool     synced;
  int8_t   wd;           // 0 Monday ... 6 Sunday, -1 not known yet
};

// One colour of the day. Used by both the display and the NeoPixel ring so the
// room and the screen always agree.
struct PhaseStyle {
  uint8_t     r, g, b;   // accent colour
  float       level;     // 0..1 overall brightness for this time of day
  const char* greeting;
};

void       clockSync(uint8_t h, uint8_t m, uint8_t s, uint16_t ms, int8_t wd = -1);   // from the Pi
void       clockSetUtcOffset(int16_t minutes);   // local time's minutes ahead of UTC
ClockNow   clockNow();
PhaseStyle clockPhase(float minuteOfDay);
