# Concepts

- **Orchestrator** — decomposes a goal into tickets and spawns the right agent per task, diversifying across your fleet.
- **Agents** — each runs a coding CLI in its own live terminal.
- **Tickets** — the unit of work on the board; every card shows its concrete model.
- **Worktrees** — every ticket gets an isolated git branch, so parallel agents never collide.
- **Lanes** — fire several agents in parallel yourself, picking the model per lane.
- **Harness Store** — install skills, MCP servers, agents, workflows, and knowledge packs from the [registry](../../registry/).

See also: [Orchestration →](../orchestration/)
