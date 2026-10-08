#pragma once
#include <Arduino.h>

// ===================== PINS =====================
#define TFT_CS        8
#define TFT_DC        7
#define BUTTON_PIN    1
#define BUZZER_PIN    9    // Active-LOW haptic/buzzer
#define NEOPIXEL_PIN  10
#define NUMPIXELS     6

// ===================== WIFI + PI SERVER =====================
// The Wi-Fi name, password and the Pi's address live in secrets.h, which is
// gitignored so they never end up in the repository again. Copy
// secrets.example.h to secrets.h and fill it in before flashing.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing esp32_client/secrets.h: copy secrets.example.h to secrets.h and set your Wi-Fi details."
#endif

#ifndef DESK_TOKEN
#error "Add DESK_TOKEN to secrets.h (see secrets.example.h): the pairing code from Sage on the Pi."
#endif

// ===================== PI SERVER =====================
#define PI_WS_PORT   8765
#define PI_WS_PATH   "/"

// ===================== NTP / TIMEZONE =====================
#define GMT_OFFSET_SEC  (5 * 3600 + 30 * 60)
#define DAYLIGHT_OFFSET 0
#define NTP_SERVER1     "pool.ntp.org"
#define NTP_SERVER2     "time.nist.gov"

// ===================== HAPTICS =====================
#define HAPTIC_FREQ  50000
#define HAPTIC_RES   8

// ===================== BUTTON VOLTAGE THRESHOLDS =====================
#define V_OK    0.15f
#define V_UP    0.60f
#define V_DOWN  0.22f
#define V_LEFT  3.30f
#define V_RIGHT 0.33f
#define V_TOL   0.05f

// ===================== FIRMWARE =====================
#define FW_VERSION "2.0.0"

// ===================== ENUMS =====================
// BTN_HOLD_OK is OK held for HOLD_OK_MS; a shorter press is BTN_OK on release.
#define HOLD_OK_MS 800
enum Button       { BTN_NONE, BTN_OK, BTN_UP, BTN_DOWN, BTN_LEFT, BTN_RIGHT, BTN_HOLD_OK };
// SCREEN_CARD shows a reminder or notification over whatever was on screen,
// and goes back to it when the card is answered or times out.
enum ScreenMode   { SCREEN_CLOCK, SCREEN_SYSTEM, SCREEN_SPOTIFY, SCREEN_TASKS, SCREEN_ALARM, SCREEN_CONNECTING, SCREEN_MEMORY, SCREEN_CARD };
enum NeoMode      { NEO_WARM, NEO_COLOR, NEO_BREATHE, NEO_OFF, NEO_ALARM, NEO_AUTO, NEO_AURORA, NEO_COMET };
// How the clock screen shows the time (set in Sage, kept in flash).
enum ClockStyle   { CLOCK_DIGITAL, CLOCK_MINIMAL, CLOCK_ANALOG };

// Alarms the clock rings by itself while it can't reach Sage.
#define MAX_LOCAL_ALARMS 4
#define LOCAL_RING_MINUTES 10
struct LocalAlarm { uint8_t h, m; };

// ===================== CENTRAL STATE STRUCT =====================
struct LumoState {
  uint8_t  h = 0, m = 0;
  char     weekday[8] = "---";
  char     date[12]   = "--";
  float    temp_c = 0.0f;
  char     weather_icon[12] = "clear";
  char     sp_title[64]  = "";
  char     sp_artist[64] = "";
  uint32_t sp_progress_ms = 0;
  uint32_t sp_duration_ms = 0;
  bool     sp_playing = false;
  NeoMode  neo_mode       = NEO_AUTO;
  uint8_t  neo_brightness = 40;
  uint16_t neo_hue        = 0;
  char    tasks[5][96];
  uint8_t task_count = 0;
  bool    alarm_ringing = false;
  uint8_t alarm_h = 7, alarm_m = 0;
  bool    alarm_set = false;   // true when the Pi reports an upcoming alarm

  // The next day's alarms from Sage (ALARMS), rung here only while Sage is
  // out of reach; local_ringing says this ring is the clock's own.
  LocalAlarm local_alarms[MAX_LOCAL_ALARMS];
  uint8_t    local_alarm_count = 0;
  uint8_t    snooze_minutes    = 5;
  bool       local_ringing     = false;

  // How to show the time (from CLOCK).
  ClockStyle clock_style   = CLOCK_DIGITAL;
  bool       hour24        = false;
  bool       show_seconds  = true;
  char       zone2[16]     = "";     // a second time zone's name, "" for none
  int16_t    zone2_offset  = 0;      // its minutes ahead of local time

  // Pi 5 System Vitals
  float   cpu_temp = 0.0f;
  uint8_t cpu_pct  = 0;
  uint8_t ram_pct  = 0;
  uint8_t disk_pct = 0;

  // Phone Notifications Overlay
  bool          notif_active = false;
  // Labels for LEFT, OK and RIGHT under the card (ACTIONS from the Pi). While
  // any is set the card stays up; the Pi decides what the presses do.
  char          act_left[12]  = "";
  char          act_ok[12]    = "";
  char          act_right[12] = "";

  // Pairing: false until the Pi accepts DESK_TOKEN; refused after it says no.
  bool          paired = false;
  bool          pair_refused = false;
  char          notif_app[20]   = "";
  char          notif_title[28] = "";
  char          notif_body[64]  = "";
  unsigned long notif_start     = 0;

  // JARVIS Voice Companion State
  char          voice_state[16]    = "IDLE";
  char          voice_subtitle[48] = "";
  float         voice_volume       = 0.0f;

  // Memories Photo Frame
  char          mem_caption[24]    = "";

  // Dirty flags
  bool       flag_spotify_changed = false;
  bool       flag_tasks_changed   = false;
  bool       flag_system_changed  = false;
  bool       flag_card_changed    = false;
  bool       flag_clock_changed   = false;
  bool       flag_screen_switch   = false;
  bool       flag_voice_changed   = false;
  bool       flag_memory_changed  = false;
  ScreenMode next_screen          = SCREEN_CLOCK;
};
