import type { MissionStatus } from "./types";

// Mission status 전이 룰 — 명세 §7 state machine 그대로.
//   planning → active | abandoned
//   active → waiting_for_human | sleeping | completed | abandoned
//   waiting_for_human → active | abandoned
//   sleeping → active | abandoned
//   completed / abandoned → (terminal)
const TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  planning: ["active", "abandoned"],
  active: ["waiting_for_human", "sleeping", "completed", "abandoned"],
  waiting_for_human: ["active", "abandoned"],
  sleeping: ["active", "abandoned"],
  completed: [],
  abandoned: [],
};

export function isValidMissionTransition(
  from: MissionStatus,
  to: MissionStatus,
): boolean {
  if (from === to) return true; // idempotent no-op
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertMissionTransition(
  from: MissionStatus,
  to: MissionStatus,
): void {
  if (!isValidMissionTransition(from, to)) {
    const valid = TRANSITIONS[from]?.join(", ") ?? "(none)";
    throw new Error(
      `Invalid mission transition: ${from} → ${to}. Valid targets from ${from}: [${valid}]`,
    );
  }
}

export const TERMINAL_STATUSES: readonly MissionStatus[] = [
  "completed",
  "abandoned",
];

export function isTerminalMission(status: MissionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
