#!/usr/bin/env python3
"""Marblo MCP Server — thin wrapper around the REST API for Claude Code agents."""

import os
import re
from pathlib import Path

import httpx
from mcp.server.fastmcp import FastMCP

API_URL = os.environ.get("MARBLO_API_URL", "http://localhost:8001")
PROJECT_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_PROJECT: str = os.environ.get("MARBLO_PROJECT", "") or os.path.basename(os.getcwd())
DEFAULT_CLIENT_ID: str = os.environ.get("MARBLO_CLIENT_ID", "")

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_TASK_NNN_RE = re.compile(r"^TASK-(\d+)$", re.I)

mcp = FastMCP("Marblo")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30)


def _resolve_project(project: str) -> str:
    """Return explicit project or fall back to DEFAULT_PROJECT."""
    return project or DEFAULT_PROJECT


def _resolve_client_id(client_id: str) -> str:
    """Return explicit client_id or fall back to DEFAULT_CLIENT_ID."""
    return client_id or DEFAULT_CLIENT_ID


@mcp.tool()
def get_available_tasks(role: str, project: str = "") -> str:
    """Get TODO tasks available for the given role (e.g. 'backend', 'frontend', 'test', 'devops').
    Optionally filter by project name. Returns tasks whose dependencies are satisfied."""
    project = _resolve_project(project)
    client_id = _resolve_client_id("")
    with _client() as client:
        params: dict = {"status": "TODO", "role": role}
        if project:
            params["project"] = project
        if client_id:
            params["client_id"] = client_id
        resp = client.get("/api/tasks", params=params)
        resp.raise_for_status()
        tasks = resp.json()
        if not tasks:
            return f"No available tasks for role '{role}'."
        lines = []
        for t in tasks:
            deps = f" (depends_on: {t['depends_on']})" if t.get("depends_on") else ""
            lines.append(
                f"- [{t['id']}] {t['title']} (priority={t['priority']}){deps}"
            )
        return "\n".join(lines)


@mcp.tool()
def claim_task(task_id: str, agent_id: str) -> str:
    """Claim a specific task by ID. The task must be in TODO status with dependencies met.
    Returns the claimed task details or an error message."""
    with _client() as client:
        resp = client.post(
            f"/api/tasks/{task_id}/claim",
            json={"agent_id": agent_id},
        )
        if resp.status_code == 409:
            return f"Error: Task is not available for claiming (already claimed or dependencies not met)."
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        resp.raise_for_status()
        task = resp.json()
        lines = [
            f"Successfully claimed task: {task['title']}",
            f"ID: {task['id']}",
            f"Status: {task['status']}",
            f"Role: {task['role']}",
        ]
        if task.get("context"):
            lines.append(f"Context: {task['context']}")
        if task.get("scope"):
            lines.append(f"Scope (files): {', '.join(task['scope'])}")
        return "\n".join(lines)


_STATUS_ACTION_MAP: dict[tuple[str, str], str] = {
    ("TODO", "CLAIMED"): "claim",
    ("TODO", "FAILED"): "cancel",
    ("CLAIMED", "IN_PROGRESS"): "start_work",
    ("IN_PROGRESS", "REVIEW"): "submit_review",
    ("IN_PROGRESS", "BLOCKED"): "blocked",
    ("IN_PROGRESS", "FAILED"): "failed",
    ("REVIEW", "DONE"): "approve",
    ("REVIEW", "TODO"): "reject",
    ("BLOCKED", "IN_PROGRESS"): "resolve",
    ("FAILED", "TODO"): "retry",
}


