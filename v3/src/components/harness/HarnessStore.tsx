import { useEffect, useState, useCallback } from "react";
import { ConnectionStatusPanel } from "./ConnectionStatusPanel";
import { TelegramChannelPanel } from "./TelegramChannelPanel";
import { EnvSwapVendorSection } from "./EnvSwapVendorSection";
import { RegistryStoreSection } from "./RegistryStoreSection";
import { useTranslation, t as translate } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

interface HarnessStoreProps {
  /** Pass undefined to render inline as a tab (no modal overlay, no close X). */
  onClose?: () => void;
}

/**
 * `envswap` 은 패키지 `category` 가 아니라 **다른 갈래를 여는 칸**이다. 설치형
 * 카탈로그(`harness-manager`)엔 env-swap 벤더 행이 없고 있어서도 안 된다 — 설치할
 * 바이너리가 없는 벤더에 설치 버튼을 다는 오분류가 되기 때문. 그래서 이 값일 때는
 * 패키지 격자를 접고 `EnvSwapVendorSection`(레지스트리 파생)만 보여준다.
 */
/**
 * `regskill`/`regmcp` 도 `envswap` 과 같은 "다른 갈래를 여는 칸"이다 — 공개
 * 레지스트리(marblo-app/marblo) 파생 섹션만 보여주고 내장 패키지 격자는 접는다.
 */
type CategoryFilter =
  | "all"
  | "required"
  | "recommended"
  | "mcp"
  | "cli"
  | "envswap"
  | "regskill"
  | "regmcp";

const CATEGORY_FILTERS: CategoryFilter[] = [
  "all",
  "required",
  "recommended",
  "mcp",
  "cli",
  "envswap",
  "regskill",
  "regmcp",
];

// Display labels read locale at call time via the pure t() (the enum value
// itself stays the identifier used for filtering/lookup).
function categoryLabel(cat: CategoryFilter): string {
  return translate(`harness.store.cat.${cat}` as MessageKey);
}

function statusLabel(status: HarnessPackage["status"]): string {
  return translate(`harness.store.status.${status}` as MessageKey);
}

/**
 * 스토어 화면의 두 갈래를 가르는 머리줄. 이 화면은 성격이 다른 두 가지를 한
 * 스크롤에 담고 있었다 — (1) 이 앱에 CLI·벤더·채널을 **연결**하는 셋업,
 * (2) 외부 레지스트리에서 자산을 **설치**하는 스토어. 둘이 시각적으로 안
 * 갈려서 클러터로 읽혔다. `separated` 는 앞 섹션과의 경계선(두 번째부터).
 */
function StoreSectionHeader({
  label,
  desc,
  separated,
}: {
  label: string;
  desc: string;
  separated?: boolean;
}) {
  return (
    <div
      className={`bg-[#11111b] px-4 py-2.5 ${
        separated ? "border-y-2 border-[#313244]" : "border-b border-[#313244]"
      }`}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#89b4fa]">
        {label}
      </h3>
      <p className="mt-0.5 text-[11px] text-[#6c7086]">{desc}</p>
    </div>
  );
}

// Catalog packages whose login state we live-probe (binary on PATH ≠ logged
// in — spawning an unauthenticated CLI hangs on its login prompt).
const CLI_AUTH_MODELS: Record<string, "claude" | "codex" | "grok"> = {
  "cli-claude-code": "claude",
  "cli-codex": "codex",
  "cli-grok": "grok",
};

