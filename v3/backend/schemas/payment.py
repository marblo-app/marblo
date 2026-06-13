from pydantic import BaseModel, Field, EmailStr, validator
from typing import Optional, List
from datetime import datetime
from backend.models.payment import PaymentStatus, PaymentMethod, SubscriptionStatus, SubscriptionPlan


class PaymentRequestCreate(BaseModel):
    amount: int = Field(..., gt=0, description="결제 금액")
    order_name: str = Field(..., min_length=1, max_length=100, description="주문명")
    customer_email: EmailStr = Field(..., description="고객 이메일")
    customer_name: str = Field(..., min_length=1, max_length=50, description="고객명")
    success_url: str = Field(..., description="결제 성공 시 리다이렉트 URL")
    fail_url: str = Field(..., description="결제 실패 시 리다이렉트 URL")
    payment_method: Optional[str] = Field(default="TOSS", description="결제 방식 (TOSS, NAVERPAY)")


class PaymentConfirm(BaseModel):
    payment_key: str = Field(..., description="토스페이먼츠 결제 키")
    order_id: str = Field(..., description="주문 ID")
    amount: int = Field(..., gt=0, description="결제 금액")


class PaymentCancel(BaseModel):
    payment_key: str = Field(..., description="토스페이먼츠 결제 키")
    cancel_reason: str = Field(..., min_length=1, max_length=200, description="취소 사유")
    cancel_amount: Optional[int] = Field(None, gt=0, description="취소 금액 (부분 취소 시)")


class PaymentResponse(BaseModel):
    id: int
    payment_key: Optional[str]
    order_id: str
    amount: int
    currency: str
    status: PaymentStatus
    method: Optional[PaymentMethod]
    requested_at: datetime
    approved_at: Optional[datetime]
    canceled_at: Optional[datetime]
    cancel_amount: int
    cancel_reason: Optional[str]
    receipt_url: Optional[str]
    checkout_url: Optional[str]
    failure_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class RefundRequest(BaseModel):
    payment_key: str = Field(..., description="토스페이먼츠 결제 키")
    amount: int = Field(..., gt=0, description="환불 금액")
    reason: str = Field(..., min_length=1, max_length=200, description="환불 사유")


class RefundResponse(BaseModel):
    id: int
    refund_key: Optional[str]
    payment_id: int
    amount: int
    reason: str
    status: str
    requested_at: datetime
    approved_at: Optional[datetime]
    failed_at: Optional[datetime]
    failure_reason: Optional[str]

    class Config:
        from_attributes = True


class BillingKeyRequest(BaseModel):
    payment_method: Optional[str] = Field(default="TOSS", description="결제 방식 (TOSS, NAVERPAY)")
    card_number: Optional[str] = Field(None, pattern=r"^\d{13,19}$", description="카드 번호 (Toss 전용)")
    card_expiry_year: Optional[str] = Field(None, pattern=r"^\d{2}$", description="카드 만료 연도 (YY, Toss 전용)")
    card_expiry_month: Optional[str] = Field(None, pattern=r"^\d{2}$", description="카드 만료 월 (MM, Toss 전용)")
    card_password: Optional[str] = Field(None, pattern=r"^\d{2}$", description="카드 비밀번호 앞 2자리 (Toss 전용)")
    birth_or_business_number: Optional[str] = Field(None, description="생년월일 6자리 또는 사업자번호 10자리 (Toss 전용)")
    return_url: Optional[str] = Field(None, description="NaverPay 빌링 인증 완료 후 리다이렉트 URL")

    @validator('card_expiry_month')
    def validate_month(cls, v):
        if v is not None:
            month = int(v)
            if not 1 <= month <= 12:
                raise ValueError('Month must be between 01 and 12')
        return v

    @validator('birth_or_business_number')
    def validate_identity_number(cls, v):
        if v is not None:
            if len(v) not in [6, 10]:
                raise ValueError('Must be 6 digits (birth) or 10 digits (business)')
            if not v.isdigit():
                raise ValueError('Must contain only digits')
        return v

    @validator('card_number', 'card_expiry_year', 'card_expiry_month', 'card_password', 'birth_or_business_number')
    def validate_toss_fields(cls, v, values):
        payment_method = values.get('payment_method', 'TOSS').upper()
        if payment_method == 'TOSS' and v is None:
            raise ValueError('Card information is required for Toss payments')
        return v


class SubscriptionCreate(BaseModel):
    plan: SubscriptionPlan = Field(..., description="구독 플랜")
    billing_cycle: str = Field(default="monthly", pattern="^(monthly|yearly)$", description="결제 주기")
    trial_days: Optional[int] = Field(None, ge=0, le=30, description="무료 체험 일수")


class SubscriptionResponse(BaseModel):
    id: int
    subscription_id: str
    user_id: int
    customer_key: str
    billing_key: str
    plan: SubscriptionPlan
    status: SubscriptionStatus
    amount: int
    billing_cycle: str
    trial_end_date: Optional[datetime]
    current_period_start: datetime
    current_period_end: datetime
    next_billing_date: Optional[datetime]
    canceled_at: Optional[datetime]
    cancel_reason: Optional[str]
    failure_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class SubscriptionUpdate(BaseModel):
    plan: Optional[SubscriptionPlan] = Field(None, description="변경할 구독 플랜")
    billing_cycle: Optional[str] = Field(None, pattern="^(monthly|yearly)$", description="변경할 결제 주기")


class SubscriptionCancel(BaseModel):
    cancel_reason: str = Field(..., min_length=1, max_length=200, description="구독 취소 사유")
    immediate: bool = Field(default=False, description="즉시 취소 여부")


class BillingHistoryResponse(BaseModel):
    id: int
    subscription_id: int
    payment_id: Optional[int]
    amount: int
    status: str
    billing_date: datetime
    paid_at: Optional[datetime]
    failed_at: Optional[datetime]
    failure_reason: Optional[str]
    retry_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class WebhookPayload(BaseModel):
    event_type: str = Field(..., description="웹훅 이벤트 타입")
    timestamp: str = Field(..., description="타임스탬프")
    signature: str = Field(..., description="서명")
    data: dict = Field(..., description="이벤트 데이터")


class PaymentStatistics(BaseModel):
    total_revenue: int
    total_transactions: int
    successful_payments: int
    failed_payments: int
    refunded_amount: int
    average_transaction_value: float
    period_start: datetime
    period_end: datetime


class SubscriptionStatistics(BaseModel):
    total_subscribers: int
    active_subscriptions: int
    canceled_subscriptions: int
    trial_users: int
    monthly_recurring_revenue: int
    annual_recurring_revenue: int
    churn_rate: float
    average_revenue_per_user: float
