"""
Test configuration and fixtures for the payment system.
"""
import pytest
import asyncio
from datetime import datetime
from typing import Generator, AsyncGenerator
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import Mock, AsyncMock

from backend.main import app
from backend.db.base import Base, get_db
from backend.models.user import User
from backend.models.payment import Payment, Subscription, PaymentStatus, SubscriptionStatus, SubscriptionPlan
from backend.services.payment_service import TossPaymentsService
from backend.services.naverpay_service import NaverPayService


# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def db_session():
    """Create a fresh database session for each test."""
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db_session):
    """Create a test client."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def test_user(db_session):
    """Create a test user."""
    user = User(
        email="test@example.com",
        username="testuser",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
        customer_key="test_customer_123"
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def mock_toss_service():
    """Mock TossPaymentsService for testing."""
    service = Mock(spec=TossPaymentsService)

    # Mock successful payment request
    async def mock_request_payment(*args, **kwargs):
        now = datetime.now()
        payment = Payment(
            id=1,
            order_id="test_order_123",
            user_id=kwargs.get('user_id', 1),
            amount=kwargs.get('amount', 10000),
            currency="KRW",
            status=PaymentStatus.READY,
            checkout_url="https://checkout.toss.com/test",
            requested_at=now,
            cancel_amount=0,
            created_at=now
        )
        return payment

    # Mock successful payment confirmation
    async def mock_confirm_payment(*args, **kwargs):
        now = datetime.now()
        payment = Payment(
            id=1,
            payment_key="test_payment_key_123",
            order_id=kwargs.get('order_id', 'test_order_123'),
            user_id=1,
            amount=kwargs.get('amount', 10000),
            currency="KRW",
            status=PaymentStatus.DONE,
            method="카드",
            receipt_url="https://receipt.toss.com/test",
            requested_at=now,
            cancel_amount=0,
            created_at=now
        )
        return payment

    # Mock successful payment cancellation
    async def mock_cancel_payment(*args, **kwargs):
        now = datetime.now()
        payment = Payment(
            id=1,
            payment_key=kwargs.get('payment_key', 'test_payment_key_123'),
            order_id="test_order_123",
            user_id=1,
            amount=10000,
            currency="KRW",
            status=PaymentStatus.CANCELED,
            cancel_amount=kwargs.get('cancel_amount') or 10000,
            cancel_reason=kwargs.get('cancel_reason', 'Test cancellation'),
            requested_at=now,
            created_at=now
        )
        return payment

    # Mock billing key creation
    async def mock_create_billing_key(*args, **kwargs):
        return "billing_key_test_123"

    # Mock webhook verification
    def mock_verify_webhook(*args, **kwargs):
        return True

    # Mock payment status check
    async def mock_get_payment_status(*args, **kwargs):
        return {
            "paymentKey": "test_payment_key_123",
            "orderId": "test_order_123",
            "status": "DONE",
            "totalAmount": 10000,
            "method": "카드"
        }

    service.request_payment = AsyncMock(side_effect=mock_request_payment)
    service.confirm_payment = AsyncMock(side_effect=mock_confirm_payment)
    service.cancel_payment = AsyncMock(side_effect=mock_cancel_payment)
    service.create_billing_key = AsyncMock(side_effect=mock_create_billing_key)
    service.verify_webhook = Mock(side_effect=mock_verify_webhook)
    service.get_payment_status = AsyncMock(side_effect=mock_get_payment_status)

    return service


@pytest.fixture
def mock_naverpay_service():
    """Mock NaverPayService for testing."""
    service = Mock(spec=NaverPayService)

    # Mock successful payment request
    async def mock_request_payment(*args, **kwargs):
        payment = Payment(
            order_id="naverpay_order_123",
            user_id=kwargs.get('user_id', 1),
            amount=kwargs.get('amount', 10000),
            status=PaymentStatus.READY,
            checkout_url="https://pay.naver.com/test"
        )
        return payment

    # Mock successful billing agreement creation
    async def mock_create_billing_agreement(*args, **kwargs):
        return "https://pay.naver.com/billing/agreement/test"

    service.request_payment = AsyncMock(side_effect=mock_request_payment)
    service.create_billing_agreement = AsyncMock(side_effect=mock_create_billing_agreement)
    service.verify_webhook = Mock(return_value=True)

    return service


@pytest.fixture
def sample_payment_data():
    """Sample payment request data."""
    return {
        "amount": 10000,
        "order_name": "Test Product",
        "customer_email": "customer@example.com",
        "customer_name": "Test Customer",
        "success_url": "http://localhost:3001/success",
        "fail_url": "http://localhost:3001/fail"
    }


@pytest.fixture
def sample_subscription_data():
    """Sample subscription creation data."""
    return {
        "plan": SubscriptionPlan.PRO,
        "billing_cycle": "monthly",
        "trial_days": 7
    }


@pytest.fixture
def test_payment(db_session, test_user):
    """Create a test payment."""
    payment = Payment(
        payment_key="test_payment_key_123",
        order_id="test_order_123",
        user_id=test_user.id,
        amount=10000,
        status=PaymentStatus.DONE
    )
    db_session.add(payment)
    db_session.commit()
    db_session.refresh(payment)
    return payment


@pytest.fixture
def test_subscription(db_session, test_user):
    """Create a test subscription."""
    from datetime import datetime, timedelta

    now = datetime.now()
    subscription = Subscription(
        subscription_id="test_subscription_123",
        user_id=test_user.id,
        customer_key=test_user.customer_key,
        billing_key="test_billing_key_123",
        plan=SubscriptionPlan.PRO,
        status=SubscriptionStatus.ACTIVE,
        amount=19000,
        billing_cycle="monthly",
        current_period_start=now,
        current_period_end=now + timedelta(days=30),
        next_billing_date=now + timedelta(days=30)
    )
    db_session.add(subscription)
    db_session.commit()
    db_session.refresh(subscription)
    return subscription
