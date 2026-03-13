
# 🚚 Ninja Co-Pilot — AI Delivery Driver Assistant

AI-powered logistics assistant designed to help delivery drivers perform last-mile deliveries more efficiently using voice AI, navigation, parcel OCR, and real-time intelligence.

This project demonstrates how modern Generative AI + computer vision + geospatial APIs can transform delivery operations.

---

# 📸 Demo

AI assistant designed for mobile browsers used by delivery drivers.

Features include:
- Voice AI assistant
- Live navigation map
- Parcel OCR scanner
- Weather alerts
- Customer ETA notifications

---

# ✨ Key Features

## 🤖 AI Driver Assistant
Voice-based AI assistant to help drivers interact with the system hands‑free.

Capabilities:
- Ask navigation questions
- Find nearby locations
- Delivery assistance

Powered by:
- Claude AI
- OpenAI (optional)

---

## 📦 Parcel OCR Scanner

Drivers can scan parcel labels to extract:

- Address
- Phone number
- Parcel details

Helps reduce manual typing errors.

---

## 🗺 Smart Navigation

Integrated delivery navigation using:

- OneMap Singapore routing
- Google Places search
- Live map visualization

Example searches:

- "Haidilao near me"
- "Navigate to Orchard Road"
- "Find nearest petrol station"

---

## 🌧 Weather Intelligence

Real‑time weather information to help drivers anticipate delays.

Features:

- Rain alerts
- ETA adjustment
- Delivery delay prediction

---

## 📱 Customer Notification

Automatically notify customer when driver is close.

Example message:

"Hi, your parcel will arrive within 5 minutes."

Future versions can support:

- WhatsApp automation
- SMS alerts

---

## 🎤 Voice Interface

Drivers can control the system using voice commands.

Examples:

- "Navigate to 123 Orchard Road"
- "Scan parcel"
- "Call customer"
- "Find nearest coffee shop"

Uses browser speech recognition.

---

# 🧠 Technology Stack

## Frontend

- HTML5
- CSS3
- JavaScript
- Web Speech API
- Leaflet.js maps

## Backend

- Python 3.11
- FastAPI / Flask
- REST APIs

## AI Services

- Claude AI
- OpenAI GPT models
- Vision AI
- OCR pipelines

## External APIs

| Service | Purpose |
|--------|--------|
| OneMap Singapore | routing and geocoding |
| Google Places | place search |
| WeatherAPI | weather information |

---

# ⚙️ Installation

Clone repository

git clone https://github.com/YOUR_USERNAME/ninja-copilot.git
cd ninja-copilot

Install dependencies

pip install -r requirements.txt

Run locally

python main.py

Open browser

http://localhost:8080

---

# 🔑 Environment Variables

Example configuration:

ANTHROPIC_API_KEY=your_claude_api_key
OPENAI_API_KEY=your_openai_api_key_optional
GOOGLE_PLACES_API_KEY=your_google_places_key
ONEMAP_EMAIL=your_onemap_email
ONEMAP_PASSWORD=your_onemap_password
WEATHER_API_KEY=your_weather_api_key
AI_PROVIDER=claude
PORT=8080

These can also be configured using GitHub Secrets when deploying.

---

# ☁️ Deploy to Google Cloud Run

Build container

gcloud builds submit --tag gcr.io/PROJECT_ID/ninja-copilot

Deploy service

gcloud run deploy ninja-copilot \
--image gcr.io/PROJECT_ID/ninja-copilot \
--platform managed \
--region asia-southeast1 \
--allow-unauthenticated

---

# 🏗 System Architecture

Driver Browser  
↓  
Frontend (HTML + JS)  
↓  
Backend API (Python)  
↓  
AI + External APIs

- Claude AI
- OpenAI
- OneMap SG
- Google Places
- Weather API

---

# 🎓 Capstone Objective

This project demonstrates how AI technologies can improve last‑mile logistics operations.

By combining:

- Generative AI
- Voice interaction
- Computer vision
- Geospatial APIs

the system reduces driver workload and improves delivery efficiency.

---

# 🚀 Future Improvements

Planned upgrades:

- AI route optimization
- Parcel damage detection
- Camera street recognition
- Delivery demand prediction
- Fleet analytics dashboard

---

# 📄 License

MIT License

---

# 👨‍💻 Author

Developed as part of an AI and Data Science Capstone Project exploring real‑world applications of AI in logistics automation.