@mcp.tool()
def update_task_status(task_id: str, status: str, comment: str = "") -> str:
    """Update a task's status. Valid statuses: TODO, CLAIMED, IN_PROGRESS, REVIEW, BLOCKED, FAILED, DONE.
    Optionally include a comment explaining the status change."""
    with _client() as client:
        # Get current status to determine the correct action
        get_resp = client.get(f"/api/tasks/{task_id}")
        if get_resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        get_resp.raise_for_status()
        current_status = get_resp.json()["status"]

        action = _STATUS_ACTION_MAP.get((current_status, status))
        if action is None:
            valid_targets = [s for (k, s) in _STATUS_ACTION_MAP.keys() if k == current_status]
            return (
                f"Error: Cannot transition from {current_status} to {status}. "
                f"Valid targets from {current_status}: {valid_targets}"
            )

        params: dict = {"task_id": task_id, "action": action}
        if comment:
            params["comment"] = comment
        resp = client.post("/api/mcp/update-status", params=params)
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        if resp.status_code == 409:
            return f"Error: {resp.json().get('detail', 'Invalid transition')}"
        resp.raise_for_status()
        task = resp.json()
        return f"Task '{task['title']}' status updated to {task['status']}."


@mcp.tool()
def add_activity(task_id: str, message: str, agent_id: str = "") -> str:
    """Add an activity log entry to a task. Use this to record work progress,
    decisions, or noteworthy events while working on a task."""
    with _client() as client:
        body: dict = {"message": message}
        if agent_id:
            body["agent_id"] = agent_id
        resp = client.post(f"/api/tasks/{task_id}/activities", json=body)
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        resp.raise_for_status()
        return f"Activity logged: {message}"


@mcp.tool()
def submit_for_review(task_id: str, pr_url: str = "") -> str:
    """Submit a task for review. Moves the task to REVIEW status.
    Optionally include a PR URL."""
    with _client() as client:
        resp = client.post(
            f"/api/tasks/{task_id}/review",
            json={"pr_url": pr_url or ""},
        )
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        if resp.status_code == 409:
            return f"Error: Task cannot be submitted for review from its current status."
        resp.raise_for_status()
        task = resp.json()
        return f"Task '{task['title']}' submitted for review. Status: {task['status']}"


@mcp.tool()
def get_task_dependencies(task_id: str) -> str:
    """Check the dependency status for a task. Shows which dependent tasks
    are completed and which are still pending."""
    with _client() as client:
        resp = client.get("/api/mcp/dependencies", params={"task_id": task_id})
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        resp.raise_for_status()
        data = resp.json()
        if not data["depends_on"]:
            return "This task has no dependencies."
        lines = [f"All completed: {data['all_completed']}"]
        for d in data["details"]:
            status_icon = "done" if d["completed"] else "pending"
            lines.append(f"- [{status_icon}] {d['title']} ({d['status']})")
        return "\n".join(lines)


@mcp.tool()
def get_agent_skill(role: str) -> str:
    """Get the skill/instruction file content for a given agent role.
    Available roles: backend, frontend, test, devops, merge, team_leader."""
    # Sanitize role to prevent path traversal
    safe_role = "".join(c for c in role if c.isalnum() or c == "_")
    if not safe_role or safe_role != role:
        return f"Error: Invalid role name '{role}'. Use alphanumeric and underscore only."
    skills_dir = (PROJECT_ROOT / "skills").resolve()
    # Try reading from the local filesystem first (faster, no API call needed)
    skill_path = (skills_dir / f"{safe_role}_agent.md").resolve()
    if str(skill_path).startswith(str(skills_dir)) and skill_path.exists():
        return skill_path.read_text()
    # Fall back to team_leader (no _agent suffix)
    skill_path = (skills_dir / f"{safe_role}.md").resolve()
    if str(skill_path).startswith(str(skills_dir)) and skill_path.exists():
        return skill_path.read_text()
    # Fall back to REST API
    with _client() as client:
        resp = client.get("/api/mcp/skill", params={"role": role})
        if resp.status_code == 404:
            return f"Error: No skill file found for role '{role}'."
        resp.raise_for_status()
        return resp.json()["content"]


