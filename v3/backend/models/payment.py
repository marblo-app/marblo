from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, Text, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship, selectinload
from sqlalchemy.sql import func
from backend.db.base import Base
import enum
from datetime import datetime


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    READY = "ready"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELED = "canceled"
    PARTIAL_CANCELED = "partial_canceled"
    ABORTED = "aborted"
    EXPIRED = "expired"


class PaymentMethod(str, enum.Enum):
    CARD = "카드"
    VIRTUAL_ACCOUNT = "가상계좌"
    TRANSFER = "계좌이체"
    MOBILE_PHONE = "휴대폰"
    GIFT_CERTIFICATE = "상품권"
    EASY_PAY = "간편결제"


class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    CANCELED = "canceled"
    EXPIRED = "expired"
    PENDING = "pending"
    TRIALING = "trialing"
    PAST_DUE = "past_due"


class SubscriptionPlan(str, enum.Enum):
    FREE = "free"
    BASIC = "basic"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    payment_key = Column(String(200), unique=True, index=True)
    order_id = Column(String(64), unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Integer, nullable=False)
    currency = Column(String(3), default="KRW")
    status = Column(SQLEnum(PaymentStatus), default=PaymentStatus.PENDING)
    method = Column(SQLEnum(PaymentMethod), nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    approved_at = Column(DateTime(timezone=True), nullable=True)
    canceled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_amount = Column(Integer, default=0)
    cancel_reason = Column(Text, nullable=True)
    card_number = Column(String(20), nullable=True)
    card_type = Column(String(20), nullable=True)
    receipt_url = Column(String(500), nullable=True)
    checkout_url = Column(String(500), nullable=True)
    failure_code = Column(String(50), nullable=True)
    failure_message = Column(Text, nullable=True)
    metadata = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="payments")
    refunds = relationship("PaymentRefund", back_populates="payment")
    webhooks = relationship("PaymentWebhook", back_populates="payment")


class PaymentRefund(Base):
    __tablename__ = "payment_refunds"

    id = Column(Integer, primary_key=True, index=True)
    refund_key = Column(String(200), unique=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False)
    amount = Column(Integer, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), default="PENDING")
    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    approved_at = Column(DateTime(timezone=True), nullable=True)
    failed_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", back_populates="refunds")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(String(200), unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    customer_key = Column(String(200), index=True)
    billing_key = Column(String(200), index=True)
    plan = Column(SQLEnum(SubscriptionPlan), default=SubscriptionPlan.FREE)
    status = Column(SQLEnum(SubscriptionStatus), default=SubscriptionStatus.PENDING)
    amount = Column(Integer, nullable=False)
    billing_cycle = Column(String(20), default="monthly")
    trial_end_date = Column(DateTime(timezone=True), nullable=True)
    current_period_start = Column(DateTime(timezone=True), nullable=False)
    current_period_end = Column(DateTime(timezone=True), nullable=False)
    next_billing_date = Column(DateTime(timezone=True), nullable=True)
    canceled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    card_number = Column(String(20), nullable=True)
    card_type = Column(String(20), nullable=True)
    failure_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="subscriptions")
    billing_history = relationship("BillingHistory", back_populates="subscription")


class BillingHistory(Base):
    __tablename__ = "billing_history"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    amount = Column(Integer, nullable=False)
    status = Column(String(20), default="PENDING")
    billing_date = Column(DateTime(timezone=True), nullable=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    failed_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subscription = relationship("Subscription", back_populates="billing_history")
    payment = relationship("Payment")


class PaymentWebhook(Base):
    __tablename__ = "payment_webhooks"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    webhook_id = Column(String(200), unique=True, index=True)
    event_type = Column(String(50), nullable=False)
    status = Column(String(20), default="PENDING")
    payload = Column(Text, nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", back_populates="webhooks")