#!/bin/bash

# GCP Cloud SQL Database Setup Script for Marblo

set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast3"}
INSTANCE_NAME="marblo-postgres-prod"
DB_NAME="marblo_prod"
DB_USER="marblo_user"
DB_PASSWORD=${DB_PASSWORD:-$(openssl rand -base64 32)}

echo "🗄️ Setting up Cloud SQL PostgreSQL instance..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Instance: $INSTANCE_NAME"

# Check if required tools are installed
command -v gcloud >/dev/null 2>&1 || { echo "❌ gcloud CLI not found. Please install it first."; exit 1; }

# Set the project
gcloud config set project $PROJECT_ID

# Enable Cloud SQL Admin API
echo "🔌 Enabling Cloud SQL Admin API..."
gcloud services enable sqladmin.googleapis.com

# Create PostgreSQL instance
echo "🏗️ Creating PostgreSQL instance..."
gcloud sql instances create $INSTANCE_NAME \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-type=SSD \
  --storage-size=20GB \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=04 \
  --deletion-protection || echo "Instance already exists"

# Set password for postgres user
echo "🔐 Setting up database authentication..."
gcloud sql users set-password postgres \
  --instance=$INSTANCE_NAME \
  --password=$(openssl rand -base64 32)

# Create application database user
gcloud sql users create $DB_USER \
  --instance=$INSTANCE_NAME \
  --password=$DB_PASSWORD

# Create application database
echo "📦 Creating application database..."
gcloud sql databases create $DB_NAME \
  --instance=$INSTANCE_NAME

# Grant permissions to application user
gcloud sql instances patch $INSTANCE_NAME \
  --database-flags=log_statement=all

# Get connection details
INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe $INSTANCE_NAME --format="value(connectionName)")
PUBLIC_IP=$(gcloud sql instances describe $INSTANCE_NAME --format="value(ipAddresses[0].ipAddress)")

# Create VPC connector for Cloud Run
echo "🌐 Setting up VPC connector..."
gcloud compute networks vpc-access connectors create marblo-connector \
  --region=$REGION \
  --subnet-project=$PROJECT_ID \
  --range=10.8.0.0/28 || echo "VPC connector already exists"

# Generate database URL
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$PUBLIC_IP:5432/$DB_NAME"
DATABASE_URL_PRIVATE="postgresql://$DB_USER:$DB_PASSWORD@/cloudsql/$INSTANCE_CONNECTION_NAME/$DB_NAME"

echo "✅ Database setup complete!"
echo ""
echo "📋 Connection Details:"
echo "Instance Connection Name: $INSTANCE_CONNECTION_NAME"
echo "Database Name: $DB_NAME"
echo "Database User: $DB_USER"
echo "Database Password: $DB_PASSWORD"
echo ""
echo "🔗 Database URLs:"
echo "Public URL: $DATABASE_URL"
echo "Cloud SQL Proxy URL: $DATABASE_URL_PRIVATE"
echo ""
echo "📝 Next Steps:"
echo "1. Store these credentials securely in Secret Manager"
echo "2. Update your .env.prod file with the DATABASE_URL"
echo "3. Run database migrations with: alembic upgrade head"
echo ""
echo "💡 Use the Cloud SQL Proxy URL for Cloud Run deployment"

# Store database URL in Secret Manager
echo "🔒 Storing database URL in Secret Manager..."
echo $DATABASE_URL_PRIVATE | gcloud secrets create database-url --data-file=- || \
echo $DATABASE_URL_PRIVATE | gcloud secrets versions add database-url --data-file=-

echo "🎉 Database setup and secret storage complete!"