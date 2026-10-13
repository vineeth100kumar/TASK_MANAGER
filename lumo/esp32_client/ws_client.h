#pragma once
#include <Arduino.h>
#include "config.h"

void wsInit(LumoState& state);
void wsConnect();
void wsPoll();
bool wsConnected();
void wsSend(const char* json);
// How long Sage has been out of reach, in ms; 0 while it's there.
unsigned long wsDownFor();
// Something the clock did alone while Sage was away: "stop", "snooze" or
// "timeout" for an alarm it rang at h:m, "timer_stop" (h -1) for a finished
// timer. Sent at once if Sage is there, otherwise with the next HELLO.
void wsReportOffline(const char* action, int h, int m);
