# Agent Capability Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each marblo worker agent situationally invokes its model's native specialty (Claude: Workflow/`/deep-research`/`/goal`; Codex(gpt): `/goal`; Antigravity: research role), and the board card shows a live "specialty in progress" marker.

**Architecture:** Model-conditioned capability snippets are appended to each worker's role skill at launch (the "how"). A pure `capabilityHintForTags(tags, model)` maps dispatch tags to a one-line hint injected into the dispatched instruction (the "which/when"). Specialty snippets instruct agents to log `[cap:start:X]`/`[cap:end:X]` activity markers; a pure projection helper derives `Task.activeCapability` from those markers, rendered as a TaskCard badge.

**Tech Stack:** TypeScript, Electron (main), React + Zustand (renderer), Vitest, Firestore.

**Two independent parts (each shippable alone):**

- **Part A — Capability Hints** (Tasks 1–6): snippets + hint function + injection + orchestrator rule.
- **Part B — C-lite Marker** (Tasks 7–11): `activeCapability` type + projection derivation + TaskCard badge.

**Key facts (do not deviate):**

- `ModelType = "claude" | "gemini" | "gpt" | "antigravity" | "local" | "custom"`. Codex's model id is **`gpt`** (not "codex").
- Model→snippet map: `claude→capability_claude`, `gpt→capability_codex`, `antigravity→capability_antigravity`. `gemini`/`local`/`custom` → no snippet.
- Workflow/`/deep-research` need a paid plan + research preview → snippets MUST instruct graceful fallback to normal handling.

---

## Part A — Capability Hints

### Task 1: `capabilityHintForTags` pure function

**Files:**

- Modify: `v3/electron/dispatch-scoring.ts` (add export after `costEfficiencyScore`, ~line 182)
- Test: `v3/tests/unit/capabilityHint.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `v3/tests/unit/capabilityHint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { capabilityHintForTags } from "../../electron/dispatch-scoring";

