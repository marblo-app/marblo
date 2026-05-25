#!/bin/bash

# Production Deployment Test Script for Marblo
# Comprehensive testing suite for production deployment verification

set -e

echo "🚀 Marblo Production Deployment Test Suite"
echo "=========================================="
echo ""

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast3"}
SERVICE_NAME="marblo-backend"
API_DOMAIN=${API_DOMAIN:-"api.marblo.co.kr"}
MAIN_DOMAIN=${MAIN_DOMAIN:-"marblo.co.kr"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASSED_TESTS=0
FAILED_TESTS=0

# Helper functions
log_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
    ((PASSED_TESTS++))
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    ((FAILED_TESTS++))
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if gcloud is installed and authenticated
    if ! command -v gcloud >/dev/null 2>&1; then
        log_error "gcloud CLI not found. Please install it first."
        exit 1
    fi

    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        log_error "gcloud not authenticated. Run 'gcloud auth login' first."
        exit 1
    fi

    # Check if curl is installed
    if ! command -v curl >/dev/null 2>&1; then
        log_error "curl not found. Please install it first."
        exit 1
    fi

    log_success "Prerequisites check passed"
    echo ""
}

# Test functions
test_cloud_run_service() {
    log_info "Testing Cloud Run service deployment..."

    # Check if service exists
    if gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID >/dev/null 2>&1; then
        log_success "Cloud Run service '$SERVICE_NAME' exists"

        # Get service URL
        SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)")
        log_success "Service URL: $SERVICE_URL"

        # Test health endpoint
        if curl -f -s "$SERVICE_URL/health" >/dev/null; then
            log_success "Health endpoint responding"
        else
            log_error "Health endpoint not responding"
        fi
    else
        log_error "Cloud Run service '$SERVICE_NAME' not found"
    fi
    echo ""
}

test_database_connection() {
    log_info "Testing database connection..."

    # Get service URL for database test
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)" 2>/dev/null || echo "")

    if [ -n "$SERVICE_URL" ]; then
        # Test database endpoint (assumes /api/health/db endpoint exists)
        RESPONSE=$(curl -s "$SERVICE_URL/health" | jq -r '.database // "unknown"' 2>/dev/null || echo "unknown")
        if [ "$RESPONSE" = "connected" ] || [ "$RESPONSE" = "ok" ]; then
            log_success "Database connection verified"
        else
            log_error "Database connection test failed: $RESPONSE"
        fi
    else
        log_error "Cannot test database - service URL not available"
    fi
    echo ""
}

test_domain_mapping() {
    log_info "Testing custom domain mapping..."

    # Check if domain mapping exists
    if gcloud run domain-mappings describe $API_DOMAIN --region=$REGION --project=$PROJECT_ID >/dev/null 2>&1; then
        log_success "Domain mapping for '$API_DOMAIN' exists"

        # Test HTTPS endpoint
        if curl -f -s "https://$API_DOMAIN/health" >/dev/null; then
            log_success "Custom domain HTTPS endpoint responding"
        else
            log_error "Custom domain HTTPS endpoint not responding"
        fi
    else
        log_error "Domain mapping for '$API_DOMAIN' not found"
    fi
    echo ""
}

test_ssl_certificate() {
    log_info "Testing SSL certificate..."

    # Check SSL certificate status
    SSL_STATUS=$(gcloud compute ssl-certificates describe marblo-ssl-cert --global --project=$PROJECT_ID --format="value(managed.status)" 2>/dev/null || echo "NOT_FOUND")

    case $SSL_STATUS in
        "ACTIVE")
            log_success "SSL certificate is active"
            ;;
        "PROVISIONING")
            log_error "SSL certificate is still provisioning (this may take up to 60 minutes)"
            ;;
        "NOT_FOUND")
            log_error "SSL certificate not found"
            ;;
        *)
            log_error "SSL certificate status: $SSL_STATUS"
            ;;
    esac
    echo ""
}

test_api_endpoints() {
    log_info "Testing API endpoints..."

    # Determine base URL (prefer custom domain if available)
    if curl -f -s "https://$API_DOMAIN/health" >/dev/null 2>&1; then
        BASE_URL="https://$API_DOMAIN"
    else
        BASE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)" 2>/dev/null || echo "")
    fi

    if [ -z "$BASE_URL" ]; then
        log_error "Cannot determine API base URL"
        return
    fi

    log_success "Using API base URL: $BASE_URL"

    # Test health endpoint
    if curl -f -s "$BASE_URL/health" >/dev/null; then
        log_success "Health endpoint (/health) responding"
    else
        log_error "Health endpoint (/health) not responding"
    fi

    # Test API docs endpoint
    if curl -f -s "$BASE_URL/docs" >/dev/null; then
        log_success "API docs endpoint (/docs) responding"
    else
        log_error "API docs endpoint (/docs) not responding"
    fi

    # Test OpenAPI spec endpoint
    if curl -f -s "$BASE_URL/openapi.json" >/dev/null; then
        log_success "OpenAPI spec endpoint (/openapi.json) responding"
    else
        log_error "OpenAPI spec endpoint (/openapi.json) not responding"
    fi

    echo ""
}

