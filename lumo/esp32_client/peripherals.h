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
void     neoSetSleep(bool sleeping);                  // sleep schedule: AUTO glow drops to a whisper
void     neoSetAlarm(bool ringing);
void     neoSetVoice(VoiceFx fx, float level);
void     neoPing(uint8_t r, uint8_t g, uint8_t b);    // two soft pulses, e.g. a notification
void     neoClear();

Button   readButton();
void     hapticPulse(uint16_t ms);
void     hapticOff();
void     hapticUpdate();
