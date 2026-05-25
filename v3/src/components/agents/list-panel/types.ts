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
  custom: { monogram: "X", label: "Custom", stripeColor: "#94a3b8" },
  internal: { monogram: "Sh", label: "Terminal", stripeColor: "#64748b" },
};

export interface AgentRowData {
  id: string;
  vendor: VendorKind;
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
