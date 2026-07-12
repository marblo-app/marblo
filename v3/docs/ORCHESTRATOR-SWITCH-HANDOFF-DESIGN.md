# Orchestrator Switch + Context Handoff Design

**Status:** Design only. 코드 미구현.
**Target:** v3.x — 오케탭 즉시 모델/세션 전환
**Owner:** frontend + electron follow-up
**Spec date:** 2026-07-12
**Task:** `55K4pgIPcV2SjCVw5Fpx`
**Related code:** `v3/src/components/orchestrator/OrchestratorPanel.tsx`, `v3/src/stores/orchestratorStore.ts`, `v3/electron/preload.ts`, `v3/electron/main.ts`, `v3/electron/orchestrator-manager.ts`, `v3/electron/mission-engine/*`

> This document is doc-first. It proposes the contract and UX only. No runtime code is changed in this task.

---

## 0. One-Line Summary

오케탭에 모델/세션 전환 스위치를 추가해 사용자가 board orchestrator를 즉시 새 모델로 갈아탈 수 있게 한다. 전환 시 새 오케는 Firestore의 `missions/*`와 `tasks/*`를 진실원으로 읽고, 이전 오케 PTY의 휘발성 진행 맥락은 짧은 handoff prompt로 주입받는다. 기존 `OrchestratorManager`의 launch/stop/resume lock/boot gate를 재사용하고, 별도 오케 런타임은 만들지 않는다.

---

## 1. Current Baseline

### 1.1 Board orchestrator

- UI: `OrchestratorPanel`은 `window.electronAPI.orchestratorSession.launch(projectId, cwd, resumeSessionId)`와 `stop()`을 호출한다.
- Store: `orchestratorStore`는 단일 `sessionId`, `ptySessionId`, `status`, `isCollapsed`만 보관한다.
- Main: `orchestratorSession:launch`는 project-scoped `OrchestratorManager`를 가져와 `launch(...)`를 호출한다.
- Manager: `OrchestratorManager`는 `kind="board"` 기본 세션을 관리하고, 기존 세션이 있으면 `launch()` 초반에 `stop()` 후 새 PTY를 만든다.
- Resume: `resolveOrchestratorResumeId(rootPath)`가 label/content signature 기반으로 직전 Claude Code 세션을 찾는다.

### 1.2 Mission orchestrator

- `missionOrchestrator:start`는 `ensureMissionOrchestratorLaunched(projectId, rootPath, missionId)`로 들어간다.
- mission kind는 board kind와 분리되고, `missionId`별 resume store를 이미 갖는다.
- 같은 미션은 resume, 다른 미션은 stop 후 해당 미션 세션으로 교체한다.
- `mission.status`, `steps`, `currentStepIndex`, `taskIds`, `contextLog`가 Firestore의 장기 진실원이다.

### 1.3 Reusable mechanics

- PTY forwarding: `setupPtyForwarding(sid)`와 `pty:replay`.
- Graceful stop: `OrchestratorManager.stop()`, `ptyManager.kill()`, resume lock release.
- Resume safety: cross-process resume lock prevents double `--resume`.
- Boot prompt injection gate: `bootGate` and `injectChain` serialize the initial prompt and later injections.
- Session restore: renderer reconnects project/rootPath after reload via `useSessionRestore`.

---

## 2. Handoff Data Model

### 2.1 Truth source

The handoff snapshot is derived from Firestore. PTY output is supplemental only.

