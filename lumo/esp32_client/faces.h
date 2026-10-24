#pragma once
#include <Arduino.h>
#include "config.h"
#include "clockkeeper.h"

// The premium clock faces (Monolith, Stacked, Nightstand, Dial), drawn with
// smooth text from aa_text. The classic styles stay in display.cpp.
bool faceIsPremium(ClockStyle style);
void faceReset();                                          // redraw everything next tick
void faceTick(const LumoState& s, const ClockNow& c);      // called every loop on the clock screen
bool faceAnimating();                                      // fading in or turning a minute over (draws on the fast beat)

// The music screen (Now Playing), drawn the same way.
void nowPlayingReset();                                    // start over (fade in) next tick
void nowPlayingTick(const LumoState& s);                   // every loop on that screen; ~30 fps
float nowPlayingBeat(const LumoState& s, float t);         // 0..1, a soft pulse at the song's tempo

// The timer, stopwatch and world clock screens (firmware 2.7), the same way.
void toolScreenReset();                                    // redraw everything next tick
void toolScreenTick(ScreenMode screen, const LumoState& s);   // every loop on one of them

// Cards (2.20): a phone notification, an incoming call or one of Sage's own,
// in the app's colour, with what LEFT, OK and RIGHT do along the bottom.
void cardDraw(const LumoState& s);                         // the whole card
void cardTick(const LumoState& s);                         // every loop on the card: a call's rings
