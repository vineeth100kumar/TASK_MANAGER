#include <Arduino.h>
#include "ws_client.h"
#include "peripherals.h"
#include "display.h"
#include "clockkeeper.h"
#include "store.h"

#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>

using namespace websockets;

static WebsocketsClient client;
static LumoState* statePtr = nullptr;
static bool isConnected = false;

static unsigned long lastReconnectAttempt = 0;
static unsigned long reconnectInterval    = 2000;
static const unsigned long MAX_BACKOFF    = 30000;

// CLOCK's display fields: style, hour24, show_seconds and the second zone.
// Saved to flash only when one of them changed.
static void applyClockStyle(LumoState& s, JsonDocument& doc) {
  ClockStyle style = s.clock_style;
  const char* st = doc["style"] | "";
  if (strcmp(st, "digital") == 0)      style = CLOCK_DIGITAL;
  else if (strcmp(st, "minimal") == 0) style = CLOCK_MINIMAL;
  else if (strcmp(st, "analog") == 0)  style = CLOCK_ANALOG;
  bool h24  = doc["hour24"].is<bool>() ? doc["hour24"].as<bool>() : s.hour24;
  bool secs = doc["show_seconds"].is<bool>() ? doc["show_seconds"].as<bool>() : s.show_seconds;

  char zone[sizeof(s.zone2)] = "";
  int16_t offset = 0;
  if (doc["zone2"].is<const char*>() && doc["zone2_h"].is<int>() && doc["zone2_m"].is<int>()) {
    strlcpy(zone, doc["zone2"], sizeof(zone));
    int there = doc["zone2_h"].as<int>() * 60 + doc["zone2_m"].as<int>();
    int here  = s.h * 60 + s.m;
    offset = (int16_t)(((there - here) % 1440 + 1440 + 720) % 1440 - 720);   // -12 h .. +12 h
  } else if (!doc["style"].is<const char*>()) {
    strlcpy(zone, s.zone2, sizeof(zone));   // an old Sage: leave it as it was
    offset = s.zone2_offset;
  }

  bool changed = style != s.clock_style || h24 != s.hour24 || secs != s.show_seconds ||
                 strcmp(zone, s.zone2) != 0 || offset != s.zone2_offset;
  if (!changed) return;
  s.clock_style = style;
  s.hour24 = h24;
  s.show_seconds = secs;
  strlcpy(s.zone2, zone, sizeof(s.zone2));
  s.zone2_offset = offset;
  s.flag_clock_changed = true;
  storeSaveClock(s);
}

