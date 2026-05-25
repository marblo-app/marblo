"""Initial migration - create users, payments, and subscription tables

Revision ID: 001_initial_migration
Revises:
Create Date: 2026-05-02 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial_migration'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create ENUM types
    op.execute("CREATE TYPE paymentstatus AS ENUM ('pending', 'ready', 'in_progress', 'done', 'canceled', 'partial_canceled', 'aborted', 'expired')")
    op.execute("CREATE TYPE paymentmethod AS ENUM ('카드', '가상계좌', '계좌이체', '휴대폰', '상품권', '간편결제')")
    op.execute("CREATE TYPE subscriptionstatus AS ENUM ('active', 'canceled', 'expired', 'pending', 'trialing', 'past_due')")
    op.execute("CREATE TYPE subscriptionplan AS ENUM ('free', 'basic', 'pro', 'enterprise')")

    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=100), nullable=False),
        sa.Column('username', sa.String(length=50), nullable=True),
        sa.Column('full_name', sa.String(length=100), nullable=True),
        sa.Column('hashed_password', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('is_superuser', sa.Boolean(), nullable=True),
        sa.Column('phone', sa.String(length=20), nullable=True),
        sa.Column('customer_key', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
    op.create_index(op.f('ix_users_customer_key'), 'users', ['customer_key'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)

    # Create payments table
    op.create_table(
        'payments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('payment_key', sa.String(length=200), nullable=True),
        sa.Column('order_id', sa.String(length=64), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=True),
        sa.Column('status', sa.Enum('pending', 'ready', 'in_progress', 'done', 'canceled', 'partial_canceled', 'aborted', 'expired', name='paymentstatus'), nullable=True),
        sa.Column('method', sa.Enum('카드', '가상계좌', '계좌이체', '휴대폰', '상품권', '간편결제', name='paymentmethod'), nullable=True),
        sa.Column('requested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('canceled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancel_amount', sa.Integer(), nullable=True),
        sa.Column('cancel_reason', sa.Text(), nullable=True),
        sa.Column('card_number', sa.String(length=20), nullable=True),
        sa.Column('card_type', sa.String(length=20), nullable=True),
        sa.Column('receipt_url', sa.String(length=500), nullable=True),
        sa.Column('checkout_url', sa.String(length=500), nullable=True),
        sa.Column('failure_code', sa.String(length=50), nullable=True),
        sa.Column('failure_message', sa.Text(), nullable=True),
        sa.Column('metadata', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payments_payment_key'), 'payments', ['payment_key'], unique=True)
    op.create_index(op.f('ix_payments_order_id'), 'payments', ['order_id'], unique=True)
    op.create_index(op.f('ix_payments_id'), 'payments', ['id'], unique=False)

    # Create subscriptions table
    op.create_table(
        'subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subscription_id', sa.String(length=200), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('customer_key', sa.String(length=200), nullable=True),
        sa.Column('billing_key', sa.String(length=200), nullable=True),
        sa.Column('plan', sa.Enum('free', 'basic', 'pro', 'enterprise', name='subscriptionplan'), nullable=True),
        sa.Column('status', sa.Enum('active', 'canceled', 'expired', 'pending', 'trialing', 'past_due', name='subscriptionstatus'), nullable=True),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('billing_cycle', sa.String(length=20), nullable=True),
        sa.Column('trial_end_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('next_billing_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('canceled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancel_reason', sa.Text(), nullable=True),
        sa.Column('card_number', sa.String(length=20), nullable=True),
        sa.Column('card_type', sa.String(length=20), nullable=True),
        sa.Column('failure_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscriptions_subscription_id'), 'subscriptions', ['subscription_id'], unique=True)
    op.create_index(op.f('ix_subscriptions_customer_key'), 'subscriptions', ['customer_key'], unique=False)
    op.create_index(op.f('ix_subscriptions_billing_key'), 'subscriptions', ['billing_key'], unique=False)
    op.create_index(op.f('ix_subscriptions_id'), 'subscriptions', ['id'], unique=False)

    # Create payment_refunds table
    op.create_table(
        'payment_refunds',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('refund_key', sa.String(length=200), nullable=True),
        sa.Column('payment_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('requested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payment_refunds_refund_key'), 'payment_refunds', ['refund_key'], unique=True)
    op.create_index(op.f('ix_payment_refunds_id'), 'payment_refunds', ['id'], unique=False)

    # Create billing_history table
    op.create_table(
        'billing_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subscription_id', sa.Integer(), nullable=False),
        sa.Column('payment_id', sa.Integer(), nullable=True),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('billing_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
        sa.ForeignKeyConstraint(['subscription_id'], ['subscriptions.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_billing_history_id'), 'billing_history', ['id'], unique=False)

    # Create payment_webhooks table
    op.create_table(
        'payment_webhooks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('payment_id', sa.Integer(), nullable=True),
        sa.Column('webhook_id', sa.String(length=200), nullable=True),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payment_webhooks_webhook_id'), 'payment_webhooks', ['webhook_id'], unique=True)
    op.create_index(op.f('ix_payment_webhooks_id'), 'payment_webhooks', ['id'], unique=False)


def downgrade() -> None:
    # Drop all tables in reverse order
    op.drop_table('payment_webhooks')
    op.drop_table('billing_history')
    op.drop_table('payment_refunds')
    op.drop_table('subscriptions')
    op.drop_table('payments')
    op.drop_table('users')

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS paymentstatus")
    op.execute("DROP TYPE IF EXISTS paymentmethod")
    op.execute("DROP TYPE IF EXISTS subscriptionstatus")
    op.execute("DROP TYPE IF EXISTS subscriptionplan")