| Domain | Firestore truth source | Why |
| --- | --- | --- |
| Current mission | `missions/*` filtered by `projectId`, non-terminal status, selected/focused mission if known | Mission is the persistent user intent container. |
| Mission progress | `mission.status`, `currentStepIndex`, `steps[]`, `taskIds`, `contextLog`, `lastActivityAt` | Captures workflow position and recent durable narration. |
| Board work | `tasks/*` filtered by `projectId`, statuses `CLAIMED`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`, plus mission task ids | Board is the durable task state machine. |
| Agent ownership | task `claimedBy`, agent docs if available, activity logs if already surfaced | Shows who is working and where handoff must avoid duplicate dispatch. |
| Pending decisions | mission `waiting_for_human`, recent `user.decision`, `user.input`, `agent.stuck`, blocked tasks, PM feedback flags | These are the high-risk places a new orchestrator must not miss. |

### 2.2 Proposed handoff snapshot

Create an in-memory snapshot object in main before switching. Optionally persist a compact audit event later, but the first implementation can keep the snapshot ephemeral because Firestore remains the truth source.

```ts
interface OrchestratorHandoffSnapshot {
  projectId: string;
  rootPath: string;
  from: {
    ptySessionId: string | null;
    claudeSessionId?: string;
    model?: string;
    stoppedAt: number;
  };
  to: {
    model: string;
    resumeSessionId: "new" | string;
  };
  activeMissions: Array<{
    id: string;
    goal: string;
    status: string;
    currentStepIndex: number;
    currentStep?: {
      index: number;
      type: string;
      status: string;
      skill?: string;
      args?: string;
      liveOutputTail?: string;
    };
    taskIds: string[];
    recentTimeline: Array<{
      ts: string;
      type: string;
      summary: string;
    }>;
    unresolvedDecisions: string[];
  }>;
  board: {
    inFlightTasks: Array<{
      id: string;
      title: string;
      status: string;
      role: string;
      claimedBy: string | null;
      missionId?: string;
      updatedAt?: string;
    }>;
    blockedTasks: Array<{
      id: string;
      title: string;
      comment?: string;
    }>;
    reviewTasks: Array<{
      id: string;
      title: string;
      prUrl?: string;
    }>;
  };
  operatorNote?: string;
}
```

### 2.3 Snapshot limits

- Keep recent mission timeline to the last 8-12 durable events per active mission.
- Include PTY output only as an optional tail, never as a truth source.
- Do not include raw secrets, API keys, full prompts, or large terminal logs.
- If Firestore read fails, block switch or offer "switch without handoff" only after explicit confirmation.

---

## 3. Switching Semantics: Options

This is the main product decision.

### Option A — Transfer active work immediately

New orchestrator boots and receives the snapshot. It may continue supervising existing missions/tasks immediately.

Pros:
- Feels like a true model switch.
- Best for "current model is weak/stuck; let a stronger one take over now."
- Matches user expectation for an immediate toggle.

Cons:
- Higher duplicate-action risk if old orchestrator did not fully stop.
- Requires strict graceful stop and pending instruction detach before new boot prompt.

Required guardrails:
- Stop old PTY and detach `pendingListener` before new PTY is allowed to receive instructions.
- New boot prompt must say: do not redispatch existing `IN_PROGRESS`/`CLAIMED` work; inspect Firestore first.
- If a mission is `waiting_for_human`, new orchestrator must ask/continue from that decision, not advance.

### Option B — Switch model, leave active work waiting

Old orchestrator stops, new orchestrator boots with handoff but does not advance anything until user sends a command.

Pros:
- Safest against duplicate dispatch or unintended mission advance.
- Easier to reason about for beta.

Cons:
- Less "instant takeover"; user must nudge the new orchestrator.
- Does not fully solve stuck orchestrator handoff unless the user knows what to ask.

Recommended beta default: **Option B with one-click "Take over now" prompt action**.

Reasoning:
- It preserves instant model/session switch without automatic side effects.
- It still gives the new orchestrator full context.
- It lets advanced users explicitly grant immediate continuation.

---

## 4. UX Design

### 4.1 Placement

In the board `OrchestratorPanel` header:

- Current status dot and label remain.
- Add compact model selector near the existing version badge.
- Add a switch command button beside Stop/Start.
- When stopped, the selector chooses the model for next Start.
- When running, changing selector opens a switch confirmation popover.

Suggested controls:

- Model dropdown: `Claude`, `Codex`, future `Gemini`/`Antigravity` if supported by `resolveOrchestratorModel`.
- Session toggle: `Continue previous` / `Fresh with handoff`.
- Switch button: visible only when selected model differs from running model or user explicitly chooses fresh.

### 4.2 Running-work handling

When any of these exist, show a compact confirmation sheet:

- active mission `status in planning | active | waiting_for_human | sleeping`
- board task `status in CLAIMED | IN_PROGRESS | BLOCKED | REVIEW`
- pending PM feedback

Confirmation copy should be operational, not explanatory marketing:

- "Switch orchestrator to Codex"
- "Snapshot: 1 active mission, 3 in-flight tasks, 1 unresolved decision"
- Choice:
  - "Switch and wait" (recommended beta default)
  - "Switch and take over"
  - "Cancel"

### 4.3 UI states

| State | UI behavior |
| --- | --- |
| `running` | selector enabled, switch button enabled when target differs |
| `switching` | terminal input disabled, status label "Switching...", buttons disabled except cancel if still pre-stop |
| `handoffFailed` | old orchestrator remains running if stop has not begun; otherwise new Start can retry |
| `stopped` | selector controls next launch |
| `error` | show retry with same handoff snapshot if still available |

### 4.4 Store additions

Extend `orchestratorStore` later with UI-only state:

```ts
type OrchestratorSwitchMode = "wait" | "takeover";

