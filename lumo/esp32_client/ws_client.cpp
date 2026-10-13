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
#include <esp_system.h>

static unsigned long lastHapticCmd = 0;   // when Sage last asked for a haptic

using namespace websockets;

static WebsocketsClient client;
static LumoState* statePtr = nullptr;
static bool isConnected = false;

// ---------------------------------------------------------------------
//  Keeping the link up. Anything from the Pi (a message, its ping, the
//  answer to ours) counts as hearing from it; a link that stays quiet for
//  LINK_DEAD_MS is closed and tried again, so a Pi that restarted or a
//  Wi-Fi that dropped never leaves the clock thinking it's connected.
// ---------------------------------------------------------------------
static unsigned long openedAt     = 0;   // when the socket opened (HELLO sent)
static unsigned long lastHeard    = 0;
static unsigned long lastPingSent = 0;
static unsigned long nextTryAt    = 0;   // when to try the Pi again
static unsigned long retryMs      = LINK_RETRY_MIN_MS;
static unsigned long downSince    = 1;   // when Sage was last reachable (0 while it is)
static uint16_t      reconnects   = 0;   // pairings since this start, less the first
static uint16_t      wifiDrops    = 0;
static int           rttMs        = -1;  // how long the Pi took to answer the last ping
static bool          everPaired   = false;
static char          lastDrop[40] = "";  // why the link went last, told to the Pi on the way back

// The Pi's address: an IP in secrets.h is used as it is; an mDNS name is
// looked up once and remembered, and only looked up again when that address
// stops working (each lookup holds the clock for up to 2 s).
static IPAddress piIp;
static bool      piIpKnown = false;
static uint8_t   piIpFails = 0;

// What the clock did alone while it couldn't reach Sage, told to it in the
// next HELLO so Sage doesn't ring a stopped alarm again (desk.offline_reports).
struct OfflineReport { char a[12]; int8_t h, m; unsigned long at; };
static OfflineReport pending[6];
static uint8_t pendingCount = 0;

static const char* bootReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "power on";
    case ESP_RST_SW:       return "restarted";
    case ESP_RST_PANIC:    return "crash";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout (power dipped)";
    case ESP_RST_EXT:      return "reset button";
    default:               return "other";
  }
}

static void linkDown(const char* why) {
  if (isConnected) Serial.printf("[WS] Link down: %s\n", why);
  isConnected = false;
  if (statePtr) statePtr->paired = false;
  if (!downSince) downSince = millis();
  strlcpy(lastDrop, why, sizeof(lastDrop));
  nextTryAt = millis() + retryMs;
}

static void onPaired() {
  if (everPaired) reconnects++;
  everPaired = true;
  downSince = 0;
  retryMs = LINK_RETRY_MIN_MS;
  piIpFails = 0;
  pendingCount = 0;      // Sage has them now
  lastDrop[0] = '\0';
}

