# LUMO: Raspberry Pi 5 Controlled Smart Companion System

A distributed IoT smart desk clock and companion system featuring:
- **Raspberry Pi 5 ("The Brain")**: Handles Spotify API, Open-Meteo weather, multi-alarm scheduling, task syncing, circadian emotion logic, and serves a modern glassmorphic web dashboard.
- **ESP32-C3 ("The Display Node")**: Operates as a zero-lag, dedicated peripheral and display driver pushing pixels over 40 MHz SPI to a 2.8" ILI9341 display with dirty-rectangle redraws, WS2812B NeoPixel lighting, and an active-low haptic buzzer.

---

## 1. Hardware Pinout & Wiring (ESP32-C3)

| Component | Pin | Notes |
| :--- | :--- | :--- |
| **TFT Display CS** | GPIO 8 | Hardware SPI Chip Select |
| **TFT Display DC** | GPIO 7 | Data / Command Select |
| **TFT Display SCK** | GPIO 4 | Hardware SPI Clock |
| **TFT Display MOSI**| GPIO 6 | Hardware SPI Data Out |
| **TFT Display VCC** | 3.3V / 5V | Depending on module voltage regulator |
| **TFT Display GND** | GND | Common Ground |
| **Button Ladder** | GPIO 1 (ADC) | 5-way resistor ladder: OK (~0.15V), UP (~0.60V), DOWN (~0.22V), LEFT (~3.30V), RIGHT (~0.33V) |
| **NeoPixel Ring** | GPIO 10 | 6x WS2812B RGB LEDs |
| **Haptic Buzzer** | GPIO 9 | Active-low PWM (50 kHz silent haptic click or audio alarm) |

*Note: Battery monitoring has been completely omitted. Power the ESP32 directly via USB-C.*

---

## 2. ESP32-C3 Firmware Setup

### Arduino IDE Libraries Required:
Install the following via the Arduino IDE Library Manager:
1. `Adafruit ILI9341` (by Adafruit)
2. `Adafruit GFX Library` (by Adafruit)
3. `Adafruit NeoPixel` (by Adafruit)
4. `ArduinoWebsockets` (by Gil Maimon)
5. `ArduinoJson` (v7 by Benoit Blanchon)

*(Note: `TJpg_Decoder` is not needed on the ESP32. The Raspberry Pi converts all Spotify album art directly to raw RGB565 bitmaps before transmission).*

### Flashing:
1. Open `esp32_client/esp32_client.ino` in the Arduino IDE.
2. Copy `secrets.example.h` to `secrets.h` in the same folder and set `WIFI_SSID`, `WIFI_PASS` and `PI_HOSTNAME`. `secrets.h` is gitignored, so your password stays off GitHub.
3. Select board: **ESP32C3 Dev Module**.
4. Set Flash Mode to **DIO** and CPU Frequency to **160MHz**.
5. Upload the sketch to your ESP32-C3.

---

## 3. Raspberry Pi 5 Server Setup

LUMO now lives in the TASK_MANAGER repository next to Sage, and one installer
sets up both. From the checkout on the Pi:

```bash
sudo deploy/install_pi.sh
```

That creates `lumo/rpi_server/venv`, copies `.env.example` to `.env` if there
isn't one, and installs `lumo.service` and `lumo-obex.service` (templates in
`deploy/systemd/`) for your user and checkout path. Put your Groq key, Spotify
credentials and location in `lumo/rpi_server/.env`, then
`sudo systemctl restart lumo`.

### Running Manually:
```bash
cd lumo/rpi_server
venv/bin/python main.py
```
- Web dashboard will be live at: `http://<your-pi-ip>:8080` (or `http://lumo.local:8080`).
- WebSocket server for the ESP32 will listen on: `ws://0.0.0.0:8765`.

---

## 4. Shared Task Manager (Sage)

Tasks, reminders and alarms are not stored on Lumo. They live in Sage, the task
manager running on the same Pi, so a task added at the desk clock is in the
app and a reminder set in the app rings at the desk.

Lumo is a client of Sage's sync API, the same one the web app uses, over the
loopback address (`http://127.0.0.1:8000`). `services/sage_client.py` is the
only file that knows Sage's field names.

| What happens | Where it goes |
| :--- | :--- |
| "Jarvis, add a task" | Sage's `/api/parse-task`, so dates are understood, then saved through sync |
| Task list on the display and dashboard | Sage's open tasks, soonest first |
| Alarms | Sage reminders labelled `alarm` |
| A Sage reminder falling due | A buzz and a notification card on the face |
| A change made in the app | Arrives on Sage's `/ws` stream and updates the clock within a second |

### The key

Sage keeps its key as `API_SECRET` in `/etc/sage/sage.env`, which only root
can read. `lumo.service` has the same `EnvironmentFile` line Sage's unit has,
so systemd passes the value down. Running `main.py` by hand instead? Put the
same value in `.env` as `SAGE_API_KEY`.

Check the connection with a full round trip (adds a test task and alarm, then
moves them to Sage's trash):

```bash
cd lumo/rpi_server
sudo env $(sudo cat /etc/sage/sage.env | xargs) venv/bin/python test_sage.py
```

Sage being down is not fatal: the display keeps showing the last list it saw,
and Lumo reconnects on its own.

---

## 5. Spotify Developer App Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. In your app settings, add `http://localhost:8888/callback` as a **Redirect URI**.
3. Note your **Client ID** and **Client Secret**.
4. To generate your `SPOTIFY_REFRESH_TOKEN`, run your local OAuth authorization flow requesting scopes:
   - `user-read-playback-state`
   - `user-read-currently-playing`
   - `user-modify-playback-state`
5. Paste `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN` into your `.env` file.

---

## 6. Screen Navigation (Physical Controls)

- **From Face Screen**:
  - `RIGHT` -> Desk Clock Screen
  - `LEFT`  -> Tasks List Screen
  - `OK`    -> Spotify Music Card Screen
- **From Clock Screen**:
  - `LEFT`  -> Tasks Screen
  - `OK`    -> Face Screen
  - `RIGHT` -> Spotify Screen
- **From Spotify Screen**:
  - `LEFT`  -> Clock Screen
  - `OK`    -> Play / Pause toggle
  - `RIGHT` -> Next Track
- **During Alarm Ringing**:
  - Pressing any button dismisses the alarm.
