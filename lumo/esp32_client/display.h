#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "config.h"

extern Adafruit_ILI9341 tft;

// What the case window shows (ScreenFit in config.h; set from Sage, kept in flash).
extern ScreenFit screenFit;
#define VIS_T (screenFit.t)
#define VIS_B (240 - screenFit.b)
#define VIS_H (VIS_B - VIS_T)
// The card the clock faces draw on: the window's rows, full width. With the
// Even Frame on it is smaller, inside a black frame on three sides; the right
// side is the bare glass past the panel's last column.
static inline FitCard fitCard() {
  if (!screenFit.frame) return { 0, VIS_T, 320, VIS_H };
  int x = screenFit.l + FRAME_SIDE, y = screenFit.t + FRAME_VERT;
  return { x, y, 320 - screenFit.r - x, VIS_B - FRAME_VERT - y };
}
extern uint8_t artBuf[20004];
extern bool newArtReady;
extern uint16_t artSerial;    // counts covers received, so a face can tell when it changed

void displayInit();
void displayDrawScreen(ScreenMode mode, const LumoState& s, bool forceFullRedraw);
void displayClockTick(const LumoState& s);
void displayAlarmTick(const LumoState& s);
void displayAlarmReset();
void displayConnectingTick(const LumoState& s);
void displayConnectingReset();
void displaySpotifyTick(const LumoState& s);              // the level bars, ~25 fps
void displayArtTint(uint8_t& r, uint8_t& g, uint8_t& b); // the cover's colour, for the light ring
// Updating over Wi-Fi (ota.cpp): pct 0-100, or -1 with why it failed.
void displayUpdateScreen(const char* version, int pct, const char* error);
void drawProgressBar(int x, int y, int w, int h, float pct, uint16_t fillColor, uint16_t bgColor);
void onNewArt(const uint8_t* data, size_t len);
void onNewMemoryStrip(const uint8_t* data, size_t len);
void onDepthStrip(const uint8_t* data, size_t len);      // the depth face's picture, from the Pi