// CLOCK's display fields: style, hour24, show_seconds and the second zone.
// Saved to flash only when one of them changed.
static void applyClockStyle(LumoState& s, JsonDocument& doc) {
  ClockStyle style = s.clock_style;
  const char* st = doc["style"] | "";
  if (strcmp(st, "digital") == 0)      style = CLOCK_DIGITAL;
  else if (strcmp(st, "minimal") == 0) style = CLOCK_MINIMAL;
  else if (strcmp(st, "analog") == 0)  style = CLOCK_ANALOG;
  else if (strcmp(st, "monolith") == 0)   style = CLOCK_MONOLITH;
  else if (strcmp(st, "stacked") == 0)    style = CLOCK_STACKED;
  else if (strcmp(st, "nightstand") == 0) style = CLOCK_NIGHTSTAND;
  else if (strcmp(st, "dial") == 0)       style = CLOCK_DIAL;
  else if (strcmp(st, "depth") == 0)      style = CLOCK_DEPTH;
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
    if (s.paired) onPaired();
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
      int h = a["h"] | -1, m = a["m"] | -1, w = a["w"] | -1, d = a["d"] | 0;
      if (h < 0 || h > 23 || m < 0 || m > 59) continue;
      list[n++] = { (uint8_t)h, (uint8_t)m, (int8_t)(w >= 0 && w <= 6 ? w : -1), (uint8_t)(d & 0x7F) };
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
    else if (strcmp(m, "TIMER") == 0)   s.next_screen = SCREEN_TIMER;
    else if (strcmp(m, "STOPWATCH") == 0) s.next_screen = SCREEN_STOPWATCH;
    else if (strcmp(m, "WORLD") == 0)   s.next_screen = SCREEN_WORLD;
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
    // A knock for a phone notification; a reminder already brought its own.
    if (s.hap_notify && millis() - lastHapticCmd > 800) hapticPlay(HAP_NOTIFY);
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
    clockSync(s.h, s.m, doc["s"] | 0, doc["ms"] | 0, doc["wd"] | -1);
    if (doc["utc_off"].is<int>() && doc["utc_off"].as<int>() != s.utc_off) {
      s.utc_off = doc["utc_off"].as<int>();
      clockSetUtcOffset(s.utc_off);
      storeSaveClock(s);
    }
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
      if (strncmp(s.sp_title, doc["title"], sizeof(s.sp_title) - 1)) {
        // A new song: what we knew about the last one goes.
        s.sp_genre[0] = s.sp_lyric[0] = '\0';
        s.sp_bpm = 0; s.sp_energy = 0.5f; s.sp_fact_count = 0; s.sp_lyrics = false;
      }
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
  else if (strcmp(cmd, "SONG_INFO") == 0) {
    // Only for the song on screen: a late answer about the last one is dropped.
    if (strncmp(s.sp_title, doc["title"] | "", sizeof(s.sp_title) - 1) == 0) {
      strlcpy(s.sp_genre, doc["genre"] | "", sizeof(s.sp_genre));
      s.sp_bpm    = doc["bpm"] | 0;
      s.sp_energy = doc["energy"] | 0.5f;
      s.sp_lyrics = doc["lyrics"] | false;
      s.sp_fact_count = 0;
      for (const char* f : doc["facts"].as<JsonArray>()) {
        if (f && s.sp_fact_count < 3) strlcpy(s.sp_facts[s.sp_fact_count++], f, sizeof(s.sp_facts[0]));
      }
    }
  }
  else if (strcmp(cmd, "LYRIC") == 0) {
    if (strncmp(s.sp_title, doc["title"] | "", sizeof(s.sp_title) - 1) == 0) {
      strlcpy(s.sp_lyric, doc["line"] | "", sizeof(s.sp_lyric));
    }
  }
  else if (strcmp(cmd, "LIGHTS") == 0) {
    const char* modeStr = doc["mode"] | "WARM";
    uint8_t bri         = doc["brightness"] | 100;
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
    // A named effect, or a length: Sage sends 300 ms with a reminder.
    const char* pattern = doc["pattern"] | "";
    uint16_t ms = doc["ms"] | 50;
    lastHapticCmd = millis();
    if (!s.hap_notify) return;   // knocks for notifications are off in Sage
    if (pattern[0] && hapticPlayNamed(pattern)) {}
    else if (ms >= 250) hapticPlay(HAP_REMINDER);
    else hapticPulse(ms);
  }
  else if (strcmp(cmd, "HAPTICS") == 0) {
    // Which events knock, and the strength set in Sage. A change of
    // strength plays one tick so you feel it.
    s.hap_buttons = doc["buttons"] | s.hap_buttons;
    s.hap_notify  = doc["notify"]  | s.hap_notify;
    int pct = doc["strength"] | (int)s.haptic_strength;
    pct = constrain(pct, 0, 100);
    if (pct != s.haptic_strength) {
      s.haptic_strength = pct;
      hapticSetStrength(pct);
      storeSaveHaptics(s);
      hapticPlay(HAP_TICK);
    }
  }
  else if (strcmp(cmd, "ALARM_RING") == 0) {
    strlcpy(s.alarm_label, doc["label"] | "", sizeof(s.alarm_label));
    s.alarm_tone   = hapticToneNamed(doc["tone"] | "", s.alarm_tone);
    s.alarm_volume = constrain((int)(doc["volume"] | (int)s.alarm_volume), 0, 100);
    s.snooze_minutes = constrain((int)(doc["snooze"] | (int)s.snooze_minutes), 1, 60);
    s.alarm_ringing = true;
    s.local_ringing = false;   // Sage has it now
  }
  else if (strcmp(cmd, "TONE") == 0) {
    // An alarm sound, to choose one in Sage: one cycle of it ("cycles": 1,
    // Sage 2.11 on), else a few seconds.
    hapticPreview(hapticToneNamed(doc["tone"] | "", s.alarm_tone),
                  constrain((int)(doc["volume"] | (int)s.alarm_volume), 0, 100),
                  constrain((int)(doc["seconds"] | 4), 1, 15),
                  (int)(doc["cycles"] | 0) > 0);
  }
  else if (strcmp(cmd, "TIMER") == 0) {
    const char* st = doc["state"] | "idle";
    ToolState next = !strcmp(st, "running") ? TOOL_RUNNING : !strcmp(st, "paused") ? TOOL_PAUSED
                   : !strcmp(st, "done") ? TOOL_DONE : TOOL_IDLE;
    uint32_t left = doc["left_ms"] | 0;
    s.tm_left_ms  = left;
    s.tm_end      = millis() + left;
    s.tm_total_ms = doc["total_ms"] | 0;
    strlcpy(s.tm_label, doc["label"] | "", sizeof(s.tm_label));
    s.tm_state = next;
    s.flag_tools_changed = true;
  }
  else if (strcmp(cmd, "STOPWATCH") == 0) {
    s.sw_running = doc["running"] | false;
    s.sw_base_ms = doc["elapsed_ms"] | 0;
    s.sw_mark    = millis();
    s.sw_lap_count = doc["lap_count"] | 0;
    s.sw_lap_shown = 0;
    for (uint32_t lap : doc["laps"].as<JsonArray>()) {
      if (s.sw_lap_shown < STOPWATCH_LAPS) s.sw_laps[s.sw_lap_shown++] = lap;
    }
    s.flag_tools_changed = true;
  }
  else if (strcmp(cmd, "WORLD") == 0) {
    s.wc_count = 0;
    for (JsonObject z : doc["zones"].as<JsonArray>()) {
      if (s.wc_count >= MAX_WORLD_CLOCKS) break;
      strlcpy(s.wc_name[s.wc_count], z["name"] | "", sizeof(s.wc_name[0]));
      s.wc_offset[s.wc_count] = constrain((int)(z["offset"] | 0), -1440, 1440);
      s.wc_count++;
    }
    s.flag_tools_changed = true;
  }
  else if (strcmp(cmd, "NIGHT") == 0) {
    s.night = doc["on"] | false;
    neoSetSleep(s.night);
  }
  else if (strcmp(cmd, "IDENTIFY") == 0) {
    // "This one": a bright white double flash and a knock.
    neoPing(255, 255, 255);
    hapticPlay(HAP_SUCCESS);
  }
  else if (strcmp(cmd, "REBOOT") == 0) {
    Serial.println("[WS] Restarting, as Sage asked");
    client.close();
    delay(300);
    ESP.restart();
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
  } else if (len >= 2 && data[0] == 0xAA && data[1] == 0xDE) {
    onDepthStrip(data, len);
  } else {
    onNewArt(data, len);
  }
}

