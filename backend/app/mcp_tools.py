import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import AgentRole, Task, TaskStatus
from app.schemas import TaskResponse
from app.state_machine import validate_transition


async def get_available_tasks(
    db: AsyncSession, role: AgentRole
) -> list[TaskResponse]:
    """Get TODO tasks for a specific role, checking dependency completion."""
    stmt = (
        select(Task)
        .options(selectinload(Task.activities))
        .where(Task.status == TaskStatus.TODO, Task.role == role)
        .where(
            (Task.depends_on.is_(None)) | (Task.depends_on_completed.is_(True))
        )
        .order_by(Task.priority.desc(), Task.created_at.asc())
    )
    result = await db.execute(stmt)
    tasks = result.scalars().all()
    return [TaskResponse.model_validate(t) for t in tasks]


async def claim_task(
    db: AsyncSession, task_id: uuid.UUID, agent_id: str
) -> TaskResponse | None:
    """Atomically claim a task using SELECT FOR UPDATE SKIP LOCKED."""
    # Use raw SQL for the atomic claim pattern
    stmt = text("""
        UPDATE tasks
        SET status = 'CLAIMED',
            claimed_by = :agent_id,
            claimed_at = :now,
            updated_at = :now
        WHERE id = (
            SELECT id FROM tasks
            WHERE id = :task_id
              AND status = 'TODO'
              AND (depends_on IS NULL OR depends_on_completed = TRUE)
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    """)
    result = await db.execute(
        stmt,
        {
            "task_id": str(task_id),
            "agent_id": agent_id,
            "now": datetime.now(timezone.utc),
        },
    )
    row = result.mappings().first()
    if row is None:
        return None
    await db.commit()
    row_dict = dict(row)
    row_dict["activities"] = []
    return TaskResponse.model_validate(row_dict)


async def claim_next_task(
    db: AsyncSession, role: AgentRole, agent_id: str
) -> TaskResponse | None:
    """Claim the highest-priority available task for a role."""
    stmt = text("""
        UPDATE tasks
        SET status = 'CLAIMED',
            claimed_by = :agent_id,
            claimed_at = :now,
            updated_at = :now
        WHERE id = (
            SELECT id FROM tasks
            WHERE status = 'TODO'
              AND role = :role
              AND (depends_on IS NULL OR depends_on_completed = TRUE)
            ORDER BY priority DESC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    """)
    result = await db.execute(
        stmt,
        {
            "role": role.value,
            "agent_id": agent_id,
            "now": datetime.now(timezone.utc),
        },
    )
    row = result.mappings().first()
    if row is None:
        return None
    await db.commit()
    row_dict = dict(row)
    row_dict["activities"] = []
    return TaskResponse.model_validate(row_dict)


async def update_task_status(
    db: AsyncSession,
    task_id: uuid.UUID,
    action: str,
    comment: str | None = None,
) -> TaskResponse:
    """Update task status following state machine rules."""
    stmt = select(Task).where(Task.id == task_id).with_for_update()
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError(f"Task {task_id} not found")

    new_status = validate_transition(task.status, action)
    task.status = new_status
    task.updated_at = datetime.now(timezone.utc)

    if comment is not None:
        task.comment = comment

    # Clear claim info on reject/retry
    if new_status == TaskStatus.TODO:
        task.claimed_by = None
        task.claimed_at = None
        task.pr_url = None

    await db.commit()
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one()
    return TaskResponse.model_validate(task)


def get_agent_skill(role: str) -> str:
    """Read the skill file for a given role."""
    skill_path = Path(settings.skills_dir) / f"{role}_agent.md"
    if not skill_path.exists():
        raise FileNotFoundError(f"Skill file not found: {skill_path}")
    return skill_path.read_text()


async def submit_for_review(
    db: AsyncSession, task_id: uuid.UUID, pr_url: str
) -> TaskResponse:
    """Submit a task for review with a PR URL."""
    stmt = select(Task).where(Task.id == task_id).with_for_update()
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError(f"Task {task_id} not found")

    new_status = validate_transition(task.status, "submit_review")
    task.status = new_status
    task.pr_url = pr_url
    task.updated_at = datetime.now(timezone.utc)

    await db.commit()
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one()
    return TaskResponse.model_validate(task)


async def get_task_dependencies(
    db: AsyncSession, task_id: uuid.UUID
) -> dict:
    """Check dependency completion status for a task."""
    stmt = select(Task).where(Task.id == task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError(f"Task {task_id} not found")

    if not task.depends_on:
        return {
            "task_id": str(task_id),
            "depends_on": [],
            "all_completed": True,
            "details": [],
        }

    dep_ids = [uuid.UUID(dep_id) for dep_id in task.depends_on]
    dep_stmt = select(Task).where(Task.id.in_(dep_ids))
    dep_result = await db.execute(dep_stmt)
    dep_tasks = dep_result.scalars().all()

    details = []
    for dep in dep_tasks:
        details.append({
            "id": str(dep.id),
            "title": dep.title,
            "status": dep.status.value,
            "completed": dep.status == TaskStatus.DONE,
        })

    all_completed = all(d["completed"] for d in details)

    # Update depends_on_completed if status changed
    if task.depends_on_completed != all_completed:
        task.depends_on_completed = all_completed
        task.updated_at = datetime.now(timezone.utc)
        await db.commit()

    return {
        "task_id": str(task_id),
        "depends_on": task.depends_on,
        "all_completed": all_completed,
        "details": details,
    }
