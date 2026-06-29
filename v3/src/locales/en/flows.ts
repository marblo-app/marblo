/**
 * English — `flows.*` namespace. Typed `Record<keyof typeof koFlows, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { flows as koFlows } from "../ko/flows";

export const flows: Record<keyof typeof koFlows, string> = {
  "flows.empty.title": "Select a flow or create a new one",
  "flows.empty.subtitle":
    "Use the + button on the left to create an empty flow, or pick a preset below",
  "flows.preset.create": "Click to create",

  "flows.guide.title": "Flow guide",
  "flows.guide.step1.pre": "Create an empty flow with ",
  "flows.guide.step1.mid": " on the left, or pick a ",
  "flows.guide.step1.preset": "preset",
  "flows.guide.step1.post": "",
  "flows.guide.step2.pre": "Drag nodes onto the canvas from the ",
  "flows.guide.step2.post": " at the bottom-left",
  "flows.guide.step3.pre": "Drag a node's ",
  "flows.guide.step3.handle": "handle (dot)",
  "flows.guide.step3.post": " to connect it to another node",
  "flows.guide.step4.pre": "Click a node to show the ",
  "flows.guide.step4.panel": "config panel",
  "flows.guide.step4.post": " on the right",
  "flows.guide.step5.pre": "Type ",
  "flows.guide.step5.post": " to the orchestrator and AI auto-generates a flow",

  "flows.nodeTypes.title": "Node types",
  "flows.nodeTypes.agent": "Run an AI agent",
  "flows.nodeTypes.llm": "Call an LLM API",
  "flows.nodeTypes.api": "HTTP request",
  "flows.nodeTypes.integration": "Slack/Notion, etc.",
  "flows.nodeTypes.branch": "Conditional branch",
  "flows.nodeTypes.human": "Human approval",
  "flows.nodeTypes.io": "Start / End",

  // NodePalette — per-type descriptions (some are locale-invariant tech lists)
  "flows.palette.input": "Text/File/Variable",
  "flows.palette.llm": "Claude/GPT/Gemini",
  "flows.palette.agent": "Run a CLI agent",
  "flows.palette.code": "Python/Shell/Node",
  "flows.palette.api": "HTTP request",
  "flows.palette.integration": "Slack/Notion/Sheets",
  "flows.palette.human": "PM approval gate",
  "flows.palette.branch": "if/else branch",
  "flows.palette.output": "Show result",

  // FlowKanbanLink — node run-status labels
  "flows.status.running": "Running",
  "flows.status.waiting": "Waiting",
  "flows.status.completed": "Done",
  "flows.status.error": "Error",
  "flows.status.unknown": "-",

  // CodeNode — empty script placeholder
  "flows.codeNode.clickToWrite": "Click to write code",

  // NodeConfigPanel — agent config
  "flows.config.selectPlaceholder": "-- Select --",
  "flows.config.connectionMode": "Connection Mode",
  "flows.config.mode.existing": "Connect to existing session",
  "flows.config.mode.auto": "Auto-spawn (new agent)",
  "flows.config.mode.existingHint":
    "Connects to a running session from the Agents tab",
  "flows.config.mode.autoHint":
    "Spawns a new agent automatically when the flow runs",
  "flows.config.selectAgentSession": "Select agent session",
  "flows.config.noRunningAgents":
    "No running agents. Spawn one from the Agents tab first.",
  "flows.config.agentName": "Agent Name",
  "flows.config.taskPlaceholder": "What this agent should do...",
  // NodeConfigPanel — code config
  "flows.config.codeHint.pre":
    "Write the code to run. The previous node's result is available as the ",
  "flows.config.codeHint.post": " variable.",
  "flows.config.cwdPlaceholder": "Project root (default)",
  // NodeConfigPanel — integration config
  "flows.config.bodyPlaceholder": "Content to send...",
  "flows.config.inputRefHint.pre": "Reference the previous node's result with ",
  "flows.config.inputRefHint.post": ".",
  "flows.config.apiTokenPlaceholder":
    "Recommended: manage via env vars in Settings",
  "flows.config.apiTokenHint":
    "For security, use environment variables in the Settings tab.",

  // NodeConfigPanel — integration action labels (option display names)
  "flows.action.send_message": "Send message",
  "flows.action.upload_file": "Upload file",
  "flows.action.create_channel": "Create channel",
  "flows.action.create_page": "Create page",
  "flows.action.update_page": "Update page",
  "flows.action.query_database": "Query database",
  "flows.action.send_photo": "Send photo",
  "flows.action.read_range": "Read range",
  "flows.action.write_range": "Write range",
  "flows.action.append_row": "Append row",
  "flows.action.create_issue": "Create issue",
  "flows.action.create_pr": "Create PR",
  "flows.action.add_comment": "Add comment",
  "flows.action.create_thread": "Create thread",
  "flows.action.send_email": "Send email",
  "flows.action.trigger": "Trigger webhook",
};
