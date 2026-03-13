# 🚚 AI Senior Driver Copilot

> An AI-powered last-mile delivery assistant that guides drivers with voice AI, computer vision, smart navigation, and automated customer communication.

![Python](https://img.shields.io/badge/Python-3.11-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-0.110-green) ![Claude AI](https://img.shields.io/badge/Claude-AI-orange) ![Docker](https://img.shields.io/badge/Docker-Ready-blue) ![GCP](https://img.shields.io/badge/GCP-Cloud%20Run-red)

---

## 📋 Project Overview

This capstone project demonstrates how **Generative AI, Computer Vision, Voice AI, and Automation** can transform last-mile delivery logistics.

The **AI Senior Driver Copilot** acts as a digital companion for delivery drivers, providing:

- 🎙️ **Voice AI** — Hands-free interaction via speech recognition
- 📦 **Parcel OCR** — Scan labels to extract addresses automatically
- 🗺️ **Smart Navigation** — OneMap + Google Places routing for Singapore
- 🌦️ **Weather Alerts** — Real-time weather-based delivery warnings
- 📱 **Customer Notifications** — Automated ETA messaging
- 🤖 **AI Assistant** — Claude-powered delivery guidance chat

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│              Mobile Web Frontend                │
│         (HTML5 + CSS3 + Vanilla JS)             │
└──────────────────┬──────────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────────┐
│           FastAPI Backend (Python)              │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ /chat    │ │ /ocr     │ │ /navigation     │ │
│  │ Claude   │ │ GPT-4V   │ │ OneMap + Google │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ /weather │ │ /voice   │ │ /notify         │ │
│  │ WeatherAPI│ │ Whisper  │ │ Auto-messaging  │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Google Cloud Run                   │
│         Docker Container + CI/CD                │
└─────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Docker & Docker Compose
- API Keys (see Environment Variables)

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/ai-driver-copilot.git
cd ai-driver-copilot

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# 3. Install dependencies
cd backend
pip install -r requirements.txt

# 4. Run the backend
uvicorn main:app --reload --port 8000

# 5. Open frontend
open frontend/index.html
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up --build

# Access at http://localhost:8000
```

---

## 🔑 Environment Variables

```env
# AI Models
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here

# Singapore Maps (OneMap)
ONEMAP_EMAIL=your_email_here
ONEMAP_PASSWORD=your_password_here

# Google Services
GOOGLE_PLACES_API_KEY=your_key_here
GCP_PROJECT_ID=your_project_id

# Weather
WEATHER_API_KEY=your_key_here
```

---

## 📁 Project Structure

```
ai-driver-copilot/
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile              # Backend container
│   ├── routes/
│   │   ├── chat.py             # Claude AI assistant
│   │   ├── ocr.py              # Parcel label scanning (GPT-4 Vision)
│   │   ├── navigation.py       # OneMap + Google Places routing
│   │   ├── weather.py          # Weather monitoring
│   │   ├── voice.py            # Whisper speech recognition
│   │   └── notifications.py    # Customer ETA messaging
│   └── utils/
│       ├── onemap_auth.py      # OneMap token management
│       └── logger.py           # Logging utilities
├── frontend/
│   └── index.html              # Mobile web app (single file)
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD to Google Cloud Run
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🤖 AI Features

### 1. Claude AI Driver Assistant
Drivers can ask questions in natural language:
- *"What's the best way to access Block 123?"*
- *"Customer is not home, what should I do?"*
- *"How do I handle a damaged parcel?"*

### 2. Parcel Label OCR (GPT-4 Vision)
- Take a photo of the parcel label
- AI extracts: recipient name, address, unit number, postal code
- Auto-fills navigation destination

### 3. Voice Interaction (Whisper)
- Record voice commands while driving
- Transcribed and sent to Claude AI
- Hands-free operation

### 4. Singapore Navigation (OneMap)
- Search Singapore addresses with postal codes
- Integrated with OneMap routing API
- Google Places for POI details

### 5. Weather Monitoring
- Real-time Singapore weather
- Automatic delay alerts for heavy rain
- Suggested shelter locations

### 6. Customer Notifications
- Auto-generate ETA messages
- Suggested message templates
- Copy-to-send for WhatsApp/SMS

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message to Claude AI |
| POST | `/api/ocr` | Scan parcel label image |
| POST | `/api/voice` | Transcribe voice recording |
| GET | `/api/navigation/search` | Search address on OneMap |
| GET | `/api/navigation/route` | Get route between two points |
| GET | `/api/weather` | Get current weather |
| POST | `/api/notify/generate` | Generate customer notification |
| GET | `/health` | Health check |

---

## 🌍 Deployment (Google Cloud Run)

The project uses GitHub Actions for automated CI/CD to Google Cloud Run.

**GitHub Secrets required:**
- `GCP_PROJECT_ID`
- `GCP_SA_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_PLACES_API_KEY`
- `ONEMAP_EMAIL`
- `ONEMAP_PASSWORD`
- `WEATHER_API_KEY`

Push to `main` branch triggers automatic deployment.

---

## 🔮 Future Expansion: Multi-Agent Control Tower

```
┌─────────────────────────────────────────┐
│        AI Logistics Control Tower       │
│                                         │
│  Agent 1: Demand Forecasting            │
│  Agent 2: Route Optimization            │
│  Agent 3: Warehouse Operations          │
│  Agent 4: Customer Support              │
│  Agent 5: Pricing Optimization          │
└─────────────────────────────────────────┘
```

---

## 👨‍💻 Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Assistant | Anthropic Claude (claude-sonnet-4-20250514) |
| OCR / Vision | OpenAI GPT-4 Vision |
| Voice | OpenAI Whisper |
| Backend | Python FastAPI |
| Maps | OneMap Singapore + Google Places |
| Weather | WeatherAPI |
| Frontend | HTML5 + CSS3 + Vanilla JS |
| Container | Docker |
| Cloud | Google Cloud Run |
| CI/CD | GitHub Actions |

---

## 📄 License

MIT License — Built as part of AI/ML Capstone Project
