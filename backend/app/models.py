import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TaskStatus(str, enum.Enum):
    TODO = "TODO"
    CLAIMED = "CLAIMED"
    IN_PROGRESS = "IN_PROGRESS"
    REVIEW = "REVIEW"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    DONE = "DONE"


class AgentRole(str, enum.Enum):
    backend = "backend"
    frontend = "frontend"
    test = "test"
    devops = "devops"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    client_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", create_constraint=True),
        default=TaskStatus.TODO,
        nullable=False,
        index=True,
    )
    role: Mapped[AgentRole] = mapped_column(
        Enum(AgentRole, name="agent_role", create_constraint=True),
        nullable=False,
        index=True,
    )
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    depends_on: Mapped[list[str] | None] = mapped_column(
        ARRAY(String), nullable=True
    )
    depends_on_completed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    claimed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
    context: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    pr_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    has_pm_feedback: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # Relationships
    agent: Mapped["Agent | None"] = relationship(
        "Agent", back_populates="current_task", foreign_keys="Agent.current_task_id"
    )
    activities: Mapped[list["ActivityLog"]] = relationship(
        "ActivityLog", back_populates="task", order_by="ActivityLog.created_at",
        cascade="all, delete-orphan", passive_deletes=True
    )


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    task: Mapped["Task"] = relationship("Task", back_populates="activities")


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="idle", nullable=False)
    current_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=True
    )

    current_task: Mapped[Task | None] = relationship(
        "Task", back_populates="agent", foreign_keys=[current_task_id]
    )
