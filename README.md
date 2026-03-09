# Ninja Co-Pilot — AI Driver Assistant

## Project Structure
```
ninja-copilot/
├── static/
│   ├── index.html          ← Frontend UI
│   └── ai-driver-copilot.js ← Vanilla JS (no React needed)
├── main.py                  ← Flask backend (proxies API calls)
├── Dockerfile               ← Cloud Run deployment
├── requirements.txt         ← Python dependencies
└── README.md
```

## Features
- **Image auto-compression**: Resizes + compresses to under 4MB (fixes 5MB API limit error)
- **Auto language detection**: No language selector needed — AI detects English, Chinese, Malay, Tamil, Thai, Vietnamese, etc.
- **Short structured replies**: Max 60 words, no slang, professional bullet-point format
- **Voice input**: Tap to speak in any language (browser auto-detects)
- **Voice output**: AI reads responses and navigation steps aloud
- **GPS tracking**: Shows live GPS status
- **Map + turn-by-turn nav**: Google Maps embed + step-by-step voice directions
- **Smart POI search**: Google Places API for real business locations (nearest Haidilao, petrol station, etc.), OneMap.sg fallback for Singapore addresses
- **Street recognition**: Take a photo of road signs/buildings to identify your location
- **Dual API support**: Works with Claude API or OpenAI GPT-4o

## Deploy to Cloud Run

### 1. Set environment variables
```bash
# Use Claude (default)
export ANTHROPIC_API_KEY="sk-ant-..."
export AI_PROVIDER="claude"

# Optional: Google Places API for accurate POI search (recommended)
export GOOGLE_PLACES_API_KEY="AIza..."

# Optional: Weather alerts
export WEATHER_API_KEY="..."

# OR use OpenAI
export OPENAI_API_KEY="sk-..."
export AI_PROVIDER="openai"
```

### 2. Build and deploy
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT/ninja-copilot
gcloud run deploy ninja-copilot \
  --image gcr.io/YOUR_PROJECT/ninja-copilot \
  --platform managed \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars "ANTHROPIC_API_KEY=sk-ant-...,AI_PROVIDER=claude"
```

### 3. Test locally
```bash
pip install -r requirements.txt
ANTHROPIC_API_KEY="your-key" python main.py
# Open http://localhost:8080
```

## API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves index.html |
| `/api/chat` | POST | Text chat with AI |
| `/api/scan` | POST | Image OCR + address extraction |
| `/api/poi-search` | GET | POI/business search (Google Places → Nominatim fallback) |
| `/api/address-to-latlng` | GET | Forward geocode (OneMap → Nominatim fallback) |
| `/api/route` | GET | Turn-by-turn directions via OSRM |
| `/api/weather` | GET | Weather check at destination |
| `/api/geocode` | GET | Reverse geocode GPS to address |

## Switching between Claude and OpenAI
Set the `AI_PROVIDER` environment variable:
- `claude` → Uses Claude Sonnet (default)
- `openai` → Uses GPT-4o (requires `OPENAI_API_KEY`)
