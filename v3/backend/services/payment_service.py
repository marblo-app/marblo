import base64
import httpx
import json
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import hashlib
import hmac
import uuid
from backend.core.config import settings
from backend.models.payment import Payment, PaymentStatus, PaymentRefund, Subscription, SubscriptionStatus, BillingHistory
from backend.models.user import User
from sqlalchemy.orm import Session, selectinload
import logging

logger = logging.getLogger(__name__)


class TossPaymentsService:
    def __init__(self):
        self.api_url = settings.TOSS_API_URL
        self.client_key = settings.TOSS_CLIENT_KEY
        self.secret_key = settings.TOSS_SECRET_KEY
        self.webhook_secret = settings.TOSS_WEBHOOK_SECRET
        self.headers = self._get_auth_headers()

    def _get_auth_headers(self) -> Dict[str, str]:
        secret_key_base64 = base64.b64encode(f"{self.secret_key}:".encode()).decode()
        return {
            "Authorization": f"Basic {secret_key_base64}",
            "Content-Type": "application/json"
        }

    async def request_payment(
        self,
        db: Session,
        user_id: int,
        amount: int,
        order_name: str,
        customer_email: str,
        customer_name: str,
        success_url: str,
        fail_url: str
    ) -> Payment:
        order_id = f"order_{uuid.uuid4().hex[:16]}_{datetime.now().strftime('%Y%m%d%H%M%S')}"

        payment = Payment(
            order_id=order_id,
            user_id=user_id,
            amount=amount,
            status=PaymentStatus.PENDING,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        request_data = {
            "amount": amount,
            "orderId": order_id,
            "orderName": order_name,
            "customerEmail": customer_email,
            "customerName": customer_name,
            "successUrl": success_url,
            "failUrl": fail_url,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/payments/request",
                headers=self.headers,
                json=request_data
            )

        if response.status_code == 200:
            data = response.json()
            payment.checkout_url = data.get("checkout", {}).get("url")
            payment.status = PaymentStatus.READY
            db.commit()
            return payment
        else:
            payment.status = PaymentStatus.ABORTED
            payment.failure_message = response.text
            db.commit()
            raise Exception(f"Payment request failed: {response.text}")

    async def confirm_payment(
        self,
        db: Session,
        payment_key: str,
        order_id: str,
        amount: int
    ) -> Payment:
        payment = db.query(Payment).filter(Payment.order_id == order_id).first()
        if not payment:
            raise ValueError(f"Payment not found for order_id: {order_id}")

        if payment.amount != amount:
            raise ValueError(f"Amount mismatch: expected {payment.amount}, got {amount}")

        request_data = {
            "paymentKey": payment_key,
            "orderId": order_id,
            "amount": amount
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/payments/confirm",
                headers=self.headers,
                json=request_data
            )

        if response.status_code == 200:
            data = response.json()
            payment.payment_key = payment_key
            payment.status = PaymentStatus.DONE
            payment.approved_at = datetime.now()
            payment.method = data.get("method")
            payment.receipt_url = data.get("receipt", {}).get("url")

            if data.get("card"):
                payment.card_number = data["card"].get("number")
                payment.card_type = data["card"].get("cardType")

            db.commit()
            return payment
        else:
            error_data = response.json()
            payment.status = PaymentStatus.ABORTED
            payment.failure_code = error_data.get("code")
            payment.failure_message = error_data.get("message")
            db.commit()
            raise Exception(f"Payment confirmation failed: {error_data.get('message')}")

    async def cancel_payment(
        self,
        db: Session,
        payment_key: str,
        cancel_reason: str,
        cancel_amount: Optional[int] = None
    ) -> Payment:
        payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
        if not payment:
            raise ValueError(f"Payment not found for payment_key: {payment_key}")

        if payment.status not in [PaymentStatus.DONE]:
            raise ValueError(f"Cannot cancel payment with status: {payment.status}")

        cancel_amount = cancel_amount or payment.amount

        request_data = {
            "cancelReason": cancel_reason,
            "cancelAmount": cancel_amount
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/payments/{payment_key}/cancel",
                headers=self.headers,
                json=request_data
            )

        if response.status_code == 200:
            data = response.json()
            if cancel_amount == payment.amount:
                payment.status = PaymentStatus.CANCELED
            else:
                payment.status = PaymentStatus.PARTIAL_CANCELED
            payment.canceled_at = datetime.now()
            payment.cancel_amount = cancel_amount
            payment.cancel_reason = cancel_reason
            db.commit()
            return payment
        else:
            error_data = response.json()
            raise Exception(f"Payment cancellation failed: {error_data.get('message')}")

    async def get_payment_status(self, payment_key: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.api_url}/payments/{payment_key}",
                headers=self.headers
            )

        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Failed to get payment status: {response.text}")

    async def create_billing_key(
        self,
        db: Session,
        user_id: int,
        customer_key: str,
        card_number: str,
        card_expiry_year: str,
        card_expiry_month: str,
        card_password: str,
        birth_or_business_number: str
    ) -> str:
        request_data = {
            "customerKey": customer_key,
            "cardNumber": card_number,
            "cardExpirationYear": card_expiry_year,
            "cardExpirationMonth": card_expiry_month,
            "cardPassword": card_password,
            "customerIdentityNumber": birth_or_business_number
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/billing/authorizations/card",
                headers=self.headers,
                json=request_data
            )

        if response.status_code == 200:
            data = response.json()
            billing_key = data.get("billingKey")

            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.customer_key = customer_key
                db.commit()

            return billing_key
        else:
            error_data = response.json()
            raise Exception(f"Failed to create billing key: {error_data.get('message')}")

    async def request_billing_payment(
        self,
        db: Session,
        customer_key: str,
        amount: int,
        order_id: str,
        order_name: str
    ) -> Payment:
        user = db.query(User).filter(User.customer_key == customer_key).first()
        if not user:
            raise ValueError(f"User not found for customer_key: {customer_key}")

        subscription = db.query(Subscription).filter(
            Subscription.user_id == user.id,
            Subscription.status == SubscriptionStatus.ACTIVE
        ).first()

        if not subscription:
            raise ValueError("No active subscription found")

        request_data = {
            "customerKey": customer_key,
            "amount": amount,
            "orderId": order_id,
            "orderName": order_name
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/billing/{subscription.billing_key}",
                headers=self.headers,
                json=request_data
            )

        if response.status_code == 200:
            data = response.json()
            payment = Payment(
                payment_key=data.get("paymentKey"),
                order_id=order_id,
                user_id=user.id,
                amount=amount,
                status=PaymentStatus.DONE,
                method=data.get("method"),
                approved_at=datetime.now(),
                card_number=data.get("card", {}).get("number"),
                card_type=data.get("card", {}).get("cardType"),
                receipt_url=data.get("receipt", {}).get("url")
            )
            db.add(payment)

            billing_history = BillingHistory(
                subscription_id=subscription.id,
                payment_id=payment.id,
                amount=amount,
                status="PAID",
                billing_date=datetime.now(),
                paid_at=datetime.now()
            )
            db.add(billing_history)

            subscription.next_billing_date = datetime.now() + timedelta(days=30)

            db.commit()
            return payment
        else:
            error_data = response.json()

            billing_history = BillingHistory(
                subscription_id=subscription.id,
                amount=amount,
                status="FAILED",
                billing_date=datetime.now(),
                failed_at=datetime.now(),
                failure_reason=error_data.get("message")
            )
            db.add(billing_history)

            subscription.failure_count += 1
            if subscription.failure_count >= 3:
                subscription.status = SubscriptionStatus.PAST_DUE

            db.commit()
            raise Exception(f"Billing payment failed: {error_data.get('message')}")

    def verify_webhook(self, signature: str, timestamp: str, body: str) -> bool:
        message = f"{timestamp}.{body}"
        expected_signature = hmac.new(
            self.webhook_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(signature, expected_signature)

    async def process_webhook(
        self,
        db: Session,
        event_type: str,
        data: Dict[str, Any]
    ) -> None:
        if event_type == "PAYMENT_STATUS_CHANGED":
            payment_key = data.get("paymentKey")
            status = data.get("status")

            payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
            if payment:
                if status == "DONE":
                    payment.status = PaymentStatus.DONE
                    payment.approved_at = datetime.now()
                elif status == "CANCELED":
                    payment.status = PaymentStatus.CANCELED
                    payment.canceled_at = datetime.now()
                elif status == "PARTIAL_CANCELED":
                    payment.status = PaymentStatus.PARTIAL_CANCELED
                elif status == "ABORTED":
                    payment.status = PaymentStatus.ABORTED
                elif status == "EXPIRED":
                    payment.status = PaymentStatus.EXPIRED

                db.commit()
                logger.info(f"Payment {payment_key} status updated to {status}")

        elif event_type == "BILLING_KEY_UPDATED":
            customer_key = data.get("customerKey")
            billing_key = data.get("billingKey")

            user = db.query(User).filter(User.customer_key == customer_key).first()
            if user:
                subscription = db.query(Subscription).filter(
                    Subscription.user_id == user.id,
                    Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING])
                ).first()

                if subscription:
                    subscription.billing_key = billing_key
                    db.commit()
                    logger.info(f"Billing key updated for customer {customer_key}")