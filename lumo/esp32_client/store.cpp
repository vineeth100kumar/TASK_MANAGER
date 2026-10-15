#include <Arduino.h>
#include <Preferences.h>
#include "store.h"

static const char* NS = "lumo";
static const char* NET_NS = "lumonet";

char netSsid[33]  = "";
char netPass[65]  = "";
char netHost[64]  = "";
char netToken[16] = "";

void storeNetLoad() {
  // secrets.example.h's placeholder counts as no secrets.h.
  bool compiled = WIFI_SSID[0] && strcmp(WIFI_SSID, "YOUR_WIFI_SSID") != 0;
  Preferences p;
  if (compiled) {
    strlcpy(netSsid, WIFI_SSID, sizeof(netSsid));
    strlcpy(netPass, WIFI_PASS, sizeof(netPass));
    strlcpy(netHost, PI_HOSTNAME, sizeof(netHost));
    strlcpy(netToken, DESK_TOKEN, sizeof(netToken));
    if (!p.begin(NET_NS, false)) return;
    // Written only when something changed, so a restart costs no flash wear.
    if (p.getString("ssid", "") != netSsid) p.putString("ssid", netSsid);
    if (p.getString("pass", "") != netPass) p.putString("pass", netPass);
    if (p.getString("host", "") != netHost) p.putString("host", netHost);
    if (p.getString("token", "") != netToken) p.putString("token", netToken);
    p.end();
    return;
  }
  if (!p.begin(NET_NS, true)) {
    Serial.println("[NET] No Wi-Fi details saved: flash once by USB with secrets.h");
    return;
  }
  p.getString("ssid", netSsid, sizeof(netSsid));
  p.getString("pass", netPass, sizeof(netPass));
  p.getString("host", netHost, sizeof(netHost));
  p.getString("token", netToken, sizeof(netToken));
  p.end();
  Serial.printf("[NET] Using the saved Wi-Fi details (%s)\n", netSsid);
}

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
