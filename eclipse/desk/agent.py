#!/usr/bin/env python3
"""Eclipse desk agent.

Runs on the computer built into the desk (Mac mini or Raspberry Pi 5). It:
  * reports presence (seated / not) and phone-charging state to Eclipse,
  * pulls commands (focus.toggle, charge.seek, stand.nudge, oled.show, ping),
  * drives the coil gantry (GRBL over USB serial) and serves the clear-OLED overlay
    on http://127.0.0.1:8765 (open it full screen in a kiosk browser on the OLED).

Standard library only. pyserial and opencv-python are optional and used only by the
real hardware drivers; `--sim` runs everything against a simulated desk.

    ECLIPSE_URL=https://noxara-yt.you.workers.dev ECLIPSE_TOKEN=... python3 agent.py --sim
"""

from __future__ import annotations

import argparse
import json
import os
import random
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Desk surface in millimetres; the overlay maps this to the OLED's pixels.
DESK_W, DESK_H = 1200.0, 600.0
# Where the moving coil parks, and the two fixed corner pads from the build.
PARK = (DESK_W / 2, DESK_H - 40)


class Desk:
    """Hardware interface. Subclass for real sensors; every method must be quick and non-blocking."""

    def __init__(self) -> None:
        self.coil = list(PARK)  # current coil position (mm)
        self.target: tuple[float, float] | None = None
        self.charge = "idle"  # idle | seeking | charging | full
        self.focus = False
        self.nudge_until = 0.0
        self.oled_text = ""

    # --- sensors ---
    def seated(self) -> bool | None:
        return None

    def find_phone(self) -> tuple[float, float] | None:
        """Phone centre on the desk in mm, or None."""
        return None

    def phone_charging(self) -> bool:
        return False

    # --- actuators ---
    def move_coil(self, x: float, y: float) -> None:
        self.coil = [x, y]

    def set_focus(self, on: bool) -> None:
        self.focus = on


class SimDesk(Desk):
    """A desk that behaves plausibly with no hardware: you sit, a phone appears, it charges."""

    def __init__(self) -> None:
        super().__init__()
        self._phone = (random.uniform(200, 1000), random.uniform(120, 480))
        self._t0 = time.time()

    def seated(self) -> bool | None:
        return True

    def find_phone(self) -> tuple[float, float] | None:
        return self._phone

    def phone_charging(self) -> bool:
        return self.charge == "charging" and self._dist(self.coil, self._phone) < 5

    def move_coil(self, x: float, y: float) -> None:
        # Glide toward the target so the overlay cat visibly walks.
        cx, cy = self.coil
        step = 25.0
        d = self._dist((cx, cy), (x, y))
        if d <= step:
            self.coil = [x, y]
        else:
            self.coil = [cx + (x - cx) * step / d, cy + (y - cy) * step / d]

    @staticmethod
    def _dist(a, b) -> float:
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


