#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include "ota.h"
#include "config.h"
#include "display.h"
#include "peripherals.h"
#include "ws_client.h"

static char pendingUrl[160] = "";
static char pendingVersion[16] = "";
static char lastError[64] = "";
static int  lastPct = -1;

void otaRequest(const char* url, const char* version) {
  if (!url || strncmp(url, "http://", 7) != 0) return;
  strlcpy(pendingUrl, url, sizeof(pendingUrl));
  strlcpy(pendingVersion, version ? version : "", sizeof(pendingVersion));
}

const char* otaLastError() {
  return lastError;
}

static void onProgress(int done, int total) {
  int pct = total > 0 ? (int)((int64_t)done * 100 / total) : 0;
  if (pct == lastPct) return;
  lastPct = pct;
  displayUpdateScreen(pendingVersion, pct, nullptr);
}

bool otaPoll() {
  if (!pendingUrl[0]) return false;
  char url[sizeof(pendingUrl)];
  strlcpy(url, pendingUrl, sizeof(url));
  pendingUrl[0] = '\0';
  Serial.printf("[OTA] Updating to %s from %s\n", pendingVersion, url);

  // Quiet everything and let go of Sage while the new firmware comes in.
  hapticOff();
  wsPause();
  lastPct = -1;
  displayUpdateScreen(pendingVersion, 0, nullptr);

  WiFiClient net;
  httpUpdate.rebootOnUpdate(true);
  httpUpdate.onProgress(onProgress);
  // Sage sends the file's MD5 as x-MD5, which HTTPUpdate checks before the
  // new firmware is made the one to start.
  t_httpUpdate_return result = httpUpdate.update(net, url, FW_VERSION);
  if (result == HTTP_UPDATE_NO_UPDATES) {
    strlcpy(lastError, "nothing to update", sizeof(lastError));
  } else {   // HTTP_UPDATE_FAILED (on success it restarts and never gets here)
    snprintf(lastError, sizeof(lastError), "%s", httpUpdate.getLastErrorString().c_str());
  }
  Serial.printf("[OTA] Failed: %s\n", lastError);
  displayUpdateScreen(pendingVersion, -1, lastError);
  delay(4000);
  wsResume();
  return true;
}
