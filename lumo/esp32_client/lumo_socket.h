#pragma once
#include <Arduino.h>
#include <WiFi.h>

// LUMO's own websocket client, in place of the ArduinoWebsockets library.
//
// That library reads a frame's header with one read() and takes whatever
// came back, so when Wi-Fi splits a frame between two packets it reads half
// a header, loses its place in the stream and closes with "protocol error"
// (1002). The Pi sends a burst on every connect (the depth face, the cover,
// the screen), so the split happened on nearly every connect and LUMO never
// stayed connected after a restart. Here the bytes go through WsParser, which
// keeps any part of a frame until the rest arrives.

// Turns the bytes from the Pi into whole frames, however they were split.
// No Wi-Fi in here, so it can be tested on a computer.
class WsParser {
 public:
  typedef void (*FrameFn)(uint8_t opcode, const uint8_t* data, size_t len, void* ctx);
  static const size_t MAX_FRAME = 16384;   // bigger messages are skipped, not kept

  void begin(FrameFn fn, void* ctx) { onFrame = fn; context = ctx; reset(); }
  void reset();
  // Feed what arrived. False when the stream makes no sense (the caller
  // closes the link).
  bool feed(const uint8_t* data, size_t len);

 private:
  bool grow(size_t need);

  FrameFn  onFrame = nullptr;
  void*    context = nullptr;
  uint8_t  head[14];
  uint8_t  headLen = 0;
  uint8_t  headNeed = 2;
  uint64_t payloadLen = 0;
  uint64_t payloadGot = 0;
  bool     masked = false;
  uint8_t  mask[4];
  uint8_t  opcode = 0;
  bool     fin = true;
  bool     skipping = false;    // a frame too big to keep: read past it
  uint8_t  ctrl[126];           // a ping, pong or close (they can come between fragments)
  uint8_t* buf = nullptr;       // the message so far (fragments joined)
  size_t   cap = 0;
  size_t   msgLen = 0;
  uint8_t  msgOpcode = 0;       // text or binary, for a fragmented message
};

class LumoSocket {
 public:
  typedef void (*TextFn)(const char* text, size_t len);
  typedef void (*BinaryFn)(const uint8_t* data, size_t len);
  typedef void (*EventFn)();
  typedef void (*CloseFn)(uint16_t code);

  TextFn   onText   = nullptr;
  BinaryFn onBinary = nullptr;
  EventFn  onPing   = nullptr;   // the Pi's ping (answered here)
  EventFn  onPong   = nullptr;   // the answer to ours
  CloseFn  onClose  = nullptr;   // called once per connection, whoever ended it

  // Connects and does the websocket handshake; each step gives up after
  // timeoutMs. True when the link is open.
  bool connect(const char* host, uint16_t port, const char* path, uint32_t timeoutMs);
  void poll();                   // reads what arrived and hands out whole messages
  bool sendText(const char* text);
  bool ping();
  void close(uint16_t code = 1000);
  bool isOpen() const { return open; }
  // Why the last connect() failed ("" when it didn't), for the Pi to see.
  const char* failure() const { return why; }

 private:
  bool sendFrame(uint8_t opcode, const uint8_t* data, size_t len);
  void finish(uint16_t code);
  static void frame(uint8_t opcode, const uint8_t* data, size_t len, void* ctx);

  WiFiClient tcp;
  WsParser   parser;
  bool       open = false;
  const char* why = "";
};
