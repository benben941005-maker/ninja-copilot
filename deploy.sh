#!/bin/bash
# ============================================
# Ninja Van Co-Pilot — Cloud Run Deploy Script
# ============================================
# Prerequisites: gcloud CLI installed & logged in
# Run: chmod +x deploy.sh && ./deploy.sh

set -e

# ---- CONFIG — change these ----
PROJECT_ID="your-gcp-project-id"       # your GCP project ID
REGION="asia-southeast1"                # Singapore region
SERVICE_NAME="ninja-copilot"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Prompt for API key if not set
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Enter your Anthropic API key:"
  read -s ANTHROPIC_API_KEY
fi

echo ""
echo "🥷 Deploying Ninja Co-Pilot to Cloud Run..."
echo "Project: $PROJECT_ID | Region: $REGION"
echo ""

# 1. Set GCP project
gcloud config set project $PROJECT_ID

# 2. Enable required APIs
echo "Enabling APIs..."
gcloud services enable cloudbuild.googleapis.com run.googleapis.com containerregistry.googleapis.com

# 3. Build & push Docker image
echo "Building Docker image..."
gcloud builds submit --tag $IMAGE_NAME .

# 4. Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --port 8080

# 5. Get the URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')

echo ""
echo "✅ DEPLOYED SUCCESSFULLY!"
echo "🌐 Your app URL: $SERVICE_URL"
echo ""
echo "Open this on your phone: $SERVICE_URL"