@mcp.tool()
def create_task(
    title: str,
    description: str,
    role: str,
    priority: int = 0,
    depends_on: list[str] | None = None,
    project: str = "",
    context: str = "",
    scope: list[str] | None = None,
) -> str:
    """Create a new task. Used by the Team Leader to break down work.
    Role must be one of: backend, frontend, test, devops.
    Set project to group tasks by project name (e.g. 'hello-api', 'youtube-insight').
    Set context to specify environment constraints (e.g. 'Python 3.9, use Optional instead of | None').
    Set scope to list files this task should modify (e.g. ['src/pipeline.py', 'src/selector.py'])."""
    project = _resolve_project(project)
    client_id = _resolve_client_id("")
    with _client() as client:
        body: dict = {
            "title": title,
            "description": description,
            "role": role,
            "priority": priority,
        }
        if depends_on:
            body["depends_on"] = depends_on
        if project:
            body["project_id"] = project
        if client_id:
            body["client_id"] = client_id
        if context:
            body["context"] = context
        if scope:
            body["scope"] = scope
        resp = client.post("/api/tasks", json=body)
        if resp.status_code == 422:
            return f"Error: Invalid task data. Check role and fields. Details: {resp.text}"
        resp.raise_for_status()
        task = resp.json()
        return (
            f"Task created successfully!\n"
            f"ID: {task['id']}\n"
            f"Title: {task['title']}\n"
            f"Role: {task['role']}\n"
            f"Priority: {task['priority']}"
        )


@mcp.tool()
def create_tasks_bulk(tasks_json: str) -> str:
    """Create multiple tasks at once. Pass a JSON array string where each item has:
    title (str), description (str), role (str: backend/frontend/test/devops),
    priority (int, optional), depends_on (list[str], optional), project (str, optional),
    context (str, optional — environment constraints), scope (list[str], optional — file paths).

    depends_on supports three formats:
    - TASK-NNN: 1-based index referencing other tasks in the same batch (e.g. "TASK-001" = first task)
    - alias: a custom alias field on another task in the batch (e.g. {"alias": "setup", ...})
    - UUID: a full UUID string referencing an existing task in the database

    Example: '[{"alias":"setup","title":"Setup DB","description":"Create tables","role":"backend","priority":5},{"title":"Add API","description":"REST endpoints","role":"backend","depends_on":["TASK-001"]}]'

    Returns a summary of all created tasks with their IDs."""
    import json as _json

    try:
        task_list = _json.loads(tasks_json)
    except _json.JSONDecodeError as e:
        return f"Error: Invalid JSON — {e}"

    if not isinstance(task_list, list):
        return "Error: tasks_json must be a JSON array."

    project = _resolve_project("")
    client_id = _resolve_client_id("")

    # Phase 1: Build alias map (symbolic name → array index)
    alias_map: dict[str, int] = {}
    for i, t in enumerate(task_list):
        # TASK-NNN pattern (1-based)
        task_key = f"TASK-{i + 1:03d}"
        alias_map[task_key.upper()] = i
        # Custom alias field
        if t.get("alias"):
            alias_map[t["alias"]] = i

    # Phase 2: Sequential creation with depends_on resolution
    index_to_uuid: dict[int, str] = {}
    results: list[str] = []
    dep_mappings: list[str] = []
    success_count = 0

    with _client() as client:
        for i, t in enumerate(task_list):
            # Resolve depends_on references
            resolved_deps: list[str] | None = None
            dep_error: str | None = None

            if t.get("depends_on"):
                resolved_deps = []
                for dep_ref in t["depends_on"]:
                    # Already a UUID — pass through
                    if _UUID_RE.match(dep_ref):
                        resolved_deps.append(dep_ref)
                        continue

                    # Try TASK-NNN pattern
                    task_match = _TASK_NNN_RE.match(dep_ref)
                    if task_match:
                        idx = int(task_match.group(1)) - 1  # 1-based → 0-based
                        if idx in index_to_uuid:
                            resolved_deps.append(index_to_uuid[idx])
                            continue
                        elif 0 <= idx < len(task_list) and idx >= i:
                            dep_error = f"depends_on '{dep_ref}' references a task that hasn't been created yet (forward reference)"
                            break
                        else:
                            dep_error = f"depends_on '{dep_ref}' — task at index {idx} failed or is out of range"
                            break

                    # Try alias lookup
                    if dep_ref in alias_map:
                        idx = alias_map[dep_ref]
                        if idx in index_to_uuid:
                            resolved_deps.append(index_to_uuid[idx])
                            continue
                        elif idx >= i:
                            dep_error = f"depends_on alias '{dep_ref}' references a task that hasn't been created yet"
                            break
                        else:
                            dep_error = f"depends_on alias '{dep_ref}' — referenced task failed to create"
                            break

                    # Unknown reference
                    dep_error = f"depends_on '{dep_ref}' is not a valid UUID, TASK-NNN pattern, or known alias"
                    break

            if dep_error:
                results.append(f"  [FAILED] {t.get('title', f'task #{i}')} — {dep_error}")
                continue

            body: dict = {
                "title": t.get("title", ""),
                "description": t.get("description", ""),
                "role": t.get("role", "backend"),
                "priority": t.get("priority", 0),
            }
            if resolved_deps:
                body["depends_on"] = resolved_deps
            task_project = t.get("project") or project
            if task_project:
                body["project_id"] = task_project
            task_client_id = t.get("client_id") or client_id
            if task_client_id:
                body["client_id"] = task_client_id
            if t.get("context"):
                body["context"] = t["context"]
            if t.get("scope"):
                body["scope"] = t["scope"]

            resp = client.post("/api/tasks", json=body)
            if resp.status_code in (201, 200):
                task = resp.json()
                task_uuid = task["id"]
                index_to_uuid[i] = task_uuid
                results.append(f"  [{task_uuid}] {task['title']} (role={task['role']}, priority={task['priority']})")
                success_count += 1
            else:
                results.append(f"  [FAILED] {t.get('title', f'task #{i}')} — {resp.status_code}: {resp.text}")

    # Build dependency mapping summary
    for label, idx in alias_map.items():
        if idx in index_to_uuid:
            dep_mappings.append(f"    {label} -> {index_to_uuid[idx]}")

    output = f"Created {success_count}/{len(task_list)} tasks:\n" + "\n".join(results)
    if dep_mappings:
        output += "\n\nDependency ID mappings:\n" + "\n".join(dep_mappings)
    return output


