# Eclipse: the desk, the G2 glasses, the R1 ring, and everything else

Eclipse is the hub for every external system. It keeps one registry of devices, one event log, one command queue, and one heads-up feed. It runs inside the existing Cloudflare Worker, on the same free tier and D1 database, so there is no new account or server.

```
 Even R1 ring ──BLE──► Even G2 glasses ──BLE──► Even App (phone)
                                                  │  Eclipse G2 app (eclipse/g2), runs in the app's WebView
                                                  ▼  HTTPS, bearer token "g2"
                              ┌──────── Cloudflare Worker: /eclipse/v1 ────────┐
 Oura / Watch / Shortcuts ───►│ devices · device_state · device_events         │◄── Owner page /eclipse (iPhone)
   (token per device)         │ device_commands · hud_messages · rules         │
                              └────────────────────────────────────────────────┘
                                                  ▲  HTTPS, bearer token "desk" (polls every 5 s; no open ports)
                                                  │
                         Desk computer (Mac mini / Pi 5): eclipse/desk/agent.py
                           ├─ GRBL gantry under the glass → moving Qi coil
                           ├─ camera → finds the phone · presence sensor → seated time
                           └─ http://127.0.0.1:8765 overlay → full-screen on the clear OLED
```

## 1. What the video builds, and how Eclipse matches it

