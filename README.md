# Ninja Co-Pilot v2 — Enhanced AI Driver Assistant

## What's New in v2

### 🗺️ Embedded Live Map
- **Leaflet/OpenStreetMap** map built right into the chat — no external links
- Route drawn as a red polyline on the map
- Your position shown as a pulsing red dot that moves in real-time
- Destination shown as a green marker
- Expand/collapse the map panel; drag to explore, auto-follows when navigating

### 🌤️ Weather Display
- Weather badge in the header shows current conditions + temperature
- Tap the badge for a detailed weather card (nice day ☀️ / bad day ⚠️)
- Auto-fetches weather every 2 minutes based on GPS
- Rain alerts still auto-popup when navigating to a rainy destination

### 🚶🚗 Auto-Detect Walk / Drive
- GPS speed is sampled continuously
- Below ~7 km/h → switches to **Walking** mode (uses OSRM foot profile)
- Above ~7 km/h → switches to **Driving** mode (uses OSRM driving profile)
- Transport mode badge shown in the location bar
- Route instructions adapt ("Start walking…" vs "Start driving…")

### 📷 Photo → Auto Navigate
- Snap a photo of a street sign, block number, building, or parcel label
- AI identifies the address and combines it with your GPS location
- Automatically starts navigation with embedded map + voice directions
- Works for both parcel labels AND street/building photos

### 🗣️ Step-by-Step Voice Navigation
- Current step shown as a banner overlay on the map
- Voice reads each step as you approach it
- ETA and distance remaining shown on the map
- Repeat step button in the route card

## Project Structure
```
ninja-copilot/
├── static/
│   ├── index.html              ← Enhanced UI with Leaflet map
│   └── ai-driver-copilot.js   ← All features in vanilla JS
├── main.py                     ← Flask backend (walk/drive routing)
├── requirements.txt            ← Python dependencies
└── README.md
```

## Deploy

### Local
```bash
pip install -r requirements.txt
ANTHROPIC_API_KEY="sk-ant-..." WEATHER_API_KEY="your-key" python main.py
# Open http://localhost:8080
```

### Cloud Run
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT/ninja-copilot
gcloud run deploy ninja-copilot \
  --image gcr.io/YOUR_PROJECT/ninja-copilot \
  --platform managed \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars "ANTHROPIC_API_KEY=sk-ant-...,WEATHER_API_KEY=your-key,AI_PROVIDER=claude"
```

## API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves the app |
| `/api/chat` | POST | Text chat with AI |
| `/api/scan` | POST | Image OCR + address extraction |
| `/api/route` | GET | Turn-by-turn directions (supports `profile=foot` or `profile=driving`) |
| `/api/weather` | GET | Weather at lat/lng |
| `/api/geocode` | GET | Reverse geocode |
| `/api/address-to-latlng` | GET | Forward geocode |
| `/api/transcribe` | POST | Voice transcription |
