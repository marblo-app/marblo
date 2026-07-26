import type { ModelType, AgentStatus } from "../../../types/agent";

export type VendorKind = ModelType | "internal";

export interface VendorVisual {
  monogram: string;
  label: string;
  stripeColor: string;
}

export const VENDOR_VISUALS: Record<VendorKind, VendorVisual> = {
  claude: { monogram: "C", label: "Claude", stripeColor: "#cc785c" },
  gemini: { monogram: "G", label: "Gemini", stripeColor: "#4285f4" },
  gpt: { monogram: "Cx", label: "Codex", stripeColor: "#10a37f" },
  antigravity: { monogram: "Ag", label: "Antigravity", stripeColor: "#f97316" },
  local: { monogram: "L", label: "Local", stripeColor: "#737373" },
  custom: { monogram: "X", label: "Custom", stripeColor: "#94a3b8" },
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
