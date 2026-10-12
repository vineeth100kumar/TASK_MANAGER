#pragma once
#include <Arduino.h>

// ===================== PINS =====================
#define TFT_CS        8
#define TFT_DC        7
#define BUTTON_PIN    1
#define BUZZER_PIN    9    // Active LOW (BC557): buzzer + vibration motor in parallel, see HAPTICS
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
// BUZZER_PIN (GPIO9) drives a BC557 through R1. The BC557 is a PNP: emitter on
// 3V3, so pin LOW = on. Its collector feeds the vibration motor directly and
// the buzzer through C1 (1 nF), both returning to GND. There is no flyback
// diode across the motor.
//
// What that means:
//  - The motor needs the transistor held fully on. PWM at any duty below 100%
//    cuts the motor's current on every off edge (nowhere for it to flow
//    without a diode), so even 87% at 50 kHz barely moves it. That is why
//    2.7.0/2.7.1 went quiet AND still.
//  - The buzzer only hears changes (C1 blocks DC). A pin held steady, on or
//    off, is silent. The audible part was the PWM off-time, when the
//    floating collector passes the motor's brush noise through C1.
// On hardware (2.8.1), fully on (DC) runs the motor but the buzzer is heard
// too. So each knock is now "on" at HAPTIC_ON_DUTY on a fast HAPTIC_FREQ
// carrier: high enough that the buzzer can't follow, and on enough that the
// motor still spins. Strength sets how long. Only the alarm uses a tone.
// Find the best pair live from the serial monitor (115200 baud):
//   hz 80000    change the carrier        duty 90   change the on-duty (%)
//   tick / knock / buzz   try an effect   haptic    show the settings
// then put the pair that feels right and stays quiet here.
// If you fit a diode (1N4148 or SS14) across the motor, set HAPTIC_MOTOR_DC
// to 0 to get smooth PWM strength instead.
#define HAPTIC_MOTOR_DC    1      // 1 = knocks at a fixed on-duty (this board); 0 = smooth PWM (needs a flyback diode)
#define HAPTIC_FREQ        80000  // knock carrier; higher = less buzzer (try 50000-150000)
#define HAPTIC_ON_DUTY     90     // % on-time during a knock (100 = DC: strongest, but the buzzer is heard)
#define HAPTIC_RES         10     // most duty bits (fewer at high carriers: 8 bits up to ~300 kHz)
#define HAPTIC_TICK_US     100    // how often a PWM envelope moves (on/off drive uses 1 ms)
#define HAPTIC_EDGE_MS     5      // shortest rise or fall in PWM mode
#define HAPTIC_FALL_MS     10     // how a knock lets go
#define HAPTIC_MIN_DUTY    60     // PWM mode: % on-time at strength 1
#define HAPTIC_MAX_DUTY    100    // PWM mode: % on-time at strength 100
#define HAPTIC_MIN_LEN_PCT 50     // on/off mode: knock length at strength 1, % of the base length
#define HAPTIC_MAX_LEN_PCT 160    // on/off mode: knock length at strength 100
#define HAPTIC_STRENGTH    100    // default strength 0-100 until Sage sends one (0 = off)
#define HAPTIC_NIGHT_PCT   60     // notifications at night run at this % (presses don't)

// Per-effect tuning. Peaks are 0-255 of the strength above; lengths in ms.
#define HFX_TICK_PEAK      235    // every button press: one crisp tick
#define HFX_TICK_HOLD_MS   12
#define HFX_KICK_MS        6      // a tick opens at full power for this long to spin up
#define HFX_HOLD_PEAK      230    // OK held: a soft tick, then a firm one
#define HFX_KNOCK_PEAK     245    // a notification: two knocks
#define HFX_KNOCK_HOLD_MS  30
#define HFX_KNOCK_GAP_MS   120
#define HFX_REMIND_PEAK    255    // a reminder: two longer, firmer knocks
#define HFX_REMIND_HOLD_MS 55
#define HFX_REMIND_GAP_MS  150
#define HFX_PULSE_PEAK     200    // a soft swell (breath)
#define HFX_PULSE_MS       700
#define HFX_RAMP_PEAK      230    // ramp up / ramp down
#define HFX_RAMP_MS        450
#define HFX_BEAT_PEAK      230    // heartbeat "bu-bump"

// The alarm: the one sound LUMO makes.
#define ALARM_TONE_HZ      2700   // the buzzer's loudest pitch
#define ALARM_TONE_DUTY    50     // % on-time at full volume (a square wave is loudest at 50)
#define ALARM_START_PCT    25     // first beeps at this % of full volume...
#define ALARM_BUILD_MS     20000  // ...building to full over this long

// ===================== BUTTON VOLTAGE THRESHOLDS =====================
#define V_OK    0.15f
#define V_UP    0.60f
#define V_DOWN  0.22f
#define V_LEFT  3.30f
#define V_RIGHT 0.33f
#define V_TOL   0.05f

