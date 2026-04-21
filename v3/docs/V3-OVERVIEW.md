# Marblo v3.0 — Desktop App Overview

## Architecture Summary

Marblo v3 is an **Electron desktop application** for managing AI agent team workspaces. It replaces the v1 Docker-based web app (FastAPI + Next.js) with a local-install desktop app.

| Layer | v1 (Docker) | v3 (Desktop) |
|-------|-------------|--------------|
| Backend | FastAPI + PostgreSQL | Electron main process + Firebase |
| Frontend | Next.js (port 3001) | React 18 + Vite (embedded) |
| Data Store | PostgreSQL (Docker) | Cloud Firestore |
| Auth | Custom JWT | Firebase Auth (Google/GitHub/Email) |
| Terminal | Docker sidecar (port 8001) | node-pty (native) |
| MCP Server | Python stdio (`marblo`) | Node.js stdio (`Marblo`) |
| Packaging | `docker compose up` | `electron-builder` (macOS/Win/Linux) |

## Tech Stack

- **Electron 33** — Desktop shell, IPC bridge, native modules
- **React 18 + TypeScript** — UI framework
- **Vite 6** — Dev server & bundler
- **Tailwind CSS 3** — Styling
- **Zustand 5** — State management
- **Firebase 10** — Auth + Firestore + Cloud Functions
- **Monaco Editor** — Code editing (via CDN)
- **xterm.js + node-pty** — Integrated terminal
- **@dnd-kit** — Kanban drag-and-drop
- **@xyflow/react** — Flow canvas (visual DAG editor)
- **@modelcontextprotocol/sdk** — MCP server for AI agents
- **Anthropic SDK + OpenAI SDK** — AI orchestration

## Project Structure

