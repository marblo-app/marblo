#!/bin/bash

# GCP Cloud Run Deployment Script for Marblo Backend

set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast3"}
SERVICE_NAME="marblo-backend"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Starting Cloud Run deployment..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"

# Check if required tools are installed
command -v gcloud >/dev/null 2>&1 || { echo "❌ gcloud CLI not found. Please install it first."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker not found. Please install it first."; exit 1; }

# Authenticate with Google Cloud
echo "🔐 Authenticating with Google Cloud..."
gcloud auth configure-docker gcr.io

# Set the project
gcloud config set project $PROJECT_ID

# Build the Docker image
echo "🔨 Building Docker image..."
cd backend
docker build -f Dockerfile.cloudrun -t $IMAGE_NAME:latest .

# Push to Google Container Registry
echo "📤 Pushing image to GCR..."
docker push $IMAGE_NAME:latest

# Create secrets in Google Secret Manager
echo "🔒 Setting up secrets..."

# Database URL secret
gcloud secrets create database-url --data-file=- <<< "$DATABASE_URL" || echo "Secret database-url already exists"

# App secrets
gcloud secrets create app-secrets --data-file=- <<< "$SECRET_KEY" || echo "Secret app-secrets already exists"

# Monitoring secrets
gcloud secrets create monitoring-secrets --data-file=- <<< "$SENTRY_DSN" || echo "Secret monitoring-secrets already exists"

# Payment secrets (create as JSON)
cat > /tmp/payment-secrets.json << EOF
{
  "toss-client-key": "$TOSS_CLIENT_KEY",
  "toss-secret-key": "$TOSS_SECRET_KEY",
  "toss-webhook-secret": "$TOSS_WEBHOOK_SECRET",
  "naverpay-merchant-id": "$NAVERPAY_MERCHANT_ID",
  "naverpay-api-key": "$NAVERPAY_API_KEY",
  "naverpay-secret-key": "$NAVERPAY_SECRET_KEY",
  "naverpay-webhook-secret": "$NAVERPAY_WEBHOOK_SECRET"
}
EOF

gcloud secrets create payment-secrets --data-file=/tmp/payment-secrets.json || echo "Secret payment-secrets already exists"
rm /tmp/payment-secrets.json

# Enable required APIs
echo "🔌 Enabling required APIs..."
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable sqladmin.googleapis.com

# Create service account
echo "👤 Setting up service account..."
gcloud iam service-accounts create marblo-service-account \
  --description="Service account for Marblo backend" \
  --display-name="Marblo Service Account" || echo "Service account already exists"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:marblo-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:marblo-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Deploy to Cloud Run
echo "🚢 Deploying to Cloud Run..."
cd ..
gcloud run services replace cloudrun.yaml --region=$REGION

# Update the image
gcloud run services update-traffic $SERVICE_NAME --to-latest --region=$REGION

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo "✅ Deployment successful!"
echo "🌐 Service URL: $SERVICE_URL"
echo "📊 Monitor your service: https://console.cloud.google.com/run/detail/$REGION/$SERVICE_NAME"

# Health check
echo "🏥 Performing health check..."
sleep 30
if curl -f "$SERVICE_URL/health"; then
  echo "✅ Health check passed!"
else
  echo "❌ Health check failed. Please check the logs."
  echo "📋 View logs: gcloud logs read --service=$SERVICE_NAME --region=$REGION"
fi

echo "🎉 Deployment complete!"