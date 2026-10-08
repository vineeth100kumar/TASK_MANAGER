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
2. Copy `secrets.example.h` to `secrets.h` in the same folder and set `WIFI_SSID`, `WIFI_PASS`, `PI_HOSTNAME` (the Pi's IP) and `DESK_TOKEN` (the six-digit pairing code `deploy/install_pi.sh` prints). `secrets.h` is gitignored, so your password stays off GitHub. A clock with the wrong code shows "Not paired".
3. Select board: **ESP32C3 Dev Module**.
4. Set Flash Mode to **DIO** and CPU Frequency to **160MHz**.
5. Upload the sketch to your ESP32-C3.

Or from a terminal with `arduino-cli` (same settings):

```bash
arduino-cli compile --upload -p COM5 -b esp32:esp32:esp32c3:FlashMode=dio,CPUFreq=160 esp32_client
```

---

## 3. Raspberry Pi 5 Server Setup

**Retired.** From firmware 1.6.0 the clock is driven by Sage's own server
(`raspberry_pi/desk/`, see [its README](../raspberry_pi/README.md#desk-clock-lumo)),
and `deploy/install_pi.sh` stops and disables `lumo.service` and
`lumo-obex.service`. The rest of this section, and sections 4 and 5, describe
the old server, kept here until the photo frame moves to Sage.

LUMO used to have its own installer step. From the checkout on the Pi:

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
| A Sage reminder falling due | A buzz and a notification card on the clock |
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

## 6. Screens and buttons (firmware 2.0)

The clock has no character any more. It starts on the Clock screen. UP and
DOWN step through Clock, Tasks, Now playing and System. You can change what
every button does from Sage (see the Pi's README, "Desk clock"). The clock
sends each press to Sage, and Sage decides what it does:

- **Clock** shows the time in the style set in Sage: digital (with a
  greeting and the weather), minimal, or an analog dial. It can be 12- or
  24-hour, with or without seconds, and can show a second time zone. The clock
  keeps the style in flash, so it looks right before Sage connects.
- **Cards** (reminders, phone notifications) show over whatever screen is up.
  A card with actions shows what LEFT, OK and RIGHT do, and stays until you
  answer it. A plain card goes after 4.5 s. Either way, the clock then returns
  to the screen it was on.
- **Hold OK** for about a second to send `HOLD_OK`, a sixth button you can map
  in Sage. A short OK press is sent when you let go.
- **Alarms** take the screen while they ring: RIGHT snoozes, any other button
  stops (both can be changed in Sage).
- **Offline alarms.** Sage sends the next day's alarms to the clock, and the
  clock keeps them in flash. If the clock can't reach Sage at an alarm's
  time, it rings the alarm itself. RIGHT snoozes for the length set in Sage,
  any other button stops it, and it gives up after 10 minutes. It still needs
  Wi-Fi to know the time (NTP), because the board has no clock battery.