describe("capabilityHintForTags", () => {
  it("returns empty for no tags", () => {
    expect(capabilityHintForTags([], "claude")).toBe("");
  });

  it("suppresses on fast-lane tags (no heavy tag present)", () => {
    expect(capabilityHintForTags(["simple-fix", "quick-edit"], "claude")).toBe(
      ""
    );
    expect(capabilityHintForTags(["boilerplate"], "gpt")).toBe("");
  });

  it("research tags → model-conditioned research hint", () => {
    expect(capabilityHintForTags(["research"], "claude")).toContain(
      "/deep-research"
    );
    expect(capabilityHintForTags(["analysis"], "antigravity")).toContain("agy");
    expect(capabilityHintForTags(["documentation"], "gpt")).toContain("리서치");
  });

  it("autonomous tags → /goal hint", () => {
    expect(capabilityHintForTags(["autonomous"], "claude")).toContain("/goal");
    expect(capabilityHintForTags(["agentic"], "gpt")).toContain("/goal");
  });

  it("heavy tags → workflow/goal hint, model-conditioned", () => {
    expect(
      capabilityHintForTags(["multi-file", "refactor"], "claude")
    ).toContain("Workflow");
    expect(capabilityHintForTags(["architecture"], "gpt")).toContain("/goal");
  });

  it("heavy beats fast-lane when both present", () => {
    expect(
      capabilityHintForTags(["simple-fix", "multi-file"], "claude")
    ).toContain("Workflow");
  });

  it("unknown/unsupported model → empty", () => {
    expect(capabilityHintForTags(["multi-file"], "gemini")).toBe("");
    expect(capabilityHintForTags(["research"], "local")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/capabilityHint.test.ts`
Expected: FAIL — `capabilityHintForTags is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `v3/electron/dispatch-scoring.ts`, add after `costEfficiencyScore` (~line 182):

```typescript
// ── Capability hints ────────────────────────────────────────
// Maps dispatch tags → a one-line "which specialty, when" hint for the
// worker's model. The capability_{model}.md snippet explains HOW; this is
// the per-ticket WHICH/WHEN. Returns "" to suppress (fast-lane or
// unsupported model). Pure + deterministic for testing.

const FAST_LANE_TAGS = new Set([
  "simple-fix",
  "quick-edit",
  "boilerplate",
  "fast-execution",
]);
const RESEARCH_TAGS = new Set(["research", "analysis", "documentation"]);
const AUTONOMOUS_TAGS = new Set(["agentic", "autonomous", "multi-agent"]);
const HEAVY_TAGS = new Set([
  "architecture",
  "multi-file",
  "large-context",
  "refactor",
  "complex-edit",
]);

export function capabilityHintForTags(
  tags: string[],
  model: ModelType
): string {
  // Only claude / gpt (codex) / antigravity have specialties wired.
  if (model !== "claude" && model !== "gpt" && model !== "antigravity") {
    return "";
  }
  const has = (set: Set<string>) => tags.some((t) => set.has(t));
  const heavy = has(HEAVY_TAGS);
  const autonomous = has(AUTONOMOUS_TAGS);
  const research = has(RESEARCH_TAGS);

  // Fast-lane suppression: only when nothing heavy/autonomous/research.
  if (has(FAST_LANE_TAGS) && !heavy && !autonomous && !research) return "";

  // Priority: research → autonomous → heavy.
  if (research) {
    if (model === "claude")
      return "리서치형 티켓 — 적절하면 `/deep-research` 사용 (멀티소스+교차검증).";
    if (model === "antigravity")
      return "리서치형 티켓 — agy 리서치/분석 강점 활용.";
    return "리서치형 티켓 — 멀티소스 조사 후 종합.";
  }
  if (autonomous) {
    return "자율 다단계 티켓 — 검증 가능한 완료조건으로 `/goal <조건>` 사용 고려.";
  }
  if (heavy) {
    if (model === "claude")
      return "대규모 티켓 — 적절하면 `Workflow` fan-out 또는 `/goal` 사용.";
    if (model === "antigravity")
      return "대규모/대용량-컨텍스트 — agy 강점 활용 (복잡 리팩터/리뷰는 claude/gpt 우선).";
    return "대규모 티켓 — `/goal <검증가능 조건>` 자율 처리 고려.";
  }
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/capabilityHint.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/dispatch-scoring.ts v3/tests/unit/capabilityHint.test.ts
git commit -m "v3(harness): capabilityHintForTags — tag→specialty hint mapping"
```

---

### Task 2: Claude capability snippet

**Files:**

- Create: `v3/skills/capability_claude.md`

- [ ] **Step 1: Create the snippet file**

Create `v3/skills/capability_claude.md`:

```markdown
## 특기 도구 (Claude 전용)

너는 Claude Code 워커다. 아래 특기를 **티켓 상황에 맞을 때만** 쓴다. 작업 지시에
`[cap:hint:...]` 한 줄이 있으면 그 신호를 우선 참고한다.

### 언제 무엇을

- **대규모 리뷰/리팩터/마이그레이션/다파일 검증** → `Workflow` 도구로 내부 fan-out.
  프롬프트에 `ultracode`를 넣거나 "use a workflow"로 발동. fan-out 크기·깊이는 티켓
  규모에 맞춰 절제한다.
- **리서치형(조사/비교/근거수집)** → `/deep-research <질문>`.
- **검증 가능한 완료조건이 있는 자율 작업** → `/goal <조건>` (예: "test/auth 전부 통과").
- **단일 난제(아키텍처 결정/까다로운 디버깅)** → 프롬프트에 `ultrathink` 키워드.

### 쓰지 말 것

- 파일 1–2개 단순 수정, 보일러플레이트 등 fast-lane 작업엔 특기 금지(토큰 낭비).
- Workflow 안에서 또 Workflow 호출 금지(1단계만).

### 가용성 폴백

- `Workflow`·`/deep-research`는 유료플랜+research preview 필요. 도구가 없거나 에러면
  **일반 순차 처리로 그냥 진행한다. 티켓을 막지 마라.**

### 진행 마커 (필수 — 보드 가시화)

특기를 시작·종료할 때 마블로 MCP `add_activity`로 마커를 남긴다:

- 시작: `add_activity(task_id, "[cap:start:workflow] 사유 한 줄")`
  (종류: `workflow` | `deep-research` | `goal`)
- 종료: `add_activity(task_id, "[cap:end:workflow] 완료")`
  시작 마커를 남겼으면 반드시 종료 마커도 남긴다.
```

- [ ] **Step 2: Commit**

```bash
git add v3/skills/capability_claude.md
git commit -m "v3(skills): capability_claude snippet (Workflow/deep-research/goal)"
```

---

### Task 3: Codex(gpt) and Antigravity capability snippets

**Files:**

- Create: `v3/skills/capability_codex.md`
- Create: `v3/skills/capability_antigravity.md`

- [ ] **Step 1: Create `v3/skills/capability_codex.md`**

```markdown
## 특기 도구 (Codex 전용)

너는 Codex(gpt) 워커다. 아래 특기를 **티켓 상황에 맞을 때만** 쓴다. 작업 지시의
`[cap:hint:...]` 신호를 우선 참고한다.

### 언제 무엇을

- **검증 가능한 완료조건이 있는 자율 다단계 작업** → `/goal <목표>` 자율 모드.
- **대규모/다파일 변경** → `/goal`로 자율 처리하되 스코프를 절제한다.

### 쓰지 말 것

- fast-lane(단순 수정/보일러플레이트)엔 특기 금지.

### 진행 마커 (필수 — 보드 가시화)

- 시작: `add_activity(task_id, "[cap:start:goal] 사유 한 줄")`
- 종료: `add_activity(task_id, "[cap:end:goal] 완료")`
  시작을 남겼으면 종료도 반드시 남긴다.
```

- [ ] **Step 2: Create `v3/skills/capability_antigravity.md`**

```markdown
## 특기 (Antigravity / agy)

너는 agy(Gemini-3-Flash 백엔드) 워커다. 고유 슬래시 특기는 없고 **역할 강점**을 살린다.

### 강점 활용

- 리서치/분석/문서, 대용량-컨텍스트, 에이전틱 다단계 작업에 강하다(싸고 빠름).
- 복잡한 멀티스텝 리팩터/리뷰는 품질상 claude/gpt가 우선임을 인지하고, 네 강점
  영역에 집중한다.

### 진행 마커 (선택 — 리서치/대형 작업 시)

- 시작: `add_activity(task_id, "[cap:start:deep-research] 사유")` / 종료 `[cap:end:deep-research]`.
```

- [ ] **Step 3: Commit**

```bash
git add v3/skills/capability_codex.md v3/skills/capability_antigravity.md
git commit -m "v3(skills): capability snippets for codex(gpt) and antigravity"
```

---

### Task 4: Append capability snippet to worker prompt

**Files:**

- Modify: `v3/electron/agent-config.ts` — `getLaunchConfig` (~lines 423-461), after `skillContent` is read
- Test: `v3/tests/unit/capabilitySnippet.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `v3/tests/unit/capabilitySnippet.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { capabilitySnippetFile } from "../../electron/agent-config";

describe("capabilitySnippetFile", () => {
  it("maps models to snippet basenames", () => {
    expect(capabilitySnippetFile("claude")).toBe("capability_claude.md");
    expect(capabilitySnippetFile("gpt")).toBe("capability_codex.md");
    expect(capabilitySnippetFile("antigravity")).toBe(
      "capability_antigravity.md"
    );
  });

  it("returns null for models without a specialty snippet", () => {
    expect(capabilitySnippetFile("gemini")).toBeNull();
    expect(capabilitySnippetFile("local")).toBeNull();
    expect(capabilitySnippetFile("custom")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/capabilitySnippet.test.ts`
Expected: FAIL — `capabilitySnippetFile is not a function`.

- [ ] **Step 3: Implement `capabilitySnippetFile` + wire into `getLaunchConfig`**

In `v3/electron/agent-config.ts`, add a pure exported helper near the top (after `SKILLS_DIR` definition, ~line 100):

```typescript
/** Model → capability snippet basename (null when none). Codex id is "gpt". */
export function capabilitySnippetFile(model: ModelType): string | null {
  switch (model) {
    case "claude":
      return "capability_claude.md";
    case "gpt":
      return "capability_codex.md";
    case "antigravity":
      return "capability_antigravity.md";
    default:
      return null;
  }
}
```

Then in `getLaunchConfig`, right after `skillContent` is read (the
`const skillContent = skillPath && fs.existsSync(skillPath) ? fs.readFileSync(...) : "";`
block), append the model snippet:

```typescript
let fullSkillContent = skillContent;
const capFile = capabilitySnippetFile(agent.model);
if (capFile) {
  const capPath = path.join(SKILLS_DIR, capFile);
  if (fs.existsSync(capPath)) {
    const capContent = fs.readFileSync(capPath, "utf-8").trim();
    fullSkillContent = skillContent
      ? `${skillContent.trim()}\n\n${capContent}`
      : capContent;
  }
}
```

Then change the returned `skillContent: skillContent` to `skillContent: fullSkillContent`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/capabilitySnippet.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/agent-config.ts v3/tests/unit/capabilitySnippet.test.ts
git commit -m "v3(agent): append model capability snippet to worker prompt"
```

---

### Task 5: Inject per-ticket capability hint at dispatch

**Files:**

- Modify: `v3/electron/bridge-server.ts` — before `withCompletionFooter` (~line 739)

- [ ] **Step 1: Locate the dispatch instruction wrap**

Open `v3/electron/bridge-server.ts` ~line 739. Current:

```typescript
const effectiveInstruction = withCompletionFooter(instruction, params.taskId);
```

Confirm `params` carries the resolved model and tags (search upward for `params.model` and the tags source — the dispatched task's `scope`/tags). If the model var is named differently (e.g. `selectedModel`), use that.

- [ ] **Step 2: Inject the hint**

Add the import at the top of `bridge-server.ts` (with other `./dispatch-scoring` imports if present, else add):

```typescript
import { capabilityHintForTags } from "./dispatch-scoring";
```

Replace the wrap with:

```typescript
const capHint = capabilityHintForTags(params.tags ?? [], params.model);
const instructionWithHint = capHint
  ? `${instruction}\n\n[cap:hint:${capHint}]`
  : instruction;
const effectiveInstruction = withCompletionFooter(
  instructionWithHint,
  params.taskId
);
```

If `params.tags`/`params.model` are not on `params`, thread them from the dispatch call site (the dispatcher computes tags for scoring already — pass them through). Keep the change minimal: only add the two fields if missing.

- [ ] **Step 3: Typecheck**

Run: `cd v3 && npx tsc -p electron/tsconfig.json --noEmit`
Expected: exit 0 (no new errors).

- [ ] **Step 4: Commit**

```bash
git add v3/electron/bridge-server.ts
git commit -m "v3(dispatch): inject per-ticket capability hint into worker instruction"
```

---

### Task 6: Orchestrator rule for capability hints

**Files:**

- Modify: `v3/skills/orchestrator_agent.md` — add one rule near the dispatch rules (after the "1. dispatch_task 우선" section)

- [ ] **Step 1: Add the rule**

Insert this subsection after the smart-dispatch rule block:

```markdown
### 1.5 특기 힌트 (Capability Hints)

heavy / research / autonomous 태그 티켓을 디스패치할 때, 마블로가 워커 지시에
`[cap:hint:...]` 한 줄을 자동으로 얹는다(모델별 특기 안내). 너는:

- 산문으로 "워크플로우 써라" 식으로 도구 호출을 **강제하지 않는다** — 힌트만 신뢰한다.
- fast-lane(단순 수정) 티켓엔 힌트가 붙지 않는다(정상).
- 워커가 특기를 쓰면 보드 카드에 진행 마커가 뜬다(`[cap:start/end:*]` 활동 기반).
```

- [ ] **Step 2: Commit**

```bash
git add v3/skills/orchestrator_agent.md
git commit -m "v3(orch): document capability-hint behavior in orchestrator skill"
```

**Part A complete — capability hints ship independently here.**

---

## Part B — C-lite Specialty Progress Marker

### Task 7: Add `activeCapability` to Task and TaskProjection types

**Files:**

- Modify: `v3/src/types/task.ts` — `Task` interface (after `comment: string;`, ~line 17)
- Modify: `v3/electron/mcp-server/projection.ts` — `TaskProjection` interface (~line 34-41)

- [ ] **Step 1: Extend `Task`**

In `v3/src/types/task.ts`, add after `comment: string;`:

```typescript
  /** Set while the owning agent runs a specialty; null/undefined otherwise. */
  activeCapability?: "workflow" | "deep-research" | "goal" | null;
```

- [ ] **Step 2: Extend `TaskProjection`**

In `v3/electron/mcp-server/projection.ts`, add after `lastActivitySummary: string;`:

```typescript
  activeCapability?: "workflow" | "deep-research" | "goal" | null;
```

- [ ] **Step 3: Typecheck**

Run: `cd v3 && npx tsc -p electron/tsconfig.json --noEmit && npx tsc --noEmit`
Expected: exit 0 (the `monaco-editor` error in CodeEditor.tsx is pre-existing; ignore it).

- [ ] **Step 4: Commit**

```bash
git add v3/src/types/task.ts v3/electron/mcp-server/projection.ts
git commit -m "v3(types): add Task.activeCapability + projection field"
```

---

### Task 8: `parseActiveCapability` pure helper

**Files:**

- Modify: `v3/electron/mcp-server/projection.ts` — add export
- Test: `v3/tests/unit/activeCapability.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `v3/tests/unit/activeCapability.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseActiveCapability } from "../../electron/mcp-server/projection";

describe("parseActiveCapability", () => {
  it("returns null when no markers", () => {
    expect(parseActiveCapability(["working on it", "done step 1"])).toBeNull();
  });

  it("returns the capability for an open start marker", () => {
    expect(parseActiveCapability(["[cap:start:workflow] big review"])).toBe(
      "workflow"
    );
  });

  it("returns null after a matching end marker", () => {
    expect(
      parseActiveCapability([
        "[cap:start:deep-research] q",
        "[cap:end:deep-research] done",
      ])
    ).toBeNull();
  });

  it("uses the most recent open start when multiple", () => {
    expect(
      parseActiveCapability([
        "[cap:start:workflow] a",
        "[cap:end:workflow] a done",
        "[cap:start:goal] b",
      ])
    ).toBe("goal");
  });

  it("ignores unknown capability names", () => {
    expect(parseActiveCapability(["[cap:start:bogus] x"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/activeCapability.test.ts`
Expected: FAIL — `parseActiveCapability is not a function`.

- [ ] **Step 3: Implement**

In `v3/electron/mcp-server/projection.ts`, add as an exported pure function:

```typescript
const KNOWN_CAPS = new Set(["workflow", "deep-research", "goal"]);
type ActiveCap = "workflow" | "deep-research" | "goal" | null;

/**
 * Derive the active specialty from an ordered (oldest→newest) list of
 * activity messages. Latest [cap:start:X] without a later [cap:end:X] wins.
 * Pure.
 */
export function parseActiveCapability(messages: string[]): ActiveCap {
  let active: ActiveCap = null;
  for (const msg of messages) {
    const start = msg.match(/\[cap:start:([\w-]+)\]/);
    if (start && KNOWN_CAPS.has(start[1])) {
      active = start[1] as ActiveCap;
      continue;
    }
    const end = msg.match(/\[cap:end:([\w-]+)\]/);
    if (end && end[1] === active) {
      active = null;
    }
  }
  return active;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/activeCapability.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/mcp-server/projection.ts v3/tests/unit/activeCapability.test.ts
git commit -m "v3(projection): parseActiveCapability from cap:start/end markers"
```

---

### Task 9: Wire `activeCapability` into projection computation

**Files:**

- Modify: `v3/electron/mcp-server/projection.ts` — `computeTaskProjection` (~lines 65-100)

- [ ] **Step 1: Read the current `computeTaskProjection` signature and body**

Confirm how it receives the activity message(s) for a mutation and whether it has access to prior projection (`prev`). It computes `lastActivitySummary` from the activity, so the message text is available.

- [ ] **Step 2: Set `activeCapability` in the computed projection**

Inside `computeTaskProjection`, after `nextStatus` is determined and before building the returned `next`, derive the marker from the new activity message plus prior state. Use the single new message and the prior value (incremental):

```typescript
// Carry/clear the specialty marker. A new [cap:start:X] sets it; a matching
// [cap:end:X] or a terminal status clears it.
let activeCapability = prev?.activeCapability ?? null;
const msg = summary ?? "";
const start = msg.match(/\[cap:start:([\w-]+)\]/);
const end = msg.match(/\[cap:end:([\w-]+)\]/);
if (start && KNOWN_CAPS.has(start[1])) {
  activeCapability = start[1] as typeof activeCapability;
} else if (end && end[1] === activeCapability) {
  activeCapability = null;
}
if (
  nextStatus === "DONE" ||
  nextStatus === "REVIEW" ||
  nextStatus === "FAILED"
) {
  activeCapability = null; // stale-guard on terminal status
}
```

Then add `activeCapability,` to the returned `next: TaskProjection` object.

(If `computeTaskProjection` receives the full ordered activity list rather than a single message, call `parseActiveCapability(messages)` instead, then apply the terminal-status clear.)

- [ ] **Step 3: Add a projection test for the terminal-status clear**

Append to `v3/tests/unit/activeCapability.test.ts`:

```typescript
import { computeTaskProjection } from "../../electron/mcp-server/projection";

describe("computeTaskProjection — activeCapability", () => {
  // NOTE: match computeTaskProjection's real signature from Task 9 Step 1.
  it("clears activeCapability when status becomes terminal", () => {
    // Arrange a prior projection with an open workflow marker, then a
    // mutation that moves the task to REVIEW. Expect activeCapability null.
    // (Fill args per the verified signature.)
  });
});
```

Replace the placeholder body with concrete args once the signature is confirmed in Step 1, then run:

Run: `cd v3 && npx vitest run tests/unit/activeCapability.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add v3/electron/mcp-server/projection.ts v3/tests/unit/activeCapability.test.ts
git commit -m "v3(projection): compute activeCapability + clear on terminal status"
```

---

### Task 10: Surface `activeCapability` on the frontend Task

**Files:**

- Modify: `v3/src/services/taskService.ts` (or wherever projection → Task mapping happens)
- Modify: `v3/src/stores/taskStore.ts` if it maps raw docs to `Task`

- [ ] **Step 1: Find the projection→Task mapping**

Search for where `TaskProjection` (or the Firestore task doc) is mapped into the renderer `Task`:

Run: `cd v3 && grep -rn "currentStatus\|activeCapability\|lastActivitySummary\|projection" src/services src/stores | head`

- [ ] **Step 2: Carry the field through**

In the mapping that builds a `Task`, copy the projection's `activeCapability` onto the `Task` (default `null`):

```typescript
activeCapability: projection?.activeCapability ?? null,
```

If tasks are read directly from a Firestore doc that already merges the projection, ensure the field name matches and is passed through (no transform needed).

- [ ] **Step 3: Typecheck**

Run: `cd v3 && npx tsc --noEmit`
Expected: no new errors (pre-existing `monaco-editor` error excepted).

- [ ] **Step 4: Commit**

```bash
git add v3/src/services/taskService.ts v3/src/stores/taskStore.ts
git commit -m "v3(store): pass activeCapability through to renderer Task"
```

---

### Task 11: TaskCard specialty badge

**Files:**

- Modify: `v3/src/components/board/TaskCard.tsx` — add label map (~line 55) + badge (~after line 252)

- [ ] **Step 1: Add the label map**

In `v3/src/components/board/TaskCard.tsx`, near `ROLE_COLORS` (~line 55), add:

```typescript
const CAPABILITY_LABELS: Record<string, string> = {
  workflow: "⏳ Workflow",
  "deep-research": "🔬 딥리서치",
  goal: "🎯 Goal",
};
```

- [ ] **Step 2: Render the badge**

Inside the badge flex container, after the `{task.flowId && (...)}` block, add:

```tsx
{
  task.activeCapability && CAPABILITY_LABELS[task.activeCapability] && (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-300 animate-pulse">
      {CAPABILITY_LABELS[task.activeCapability]} 진행중
    </span>
  );
}
```

- [ ] **Step 3: Verify in the app**

Run: `cd v3 && npm run dev` (or use the project's run flow). Manually: dispatch a heavy ticket to a Claude agent that emits a `[cap:start:workflow]` activity; confirm the purple "⏳ Workflow 진행중" badge appears on the card and clears after `[cap:end:workflow]` or terminal status.

- [ ] **Step 4: Commit**

```bash
git add v3/src/components/board/TaskCard.tsx
git commit -m "v3(board): specialty progress badge on TaskCard"
```

---

## Self-Review Checklist (completed by author)

- **Spec coverage:** §3.1 snippets → Tasks 2,3 + append Task 4; §3.2 hint → Tasks 1,5 + orchestrator Task 6; §3.3 guards/logging → folded into snippets (fallback, markers, fast-lane via Task 1); §3.4 C-lite marker → Tasks 7–11. Cost: no code (rollup reused) — no task needed, per spec.
- **Placeholders:** Task 9 Step 3 intentionally defers concrete test args to the verified `computeTaskProjection` signature (Step 1) — this is a signature-discovery dependency, not a content gap; the helper itself is fully tested in Task 8. Task 5/10 include a "find the exact call site" step because the anchor offered two candidates.
- **Type consistency:** `activeCapability` union identical in `Task`, `TaskProjection`, `parseActiveCapability`, `CAPABILITY_LABELS`. `capabilitySnippetFile` returns `capability_codex.md` for model `gpt` (Codex==gpt) consistently with Tasks 3/4.

## Notes for the executor

- Run the full suite after each part: `cd v3 && npx vitest run` (expect the pre-existing `dynamic-spawn.test.ts` file-level failure — it calls `process.exit`; unrelated).
- Part A and Part B are independent; either can be committed/shipped without the other.
- TaskForce ticket: `6fa87f96-ae12-492d-b692-adda2ded1fbc` (marblo-v3).
