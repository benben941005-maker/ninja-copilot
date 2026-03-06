# 🥷 Ninja Van Co-Pilot — Deployment Guide

## What's Inside
```
ninja-copilot/
├── main.py              ← FastAPI backend (API proxy + serves frontend)
├── requirements.txt     ← Python dependencies
├── Dockerfile           ← Container config for Cloud Run
├── deploy.sh            ← One-command deploy script
└── static/
    └── index.html       ← Mobile app (voice + photo + chat)
```

---

## 🚀 Deploy to Google Cloud Run (Step by Step)

### Step 1 — Install Google Cloud CLI on your laptop
Download from: https://cloud.google.com/sdk/docs/install

Then login:
```bash
gcloud auth login
```

### Step 2 — Create a GCP Project (if you don't have one)
1. Go to https://console.cloud.google.com
2. Click "New Project"
3. Name it: `ninja-copilot`
4. Copy your **Project ID** (e.g. `ninja-copilot-123456`)

### Step 3 — Edit deploy.sh
Open `deploy.sh` and replace:
```bash
PROJECT_ID="your-gcp-project-id"   ← paste your real Project ID here
```

### Step 4 — Run the deploy script
```bash
chmod +x deploy.sh
./deploy.sh
```
It will ask for your Anthropic API key, then:
- Build the Docker container
- Push to Google Container Registry
- Deploy to Cloud Run (Singapore region)
- Give you a live URL like: https://ninja-copilot-abc123-as.a.run.app

### Step 5 — Open on your phone!
Copy the URL → open in Chrome on your phone → done! 🎉

---

## 💰 Cost
- Cloud Run free tier: **2 million requests/month free**
- For a capstone demo: **effectively $0**

---

## 🧪 Test Locally First (Optional)
```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8080
```
Then open: http://localhost:8080

---

## 📱 Features
- 🎙️ Voice input — tap to speak your problem
- 📷 Photo upload — photograph address/parcel/sign
- 🤖 AI vision — analyzes photos and gives guidance
- 🔊 Voice response — AI speaks back to you
- 💬 Full conversation memory
- ⚡ Quick scenario chips for demo
