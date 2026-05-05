import { useEffect, useState, useCallback } from "react";

interface HarnessStoreProps {
  /** Pass undefined to render inline as a tab (no modal overlay, no close X). */
  onClose?: () => void;
}

type CategoryFilter = "all" | "required" | "recommended" | "mcp";

const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: "전체",
  required: "필수 (자동 설치)",
  recommended: "추천 스킬",
  mcp: "유용한 MCP",
};

const STATUS_LABEL: Record<HarnessPackage["status"], string> = {
  installed: "설치됨",
  "not-installed": "설치",
  "manual-required": "수동 설치",
  unknown: "확인 중",
};

export function HarnessStore({ onClose }: HarnessStoreProps) {
  const [packages, setPackages] = useState<HarnessPackage[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.electronAPI.harness.list();
      setPackages(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = packages.filter(
    (p) => filter === "all" || p.category === filter
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
            : `${pkg.name} 설치 완료.`
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

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-[#6c7086]">
              표시할 패키지가 없습니다.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((pkg) => {
              const isBusy = busy === pkg.id;
              const isInstalled = pkg.status === "installed";
              const isRequired = pkg.category === "required";
              const isManual = pkg.install.kind === "manual";
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
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        isInstalled
                          ? "bg-[#a6e3a1]/20 text-[#a6e3a1]"
                          : isManual
                          ? "bg-[#f9e2af]/20 text-[#f9e2af]"
                          : "bg-[#313244] text-[#6c7086]"
                      }`}
                    >
                      {isInstalled ? "설치됨" : isManual ? "수동" : "미설치"}
                    </span>
                  </div>
                  <p className="mb-3 text-xs text-[#bac2de]">
                    {pkg.description}
                  </p>
                  <div className="flex items-center gap-2">
                    {!isInstalled && (
                      <button
                        onClick={() => handleInstall(pkg)}
                        disabled={isBusy || isRequired}
                        className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30 disabled:opacity-50"
                      >
                        {isBusy
                          ? "설치 중..."
                          : isManual
                          ? "안내 보기"
                          : isRequired
                          ? "자동 설치됨"
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

        {/* Footer note */}
        <div className="border-t border-[#313244] px-4 py-2 text-[11px] text-[#6c7086]">
          외부 GitHub URL 직접 설치는 차후 추가될 예정입니다 (신뢰 검증 후).
        </div>
      </div>
    </div>
  );
}
