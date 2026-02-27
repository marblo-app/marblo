import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import AgentRole, Task, TaskStatus
from app.schemas import TaskResponse
from app.state_machine import validate_transition


async def get_available_tasks(
    db: AsyncSession, role: AgentRole, project: str | None = None
) -> list[TaskResponse]:
    """Get TODO tasks for a specific role, checking dependency completion."""
    stmt = (
        select(Task)
        .options(selectinload(Task.activities))
        .where(Task.status == TaskStatus.TODO, Task.role == role)
        .where(
            (Task.depends_on.is_(None)) | (Task.depends_on_completed.is_(True))
        )
    )
    if project is not None:
        stmt = stmt.where(Task.project_id == project)
    stmt = stmt.order_by(Task.priority.desc(), Task.created_at.asc())
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
            "now": datetime.utcnow(),
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
    db: AsyncSession,
    role: AgentRole,
    agent_id: str,
    project: str | None = None,
    client_id: str | None = None,
) -> TaskResponse | None:
    """Claim the highest-priority available task for a role."""
    project_clause = "AND project_id = :project" if project else ""
    client_clause = "AND client_id = :client_id" if client_id else ""
    stmt = text(f"""
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
              {project_clause}
              {client_clause}
            ORDER BY priority DESC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    """)
    params: dict = {
        "role": role.value,
        "agent_id": agent_id,
        "now": datetime.utcnow(),
    }
    if project:
        params["project"] = project
    if client_id:
        params["client_id"] = client_id
    result = await db.execute(stmt, params)
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
    task.updated_at = datetime.utcnow()

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
    # Prevent path traversal: only allow alphanumeric and underscore
    safe_role = "".join(c for c in role if c.isalnum() or c == "_")
    if not safe_role or safe_role != role:
        raise FileNotFoundError(f"Invalid role name: {role}")
    skills_dir = Path(settings.skills_dir).resolve()
    skill_path = (skills_dir / f"{safe_role}_agent.md").resolve()
    # Ensure resolved path is still inside skills_dir
    if not str(skill_path).startswith(str(skills_dir)):
        raise FileNotFoundError(f"Invalid role name: {role}")
    if not skill_path.exists():
        raise FileNotFoundError(f"Skill file not found for role: {role}")
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
    task.updated_at = datetime.utcnow()

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

    # Separate valid UUIDs from invalid ones
    valid_dep_ids: list[uuid.UUID] = []
    invalid_deps: list[str] = []
    for dep_id in task.depends_on:
        try:
            valid_dep_ids.append(uuid.UUID(dep_id))
        except (ValueError, AttributeError):
            invalid_deps.append(dep_id)

    details = []

    # Add entries for invalid UUID strings
    for inv in invalid_deps:
        details.append({
            "id": inv,
            "title": f"[invalid: {inv}]",
            "status": "UNKNOWN",
            "completed": False,
        })

    # Query valid UUIDs
    if valid_dep_ids:
        dep_stmt = select(Task).where(Task.id.in_(valid_dep_ids))
        dep_result = await db.execute(dep_stmt)
        dep_tasks = {t.id: t for t in dep_result.scalars().all()}

        for dep_id in valid_dep_ids:
            dep = dep_tasks.get(dep_id)
            if dep is None:
                details.append({
                    "id": str(dep_id),
                    "title": "[task not found]",
                    "status": "MISSING",
                    "completed": False,
                })
            else:
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
        task.updated_at = datetime.utcnow()
        await db.commit()

    return {
        "task_id": str(task_id),
        "depends_on": task.depends_on,
        "all_completed": all_completed,
        "details": details,
    }
