#pragma once
#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"

extern Adafruit_NeoPixel pixels;

enum VoiceFx { VFX_NONE, VFX_LISTEN, VFX_THINK, VFX_SPEAK };

void     initNeoPixels();
void     neoTick();                                   // call every loop; self-paced to ~60 fps
void     neoSetMode(NeoMode mode, uint8_t brightness, uint16_t hue);
void     applyNeoPixels(NeoMode mode, uint8_t brightness, uint16_t hue);  // alias of neoSetMode
void     neoSetClockScreen(bool onClock);             // unlocks the seconds comet and chimes
void     neoSetContext(ScreenMode screen, const LumoState& s);  // AUTO follows the screen and clock face
void     neoSetSleep(bool sleeping);                  // sleep schedule: AUTO glow drops to a whisper
void     neoSetAlarm(bool ringing);
void     neoSetVoice(VoiceFx fx, float level);
void     neoPing(uint8_t r, uint8_t g, uint8_t b);    // two soft pulses, e.g. a notification
void     neoClear();

Button   readButton();
// The haptic engine's effects, played without blocking (see peripherals.cpp).
// All are silent (motor only) except HAP_ALARM, the one audible sound.
enum Haptic { HAP_TICK, HAP_HOLD, HAP_TAP, HAP_NOTIFY, HAP_REMINDER, HAP_SUCCESS,
              HAP_WARNING, HAP_PULSE, HAP_RAMP_UP, HAP_RAMP_DOWN, HAP_HEARTBEAT, HAP_ALARM,
              HAP_COUNT };
void     hapticInit(uint8_t strength);                 // strength 0-100, 0 = silent effects off
void     hapticPlay(Haptic h);                         // HAP_ALARM loops until hapticOff()
void     hapticRing(AlarmTone tone, uint8_t volume);   // an alarm's sound, looped until hapticOff()
void     hapticPreview(AlarmTone tone, uint8_t volume, uint16_t seconds, bool once);   // one cycle, or a few seconds
AlarmTone hapticToneNamed(const char* name, AlarmTone fallback);   // "pulse", "chime"... (tones.h)
bool     hapticPlayNamed(const char* name);            // "tick", "notify", "pulse"...; false if unknown
void     hapticPulse(uint16_t ms);
void     hapticSetStrength(uint8_t pct);
uint8_t  hapticStrength();
void     hapticOff();
void     hapticSelfTest();                             // full-power 300 ms buzz, from the serial monitor
void     hapticUpdate();                               // a fallback; the engine runs on its own timer
