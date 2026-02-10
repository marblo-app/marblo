"""Initial schema - tasks and agents tables

Revision ID: 001
Revises:
Create Date: 2026-02-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    task_status = sa.Enum(
        "TODO", "CLAIMED", "IN_PROGRESS", "REVIEW", "BLOCKED", "FAILED", "DONE",
        name="task_status",
    )
    agent_role = sa.Enum(
        "backend", "frontend", "test", "devops",
        name="agent_role",
    )

    op.create_table(
        "tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", task_status, nullable=False, server_default="TODO"),
        sa.Column("role", agent_role, nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("depends_on", ARRAY(sa.String()), nullable=True),
        sa.Column("depends_on_completed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("claimed_by", sa.String(255), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("pr_url", sa.String(1000), nullable=True),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_role", "tasks", ["role"])
    op.create_index("ix_tasks_status_role", "tasks", ["status", "role"])

    op.create_table(
        "agents",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="idle"),
        sa.Column("current_task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("agents")
    op.drop_index("ix_tasks_status_role", table_name="tasks")
    op.drop_index("ix_tasks_role", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_table("tasks")
    sa.Enum(name="task_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="agent_role").drop(op.get_bind(), checkfirst=True)
