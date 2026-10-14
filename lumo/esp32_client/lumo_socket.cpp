#include "lumo_socket.h"
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------- parser

void WsParser::reset() {
  headLen = 0;
  headNeed = 2;
  payloadLen = payloadGot = 0;
  skipping = false;
  msgLen = 0;
  msgOpcode = 0;
}

bool WsParser::grow(size_t need) {
  if (need + 1 <= cap) return true;   // +1: a 0 after text
  size_t next = cap ? cap : 1024;
  while (next < need + 1) next *= 2;
  uint8_t* bigger = (uint8_t*)realloc(buf, next);
  if (!bigger) return false;
  buf = bigger;
  cap = next;
  return true;
}

bool WsParser::feed(const uint8_t* data, size_t len) {
  while (len) {
    // The header: 2 bytes, then the long length and the mask if it has them.
    if (headLen < headNeed) {
      head[headLen++] = *data++;
      len--;
      if (headLen == 2) {
        uint8_t n = head[1] & 0x7F;
        headNeed = 2 + (n == 126 ? 2 : n == 127 ? 8 : 0) + ((head[1] & 0x80) ? 4 : 0);
      }
      if (headLen < headNeed) continue;

      fin = head[0] & 0x80;
      opcode = head[0] & 0x0F;
      masked = head[1] & 0x80;
      uint8_t n = head[1] & 0x7F, at = 2;
      if (n == 126) { payloadLen = ((uint64_t)head[2] << 8) | head[3]; at = 4; }
      else if (n == 127) { payloadLen = 0; for (int i = 0; i < 8; i++) payloadLen = (payloadLen << 8) | head[2 + i]; at = 10; }
      else payloadLen = n;
      if (masked) memcpy(mask, head + at, 4);
      payloadGot = 0;

      bool control = opcode & 0x08;
      if (head[0] & 0x70) return false;                          // no extensions were agreed
      if (control && (payloadLen > 125 || !fin)) return false;
      if (!control) {
        if (opcode == 1 || opcode == 2) {                        // a new message
          if (msgOpcode) return false;                           // the last one never finished
          msgOpcode = opcode;
          msgLen = 0;
          skipping = false;
        } else if (opcode != 0 || !msgOpcode) {
          return false;                                          // unknown, or a stray continuation
        }
        if (!skipping && (msgLen + payloadLen > MAX_FRAME || !grow(msgLen + payloadLen))) skipping = true;
      }
    }

    // The payload, as much of it as is here.
    size_t take = (size_t)min((uint64_t)len, payloadLen - payloadGot);
    bool control = opcode & 0x08;
    if (take) {
      uint8_t* dst = control ? ctrl + payloadGot : (skipping ? nullptr : buf + msgLen + payloadGot);
      if (dst) {
        for (size_t i = 0; i < take; i++) dst[i] = masked ? data[i] ^ mask[(payloadGot + i) & 3] : data[i];
      }
      payloadGot += take;
      data += take;
      len -= take;
    }
    if (payloadGot < payloadLen) return true;   // the rest is still on its way

    // A whole frame.
    headLen = 0;
    headNeed = 2;
    if (control) {
      ctrl[payloadLen] = 0;
      if (onFrame) onFrame(opcode, ctrl, (size_t)payloadLen, context);
      continue;
    }
    msgLen += (size_t)payloadLen;
    if (!fin) continue;
    if (!skipping) {
      buf[msgLen] = 0;
      if (onFrame) onFrame(msgOpcode, buf, msgLen, context);
    }
    msgOpcode = 0;
    msgLen = 0;
    skipping = false;
  }
  return true;
}

// ---------------------------------------------------------------- client

static void base64(const uint8_t* in, size_t n, char* out) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t o = 0;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = (uint32_t)in[i] << 16 | (i + 1 < n ? (uint32_t)in[i + 1] << 8 : 0) | (i + 2 < n ? in[i + 2] : 0);
    out[o++] = T[(v >> 18) & 63];
    out[o++] = T[(v >> 12) & 63];
    out[o++] = i + 1 < n ? T[(v >> 6) & 63] : '=';
    out[o++] = i + 2 < n ? T[v & 63] : '=';
  }
  out[o] = 0;
}

// One line of the handshake answer, without its \r\n. False on a timeout.
static bool readLine(WiFiClient& tcp, char* line, size_t size, unsigned long deadline) {
  size_t n = 0;
  while ((long)(deadline - millis()) > 0) {
    if (!tcp.available()) {
      if (!tcp.connected()) return false;
      delay(1);
      continue;
    }
    int c = tcp.read();
    if (c < 0) continue;
    if (c == '\n') {
      if (n && line[n - 1] == '\r') n--;
      line[n] = 0;
      return true;
    }
    if (n + 1 < size) line[n++] = (char)c;
  }
  return false;
}

