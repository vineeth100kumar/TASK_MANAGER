#pragma once
// Copy this file to secrets.h (same folder) and fill in your own values.
// secrets.h is gitignored; never commit real credentials.

#define WIFI_SSID    "YOUR_WIFI_SSID"
#define WIFI_PASS    "YOUR_WIFI_PASSWORD"

// The Pi's LAN IP (e.g. "192.168.1.20"). An mDNS name without ".local" also
// works if the Pi advertises one.
#define PI_HOSTNAME  "192.168.1.20"

// The six-digit pairing code Sage printed when it was installed (also in
// Sage's settings, and in desk_token.txt next to Sage's database on the Pi).
// The Pi ignores a clock that doesn't send it.
#define DESK_TOKEN   "000000"
