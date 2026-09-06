# Model Display Field Audit — RemzrVRpL1I6QwmyFa7Y

Scope: display inconsistency only. BigQuery `events.agent:spawned.model` and telemetry column semantics belong to ticket `g6TjsfP9NdtHlwuziyt7`.

## Rule

- Primary model text should be the strongest user-facing evidence available: `detectedModelId` → `spawnedModel` → `model`.
- Harness (`model`) still owns icon/color/runner grouping because it is the CLI/runtime axis.
- Narrow surfaces show the primary model only, with the harness in `title` as `actual · harness`.
- Analytics/history surfaces that already answer "what was billed" keep `detectedModelId` first.

## Surface Inventory

| Surface                                 | Current field path                                                                                                | Decision                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Agent list bottom panel                 | `AgentRowData.spawnedModel` from `agents.spawnedModel`; vendor from `resolveAgentVendorKind(model, spawnedModel)` | Already reads the right concrete-model field. Title now follows actual-first helper. |
| Agent fleet/grid cards                  | Previously icon/color from `agent.model`; no concrete model text                                                  | Keep icon/color from harness, add compact `agentModelDisplayLabel(agent)` text.      |
| Legacy agent list/cards                 | Previously `agent.model`/command only                                                                             | Add compact `agentModelDisplayLabel(agent)` chip.                                    |
| Member/team card                        | Previously expanded details showed `agent.model`                                                                  | Show `agentModelDisplayLabel(agent)` and keep harness in title.                      |
| Terminal tab                            | `attachSession(..., "Agent: {name}")`; no model text                                                              | No change. It is not a model-label surface in current code.                          |
| Ticket assignee/task cards              | `claimingAgent.spawnedModel` via `spawnedModelLabel(...)`                                                         | Already reads existing `metadata.spawnedModel` fan-in through agent doc.             |
| Task detail modal/review state          | `spawnedModelLabel(agent.spawnedModel)` with harness title                                                        | Already reads concrete model; title now actual-first.                                |
| Board graph                             | `spawnedModelLabel(agent.spawnedModel) ?? agent.model`                                                            | Already concrete-first.                                                              |
| Lanes                                   | `spawnedModelLabel(agent.spawnedModel) \|\| agent.model`                                                          | Already concrete-first.                                                              |
| Completion/work history replay          | `detectedModelId ?? spawnedModel ?? vendor`                                                                       | Already strongest-evidence-first.                                                    |
| Activity stream `agent:spawned` details | Previously `params.model` only                                                                                    | Now uses `params.spawnedModel` or MCP result `Spawned model:` before harness.        |

## Existing Data Flow

No new persistence wiring is needed for display. `bridge-server.ts` sends `agent:spawned` with both `model` and `spawnedModel`; `Layout.tsx` and `useAppLifecycle.ts` merge `spawnedModel` into the agent doc when present, and direct launch/restart paths stamp the launch result through `agentService.stampSpawnedModel`.