interface OrchestratorSwitchState {
  runningModel: string | null;
  selectedModel: string;
  switchStatus: "idle" | "snapshotting" | "stopping" | "starting" | "error";
  lastHandoffSummary?: {
    activeMissionCount: number;
    inFlightTaskCount: number;
    unresolvedDecisionCount: number;
  };
  switchOrchestrator: (targetModel: string, mode: OrchestratorSwitchMode) => Promise<void>;
}
```

---

## 5. IPC Contract

### 5.1 New renderer API

Add one high-level call instead of composing `stop()` and `launch()` in the renderer:

```ts
window.electronAPI.orchestratorSession.switch({
  projectId,
  rootPath,
  targetModel,
  mode: "wait" | "takeover",
  resume: "fresh" | "previous",
});
```

Return:

```ts
{
  sessionId: string;
  ptySessionId: string;
  status: "starting" | "running" | "blocked";
  handoffSummary: {
    activeMissionCount: number;
    inFlightTaskCount: number;
    unresolvedDecisionCount: number;
  };
  needsAuth?: {
    model: string;
    action: string;
    installed?: boolean;
  };
}
```

### 5.2 Main-process sequence

The switch IPC should run as a single serialized critical section per project:

1. Resolve current project/rootPath and current `OrchestratorManager`.
2. Build `OrchestratorHandoffSnapshot` from Firestore.
3. Validate target model with existing auth/install gate.
4. If validation fails, return `needsAuth` and keep old orchestrator running.
5. Detach pending instruction listener for old `orch-${projectId}`.
6. Gracefully stop old orchestrator.
7. Launch new orchestrator with target model and `resumeSessionId`:
   - `resume="previous"`: resume target model's previous session if compatible.
   - `resume="fresh"`: force `"new"`.
8. Inject handoff prompt through the same boot gate/inject chain used by conductor grants.
9. Reattach pending instruction listener to the new PTY.
10. Return new session info.

### 5.3 Why renderer should not call stop+launch directly

Switch needs atomic ordering:

- Snapshot before stop.
- Auth gate before stop.
- Stop before launch.
- Listener detach/attach around PTY replacement.
- Handoff injection after boot readiness.

If the renderer composes multiple IPC calls, a reload or double-click can leave old/new orchestrators both alive or lose the handoff payload.

---

## 6. Graceful Stop + Boot Prompt Injection

### 6.1 Stop requirements

Reuse `OrchestratorManager.stop()` and `PtyManager.kill()` behavior. The switch path should additionally guarantee:

- `stopRequested = true` so auto-restart does not relaunch the old PTY.
- resume lock is released for the old Claude session.
- `pendingListener.detach("orch-${projectId}")` happens before old PTY kill.
- status event emits `switching`/`starting` to the owning renderer.

### 6.2 New boot prompt shape

For a fresh switch, initial prompt should include the normal orchestrator boot line plus a compact handoff section:

```text
You are the Marblo Orchestrator Agent.
Read the orchestrator skill file with get_agent_skill("orchestrator").

