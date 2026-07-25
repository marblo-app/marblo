import { create } from "zustand";

export type OrchestratorStatus = "stopped" | "starting" | "running" | "error";
/**
 * 오케스트레이터를 띄울 모델 선택지.
 *
 * 값 포맷은 `provider[:modelId][@effort]` 다.
 *   "claude"                     — Claude CLI 기본 모델(종전 값. 바이트 동일)
 *   "claude:claude-fable-5"      — Claude CLI 를 이 구체 모델로 핀
 *   "codex"                      — Codex CLI 기본 모델(종전 값. 바이트 동일)
 *   "codex:gpt-5.6-terra"        — Codex CLI 를 이 구체 모델로 핀(effort=CLI 기본)
 *   "codex:gpt-5.6-terra@high"   — 모델 + reasoning effort 까지 지정
 * 접미가 없는 값은 종전과 완전히 같은 의미라 앱상태에 저장된 기존 값
 * ("claude"/"codex")이 그대로 유효하다(재시작 연속성 하위호환).
 *
 * ★이 배열은 **모델 축만** 담는다. effort 는 모델마다 지원 목록이 달라서 곱집합으로
 * 펼치면(6모델 × 4effort) 아무도 못 고르는 드롭다운이 되므로, 각 칸이 자기가 허용
 * 하는 effort 를 `efforts` 로 들고 있고 UI 가 둘째 드롭다운을 따로 그린다. 저장·전달
 * 되는 값은 두 축을 합친 compound 문자열 하나뿐이다(필드가 하나라 재시작 연속성
 * 경로가 갈라지지 않는다).
 *
 * ★단일소스 규율 — 이 목록의 변형들은 `electron/model-registry.ts` 에서 파생돼야
 * 하는 값이다. 그런데 이 repo 는 `src/` 와 `electron/` 사이에 import 를 두지 않는다
 * (`src/lib/rootPathScope.ts` 에 명문화된 경계). 그래서 여기는 미러이고,
 * **벌어지면 테스트가 깨진다** — `tests/unit/orchestrator-model-options.test.ts` 가
 * 이 배열을 `claudeOrchestratorChoices()`/`codexOrchestratorChoices()`(레지스트리
 * 파생)와 원소단위로 대조한다. 모델을 추가하려면 레지스트리에 행을 넣고 그 테스트가
 * 시키는 대로 여기 반영하면 된다 — 두 곳이 조용히 어긋나는 경로는 없다.
 *
 * ★effort 목록에 max/ultra 가 없는 것은 누락이 아니다. 그 두 칸은 #602 승인게이트
 * 대상이고, 오케 선택은 프로젝트별로 영구 저장돼 재시작마다 되살아나므로 "1회용
 * 승인" 과 수명이 맞지 않는다. 근거는 `model-selection.selectableEfforts` 주석.
 */
export const ORCHESTRATOR_MODEL_OPTIONS = [
  // Claude — 능력등급 높음 → 낮음(레지스트리 modelsByProvider 역순).
  // claude 는 effort 축이 아예 없다(레지스트리 `efforts: []`).
  { value: "claude", label: "Claude", efforts: [] },
  { value: "claude:claude-fable-5", label: "Claude (Fable 5)", efforts: [] },
  { value: "claude:claude-opus-5", label: "Claude (Opus 5)", efforts: [] },
  { value: "claude:claude-opus-4-8", label: "Claude (Opus 4.8)", efforts: [] },
  { value: "claude:claude-sonnet-5", label: "Claude (Sonnet 5)", efforts: [] },
  {
    value: "claude:claude-haiku-4-5-20251001",
    label: "Claude (Haiku 4.5)",
    efforts: [],
  },
  // Codex(GPT) — 같은 규칙. 라벨은 레지스트리 실명 그대로다("gpt-5.6-sol").
  { value: "codex", label: "Codex", efforts: [] },
  {
    value: "codex:gpt-5.6-sol",
    label: "Codex (gpt-5.6-sol)",
    efforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "codex:gpt-5.6-terra",
    label: "Codex (gpt-5.6-terra)",
    efforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "codex:gpt-5.5",
    label: "Codex (gpt-5.5)",
    efforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "codex:gpt-5.6-luna",
    label: "Codex (gpt-5.6-luna)",
    efforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "codex:gpt-5.4",
    label: "Codex (gpt-5.4)",
    efforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "codex:gpt-5.4-mini",
    label: "Codex (gpt-5.4-mini)",
    efforts: ["low", "medium", "high", "xhigh"],
  },
] as const;