static void handleTextMessage(const String& payload) {
  if (!statePtr) return;
  LumoState& s = *statePtr;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
    return;
  }

  const char* cmd = doc["cmd"] | "";

  if (strcmp(cmd, "PAIRED") == 0) {
    s.paired = doc["ok"] | false;
    s.pair_refused = !s.paired;
    Serial.printf("[WS] %s\n", s.paired ? "Paired with Sage" : "Sage refused DESK_TOKEN");
    return;
  }
  if (strcmp(cmd, "ACTIONS") == 0) {
    strlcpy(s.act_left,  doc["left"]  | "", sizeof(s.act_left));
    strlcpy(s.act_ok,    doc["ok"]    | "", sizeof(s.act_ok));
    strlcpy(s.act_right, doc["right"] | "", sizeof(s.act_right));
    if (!s.act_left[0] && !s.act_ok[0] && !s.act_right[0]) {
      s.notif_active = false;   // the card was answered or timed out
    }
    s.flag_card_changed = true;
    return;
  }
  if (strcmp(cmd, "ALARMS") == 0) {
    LocalAlarm list[MAX_LOCAL_ALARMS];
    uint8_t n = 0;
    for (JsonObject a : doc["list"].as<JsonArray>()) {
      if (n >= MAX_LOCAL_ALARMS) break;
      int h = a["h"] | -1, m = a["m"] | -1;
      if (h < 0 || h > 23 || m < 0 || m > 59) continue;
      list[n++] = { (uint8_t)h, (uint8_t)m };
    }
    uint8_t snooze = constrain((int)(doc["snooze"] | (int)s.snooze_minutes), 1, 60);
    if (n != s.local_alarm_count || snooze != s.snooze_minutes ||
        memcmp(list, s.local_alarms, sizeof(LocalAlarm) * n) != 0) {
      memcpy(s.local_alarms, list, sizeof(LocalAlarm) * n);
      s.local_alarm_count = n;
      s.snooze_minutes = snooze;
      storeSaveAlarms(s);
      Serial.printf("[WS] %u alarm(s) saved for offline ringing\n", n);
    }
    return;
  }

  if (strcmp(cmd, "SCREEN") == 0) {
    const char* m = doc["mode"] | "CLOCK";
    if (strcmp(m, "FACE") == 0)         s.next_screen = SCREEN_CLOCK;   // the face is gone
    else if (strcmp(m, "CLOCK") == 0)   s.next_screen = SCREEN_CLOCK;
    else if (strcmp(m, "SYSTEM") == 0)  s.next_screen = SCREEN_SYSTEM;
    else if (strcmp(m, "SPOTIFY") == 0) s.next_screen = SCREEN_SPOTIFY;
    else if (strcmp(m, "TASKS") == 0)   s.next_screen = SCREEN_TASKS;
    else if (strcmp(m, "MEMORY") == 0)  s.next_screen = SCREEN_MEMORY;
    s.flag_screen_switch = true;
    Serial.printf("[WS] Remote screen switch: %s\n", m);
  }
  else if (strcmp(cmd, "MEMORY_META") == 0) {
    if (doc["caption"].is<const char*>()) {
      strncpy(s.mem_caption, doc["caption"], sizeof(s.mem_caption) - 1);
      s.mem_caption[sizeof(s.mem_caption) - 1] = '\0';
    } else {
      s.mem_caption[0] = '\0';
    }
    s.next_screen = SCREEN_MEMORY;
    s.flag_screen_switch = true;
    s.flag_memory_changed = true;
  }
  else if (strcmp(cmd, "NOTIF") == 0) {
    const char* app = doc["app"] | "iPhone";
    const char* title = doc["title"] | "Alert";
    const char* body = doc["body"] | "";
    strncpy(s.notif_app, app, sizeof(s.notif_app) - 1);
    strncpy(s.notif_title, title, sizeof(s.notif_title) - 1);
    strncpy(s.notif_body, body, sizeof(s.notif_body) - 1);
    s.notif_active = true;
    s.notif_start = millis();
    s.flag_card_changed = true;
    neoPing(90, 170, 255);
  }
  else if (strcmp(cmd, "SYSTEM_STATS") == 0) {
    s.cpu_temp = doc["cpu_temp"] | s.cpu_temp;
    s.cpu_pct  = doc["cpu_pct"]  | s.cpu_pct;
    s.ram_pct  = doc["ram_pct"]  | s.ram_pct;
    s.disk_pct = doc["disk_pct"] | s.disk_pct;
    s.flag_system_changed = true;
  }
  else if (strcmp(cmd, "CLOCK") == 0) {
    s.h = doc["h"] | s.h;
    s.m = doc["m"] | s.m;
    clockSync(s.h, s.m, doc["s"] | 0, doc["ms"] | 0);
    if (doc["alarm_h"].is<int>() && doc["alarm_m"].is<int>()) {
      s.alarm_h   = doc["alarm_h"];
      s.alarm_m   = doc["alarm_m"];
      s.alarm_set = true;
    } else {
      s.alarm_set = false;
    }
    if (doc["weekday"].is<const char*>()) {
      strncpy(s.weekday, doc["weekday"], sizeof(s.weekday) - 1);
    }
    if (doc["date"].is<const char*>()) {
      strncpy(s.date, doc["date"], sizeof(s.date) - 1);
    }
    applyClockStyle(s, doc);
  }
  else if (strcmp(cmd, "WEATHER") == 0) {
    s.temp_c = doc["temp_c"] | s.temp_c;
    if (doc["icon"].is<const char*>()) {
      strncpy(s.weather_icon, doc["icon"], sizeof(s.weather_icon) - 1);
    }
  }
  else if (strcmp(cmd, "SPOTIFY") == 0) {
    if (doc["title"].is<const char*>()) {
      strncpy(s.sp_title, doc["title"], sizeof(s.sp_title) - 1);
    }
    if (doc["artist"].is<const char*>()) {
      strncpy(s.sp_artist, doc["artist"], sizeof(s.sp_artist) - 1);
    }
    s.sp_progress_ms = doc["progress_ms"] | s.sp_progress_ms;
    s.sp_duration_ms = doc["duration_ms"] | s.sp_duration_ms;
    s.sp_playing     = doc["playing"]     | s.sp_playing;
    s.flag_spotify_changed = true;
  }
  else if (strcmp(cmd, "LIGHTS") == 0) {
    const char* modeStr = doc["mode"] | "WARM";
    uint8_t bri         = doc["brightness"] | 40;
    uint16_t hue        = doc["hue"] | 0;

    NeoMode nm = NEO_AUTO;
    if (strcmp(modeStr, "WARM")   == 0) nm = NEO_WARM;
    else if (strcmp(modeStr, "COLOR")   == 0) nm = NEO_COLOR;
    else if (strcmp(modeStr, "BREATHE") == 0) nm = NEO_BREATHE;
    else if (strcmp(modeStr, "AURORA")  == 0) nm = NEO_AURORA;
    else if (strcmp(modeStr, "COMET")   == 0) nm = NEO_COMET;
    else if (strcmp(modeStr, "OFF")     == 0) nm = NEO_OFF;

    s.neo_mode       = nm;
    s.neo_brightness = bri;
    s.neo_hue        = hue;
    neoSetMode(nm, bri, hue);
  }
  else if (strcmp(cmd, "HAPTIC") == 0) {
    uint16_t ms = doc["ms"] | 50;
    hapticPulse(ms);
  }
  else if (strcmp(cmd, "ALARM_RING") == 0) {
    s.alarm_ringing = true;
    s.local_ringing = false;   // Sage has it now
  }
  else if (strcmp(cmd, "ALARM_OFF") == 0) {
    s.alarm_ringing = false;
    s.local_ringing = false;
  }
  else if (strcmp(cmd, "SHOW_TASKS") == 0) {
    JsonArray arr = doc["items"];
    s.task_count = 0;
    for (const char* item : arr) {
      if (s.task_count < 5 && item) {
        strncpy(s.tasks[s.task_count], item, sizeof(s.tasks[0]) - 1);
        s.tasks[s.task_count][sizeof(s.tasks[0]) - 1] = '\0';
        s.task_count++;
      }
    }
    s.flag_tasks_changed = true;
  }
  else if (strcmp(cmd, "VOICE_STATE") == 0) {
    const char* st = doc["state"] | "IDLE";
    strncpy(s.voice_state, st, sizeof(s.voice_state) - 1);
    s.voice_state[sizeof(s.voice_state) - 1] = '\0';

    if (doc["subtitle"].is<const char*>()) {
      strncpy(s.voice_subtitle, doc["subtitle"], sizeof(s.voice_subtitle) - 1);
      s.voice_subtitle[sizeof(s.voice_subtitle) - 1] = '\0';
    } else {
      s.voice_subtitle[0] = '\0';
    }

    s.voice_volume = doc["volume"] | 0.0f;
    s.flag_voice_changed = true;

    if (strcmp(st, "LISTENING") == 0) {
      neoSetVoice(VFX_LISTEN, 0.0f);
    } else if (strcmp(st, "THINKING") == 0) {
      neoSetVoice(VFX_THINK, 0.0f);
    } else if (strcmp(st, "SPEAKING") == 0) {
      neoSetVoice(VFX_SPEAK, s.voice_volume);
    } else {
      neoSetVoice(VFX_NONE, 0.0f);   // IDLE and anything unknown hand the ring back
    }
  }
}

