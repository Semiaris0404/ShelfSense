# ShelfSense — Live Grocery Inventory Dashboard

Real-time shelf monitoring with LoRa scale integration.
Georgia Tech CREATE-X Capstone · Team 17

---

## Architecture

```
ESP32 + HX711 + LoRa TX  →  Raspberry Pi (pi_gateway_example.py)
                                   ↓  REST POST
                             Supabase (Postgres + Realtime)
                                   ↓  WebSocket
                          React Dashboard (this app)
```

---

## Step 1 — Set up Supabase database

1. Go to: https://supabase.com/dashboard/project/rlcvrkeozciihjhstbop/sql
2. Click "New query"
3. Paste the ENTIRE contents of `supabase_setup.sql`
4. Click "Run"
5. You should see: "Success. No rows returned"

If any line errors on "already exists" — that's fine, skip it.

**Verify Realtime is on:**
- Supabase Dashboard → Database → Replication
- Make sure `readings`, `invoices`, `checkouts`, `scales` are listed under supabase_realtime publication

---

## Step 2 — Run locally

```bash
# 1. Install dependencies
npm install

# 2. .env is already pre-filled with your Supabase credentials
#    (check .env file — should have VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)

# 3. Start dev server
npm run dev

# 4. Open: http://localhost:5173
```

Expected result: dashboard loads, shows 2 scale cards, stats all show 0 or —

---

## Step 3 — Test all features manually

In the dashboard:

1. **Set Invoice** — type 100 in scale_1 invoice box, click "Add Invoice"
   → "Total Invoiced" should jump to 100

2. **Manual Weight** — type 1500 (grams), click Submit
   → "On Shelf" updates instantly (1500 ÷ 150g/apple = 10 apples)
   → "In Storage" = 100 − 10 = 90

3. **POS Checkout** — type 5, click Checkout
   → "Checked Out" = 5, message shows expected shelf count

4. **Discrepancy** — submit a weight that makes items_on_shelf + checkouts < invoiced
   → Red discrepancy cell + yellow banner appear

5. **Configure Scale** — open ⚙ Configure, change item name and unit weight, Save
   → Header and all calculations update

---

## Step 4 — Deploy publicly (Vercel, free)

```bash
# Option A: Vercel CLI
npm install -g vercel
vercel          # follow prompts, set env vars when asked

# Option B: GitHub + Vercel (recommended)
# 1. Push this folder to a GitHub repo
git init && git add . && git commit -m "ShelfSense v1"
git remote add origin https://github.com/YOUR_USERNAME/shelfsense.git
git push -u origin main

# 2. Go to https://vercel.com → New Project → Import your repo
# 3. Vercel auto-detects Vite. Add environment variables:
#      VITE_SUPABASE_URL     = https://rlcvrkeozciihjhstbop.supabase.co
#      VITE_SUPABASE_ANON_KEY = eyJhbGci...
# 4. Click Deploy → get public URL like https://shelfsense.vercel.app
```

Anyone with the URL can view and interact with the dashboard in real-time.

---

## Step 5 — Connect Raspberry Pi gateway

```bash
# On your Pi:
pip install requests pyLoRa RPi.GPIO spidev

# Test without hardware first:
python3 pi_gateway_example.py --simulate
# → Sends fake readings every 10s; watch the dashboard update live

# With real LoRa HAT:
python3 pi_gateway_example.py
```

Or send a single reading via curl (test from any machine):

```bash
curl -X POST \
  'https://rlcvrkeozciihjhstbop.supabase.co/rest/v1/readings' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"scale_id":"scale_1","raw_value":123456}'
```

---

## ESP32 Arduino sketch (scale node side)

```cpp
#include <HX711.h>
#include <LoRa.h>
#include <ArduinoJson.h>

const char* SCALE_ID = "scale_1";  // or "scale_2" on second unit
HX711 scale;

void setup() {
  scale.begin(DOUT_PIN, CLK_PIN);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();
  LoRa.begin(915E6);  // 915 MHz US
}

void loop() {
  // Send the RAW load-cell value, not grams.
  // Tare and calibration are computed in the dashboard from this raw value.
  long raw = scale.read_average(5);  // average 5 ADC samples

  StaticJsonDocument<64> doc;
  doc["id"] = SCALE_ID;
  doc["r"]  = raw;

  String packet;
  serializeJson(doc, packet);
  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();

  delay(10000);  // 10 seconds
}
```

---

## How discrepancy is calculated

```
items_on_shelf   = (raw_value − tare_offset) ÷ K_calibration   (from LoRa, computed live)
items_checked_out = cumulative POS clicks              (from dashboard)
total_invoiced   = cumulative invoice entries          (from dashboard)
items_in_storage = total_invoiced − on_shelf − checked_out

discrepancy (missing items) = max(0, −items_in_storage)
```

If `items_in_storage` goes negative, items are unaccounted for.
This flags theft, spoilage, misplacement, or scanning errors.

---

## File structure

```
shelfsense/
├── .env                     ← Supabase credentials (never commit to public repo)
├── index.html
├── package.json
├── vite.config.js
├── supabase_setup.sql       ← Run this in Supabase SQL Editor
├── pi_gateway_example.py    ← Run this on Raspberry Pi
└── src/
    ├── main.jsx
    ├── App.jsx               ← Main dashboard component
    ├── App.css               ← All styles
    └── supabaseClient.js     ← Supabase singleton
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Missing VITE_SUPABASE_URL" error | Check .env file exists with correct values |
| Stats don't update in real-time | Check Supabase Realtime is enabled (Step 1, verify step) |
| RLS errors in console | Re-run the RLS policy section of supabase_setup.sql |
| Scale shows — for weight | No reading submitted yet; use Manual Weight Input to test |
| Pi curl returns 401 | Double-check apikey header matches ANON key exactly |
