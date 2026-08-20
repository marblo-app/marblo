import { create } from "zustand";
import type { OrchestratorLaunchBlock } from "../lib/orchestratorLaunchBlock";

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
 *   "grok:grok-4.6"              — Grok Build CLI 를 이 구체 모델로 핀(`-m`)
 *   "grok" / "antigravity"       — 그 CLI 기본 모델(아래 참조)
 * 접미가 없는 값은 종전과 완전히 같은 의미라 앱상태에 저장된 기존 값
 * ("claude"/"codex")이 그대로 유효하다(재시작 연속성 하위호환).
 *
 * ★모델 접미 없는 칸(=하네스 칸)의 목록은 우리 취향이 아니라 메인 프로세스의
 * `model-selection.ORCHESTRATOR_HARNESS_SETTINGS` 가 정하는 사실이다. 그 목록에
 * 없는 값을 셀렉터가 세우면 `normalizeOrchestratorModelSetting` 이 저장 직전에
 * claude 로 강등해서 "골랐는데 안 먹는" 칸이 되고, 반대로 목록에 있는데 셀렉터가
 * 안 세우면 **env 로만 닿는 기능**이 된다 — grok 오케(#638/#639)가 백엔드에선
 * 완전 동작하는데 UI 엔 claude/codex 뿐이라 아무도 못 고르던 상태가 그것이다.
 * 그래서 하네스 칸은 그 배열과 **원소·순서까지** 같아야 하고,
 * `tests/unit/orchestrator-model-options.test.ts` 가 그것을 못박는다.
 *
 * ★antigravity 는 모델 접미 칸을 세우지 않는다. 그 하네스는 launch 옵션에 모델
 * 핀 축이 없어서(`orchestratorLaunchPin` 이 그 축을 만들지 않는다) 접미를 세워봐야
 * 저장값에만 남고 CLI 엔 안 붙는다 — `normalizeOrchestratorModelSetting` 이 그
 * 접미를 버린다. 레지스트리에 antigravity 행 자체가 아직 없기도 하다.
 *
 * ★grok 은 2026-08-20 에 접미 칸이 열렸다. 열 수 있었던 근거는 취향이 아니라 배선
 * 이다: `orchestratorLaunchPin` 의 grok 분기(`nativeModel`)와 main.ts 오케 launch
 * 두 자리의 `nativeModelOverride` 가 이미 살아 있었고, 막고 있던 것은
 * `normalizeOrchestratorModelSetting` 안의 **낡은 가드** 하나뿐이었다(그 가드의
 * 근거 주석은 grok 분기가 들어온 날부터 사실이 아니었다).
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
  { value: "claude", label: "Claude (CLI default)", efforts: [] },
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
  { value: "codex", label: "Codex (CLI default)", efforts: [] },
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
  // Grok Build(xAI 네이티브 하네스). 라벨은 codex 와 같은 규칙으로 레지스트리
  // 실명 그대로다 — xAI 는 4.5/4.6 처럼 소수점 세대를 촘촘히 올려서, 예쁘게 접으면
  // 화면과 argv 가 어긋나도 눈에 안 띈다.
  { value: "grok", label: "Grok (CLI default)", efforts: [] },
  { value: "grok:grok-4.6", label: "Grok (grok-4.6)", efforts: [] },
  { value: "grok:grok-4.5", label: "Grok (grok-4.5)", efforts: [] },
  // Antigravity(agy). 자기 계정으로 자기 CLI 가 뜨므로 오케 후보다
  // (ORCHESTRATOR_HARNESS_SETTINGS). 모델 핀 축은 아직 없다.
  { value: "antigravity", label: "Antigravity (CLI default)", efforts: [] },
] as const;

