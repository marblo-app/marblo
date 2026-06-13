from fastapi import APIRouter, Depends, HTTPException, Header, Request, BackgroundTasks
from sqlalchemy.orm import Session, selectinload
from typing import Optional, List
from datetime import datetime, timedelta
import json
import uuid
from backend.db.base import get_db
from backend.services.payment_service import TossPaymentsService
from backend.services.naverpay_service import NaverPayService
from backend.schemas.payment import (
    PaymentRequestCreate,
    PaymentConfirm,
    PaymentCancel,
    PaymentResponse,
    RefundRequest,
    RefundResponse,
    BillingKeyRequest,
    SubscriptionCreate,
    SubscriptionResponse,
    SubscriptionUpdate,
    SubscriptionCancel,
    BillingHistoryResponse,
    WebhookPayload,
    PaymentStatistics,
    SubscriptionStatistics
)
from backend.models.payment import (
    Payment,
    PaymentRefund,
    Subscription,
    SubscriptionStatus,
    SubscriptionPlan,
    BillingHistory,
    PaymentWebhook
)
from backend.models.user import User
import logging

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])
logger = logging.getLogger(__name__)
toss_service = TossPaymentsService()
naverpay_service = NaverPayService()


def get_current_user(user_id: int = 1) -> int:
    return user_id


