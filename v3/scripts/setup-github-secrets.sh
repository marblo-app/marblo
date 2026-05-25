#!/bin/bash

# GitHub Secrets Setup Script for Marblo Production Deployment
# Prerequisites: GitHub CLI (gh) must be installed and authenticated

set -e

echo "🔐 Setting up GitHub Repository Secrets for Production Deployment"
echo ""

# Check if gh CLI is installed and authenticated
command -v gh >/dev/null 2>&1 || { echo "❌ GitHub CLI not found. Please install it first: https://cli.github.com/"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ GitHub CLI not authenticated. Run 'gh auth login' first."; exit 1; }

# Get repository information
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Repository: $REPO"
echo ""

# Function to safely set secret (checks if already exists)
set_secret() {
    local name="$1"
    local description="$2"

    echo "Setting secret: $name"
    read -s -p "Enter value for $name ($description): " value
    echo ""

    if [ -n "$value" ]; then
        gh secret set "$name" --body "$value"
        echo "✅ $name set successfully"
    else
        echo "⚠️ Skipped $name (empty value)"
    fi
    echo ""
}

# Function to confirm setup
confirm_setup() {
    echo "This script will set up the following GitHub repository secrets:"
    echo ""
    echo "🏗️ GCP & Infrastructure:"
    echo "  - GCP_PROJECT_ID"
    echo "  - GCP_REGION"
    echo "  - GCP_SA_KEY"
    echo ""
    echo "🗄️ Database:"
    echo "  - DATABASE_URL_PROD"
    echo "  - DATABASE_URL_MIGRATION"
    echo ""
    echo "🔒 Security & Monitoring:"
    echo "  - SECRET_KEY_PROD"
    echo "  - SENTRY_DSN_PROD"
    echo "  - VITE_SENTRY_DSN_PROD"
    echo ""
    echo "💳 Payment Gateways:"
    echo "  - TOSS_*_PROD (4 secrets)"
    echo "  - NAVERPAY_*_PROD (4 secrets)"
    echo ""
    echo "🔥 Firebase Configuration:"
    echo "  - FIREBASE_*_PROD (8 secrets)"
    echo ""
    echo "🔔 Notifications:"
    echo "  - SLACK_WEBHOOK_URL"
    echo ""
    read -p "Continue with secret setup? (y/N): " confirm
    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
    echo ""
}

# Main setup function
main() {
    confirm_setup

    echo "🏗️ GCP & Infrastructure Secrets"
    echo "================================"
    set_secret "GCP_PROJECT_ID" "GCP Project ID (e.g., marblo-prod-123456)"
    set_secret "GCP_REGION" "GCP Region (default: asia-northeast3)"
    set_secret "GCP_SA_KEY" "GCP Service Account JSON Key (base64 encoded)"

    echo "🗄️ Database Secrets"
    echo "==================="
    set_secret "DATABASE_URL_PROD" "Production Database URL"
    set_secret "DATABASE_URL_MIGRATION" "Migration Database URL (usually same as prod)"

    echo "🔒 Security & Monitoring Secrets"
    echo "================================="
    set_secret "SECRET_KEY_PROD" "JWT Secret Key (32+ characters)"
    set_secret "SENTRY_DSN_PROD" "Sentry DSN for backend"
    set_secret "VITE_SENTRY_DSN_PROD" "Sentry DSN for frontend"

    echo "💳 Payment Gateway Secrets"
    echo "=========================="
    set_secret "TOSS_CLIENT_KEY_PROD" "TossPayments Live Client Key"
    set_secret "TOSS_SECRET_KEY_PROD" "TossPayments Live Secret Key"
    set_secret "TOSS_WEBHOOK_SECRET_PROD" "TossPayments Webhook Secret"
    set_secret "VITE_TOSS_CLIENT_KEY_PROD" "TossPayments Client Key for Frontend"

    set_secret "NAVERPAY_MERCHANT_ID_PROD" "NaverPay Merchant ID"
    set_secret "NAVERPAY_API_KEY_PROD" "NaverPay API Key"
    set_secret "NAVERPAY_SECRET_KEY_PROD" "NaverPay Secret Key"
    set_secret "NAVERPAY_WEBHOOK_SECRET_PROD" "NaverPay Webhook Secret"

    echo "🌐 Frontend Configuration Secrets"
    echo "=================================="
    set_secret "VITE_API_BASE_URL_PROD" "Production API Base URL (e.g., https://api.marblo.co.kr)"
    set_secret "VITE_PADDLE_CLIENT_TOKEN_PROD" "Paddle Client Token"

    echo "🔥 Firebase Configuration Secrets"
    echo "=================================="
    set_secret "FIREBASE_SERVICE_ACCOUNT_PROD" "Firebase Service Account JSON"
    set_secret "FIREBASE_PROJECT_ID_PROD" "Firebase Project ID"
    set_secret "VITE_FIREBASE_API_KEY_PROD" "Firebase API Key"
    set_secret "VITE_FIREBASE_AUTH_DOMAIN_PROD" "Firebase Auth Domain"
    set_secret "VITE_FIREBASE_PROJECT_ID_PROD" "Firebase Project ID (for frontend)"
    set_secret "VITE_FIREBASE_STORAGE_BUCKET_PROD" "Firebase Storage Bucket"
    set_secret "VITE_FIREBASE_MESSAGING_SENDER_ID_PROD" "Firebase Messaging Sender ID"
    set_secret "VITE_FIREBASE_APP_ID_PROD" "Firebase App ID"

    echo "🔔 Notification Secrets"
    echo "======================="
    set_secret "SLACK_WEBHOOK_URL" "Slack Webhook URL for deployment notifications"

    echo ""
    echo "✅ GitHub Secrets setup completed!"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Verify all secrets are set: gh secret list"
    echo "2. Run database setup: ./scripts/setup-database.sh"
    echo "3. Test deployment pipeline by pushing to main branch"
    echo ""
}

# Run main function
main