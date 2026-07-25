import { create } from "zustand";

export type OrchestratorStatus = "stopped" | "starting" | "running" | "error";
/**
 * 오케스트레이터를 띄울 모델 선택지.
 *
 * 값 포맷은 `provider[:modelId]` 다.
 *   "claude"                     — Claude CLI 기본 모델(종전 값. 바이트 동일)
 *   "claude:claude-fable-5"      — Claude CLI 를 이 구체 모델로 핀
 *   "codex"                      — Codex CLI
 * 접미가 없는 값은 종전과 완전히 같은 의미라 앱상태에 저장된 기존 값
 * ("claude"/"codex")이 그대로 유효하다(재시작 연속성 하위호환).
 *
 * ★단일소스 규율 — 이 목록의 Claude 변형들은 `electron/model-registry.ts` 에서
 * 파생돼야 하는 값이다. 그런데 이 repo 는 `src/` 와 `electron/` 사이에 import 를
 * 두지 않는다(`src/lib/rootPathScope.ts` 에 명문화된 경계). 그래서 여기는 미러이고,
 * **벌어지면 테스트가 깨진다** — `tests/unit/orchestrator-model-options.test.ts` 가
 * 이 배열을 `claudeOrchestratorChoices()`(레지스트리 파생)와 원소단위로 대조한다.
 * 모델을 추가하려면 레지스트리에 행을 넣고 그 테스트가 시키는 대로 여기 반영하면
 * 된다 — 두 곳이 조용히 어긋나는 경로는 없다.
 */
export const ORCHESTRATOR_MODEL_OPTIONS = [
  // Claude — 능력등급 높음 → 낮음(레지스트리 modelsByProvider 역순).
  { value: "claude", label: "Claude" },
  { value: "claude:claude-fable-5", label: "Claude (Fable 5)" },
  { value: "claude:claude-opus-5", label: "Claude (Opus 5)" },
  { value: "claude:claude-opus-4-8", label: "Claude (Opus 4.8)" },
  { value: "claude:claude-sonnet-5", label: "Claude (Sonnet 5)" },
  { value: "claude:claude-haiku-4-5-20251001", label: "Claude (Haiku 4.5)" },
  // Codex(GPT). 모델 변형 선택은 아직 없다 — 값 포맷은 동일하게 확장 가능하다.
  { value: "codex", label: "Codex" },
] as const;

export type OrchestratorModel =
  (typeof ORCHESTRATOR_MODEL_OPTIONS)[number]["value"];

export function isOrchestratorModel(
  model: unknown,
): model is OrchestratorModel {
  return ORCHESTRATOR_MODEL_OPTIONS.some((option) => option.value === model);
}

/**
 * compound 값에서 프로바이더만 떼어낸다("claude:claude-fable-5" → "claude").
 *
 * 렌더러가 프로바이더 단위로만 비교해야 하는 자리(설정 화면의 현재 선택 표시,
 * "지금 도는 모델과 같은가" 판정)를 위해 있다. main 프로세스에도 같은 분해가
 * 있지만(`splitOrchestratorModelValue`), 이쪽은 모델 id 검증이 필요 없는 순수
 * 문자열 연산이라 경계를 넘지 않는다.
 */
export function orchestratorModelProvider(model: string): string {
  const sep = model.indexOf(":");
  return sep < 0 ? model : model.slice(0, sep);
}
export type OrchestratorSwitchStatus =
  | "idle"
  | "snapshotting"
  | "stopping"
  | "starting"
  | "error";

interface HandoffSummary {
  activeMissionCount: number;
  inFlightTaskCount: number;
  unresolvedDecisionCount: number;
}

interface OrchestratorState {
  sessionId: string | null;
  ptySessionId: string | null;
  status: OrchestratorStatus;
  isCollapsed: boolean;
  selectedModel: OrchestratorModel;
  runningModel: OrchestratorModel | null;
  switchStatus: OrchestratorSwitchStatus;
  lastHandoffSummary: HandoffSummary | null;

  setSession: (
    sessionId: string,
    ptySessionId: string,
    model?: OrchestratorModel,
  ) => void;
  setStatus: (status: OrchestratorStatus) => void;
  setCollapsed: (collapsed: boolean) => void;
  setSelectedModel: (model: OrchestratorModel) => void;
  setSwitchStatus: (status: OrchestratorSwitchStatus) => void;
  setHandoffSummary: (summary: HandoffSummary | null) => void;
  toggleCollapsed: () => void;
  clear: () => void;
}

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  sessionId: null,
  ptySessionId: null,
  status: "stopped",
  isCollapsed: true,
  selectedModel: "claude",
  runningModel: null,
  switchStatus: "idle",
  lastHandoffSummary: null,

  setSession: (sessionId, ptySessionId, model) =>
    set((state) => ({
      sessionId,
      ptySessionId,
      status: "starting",
      runningModel: model ?? state.selectedModel,
    })),

  setStatus: (status) => set({ status }),

  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),

  setSelectedModel: (selectedModel) => set({ selectedModel }),

  setSwitchStatus: (switchStatus) => set({ switchStatus }),

  setHandoffSummary: (lastHandoffSummary) => set({ lastHandoffSummary }),

  toggleCollapsed: () => set({ isCollapsed: !get().isCollapsed }),

  clear: () =>
    set({
      sessionId: null,
      ptySessionId: null,
      status: "stopped",
      runningModel: null,
      switchStatus: "idle",
    }),
}));
