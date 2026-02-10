import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models import AgentRole, TaskStatus


class TaskCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    role: AgentRole
    priority: int = 0
    depends_on: list[str] | None = None
    project_id: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    status: TaskStatus | None = None
    role: AgentRole | None = None
    priority: int | None = None
    depends_on: list[str] | None = None
    comment: str | None = None


class TaskClaim(BaseModel):
    agent_id: str


class TaskReview(BaseModel):
    pr_url: str


class TaskReject(BaseModel):
    comment: str


class ActivityLogCreate(BaseModel):
    agent_id: str | None = None
    message: str


class ActivityLogResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    agent_id: str | None = None
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskResponse(BaseModel):
    id: uuid.UUID
    project_id: str | None = None
    title: str
    description: str | None = None
    status: TaskStatus
    role: AgentRole
    priority: int
    depends_on: list[str] | None = None
    depends_on_completed: bool
    claimed_by: str | None = None
    claimed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    comment: str | None = None
    pr_url: str | None = None
    activities: list[ActivityLogResponse] = []

    model_config = {"from_attributes": True}
