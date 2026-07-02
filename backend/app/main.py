import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import engine, get_db
from app.events import close_redis, publish_activity_event, publish_event
from app.mcp_tools import (
    claim_next_task,
    claim_task,
    get_agent_skill,
    get_task_dependencies,
    submit_for_review,
    update_task_status,
)
from app.models import ActivityLog, AgentRole, Base, Task, TaskStatus
from app.routers import plan as plan_router
from app.schemas import (
    ActivityLogCreate,
    ActivityLogResponse,
    TaskClaim,
    TaskCreate,
    TaskReject,
    TaskResponse,
    TaskReview,
    TaskUpdate,
)
from app.sse import sse_endpoint
from app.state_machine import InvalidTransitionError


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="Marblo MCP Server",
    description="MCP Server for AI Agent task orchestration",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SSE endpoint for real-time updates
app.add_api_route("/api/events", sse_endpoint, methods=["GET"])

# Plan-based feature limits & usage dashboard
app.include_router(plan_router.router)


# --- REST API Endpoints ---


@app.get("/api/tasks", response_model=list[TaskResponse])
async def list_tasks(
    status: TaskStatus | None = Query(None),
    role: AgentRole | None = Query(None),
    project: str | None = Query(None),
    client_id: str | None = Query(None),
    has_feedback: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Task).options(selectinload(Task.activities))
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if role is not None:
        stmt = stmt.where(Task.role == role)
    if project is not None:
        stmt = stmt.where(Task.project_id == project)
    if client_id is not None:
        stmt = stmt.where(Task.client_id == client_id)
    if has_feedback is True:
        stmt = stmt.where(Task.has_pm_feedback == True)  # noqa: E712
    stmt = stmt.order_by(Task.priority.desc(), Task.created_at.asc())
    result = await db.execute(stmt)
    tasks = result.scalars().all()
    return [TaskResponse.model_validate(t) for t in tasks]


@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskResponse.model_validate(task)


