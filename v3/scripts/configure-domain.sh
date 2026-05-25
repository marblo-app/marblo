#!/bin/bash

# Domain and SSL Configuration Script for Marblo Production
# This script helps configure custom domain and SSL for Cloud Run

set -e

echo "🌐 Marblo Domain and SSL Configuration"
echo "====================================="
echo ""

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast3"}
SERVICE_NAME="marblo-backend"

# Check if required tools are installed
command -v gcloud >/dev/null 2>&1 || { echo "❌ gcloud CLI not found. Please install it first."; exit 1; }

# Function to get user input
get_domain() {
    echo "Enter your domain information:"
    read -p "Main domain (e.g., marblo.co.kr): " MAIN_DOMAIN
    read -p "API subdomain (e.g., api.marblo.co.kr): " API_DOMAIN

    if [[ -z "$MAIN_DOMAIN" || -z "$API_DOMAIN" ]]; then
        echo "❌ Domain information is required"
        exit 1
    fi

    echo ""
    echo "Domain Configuration:"
    echo "Main Domain: $MAIN_DOMAIN"
    echo "API Domain: $API_DOMAIN"
    echo ""
}

# Function to verify domain ownership
verify_domain() {
    echo "📋 Domain Verification Steps:"
    echo ""
    echo "1. Make sure you own the domain: $MAIN_DOMAIN"
    echo "2. You'll need to add DNS records to verify ownership"
    echo "3. Create the following DNS records:"
    echo ""
    echo "   For $API_DOMAIN:"
    echo "   Type: CNAME"
    echo "   Name: api (or whatever subdomain prefix you chose)"
    echo "   Value: ghs.googlehosted.com"
    echo ""
    read -p "Have you configured the DNS CNAME record? (y/N): " dns_configured
    if [[ ! $dns_configured =~ ^[Yy]$ ]]; then
        echo "❌ Please configure DNS first, then run this script again"
        exit 0
    fi
    echo ""
}

# Function to enable required APIs
enable_apis() {
    echo "🔌 Enabling required Google Cloud APIs..."

    gcloud services enable run.googleapis.com
    gcloud services enable domains.googleapis.com
    gcloud services enable certificatemanager.googleapis.com

    echo "✅ APIs enabled successfully"
    echo ""
}

# Function to create managed SSL certificate
create_ssl_certificate() {
    echo "🔒 Creating Google-managed SSL certificate..."

    # Create SSL certificate
    gcloud compute ssl-certificates create marblo-ssl-cert \
        --domains=$API_DOMAIN \
        --global \
        --project=$PROJECT_ID || echo "Certificate may already exist"

    echo "✅ SSL certificate creation initiated"
    echo "⏳ Note: SSL certificate provisioning can take 10-60 minutes"
    echo ""
}

# Function to map custom domain to Cloud Run
map_domain() {
    echo "🗺️ Mapping custom domain to Cloud Run service..."

    # Create domain mapping
    gcloud run domain-mappings create \
        --service=$SERVICE_NAME \
        --domain=$API_DOMAIN \
        --region=$REGION \
        --project=$PROJECT_ID || echo "Domain mapping may already exist"

    echo "✅ Domain mapping created"
    echo ""
}

# Function to update configuration files
update_configs() {
    echo "📝 Updating configuration files with new domain..."

    # Update .env.prod
    if [ -f ".env.prod" ]; then
        sed -i.bak "s/your-domain.com/$MAIN_DOMAIN/g" .env.prod
        sed -i.bak "s/DOMAIN=.*/DOMAIN=$MAIN_DOMAIN/" .env.prod
        echo "✅ Updated .env.prod"
    fi

    # Update cloudrun.yaml CORS settings
    if [ -f "cloudrun.yaml" ]; then
        sed -i.bak "s/your-domain.com/$MAIN_DOMAIN/g" cloudrun.yaml
        echo "✅ Updated cloudrun.yaml"
    fi

    # Update nginx configuration
    if [ -f "nginx/nginx.conf" ]; then
        sed -i.bak "s/your-domain.com/$MAIN_DOMAIN/g" nginx/nginx.conf
        sed -i.bak "s/api.your-domain.com/$API_DOMAIN/g" nginx/nginx.conf
        echo "✅ Updated nginx.conf"
    fi

    # Update frontend environment variables template
    if [ -f "src/env.example" ]; then
        sed -i.bak "s/your-domain.com/$MAIN_DOMAIN/g" src/env.example
        sed -i.bak "s/api.your-domain.com/$API_DOMAIN/g" src/env.example
        echo "✅ Updated frontend env.example"
    fi

    echo ""
}

# Function to check domain mapping status
check_status() {
    echo "🔍 Checking domain mapping status..."
    echo ""

    gcloud run domain-mappings describe $API_DOMAIN \
        --region=$REGION \
        --project=$PROJECT_ID \
        --format="table(spec.routeSpec.url,status.conditions[].type:label=STATUS,status.conditions[].status:label=READY)" || echo "Domain mapping not found"

    echo ""
    echo "🔒 Checking SSL certificate status..."
    gcloud compute ssl-certificates describe marblo-ssl-cert \
        --global \
        --project=$PROJECT_ID \
        --format="table(name,managed.status,managed.domainStatus[].domain:label=DOMAIN,managed.domainStatus[].status:label=DOMAIN_STATUS)" || echo "SSL certificate not found"

    echo ""
}

# Function to show next steps
show_next_steps() {
    echo "✅ Domain and SSL configuration completed!"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Wait for SSL certificate to be provisioned (10-60 minutes)"
    echo "2. Verify domain mapping status: ./scripts/configure-domain.sh status"
    echo "3. Update GitHub secrets with new domain URLs:"
    echo "   - VITE_API_BASE_URL_PROD: https://$API_DOMAIN"
    echo "4. Deploy the application: git push origin main"
    echo "5. Test the deployment:"
    echo "   - API: https://$API_DOMAIN/health"
    echo "   - Docs: https://$API_DOMAIN/docs"
    echo ""
    echo "🌐 Your API will be available at: https://$API_DOMAIN"
    echo "🌐 Your frontend will be available at: https://$MAIN_DOMAIN"
    echo ""
}

# Main function
main() {
    case "${1:-setup}" in
        "setup")
            echo "Starting domain and SSL setup..."
            echo ""
            get_domain
            verify_domain
            enable_apis
            create_ssl_certificate
            map_domain
            update_configs
            show_next_steps
            ;;
        "status")
            echo "Checking domain and SSL status..."
            check_status
            ;;
        "help")
            echo "Usage: $0 [setup|status|help]"
            echo ""
            echo "Commands:"
            echo "  setup  - Configure domain and SSL (default)"
            echo "  status - Check configuration status"
            echo "  help   - Show this help message"
            ;;
        *)
            echo "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Set project context
gcloud config set project $PROJECT_ID

# Run main function with command line arguments
main "$@"