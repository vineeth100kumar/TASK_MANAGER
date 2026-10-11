#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "config.h"
#include "peripherals.h"
#include "display.h"
#include "ws_client.h"
#include "clockkeeper.h"
#include "store.h"
#include "faces.h"

static LumoState lumoState;
static ScreenMode currentScreen = SCREEN_CONNECTING;
// Where to go back to after a card or a ringing alarm.
static ScreenMode returnScreen = SCREEN_CLOCK;

void switchScreen(ScreenMode next) {
  currentScreen = next;
  neoSetClockScreen(next == SCREEN_CLOCK);
  displayDrawScreen(next, lumoState, true);
}

static const char* buttonName(Button b) {
  switch (b) {
    case BTN_OK:      return "OK";
    case BTN_UP:      return "UP";
    case BTN_DOWN:    return "DOWN";
    case BTN_LEFT:    return "LEFT";
    case BTN_RIGHT:   return "RIGHT";
    case BTN_HOLD_OK: return "HOLD_OK";
    default:          return "";
  }
}

static bool talkingToSage() {
  return wsConnected() && lumoState.paired;
}

// A card (reminder or notification) is up: one with actions until it is
// answered, a plain one for 4.5 s.
static bool cardShowing() {
  const LumoState& s = lumoState;
  bool hasActions = s.act_left[0] || s.act_ok[0] || s.act_right[0];
  return s.notif_active && (hasActions || millis() - s.notif_start < 4500);
}

// ---------------------------------------------------------------------
//  Offline alarms. Sage rings alarms itself and sends the next day's to
//  the clock (ALARMS); the clock rings them only while it can't reach Sage,
//  stops on any button (RIGHT snoozes) and gives up after 10 minutes.
// ---------------------------------------------------------------------
static int lastAlarmMinute = -1;
static unsigned long localRingStart = 0;
static bool snoozeSet = false;
static LocalAlarm snoozeAt;

static void localAlarmTick() {
  LumoState& s = lumoState;
  ClockNow c = clockNow();
  if (!c.synced) return;   // no idea what time it is yet

  if (s.local_ringing) {
    if (millis() - localRingStart > LOCAL_RING_MINUTES * 60000UL) {
      Serial.println("[ALARM] Nobody answered; stopping");
      s.local_ringing = false;
      s.alarm_ringing = false;
    }
    return;
  }

  int minute = c.h * 60 + c.m;
  if (minute == lastAlarmMinute || talkingToSage() || s.alarm_ringing) return;
  bool due = snoozeSet && snoozeAt.h == c.h && snoozeAt.m == c.m;
  for (uint8_t i = 0; i < s.local_alarm_count && !due; i++) {
    due = s.local_alarms[i].h == c.h && s.local_alarms[i].m == c.m;
  }
  if (!due) return;
  lastAlarmMinute = minute;
  snoozeSet = false;
  Serial.printf("[ALARM] %02d:%02d, ringing without Sage\n", c.h, c.m);
  s.local_ringing = true;
  s.alarm_ringing = true;
  localRingStart = millis();
}

static void localAlarmButton(Button b) {
  LumoState& s = lumoState;
  s.local_ringing = false;
  s.alarm_ringing = false;
  if (b == BTN_RIGHT) {
    ClockNow c = clockNow();
    int at = (c.h * 60 + c.m + s.snooze_minutes) % 1440;
    snoozeAt = { (uint8_t)(at / 60), (uint8_t)(at % 60) };
    snoozeSet = true;
    Serial.printf("[ALARM] Snoozed to %02d:%02d\n", snoozeAt.h, snoozeAt.m);
  }
}

// ---------------------------------------------------------------------
//  The timer runs out here, on the millisecond, even if Sage's word that
//  it's done is late or never comes. It takes the screen (an alarm still
//  comes first) and chirps until a button, Sage or a minute stops it.
// ---------------------------------------------------------------------
static bool timerTookScreen = false;
static unsigned long timerDoneAt = 0;