@router.post("/request", response_model=PaymentResponse)
async def request_payment(
    payment_request: PaymentRequestCreate,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    try:
        payment_method = getattr(payment_request, 'payment_method', 'TOSS').upper()

        if payment_method == "NAVERPAY":
            payment = await naverpay_service.request_payment(
                db=db,
                user_id=user_id,
                amount=payment_request.amount,
                order_name=payment_request.order_name,
                customer_email=payment_request.customer_email,
                customer_name=payment_request.customer_name,
                success_url=payment_request.success_url,
                fail_url=payment_request.fail_url,
                payment_method="NAVERPAY"
            )
        else:
            payment = await toss_service.request_payment(
                db=db,
                user_id=user_id,
                amount=payment_request.amount,
                order_name=payment_request.order_name,
                customer_email=payment_request.customer_email,
                customer_name=payment_request.customer_name,
                success_url=payment_request.success_url,
                fail_url=payment_request.fail_url
            )
        return PaymentResponse.from_orm(payment)
    except Exception as e:
        logger.error(f"Payment request failed: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/confirm", response_model=PaymentResponse)
async def confirm_payment(
    payment_confirm: PaymentConfirm,
    db: Session = Depends(get_db)
):
    try:
        payment = db.query(Payment).filter(Payment.order_id == payment_confirm.order_id).first()
        if not payment:
            raise ValueError(f"Payment not found for order_id: {payment_confirm.order_id}")

        if payment.method == "NAVERPAY":
            payment = await naverpay_service.confirm_payment(
                db=db,
                payment_key=payment_confirm.payment_key,
                order_id=payment_confirm.order_id,
                amount=payment_confirm.amount
            )
        else:
            payment = await toss_service.confirm_payment(
                db=db,
                payment_key=payment_confirm.payment_key,
                order_id=payment_confirm.order_id,
                amount=payment_confirm.amount
            )
        return PaymentResponse.from_orm(payment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Payment confirmation failed: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cancel", response_model=PaymentResponse)
async def cancel_payment(
    payment_cancel: PaymentCancel,
    db: Session = Depends(get_db)
):
    try:
        payment = db.query(Payment).filter(Payment.payment_key == payment_cancel.payment_key).first()
        if not payment:
            raise ValueError(f"Payment not found for payment_key: {payment_cancel.payment_key}")

        if payment.method == "NAVERPAY" or payment.method == "NAVERPAY_BILLING":
            payment = await naverpay_service.cancel_payment(
                db=db,
                payment_key=payment_cancel.payment_key,
                cancel_reason=payment_cancel.cancel_reason,
                cancel_amount=payment_cancel.cancel_amount
            )
        else:
            payment = await toss_service.cancel_payment(
                db=db,
                payment_key=payment_cancel.payment_key,
                cancel_reason=payment_cancel.cancel_reason,
                cancel_amount=payment_cancel.cancel_amount
            )
        return PaymentResponse.from_orm(payment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Payment cancellation failed: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/status/{payment_key}")
async def get_payment_status(payment_key: str, db: Session = Depends(get_db)):
    try:
        payment = db.query(Payment).filter(Payment.payment_key == payment_key).first()
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        if payment.method == "NAVERPAY" or payment.method == "NAVERPAY_BILLING":
            status = await naverpay_service.get_payment_status(payment_key)
        else:
            status = await toss_service.get_payment_status(payment_key)
        return status
    except Exception as e:
        logger.error(f"Failed to get payment status: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/history", response_model=List[PaymentResponse])
async def get_payment_history(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    payments = db.query(Payment).filter(
        Payment.user_id == user_id
    ).order_by(Payment.created_at.desc()).offset(skip).limit(limit).all()

    return [PaymentResponse.from_orm(payment) for payment in payments]


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment_detail(
    payment_id: int,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    payment = db.query(Payment).filter(
        Payment.id == payment_id,
        Payment.user_id == user_id
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    return PaymentResponse.from_orm(payment)


@router.post("/billing/register")
async def register_billing_key(
    billing_request: BillingKeyRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        customer_key = user.customer_key or f"customer_{uuid.uuid4().hex[:16]}"
        payment_method = getattr(billing_request, 'payment_method', 'TOSS').upper()

        if payment_method == "NAVERPAY":
            redirect_url = await naverpay_service.create_billing_agreement(
                db=db,
                user_id=user_id,
                customer_email=user.email,
                customer_name=user.name,
                return_url=getattr(billing_request, 'return_url', 'http://localhost:3001/billing/callback')
            )
            return {"redirect_url": redirect_url, "customer_key": customer_key}
        else:
            billing_key = await toss_service.create_billing_key(
                db=db,
                user_id=user_id,
                customer_key=customer_key,
                card_number=billing_request.card_number,
                card_expiry_year=billing_request.card_expiry_year,
                card_expiry_month=billing_request.card_expiry_month,
                card_password=billing_request.card_password,
                birth_or_business_number=billing_request.birth_or_business_number
            )
            return {"billing_key": billing_key, "customer_key": customer_key}
    except Exception as e:
        logger.error(f"Failed to register billing key: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/subscriptions", response_model=SubscriptionResponse)
async def create_subscription(
    subscription: SubscriptionCreate,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if not user.customer_key:
            raise HTTPException(status_code=400, detail="No billing key registered")

        existing_sub = db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING])
        ).first()

        if existing_sub:
            raise HTTPException(status_code=400, detail="Active subscription already exists")

        plan_amounts = {
            SubscriptionPlan.FREE: 0,
            SubscriptionPlan.PRO: 19000,
            SubscriptionPlan.TEAM: 29000,          # per seat
            SubscriptionPlan.TEAM_PLUS: 290000,    # per team (5 seats incl.)
            SubscriptionPlan.ENTERPRISE: 0,        # Contact Sales — negotiated
        }

        if subscription.billing_cycle == "yearly":
            amount = plan_amounts[subscription.plan] * 10  # 연 = 월 × 10 (2개월 무료)
        else:
            amount = plan_amounts[subscription.plan]

        now = datetime.now()
        trial_end = now + timedelta(days=subscription.trial_days) if subscription.trial_days else None

        if subscription.billing_cycle == "yearly":
            period_end = now + timedelta(days=365)
        else:
            period_end = now + timedelta(days=30)

        new_subscription = Subscription(
            subscription_id=f"sub_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            customer_key=user.customer_key,
            billing_key="",
            plan=subscription.plan,
            status=SubscriptionStatus.TRIALING if trial_end else SubscriptionStatus.ACTIVE,
            amount=int(amount),
            billing_cycle=subscription.billing_cycle,
            trial_end_date=trial_end,
            current_period_start=now,
            current_period_end=period_end,
            next_billing_date=trial_end or period_end
        )

        db.add(new_subscription)
        db.commit()
        db.refresh(new_subscription)

        return SubscriptionResponse.from_orm(new_subscription)
    except Exception as e:
        logger.error(f"Failed to create subscription: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/subscriptions/current", response_model=SubscriptionResponse)
async def get_current_subscription(
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    subscription = db.query(Subscription).filter(
        Subscription.user_id == user_id,
        Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING])
    ).first()

    if not subscription:
        raise HTTPException(status_code=404, detail="No active subscription found")

    return SubscriptionResponse.from_orm(subscription)


@router.patch("/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def update_subscription(
    subscription_id: int,
    update_data: SubscriptionUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    subscription = db.query(Subscription).filter(
        Subscription.id == subscription_id,
        Subscription.user_id == user_id
    ).first()

    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")

    if subscription.status not in [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]:
        raise HTTPException(status_code=400, detail="Can only update active subscriptions")

    if update_data.plan:
        plan_amounts = {
            SubscriptionPlan.FREE: 0,
            SubscriptionPlan.PRO: 19000,
            SubscriptionPlan.TEAM: 29000,          # per seat
            SubscriptionPlan.TEAM_PLUS: 290000,    # per team (5 seats incl.)
            SubscriptionPlan.ENTERPRISE: 0,        # Contact Sales — negotiated
        }
        subscription.plan = update_data.plan
        subscription.amount = plan_amounts[update_data.plan]

    if update_data.billing_cycle:
        subscription.billing_cycle = update_data.billing_cycle

    db.commit()
    db.refresh(subscription)

    return SubscriptionResponse.from_orm(subscription)


@router.post("/subscriptions/{subscription_id}/cancel")
async def cancel_subscription(
    subscription_id: int,
    cancel_data: SubscriptionCancel,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    subscription = db.query(Subscription).filter(
        Subscription.id == subscription_id,
        Subscription.user_id == user_id
    ).first()

    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")

    if subscription.status == SubscriptionStatus.CANCELED:
        raise HTTPException(status_code=400, detail="Subscription already canceled")

    subscription.canceled_at = datetime.now()
    subscription.cancel_reason = cancel_data.cancel_reason

    if cancel_data.immediate:
        subscription.status = SubscriptionStatus.CANCELED
        subscription.current_period_end = datetime.now()
    else:
        subscription.status = SubscriptionStatus.CANCELED

    db.commit()

    return {"message": "Subscription canceled successfully"}


@router.get("/subscriptions/{subscription_id}/billing-history", response_model=List[BillingHistoryResponse])
async def get_billing_history(
    subscription_id: int,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user)
):
    subscription = db.query(Subscription).filter(
        Subscription.id == subscription_id,
        Subscription.user_id == user_id
    ).first()

    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")

    billing_history = db.query(BillingHistory).filter(
        BillingHistory.subscription_id == subscription_id
    ).order_by(BillingHistory.billing_date.desc()).all()

    return [BillingHistoryResponse.from_orm(record) for record in billing_history]


@router.post("/webhook/toss")
async def handle_toss_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_toss_webhook_signature: str = Header(None),
    x_toss_webhook_timestamp: str = Header(None)
):
    try:
        body = await request.body()
        body_str = body.decode('utf-8')

        if not toss_service.verify_webhook(
            signature=x_toss_webhook_signature,
            timestamp=x_toss_webhook_timestamp,
            body=body_str
        ):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

        data = json.loads(body_str)
        event_type = data.get("eventType")

        webhook = PaymentWebhook(
            webhook_id=data.get("id", str(uuid.uuid4())),
            event_type=event_type,
            payload=body_str,
            status="PENDING"
        )
        db.add(webhook)
        db.commit()

        background_tasks.add_task(
            process_toss_webhook_async,
            db,
            webhook.id,
            event_type,
            data
        )

        return {"status": "received"}
    except Exception as e:
        logger.error(f"Toss webhook processing failed: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhook/naverpay")
async def handle_naverpay_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_naverpay_signature: str = Header(None),
    x_naverpay_timestamp: str = Header(None)
):
    try:
        body = await request.body()
        body_str = body.decode('utf-8')

        if not naverpay_service.verify_webhook(
            signature=x_naverpay_signature,
            timestamp=x_naverpay_timestamp,
            body=body_str
        ):
            raise HTTPException(status_code=401, detail="Invalid NaverPay webhook signature")

        data = json.loads(body_str)
        event_type = data.get("eventType")

        webhook = PaymentWebhook(
            webhook_id=data.get("id", str(uuid.uuid4())),
            event_type=event_type,
            payload=body_str,
            status="PENDING"
        )
        db.add(webhook)
        db.commit()

        background_tasks.add_task(
            process_naverpay_webhook_async,
            db,
            webhook.id,
            event_type,
            data
        )

        return {"status": "received"}
    except Exception as e:
        logger.error(f"NaverPay webhook processing failed: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


async def process_toss_webhook_async(
    db: Session,
    webhook_id: int,
    event_type: str,
    data: dict
):
    try:
        webhook = db.query(PaymentWebhook).filter(PaymentWebhook.id == webhook_id).first()

        await toss_service.process_webhook(db, event_type, data.get("data", {}))

        webhook.status = "PROCESSED"
        webhook.processed_at = datetime.now()
        db.commit()
    except Exception as e:
        logger.error(f"Async Toss webhook processing failed: {str(e)}")
        webhook.status = "FAILED"
        webhook.error_message = str(e)
        webhook.retry_count += 1
        db.commit()


async def process_naverpay_webhook_async(
    db: Session,
    webhook_id: int,
    event_type: str,
    data: dict
):
    try:
        webhook = db.query(PaymentWebhook).filter(PaymentWebhook.id == webhook_id).first()

        await naverpay_service.process_webhook(db, event_type, data.get("data", {}))

        webhook.status = "PROCESSED"
        webhook.processed_at = datetime.now()
        db.commit()
    except Exception as e:
        logger.error(f"Async NaverPay webhook processing failed: {str(e)}")
        webhook.status = "FAILED"
        webhook.error_message = str(e)
        webhook.retry_count += 1
        db.commit()


@router.get("/statistics/payments", response_model=PaymentStatistics)
async def get_payment_statistics(
    start_date: datetime,
    end_date: datetime,
    db: Session = Depends(get_db),
    user_id: Optional[int] = None
):
    query = db.query(Payment).filter(
        Payment.created_at >= start_date,
        Payment.created_at <= end_date
    )

    if user_id:
        query = query.filter(Payment.user_id == user_id)

    payments = query.all()

    total_revenue = sum(p.amount for p in payments if p.status == "DONE")
    successful = len([p for p in payments if p.status == "DONE"])
    failed = len([p for p in payments if p.status in ["ABORTED", "EXPIRED"]])
    refunded = sum(p.cancel_amount for p in payments if p.status in ["CANCELED", "PARTIAL_CANCELED"])

    return PaymentStatistics(
        total_revenue=total_revenue,
        total_transactions=len(payments),
        successful_payments=successful,
        failed_payments=failed,
        refunded_amount=refunded,
        average_transaction_value=total_revenue / successful if successful > 0 else 0,
        period_start=start_date,
        period_end=end_date
    )


@router.get("/statistics/subscriptions", response_model=SubscriptionStatistics)
async def get_subscription_statistics(
    db: Session = Depends(get_db)
):
    total_subs = db.query(Subscription).count()
    active_subs = db.query(Subscription).filter(
        Subscription.status == SubscriptionStatus.ACTIVE
    ).all()

    canceled_count = db.query(Subscription).filter(
        Subscription.status == SubscriptionStatus.CANCELED
    ).count()

    trial_count = db.query(Subscription).filter(
        Subscription.status == SubscriptionStatus.TRIALING
    ).count()

    mrr = sum(s.amount for s in active_subs if s.billing_cycle == "monthly")
    arr = sum(s.amount for s in active_subs if s.billing_cycle == "yearly")

    churn_rate = (canceled_count / total_subs * 100) if total_subs > 0 else 0
    arpu = (mrr + arr/12) / len(active_subs) if active_subs else 0

    return SubscriptionStatistics(
        total_subscribers=total_subs,
        active_subscriptions=len(active_subs),
        canceled_subscriptions=canceled_count,
        trial_users=trial_count,
        monthly_recurring_revenue=mrr,
        annual_recurring_revenue=arr,
        churn_rate=churn_rate,
        average_revenue_per_user=arpu
    )