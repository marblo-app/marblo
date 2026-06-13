"""
Test cases for subscription API endpoints.
"""
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from backend.models.payment import SubscriptionStatus, SubscriptionPlan


class TestSubscriptionAPI:
    """Test subscription-related API endpoints."""

    def test_create_subscription_success(self, client: TestClient, test_user, sample_subscription_data):
        """Test successful subscription creation."""
        response = client.post("/api/v1/payments/subscriptions", json=sample_subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["plan"] == sample_subscription_data["plan"]
        assert data["billing_cycle"] == sample_subscription_data["billing_cycle"]
        assert data["status"] == "trialing"  # Should start with trial

    def test_create_subscription_no_billing_key(self, client: TestClient, db_session):
        """Test subscription creation without billing key."""
        from backend.models.user import User

        # Create user without customer_key
        user = User(
            email="nobilling@example.com",
            username="nobilling",
            is_active=True
        )
        db_session.add(user)
        db_session.commit()

        subscription_data = {
            "plan": SubscriptionPlan.PRO,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)
        assert response.status_code == 400
        assert "No billing key registered" in response.json()["detail"]

    def test_create_subscription_already_exists(self, client: TestClient, test_subscription, sample_subscription_data):
        """Test subscription creation when one already exists."""
        response = client.post("/api/v1/payments/subscriptions", json=sample_subscription_data)

        assert response.status_code == 400
        assert "Active subscription already exists" in response.json()["detail"]

    def test_create_yearly_subscription(self, client: TestClient, test_user):
        """Test yearly subscription creation with discount."""
        subscription_data = {
            "plan": SubscriptionPlan.PRO,
            "billing_cycle": "yearly",
            "trial_days": 14
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["billing_cycle"] == "yearly"
        # Yearly = monthly x 10 (2 months free): 19000 * 10
        assert data["amount"] == 19000 * 10

    def test_get_current_subscription(self, client: TestClient, test_subscription):
        """Test current subscription retrieval."""
        response = client.get("/api/v1/payments/subscriptions/current")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_subscription.id
        assert data["plan"] == test_subscription.plan
        assert data["status"] == test_subscription.status

    def test_get_current_subscription_not_found(self, client: TestClient, test_user):
        """Test current subscription retrieval when none exists."""
        response = client.get("/api/v1/payments/subscriptions/current")

        assert response.status_code == 404
        assert "No active subscription found" in response.json()["detail"]

    def test_update_subscription_plan(self, client: TestClient, test_subscription):
        """Test subscription plan update."""
        update_data = {
            "plan": SubscriptionPlan.PRO
        }

        response = client.patch(f"/api/v1/payments/subscriptions/{test_subscription.id}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["plan"] == SubscriptionPlan.PRO
        assert data["amount"] == 19000  # PRO plan price

    def test_update_subscription_billing_cycle(self, client: TestClient, test_subscription):
        """Test subscription billing cycle update."""
        update_data = {
            "billing_cycle": "yearly"
        }

        response = client.patch(f"/api/v1/payments/subscriptions/{test_subscription.id}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["billing_cycle"] == "yearly"

    def test_update_subscription_not_found(self, client: TestClient):
        """Test subscription update for non-existent subscription."""
        update_data = {
            "plan": SubscriptionPlan.PRO
        }

        response = client.patch("/api/v1/payments/subscriptions/999999", json=update_data)
        assert response.status_code == 404

    def test_update_canceled_subscription(self, client: TestClient, test_subscription, db_session):
        """Test updating a canceled subscription."""
        # Cancel the subscription first
        test_subscription.status = SubscriptionStatus.CANCELED
        db_session.commit()

        update_data = {
            "plan": SubscriptionPlan.PRO
        }

        response = client.patch(f"/api/v1/payments/subscriptions/{test_subscription.id}", json=update_data)
        assert response.status_code == 400
        assert "Can only update active subscriptions" in response.json()["detail"]

    def test_cancel_subscription_immediate(self, client: TestClient, test_subscription):
        """Test immediate subscription cancellation."""
        cancel_data = {
            "cancel_reason": "No longer needed",
            "immediate": True
        }

        response = client.post(f"/api/v1/payments/subscriptions/{test_subscription.id}/cancel", json=cancel_data)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Subscription canceled successfully"

    def test_cancel_subscription_end_of_period(self, client: TestClient, test_subscription):
        """Test subscription cancellation at end of period."""
        cancel_data = {
            "cancel_reason": "Switching to another service",
            "immediate": False
        }

        response = client.post(f"/api/v1/payments/subscriptions/{test_subscription.id}/cancel", json=cancel_data)

        assert response.status_code == 200

    def test_cancel_already_canceled_subscription(self, client: TestClient, test_subscription, db_session):
        """Test canceling an already canceled subscription."""
        # Cancel the subscription first
        test_subscription.status = SubscriptionStatus.CANCELED
        db_session.commit()

        cancel_data = {
            "cancel_reason": "Test cancellation",
            "immediate": True
        }

        response = client.post(f"/api/v1/payments/subscriptions/{test_subscription.id}/cancel", json=cancel_data)
        assert response.status_code == 400
        assert "Subscription already canceled" in response.json()["detail"]

    def test_cancel_subscription_not_found(self, client: TestClient):
        """Test canceling non-existent subscription."""
        cancel_data = {
            "cancel_reason": "Test cancellation",
            "immediate": True
        }

        response = client.post("/api/v1/payments/subscriptions/999999/cancel", json=cancel_data)
        assert response.status_code == 404

    def test_get_billing_history(self, client: TestClient, test_subscription, db_session):
        """Test billing history retrieval."""
        from backend.models.payment import BillingHistory

        # Create some billing history
        billing_record = BillingHistory(
            subscription_id=test_subscription.id,
            amount=9900,
            status="PAID",
            billing_date=datetime.now(),
            paid_at=datetime.now()
        )
        db_session.add(billing_record)
        db_session.commit()

        response = client.get(f"/api/v1/payments/subscriptions/{test_subscription.id}/billing-history")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["subscription_id"] == test_subscription.id
        assert data[0]["status"] == "PAID"

    def test_get_billing_history_subscription_not_found(self, client: TestClient):
        """Test billing history for non-existent subscription."""
        response = client.get("/api/v1/payments/subscriptions/999999/billing-history")
        assert response.status_code == 404


class TestSubscriptionPlans:
    """Test subscription plan-specific functionality."""

    def test_free_plan_subscription(self, client: TestClient, test_user):
        """Test free plan subscription."""
        subscription_data = {
            "plan": SubscriptionPlan.FREE,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 0  # Free plan should be 0
        assert data["plan"] == SubscriptionPlan.FREE

    def test_team_plan_subscription(self, client: TestClient, test_user):
        """Test team plan subscription."""
        subscription_data = {
            "plan": SubscriptionPlan.TEAM,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 29000  # Team plan price (per seat)
        assert data["plan"] == SubscriptionPlan.TEAM

    def test_pro_plan_subscription(self, client: TestClient, test_user):
        """Test pro plan subscription."""
        subscription_data = {
            "plan": SubscriptionPlan.PRO,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 19000  # Pro plan price
        assert data["plan"] == SubscriptionPlan.PRO

    def test_team_plus_plan_subscription(self, client: TestClient, test_user):
        """Test team_plus plan subscription (per-team floor, 5 seats incl.)."""
        subscription_data = {
            "plan": SubscriptionPlan.TEAM_PLUS,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 290000  # Team Plus floor (5 seats)
        assert data["plan"] == SubscriptionPlan.TEAM_PLUS

    def test_enterprise_plan_subscription(self, client: TestClient, test_user):
        """Test enterprise plan subscription."""
        subscription_data = {
            "plan": SubscriptionPlan.ENTERPRISE,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 0  # Enterprise — Contact Sales (negotiated)
        assert data["plan"] == SubscriptionPlan.ENTERPRISE


class TestTrialPeriods:
    """Test trial period functionality."""

    def test_subscription_with_trial(self, client: TestClient, test_user):
        """Test subscription creation with trial period."""
        subscription_data = {
            "plan": SubscriptionPlan.PRO,
            "billing_cycle": "monthly",
            "trial_days": 14
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "trialing"
        assert data["trial_end_date"] is not None

    def test_subscription_without_trial(self, client: TestClient, test_user):
        """Test subscription creation without trial period."""
        subscription_data = {
            "plan": SubscriptionPlan.PRO,
            "billing_cycle": "monthly"
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        assert data["trial_end_date"] is None

    def test_invalid_trial_days(self, client: TestClient, test_user):
        """Test subscription creation with invalid trial days."""
        subscription_data = {
            "plan": SubscriptionPlan.PRO,
            "billing_cycle": "monthly",
            "trial_days": 100  # Exceeds 30 day limit
        }

        response = client.post("/api/v1/payments/subscriptions", json=subscription_data)
        assert response.status_code == 422  # Validation error