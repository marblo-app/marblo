"""Add context and scope columns to tasks

Revision ID: 004
Revises: 003
Create Date: 2026-02-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("context", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("scope", ARRAY(sa.String()), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "scope")
    op.drop_column("tasks", "context")
