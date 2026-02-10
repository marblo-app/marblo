#!/usr/bin/env python3
"""TaskForce.AI MCP Server — thin wrapper around the REST API for Claude Code agents."""

import os
from pathlib import Path

import httpx
from mcp.server.fastmcp import FastMCP

API_URL = os.environ.get("TASKFORCE_API_URL", "http://localhost:8001")
PROJECT_ROOT = Path(__file__).resolve().parent.parent

mcp = FastMCP("TaskForce.AI")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30)


@mcp.tool()
def get_available_tasks(role: str) -> str:
    """Get TODO tasks available for the given role (e.g. 'backend', 'frontend', 'test', 'devops').
    Returns tasks whose dependencies are satisfied and that are ready to be claimed."""
    with _client() as client:
        resp = client.get("/api/tasks", params={"status": "TODO", "role": role})
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
        return (
            f"Successfully claimed task: {task['title']}\n"
            f"ID: {task['id']}\n"
            f"Status: {task['status']}\n"
            f"Role: {task['role']}"
        )


@mcp.tool()
def update_task_status(task_id: str, status: str, comment: str = "") -> str:
    """Update a task's status. Valid statuses: TODO, CLAIMED, IN_PROGRESS, REVIEW, BLOCKED, FAILED, DONE.
    Optionally include a comment explaining the status change."""
    with _client() as client:
        body: dict = {"status": status}
        if comment:
            body["comment"] = comment
        resp = client.put(f"/api/tasks/{task_id}", json=body)
        if resp.status_code == 404:
            return f"Error: Task {task_id} not found."
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
    # Try reading from the local filesystem first (faster, no API call needed)
    skill_path = PROJECT_ROOT / "skills" / f"{role}_agent.md"
    if skill_path.exists():
        return skill_path.read_text()
    # Fall back to team_leader (no _agent suffix)
    skill_path = PROJECT_ROOT / "skills" / f"{role}.md"
    if skill_path.exists():
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
) -> str:
    """Create a new task. Used by the Team Leader to break down work.
    Role must be one of: backend, frontend, test, devops."""
    with _client() as client:
        body: dict = {
            "title": title,
            "description": description,
            "role": role,
            "priority": priority,
        }
        if depends_on:
            body["depends_on"] = depends_on
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


if __name__ == "__main__":
    mcp.run()
