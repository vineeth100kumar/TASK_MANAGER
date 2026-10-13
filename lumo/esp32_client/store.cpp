#include <Arduino.h>
#include <Preferences.h>
#include "store.h"

static const char* NS = "lumo";

void storeLoad(LumoState& s) {
  Preferences p;
  if (!p.begin(NS, true)) return;   // nothing saved yet
  s.clock_style  = (ClockStyle)p.getUChar("style", CLOCK_DIGITAL);
  if (s.clock_style > CLOCK_DEPTH) s.clock_style = CLOCK_DIGITAL;
  s.hour24       = p.getBool("h24", false);
  s.show_seconds = p.getBool("secs", true);
  p.getString("z2", s.zone2, sizeof(s.zone2));
  s.zone2_offset = p.getShort("z2off", 0);
  s.utc_off = p.getShort("utcoff", GMT_OFFSET_SEC / 60);
  s.snooze_minutes = constrain(p.getUChar("snooze", 5), 1, 60);
  s.haptic_strength = min((int)p.getUChar("hapt", HAPTIC_STRENGTH), 100);
  // "alarms3": 2.11 keeps the days each alarm repeats on too. Older lists
  // are left alone and Sage sends the alarms again as soon as the clock connects.
  uint8_t n = p.getUChar("acount3", 0);
  if (n > MAX_LOCAL_ALARMS) n = 0;
  if (n && p.getBytes("alarms3", s.local_alarms, sizeof(LocalAlarm) * n) == sizeof(LocalAlarm) * n) {
    s.local_alarm_count = n;
  }
  p.end();
}

void storeSaveClock(const LumoState& s) {
  Preferences p;
  if (!p.begin(NS, false)) return;
  p.putUChar("style", (uint8_t)s.clock_style);
  p.putBool("h24", s.hour24);
  p.putBool("secs", s.show_seconds);
  p.putString("z2", s.zone2);
  p.putShort("z2off", s.zone2_offset);
  p.putShort("utcoff", s.utc_off);
  p.end();
}

void storeSaveAlarms(const LumoState& s) {
  Preferences p;
  if (!p.begin(NS, false)) return;
  p.putUChar("snooze", s.snooze_minutes);
  p.putUChar("acount3", s.local_alarm_count);
  if (s.local_alarm_count) p.putBytes("alarms3", s.local_alarms, sizeof(LocalAlarm) * s.local_alarm_count);
  p.end();
}

void storeSaveHaptics(const LumoState& s) {
  Preferences p;
  if (!p.begin(NS, false)) return;
  p.putUChar("hapt", s.haptic_strength);
  p.end();
}