```
v3/
├── electron/                  # Electron main process
│   ├── main.ts                # App entry, BrowserWindow, IPC handlers
│   ├── preload.ts             # Context bridge (electronAPI)
│   ├── pty-manager.ts         # Terminal sessions (node-pty)
│   ├── fs-manager.ts          # File system operations
│   ├── agent-manager.ts       # Agent process lifecycle
│   ├── agent-config.ts        # Agent configuration
│   ├── updater.ts             # Auto-update (electron-updater)
│   ├── mcp-server/            # MCP server (stdio transport)
│   │   ├── index.ts           # Server entry
│   │   ├── tools.ts           # MCP tool definitions
│   │   ├── prompts.ts         # MCP prompt templates
│   │   ├── firebase.ts        # Firebase Admin for MCP
│   │   └── state-machine.ts   # Task status transitions
│   ├── orchestrator/          # AI task decomposition
│   │   ├── index.ts
│   │   ├── task-decomposer.ts # Natural language → tasks
│   │   ├── dag-generator.ts   # Dependency graph generation
│   │   ├── dag-resolver.ts    # DAG execution order
│   │   ├── flow-generator.ts  # Auto-generate flow from tasks
│   │   ├── llm-client.ts      # LLM API calls
│   │   ├── auto-router.ts     # Route tasks to agents
│   │   └── prompt-templates.ts
│   └── flow-engine/           # Flow execution engine
│       ├── flow-runner.ts     # Execute flow graphs
│       ├── node-executors.ts  # Per-node-type executors
│       ├── kanban-bridge.ts   # Flow ↔ Kanban sync
│       └── topo-sort.ts       # Topological sort for DAGs
│
├── src/                       # React renderer process
│   ├── main.tsx               # React entry
│   ├── App.tsx                # Auth gate → Layout
│   ├── index.html             # HTML shell + CSP
│   ├── auth/                  # Firebase Auth
│   │   ├── AuthProvider.tsx   # Auth context
│   │   ├── LoginPage.tsx      # Login UI
│   │   └── index.ts
│   ├── lib/
│   │   └── firebase.ts        # Firebase SDK init
│   ├── types/                 # TypeScript types
│   │   ├── task.ts            # Task, TaskStatus, AgentRole
│   │   ├── agent.ts           # Agent type
│   │   ├── project.ts         # Project type
│   │   ├── activity.ts        # Activity log type
│   │   ├── flow.ts            # Flow graph types
│   │   ├── subscription.ts    # Billing plan types
│   │   ├── invitation.ts      # Team invitation
│   │   ├── collaboration.ts   # Real-time collaboration
│   │   └── user.ts            # User profile
│   ├── services/              # Firestore CRUD
│   │   ├── firestore.ts       # Generic Firestore helpers
│   │   ├── taskService.ts     # Task CRUD + status transitions
│   │   ├── activityService.ts # Activity feed
│   │   ├── agentService.ts    # Agent management
│   │   ├── projectService.ts  # Project CRUD
│   │   ├── flowService.ts     # Flow CRUD
│   │   ├── teamService.ts     # Team/invitation logic
│   │   ├── billingService.ts  # Paddle/Toss payments
│   │   ├── collaborationService.ts
│   │   └── stateMachine.ts    # Valid status transitions
│   ├── stores/                # Zustand stores
│   │   ├── projectStore.ts    # Current project + subscription
│   │   ├── taskStore.ts       # Task list (real-time)
│   │   ├── agentStore.ts      # Agent list
│   │   ├── editorStore.ts     # Open files/tabs
│   │   └── subscriptionStore.ts # User plan/features
│   ├── hooks/                 # React hooks
│   │   ├── useAuth.ts
│   │   ├── useAgents.ts
│   │   ├── useFlows.ts
│   │   ├── useTeam.ts
│   │   └── useTerminal.ts
│   └── components/            # UI components
│       ├── Layout.tsx         # Main layout shell
│       ├── Header.tsx         # Top bar + project selector
│       ├── TabBar.tsx         # Tab navigation
│       ├── sidebar/           # File tree sidebar
│       ├── board/             # Kanban board
│       │   ├── KanbanBoard.tsx    # Board + DndContext
│       │   ├── KanbanColumn.tsx   # Droppable column
│       │   ├── TaskCard.tsx       # Draggable task card
│       │   ├── TaskCreateModal.tsx
│       │   └── TaskDetailModal.tsx
│       ├── code/              # Code editor
│       │   ├── CodeEditor.tsx     # Monaco wrapper
│       │   ├── EditorTabs.tsx
│       │   └── DiffViewer.tsx
│       ├── terminal/          # Integrated terminal
│       │   ├── TerminalPanel.tsx
│       │   ├── TerminalView.tsx
│       │   ├── TerminalTabs.tsx
│       │   └── FeedbackInput.tsx
│       ├── agents/            # Agent dashboard
│       │   ├── AgentDashboard.tsx
│       │   ├── AgentList.tsx
│       │   ├── AgentStatusCard.tsx
│       │   ├── AgentAddModal.tsx
│       │   ├── TeamDashboard.tsx
│       │   ├── TeamSummary.tsx
│       │   └── ActivityFeed.tsx
│       ├── flows/             # Visual flow editor
│       │   ├── FlowCanvas.tsx
│       │   ├── FlowList.tsx
│       │   ├── NodePalette.tsx
│       │   ├── NodeConfigPanel.tsx
│       │   └── nodes/         # Custom node types
│       ├── orchestrator/      # AI decomposition UI
│       │   ├── OrchestratorChat.tsx
│       │   ├── DecompositionResult.tsx
│       │   └── TaskPreview.tsx
│       ├── settings/          # Settings & billing
│       │   ├── SettingsPage.tsx
│       │   ├── BillingPage.tsx
│       │   ├── TeamManagement.tsx
│       │   ├── PlanGate.tsx
│       │   ├── UpgradeModal.tsx
│       │   └── InvitationBanner.tsx
│       ├── collaboration/     # Real-time collab
│       │   ├── PresenceIndicator.tsx
│       │   └── ConflictWarning.tsx
│       └── tabs/              # Tab content wrappers
│           ├── BoardTab.tsx
│           ├── CodeTab.tsx
│           ├── AgentsTab.tsx
│           └── FlowsTab.tsx
│
├── firestore.rules            # Firestore security rules
├── firestore.indexes.json     # Composite indexes
├── firebase.json              # Firebase project config
├── vite.config.ts             # Vite config (root: src, envDir: ./)
├── tailwind.config.js
├── tsconfig.json              # Frontend TS config
├── electron-builder.yml       # App packaging config
└── package.json
```

## Key Features

### 1. Kanban Board (Drag & Drop)
- 7 status columns: TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE (+ BLOCKED, FAILED)
- State machine enforces valid transitions (e.g., TODO can only go to CLAIMED)
- Visual feedback: blue highlight = valid drop target, red = invalid
- Role filters (backend/frontend/test/devops)
- Real-time sync via Firestore subscriptions

