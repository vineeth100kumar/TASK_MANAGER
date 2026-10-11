#pragma once
#include <Arduino.h>
#include "config.h"
#include "clockkeeper.h"

// The premium clock faces (Monolith, Stacked, Nightstand, Dial), drawn with
// smooth text from aa_text. The classic styles stay in display.cpp.
bool faceIsPremium(ClockStyle style);
void faceReset();                                          // redraw everything next tick
void faceTick(const LumoState& s, const ClockNow& c);      // called every loop on the clock screen

// The music screen (Now Playing), drawn the same way.
void nowPlayingReset();                                    // start over (fade in) next tick
void nowPlayingTick(const LumoState& s);                   // every loop on that screen; ~30 fps