export function HarnessStore({ onClose }: HarnessStoreProps) {
  const { t } = useTranslation();
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
      setError(
        err instanceof Error
          ? err.message
          : translate("harness.store.loadFail"),
      );
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

  // `envswap`/`regskill`/`regmcp` 는 설치형 패키지 카테고리가 아니므로 격자
  // 자체를 접는다(빈 목록 안내를 띄우면 "패키지가 없다" 는 엉뚱한 말이 된다).
  const showPackages =
    filter !== "envswap" && filter !== "regskill" && filter !== "regmcp";
  const showEnvSwap = filter === "all" || filter === "envswap";
  const showRegistry =
    filter === "all" || filter === "regskill" || filter === "regmcp";
  const registryTypeFilter =
    filter === "regskill"
      ? ("skill" as const)
      : filter === "regmcp"
        ? ("mcp-server" as const)
        : undefined;
  const filtered = packages.filter(
    (p) => filter === "all" || p.category === filter,
  );

  const handleInstall = async (pkg: HarnessPackage) => {
    setError(null);
    setInfo(null);
    if (pkg.install.kind === "manual") {
      setInfo(
        pkg.install.instructions ?? translate("harness.store.noManualGuide"),
      );
      return;
    }
    setBusy(pkg.id);
    try {
      const result = await window.electronAPI.harness.install(pkg.id);
      if (!result.success) {
        setError(result.error ?? translate("harness.store.installFail"));
      } else {
        const postInstall = pkg.install.postInstall;
        const done = translate("harness.store.installDone", { name: pkg.name });
        setInfo(postInstall ? `${done} ${postInstall}` : done);
      }
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const handleUninstall = async (pkg: HarnessPackage) => {
    setError(null);
    setInfo(null);
    if (
      !confirm(translate("harness.store.uninstallConfirm", { name: pkg.name }))
    )
      return;
    setBusy(pkg.id);
    try {
      const result = await window.electronAPI.harness.uninstall(pkg.id);
      if (!result.success) {
        setError(result.error ?? translate("harness.store.uninstallFail"));
      } else {
        setInfo(translate("harness.store.uninstallDone", { name: pkg.name }));
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
              {t("harness.store.title")}
            </h2>
            <span className="text-xs text-[#6c7086]">
              {t("harness.store.subtitle")}
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
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                filter === cat
                  ? "bg-[#89b4fa]/20 text-[#89b4fa]"
                  : "text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
              }`}
            >
              {categoryLabel(cat)}
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
          {/* ── 섹션 1: 연결 — CLI·벤더·채널을 이 앱에 붙이는 셋업 ── */}
          <StoreSectionHeader
            label={t("harness.store.section.connections")}
            desc={t("harness.store.section.connectionsDesc")}
          />
          <ConnectionStatusPanel />
          <TelegramChannelPanel />

          {/* env-swap 벤더 — 설치형 카탈로그에 없는 "키만 얹는" 벤더들.
              카탈로그보다 위에 두는 이유: 이 탭에서 안 보인다는 것이 문제였다. */}
          {showEnvSwap && <EnvSwapVendorSection />}

          {/* List */}
          {showPackages && (
            <div className="p-4">
              {filtered.length === 0 && (
                <p className="text-center text-sm text-[#6c7086]">
                  {t("harness.store.emptyList")}
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((pkg) => {
                  const isBusy = busy === pkg.id;
                  const isInstalled = pkg.status === "installed";
                  const isDeprecated = !!pkg.deprecated;
                  const isRequired =
                    pkg.category === "required" && !isDeprecated;
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
                              {t("harness.store.deprecated")}
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
                              ? t("harness.store.badge.installed")
                              : isManual
                                ? t("harness.store.badge.manual")
                                : t("harness.store.badge.notInstalled")}
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
                                ? t("harness.store.auth.checking")
                                : auth.authenticated
                                  ? "Ready"
                                  : t("harness.store.auth.needed")}
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
                                {t("harness.store.updatePending", {
                                  version: ver.latestVersion,
                                })}
                              </span>
                            )}
                          {ver.updateState === "up-to-date" && (
                            <span className="text-[#6c7086]">
                              {t("harness.store.upToDate")}
                            </span>
                          )}
                        </div>
                      )}
                      {auth && isInstalled && !auth.authenticated && (
                        <div className="mb-3 rounded border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-2 py-1.5 text-[10px] text-[#f9e2af]">
                          <div className="mb-1.5">
                            {t("harness.store.auth.loginHintBefore")}{" "}
                            <code className="rounded bg-[#313244] px-1 py-0.5 text-[#f9e2af]">
                              {auth.action ?? "login"}
                            </code>{" "}
                            {t("harness.store.auth.loginHintAfter")}
                          </div>
                          <button
                            onClick={() => refreshAuth(pkg.id)}
                            disabled={authBusy}
                            className="rounded bg-[#f9e2af]/20 px-2 py-0.5 text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/30 disabled:opacity-50"
                          >
                            {authBusy
                              ? t("harness.store.auth.checkingShort")
                              : "Re-check"}
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {isDeprecated && (
                          <span className="text-xs text-[#f38ba8]">
                            {t("harness.store.deprecatedNoInstall")}
                          </span>
                        )}
                        {!isInstalled && !isDeprecated && (
                          <button
                            onClick={() => handleInstall(pkg)}
                            disabled={isBusy || isBundled}
                            className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30 disabled:opacity-50"
                          >
                            {isBusy
                              ? t("harness.store.installing")
                              : isManual
                                ? t("harness.store.viewGuide")
                                : isBundled
                                  ? t("harness.store.bundled")
                                  : isRequired
                                    ? t("harness.store.requiredInstall")
                                    : statusLabel(pkg.status)}
                          </button>
                        )}
                        {isInstalled && !isRequired && (
                          <button
                            onClick={() => handleUninstall(pkg)}
                            disabled={isBusy}
                            className="rounded bg-[#f38ba8]/20 px-2.5 py-1 text-xs text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/30 disabled:opacity-50"
                          >
                            {isBusy
                              ? t("harness.store.processing")
                              : t("harness.store.uninstall")}
                          </button>
                        )}
                        {isInstalled && isRequired && (
                          <span className="text-xs text-[#6c7086]">
                            {t("harness.store.requiredNoRemove")}
                          </span>
                        )}
                        {pkg.url && (
                          <a
                            href={pkg.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto text-xs text-[#6c7086] hover:text-[#89b4fa]"
                          >
                            {t("harness.store.docs")}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 섹션 2: 스토어 — 공개 레지스트리(registry:*)에서 설치하는 자산.
              내장 카탈로그와 데이터 소스·IPC 채널이 완전히 분리돼 있다. ── */}
          {showRegistry && (
            <>
              <StoreSectionHeader
                separated
                label={t("harness.store.section.store")}
                desc={t("harness.store.section.storeDesc")}
              />
              <RegistryStoreSection typeFilter={registryTypeFilter} />
            </>
          )}
        </div>

        {/* Footer note */}
        <div className="space-y-1 border-t border-[#313244] px-4 py-2 text-[11px] text-[#6c7086]">
          <div>
            <span className="text-[#89b4fa]">●</span>{" "}
            {t("harness.store.footerMcp")}
          </div>
          <div>{t("harness.store.footerGithub")}</div>
        </div>
      </div>
    </div>
  );
}
