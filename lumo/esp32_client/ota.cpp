#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include "ota.h"
#include "config.h"
#include "display.h"
#include "peripherals.h"
#include "ws_client.h"

static char pendingUrl[160] = "";
static char pendingVersion[16] = "";
static char lastError[80] = "";
static int  lastPct = -1;

// Kept in flash for the trial boot (namespace "lumoota"):
//   slot   the app slot an update was written to; the next start from it is a trial
//   boots  starts of that version so far, while on trial
//   note   why the last version was sent back, for Sage
//   panel  1 once a kept version has seen the screen answer its status read
static const char* OTA_NS = "lumoota";

// The bootloader in the Arduino core can do this itself (a new app starts
// "pending verify" and the previous one comes back if it isn't confirmed).
// Arduino confirms every app at start-up unless this says to wait, so LUMO
// confirms it itself, in otaTrialTick, once the checks pass.
extern "C" bool verifyRollbackLater() { return true; }

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

  // The next start from the slot being written is the new version's trial.
  const esp_partition_t* next = esp_ota_get_next_update_partition(nullptr);
  {
    Preferences p;
    if (next && p.begin(OTA_NS, false)) {
      p.putString("slot", next->label);
      p.putUChar("boots", 0);
      p.end();
    }
  }

  // A download takes longer than the loop watchdog allows; it has its own timeouts.
  disableLoopWDT();
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
  {
    Preferences p;
    if (p.begin(OTA_NS, false)) { p.remove("slot"); p.end(); }
  }
  Serial.printf("[OTA] Failed: %s\n", lastError);
  displayUpdateScreen(pendingVersion, -1, lastError);
  delay(4000);
  enableLoopWDT();
  wsResume();
  return true;
}

// ---------------------------------------------------------------------
//  Trial boot
// ---------------------------------------------------------------------
static bool          onTrial      = false;
static bool          bootPending  = false;   // the bootloader holds the old version for us
static bool          trialPaired  = false;
static unsigned long trialStart   = 0;
static unsigned long pairedAt     = 0;
static bool          panelOk      = false;

bool otaOnTrial() { return onTrial; }

// Goes back to the version this one replaced. Never returns when it can.
static void trialFail(const char* why) {
  char note[sizeof(lastError)];
  snprintf(note, sizeof(note), "rolled back from %s: %s", FW_VERSION, why);
  Serial.printf("[OTA] %s\n", note);
  Preferences p;
  if (p.begin(OTA_NS, false)) {
    p.putString("note", note);
    p.remove("slot");
    p.remove("boots");
    p.end();
  }
  hapticOff();
  displayRollbackScreen(why);
  delay(2500);
  if (bootPending) esp_ota_mark_app_invalid_rollback_and_reboot();   // restarts on success
  // Without the bootloader's help: start the other slot by hand, if it holds an app.
  const esp_partition_t* prev = esp_ota_get_next_update_partition(nullptr);
  esp_app_desc_t desc;
  if (prev && esp_ota_get_partition_description(prev, &desc) == ESP_OK && esp_ota_set_boot_partition(prev) == ESP_OK) {
    esp_restart();
  }
  // Nothing to go back to: keep running, and say so.
  snprintf(lastError, sizeof(lastError), "%s, but the old version wasn't there to go back to", note);
  onTrial = false;
}

static void trialKeep() {
  if (bootPending) esp_ota_mark_app_valid_cancel_rollback();
  Preferences p;
  if (p.begin(OTA_NS, false)) {
    p.remove("slot");
    p.remove("boots");
    if (panelOk && !p.getUChar("panel", 0)) p.putUChar("panel", 1);
    p.end();
  }
  onTrial = false;
  Serial.printf("[OTA] Keeping %s\n", FW_VERSION);
  wsSend("{\"evt\":\"TRIAL\",\"ok\":true,\"fw\":\"" FW_VERSION "\"}");
}

void otaTrialBegin() {
  panelOk = displayPanelAnswers();
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t st;
  bootPending = running && esp_ota_get_state_partition(running, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY;

  Preferences p;
  if (!p.begin(OTA_NS, false)) {
    if (bootPending) esp_ota_mark_app_valid_cancel_rollback();   // nowhere to keep the trial: don't strand it
    return;
  }
  // Why the last version was sent back: told to Sage once, in the next HELLO.
  if (p.isKey("note")) {
    p.getString("note", lastError, sizeof(lastError));
    p.remove("note");
  }
  char slot[17] = "";
  if (p.isKey("slot")) p.getString("slot", slot, sizeof(slot));
  bool softTrial = slot[0] && running && strcmp(slot, running->label) == 0;
  if (slot[0] && !softTrial) p.remove("slot");   // the update never started (or a USB flash came after)
  bool panelSeen = p.getUChar("panel", 0);

  if (!bootPending && !softTrial) {
    if (panelOk && !panelSeen) p.putUChar("panel", 1);
    p.end();
    return;
  }
  uint8_t boots = p.getUChar("boots", 0) + 1;
  p.putUChar("boots", boots);
  p.end();
  onTrial = true;
  trialStart = millis();
  Serial.printf("[OTA] %s on trial (start %u, screen %s)\n", FW_VERSION, boots, panelOk ? "answers" : "silent");

  esp_reset_reason_t r = esp_reset_reason();
  bool crashed = r == ESP_RST_PANIC || r == ESP_RST_INT_WDT || r == ESP_RST_TASK_WDT || r == ESP_RST_WDT;
  if (boots > 1 && crashed) { trialFail("it crashed on start-up"); return; }
  if (boots > 3) { trialFail("it kept restarting"); return; }
  // A screen that answered before and is silent now: the new version broke it
  // (2.14.0 left the panel blank white). Where it never answered (no MISO
  // wire), this can't tell, and the other checks decide.
  if (panelSeen && !panelOk) { trialFail("the screen didn't answer"); return; }
}

void otaTrialTick(bool paired) {
  if (!onTrial) return;
  unsigned long now = millis();
  if (paired && !trialPaired) { trialPaired = true; pairedAt = now; }
  if (trialPaired && paired && now - pairedAt >= OTA_TRIAL_KEEP_MS) { trialKeep(); return; }
  if (!trialPaired && now - trialStart >= OTA_TRIAL_REACH_MS) trialFail("it couldn't reach Sage");
}