void wsInit(LumoState& state) {
  statePtr = &state;
  clockSetUtcOffset(state.utc_off);

  client.onMessage([](WebsocketsMessage msg) {
    lastHeard = millis();
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
      openedAt = lastHeard = lastPingSent = millis();
      // The first frame must be HELLO with the pairing code, or Sage hangs up.
      // It also says why the link went last time, and what the clock did on
      // its own meanwhile.
      JsonDocument hello;
      hello["evt"] = "HELLO";
      hello["token"] = DESK_TOKEN;
      hello["fw"] = FW_VERSION;
      hello["reconnects"] = reconnects;
      if (lastDrop[0]) hello["drop"] = lastDrop;
      if (!everPaired) hello["boot"] = bootReason();
      if (pendingCount) {
        JsonArray list = hello["offline"].to<JsonArray>();
        for (uint8_t i = 0; i < pendingCount; i++) {
          JsonObject r = list.add<JsonObject>();
          r["a"] = pending[i].a;
          if (pending[i].h >= 0) { r["h"] = pending[i].h; r["m"] = pending[i].m; }
          r["ago"] = (millis() - pending[i].at) / 1000UL;
        }
      }
      char buf[512];
      serializeJson(hello, buf, sizeof(buf));
      client.send(buf);
    } else if (event == WebsocketsEvent::ConnectionClosed) {
      if (isConnected) linkDown(statePtr && statePtr->pair_refused ? "Sage refused the pairing code" : "the Pi closed the link");
    } else if (event == WebsocketsEvent::GotPing) {
      lastHeard = millis();
    } else if (event == WebsocketsEvent::GotPong) {
      lastHeard = millis();
      rttMs = (int)(millis() - lastPingSent);
    }
  });
}

static String piAddress() {
  IPAddress ip;
  if (ip.fromString(PI_HOSTNAME)) return String(PI_HOSTNAME);
  if (piIpKnown && piIpFails < 2) return piIp.toString();
  IPAddress found = MDNS.queryHost(PI_HOSTNAME, 2000);
  if (found != INADDR_NONE && found[0] != 0) {
    piIpFails = 0;
    if (!piIpKnown || found != piIp) Serial.printf("[WS] mDNS: %s is %s\n", PI_HOSTNAME, found.toString().c_str());
    piIp = found;
    piIpKnown = true;
    return piIp.toString();
  }
  if (piIpKnown) {         // mDNS didn't answer: the last address is still the best guess
    piIpFails = 0;
    return piIp.toString();
  }
  Serial.println("[WS] mDNS lookup failed; trying the name as it is");
  return String(PI_HOSTNAME);
}