static void handleBinaryMessage(const uint8_t* data, size_t len) {
  if (len >= 2 && data[0] == 0xAA && data[1] == 0xCC) {
    onNewMemoryStrip(data, len);
  } else {
    onNewArt(data, len);
  }
}

void wsInit(LumoState& state) {
  statePtr = &state;

  client.onMessage([](WebsocketsMessage msg) {
    if (msg.isText()) {
      handleTextMessage(msg.data());
    } else if (msg.isBinary()) {
      handleBinaryMessage((const uint8_t*)msg.c_str(), msg.length());
    }
  });

  client.onEvent([](WebsocketsEvent event, String data) {
    if (event == WebsocketsEvent::ConnectionOpened) {
      Serial.println("[WS] Connected to Pi server!");
      isConnected = true;
      reconnectInterval = 2000;
      // The first frame must be HELLO with the pairing code, or Sage hangs up.
      char hello[80];
      snprintf(hello, sizeof(hello), "{\"evt\":\"HELLO\",\"token\":\"%s\",\"fw\":\"%s\"}", DESK_TOKEN, FW_VERSION);
      client.send(hello);
    } else if (event == WebsocketsEvent::ConnectionClosed) {
      Serial.println("[WS] Disconnected from Pi server");
      isConnected = false;
      if (statePtr) statePtr->paired = false;
    }
  });
}

void wsConnect() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WS] WiFi not connected, skipping wsConnect");
    return;
  }

  String hostStr = PI_HOSTNAME;
  IPAddress piIP;
  if (!piIP.fromString(PI_HOSTNAME)) {
    IPAddress resolved = MDNS.queryHost(PI_HOSTNAME, 3000);
    if (resolved != INADDR_NONE && resolved[0] != 0) {
      hostStr = resolved.toString();
      Serial.printf("[WS] mDNS resolved: %s -> %s\n", PI_HOSTNAME, hostStr.c_str());
    } else {
      Serial.println("[WS] mDNS query failed. Trying direct hostname...");
    }
  } else {
    hostStr = piIP.toString();
  }

  Serial.printf("[WS] Connecting to ws://%s:%d%s\n", hostStr.c_str(), PI_WS_PORT, PI_WS_PATH);
  client.connect(hostStr, PI_WS_PORT, PI_WS_PATH);
}

void wsPoll() {
  client.poll();

  if (!isConnected && WiFi.status() == WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt >= reconnectInterval) {
      lastReconnectAttempt = now;
      Serial.printf("[WS] Reconnecting (backoff: %lu ms)...\n", reconnectInterval);
      wsConnect();
      reconnectInterval = min(reconnectInterval * 2, MAX_BACKOFF);
    }
  }
}

bool wsConnected() {
  return isConnected;
}

void wsSend(const char* json) {
  if (isConnected) {
    client.send(json);
  }
}