The video is HTX Studio's "We Built the Product Apple Gave Up On…", a DIY take on Apple's cancelled AirPower charging mat, built as a whole desk. ([Notebookcheck](https://www.notebookcheck.net/YouTuber-builds-a-desk-sized-Apple-AirPower-that-finds-your-phone-and-charges-it-automatically.1407656.0.html), [Yanko Design](https://www.yankodesign.com/2026/09/27/diy-airpower-desk-charges-your-phone-anywhere-on-its-glass-top-also-reminds-you-to-drink-water/amp/), [TechSpot](https://www.techspot.com/news/113986-amazing-diy-desk-uses-camera-motor-charge-phone.html))

| In the video | In Eclipse |
|---|---|
| Clear OLED glass desktop | `eclipse/desk/overlay.html` in a full-screen kiosk browser. On a transparent OLED, black pixels are clear glass. |
| A camera finds the phone anywhere on the desk | `RealDesk.find_phone()` uses OpenCV to find the largest dark rectangle of roughly 2:1. |
| One motorised Qi coil drives under the phone | A GRBL XY gantry: `G1 X… Y…` moves the coil to the phone. |
| An animated cat follows the coil | The overlay cat rides the coil position. It dims in focus mode. |
| Two fixed corner pads | Plain Qi pads with no software. |
| Built-in Mac mini | Runs the agent, the overlay and the camera. |
| "You've been sitting an hour, drink water" | The Eclipse rule `stand:<desk>:<sitting>` fires once per sitting, on the lenses and on the desk. |
| **New, not in the video** | Ring and glasses control the desk: double-tap the ring for focus mode, long-press to find and charge the phone, swipe up for a stand nudge. The G2 lenses show the desk state and your feed. |

## 2. Hardware build list (desk)

| Part | Pick | Notes |
|---|---|---|
| Top | Transparent OLED panel (LG 55" 55EW5 class, or a 30" panel) under 8–10 mm tempered glass | The most expensive part. A cheaper option is a normal monitor under smoked glass, which loses only the see-through effect. |
| Gantry | CoreXY or 2-axis belt kit (2020 extrusion, GT2 belts, 2× NEMA17) | Travel must cover the desk. Keep the coil 3–5 mm under the glass. Qi only couples at a short gap, so use thin glass over the charge zone. |
| Controller | Arduino + CNC shield running **GRBL 1.1**, or an ESP32 running FluidNC | USB serial to the computer at 115200 baud. Add limit switches so `$H` homing works. |
| Coil | 15 W Qi transmitter module, 5 V/3 A, on the carriage | Use a flexible cable chain for the power. |
| Camera | 1080p USB webcam above the desk (monitor arm or shelf) | Overhead is simplest. One under the glass works if the OLED area is cut out. |
| Presence | mmWave sensor (LD2410) or a chair pressure mat to a GPIO | Implement `RealDesk.seated()`. Until then, the cron rule only runs while the desk reports. |
| Computer | Mac mini (as in the video) or Raspberry Pi 5 | Runs `agent.py` and a kiosk browser on the OLED. |

Calibration upgrade: map camera pixels to gantry millimetres with a 4-point homography. Put tape at the four corners and use `cv2.getPerspectiveTransform`. The shipped version assumes the camera frames the desk exactly.

## 3. Even G2 glasses and R1 ring

G2 apps are web apps that run in the Even App's WebView and render to the glasses through `@evenrealities/even_hub_sdk` (v0.0.16). The display is 576×288 per eye in 16 greys of green, uses one font, and allows up to 8 text containers. The R1 ring has no network of its own. Its gestures arrive through the same SDK, tagged `EventSourceType.TOUCH_EVENT_FROM_RING`, so Eclipse can tell ring input from temple input. ([Even Hub docs](https://hub.evenrealities.com/docs/build/device-apis))

| Input | Glasses temples | R1 ring |
|---|---|---|
| Tap | Mark the current item done | Next item |
| Double tap | Exit (system dialog) | **Desk focus mode** |
| Swipe up | Previous item | **Desk stand nudge** |
| Swipe down | Next item | Next item |
| Long press | n/a | **Desk finds and charges the phone** |

The mapping lives in `eclipse/g2/src/gestures.ts`. Change it there.

The lens shows `time | seated Nm | phone charging | FOCUS | N to review`, then the current item, then `i/n`. Items come from rules (stand-up, phone charged), from you (the Eclipse page), and from the YouTube library (the review count).

Verified in the official simulator: the feed renders, a swipe moves to the next item, and a tap clears it on the server.

## 4. Other wearables worth adding

The same pattern works for any device: register it, give it a token, and have it POST events. Rules then turn events into HUD items or desk commands.

| Device | How it connects | What it adds |
|---|---|---|
| **iPhone (Shortcuts)** | Personal automations: "When Focus turns on" → POST `{type:"action",payload:{action:"desk.focus"}}` | The phone's Focus mode and the desk's focus mode stay in sync. Arriving home can wake the desk. |
| **Apple Watch** | No web API for HealthKit. Use a Shortcut automation that reads Health samples and POSTs them. | Heart rate and stand hours. Gives the stand rule a second signal. |
| **Oura Ring** | Oura API v2 (personal access token), pulled by the cron job | A morning lens card ("Readiness 62, go easy"), and a gentler stand reminder on low-readiness days. |
| **WHOOP** | WHOOP developer API (OAuth) | Strain and recovery on the lens, same as Oura. |
| **Desk lights / Hue** | The desk agent calls the local Hue bridge | Focus mode dims the room. A stand nudge pulses the lights. |

Kinds already allowed in the registry: `desk, glasses, ring, watch, phone, sensor, other`.

## 5. API (`/eclipse/v1`, `Authorization: Bearer <device token>`)

| Method | Path | Body / result |
|---|---|---|
| GET | `/me` | The calling device and its state |
| POST | `/events` | `{type, payload}` or `{events:[…]}` (50 max). Types with effects: `state`, `heartbeat`, `presence {seated}`, `charge {state, battery, device}`, `gesture {source, gesture}`, `action {action, id?}` |
| GET | `/commands` | Pending commands for this device, marked delivered once read |
| GET | `/hud?i=&tz=` | `{items, desk, library, glance}`. `glance` is the ready-made lens text. |

Actions: `hud.ack`, `desk.focus`, `desk.charge`, `desk.stand`, `ping`. Commands: `focus.toggle`, `focus.set`, `charge.seek`, `stand.nudge`, `oled.show`, `ping`. Unknown values are rejected.

Settings rows: `eclipse_sit_minutes` (default 50) and `eclipse_tz` (default `America/New_York`).

Safety: tokens are stored only as SHA-256 hashes and are revocable per device. The API never uses cookies, so its open CORS policy cannot be abused from a browser. Bodies are capped at 16 KB. Events are pruned after 30 days.

## 6. Setup

1. **Deploy.** Push to the default branch. The workflow applies migration `0003_eclipse.sql`.
2. **Register devices** on the **Eclipse** page in the app:
   - `desk` (kind desk). Copy its token.
   - `g2` (kind glasses, vendor Even Realities, model G2). Copy its token.
   - `r1` (kind ring). Set "Reports through" to `g2`. It needs no token.
3. **Desk.** On the desk computer, run `ECLIPSE_URL=https://<worker> ECLIPSE_TOKEN=<desk token> python3 eclipse/desk/agent.py` (add `--sim` to try it without hardware). Then open `http://127.0.0.1:8765` full screen on the OLED, for example with `chromium --kiosk`.
4. **Glasses.** In `eclipse/g2/app.json`, set the network whitelist to your worker's origin. Then run `npm install`, then `npm run pack`, and upload `eclipse.ehpk` with `evenhub` (or `npm run dev` plus `evenhub qr --url http://<lan-ip>:5173` for live testing). Open Eclipse on the phone and paste the server URL and the `g2` token.
5. **Simulator** (no glasses needed): put `VITE_ECLIPSE_URL` and `VITE_ECLIPSE_TOKEN` in `eclipse/g2/.env.local`, then run `npm run dev` and `npm run sim`.

## 7. Next steps

- Microphone: the G2 four-mic array streams 16 kHz PCM through the SDK. Workers AI Whisper could turn "Eclipse, focus" into actions with no ring tap.
- Push instead of polling: Durable Objects with WebSockets. This is only worth it if the 5 s desk poll feels slow, since polling stays inside the free tier (about 17k requests a day).
- Multi-device charging: queue phone positions and visit each one in turn. The video's build cannot do this either.