test_environment_variables() {
    log_info "Testing environment configuration..."

    # Get service configuration
    ENV_VARS=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(spec.template.spec.template.spec.containers[0].env[].name)" 2>/dev/null || echo "")

    if echo "$ENV_VARS" | grep -q "DATABASE_URL"; then
        log_success "DATABASE_URL environment variable configured"
    else
        log_error "DATABASE_URL environment variable missing"
    fi

    if echo "$ENV_VARS" | grep -q "SECRET_KEY"; then
        log_success "SECRET_KEY environment variable configured"
    else
        log_error "SECRET_KEY environment variable missing"
    fi

    if echo "$ENV_VARS" | grep -q "SENTRY_DSN"; then
        log_success "SENTRY_DSN environment variable configured"
    else
        log_error "SENTRY_DSN environment variable missing"
    fi

    echo ""
}

test_autoscaling() {
    log_info "Testing autoscaling configuration..."

    # Get autoscaling configuration
    MIN_SCALE=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/minScale'])" 2>/dev/null || echo "")
    MAX_SCALE=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'])" 2>/dev/null || echo "")

    if [ "$MIN_SCALE" = "0" ]; then
        log_success "Minimum scale set to 0 (cost-effective)"
    else
        log_error "Minimum scale not set to 0: $MIN_SCALE"
    fi

    if [ -n "$MAX_SCALE" ] && [ "$MAX_SCALE" -gt 0 ]; then
        log_success "Maximum scale configured: $MAX_SCALE"
    else
        log_error "Maximum scale not properly configured: $MAX_SCALE"
    fi

    echo ""
}

test_security_headers() {
    log_info "Testing security headers..."

    # Determine base URL
    if curl -f -s "https://$API_DOMAIN/health" >/dev/null 2>&1; then
        BASE_URL="https://$API_DOMAIN"
    else
        BASE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)" 2>/dev/null || echo "")
    fi

    if [ -n "$BASE_URL" ]; then
        # Check for security headers
        HEADERS=$(curl -s -I "$BASE_URL/health" 2>/dev/null || echo "")

        if echo "$HEADERS" | grep -qi "x-frame-options"; then
            log_success "X-Frame-Options header present"
        else
            log_error "X-Frame-Options header missing"
        fi

        if echo "$HEADERS" | grep -qi "x-content-type-options"; then
            log_success "X-Content-Type-Options header present"
        else
            log_error "X-Content-Type-Options header missing"
        fi
    else
        log_error "Cannot test security headers - service URL not available"
    fi

    echo ""
}

show_summary() {
    echo "🏁 Test Summary"
    echo "==============="
    echo ""
    echo "Total tests run: $((PASSED_TESTS + FAILED_TESTS))"
    echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
    echo -e "${RED}Failed: $FAILED_TESTS${NC}"
    echo ""

    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}🎉 All tests passed! Production deployment is ready.${NC}"
        echo ""
        echo "🌐 Your application is available at:"
        echo "   API: https://$API_DOMAIN"
        echo "   Frontend: https://$MAIN_DOMAIN"
        echo ""
        echo "📋 Recommended next steps:"
        echo "1. Set up monitoring dashboards"
        echo "2. Configure alerting rules"
        echo "3. Set up backup schedules"
        echo "4. Perform load testing"
    else
        echo -e "${RED}⚠️  Some tests failed. Please review and fix issues before going live.${NC}"
        exit 1
    fi
}

# Main execution
main() {
    case "${1:-all}" in
        "all")
            echo "Running comprehensive production deployment tests..."
            echo ""
            check_prerequisites
            test_cloud_run_service
            test_database_connection
            test_domain_mapping
            test_ssl_certificate
            test_api_endpoints
            test_environment_variables
            test_autoscaling
            test_security_headers
            show_summary
            ;;
        "quick")
            echo "Running quick production tests..."
            echo ""
            check_prerequisites
            test_cloud_run_service
            test_api_endpoints
            show_summary
            ;;
        "domain")
            echo "Running domain and SSL tests..."
            echo ""
            check_prerequisites
            test_domain_mapping
            test_ssl_certificate
            show_summary
            ;;
        "help")
            echo "Usage: $0 [all|quick|domain|help]"
            echo ""
            echo "Commands:"
            echo "  all    - Run comprehensive test suite (default)"
            echo "  quick  - Run basic service and endpoint tests"
            echo "  domain - Test domain mapping and SSL only"
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
gcloud config set project $PROJECT_ID >/dev/null 2>&1

# Run main function with command line arguments
main "$@"