void wsConnect() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WS] WiFi not connected, skipping wsConnect");
    return;
  }
  String host = piAddress();
  Serial.printf("[WS] Connecting to ws://%s:%d%s\n", host.c_str(), PI_WS_PORT, PI_WS_PATH);
  if (!client.connect(host, PI_WS_PORT, PI_WS_PATH)) {
    if (piIpKnown) piIpFails++;
    Serial.println("[WS] The Pi didn't answer");
  }
}

// Every 30 s, how the clock is doing, for the LUMO page in Sage.
static void sendStatus() {
  static unsigned long lastStatus = 0;
  if (!isConnected || !statePtr || !statePtr->paired) return;
  if (lastStatus && millis() - lastStatus < 30000) return;
  lastStatus = millis();
  char json[256];
  snprintf(json, sizeof(json),
           "{\"evt\":\"STATUS\",\"ip\":\"%s\",\"rssi\":%d,\"uptime\":%lu,\"heap\":%u,\"ssid\":\"%.32s\",\"rtt\":%d,\"wifiDrops\":%u}",
           WiFi.localIP().toString().c_str(), (int)WiFi.RSSI(), millis() / 1000UL,
           (unsigned)ESP.getFreeHeap(), WiFi.SSID().c_str(), rttMs, (unsigned)wifiDrops);
  client.send(json);
}

// The router dropped the clock, or the clock lost the router: join again,
// and if that doesn't take, restart the radio. The ESP32 retries on its own
// too, but it can get stuck after the router restarts.
static void wifiWatch() {
  static unsigned long lostAt = 0, lastJoin = 0, lastReset = 0;
  unsigned long now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    if (lostAt) Serial.printf("[WiFi] Back after %lu s\n", (now - lostAt) / 1000UL);
    lostAt = 0;
    return;
  }
  if (!lostAt) {
    lostAt = lastJoin = lastReset = now;
    wifiDrops++;
    Serial.println("[WiFi] Lost the network");
    if (isConnected) {
      linkDown("Wi-Fi lost");
      client.close();
    }
    return;
  }
  if (now - lastReset > WIFI_RESET_MS) {
    Serial.println("[WiFi] Still gone; restarting the radio");
    lastReset = lastJoin = now;
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  } else if (now - lastJoin > WIFI_REJOIN_MS) {
    Serial.println("[WiFi] Joining again");
    lastJoin = now;
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}

void wsPoll() {
  wifiWatch();
  client.poll();
  sendStatus();

  unsigned long now = millis();
  if (isConnected) {
    bool paired = statePtr && statePtr->paired;
    if (now - lastHeard > LINK_DEAD_MS) {
      linkDown("no reply to pings");
      client.close();
    } else if (!paired && now - openedAt > LINK_HELLO_MS) {
      linkDown("no answer to the pairing code");
      client.close();
    } else if (now - lastPingSent >= LINK_PING_MS) {
      lastPingSent = now;
      client.ping();
    }
    return;
  }

  if (WiFi.status() == WL_CONNECTED && (int32_t)(now - nextTryAt) >= 0) {
    Serial.printf("[WS] Reconnecting (next wait: %lu ms)...\n", retryMs);
    wsConnect();
    if (!isConnected) {
      // Wait longer each time, with a little randomness so a clock and a
      // restarting Pi don't keep missing each other.
      retryMs = min(retryMs * 2, (unsigned long)LINK_RETRY_MAX_MS);
      nextTryAt = millis() + retryMs * 3 / 4 + random(retryMs / 2 + 1);
    }
  }
}

bool wsConnected() {
  return isConnected;
}

unsigned long wsDownFor() {
  return downSince ? millis() - downSince : 0;
}

void wsSend(const char* json) {
  if (isConnected) {
    client.send(json);
  }
}

void wsReportOffline(const char* action, int h, int m) {
  if (isConnected && statePtr && statePtr->paired) {
    char json[96];
    if (h >= 0) snprintf(json, sizeof(json), "{\"evt\":\"OFFLINE\",\"a\":\"%s\",\"h\":%d,\"m\":%d,\"ago\":0}", action, h, m);
    else snprintf(json, sizeof(json), "{\"evt\":\"OFFLINE\",\"a\":\"%s\",\"ago\":0}", action);
    client.send(json);
    return;
  }
  if (pendingCount == sizeof(pending) / sizeof(pending[0])) {   // keep the newest
    memmove(pending, pending + 1, sizeof(pending) - sizeof(pending[0]));
    pendingCount--;
  }
  OfflineReport& r = pending[pendingCount++];
  strlcpy(r.a, action, sizeof(r.a));
  r.h = h; r.m = m; r.at = millis();
}