static void timerTick() {
  LumoState& s = lumoState;
  if (s.tm_state == TOOL_RUNNING && (int32_t)(millis() - s.tm_end) >= 0) {
    s.tm_state = TOOL_DONE;
    s.flag_tools_changed = true;
  }
  if (s.tm_state == TOOL_DONE) {
    if (!timerDoneAt) timerDoneAt = millis();
    if (millis() - timerDoneAt > 60000UL) {   // nobody answered
      s.tm_state = TOOL_IDLE;
      s.flag_tools_changed = true;
    }
  } else {
    timerDoneAt = 0;
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== LUMO Firmware v" FW_VERSION " Starting ===");

  storeLoad(lumoState);
  hapticInit(lumoState.haptic_strength);
  initNeoPixels();
  displayInit();

  tft.setFont(NULL);
  tft.setTextSize(2);
  tft.setTextColor(0xFFFF);
  tft.setCursor(20, 100);
  tft.print("Connecting to Wi-Fi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET, NTP_SERVER1, NTP_SERVER2);
    WiFi.setSleep(false);
  } else {
    Serial.println("[WiFi] Connection failed, continuing offline...");
  }

  wsInit(lumoState);
  wsConnect();

  currentScreen = SCREEN_CONNECTING;
  displayDrawScreen(SCREEN_CONNECTING, lumoState, true);
}

void loop() {
  wsPoll();
  hapticUpdate();
  neoSetContext(currentScreen, lumoState);   // the ring's AUTO scene follows the screen and face
  neoTick();

  // The ESP32 keeps its own time between Pi updates, so every screen's clock stays live.
  ClockNow clk = clockNow();
  if (clk.synced) {
    lumoState.h = clk.h;
    lumoState.m = clk.m;
  }

  localAlarmTick();
  timerTick();

  Button btn = readButton();
  if (btn != BTN_NONE) {
    if (lumoState.hap_buttons) hapticPlay(btn == BTN_HOLD_OK ? HAP_HOLD : HAP_TICK);
    if (lumoState.tm_state == TOOL_DONE && !lumoState.alarm_ringing) {
      // Any button stops a finished timer; Sage hears it too and agrees.
      lumoState.tm_state = TOOL_IDLE;
      lumoState.flag_tools_changed = true;
    }
    if (lumoState.local_ringing) {
      localAlarmButton(btn);   // Sage isn't there to decide
    } else {
      char json[64];
      snprintf(json, sizeof(json), "{\"evt\":\"BTN\",\"btn\":\"%s\"}", buttonName(btn));
      wsSend(json);
    }
  }

  // Leave the connecting screen once Sage has accepted the pairing code.
  if (currentScreen == SCREEN_CONNECTING && talkingToSage()) {
    switchScreen(SCREEN_CLOCK);
  }
  // Sage said no: show why on the connecting screen.
  static bool shownRefused = false;
  if (currentScreen == SCREEN_CONNECTING && lumoState.pair_refused != shownRefused) {
    shownRefused = lumoState.pair_refused;
    displayDrawScreen(SCREEN_CONNECTING, lumoState, true);
  }

  // A ringing alarm (Sage's or the clock's own) takes the screen; afterwards,
  // back to what was there.
  bool timerDone = lumoState.tm_state == TOOL_DONE;
  neoSetAlarm(lumoState.alarm_ringing || timerDone);
  if (lumoState.alarm_ringing && currentScreen != SCREEN_ALARM) {
    if (currentScreen != SCREEN_CARD && currentScreen != SCREEN_CONNECTING) returnScreen = currentScreen;
    switchScreen(SCREEN_ALARM);
  } else if (!lumoState.alarm_ringing && currentScreen == SCREEN_ALARM) {
    switchScreen(returnScreen);
  }

  // A finished timer shows itself; when it's answered, back to what was there.
  if (timerDone && !lumoState.alarm_ringing && currentScreen != SCREEN_TIMER &&
      currentScreen != SCREEN_ALARM && currentScreen != SCREEN_CONNECTING) {
    if (currentScreen != SCREEN_CARD) returnScreen = currentScreen;
    timerTookScreen = true;
    switchScreen(SCREEN_TIMER);
  } else if (!timerDone && timerTookScreen && currentScreen == SCREEN_TIMER) {
    timerTookScreen = false;
    switchScreen(returnScreen);
  }
  if (currentScreen != SCREEN_TIMER) timerTookScreen = false;

  // Sage asked for a screen. Under a card or an alarm, it's where they return to.
  if (lumoState.flag_screen_switch) {
    lumoState.flag_screen_switch = false;
    if (currentScreen == SCREEN_CARD || currentScreen == SCREEN_ALARM) returnScreen = lumoState.next_screen;
    else switchScreen(lumoState.next_screen);
  }

  // Cards show over any screen and go back to it when done.
  bool card = cardShowing();
  if (card && currentScreen != SCREEN_CARD && currentScreen != SCREEN_ALARM && currentScreen != SCREEN_CONNECTING) {
    returnScreen = currentScreen;
    lumoState.flag_card_changed = false;
    switchScreen(SCREEN_CARD);
  } else if (currentScreen == SCREEN_CARD && !card) {
    lumoState.notif_active = false;
    switchScreen(returnScreen);
  } else if (currentScreen == SCREEN_CARD && lumoState.flag_card_changed) {
    lumoState.flag_card_changed = false;
    displayDrawScreen(SCREEN_CARD, lumoState, true);
  }

  // A ringing alarm sounds the tone chosen for it in Sage (the light beats
  // with it) and stops the moment the alarm screen goes; a finished timer
  // chirps. 0 nothing, 1 the alarm, 2 the timer.
  static uint8_t sounding = 0;
  uint8_t want = currentScreen == SCREEN_ALARM ? 1 : (timerDone && currentScreen == SCREEN_TIMER) ? 2 : 0;
  if (want != sounding) {
    sounding = want;
    if (want == 1) hapticRing(lumoState.alarm_tone, lumoState.alarm_volume);
    else if (want == 2) hapticRing(TONE_CHIRP, lumoState.alarm_volume);
    else hapticOff();
  }

  // Screen-specific updates
  if (currentScreen == SCREEN_CLOCK) {
    if (lumoState.flag_clock_changed) {   // a new style from Sage: start over
      lumoState.flag_clock_changed = false;
      displayDrawScreen(SCREEN_CLOCK, lumoState, true);
    }
    displayClockTick(lumoState);
  }
  else if (currentScreen == SCREEN_SYSTEM) {
    if (lumoState.flag_system_changed) {
      lumoState.flag_system_changed = false;
      displayDrawScreen(SCREEN_SYSTEM, lumoState, false);
    }
  }
  else if (currentScreen == SCREEN_SPOTIFY) {
    static unsigned long lastProgressTick = 0;
    if (lumoState.sp_playing && millis() - lastProgressTick >= 500) {
      lastProgressTick = millis();
      lumoState.sp_progress_ms = min(lumoState.sp_progress_ms + 500, lumoState.sp_duration_ms);
      displayDrawScreen(SCREEN_SPOTIFY, lumoState, false);
    }
    if (lumoState.flag_spotify_changed || newArtReady) {
      lumoState.flag_spotify_changed = false;
      displayDrawScreen(SCREEN_SPOTIFY, lumoState, false);
    }
    displaySpotifyTick(lumoState);
  }
  else if (currentScreen == SCREEN_TASKS) {
    if (lumoState.flag_tasks_changed) {
      lumoState.flag_tasks_changed = false;
      displayDrawScreen(SCREEN_TASKS, lumoState, false);
    }
  }
  else if (currentScreen == SCREEN_ALARM) {
    displayAlarmTick(lumoState);
  }
  else if (currentScreen == SCREEN_CONNECTING) {
    displayConnectingTick(lumoState);
  }
  else if (currentScreen == SCREEN_TIMER || currentScreen == SCREEN_STOPWATCH || currentScreen == SCREEN_WORLD) {
    if (lumoState.flag_tools_changed) {
      lumoState.flag_tools_changed = false;
      // The World screen's rows move when places come or go: start afresh.
      if (currentScreen == SCREEN_WORLD) displayDrawScreen(SCREEN_WORLD, lumoState, true);
      else toolScreenReset();
    }
    toolScreenTick(currentScreen, lumoState);
  }
  else if (currentScreen == SCREEN_MEMORY) {
    if (lumoState.flag_memory_changed) {
      lumoState.flag_memory_changed = false;
      displayDrawScreen(SCREEN_MEMORY, lumoState, false);
    }
  }

  delay(6);
}
