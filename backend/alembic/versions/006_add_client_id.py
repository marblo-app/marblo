"""Add client_id column to tasks

Revision ID: 006
Revises: 005
Create Date: 2026-02-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("client_id", sa.String(255), nullable=True))
    op.create_index("ix_tasks_client_id", "tasks", ["client_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_client_id", table_name="tasks")
    op.drop_column("tasks", "client_id")
