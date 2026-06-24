/**
 * English — `orchestrator.*` namespace. Typed
 * `Record<keyof typeof koOrchestrator, string>` so a key present in ko but
 * missing here (or vice-versa) is a compile error for this namespace alone.
 */
import type { orchestrator as koOrchestrator } from "../ko/orchestrator";

export const orchestrator: Record<keyof typeof koOrchestrator, string> = {
  // Command panel chrome
  "orchestrator.title": "Orchestrator",
  "orchestrator.notRunning": "Orchestrator is not running",
  "orchestrator.sending": "Sending…",
  "orchestrator.board": "Board",
  "orchestrator.aiDecompose": "AI task breakdown",
  "orchestrator.addTask": "Add task",
  // Category labels
  "orchestrator.cat.project": "Start project",
  "orchestrator.cat.project-step": "Step-by-step start",
  "orchestrator.cat.agent": "Agents",
  "orchestrator.cat.work": "Work",
  "orchestrator.cat.pause": "Pause / resume",
  "orchestrator.cat.review": "Review",
  "orchestrator.cat.deploy": "Deploy",
  "orchestrator.cat.sync": "Cleanup",
  "orchestrator.cat.repeat": "Repeat",
  "orchestrator.cat.util": "Utility",
  // Slash command descriptions (display labels — the command id stays English)
  "orchestrator.cmd.tf-plan.desc": "Analyze requirements + plan tasks",
  "orchestrator.cmd.tf-start.desc": "Bulk-create tasks + spawn agents",
  "orchestrator.cmd.tf-analyze.desc": "Analyze requirements",
  "orchestrator.cmd.tf-create-tasks.desc": "Create tasks from analysis",
  "orchestrator.cmd.tf-spawn-agents.desc": "Line up + spawn agents",
  "orchestrator.cmd.tf-spawn.desc": "Spawn a physical agent (terminal tab)",
  "orchestrator.cmd.tf-agent.desc": "Logical subagent (quick research)",
  "orchestrator.cmd.tf-work.desc": "Claim a task + code",
  "orchestrator.cmd.tf-status.desc": "Status dashboard",
  "orchestrator.cmd.tf-add.desc": "Add / edit tasks",
  "orchestrator.cmd.tf-flow.desc": "Design a flow pipeline",
  "orchestrator.cmd.tf-hold.desc": "Pause work + summarize status",
  "orchestrator.cmd.tf-resume.desc": "Resume paused work",
  "orchestrator.cmd.tf-review.desc": "PM code review",
  "orchestrator.cmd.tf-feedback.desc": "Check + answer PM feedback",
  "orchestrator.cmd.tf-fix.desc": "Recover FAILED/BLOCKED",
  "orchestrator.cmd.tf-handoff.desc": "Agent failed → take over directly",
  "orchestrator.cmd.tf-deploy.desc": "Deploy to GCP Cloud Run",
  "orchestrator.cmd.tf-sync.desc": "Sync code ↔ tickets",
  "orchestrator.cmd.tf-done.desc": "Finish project + archive",
  "orchestrator.cmd.tf-ralph.desc": "Batch the same task N times",
  "orchestrator.cmd.tf-guide.desc": "Command guide",
};