bool LumoSocket::connect(const char* host, uint16_t port, const char* path, uint32_t timeoutMs) {
  if (open) close(1000);
  tcp.stop();
  parser.begin(&LumoSocket::frame, this);
  if (!tcp.connect(host, port, (int32_t)timeoutMs)) return false;
  tcp.setNoDelay(true);

  uint8_t nonce[16];
  for (int i = 0; i < 16; i++) nonce[i] = (uint8_t)random(256);
  char key[25];
  base64(nonce, 16, key);
  char req[256];
  snprintf(req, sizeof(req),
           "GET %s HTTP/1.1\r\nHost: %s:%u\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
           "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", path, host, port, key);
  tcp.write((const uint8_t*)req, strlen(req));

  // The answer must be "101 Switching Protocols"; the headers after it are skipped.
  unsigned long deadline = millis() + timeoutMs;
  char line[128];
  if (!readLine(tcp, line, sizeof(line), deadline) || strncmp(line, "HTTP/1.1 101", 12) != 0) {
    tcp.stop();
    return false;
  }
  do {
    if (!readLine(tcp, line, sizeof(line), deadline)) { tcp.stop(); return false; }
  } while (line[0]);
  open = true;
  return true;
}

void LumoSocket::frame(uint8_t opcode, const uint8_t* data, size_t len, void* ctx) {
  LumoSocket& self = *(LumoSocket*)ctx;
  if (!self.open) return;   // closed by a handler earlier in this read: the rest is dropped
  switch (opcode) {
    case 1: if (self.onText) self.onText((const char*)data, len); break;
    case 2: if (self.onBinary) self.onBinary(data, len); break;
    case 9:
      self.sendFrame(10, data, len);   // pong, with the ping's data
      if (self.onPing) self.onPing();
      break;
    case 10: if (self.onPong) self.onPong(); break;
    case 8: {
      uint16_t code = len >= 2 ? (uint16_t)(data[0] << 8 | data[1]) : 1005;
      self.sendFrame(8, data, len >= 2 ? 2 : 0);   // agree, then hang up
      self.finish(code);
      break;
    }
  }
}

void LumoSocket::poll() {
  if (!open) return;
  uint8_t chunk[512];
  // Up to ~8 KB per call so a long burst can't hold up the screen and buttons.
  for (int rounds = 0; open && rounds < 16; rounds++) {
    int n = tcp.available();
    if (n <= 0) break;
    int got = tcp.read(chunk, min(n, (int)sizeof(chunk)));
    if (got <= 0) break;
    if (!parser.feed(chunk, (size_t)got)) {
      Serial.println("[WS] The stream from the Pi made no sense; reconnecting");
      close(1002);
      return;
    }
  }
  if (open && !tcp.connected() && !tcp.available()) finish(1006);   // gone without a goodbye
}

bool LumoSocket::sendFrame(uint8_t opcode, const uint8_t* data, size_t len) {
  if (!open) return false;
  // A client masks what it sends (RFC 6455); header and payload go out in one write.
  uint8_t stackBuf[320];
  size_t total = len + 14;
  uint8_t* out = total <= sizeof(stackBuf) ? stackBuf : (uint8_t*)malloc(total);
  if (!out) return false;
  size_t n = 0;
  out[n++] = 0x80 | opcode;
  if (len < 126) out[n++] = 0x80 | (uint8_t)len;
  else { out[n++] = 0x80 | 126; out[n++] = (uint8_t)(len >> 8); out[n++] = (uint8_t)len; }
  uint8_t key[4];
  uint32_t r = (uint32_t)random(0x7FFFFFFF) ^ micros();
  memcpy(key, &r, 4);
  memcpy(out + n, key, 4);
  n += 4;
  for (size_t i = 0; i < len; i++) out[n + i] = data[i] ^ key[i & 3];
  n += len;
  size_t sent = tcp.write(out, n);
  if (out != stackBuf) free(out);
  if (sent != n) {
    finish(1006);
    return false;
  }
  return true;
}

bool LumoSocket::sendText(const char* text) {
  return sendFrame(1, (const uint8_t*)text, strlen(text));
}

bool LumoSocket::ping() {
  return sendFrame(9, nullptr, 0);
}

void LumoSocket::close(uint16_t code) {
  if (!open) return;
  uint8_t body[2] = { (uint8_t)(code >> 8), (uint8_t)code };
  sendFrame(8, body, 2);
  finish(code);
}

void LumoSocket::finish(uint16_t code) {
  if (!open) return;
  open = false;
  tcp.stop();
  parser.reset();
  if (onClose) onClose(code);
}
