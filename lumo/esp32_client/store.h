#pragma once
#include <Arduino.h>
#include "config.h"

// What the clock keeps in flash across restarts: how to show the time and
// the next day's alarms, both as Sage last sent them. ws_client.cpp saves
// only when a value changed, so the once-a-minute CLOCK costs no flash wear.
void storeLoad(LumoState& s);
void storeSaveClock(const LumoState& s);
void storeSaveAlarms(const LumoState& s);
