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
};
