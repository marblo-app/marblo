"""
Test cases for payment service layer.
"""
import pytest
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta

from backend.services.payment_service import TossPaymentsService
from backend.models.payment import Payment, PaymentStatus, Subscription, SubscriptionStatus


class TestTossPaymentsService:
    """Test TossPaymentsService functionality."""

    @pytest.fixture
    def toss_service(self):
        """Create a TossPaymentsService instance for testing."""
        with patch('backend.services.payment_service.settings') as mock_settings:
            mock_settings.TOSS_API_URL = "https://api.tosspayments.com/v1"
            mock_settings.TOSS_CLIENT_KEY = "test_client_key"
            mock_settings.TOSS_SECRET_KEY = "test_secret_key"
            mock_settings.TOSS_WEBHOOK_SECRET = "test_webhook_secret"

            service = TossPaymentsService()
            return service

    @pytest.mark.asyncio
    async def test_request_payment_success(self, toss_service, db_session, test_user):
        """Test successful payment request."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "checkout": {
                "url": "https://checkout.toss.com/test"
            }
        }

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            payment = await toss_service.request_payment(
                db=db_session,
                user_id=test_user.id,
                amount=10000,
                order_name="Test Product",
                customer_email="test@example.com",
                customer_name="Test User",
                success_url="http://localhost:3001/success",
                fail_url="http://localhost:3001/fail"
            )

            assert payment.amount == 10000
            assert payment.status == PaymentStatus.READY
            assert payment.checkout_url == "https://checkout.toss.com/test"

    @pytest.mark.asyncio
    async def test_request_payment_failure(self, toss_service, db_session, test_user):
        """Test payment request failure."""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.text = "Invalid request"

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            with pytest.raises(Exception, match="Payment request failed"):
                await toss_service.request_payment(
                    db=db_session,
                    user_id=test_user.id,
                    amount=10000,
                    order_name="Test Product",
                    customer_email="test@example.com",
                    customer_name="Test User",
                    success_url="http://localhost:3001/success",
                    fail_url="http://localhost:3001/fail"
                )

    @pytest.mark.asyncio
    async def test_confirm_payment_success(self, toss_service, db_session, test_user):
        """Test successful payment confirmation."""
        # Create a pending payment first
        payment = Payment(
            order_id="test_order_123",
            user_id=test_user.id,
            amount=10000,
            status=PaymentStatus.READY
        )
        db_session.add(payment)
        db_session.commit()

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "method": "카드",
            "receipt": {"url": "https://receipt.toss.com/test"},
            "card": {
                "number": "1234****5678",
                "cardType": "CREDIT"
            }
        }

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            confirmed_payment = await toss_service.confirm_payment(
                db=db_session,
                payment_key="test_payment_key_123",
                order_id="test_order_123",
                amount=10000
            )

            assert confirmed_payment.status == PaymentStatus.DONE
            assert confirmed_payment.payment_key == "test_payment_key_123"
            assert confirmed_payment.method == "카드"
            assert confirmed_payment.receipt_url == "https://receipt.toss.com/test"

    @pytest.mark.asyncio
    async def test_confirm_payment_amount_mismatch(self, toss_service, db_session, test_user):
        """Test payment confirmation with amount mismatch."""
        # Create a pending payment
        payment = Payment(
            order_id="test_order_123",
            user_id=test_user.id,
            amount=10000,
            status=PaymentStatus.READY
        )
        db_session.add(payment)
        db_session.commit()

        with pytest.raises(ValueError, match="Amount mismatch"):
            await toss_service.confirm_payment(
                db=db_session,
                payment_key="test_payment_key_123",
                order_id="test_order_123",
                amount=15000  # Different amount
            )

    @pytest.mark.asyncio
    async def test_cancel_payment_success(self, toss_service, db_session, test_payment):
        """Test successful payment cancellation."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {}

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            canceled_payment = await toss_service.cancel_payment(
                db=db_session,
                payment_key=test_payment.payment_key,
                cancel_reason="Customer requested cancellation"
            )

            assert canceled_payment.status == PaymentStatus.CANCELED
            assert canceled_payment.cancel_reason == "Customer requested cancellation"

    @pytest.mark.asyncio
    async def test_partial_cancel_payment(self, toss_service, db_session, test_payment):
        """Test partial payment cancellation."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {}

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            canceled_payment = await toss_service.cancel_payment(
                db=db_session,
                payment_key=test_payment.payment_key,
                cancel_reason="Partial refund",
                cancel_amount=5000
            )

            assert canceled_payment.status == PaymentStatus.PARTIAL_CANCELED
            assert canceled_payment.cancel_amount == 5000

    @pytest.mark.asyncio
    async def test_get_payment_status(self, toss_service):
        """Test payment status retrieval."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "paymentKey": "test_payment_key_123",
            "status": "DONE",
            "totalAmount": 10000
        }

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response

            status = await toss_service.get_payment_status("test_payment_key_123")

            assert status["paymentKey"] == "test_payment_key_123"
            assert status["status"] == "DONE"
            assert status["totalAmount"] == 10000

    @pytest.mark.asyncio
    async def test_create_billing_key(self, toss_service, db_session, test_user):
        """Test billing key creation."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "billingKey": "billing_key_test_123"
        }

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            billing_key = await toss_service.create_billing_key(
                db=db_session,
                user_id=test_user.id,
                customer_key="customer_test_123",
                card_number="1234567812345678",
                card_expiry_year="25",
                card_expiry_month="12",
                card_password="12",
                birth_or_business_number="901010"
            )

            assert billing_key == "billing_key_test_123"

    def test_verify_webhook_valid_signature(self, toss_service):
        """Test webhook signature verification with valid signature."""
        import hmac
        import hashlib

        timestamp = "1634567890"
        body = '{"eventType":"PAYMENT_STATUS_CHANGED","data":{"paymentKey":"test_key"}}'
        message = f"{timestamp}.{body}"

        expected_signature = hmac.new(
            toss_service.webhook_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()

        result = toss_service.verify_webhook(expected_signature, timestamp, body)
        assert result is True

    def test_verify_webhook_invalid_signature(self, toss_service):
        """Test webhook signature verification with invalid signature."""
        result = toss_service.verify_webhook("invalid_signature", "1634567890", "test_body")
        assert result is False

    @pytest.mark.asyncio
    async def test_process_webhook_payment_status_changed(self, toss_service, db_session, test_payment):
        """Test webhook processing for payment status change."""
        data = {
            "paymentKey": test_payment.payment_key,
            "status": "CANCELED"
        }

        await toss_service.process_webhook(db_session, "PAYMENT_STATUS_CHANGED", data)

        db_session.refresh(test_payment)
        assert test_payment.status == PaymentStatus.CANCELED

    @pytest.mark.asyncio
    async def test_request_billing_payment_success(self, toss_service, db_session, test_subscription):
        """Test successful billing payment."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "paymentKey": "billing_payment_key_123",
            "method": "카드",
            "receipt": {"url": "https://receipt.toss.com/billing"},
            "card": {"number": "1234****5678", "cardType": "CREDIT"}
        }

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            payment = await toss_service.request_billing_payment(
                db=db_session,
                customer_key=test_subscription.customer_key,
                amount=9900,
                order_id="billing_order_123",
                order_name="Monthly Subscription"
            )

            assert payment.status == PaymentStatus.DONE
            assert payment.amount == 9900

    @pytest.mark.asyncio
    async def test_request_billing_payment_failure(self, toss_service, db_session, test_subscription):
        """Test billing payment failure."""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.json.return_value = {
            "message": "Insufficient funds"
        }

        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response

            with pytest.raises(Exception, match="Billing payment failed"):
                await toss_service.request_billing_payment(
                    db=db_session,
                    customer_key=test_subscription.customer_key,
                    amount=9900,
                    order_id="billing_order_123",
                    order_name="Monthly Subscription"
                )