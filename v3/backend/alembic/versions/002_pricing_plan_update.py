"""Pricing plan update - add team / team_plus to subscriptionplan enum

Revision ID: 002_pricing_plan_update
Revises: 001_initial_migration
Create Date: 2026-06-08 00:00:00.000000

마스터플랜 §2.1 가격정책 정렬: SubscriptionPlan을 free/pro/team/team_plus/enterprise로 전환.
- Postgres native enum 'subscriptionplan'에 'team', 'team_plus' 값 추가.
- 'basic'(legacy)은 Postgres가 enum 값 삭제를 직접 지원하지 않아 deprecated 상태로 잔존
  (앱 코드에서는 더 이상 사용하지 않음).
- ALTER TYPE ... ADD VALUE 는 트랜잭션 블록 밖에서 실행해야 하므로 autocommit_block 사용 (PG 12+).
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '002_pricing_plan_update'
down_revision: Union[str, None] = '001_initial_migration'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ADD VALUE는 트랜잭션 안에서 실행 불가 → autocommit_block 으로 감쌈.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE subscriptionplan ADD VALUE IF NOT EXISTS 'team'")
        op.execute("ALTER TYPE subscriptionplan ADD VALUE IF NOT EXISTS 'team_plus'")


def downgrade() -> None:
    # Postgres는 enum 값 삭제를 직접 지원하지 않음 (타입 재생성이 필요하나
    # 기존 데이터 의존성 때문에 안전하지 않음). 롤백은 no-op 처리.
    pass
