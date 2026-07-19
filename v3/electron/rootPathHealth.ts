import path from "path";

/**
 * Why a rootPath can't be used, in the order we can actually act on it.
 *
 * The old code collapsed all of these into one message — "폴더가 사라졌습니다" —
 * which is a lie for two of the three cases and, worse, hides the real defect.
 * A Windows path on a Mac was never deleted; it never existed here. A reaped
 * agent worktree wasn't lost either; its project root is still sitting there.
 * Naming the cause is what lets us offer a recovery action instead of an OK box.
 */
export type RootPathFailure =
  | "foreign-platform" // a path belonging to another machine/OS — see below
  | "worktree-removed" // an agent's isolated worktree that got reaped
  | "missing"; // genuinely gone, and we know nothing more

export interface RootPathDiagnosis {
  failure: RootPathFailure;
  rootPath: string;
  /** A still-existing root we can offer to fall back to, when we have one. */
  fallbackRootPath?: string;
}

/**
 * True when `p` is shaped for a different OS than the one we're running on.
 *
 * This is deliberately shape-based, not existence-based: `C:\Users\...` on macOS
 * can NEVER exist, so treating it as "missing" invites the user to go looking
 * for a folder that was never on this machine. It reaches us because Firestore
 * `projects.folderPath` stores one machine's local path in a doc shared by every
 * machine on the account (first machine to register a repo wins). Until that
 * schema is per-device, every reader has to defend itself.
 */
export function isForeignPlatformPath(p: string): boolean {
  if (!p) return false;
  const isWindowsShaped = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
  return process.platform === "win32" ? !isWindowsShaped : isWindowsShaped;
}

/**
 * True when `p` lives under the agent worktree pool (`<home>/.marblo/worktrees`).
 *
 * Such a path is per-task and disposable by design — the sweep reaps it as soon
 * as its task settles. A window pointing at one is always a transient state that
 * should degrade back to the project root, never an error the user must fix.
 */
export function isAgentWorktreePath(p: string, homeDir: string): boolean {
  if (!p) return false;
  const pool = path.join(homeDir, ".marblo", "worktrees");
  const resolved = path.resolve(p);
  return (
    resolved === pool || resolved.startsWith(pool + path.sep) // exact-segment, not a bare prefix
  );
}

/**
 * Classify an unusable rootPath so the caller can say something true about it.
 *
 * `exists` is injected (not called on `fallbackRootPath` — the caller vouches
 * for that one) so this stays pure and unit-testable without touching disk.
 */
export function diagnoseRootPath(
  rootPath: string,
  opts: { homeDir: string; fallbackRootPath?: string },
): RootPathDiagnosis {
  const fallback =
    opts.fallbackRootPath && opts.fallbackRootPath !== rootPath
      ? opts.fallbackRootPath
      : undefined;

  const failure: RootPathFailure = isForeignPlatformPath(rootPath)
    ? "foreign-platform"
    : isAgentWorktreePath(rootPath, opts.homeDir)
      ? "worktree-removed"
      : "missing";

  return {
    failure,
    rootPath,
    ...(fallback ? { fallbackRootPath: fallback } : {}),
  };
}

export interface RootPathMessage {
  title: string;
  body: string;
  /** Label for the recovery button, when a fallback root is available. */
  fallbackLabel?: string;
}

/**
 * Turn a diagnosis into user-facing copy that states the cause and the way out.
 *
 * Kept next to the classifier (rather than inline at the dialog call) so the
 * wording is unit-testable and there is exactly one place that phrases this.
 */
export function describeRootPathFailure(d: RootPathDiagnosis): RootPathMessage {
  const fallbackLine = d.fallbackRootPath
    ? `\n\n대신 열 수 있는 폴더가 있습니다:\n${d.fallbackRootPath}`
    : "";
  const fallbackLabel = d.fallbackRootPath ? "이 폴더로 열기" : undefined;

  switch (d.failure) {
    case "foreign-platform":
      return {
        title: "Marblo — 이 기기에서 열 수 없는 폴더입니다",
        body:
          "이 프로젝트에 저장된 폴더 경로는 다른 기기(다른 OS)의 경로입니다:\n" +
          `${d.rootPath}\n\n` +
          "삭제된 것이 아니라 이 기기에 처음부터 없는 경로입니다. 프로젝트를 " +
          "여러 기기에서 쓰면 먼저 등록한 기기의 경로가 공유되기 때문입니다.\n\n" +
          "이 기기에서 쓸 폴더를 직접 열어 주세요." +
          fallbackLine,
        ...(fallbackLabel ? { fallbackLabel } : {}),
      };
    case "worktree-removed":
      return {
        title: "Marblo — 작업 워크트리가 정리되었습니다",
        body:
          "이 창이 보고 있던 작업 워크트리는 작업이 끝나 정리되었습니다:\n" +
          `${d.rootPath}\n\n` +
          "정상적인 정리이며 프로젝트 코드는 그대로입니다. 프로젝트 루트로 " +
          "돌아가면 계속 작업할 수 있습니다." +
          fallbackLine,
        ...(fallbackLabel ? { fallbackLabel } : {}),
      };
    case "missing":
      return {
        title: "Marblo — 작업 폴더를 찾을 수 없습니다",
        body:
          "이 창이 보고 있던 폴더를 찾을 수 없습니다:\n" +
          `${d.rootPath}\n\n` +
          "이동했거나 삭제되었을 수 있습니다. 오케스트레이터와 터미널은 이 " +
          "폴더에서 실행할 수 없어 시작하지 않았습니다." +
          fallbackLine,
        ...(fallbackLabel ? { fallbackLabel } : {}),
      };
  }
}