@mcp.tool()
def get_all_tasks(project: str = "", role: str = "") -> str:
    """Get all tasks regardless of status. Useful for seeing the full board.
    Optionally filter by project and/or role."""
    project = _resolve_project(project)
    client_id = _resolve_client_id("")
    with _client() as client:
        params: dict = {}
        if project:
            params["project"] = project
        if client_id:
            params["client_id"] = client_id
        if role:
            params["role"] = role
        resp = client.get("/api/tasks", params=params)
        resp.raise_for_status()
        tasks = resp.json()
        if not tasks:
            return "No tasks found."
        lines = []
        for t in tasks:
            claimed = f" → {t['claimed_by']}" if t.get("claimed_by") else ""
            lines.append(
                f"- [{t['status']}] {t['title']} (role={t['role']}, id={t['id']}){claimed}"
            )
        return "\n".join(lines)


@mcp.tool()
def get_task_activities(task_id: str, pm_only: bool = False) -> str:
    """Get activity log entries for a task. Set pm_only=True to see only PM feedback.
    Useful for checking what feedback the PM has left on your task."""
    with _client() as client:
        params: dict = {}
        if pm_only:
            params["type"] = "pm"
        resp = client.get(f"/api/tasks/{task_id}/activities", params=params)
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        resp.raise_for_status()
        activities = resp.json()
        if not activities:
            return "No activities found." if not pm_only else "No PM feedback found."
        lines = []
        for a in activities:
            ts = a["created_at"]
            agent = a.get("agent_id") or "system"
            lines.append(f"[{ts}] {agent}: {a['message']}")
        return "\n".join(lines)


@mcp.tool()
def check_feedback(role: str, project: str = "") -> str:
    """Check for tasks that have unread PM feedback. Filter by role (backend/frontend/test/devops)
    and optionally by project. Use this periodically to stay on top of PM directions."""
    project = _resolve_project(project)
    client_id = _resolve_client_id("")
    with _client() as client:
        params: dict = {"role": role, "has_feedback": "true"}
        if project:
            params["project"] = project
        if client_id:
            params["client_id"] = client_id
        resp = client.get("/api/tasks", params=params)
        resp.raise_for_status()
        tasks = resp.json()
        if not tasks:
            return f"No tasks with pending PM feedback for role '{role}'."
        lines = [f"Tasks with PM feedback ({len(tasks)}):"]
        for t in tasks:
            lines.append(
                f"- [{t['id']}] {t['title']} (status={t['status']}, priority={t['priority']})"
            )
        return "\n".join(lines)


