#pragma once
#include <Arduino.h>

// The frame meter (2.18): how smoothly the screen runs, told to Sage in every
// STATUS so changes to the drawing can be judged by numbers, not by eye.
//
// A frame is a pass of loop() that sent pixels to the panel (FitTFT counts
// them). Its time is that pass's work, start to end. A stall is the longest
// gap between two passes: the screen can't move during one.
void perfLoopStart();
void perfLoopEnd();
// {"fps":..,"peakFps":..,"frameMs":..,"worstMs":..,"stallMs":..} since the
// last report, then starts a new window.
void perfReport(char* out, size_t size);
