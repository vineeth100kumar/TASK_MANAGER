#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "config.h"

// The panel, with an optional squeeze (2.17): while `fit` is on, every
// drawing call's x is mapped from the 320-column design into fx0..fx0+fw, so
// screens drawn for the whole panel land inside the case window (or the Even
// Frame's card). The smooth clock faces place themselves (fitCard) and draw
// with it off; displayFitFor() picks per screen.
class FitTFT : public Adafruit_ILI9341 {
 public:
  FitTFT(int8_t cs, int8_t dc) : Adafruit_ILI9341(cs, dc) {}
  bool fit = false;
  int16_t fx0 = 0, fw = 320;
  int16_t mx(int16_t x) const { return fx0 + (int16_t)((int32_t)x * fw / 320); }

  void drawPixel(int16_t x, int16_t y, uint16_t c) override { Adafruit_ILI9341::drawPixel(fit ? mx(x) : x, y, c); }
  void writePixel(int16_t x, int16_t y, uint16_t c) override { Adafruit_ILI9341::writePixel(fit ? mx(x) : x, y, c); }
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) override {
    if (fit) span(x, w);
    Adafruit_ILI9341::fillRect(x, y, w, h, c);
  }
  void writeFillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) override {
    if (fit) span(x, w);
    Adafruit_ILI9341::writeFillRect(x, y, w, h, c);
  }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    if (fit) span(x, w);
    Adafruit_ILI9341::drawFastHLine(x, y, w, c);
  }
  void writeFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    if (fit) span(x, w);
    Adafruit_ILI9341::writeFastHLine(x, y, w, c);
  }
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override { Adafruit_ILI9341::drawFastVLine(fit ? mx(x) : x, y, h, c); }
  void writeFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override { Adafruit_ILI9341::writeFastVLine(fit ? mx(x) : x, y, h, c); }
  void drawRGBBitmap(int16_t x, int16_t y, uint16_t* px, int16_t w, int16_t h) { bitmap(x, y, px, w, h); }
  void drawRGBBitmap(int16_t x, int16_t y, const uint16_t* px, int16_t w, int16_t h) { bitmap(x, y, (uint16_t*)px, w, h); }

 private:
  void span(int16_t& x, int16_t& w) const {
    if (w < 0) { x += w + 1; w = -w; }
    int16_t a = mx(x), b = mx(x + w);
    x = a; w = b > a ? b - a : 1;
  }
  // Each row resampled to its squeezed width (nearest column).
  void bitmap(int16_t x, int16_t y, uint16_t* px, int16_t w, int16_t h) {
    if (!fit) { Adafruit_ILI9341::drawRGBBitmap(x, y, px, w, h); return; }
    static uint16_t line[320];
    int16_t a = mx(x), ow = mx(x + w) - a;
    if (ow <= 0 || w <= 0) return;
    if (ow > 320) ow = 320;
    for (int16_t r = 0; r < h; r++) {
      for (int16_t i = 0; i < ow; i++) {
        int32_t si = ((int32_t)(a + i - fx0) * 320 + fw / 2) / fw - x;
        line[i] = px[r * w + (si < 0 ? 0 : si >= w ? w - 1 : si)];
      }
      Adafruit_ILI9341::drawRGBBitmap(a, y + r, line, ow, 1);
    }
  }
};
extern FitTFT tft;
void displayFitApply(bool on);   // squeeze drawing into the window (or the card)

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
