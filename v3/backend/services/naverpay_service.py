import httpx
import json
import uuid
import hashlib
import hmac
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from backend.core.config import settings
from backend.models.payment import Payment, PaymentStatus, BillingHistory
from backend.models.user import User
from sqlalchemy.orm import Session
import logging

logger = logging.getLogger(__name__)


class NaverPayService:
    def __init__(self):
        self.api_url = settings.NAVERPAY_API_URL
        self.merchant_id = settings.NAVERPAY_MERCHANT_ID
        self.api_key = settings.NAVERPAY_API_KEY
        self.secret_key = settings.NAVERPAY_SECRET_KEY
        self.webhook_secret = settings.NAVERPAY_WEBHOOK_SECRET
        self.headers = self._get_auth_headers()

    def _get_auth_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Merchant-ID": self.merchant_id
        }

    def _generate_signature(self, data: Dict[str, Any], timestamp: str) -> str:
        """Generate signature for API requests"""
        sorted_params = sorted(data.items())
        param_string = "&".join([f"{k}={v}" for k, v in sorted_params])
        message = f"{timestamp}.{param_string}"
        return hmac.new(
            self.secret_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()

    async def request_payment(
        self,
        db: Session,
        user_id: int,
        amount: int,
        order_name: str,
        customer_email: str,
        customer_name: str,
        success_url: str,
        fail_url: str,
        payment_method: str = "NAVERPAY"
    ) -> Payment:
        """Request NaverPay payment"""
        order_id = f"naver_{uuid.uuid4().hex[:16]}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        timestamp = str(int(datetime.now().timestamp()))

        payment = Payment(
            order_id=order_id,
            user_id=user_id,
            amount=amount,
            status=PaymentStatus.PENDING,
            method=payment_method
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        request_data = {
            "orderId": order_id,
            "amount": amount,
            "orderName": order_name,
            "returnUrl": success_url,
            "failUrl": fail_url,
            "customerEmail": customer_email,
            "customerName": customer_name,
            "paymentMethod": "NAVERPAY",
            "timestamp": timestamp
        }

        signature = self._generate_signature(request_data, timestamp)
        request_data["signature"] = signature

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/payments",
                    headers=self.headers,
                    json=request_data,
                    timeout=30
                )

            if response.status_code == 200:
                data = response.json()
                payment.payment_key = data.get("paymentId")
                payment.checkout_url = data.get("redirectUrl")
                payment.status = PaymentStatus.READY
                db.commit()
                return payment
            else:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                payment.status = PaymentStatus.ABORTED
                payment.failure_message = error_data.get("message", response.text)
                db.commit()
                raise Exception(f"NaverPay payment request failed: {payment.failure_message}")

        except httpx.RequestError as e:
            payment.status = PaymentStatus.ABORTED
            payment.failure_message = f"Network error: {str(e)}"
            db.commit()
            raise Exception(f"NaverPay API request failed: {str(e)}")

    async def confirm_payment(
        self,
        db: Session,
        payment_key: str,
        order_id: str,
        amount: int
    ) -> Payment:
        """Confirm NaverPay payment"""
        payment = db.query(Payment).filter(Payment.order_id == order_id).first()
        if not payment:
            raise ValueError(f"Payment not found for order_id: {order_id}")

        if payment.amount != amount:
            raise ValueError(f"Amount mismatch: expected {payment.amount}, got {amount}")

        timestamp = str(int(datetime.now().timestamp()))
        request_data = {
            "paymentId": payment_key,
            "orderId": order_id,
            "amount": amount,
            "timestamp": timestamp
        }

        signature = self._generate_signature(request_data, timestamp)
        request_data["signature"] = signature

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/payments/{payment_key}/confirm",
                    headers=self.headers,
                    json=request_data,
                    timeout=30
                )

            if response.status_code == 200:
                data = response.json()
                payment.payment_key = payment_key
                payment.status = PaymentStatus.DONE
                payment.approved_at = datetime.now()
                payment.receipt_url = data.get("receiptUrl")
                payment.transaction_id = data.get("transactionId")

                if data.get("paymentInfo"):
                    payment_info = data["paymentInfo"]
                    payment.card_number = payment_info.get("cardNumber")
                    payment.card_type = payment_info.get("cardType")

                db.commit()
                return payment
            else:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                payment.status = PaymentStatus.ABORTED
                payment.failure_code = error_data.get("code")
                payment.failure_message = error_data.get("message", response.text)
                db.commit()
                raise Exception(f"NaverPay payment confirmation failed: {payment.failure_message}")

        except httpx.RequestError as e:
            payment.status = PaymentStatus.ABORTED
            payment.failure_message = f"Network error: {str(e)}"
            db.commit()
            raise Exception(f"NaverPay confirm request failed: {str(e)}")

    async def cancel_payment(
        self,
        db: Session,
        payment_key: str,
        cancel_reason: str,
        cancel_amount: Optional[int] = None
    ) -> Payment:
        """Cancel NaverPay payment"""
        payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
        if not payment:
            raise ValueError(f"Payment not found for payment_key: {payment_key}")

        if payment.status not in [PaymentStatus.DONE]:
            raise ValueError(f"Cannot cancel payment with status: {payment.status}")

        cancel_amount = cancel_amount or payment.amount
        timestamp = str(int(datetime.now().timestamp()))

        request_data = {
            "paymentId": payment_key,
            "cancelReason": cancel_reason,
            "cancelAmount": cancel_amount,
            "timestamp": timestamp
        }

        signature = self._generate_signature(request_data, timestamp)
        request_data["signature"] = signature

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/payments/{payment_key}/cancel",
                    headers=self.headers,
                    json=request_data,
                    timeout=30
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
                payment.cancel_transaction_id = data.get("cancelTransactionId")
                db.commit()
                return payment
            else:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                raise Exception(f"NaverPay payment cancellation failed: {error_data.get('message', response.text)}")

        except httpx.RequestError as e:
            raise Exception(f"NaverPay cancel request failed: {str(e)}")

    async def get_payment_status(self, payment_key: str) -> Dict[str, Any]:
        """Get NaverPay payment status"""
        timestamp = str(int(datetime.now().timestamp()))
        params = {"timestamp": timestamp}
        signature = self._generate_signature(params, timestamp)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.api_url}/payments/{payment_key}",
                    headers={**self.headers, "X-Signature": signature, "X-Timestamp": timestamp},
                    timeout=30
                )

            if response.status_code == 200:
                return response.json()
            else:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                raise Exception(f"Failed to get NaverPay payment status: {error_data.get('message', response.text)}")

        except httpx.RequestError as e:
            raise Exception(f"NaverPay status request failed: {str(e)}")

    async def create_billing_agreement(
        self,
        db: Session,
        user_id: int,
        customer_email: str,
        customer_name: str,
        return_url: str
    ) -> str:
        """Create NaverPay billing agreement for recurring payments"""
        customer_key = f"customer_{uuid.uuid4().hex[:16]}"
        timestamp = str(int(datetime.now().timestamp()))

        request_data = {
            "customerKey": customer_key,
            "customerEmail": customer_email,
            "customerName": customer_name,
            "returnUrl": return_url,
            "timestamp": timestamp
        }

        signature = self._generate_signature(request_data, timestamp)
        request_data["signature"] = signature

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/billing/agreements",
                    headers=self.headers,
                    json=request_data,
                    timeout=30
                )

            if response.status_code == 200:
                data = response.json()
                billing_agreement_id = data.get("billingAgreementId")
                redirect_url = data.get("redirectUrl")

                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    user.customer_key = customer_key
                    db.commit()

                return redirect_url
            else:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                raise Exception(f"Failed to create NaverPay billing agreement: {error_data.get('message', response.text)}")

        except httpx.RequestError as e:
            raise Exception(f"NaverPay billing agreement request failed: {str(e)}")

    async def request_billing_payment(
        self,
        db: Session,
        customer_key: str,
        amount: int,
        order_id: str,
        order_name: str
    ) -> Payment:
        """Request recurring payment using NaverPay billing agreement"""
        user = db.query(User).filter(User.customer_key == customer_key).first()
        if not user:
            raise ValueError(f"User not found for customer_key: {customer_key}")

        timestamp = str(int(datetime.now().timestamp()))
        request_data = {
            "customerKey": customer_key,
            "orderId": order_id,
            "orderName": order_name,
            "amount": amount,
            "timestamp": timestamp
        }

        signature = self._generate_signature(request_data, timestamp)
        request_data["signature"] = signature

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/billing/payments",
                    headers=self.headers,
                    json=request_data,
                    timeout=30
                )

            if response.status_code == 200:
                data = response.json()
                payment = Payment(
                    payment_key=data.get("paymentId"),
                    order_id=order_id,
                    user_id=user.id,
                    amount=amount,
                    status=PaymentStatus.DONE,
                    method="NAVERPAY_BILLING",
                    approved_at=datetime.now(),
                    receipt_url=data.get("receiptUrl"),
                    transaction_id=data.get("transactionId")
                )
                db.add(payment)
                db.commit()
                return payment
            else:
                error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                raise Exception(f"NaverPay billing payment failed: {error_data.get('message', response.text)}")

        except httpx.RequestError as e:
            raise Exception(f"NaverPay billing payment request failed: {str(e)}")

    def verify_webhook(self, signature: str, timestamp: str, body: str) -> bool:
        """Verify NaverPay webhook signature"""
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
        """Process NaverPay webhook events"""
        if event_type == "PAYMENT_COMPLETED":
            payment_key = data.get("paymentId")
            payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
            if payment and payment.status == PaymentStatus.READY:
                payment.status = PaymentStatus.DONE
                payment.approved_at = datetime.now()
                payment.transaction_id = data.get("transactionId")
                db.commit()
                logger.info(f"NaverPay payment {payment_key} completed")

        elif event_type == "PAYMENT_CANCELLED":
            payment_key = data.get("paymentId")
            payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
            if payment:
                payment.status = PaymentStatus.CANCELED
                payment.canceled_at = datetime.now()
                payment.cancel_reason = data.get("cancelReason")
                payment.cancel_amount = data.get("cancelAmount", payment.amount)
                db.commit()
                logger.info(f"NaverPay payment {payment_key} cancelled")

        elif event_type == "PAYMENT_FAILED":
            payment_key = data.get("paymentId")
            payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
            if payment:
                payment.status = PaymentStatus.ABORTED
                payment.failure_code = data.get("errorCode")
                payment.failure_message = data.get("errorMessage")
                db.commit()
                logger.info(f"NaverPay payment {payment_key} failed")

        elif event_type == "BILLING_AGREEMENT_APPROVED":
            customer_key = data.get("customerKey")
            billing_agreement_id = data.get("billingAgreementId")

            user = db.query(User).filter(User.customer_key == customer_key).first()
            if user:
                # Store billing agreement info in user or separate table
                logger.info(f"NaverPay billing agreement approved for customer {customer_key}")