You are taking over from a previous orchestrator session.
Firestore missions/* and tasks/* are the source of truth.
Do not redispatch CLAIMED or IN_PROGRESS tasks.
Do not advance a waiting_for_human mission without user input.

Handoff snapshot:
<compact JSON or markdown summary>

Mode: wait | takeover.
If mode is wait, summarize what you inherited and wait for the user.
If mode is takeover, inspect current state first, then continue only the next safe action.
```

For a resumed session, do not resend the full boot prompt. Instead inject a handoff message after CLI settle through `injectMessage`:

```text
System handoff update: the UI switched orchestrator model/session.
Refresh your working context from Firestore before acting.
<compact summary>
```

### 6.3 Model selection

Current code resolves board orchestrator model from stored/env policy via `resolveOrchestratorModel()` and `applyStoredOrchestratorModelEnv()`. The switch design should not rely on global env mutation for the target model because multiple windows/projects can run concurrently.

Preferred follow-up:

- Add a project-scoped model override map, parallel to existing `projectEnabledModels`.
- Pass `targetModel` into `OrchestratorManager.launch(...)` or a launch options object.
- Keep env fallback for old paths.

---

## 7. Reusing Mission Resume / PTY Recovery

### 7.1 Reuse directly

- `OrchestratorManager` session lifecycle, status, PTY forwarding, resume locks.
- `resolveOrchestratorResumeId(rootPath)` for board previous-session detection.
- `resolveMissionResumeId(rootPath, missionId)` as the pattern for future mission-specific handoff.
- `bootGate`/`injectChain` for serialized handoff prompt injection.
- `pty:replay` for terminal panel recovery after switch/reload.
- `useSessionRestore` for project/rootPath restoration after renderer reload.

### 7.2 Do not duplicate

- Do not build a second PTY manager.
- Do not persist a new source of truth for mission/task progress.
- Do not parse terminal scrollback to infer task state.
- Do not create a new mission resume store for board handoff unless product later needs per-model board session pointers.

### 7.3 Gap to close

The current `OrchestratorManager.launch()` builds its own initial prompt internally and accepts only positional parameters. Handoff requires either:

1. Add `launchOptions?: { modelOverride?: string; handoffPrompt?: string; handoffMode?: "wait" | "takeover" }`.
2. Or keep launch unchanged and call `injectMessage(handoffPrompt)` after launch.

Recommended: **add launch options** so fresh-session handoff can be part of the first user turn. Use post-launch injection only for resumed sessions.

---

## 8. Failure Modes

| Failure | Expected behavior |
| --- | --- |
| Target CLI not installed/authenticated | Return `needsAuth`; keep old orchestrator running. |
| Firestore snapshot read fails | Keep old orchestrator running; show retry. |
| Old stop hangs | Force kill through existing PTY kill path; mark old as stopped only after kill result. |
| New launch fails after old stop | Show stopped/error with retry using same snapshot. |
| Duplicate switch click | Project-level switch lock returns current in-flight promise. |
| Renderer reload during switch | Main owns switch; renderer recovers through status + `pty:replay`. |
| Pending instruction arrives during switch | Queue or reject until new `pendingListener` attaches; do not deliver to old PTY after detach. |

---

## 9. Implementation Plan After Approval

1. Frontend state/UI:
   - Extend `orchestratorStore` with selected/running model and switch status.
   - Add model selector and switch confirmation sheet to `OrchestratorPanel`.
   - Keep existing Start/Stop behavior for unchanged model.

2. Preload/API types:
   - Add `orchestratorSession.switch(args)` and typed return.
   - Add project-aware `stop/status` overloads if needed for consistency.

3. Main IPC:
   - Add `orchestratorSession:switch` handler.
   - Serialize per-project switch operations.
   - Build Firestore handoff snapshot from missions/tasks.
   - Auth-gate target model before stop.

4. OrchestratorManager:
   - Add launch options for model override and handoff prompt.
   - Reuse boot gate for prompt ordering.
   - Ensure old auto-restart is disabled on intentional switch.

5. Tests:
   - Unit: snapshot builder redacts and limits timeline.
   - Unit: switch keeps old session alive when target auth gate fails.
   - Unit: switch stop/launch order and pending listener detach/attach.
   - Playwright/unit render: selector and confirmation sheet states.

---

## 10. Open Decisions For Review

1. Default semantic:
   - Recommended beta: `Switch and wait`.
   - Alternative: `Switch and take over` for power users or explicit command.

2. Board session resume after model switch:
   - Fresh with handoff is safer and model-agnostic.
   - Resume previous is useful only when target model supports the same session format.

3. Persistence:
   - Ephemeral snapshot is enough for first implementation.
   - Later, append `supervisor.note` or audit event for observability.

4. Mission behavior:
   - This design covers board orchestrator switching first.
   - Mission orchestrator switching can reuse the same IPC shape with required `missionId`, but should be separately gated because mission conductor can advance steps.