@mcp.tool()
def acknowledge_feedback(task_id: str) -> str:
    """Mark PM feedback as read/acknowledged for a task. Call this after you have
    reviewed and acted on the PM's feedback. Clears the feedback badge."""
    with _client() as client:
        resp = client.post(f"/api/tasks/{task_id}/acknowledge-feedback")
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
        resp.raise_for_status()
        task = resp.json()
        return f"Feedback acknowledged for task '{task['title']}'. Badge cleared."


## ── MCP Prompts ──────────────────────────────────────────────


@mcp.prompt()
def agent_teams_start() -> str:
    """Agent Teams 방식으로 프로젝트를 태스크로 분해하고 에이전트를 스폰해서 업무를 진행합니다."""
    return (
        "Marblo MCP를 사용해서 Agent Teams 방식으로 프로젝트를 진행합니다.\n\n"
        "1. 사용자에게 프로젝트 이름과 만들고 싶은 것을 물어보세요.\n"
        "2. 요구사항을 분석해서 태스크를 분해합니다:\n"
        "   - 각 태스크는 1~2시간 분량\n"
        "   - role: backend/frontend/test/devops\n"
        "   - depends_on으로 의존성 설정 (TASK-001 등)\n"
        "   - scope: 수정할 파일 경로 (충돌 방지)\n"
        "3. create_tasks_bulk로 일괄 생성\n"
        "4. get_agent_skill로 스킬 로드 → 에이전트 스폰\n"
        "5. claim → start_work → 작업 → add_activity → submit_for_review\n"
        "6. REVIEW 상태가 되면 PM에게 리뷰 요청"
    )


@mcp.prompt()
def task_status_check() -> str:
    """현재 프로젝트의 태스크 진행 상태를 확인하고 요약합니다."""
    return (
        "Marblo MCP에서 태스크 진행 상태를 확인합니다.\n\n"
        "1. get_all_tasks로 전체 현황 조회\n"
        "2. 상태별 정리: TODO / IN_PROGRESS / REVIEW / DONE / FAILED\n"
        "3. REVIEW 태스크가 있으면 활동 로그 보여주기\n"
        "4. FAILED 태스크가 있으면 원인 분석\n"
        "5. check_feedback으로 미확인 PM 피드백 확인\n"
        "6. 진행률 요약: done/total (percent%)"
    )


@mcp.prompt()
def work_with_tracking() -> str:
    """태스크를 claim하고 진행 상황을 기록하면서 코딩합니다."""
    return (
        "Marblo MCP에서 태스크를 가져와 작업하면서 진행 상황을 기록합니다.\n\n"
        "1. get_available_tasks로 처리 가능한 태스크 확인\n"
        "2. claim_task로 태스크 claim\n"
        "3. update_task_status로 IN_PROGRESS 변경\n"
        "4. get_agent_skill로 스킬 파일 로드, 규칙 따르기\n"
        "5. 작업 중 add_activity로 진행 기록:\n"
        "   - 파일 생성/수정 시\n"
        "   - 주요 결정 사항\n"
        "   - 테스트 결과\n"
        "6. check_feedback으로 PM 피드백 수시 확인\n"
        "7. submit_for_review로 리뷰 제출"
    )


@mcp.prompt()
def ralph_batch() -> str:
    """Ralph 패턴으로 반복 작업을 티켓 단위로 추적하며 일괄 처리합니다."""
    return (
        "Ralph 패턴: 반복 작업을 Marblo 티켓으로 추적합니다.\n\n"
        "1. 대상 파일/컴포넌트 분석 → 목록 생성\n"
        "2. create_tasks_bulk로 대상 1개당 티켓 1장 생성\n"
        "3. 순서대로 처리:\n"
        "   - claim → start_work → 작업 → add_activity\n"
        "   - 성공: submit_for_review → DONE\n"
        "   - 실패: FAILED + 원인 기록\n"
        "4. 완료 후 결과 요약: DONE N개, FAILED N개"
    )


if __name__ == "__main__":
    mcp.run()
