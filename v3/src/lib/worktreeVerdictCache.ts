import type { Worktree, WorktreeStaleInfo } from "../types/worktree";

/**
 * Persistent cache of per-worktree hygiene verdicts (stale / merged), keyed by
 * worktree path and guarded by HEAD.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The verdicts come from the full `worktree:list` sweep — up to 7 git spawns
 * per worktree, measured 12–26s of disk-saturating subprocess storm at ~680
 * registered worktrees (ticket yJgz7s03 / HruNFJpj). The Code tab and FileTree
 * root selectors only need the verdicts to hide archived (merged/idle)
 * worktrees, so they must NOT pay for the sweep on every mount (ticket
 * HruNFJpj: entering the Code tab dragged the whole app). They refresh via the
 * light topology-only list instead — which carries no verdicts.
 *
 * This cache bridges the gap: whenever a full sweep does run (Worktrees tab,
 * merge/rebase/remove flows), its verdicts are persisted here; light refreshes
 * then reuse them for any worktree whose HEAD is unchanged, so the archived
 * filter keeps working across reloads without ever re-running the sweep.
 *
 * ── Staleness direction ──────────────────────────────────────────────────────
 * A verdict is only reused while the worktree's HEAD matches the one it was
 * computed at. `merged` can't regress for an unmoved HEAD, and idle time only
 * grows, so a cached verdict can only err by UNDER-archiving (a worktree that
 * has since crossed the idle threshold stays visible until the next full
 * sweep) — never by hiding an active worktree.
 */

export interface CachedVerdict {
  /** HEAD sha the verdict was computed at — reuse only while it matches. */
  head: string;
  stale: boolean;
  staleInfo?: WorktreeStaleInfo;
}

/** Keyed by absolute worktree path. */
export type VerdictCache = Record<string, CachedVerdict>;

const STORAGE_KEY = "marblo.worktree.verdicts.v1";

/** Load the persisted cache. Safe in non-browser (test/SSR) contexts. */
export function loadVerdictCache(): VerdictCache {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: VerdictCache = {};
    for (const [path, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!value || typeof value !== "object") continue;
      const v = value as Partial<CachedVerdict>;
      if (typeof v.head !== "string" || typeof v.stale !== "boolean") continue;
      out[path] = { head: v.head, stale: v.stale, staleInfo: v.staleInfo };
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the cache. Best-effort — a full localStorage never breaks refresh. */
export function saveVerdictCache(cache: VerdictCache): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore — verdicts regenerate on the next full sweep
  }
}

/**
 * Build a fresh cache from a full-refresh snapshot. Only worktrees that carry
 * a verdict are stored; the snapshot is authoritative, so paths absent from it
 * (removed worktrees) are pruned by construction.
 */
export function buildVerdictCache(worktrees: Worktree[]): VerdictCache {
  const out: VerdictCache = {};
  for (const wt of worktrees) {
    if (!wt.head) continue;
    if (wt.staleInfo === undefined && wt.stale === undefined) continue;
    out[wt.path] = {
      head: wt.head,
      stale: wt.stale ?? wt.staleInfo?.stale ?? false,
      staleInfo: wt.staleInfo,
    };
  }
  return out;
}

/**
 * The cached verdict for `path`, iff it was computed at the same HEAD.
 * A moved HEAD means new commits — the old verdict is provably outdated.
 */
export function cachedVerdictFor(
  cache: VerdictCache,
  path: string,
  head: string | undefined,
): CachedVerdict | null {
  if (!head) return null;
  const hit = cache[path];
  return hit && hit.head === head ? hit : null;
}
