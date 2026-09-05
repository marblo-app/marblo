/**
 * Renderer-side policy for the "main process is running older code" notice
 * (ticket 4HMJGUJBo0tKPU4mgHyr).
 *
 * The verdict itself is decided in the main process — only it knows which
 * `dist-electron` generation it loaded — and arrives here as a plain
 * `MainBuildReport` over IPC. This module holds the two things the RENDERER
 * decides: whether that report is trustworthy enough to act on, and whether it
 * earns screen space.
 *
 * Both are pure so they can be pinned by unit tests without rendering anything,
 * which matters more than usual here: the failure mode this feature guards
 * against is a warning that shows up when nothing is wrong, and a banner nobody
 * believes is worse than no banner at all.
 */
import type {
  MainBuildReport,
  MainBuildReason,
  MainBuildVerdict,
} from "../../electron/main-build-freshness";

export type {
  MainBuildReport,
  MainBuildReason,
  MainBuildVerdict,
} from "../../electron/main-build-freshness";

const VERDICTS: readonly MainBuildVerdict[] = ["fresh", "stale", "unknown"];
const REASONS: readonly MainBuildReason[] = [
  "no-boot-snapshot",
  "no-disk-snapshot",
  "empty-scan",
  "build-in-flight",
  "identical",
  "content-changed",
];

function asFiniteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Validate a payload that crossed the preload boundary.
 *
 * Preload hands through whatever the main process sent; a renderer that trusts
 * the shape blindly would throw inside a render when an older main process
 * (the exact situation this feature exists for!) replies with a payload that
 * predates a field. Returns null for anything that is not a well-formed report,
 * and the caller then shows nothing — silence is the safe direction.
 */
export function parseMainBuildReport(raw: unknown): MainBuildReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const verdict = r.verdict;
  const reason = r.reason;
  if (!VERDICTS.includes(verdict as MainBuildVerdict)) return null;
  if (!REASONS.includes(reason as MainBuildReason)) return null;

  const modules = Array.isArray(r.changedModules)
    ? r.changedModules.filter((m): m is string => typeof m === "string")
    : [];
  const changedCount =
    typeof r.changedCount === "number" && Number.isFinite(r.changedCount)
      ? Math.max(0, Math.trunc(r.changedCount))
      : modules.length;

  return {
    verdict: verdict as MainBuildVerdict,
    reason: reason as MainBuildReason,
    changedModules: modules,
    // A truncated list must never claim to be longer than the count it came
    // with, nor shorter than what we actually hold.
    changedCount: Math.max(changedCount, modules.length),
    bootBuiltAtMs: asFiniteOrNull(r.bootBuiltAtMs),
    diskBuiltAtMs: asFiniteOrNull(r.diskBuiltAtMs),
  };
}

/**
 * Should the notice be on screen?
 *
 * Only `stale` shows. `fresh` and — deliberately — `unknown` stay silent:
 * "cannot tell" is not evidence of a problem, and a banner that appears while
 * a build is mid-write would fire on nearly every keystroke-triggered
 * `tsc --watch` cycle.
 *
 * `dismissed` is sticky for the life of the app run rather than for a few
 * minutes, because the condition is monotone — the main process cannot become
 * current again without the restart the banner is asking for. Re-raising it
 * would deliver no new information, only fatigue.
 */
export function shouldShowStaleBuildBanner(input: {
  report: MainBuildReport | null;
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  return input.report?.verdict === "stale";
}

export interface ChangedModuleSummary {
  /** Module paths to name outright. */
  names: string[];
  /** How many more changed than `names` lists; 0 when the list is complete. */
  overflowCount: number;
}

/**
 * What to print after "not yet applied:".
 *
 * Naming the modules is what turns "restart the app" from a ritual into a
 * diagnosis — on 2026-09-05 the answer people needed was literally
 * "local-models.js", "bridge-server.js". The count carries the rest so the line
 * cannot grow into a build log.
 */
export function summarizeChangedModules(
  report: MainBuildReport | null,
): ChangedModuleSummary {
  if (!report) return { names: [], overflowCount: 0 };
  const names = report.changedModules;
  return {
    names,
    overflowCount: Math.max(0, report.changedCount - names.length),
  };
}
