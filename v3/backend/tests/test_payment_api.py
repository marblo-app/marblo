"""
Test cases for payment API endpoints.
"""
import pytest
import json
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.models.payment import PaymentStatus, PaymentWebhook


class TestPaymentAPI:
    """Test payment-related API endpoints."""

    def test_request_payment_success(self, client: TestClient, test_user, sample_payment_data, mock_toss_service):
        """Test successful payment request."""
        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.post("/api/v1/payments/request", json=sample_payment_data)

            assert response.status_code == 200
            data = response.json()
            assert data["amount"] == sample_payment_data["amount"]
            assert data["status"] == "ready"
            assert "checkout_url" in data

    def test_request_payment_naverpay_disabled(self, client: TestClient, test_user, sample_payment_data, mock_naverpay_service):
        """Test NaverPay payment request is disabled by default."""
        payment_data = {**sample_payment_data, "payment_method": "NAVERPAY"}

        with patch('backend.api.payments.naverpay_service', mock_naverpay_service):
            response = client.post("/api/v1/payments/request", json=payment_data)

            assert response.status_code == 403
            assert "NaverPay is disabled" in response.json()["detail"]
            mock_naverpay_service.request_payment.assert_not_called()

    def test_request_payment_invalid_amount(self, client: TestClient, test_user, sample_payment_data):
        """Test payment request with invalid amount."""
        invalid_data = {**sample_payment_data, "amount": -1000}

        response = client.post("/api/v1/payments/request", json=invalid_data)
        assert response.status_code == 422  # Validation error

    def test_confirm_payment_success(self, client: TestClient, test_user, test_payment, mock_toss_service):
        """Test successful payment confirmation."""
        confirm_data = {
            "payment_key": "test_payment_key_123",
            "order_id": "test_order_123",
            "amount": 10000
        }

        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.post("/api/v1/payments/confirm", json=confirm_data)

            assert response.status_code == 200
            data = response.json()
            assert data["payment_key"] == confirm_data["payment_key"]
            assert data["status"] == "done"

    def test_confirm_payment_not_found(self, client: TestClient):
        """Test payment confirmation with non-existent order."""
        confirm_data = {
            "payment_key": "nonexistent_key",
            "order_id": "nonexistent_order",
            "amount": 10000
        }

        response = client.post("/api/v1/payments/confirm", json=confirm_data)
        assert response.status_code == 404

    def test_cancel_payment_success(self, client: TestClient, test_payment, mock_toss_service):
        """Test successful payment cancellation."""
        cancel_data = {
            "payment_key": test_payment.payment_key,
            "cancel_reason": "Customer requested cancellation"
        }

        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.post("/api/v1/payments/cancel", json=cancel_data)

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "canceled"

    def test_partial_cancel_payment(self, client: TestClient, test_payment, mock_toss_service):
        """Test partial payment cancellation."""
        cancel_data = {
            "payment_key": test_payment.payment_key,
            "cancel_reason": "Partial refund requested",
            "cancel_amount": 5000
        }

        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.post("/api/v1/payments/cancel", json=cancel_data)

            assert response.status_code == 200

    def test_get_payment_status(self, client: TestClient, test_payment, mock_toss_service):
        """Test payment status retrieval."""
        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.get(f"/api/v1/payments/status/{test_payment.payment_key}")

            assert response.status_code == 200
            data = response.json()
            assert data["paymentKey"] == test_payment.payment_key

    def test_get_payment_history(self, client: TestClient, test_payment):
        """Test payment history retrieval."""
        response = client.get("/api/v1/payments/history?skip=0&limit=10")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["id"] == test_payment.id

    def test_get_payment_detail(self, client: TestClient, test_payment):
        """Test individual payment detail retrieval."""
        response = client.get(f"/api/v1/payments/{test_payment.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_payment.id
        assert data["payment_key"] == test_payment.payment_key

    def test_get_payment_detail_not_found(self, client: TestClient):
        """Test payment detail retrieval for non-existent payment."""
        response = client.get("/api/v1/payments/999999")
        assert response.status_code == 404


class TestBillingAPI:
    """Test billing-related API endpoints."""

    def test_register_billing_key_toss(self, client: TestClient, test_user, mock_toss_service):
        """Test Toss billing key registration."""
        billing_data = {
            "payment_method": "TOSS",
            "card_number": "1234567812345678",
            "card_expiry_year": "25",
            "card_expiry_month": "12",
            "card_password": "12",
            "birth_or_business_number": "901010"
        }

        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.post("/api/v1/payments/billing/register", json=billing_data)

            assert response.status_code == 200
            data = response.json()
            assert "billing_key" in data
            assert "customer_key" in data

    def test_register_billing_key_naverpay_disabled(self, client: TestClient, test_user, mock_naverpay_service):
        """Test NaverPay billing agreement creation is disabled by default."""
        billing_data = {
            "payment_method": "NAVERPAY",
            "return_url": "http://localhost:3001/billing/callback"
        }

        with patch('backend.api.payments.naverpay_service', mock_naverpay_service):
            response = client.post("/api/v1/payments/billing/register", json=billing_data)

            assert response.status_code == 403
            assert "NaverPay is disabled" in response.json()["detail"]
            mock_naverpay_service.create_billing_agreement.assert_not_called()

    def test_register_billing_key_invalid_card(self, client: TestClient, test_user):
        """Test billing key registration with invalid card data."""
        billing_data = {
            "payment_method": "TOSS",
            "card_number": "invalid_card",
            "card_expiry_year": "25",
            "card_expiry_month": "12",
            "card_password": "12",
            "birth_or_business_number": "901010"
        }

        response = client.post("/api/v1/payments/billing/register", json=billing_data)
        assert response.status_code == 422  # Validation error


class TestWebhookAPI:
    """Test webhook-related API endpoints."""

    def test_toss_webhook_valid_signature(self, client: TestClient, mock_toss_service):
        """Test Toss webhook with valid signature."""
        webhook_data = {
            "eventType": "PAYMENT_STATUS_CHANGED",
            "id": "webhook_123",
            "data": {
                "paymentKey": "test_payment_key_123",
                "status": "DONE"
            }
        }

        headers = {
            "X-Toss-Webhook-Signature": "valid_signature",
            "X-Toss-Webhook-Timestamp": "1634567890"
        }

        with patch('backend.api.payments.toss_service', mock_toss_service):
            response = client.post(
                "/api/v1/payments/webhook/toss",
                json=webhook_data,
                headers=headers
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "received"

    def test_toss_webhook_invalid_signature(self, client: TestClient):
        """Test Toss webhook with invalid signature."""
        webhook_data = {
            "eventType": "PAYMENT_STATUS_CHANGED",
            "id": "webhook_123",
            "data": {
                "paymentKey": "test_payment_key_123",
                "status": "DONE"
            }
        }

        headers = {
            "X-Toss-Webhook-Signature": "invalid_signature",
            "X-Toss-Webhook-Timestamp": "1634567890"
        }

        with patch('backend.api.payments.toss_service') as mock_service:
            mock_service.verify_webhook.return_value = False

            response = client.post(
                "/api/v1/payments/webhook/toss",
                json=webhook_data,
                headers=headers
            )

            assert response.status_code == 401

    def test_naverpay_webhook_disabled(self, client: TestClient, mock_naverpay_service):
        """Test NaverPay webhook is disabled by default."""
        webhook_data = {
            "eventType": "PAYMENT_STATUS_CHANGED",
            "id": "naverpay_webhook_123",
            "data": {
                "paymentKey": "naverpay_payment_key_123",
                "status": "DONE"
            }
        }

        headers = {
            "X-Naverpay-Signature": "valid_signature",
            "X-Naverpay-Timestamp": "1634567890"
        }

        with patch('backend.api.payments.naverpay_service', mock_naverpay_service):
            response = client.post(
                "/api/v1/payments/webhook/naverpay",
                json=webhook_data,
                headers=headers
            )

            assert response.status_code == 403
            assert "NaverPay is disabled" in response.json()["detail"]
            mock_naverpay_service.verify_webhook.assert_not_called()


class TestPaymentStatistics:
    """Test payment statistics endpoints."""

    def test_get_payment_statistics(self, client: TestClient, test_payment):
        """Test payment statistics retrieval."""
        from datetime import datetime, timedelta

        start_date = (datetime.now() - timedelta(days=30)).isoformat()
        end_date = datetime.now().isoformat()

        response = client.get(
            f"/api/v1/payments/statistics/payments?start_date={start_date}&end_date={end_date}"
        )

        assert response.status_code == 200
        data = response.json()
        assert "total_revenue" in data
        assert "total_transactions" in data
        assert "successful_payments" in data
        assert "failed_payments" in data

    def test_get_subscription_statistics(self, client: TestClient, test_subscription):
        """Test subscription statistics retrieval."""
        response = client.get("/api/v1/payments/statistics/subscriptions")

        assert response.status_code == 200
        data = response.json()
        assert "total_subscribers" in data
        assert "active_subscriptions" in data
        assert "monthly_recurring_revenue" in data
        assert "churn_rate" in data