/** 모델 축의 값(effort 접미 없음). 셀렉터 첫째 드롭다운이 다루는 값. */
export type OrchestratorModelBase =
  (typeof ORCHESTRATOR_MODEL_OPTIONS)[number]["value"];

/** effort 축을 가진 칸의 값. 오늘은 codex 변형뿐이다(claude 엔 effort 가 없다). */
type EffortCapableBase = Extract<OrchestratorModelBase, `codex:${string}`>;

/** 셀렉터에서 고를 수 있는 effort. 승인게이트 칸(max/ultra)은 여기 없다. */
export type OrchestratorEffort = "low" | "medium" | "high" | "xhigh";

/**
 * 저장·IPC 로 오가는 값. 모델 축 단독이거나, 거기에 effort 를 얹은 compound 다.
 * 타입 수준에서 `claude:...@high` 같은 무효 조합이 애초에 만들어지지 않는다.
 */
export type OrchestratorModel =
  | OrchestratorModelBase
  | `${EffortCapableBase}@${OrchestratorEffort}`;

/** 이 값이 허용하는 effort 목록(빈 배열 = effort 드롭다운을 그리지 않는다). */
export function orchestratorEffortsFor(
  model: string,
): readonly OrchestratorEffort[] {
  const base = orchestratorModelBase(model);
  const option = ORCHESTRATOR_MODEL_OPTIONS.find((o) => o.value === base);
  return (option?.efforts ?? []) as readonly OrchestratorEffort[];
}

export function isOrchestratorModel(
  model: unknown,
): model is OrchestratorModel {
  if (typeof model !== "string" || !model) return false;
  const base = orchestratorModelBase(model);
  if (!ORCHESTRATOR_MODEL_OPTIONS.some((option) => option.value === base)) {
    return false;
  }
  const effort = orchestratorModelEffort(model);
  if (!effort) return true;
  return orchestratorEffortsFor(base).includes(effort as OrchestratorEffort);
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
  const base = orchestratorModelBase(model);
  const sep = base.indexOf(":");
  return sep < 0 ? base : base.slice(0, sep);
}

/** effort 접미를 떼어낸 모델 축 값("codex:gpt-5.5@high" → "codex:gpt-5.5"). */
export function orchestratorModelBase(model: string): string {
  const at = (model ?? "").lastIndexOf("@");
  return at > 0 ? model.slice(0, at) : (model ?? "");
}

/** effort 접미만("codex:gpt-5.5@high" → "high"). 없으면 빈 문자열. */
export function orchestratorModelEffort(model: string): string {
  const at = (model ?? "").lastIndexOf("@");
  return at > 0 ? model.slice(at + 1) : "";
}

/**
 * 두 축의 선택을 하나의 저장값으로 합친다. effort 가 비었거나 이 모델이 허용하지
 * 않는 값이면 **모델 축만** 남긴다 — 무효 compound 가 저장돼 다음 재시작에서
 * 조용히 버려지는 것보다, 애초에 만들지 않는 편이 낫다.
 */
export function withOrchestratorEffort(
  model: string,
  effort: string,
): OrchestratorModel {
  const base = orchestratorModelBase(model);
  const allowed = orchestratorEffortsFor(base);
  if (!effort || !allowed.includes(effort as OrchestratorEffort)) {
    return base as OrchestratorModel;
  }
  return `${base}@${effort}` as OrchestratorModel;
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
