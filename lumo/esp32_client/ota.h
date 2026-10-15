#pragma once
#include <Arduino.h>

// Updates over Wi-Fi. When a firmware change is merged on GitHub, GitHub
// builds it (.github/workflows/lumo-firmware.yml), Sage on the Pi downloads
// it (raspberry_pi/desk/ota.py) and sends OTA with where to fetch it on the
// Pi. LUMO then shows "Updating", downloads it, checks its MD5, writes it to
// the spare app partition and restarts into it. A download that fails or
// doesn't check out leaves the running firmware as it was.

// Sage asked for an update (from the OTA command); it starts from loop().
void otaRequest(const char* url, const char* version);
// Runs a requested update. Returns only if there was none (false) or it
// failed (true: the screen needs drawing again).
bool otaPoll();
// Why the last update failed ("" if it didn't), told to Sage in the next HELLO.
const char* otaLastError();