// ===================== SCREEN AREA =====================
// Rows of the 320x240 panel that the case hides. Every screen fits its layout
// into the rows that are left, so nothing ends up behind the bezel. Raise a
// number if text is still clipped on that edge; set both to 0 if the whole
// panel shows.
#define SCREEN_HIDDEN_TOP     0
#define SCREEN_HIDDEN_BOTTOM  24

// ===================== FIRMWARE =====================
#define FW_VERSION "2.8.2"

// ===================== ENUMS =====================
// BTN_HOLD_OK is OK held for HOLD_OK_MS; a shorter press is BTN_OK on release.
#define HOLD_OK_MS 800
enum Button       { BTN_NONE, BTN_OK, BTN_UP, BTN_DOWN, BTN_LEFT, BTN_RIGHT, BTN_HOLD_OK };
// SCREEN_CARD shows a reminder or notification over whatever was on screen,
// and goes back to it when the card is answered or times out.
// The timer, stopwatch and world clock screens (2.7) are drawn in faces.cpp.
enum ScreenMode   { SCREEN_CLOCK, SCREEN_SYSTEM, SCREEN_SPOTIFY, SCREEN_TASKS, SCREEN_ALARM, SCREEN_CONNECTING, SCREEN_MEMORY, SCREEN_CARD,
                    SCREEN_TIMER, SCREEN_STOPWATCH, SCREEN_WORLD };
enum NeoMode      { NEO_WARM, NEO_COLOR, NEO_BREATHE, NEO_OFF, NEO_ALARM, NEO_AUTO, NEO_AURORA, NEO_COMET };
// How the clock screen shows the time (set in Sage, kept in flash). The first
// three are the classic styles; the rest are the smooth faces in faces.cpp.
enum ClockStyle   { CLOCK_DIGITAL, CLOCK_MINIMAL, CLOCK_ANALOG,
                    CLOCK_MONOLITH, CLOCK_STACKED, CLOCK_NIGHTSTAND, CLOCK_DIAL };

// Alarms the clock rings by itself while it can't reach Sage.
#define MAX_LOCAL_ALARMS 4
#define LOCAL_RING_MINUTES 10
struct LocalAlarm { uint8_t h, m; };

// The alarm's sound, chosen per alarm in Sage (ALARM_RING's "tone").
enum AlarmTone    { TONE_PULSE, TONE_CLASSIC, TONE_RISING, TONE_CHIRP };
// The timer kept by Sage (TIMER's "state").
enum ToolState    { TOOL_IDLE, TOOL_RUNNING, TOOL_PAUSED, TOOL_DONE };
#define MAX_WORLD_CLOCKS 3
#define STOPWATCH_LAPS   4

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
  // About the song, from Sage (SONG_INFO, LYRIC). Looked up, not heard: the
  // tempo is an estimate, so the light keeps the song's pace, not its beat.
  char     sp_genre[24] = "";
  uint16_t sp_bpm = 0;
  float    sp_energy = 0.5f;
  char     sp_facts[3][100];
  uint8_t  sp_fact_count = 0;
  bool     sp_lyrics = false;     // the song has timed lyrics
  char     sp_lyric[100] = "";    // the line being sung ("" between lines)
  NeoMode  neo_mode       = NEO_AUTO;
  uint8_t  neo_brightness = 100;
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
  uint8_t    haptic_strength   = HAPTIC_STRENGTH;   // 0-100, set in Sage
  bool       local_ringing     = false;

  // How to show the time (from CLOCK).
  ClockStyle clock_style   = CLOCK_DIGITAL;
  bool       hour24        = false;
  bool       show_seconds  = true;
  char       zone2[16]     = "";     // a second time zone's name, "" for none
  int16_t    zone2_offset  = 0;      // its minutes ahead of local time

  // What the ringing alarm is called and how it sounds (ALARM_RING).
  char       alarm_label[28] = "";
  AlarmTone  alarm_tone      = TONE_PULSE;
  uint8_t    alarm_volume    = 80;     // 0..100
  // The timer and stopwatch run in Sage (TIMER, STOPWATCH); the clock counts
  // between messages from the millis() they arrived at.
  ToolState  tm_state    = TOOL_IDLE;
  uint32_t   tm_end      = 0;          // millis() when it runs out, while running
  uint32_t   tm_left_ms  = 0;          // while paused
  uint32_t   tm_total_ms = 0;
  char       tm_label[25] = "";
  bool       sw_running  = false;
  uint32_t   sw_base_ms  = 0;          // elapsed when sw_mark was taken
  uint32_t   sw_mark     = 0;
  uint32_t   sw_laps[STOPWATCH_LAPS];  // the last few laps' lengths, oldest first
  uint8_t    sw_lap_shown = 0;
  uint16_t   sw_lap_count = 0;
  // The World screen's places, as minutes ahead of the time here (WORLD).
  uint8_t    wc_count = 0;
  char       wc_name[MAX_WORLD_CLOCKS][16];
  int16_t    wc_offset[MAX_WORLD_CLOCKS];
  // Knocks for button presses and for notifications (HAPTICS), and night.
  bool       hap_buttons = true;
  bool       hap_notify  = true;
  bool       night       = false;
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
  bool       flag_tools_changed   = false;
  ScreenMode next_screen          = SCREEN_CLOCK;
};
