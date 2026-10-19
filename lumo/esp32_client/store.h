#pragma once
#include <Arduino.h>
#include "config.h"

// What the clock keeps in flash across restarts: how to show the time and
// the next day's alarms (with their days), the UTC offset and the haptic strength, all as Sage last sent them. ws_client.cpp saves
// only when a value changed, so the once-a-minute CLOCK costs no flash wear.
void storeLoad(LumoState& s);
void storeSaveClock(const LumoState& s);
void storeLoadFit(ScreenFit& f);
void storeSaveFit(const ScreenFit& f);
void storeSaveAlarms(const LumoState& s);
void storeSaveHaptics(const LumoState& s);

// The Wi-Fi name and password, the Pi's address and the pairing code. A build
// with secrets.h uses its values and saves them; a build without (an update
// over Wi-Fi) uses the saved ones. Call before joining Wi-Fi.
extern char netSsid[33];
extern char netPass[65];
extern char netHost[64];
extern char netToken[16];
void storeNetLoad();