class RealDesk(Desk):
    """Real hardware. GRBL gantry on a serial port; camera + mmWave/pressure sensor for presence.

    Wiring and tuning live in docs/ECLIPSE.md. Each sensor degrades to None when its library or
    device is missing, so the agent still runs and reports what it can.
    """

    def __init__(self, port: str, camera: int) -> None:
        super().__init__()
        import serial  # type: ignore  # pip install pyserial

        self.grbl = serial.Serial(port, 115200, timeout=1)
        time.sleep(2)
        self.grbl.write(b"\r\n\r\n$H\n")  # wake + home
        self.camera = camera

    def move_coil(self, x: float, y: float) -> None:
        x = min(max(x, 0), DESK_W)
        y = min(max(y, 0), DESK_H)
        self.grbl.write(f"G90 G1 X{x:.1f} Y{y:.1f} F6000\n".encode())
        self.coil = [x, y]

    def find_phone(self) -> tuple[float, float] | None:
        try:
            import cv2  # type: ignore  # pip install opencv-python
        except ImportError:
            return None
        cap = cv2.VideoCapture(self.camera)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            return None
        # A phone is the largest dark, roughly 2:1 rectangle on the lit glass.
        grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(grey, 60, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best = None
        for c in contours:
            (cx, cy), (w, h), _ = cv2.minAreaRect(c)
            area = w * h
            ratio = max(w, h) / max(1, min(w, h))
            if area > 4000 and 1.6 < ratio < 2.4 and (best is None or area > best[2]):
                best = (cx, cy, area)
        if not best:
            return None
        fh, fw = grey.shape
        # Camera is calibrated to frame the whole desk; see docs for the homography upgrade.
        return best[0] / fw * DESK_W, best[1] / fh * DESK_H


class Eclipse:
    def __init__(self, url: str, token: str) -> None:
        self.base = url.rstrip("/") + "/eclipse/v1"
        self.token = token

    def call(self, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
            method="POST" if body is not None else "GET",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())


class Agent:
    def __init__(self, desk: Desk, eclipse: Eclipse) -> None:
        self.desk = desk
        self.eclipse = eclipse
        self.outbox: list[dict] = []
        self.hud: dict = {"items": []}
        self.seated: bool | None = None
        self.lock = threading.Lock()

    def emit(self, type_: str, **payload) -> None:
        with self.lock:
            self.outbox.append({"type": type_, "payload": payload})

    # --- commands from Eclipse ---
    def handle(self, cmd: dict) -> None:
        name, args = cmd["command"], cmd.get("args") or {}
        print(f"[cmd] {name} {args}")
        if name == "focus.toggle" or name == "focus.set":
            on = args.get("on", not self.desk.focus) if name == "focus.set" else not self.desk.focus
            self.desk.set_focus(bool(on))
            self.emit("state", focus=self.desk.focus)
        elif name == "charge.seek":
            self.seek()
        elif name == "stand.nudge":
            self.desk.nudge_until = time.time() + 20
        elif name == "oled.show":
            self.desk.oled_text = str(args.get("text", ""))[:200]
        elif name == "ping":
            self.emit("state", pong=int(time.time()))

    def seek(self) -> None:
        spot = self.desk.find_phone()
        if spot is None:
            self.emit("charge", state="idle", reason="no phone found")
            self.desk.charge = "idle"
            return
        self.desk.target = spot
        self.desk.charge = "seeking"
        self.emit("charge", state="seeking", x=round(spot[0]), y=round(spot[1]))

    # --- loops ---
    def tick_hardware(self) -> None:
        d = self.desk
        if d.target:
            d.move_coil(*d.target)
            if abs(d.coil[0] - d.target[0]) < 1 and abs(d.coil[1] - d.target[1]) < 1:
                d.target = None
                d.charge = "charging"
                self.emit("charge", state="charging")
        seated = d.seated()
        if seated is not None and seated != self.seated:
            self.seated = seated
            self.emit("presence", seated=seated)

    def sync(self) -> None:
        with self.lock:
            batch, self.outbox = self.outbox[:50], self.outbox[50:]
        try:
            self.eclipse.call("/events", {"events": batch or [{"type": "heartbeat", "payload": {}}]})
            for cmd in self.eclipse.call("/commands").get("commands", []):
                self.handle(cmd)
            self.hud = self.eclipse.call("/hud")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            print(f"[sync] {e}")
            with self.lock:
                self.outbox = batch + self.outbox  # retry next round

    def overlay_state(self) -> dict:
        d = self.desk
        return {
            "desk": {"w": DESK_W, "h": DESK_H},
            "coil": d.coil,
            "charge": d.charge,
            "focus": d.focus,
            "nudge": d.nudge_until > time.time(),
            "text": d.oled_text,
            "hud": self.hud.get("items", [])[:3],
        }


def serve_overlay(agent: Agent, port: int) -> None:
    page = (HERE / "overlay.html").read_bytes()

    class H(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/state.json":
                body, ctype = json.dumps(agent.overlay_state()).encode(), "application/json"
            elif self.path in ("/", "/index.html"):
                body, ctype = page, "text/html; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", ctype)
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    # Loopback only: the overlay is for the desk's own screen.
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()


def main() -> None:
    p = argparse.ArgumentParser(description="Eclipse desk agent")
    p.add_argument("--sim", action="store_true", help="simulate the desk hardware")
    p.add_argument("--serial", default=os.environ.get("ECLIPSE_GRBL", "/dev/ttyUSB0"))
    p.add_argument("--camera", type=int, default=int(os.environ.get("ECLIPSE_CAMERA", "0")))
    p.add_argument("--port", type=int, default=8765, help="overlay port")
    p.add_argument("--sync", type=float, default=5.0, help="seconds between Eclipse syncs")
    p.add_argument("--auto-seek", type=float, default=0, help="seek the phone every N seconds (0 = only on command)")
    a = p.parse_args()

    url, token = os.environ.get("ECLIPSE_URL"), os.environ.get("ECLIPSE_TOKEN")
    if not url or not token:
        raise SystemExit("Set ECLIPSE_URL and ECLIPSE_TOKEN (the desk token from the Eclipse page).")

    desk = SimDesk() if a.sim else RealDesk(a.serial, a.camera)
    agent = Agent(desk, Eclipse(url, token))
    print(f"[me] {agent.eclipse.call('/me')['device']}")
    threading.Thread(target=serve_overlay, args=(agent, a.port), daemon=True).start()
    print(f"[overlay] http://127.0.0.1:{a.port}/")

    last_sync = last_seek = 0.0
    while True:
        agent.tick_hardware()
        now = time.time()
        if a.auto_seek and desk.charge in ("idle", "full") and now - last_seek > a.auto_seek:
            last_seek = now
            agent.seek()
        if now - last_sync >= a.sync:
            last_sync = now
            agent.sync()
        time.sleep(0.1)


if __name__ == "__main__":
    main()
