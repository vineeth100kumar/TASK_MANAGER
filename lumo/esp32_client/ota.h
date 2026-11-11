#pragma once
#include <Arduino.h>

// Updates over Wi-Fi. When a firmware change is merged on GitHub, GitHub
// builds it (.github/workflows/lumo-firmware.yml), Sage on the Pi downloads
// it (raspberry_pi/desk/ota.py) and sends OTA with where to fetch it on the
// Pi. LUMO then shows "Updating", downloads it, checks its MD5, writes it to
// the spare app partition and restarts into it. A download that fails or
// doesn't check out leaves the running firmware as it was.
//
// Trial boot (2.18): a new version starts "on trial". It keeps itself only
// once the screen has answered, Sage has accepted its HELLO and it has run
// OTA_TRIAL_KEEP_MS without restarting. Otherwise LUMO goes back to the
// version it came from (still in the other slot) and tells Sage why.

// Sage asked for an update (from the OTA command); it starts from loop().
void otaRequest(const char* url, const char* version);
// Runs a requested update. Returns only if there was none (false) or it
// failed (true: the screen needs drawing again).
bool otaPoll();
// Why the last update failed, or why the last version was sent back ("" if
// neither), told to Sage in the next HELLO.
const char* otaLastError();

// Call once from setup(), after displayInit(): starts the trial if this is
// the first start of a new version, and checks the screen answers.
void otaTrialBegin();
// Every loop: keeps the new version once its checks pass, or goes back.
void otaTrialTick(bool paired);
// Running a new version that hasn't been kept yet.
bool otaOnTrial();
