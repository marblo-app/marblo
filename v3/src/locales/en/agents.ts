/**
 * English — `agents.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { agents as koAgents } from "../ko/agents";

export const agents: Record<keyof typeof koAgents, string> = {
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "Add Agent",
  "agents.dashboard.cleanup": "Cleanup",
  "agents.dashboard.cleanupConfirm":
    "Delete {count} inactive agents?\n(working agents are kept)",
  "agents.dashboard.loading": "Loading agents...",

  // ── Usage Dashboard ─────────────────────────────────────────
  "agents.usage.note.claude":
    "Max plan: unlimited (5-min cooldown) / Pro: daily limits apply",
  "agents.usage.note.gpt": "ChatGPT subscription — rate-limit based",
  "agents.usage.note.gemini": "Free: 15 RPM, 1M TPM / Paid: unlimited",
  "agents.usage.empty": "Add an agent to see usage here.",
  "agents.usage.gauge.rateLimit": "Plan: {planLabel} · limit usage",
  "agents.usage.gauge.activity": "Plan: {planLabel} · activity",
  "agents.usage.level.idle": "Idle",
  "agents.usage.level.low": "Low",
  "agents.usage.level.medium": "Medium",
  "agents.usage.level.high": "High",

  // ── Guide: CLI comparison table ─────────────────────────────
  "agents.guide.cliCompare.title": "AI CLI Comparison",
  "agents.guide.cliCompare.col.model": "Model",
  "agents.guide.cliCompare.col.free": "Free Usage",
  "agents.guide.cliCompare.col.strength": "Strengths",
  "agents.guide.cliCompare.col.install": "Install",
  "agents.guide.cliCompare.claude.free": "Included with Pro/Max plan",
  "agents.guide.cliCompare.claude.strength":
    "Code quality, architecture design, complex refactoring",
  "agents.guide.cliCompare.codex.free": "$5 credit for new users",
  "agents.guide.cliCompare.codex.strength":
    "Fast iteration, API integration, simple fixes",
  "agents.guide.cliCompare.gemini.free": "15 RPM free",
  "agents.guide.cliCompare.gemini.strength":
    "Long context (1M), large-scale code analysis",

  // ── Guide: which agent to use ───────────────────────────────
  "agents.guide.which.title": "Which agent should I use?",
  "agents.guide.which.claude.0": "Complex architecture design/refactoring",
  "agents.guide.which.claude.1": "Code review + security analysis",
  "agents.guide.which.claude.2": "Features requiring multi-file changes",
  "agents.guide.which.claude.3":
    "MCP tool integration (Marblo task management)",
  "agents.guide.which.codex.0": "Fast bug fixes + hotfixes",
  "agents.guide.which.codex.1": "Adding API endpoints",
  "agents.guide.which.codex.2": "Writing test code",
  "agents.guide.which.codex.3": "Simple CRUD implementation",
  "agents.guide.which.gemini.0": "Large codebase analysis (1M token context)",
  "agents.guide.which.gemini.1": "Documentation generation + code explanation",
  "agents.guide.which.gemini.2":
    "Understanding legacy code + migration planning",
  "agents.guide.which.gemini.3": "Repetitive tasks that need cost savings",

  // ── Guide: multi-agent strategy ─────────────────────────────
  "agents.guide.strategy.title": "Multi-Agent Strategy",
  "agents.guide.strategy.independent.title": "Independent Agents (Split)",
  "agents.guide.strategy.independent.when":
    "When working on different files/modules at the same time",
  "agents.guide.strategy.independent.example":
    "Run a frontend agent and a backend agent separately for parallel development",
  "agents.guide.strategy.independent.tip":
    "Clearly separate each agent's scope to avoid Git conflicts",
  "agents.guide.strategy.mixed.title": "Mixed-Model Strategy",
  "agents.guide.strategy.mixed.when":
    "When you need to balance cost optimization with quality",
  "agents.guide.strategy.mixed.example":
    "Design architecture with Claude → iterate with Codex → review code with Gemini",
  "agents.guide.strategy.mixed.tip":
    "Use Claude for complex work and Codex/Gemini for simple repetition to cut costs",
  "agents.guide.strategy.single.title": "Single Agent (Focused)",
  "agents.guide.strategy.single.when": "When focusing on one complex task",
  "agents.guide.strategy.single.example":
    "Large-scale refactoring, full implementation of a new feature",
  "agents.guide.strategy.single.tip":
    "For context-heavy work, it's more efficient to use a single agent",

  // ── Guide: setup instructions ───────────────────────────────
  "agents.guide.setup.title": "Setup Guide",
  "agents.guide.setup.step1.title": "Install CLI",
  "agents.guide.setup.step1.code":
    "npm install -g @anthropic-ai/claude-code  # Claude\nnpm install -g @openai/codex               # Codex\nnpm install -g @google/gemini-cli           # Gemini",
  "agents.guide.setup.step2.title": "Configure Authentication",
  "agents.guide.setup.step2.code":
    "# Claude: ANTHROPIC_API_KEY env var or Pro/Max plan\n# Codex:  run codex, then OAuth browser sign-in\n# Gemini: get an API key from Google AI Studio",
  "agents.guide.setup.step3.title": "Add an Agent in Marblo",
  "agents.guide.setup.step3.code":
    "# 1. Click the 'Add Agent' button\n# 2. Pick a name, model, and role\n# 3. MCP connects automatically — task management ready to use",

  // ── Setup Guide (empty state) ───────────────────────────────
  "agents.setupGuide.empty": "No agents yet",
  "agents.setupGuide.addFirst": "+ Add your first agent",
  "agents.setupGuide.preInstall": "Pre-Install Guide",
  "agents.setupGuide.preInstallDesc":
    "To run an agent, the corresponding AI CLI must be installed on your system.",
  "agents.setupGuide.install": "Install",
  "agents.setupGuide.run": "Run",
  "agents.setupGuide.note.claude":
    "Anthropic API key required (ANTHROPIC_API_KEY)",
  "agents.setupGuide.note.codex": "OpenAI API key required (OPENAI_API_KEY)",
  "agents.setupGuide.note.gemini": "Google AI API key required",
  "agents.setupGuide.mcp.title": "MCP Connection (Optional)",
  "agents.setupGuide.mcp.desc":
    "Connect the CLI directly to MCP from your terminal to manage tickets without an agent.",
};