@app.post("/api/tasks", response_model=TaskResponse, status_code=201)
async def create_task(body: TaskCreate, db: AsyncSession = Depends(get_db)):
    # Validate depends_on: each item must be a valid UUID that exists in DB
    if body.depends_on:
        for dep_id in body.depends_on:
            try:
                uuid.UUID(dep_id)
            except (ValueError, AttributeError):
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid depends_on ID '{dep_id}': not a valid UUID",
                )
        dep_uuids = [uuid.UUID(d) for d in body.depends_on]
        existing_stmt = select(Task.id).where(Task.id.in_(dep_uuids))
        existing_result = await db.execute(existing_stmt)
        existing_ids = {row[0] for row in existing_result.all()}
        missing = [d for d in dep_uuids if d not in existing_ids]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"depends_on references non-existent task(s): {[str(m) for m in missing]}",
            )

    task = Task(
        title=body.title,
        description=body.description,
        role=body.role,
        priority=body.priority,
        depends_on=body.depends_on,
        project_id=body.project_id,
        client_id=body.client_id,
        context=body.context,
        scope=body.scope,
    )
    db.add(task)
    await db.flush()
    # Re-fetch with activities eagerly loaded
    stmt = select(Task).where(Task.id == task.id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one()
    resp = TaskResponse.model_validate(task)
    await publish_event("task_created", resp)
    return resp


@app.put("/api/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, db: AsyncSession = Depends(get_db)
):
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    old_status = task.status
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    await db.flush()
    stmt = select(Task).where(Task.id == task.id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one()
    resp = TaskResponse.model_validate(task)

    # Auto-log status changes
    if body.status is not None and body.status != old_status:
        await _create_activity(
            db, task_id, f"Status changed to {body.status.value}"
        )

    await publish_event("task_updated", resp)
    return resp


@app.delete("/api/tasks/{task_id}", status_code=204)
async def delete_task(task_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()


@app.post("/api/tasks/archive")
async def archive_done_tasks(
    project: str = Query(..., description="Project ID to archive DONE tasks for"),
    db: AsyncSession = Depends(get_db),
):
    # Find DONE tasks for this project first (to get IDs for SSE events)
    find_stmt = (
        select(Task.id)
        .where(Task.status == TaskStatus.DONE, Task.project_id == project)
    )
    result = await db.execute(find_stmt)
    task_ids = [row[0] for row in result.all()]

    if not task_ids:
        return {"archived_count": 0}

    # Bulk update project_id to "{project}:archived"
    archived_project = f"{project}:archived"
    update_stmt = (
        update(Task)
        .where(Task.id.in_(task_ids))
        .values(project_id=archived_project)
    )
    await db.execute(update_stmt)
    await db.flush()

    # Re-fetch updated tasks and publish SSE events
    fetch_stmt = (
        select(Task)
        .where(Task.id.in_(task_ids))
        .options(selectinload(Task.activities))
    )
    result = await db.execute(fetch_stmt)
    updated_tasks = result.scalars().all()
    for t in updated_tasks:
        await publish_event("task_updated", TaskResponse.model_validate(t))

    await db.commit()
    return {"archived_count": len(task_ids)}


@app.post("/api/tasks/merge-projects")
async def merge_projects(
    db: AsyncSession = Depends(get_db),
    from_project: str = Query(..., alias="from", description="Source project ID"),
    to_project: str = Query(..., alias="to", description="Target project ID"),
):
    if from_project == to_project:
        raise HTTPException(status_code=400, detail="Source and target projects must differ")

    # Find all tasks in the source project
    find_stmt = select(Task.id).where(Task.project_id == from_project)
    result = await db.execute(find_stmt)
    task_ids = [row[0] for row in result.all()]

    if not task_ids:
        return {"merged_count": 0}

    # Bulk update project_id
    update_stmt = (
        update(Task)
        .where(Task.id.in_(task_ids))
        .values(project_id=to_project)
    )
    await db.execute(update_stmt)
    await db.flush()

    # Re-fetch and publish SSE events
    fetch_stmt = (
        select(Task)
        .where(Task.id.in_(task_ids))
        .options(selectinload(Task.activities))
    )
    result = await db.execute(fetch_stmt)
    updated_tasks = result.scalars().all()
    for t in updated_tasks:
        await publish_event("task_updated", TaskResponse.model_validate(t))

    await db.commit()
    return {"merged_count": len(task_ids)}


@app.post("/api/tasks/cleanup-stale")
async def cleanup_stale_todos(
    hours: int = Query(24, description="Hours threshold for stale TODO tasks"),
    project: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Find stale TODO tasks
    find_stmt = select(Task.id).where(
        Task.status == TaskStatus.TODO,
        Task.created_at < cutoff,
    )
    if project:
        find_stmt = find_stmt.where(Task.project_id == project)
    result = await db.execute(find_stmt)
    task_ids = [row[0] for row in result.all()]

    if not task_ids:
        return {"cleaned_count": 0, "task_ids": []}

    # Bulk update to FAILED
    update_stmt = (
        update(Task)
        .where(Task.id.in_(task_ids))
        .values(
            status=TaskStatus.FAILED,
            comment=f"Auto-cleaned: stale for {hours}h+",
        )
    )
    await db.execute(update_stmt)
    await db.flush()

    # Re-fetch and publish SSE events
    fetch_stmt = (
        select(Task)
        .where(Task.id.in_(task_ids))
        .options(selectinload(Task.activities))
    )
    result = await db.execute(fetch_stmt)
    updated_tasks = result.scalars().all()
    for t in updated_tasks:
        await publish_event("task_updated", TaskResponse.model_validate(t))

    await db.commit()
    return {"cleaned_count": len(task_ids), "task_ids": [str(tid) for tid in task_ids]}


async def _create_activity(
    db: AsyncSession, task_id: uuid.UUID, message: str, agent_id: str | None = None
) -> ActivityLogResponse:
    """Helper to create an activity log entry and publish SSE event."""
    log = ActivityLog(task_id=task_id, agent_id=agent_id, message=message)
    db.add(log)
    await db.flush()
    await db.refresh(log)
    resp = ActivityLogResponse.model_validate(log)
    await publish_activity_event(str(task_id), resp)
    return resp


@app.post(
    "/api/tasks/{task_id}/activities",
    response_model=ActivityLogResponse,
    status_code=201,
)
async def create_activity(
    task_id: uuid.UUID, body: ActivityLogCreate, db: AsyncSession = Depends(get_db)
):
    # Verify task exists
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # Auto-set feedback flag when PM adds a comment
    if body.agent_id == "pm":
        task.has_pm_feedback = True
        await db.flush()
        # Publish updated task so frontend gets the flag change
        stmt2 = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
        result2 = await db.execute(stmt2)
        updated_task = result2.scalar_one()
        await publish_event("task_updated", TaskResponse.model_validate(updated_task))

    return await _create_activity(db, task_id, body.message, body.agent_id)


@app.get("/api/tasks/{task_id}/activities", response_model=list[ActivityLogResponse])
async def list_activities(
    task_id: uuid.UUID,
    type: str | None = Query(None, description="Filter by agent type, e.g. 'pm'"),
    db: AsyncSession = Depends(get_db),
):
    # Verify task exists
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    stmt = (
        select(ActivityLog)
        .where(ActivityLog.task_id == task_id)
        .order_by(ActivityLog.created_at.asc())
    )
    if type is not None:
        stmt = stmt.where(ActivityLog.agent_id == type)
    result = await db.execute(stmt)
    logs = result.scalars().all()
    return [ActivityLogResponse.model_validate(log) for log in logs]


@app.post("/api/tasks/{task_id}/claim", response_model=TaskResponse)
async def claim_task_endpoint(
    task_id: uuid.UUID, body: TaskClaim, db: AsyncSession = Depends(get_db)
):
    result = await claim_task(db, task_id, body.agent_id)
    if result is None:
        raise HTTPException(
            status_code=409,
            detail="Task is not available for claiming",
        )
    await _create_activity(db, task_id, f"Task claimed by {body.agent_id}", body.agent_id)
    await publish_event("task_claimed", result)
    return result


@app.post("/api/tasks/{task_id}/review", response_model=TaskResponse)
async def review_task_endpoint(
    task_id: uuid.UUID, body: TaskReview, db: AsyncSession = Depends(get_db)
):
    try:
        result = await submit_for_review(db, task_id, body.pr_url)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await _create_activity(
        db, task_id, f"Submitted for review. PR: {body.pr_url}", result.claimed_by
    )
    await publish_event("task_review", result)
    return result


@app.post("/api/tasks/{task_id}/approve", response_model=TaskResponse)
async def approve_task_endpoint(
    task_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    try:
        result = await update_task_status(db, task_id, "approve")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await _create_activity(db, task_id, "Status changed to DONE")
    await publish_event("task_done", result)
    return result


@app.post("/api/tasks/{task_id}/reject", response_model=TaskResponse)
async def reject_task_endpoint(
    task_id: uuid.UUID, body: TaskReject, db: AsyncSession = Depends(get_db)
):
    try:
        result = await update_task_status(db, task_id, "reject", comment=body.comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await _create_activity(
        db, task_id, f"Task rejected. Reason: {body.comment}"
    )
    await publish_event("task_updated", result)
    return result


@app.post("/api/tasks/{task_id}/acknowledge-feedback", response_model=TaskResponse)
async def acknowledge_feedback(
    task_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.has_pm_feedback = False
    await db.flush()
    stmt = select(Task).where(Task.id == task_id).options(selectinload(Task.activities))
    result = await db.execute(stmt)
    task = result.scalar_one()
    resp = TaskResponse.model_validate(task)
    await publish_event("task_updated", resp)
    return resp


# --- MCP Tool Endpoints ---


@app.get("/api/mcp/available-tasks", response_model=list[TaskResponse])
async def mcp_get_available_tasks(
    role: AgentRole,
    project: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    from app.mcp_tools import get_available_tasks

    return await get_available_tasks(db, role, project)


@app.post("/api/mcp/claim", response_model=TaskResponse | None)
async def mcp_claim_task(
    role: AgentRole,
    agent_id: str,
    client_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    result = await claim_next_task(db, role, agent_id, client_id=client_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No tasks available for this role")
    await publish_event("task_claimed", result)
    return result


@app.post("/api/mcp/update-status", response_model=TaskResponse)
async def mcp_update_status(
    task_id: uuid.UUID,
    action: str,
    comment: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await update_task_status(db, task_id, action, comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await publish_event("task_updated", result)
    return result


@app.get("/api/mcp/skill")
async def mcp_get_skill(role: str):
    try:
        content = get_agent_skill(role)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"role": role, "content": content}


@app.get("/api/mcp/dependencies")
async def mcp_get_dependencies(
    task_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    try:
        return await get_task_dependencies(db, task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