### 2. Integrated Terminal
- node-pty provides native terminal sessions
- xterm.js renders in the browser
- WebSocket bridge between Electron main ↔ renderer
- Heartbeat + auto-reconnect for stability
- Multiple terminal sessions with tabs

### 3. Code Editor
- Monaco Editor (VS Code engine) via CDN
- File tree sidebar with electronAPI.fs
- Multi-tab editing with open/close/save
- Diff viewer for comparing changes

### 4. AI Agent Management
- Register agents (backend, frontend, test, devops roles)
- Agent status tracking (idle/busy/offline)
- Activity feed per task
- Team dashboard with member management

### 5. Visual Flow Editor
- @xyflow/react canvas for DAG editing
- Node types: Agent, LLM, API, Branch, Human, Input, Output
- Flow ↔ Kanban bidirectional linking
- Flow execution engine in Electron main process

### 6. AI Task Decomposition (Orchestrator)
- Natural language → structured task DAG
- Auto-route tasks to appropriate agent roles
- Generate flows from task dependencies
- Claude/OpenAI API integration

### 7. MCP Server
- `@modelcontextprotocol/sdk` (Node.js, stdio transport)
- Server name: `Marblo` (v3), distinct from v1's Python MCP
- Tools: task CRUD, status updates, activity logging
- Prompt templates for agent workflows
- Firebase Admin SDK for direct Firestore access

### 8. Payments & Plans
- Paddle (international) + TossPayments (Korea)
- Plan tiers: Free, Pro, Team
- Feature gating via `PlanGate` component
- Subscription data in Firestore `/subscriptions/{userId}`

### 9. Team Collaboration
- Project-level membership (owner, admin, member roles)
- Invitation system (email-based)
- Firestore security rules enforce project-scoped access
- Real-time presence indicators

## Task Status State Machine

```
TODO ──→ CLAIMED ──→ IN_PROGRESS ──→ REVIEW ──→ DONE
                 ↘                 ↗    ↘
                  FAILED ←──────────     IN_PROGRESS
                 ↗       ↘
  IN_PROGRESS ──→ BLOCKED → IN_PROGRESS
```

Valid transitions:
- `TODO` → `CLAIMED`
- `CLAIMED` → `IN_PROGRESS`, `FAILED`
- `IN_PROGRESS` → `REVIEW`, `BLOCKED`, `FAILED`
- `REVIEW` → `DONE`, `IN_PROGRESS`
- `BLOCKED` → `IN_PROGRESS`
- `FAILED` → `TODO`
- `DONE` → (terminal)

## Firebase Setup

**Project ID**: `marblo-2253d`

### Required Environment Variables (`.env`)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### Firestore Collections
| Collection | Purpose |
|-----------|---------|
| `users` | User profiles |
| `projects` | Projects with member arrays |
| `tasks` | Task tickets (per project) |
| `activities` | Activity logs (per task) |
| `agents` | Registered AI agents |
| `flows` | Visual flow definitions |
| `invitations` | Team invitations |
| `memberRoles` | Role assignments (doc ID: `{projectId}_{userId}`) |
| `subscriptions` | Billing plan per user |

### Deploy Rules
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

## Development

```bash
# Install dependencies
npm install

# Dev mode (Vite + Electron)
npm run dev

# Or run separately
npm run dev:vite      # Vite on :5173
npm run dev:electron  # Electron (loads :5173)

# Type check
npm run typecheck

# Build MCP server
npm run build:mcp

# Package desktop app
npm run build:mac     # macOS .dmg
npm run build:win     # Windows .exe
npm run build:linux   # Linux .AppImage
```

## MCP Integration

The v3 MCP server runs as a standalone Node.js process (stdio transport). To use with Claude Code or other MCP clients:

```json
{
  "mcpServers": {
    "marblo-desktop": {
      "command": "node",
      "args": ["/path/to/v3/dist-mcp/index.js"],
      "env": {
        "FIREBASE_SERVICE_ACCOUNT": "/path/to/service-account.json"
      }
    }
  }
}
```

**Note**: Use `marblo-desktop` as the server key to avoid conflicts with v1's `marblo` Python MCP server.
