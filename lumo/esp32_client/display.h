#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "config.h"

extern Adafruit_ILI9341 tft;

// The rows the case window shows (see SCREEN_HIDDEN_* in config.h).
static constexpr int VIS_T = SCREEN_HIDDEN_TOP;
static constexpr int VIS_B = 240 - SCREEN_HIDDEN_BOTTOM;
static constexpr int VIS_H = VIS_B - VIS_T;
extern uint8_t artBuf[20004];
extern bool newArtReady;

void displayInit();
void displayDrawScreen(ScreenMode mode, const LumoState& s, bool forceFullRedraw);
void displayClockTick(const LumoState& s);
void displayAlarmTick(const LumoState& s);
void displayAlarmReset();
void displayConnectingTick(const LumoState& s);
void displayConnectingReset();
void displaySpotifyTick(const LumoState& s);              // the level bars, ~25 fps
void displayArtTint(uint8_t& r, uint8_t& g, uint8_t& b); // the cover's colour, for the light ring
void drawProgressBar(int x, int y, int w, int h, float pct, uint16_t fillColor, uint16_t bgColor);
void onNewArt(const uint8_t* data, size_t len);
void onNewMemoryStrip(const uint8_t* data, size_t len);
void onDepthStrip(const uint8_t* data, size_t len);      // the depth face's picture, from the Pi
