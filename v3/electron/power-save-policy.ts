export const POWER_SAVE_MODES = ["off", "working", "remote"] as const;

export type PowerSaveMode = (typeof POWER_SAVE_MODES)[number];
export type WorkPowerSaveSource =
  | "orchestrator"
  | "agent"
  | "telegram-poller"
  | "slack-socket"
  | "remote-wait";

export function isPowerSaveMode(value: unknown): value is PowerSaveMode {
  return typeof value === "string" && POWER_SAVE_MODES.includes(value as PowerSaveMode);
}

/** Migrates the former boolean setting without changing its conservative default. */
export function normalizePowerSaveMode(
  value: unknown,
  legacyPreventSleepWhileWorking: unknown,
): PowerSaveMode {
  if (isPowerSaveMode(value)) return value;
  return legacyPreventSleepWhileWorking === false ? "off" : "working";
}

export function powerSaveSources(
  mode: PowerSaveMode,
  workSources: readonly Exclude<WorkPowerSaveSource, "remote-wait">[],
): WorkPowerSaveSource[] {
  if (mode === "off") return [];
  if (mode === "remote") return ["remote-wait", ...workSources];
  return [...workSources];
}
