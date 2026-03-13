
# Ninja Van AI Driver Copilot 🚚🤖

AI-powered delivery assistant designed for **Ninja Van drivers**.  
This project demonstrates how artificial intelligence can assist drivers with navigation, parcel scanning, voice commands, and smart routing.

Built as an **NTU Data Science & AI Capstone Project**.

---

# Project Vision

Create a **Tesla‑style AI copilot for delivery drivers** that helps them:

• Navigate faster  
• Reduce delivery time  
• Automate parcel handling  
• Communicate with customers automatically  

The goal is to improve **last‑mile logistics efficiency** using AI.

---

# Core Features

## 📍 GPS Driver Navigation
- Detects driver location automatically
- Calculates optimal route to destination
- Turn‑by‑turn navigation instructions

## 🎤 Always‑On Voice Assistant
Hands‑free driver interaction.

Example commands:
- “Navigate to Jurong Point”
- “Nearest toilet”
- “Nearest petrol station”

## 🧠 AI Navigation Assistant
Uses LLM to give short actionable instructions like:

START DRIVE  
TURN LEFT  
GO STRAIGHT 300M

## 📦 Parcel Label OCR
Driver can scan parcel labels using camera.

AI extracts:
- Address
- Postal code
- Recipient
- Phone number

## 📷 Street Recognition (AI Vision)
Driver can point camera at buildings to detect:
- street names
- building numbers
- nearby landmarks

## ☔ Weather Awareness
Detects rain conditions and can warn driver about delays.

## 💬 Customer ETA Messaging
When driver is **5 minutes away**, system can automatically notify customer via WhatsApp.

## 🚀 Smart Route Planning
Future version includes:

- multi‑parcel route optimization
- delivery clustering
- ETA prediction

---

# System Architecture

Driver Phone  
↓  
Web App (HTML + JS)  
↓  
Flask Backend (Python)  
↓  
AI APIs

Services used:

• OpenAI / Claude (AI assistant)  
• OneMap.sg (Singapore geocoding)  
• OSRM (routing engine)  
• WeatherAPI (weather detection)

---

# Tech Stack

Frontend
- HTML
- JavaScript
- Web Speech API
- Camera API

Backend
- Python
- Flask

AI
- OpenAI GPT‑4o
- Claude Sonnet

Maps
- OneMap.sg
- OpenStreetMap
- OSRM

Deployment
- Docker
- Google Cloud Run
- GitHub Actions CI/CD

---

# Deployment Architecture

GitHub Repository  
↓  
GitHub Actions CI/CD  
↓  
Docker Build  
↓  
Google Cloud Run  
↓  
Public Web App

---

# How To Run Locally

Install dependencies

pip install -r requirements.txt

Run server

python main.py

Open browser

http://localhost:8080

---

# Environment Variables

These are configured using **GitHub Secrets** for deployment.

ANTHROPIC_API_KEY  
OPENAI_API_KEY  
GOOGLE_PLACES_API_KEY  
ONEMAP_EMAIL  
ONEMAP_PASSWORD  
WEATHER_API_KEY

---

# Example Driver Workflow

1️⃣ Driver opens AI Copilot on phone

2️⃣ GPS detects driver location

3️⃣ Driver says:
“Navigate to IMM Mall”

4️⃣ AI finds nearest IMM

5️⃣ Turn‑by‑turn navigation starts

6️⃣ Driver scans parcel label

7️⃣ AI extracts delivery address

8️⃣ Customer receives ETA notification

---

# Future Improvements

• Driver fatigue detection  
• Traffic prediction AI  
• Delivery time forecasting  
• Parcel sorting automation  
• Warehouse AI integration

---

# Capstone Project Goal

Demonstrate how **AI can transform last‑mile logistics** by assisting delivery drivers with:

navigation  
parcel processing  
customer communication  

This system shows a **prototype AI copilot for logistics companies like Ninja Van**.

---

# Author

NTU Data Science & AI Student

Capstone Project:  
**AI Driver Copilot for Logistics**
