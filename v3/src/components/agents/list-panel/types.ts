import type { ModelType, AgentStatus } from "../../../types/agent";

/** 하네스(=스폰 바이너리) 목록. `ModelType` 과 같은 집합을 배지 쪽에서 재사용. */
export const HARNESS_VENDOR_KINDS: readonly ModelType[] = [
  "claude",
  "gemini",
  "gpt",
  "grok",
  "antigravity",
  "local",
  "custom",
];

/**
 * 배지에 쓰는 벤더 종류. 하네스(claude/gemini/gpt/grok/antigravity/local/custom)에
 * **env-swap 벤더**(zai/minimax/deepseek/moonshot/upstage — 자기 CLI 없이
 * claude/gpt 하네스의 env 만 바꿔 붙는 백엔드, `electron/model-registry.ts` 의
 * `VendorEnvProfile` 참고)를 더한 것 + 셸 터미널용 "internal".
 *
 * 왜 하네스와 env-swap 벤더가 한 유니온에 섞이나: 이 배지는 "무엇을 스폰했는가"
 * 를 보여주는 자리라 두 축(하네스/프로바이더)이 이 자리를 두고 경쟁한다 —
 * env-swap 이 감지되면 프로바이더가 이기고, 아니면 하네스가 이긴다
 * (`resolveAgentVendorKind`, `lib/agentVendorBadge.ts`).
 */
export type VendorKind =
  | ModelType
  | "zai"
  | "minimax"
  | "deepseek"
  | "moonshot"
  | "upstage"
  | "internal";

export interface VendorVisual {
  monogram: string;
  label: string;
  stripeColor: string;
}

export const VENDOR_VISUALS: Record<VendorKind, VendorVisual> = {
  claude: { monogram: "C", label: "Claude", stripeColor: "#cc785c" },
  gemini: { monogram: "G", label: "Gemini", stripeColor: "#4285f4" },
  gpt: { monogram: "Cx", label: "Codex", stripeColor: "#10a37f" },
  grok: { monogram: "Gk", label: "Grok", stripeColor: "#06b6d4" },
  antigravity: { monogram: "Ag", label: "Antigravity", stripeColor: "#f97316" },
  local: { monogram: "L", label: "Local", stripeColor: "#737373" },
  custom: { monogram: "X", label: "Custom", stripeColor: "#94a3b8" },
  // env-swap 벤더 — claude/gpt 하네스를 그대로 쓰지만 실제 백엔드는 다르다.
  zai: { monogram: "Z", label: "GLM", stripeColor: "#8b5cf6" },
  minimax: { monogram: "Mm", label: "MiniMax", stripeColor: "#ec4899" },
  deepseek: { monogram: "Ds", label: "DeepSeek", stripeColor: "#3b82f6" },
  moonshot: { monogram: "Km", label: "Kimi", stripeColor: "#f59e0b" },
  upstage: { monogram: "Us", label: "Solar", stripeColor: "#14b8a6" },
  internal: { monogram: "Sh", label: "Terminal", stripeColor: "#64748b" },
};

export interface AgentRowData {
  id: string;
  vendor: VendorKind;
  /** 실제로 뜬 구체 모델(`model@effort`, 예: "claude-fable-5"). 벤더 모노그램
   * 만으로는 fable5 인지 5.6-sol 인지 구분이 안 돼서 이름 옆 배지로 노출한다.
   * 없으면(모델 핀 없는 스폰·구 doc) 배지를 그리지 않고 벤더 표시만 남긴다. */
  spawnedModel?: string;
  displayName: string;
  taskId: string | null;
  status: AgentStatus | "running";
  lastActivityLabel: string;
  isInputWaiting?: boolean;
  isAgent: boolean;
  ptySessionId?: string;
}

export const STATUS_PILL: Record<
  AgentRowData["status"],
  { label: string; color: string }
> = {
  idle: { label: "idle", color: "#6c7086" },
  working: { label: "running", color: "#a6e3a1" },
  running: { label: "running", color: "#a6e3a1" },
  error: { label: "error", color: "#f38ba8" },
  stopped: { label: "stopped", color: "#585b70" },
};