/**
 * 모델 접미가 없는 칸들 = **하네스 축**(claude/codex/grok/antigravity).
 *
 * ★네 칸의 라벨 원칙(2026-08-20, 티켓 6AsbulPe) — "(CLI default)".
 *
 * 사장님 지적은 "맨 위 그냥 Claude 는 아래 Claude (Opus 5) 들과 뭐가 다른지
 * 화면만 봐선 모르겠다" 였다. 맞는 지적인데, **제거는 답이 아니다**: 이 칸들은
 * 아래 핀 칸들의 중복이 아니라 서로 다른 축이다.
 *
 *   핀 칸  — "이 CLI 를 **이 모델로 못박아** 띄운다"(argv 에 --model/-c model/-m).
 *   맨몸 칸 — "이 CLI 를 **핀 없이** 띄운다"(argv 무변경 = 그 CLI 의 기본 모델).
 *
 * 그리고 맨몸 칸은 이 배열 밖에서도 일을 한다: `ORCHESTRATOR_HARNESS_OPTIONS` 가
 * 설정 화면의 "실행 모델" 셀렉터 전체이고, `ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY`
 * (Claude > Codex > Grok)와 `ORCHESTRATOR_HARNESS_SETTINGS` 가 같은 값을 쓴다.
 * 지우면 그 축이 통째로 무너진다. 저장된 기존 값 "claude"/"codex" 의 재시작
 * 연속성도 이 칸이 진다.
 *
 * 그래서 목적("무엇이 골라지는지 모르는 칸을 없앤다")은 **라벨**로 달성한다.
 * `"Claude"` → `"Claude (CLI default)"`. 값이 아니라 **규칙**을 적는 이유는,
 * claude/codex CLI 의 기본 모델은 우리가 측정하지 않는 이동표적이라 구체 모델명을
 * 적으면 그게 다음 주에 거짓말이 되기 때문이다. 규칙은 안 낡는다.
 *
 * ★네 칸에 **같은 규칙**을 적용한다. Claude 만 고치면 codex/grok/antigravity 가
 * 똑같이 모호한 채로 남고, 다음 사람이 같은 질문을 다시 한다.
 *
 * 설정 화면의 "실행 모델"(전역 기본 오케 CLI)은 이 축만 다룬다 — 구체 모델 핀은
 * 프로젝트별인 오케 패널 셀렉터의 몫이다. 파생으로 두는 이유는 하나: 종전엔
 * `SettingsPage.ORCHESTRATOR_MODELS` 에 claude/codex 두 칸이 **따로 하드코딩**돼
 * 있어서, 여기 목록이 늘어도 설정 화면은 조용히 옛 두 칸에 머물렀다.
 *
 * ★자동 기본 우선순위(미설정 시): Claude > Codex > Grok. 메인 프로세스
 * `model-selection.ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY` 와 같은 순서다
 * (mwYD1YxEc9aARgmZ4bX7). 사용자가 여기서 고른 값은 그 자동선택을 이긴다.
 */
export const ORCHESTRATOR_HARNESS_OPTIONS = ORCHESTRATOR_MODEL_OPTIONS.filter(
  (option) => !option.value.includes(":"),
);

/** 미설정 시 자동 기본 오케 우선순위(네이티브만). env-swap 벤더 제외. */
export const ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY = [
  "claude",
  "codex",
  "grok",
] as const;

/**
 * 하네스 한 줄 설명(설정 화면 전용).
 *
 * ★목록이 아니라 **덧붙임**이다 — 여기 없는 하네스도 셀렉터엔 그대로 서고 설명만
 * 비어 보인다. 반대로 두면(설명 표가 목록을 정하면) 새 하네스가 문구를 기다리다
 * 조용히 사라진다. 이번 티켓이 고치는 실패모드가 정확히 그 모양이다.
 */
export const ORCHESTRATOR_HARNESS_DESC: Readonly<Record<string, string>> = {
  claude:
    "Highest quality; uses Claude weekly limits. Default. No --model pin — runs whatever the Claude CLI defaults to.",
  codex:
    "Good for saving Claude quota; uses OpenAI/Codex limits. No model pin — runs whatever the Codex CLI defaults to.",
  grok: "xAI Grok Build CLI. Needs the project folder trusted so Marblo MCP attaches. Unpinned runs grok-4.6 (the CLI default).",
  antigravity:
    "Google Antigravity (agy) CLI; uses your Google account. No model pin available yet.",
};

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
  /**
   * 스폰이 막힌 이유 중 **위저드로 못 푸는 것**(오늘은 grok MCP 게이트).
   * 인증 차단은 종전대로 CLI 설정 위저드가 받아가므로 여기 안 온다.
   */
  launchBlock: OrchestratorLaunchBlock | null;

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
  setLaunchBlock: (block: OrchestratorLaunchBlock | null) => void;
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
  launchBlock: null,

  setSession: (sessionId, ptySessionId, model) =>
    set((state) => ({
      sessionId,
      ptySessionId,
      status: "starting",
      runningModel: model ?? state.selectedModel,
      // 실제로 떴다 = 앞선 차단 안내는 이제 거짓이다.
      launchBlock: null,
    })),

  setStatus: (status) => set({ status }),

  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),

  // 모델을 갈아타면 앞 모델의 차단 안내는 유효하지 않다(grok 안내를 든 채로
  // claude 를 고르면 화면이 거짓말을 한다).
  setSelectedModel: (selectedModel) =>
    set({ selectedModel, launchBlock: null }),

  setSwitchStatus: (switchStatus) => set({ switchStatus }),

  setHandoffSummary: (lastHandoffSummary) => set({ lastHandoffSummary }),

  setLaunchBlock: (launchBlock) => set({ launchBlock }),

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
