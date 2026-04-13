#!/usr/bin/env python3
"""
pi_gateway.py
─────────────
Runs on Raspberry Pi with LoRa HAT (SX1276 / LLCC68).
Listens for JSON packets from the ESP32 scale nodes,
then forwards weight readings directly to Supabase REST API.
The React dashboard receives the update instantly via Supabase Realtime.

Requirements:
  pip install requests RPi.GPIO spidev

For pyLoRa (SX1276):
  pip install pyLoRa

Usage:
  python3 pi_gateway.py
"""

import time
import json
import logging
import requests

# ── Supabase config ──────────────────────────────────────────────────────────
SUPABASE_URL = "https://rlcvrkeozciihjhstbop.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsY3Zya2VvemNpaWhqaHN0Ym9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjYxNjYsImV4cCI6MjA5MDY0MjE2Nn0.Krp2lMYPj-do6yFBDFns-5fwRKzEobgHIjrz0hT4PAQ"

HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

# ── Supabase sender ──────────────────────────────────────────────────────────

def send_reading(scale_id: str, weight_g: float) -> bool:
    """Insert one weight reading into Supabase. Returns True on success."""
    try:
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/readings",
            headers=HEADERS,
            json={"scale_id": scale_id, "weight_g": round(weight_g, 2)},
            timeout=10,
        )
        if r.status_code in (200, 201):
            log.info(f"[{scale_id}] {weight_g:.2f} g → Supabase OK")
            return True
        else:
            log.error(f"[{scale_id}] Supabase error {r.status_code}: {r.text}")
            return False
    except requests.RequestException as e:
        log.error(f"Network error: {e}")
        return False

# ── LoRa listener ────────────────────────────────────────────────────────────

def run_lora():
    """
    Real hardware loop using pyLoRa.
    ESP32 packet format: {"id":"scale_1","w":1234.56}
    """
    try:
        from SX127x.LoRa import LoRa
        from SX127x.board_config import BOARD
    except ImportError:
        log.error("pyLoRa not installed. Run: pip install pyLoRa")
        return

    BOARD.setup()

    class ScaleReceiver(LoRa):
        def __init__(self, verbose=False):
            super().__init__(verbose)
            self.set_mode(0x81)      # RXCONT
            self.set_freq(915.0)     # 915 MHz US band — change to 868.0 for EU
            self.set_bw(7)           # 125 kHz
            self.set_coding_rate(5)  # 4/5
            self.set_spreading_factor(7)

        def on_rx_done(self):
            payload = self.read_payload(nocheck=True)
            self.clear_irq_flags(RxDone=1)
            try:
                text = bytes(payload).decode("utf-8").strip()
                data = json.loads(text)
                send_reading(data["id"], float(data["w"]))
            except Exception as e:
                log.warning(f"Bad packet: {e} | raw={payload}")

    lora = ScaleReceiver()
    log.info("LoRa gateway listening on 915 MHz…")
    try:
        while True:
            time.sleep(0.1)
    except KeyboardInterrupt:
        log.info("Shutting down")
    finally:
        BOARD.teardown()


# ── Demo / simulation mode (no hardware) ─────────────────────────────────────

def run_simulation():
    """
    Simulate two scales sending readings every 10 seconds.
    Useful for testing the dashboard before hardware is ready.
    """
    import random
    log.info("Running in SIMULATION mode (no LoRa hardware). Ctrl-C to stop.")
    base = {"scale_1": 1500.0, "scale_2": 2000.0}
    while True:
        for scale_id, w in base.items():
            # Small random drift to simulate real sensor noise
            weight = max(0, w + random.uniform(-20, 20))
            send_reading(scale_id, weight)
        time.sleep(10)


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if "--simulate" in sys.argv:
        run_simulation()
    else:
        run_lora()
