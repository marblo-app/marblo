import { useEffect, useState, useCallback } from "react";
import { ConnectionStatusPanel } from "./ConnectionStatusPanel";
import { TelegramChannelPanel } from "./TelegramChannelPanel";

interface HarnessStoreProps {
  /** Pass undefined to render inline as a tab (no modal overlay, no close X). */
  onClose?: () => void;
}

type CategoryFilter = "all" | "required" | "recommended" | "mcp" | "cli";

const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: "전체",
  required: "필수 (자동 설치)",
  recommended: "추천 스킬",
  mcp: "유용한 MCP",
  cli: "CLI",
};

const STATUS_LABEL: Record<HarnessPackage["status"], string> = {
  installed: "설치됨",
  "not-installed": "설치",
  "manual-required": "수동 설치",
  unknown: "확인 중",
};

// Catalog packages whose login state we live-probe (binary on PATH ≠ logged
// in — spawning an unauthenticated CLI hangs on its login prompt).
const CLI_AUTH_MODELS: Record<string, "claude" | "codex"> = {
  "cli-claude-code": "claude",
  "cli-codex": "codex",
};

export function HarnessStore({ onClose }: HarnessStoreProps) {
  const [packages, setPackages] = useState<HarnessPackage[]>([]);
  const [versions, setVersions] = useState<Record<string, HarnessVersionInfo>>(
    {},
  );
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [authStates, setAuthStates] = useState<Record<string, CliAuthResult>>(
    {},
  );
  const [authChecking, setAuthChecking] = useState<Record<string, boolean>>({});

  const refreshAuth = useCallback(async (pkgId: string) => {
    const model = CLI_AUTH_MODELS[pkgId];
    if (!model) return;
    setAuthChecking((prev) => ({ ...prev, [pkgId]: true }));
    try {
      const res = await window.electronAPI.harness.cliAuthCheck(model);
      setAuthStates((prev) => ({ ...prev, [pkgId]: res }));
    } catch {
      /* keep previous auth state — probe is best-effort */
    } finally {
      setAuthChecking((prev) => ({ ...prev, [pkgId]: false }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await window.electronAPI.harness.list();
      setPackages(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
    // Versions are looked up lazily — they require network (npm view) and
    // can take several seconds. Render the list immediately and patch in
    // versions when they arrive.
    try {
      const v = await window.electronAPI.harness.versions();
      setVersions(v);
    } catch {
      /* non-fatal — versions panel just stays empty */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live-probe CLI login state whenever the catalog (re)loads.
  useEffect(() => {
    for (const id of Object.keys(CLI_AUTH_MODELS)) {
      if (packages.some((p) => p.id === id)) void refreshAuth(id);
    }
  }, [packages, refreshAuth]);

  const filtered = packages.filter(
    (p) => filter === "all" || p.category === filter,
  );

  const handleInstall = async (pkg: HarnessPackage) => {
    setError(null);
    setInfo(null);
    if (pkg.install.kind === "manual") {
      setInfo(pkg.install.instructions ?? "수동 설치 안내가 없습니다.");
      return;
    }
    setBusy(pkg.id);
    try {
      const result = await window.electronAPI.harness.install(pkg.id);
      if (!result.success) {
        setError(result.error ?? "설치 실패");
      } else {
        const postInstall = pkg.install.postInstall;
        setInfo(
          postInstall
            ? `${pkg.name} 설치 완료. ${postInstall}`
            : `${pkg.name} 설치 완료.`,
        );
      }
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const handleUninstall = async (pkg: HarnessPackage) => {
    setError(null);
    setInfo(null);
    if (!confirm(`${pkg.name} 제거하시겠습니까?`)) return;
    setBusy(pkg.id);
    try {
      const result = await window.electronAPI.harness.uninstall(pkg.id);
      if (!result.success) {
        setError(result.error ?? "제거 실패");
      } else {
        setInfo(`${pkg.name} 제거됨.`);
      }
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const isModal = !!onClose;
  return (
    <div
      className={
        isModal
          ? "fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          : "h-full w-full bg-[#181825] p-4"
      }
    >
      <div
        className={
          isModal
            ? "relative flex h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-[#313244] bg-[#1e1e2e] shadow-2xl"
            : "relative flex h-full w-full max-w-5xl mx-auto flex-col rounded-lg border border-[#313244] bg-[#1e1e2e]"
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#313244] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-[#89b4fa]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m14 0H5"
              />
            </svg>
            <h2 className="text-sm font-semibold text-[#cdd6f4]">
              Harness 스토어
            </h2>
            <span className="text-xs text-[#6c7086]">
              스킬 / MCP 한 번에 설치
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Filter */}
        <div className="flex gap-1.5 border-b border-[#313244] px-4 py-2">
          {(Object.keys(CATEGORY_LABEL) as CategoryFilter[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                filter === cat
                  ? "bg-[#89b4fa]/20 text-[#89b4fa]"
                  : "text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
              }`}
            >
              {CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>

        {/* Banner */}
        {error && (
          <div className="border-b border-[#f38ba8]/30 bg-[#f38ba8]/10 px-4 py-2 text-xs text-[#f38ba8]">
            {error}
          </div>
        )}
        {info && (
          <div className="border-b border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-4 py-2 text-xs text-[#a6e3a1]">
            {info}
          </div>
        )}

        {/* Body scrolls as one unit so the connection state and catalog stay in
            normal document flow without separate nested scrollbars. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConnectionStatusPanel />
          <TelegramChannelPanel />

          {/* List */}
          <div className="p-4">
            {filtered.length === 0 && (
              <p className="text-center text-sm text-[#6c7086]">
                표시할 패키지가 없습니다.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((pkg) => {
                const isBusy = busy === pkg.id;
                const isInstalled = pkg.status === "installed";
                const isDeprecated = !!pkg.deprecated;
                const isRequired = pkg.category === "required" && !isDeprecated;
                const isBundled = pkg.install.kind === "bundled";
                const isManual = pkg.install.kind === "manual";
                const ver = versions[pkg.id];
                const auth = CLI_AUTH_MODELS[pkg.id]
                  ? authStates[pkg.id]
                  : undefined;
                const authBusy = !!authChecking[pkg.id];
                return (
                  <div
                    key={pkg.id}
                    className="rounded-md border border-[#313244] bg-[#181825] p-3 transition-colors hover:border-[#45475a]"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-[#cdd6f4]">
                          {pkg.name}
                        </span>
                        <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] uppercase text-[#6c7086]">
                          {pkg.type}
                        </span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {isDeprecated && (
                          <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                            단종 예정
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            isInstalled
                              ? "bg-[#a6e3a1]/20 text-[#a6e3a1]"
                              : isManual
                                ? "bg-[#f9e2af]/20 text-[#f9e2af]"
                                : "bg-[#313244] text-[#6c7086]"
                          }`}
                        >
                          {isInstalled
                            ? "설치됨"
                            : isManual
                              ? "수동"
                              : "미설치"}
                        </span>
                        {auth && isInstalled && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              auth.authenticated
                                ? "bg-[#a6e3a1]/20 text-[#a6e3a1]"
                                : "bg-[#f9e2af]/20 text-[#f9e2af]"
                            }`}
                          >
                            {authBusy
                              ? "인증 확인 중…"
                              : auth.authenticated
                                ? "Ready"
                                : "인증 필요"}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mb-2 text-xs text-[#bac2de]">
                      {pkg.description}
                    </p>
                    {ver && isInstalled && ver.localVersion && (
                      <div className="mb-3 flex items-center gap-1.5 text-[10px]">
                        <span className="text-[#6c7086]">
                          v{ver.localVersion}
                        </span>
                        {ver.updateState === "outdated" &&
                          ver.latestVersion && (
                            <span className="rounded bg-[#f9e2af]/20 px-1.5 py-0.5 text-[#f9e2af]">
                              → v{ver.latestVersion} 업데이트 대기 중
                            </span>
                          )}
                        {ver.updateState === "up-to-date" && (
                          <span className="text-[#6c7086]">(최신)</span>
                        )}
                      </div>
                    )}
                    {auth && isInstalled && !auth.authenticated && (
                      <div className="mb-3 rounded border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-2 py-1.5 text-[10px] text-[#f9e2af]">
                        <div className="mb-1.5">
                          로그인이 필요합니다. 터미널에서{" "}
                          <code className="rounded bg-[#313244] px-1 py-0.5 text-[#f9e2af]">
                            {auth.action ?? "login"}
                          </code>{" "}
                          실행 후 Re-check 하세요. (미인증 상태로 spawn 시
                          로그인 프롬프트에서 멈춥니다)
                        </div>
                        <button
                          onClick={() => refreshAuth(pkg.id)}
                          disabled={authBusy}
                          className="rounded bg-[#f9e2af]/20 px-2 py-0.5 text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/30 disabled:opacity-50"
                        >
                          {authBusy ? "확인 중…" : "Re-check"}
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {isDeprecated && (
                        <span className="text-xs text-[#f38ba8]">
                          단종 예정 — 설치 비권장
                        </span>
                      )}
                      {!isInstalled && !isDeprecated && (
                        <button
                          onClick={() => handleInstall(pkg)}
                          disabled={isBusy || isBundled}
                          className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30 disabled:opacity-50"
                        >
                          {isBusy
                            ? "설치 중..."
                            : isManual
                              ? "안내 보기"
                              : isBundled
                                ? "자동 설치됨"
                                : isRequired
                                  ? "필수 — 설치"
                                  : STATUS_LABEL[pkg.status]}
                        </button>
                      )}
                      {isInstalled && !isRequired && (
                        <button
                          onClick={() => handleUninstall(pkg)}
                          disabled={isBusy}
                          className="rounded bg-[#f38ba8]/20 px-2.5 py-1 text-xs text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/30 disabled:opacity-50"
                        >
                          {isBusy ? "처리 중..." : "제거"}
                        </button>
                      )}
                      {isInstalled && isRequired && (
                        <span className="text-xs text-[#6c7086]">
                          필수 패키지 — 제거 불가
                        </span>
                      )}
                      {pkg.url && (
                        <a
                          href={pkg.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-xs text-[#6c7086] hover:text-[#89b4fa]"
                        >
                          문서 →
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="space-y-1 border-t border-[#313244] px-4 py-2 text-[11px] text-[#6c7086]">
          <div>
            <span className="text-[#89b4fa]">●</span> Marblo MCP는 대시보드
            내부에서 spawn 된 에이전트에만 자동 연결됩니다 (per-agent isolated
            config). 외부 터미널 CLI 세션은 사용자의 taskforce MCP 등 별도
            설정으로 관리하세요.
          </div>
          <div>
            외부 GitHub URL 직접 설치는 차후 추가될 예정입니다 (신뢰 검증 후).
          </div>
        </div>
      </div>
    </div>
  );
}
