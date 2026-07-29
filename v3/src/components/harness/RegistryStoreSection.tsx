import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation, t as translate } from "../../lib/i18n";

/**
 * 하네스 탭의 **공개 레지스트리 스토어** 섹션 (marblo-app/marblo).
 *
 * `EnvSwapVendorSection` 과 같은 "레지스트리 파생 섹션" 패턴이다 — 내장
 * 카탈로그 격자(HarnessPackage)와 데이터 소스·IPC 채널·설치 경로를 전혀
 * 공유하지 않는다(설계 §4.4: untrusted 입력은 내장 카탈로그와 같은 경로를
 * 타면 안 된다).
 *
 * 표시 원칙:
 *  - tier·permissions 는 **공시**다. UI 카피가 "강제 아님"을 명시한다(§4.6).
 *  - community tier 는 목록·공시만 — 설치 버튼 자체가 없다(§6.3 기본 차단).
 *  - install 계약이 없는 항목(v1 mcp-server 등)은 "자동 설치 불가"로 정직하게
 *    표시하고 홈페이지 링크만 준다 — 가짜 설치 버튼 금지.
 *  - 설치 전에는 항상 권한 공시 모달을 지난다. 고위험 스코프는 강조.
 *  - 레지스트리 실패는 이 섹션 안에서만 표현된다(스토어 전체는 항상 열림).
 */

interface RegistryStoreSectionProps {
  /** "skill" | "mcp-server" | undefined(둘 다) — HarnessStore 필터 연동. */
  typeFilter?: "skill" | "mcp-server";
}

const HIGH_RISK_RE = /^(shell:exec|secrets:read|repository:write)/;

function tierBadgeClass(tier: RegistryStoreItem["tier"]): string {
  switch (tier) {
    case "official":
      return "bg-[#89b4fa]/20 text-[#89b4fa]";
    case "verified":
      return "bg-[#a6e3a1]/20 text-[#a6e3a1]";
    default:
      return "bg-[#585b70]/30 text-[#a6adc8]";
  }
}

function tierLabel(tier: RegistryStoreItem["tier"]): string {
  return translate(
    `harness.store.registry.tier.${tier}` as Parameters<typeof translate>[0],
  );
}

export function RegistryStoreSection({
  typeFilter,
}: RegistryStoreSectionProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<RegistryStoreItem[]>([]);
  const [stale, setStale] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  const [disclosureFor, setDisclosureFor] = useState<RegistryStoreItem | null>(
    null,
  );

  const load = useCallback(async (refresh?: boolean) => {
    setLoading(true);
    try {
      const res = await window.electronAPI.registry.index(
        refresh ? { refresh: true } : undefined,
      );
      setItems(res.items ?? []);
      setStale(!!res.stale);
      setAvailable(res.available !== false);
    } catch {
      setAvailable(false);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => items.filter((i) => !typeFilter || i.type === typeFilter),
    [items, typeFilter],
  );
  const groups = useMemo(() => {
    const skills = visible.filter((i) => i.type === "skill");
    const mcps = visible.filter((i) => i.type === "mcp-server");
    return [
      {
        key: "skills",
        label: t("harness.store.registry.skills"),
        rows: skills,
      },
      { key: "mcp", label: t("harness.store.registry.mcp"), rows: mcps },
    ].filter((g) => g.rows.length > 0);
  }, [visible, t]);

  const runInstall = useCallback(
    async (item: RegistryStoreItem) => {
      setDisclosureFor(null);
      setNotice(null);
      setBusy(item.id);
      try {
        const res = await window.electronAPI.registry.install({
          id: item.id,
          type: item.type,
        });
        if (res.success) {
          setNotice({
            kind: "info",
            text: translate("harness.store.registry.installDone", {
              name: item.name,
            }),
          });
        } else {
          setNotice({
            kind: "error",
            text: res.error ?? translate("harness.store.registry.installFail"),
          });
        }
      } finally {
        setBusy(null);
        void load();
      }
    },
    [load],
  );

  const runUninstall = useCallback(
    async (item: RegistryStoreItem) => {
      if (
        !confirm(
          translate("harness.store.registry.uninstallConfirm", {
            name: item.name,
          }),
        )
      ) {
        return;
      }
      setNotice(null);
      setBusy(item.id);
      try {
        const res = await window.electronAPI.registry.uninstall({
          id: item.id,
        });
        if (res.success) {
          setNotice({
            kind: "info",
            text: translate("harness.store.registry.uninstallDone", {
              name: item.name,
            }),
          });
        } else {
          setNotice({
            kind: "error",
            text:
              res.error ?? translate("harness.store.registry.uninstallFail"),
          });
        }
      } finally {
        setBusy(null);
        void load();
      }
    },
    [load],
  );

  return (
    <section className="border-b border-[#313244] px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-base">🛍️</span>
        <h3 className="text-sm font-semibold text-[#cdd6f4]">
          {t("harness.store.registry.title")}
        </h3>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8] transition-colors hover:bg-[#45475a] disabled:opacity-50"
        >
          {t("harness.store.registry.refresh")}
        </button>
        {stale && (
          <span className="rounded bg-[#f9e2af]/20 px-1.5 py-0.5 text-[10px] text-[#f9e2af]">
            {t("harness.store.registry.stale")}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[#7f849c]">
        {t("harness.store.registry.subtitle")}
      </p>

      {notice && (
        <div
          className={`mb-3 rounded border px-3 py-2 text-xs ${
            notice.kind === "error"
              ? "border-[#f38ba8]/30 bg-[#f38ba8]/10 text-[#f38ba8]"
              : "border-[#a6e3a1]/30 bg-[#a6e3a1]/10 text-[#a6e3a1]"
          }`}
        >
          {notice.text}
        </div>
      )}

      {!available && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.registry.unavailable")}
        </p>
      )}
      {available && !loading && visible.length === 0 && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.registry.empty")}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.key} className="mb-3 last:mb-0">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6c7086]">
            {group.label}
            <span className="ml-1.5 rounded bg-[#585b70]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
              {group.rows.length}
            </span>
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            {group.rows.map((item) => {
              const isBusy = busy === item.id;
              const installed =
                item.installState === "installed" ||
                item.installState === "outdated";
              const communityListOnly = item.tier === "community";
              const installable =
                !!item.install &&
                !communityListOnly &&
                item.status !== "revoked";
              return (
                <div
                  key={`${item.type}:${item.id}`}
                  className="rounded-md border border-[#313244] bg-[#181825] p-3 transition-colors hover:border-[#45475a]"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-[#cdd6f4]">
                        {item.name}
                      </span>
                      <span className="flex-shrink-0 text-[10px] text-[#6c7086]">
                        v{item.version}
                      </span>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${tierBadgeClass(
                          item.tier,
                        )}`}
                      >
                        {tierLabel(item.tier)}
                      </span>
                      {item.status === "revoked" && (
                        <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                          {t("harness.store.registry.revoked")}
                        </span>
                      )}
                      {item.status === "deprecated" && (
                        <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                          {t("harness.store.deprecated")}
                        </span>
                      )}
                      {installed && (
                        <span className="rounded bg-[#a6e3a1]/20 px-1.5 py-0.5 text-[10px] text-[#a6e3a1]">
                          {item.installState === "outdated"
                            ? t("harness.store.registry.outdated")
                            : t("harness.store.registry.installed")}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-[#bac2de]">
                    {item.description}
                  </p>

                  {/* 권한 공시 — 스코프 문자열 verbatim, 고위험은 강조(§4.6) */}
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    {!item.permissionsDeclared ? (
                      <span className="rounded bg-[#f9e2af]/15 px-1.5 py-0.5 text-[10px] text-[#f9e2af]">
                        {t("harness.store.registry.permissionsUndeclared")}
                      </span>
                    ) : item.permissions.length === 0 ? (
                      <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
                        {t("harness.store.registry.permissionsNone")}
                      </span>
                    ) : (
                      item.permissions.map((perm) => (
                        <span
                          key={perm}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            HIGH_RISK_RE.test(perm)
                              ? "bg-[#f38ba8]/15 text-[#f38ba8]"
                              : "bg-[#313244] text-[#a6adc8]"
                          }`}
                        >
                          {perm}
                        </span>
                      ))
                    )}
                  </div>

                  {item.sourceRepository && (
                    <p className="mb-2 truncate text-[10px] text-[#6c7086]">
                      {t("harness.store.registry.source")}:{" "}
                      {item.sourceRepository}
                      {item.sourceRef ? ` @ ${item.sourceRef}` : ""}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    {communityListOnly ? (
                      <span className="text-[10px] text-[#f9e2af]">
                        {t("harness.store.registry.communityListOnly")}
                      </span>
                    ) : !installed && installable ? (
                      <button
                        onClick={() => setDisclosureFor(item)}
                        disabled={isBusy}
                        className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30 disabled:opacity-50"
                      >
                        {isBusy
                          ? t("harness.store.registry.installing")
                          : t("harness.store.registry.install")}
                      </button>
                    ) : !installed ? (
                      <span
                        className="text-[10px] text-[#6c7086]"
                        title={item.notInstallableReason}
                      >
                        {t("harness.store.registry.notInstallable")}
                        {item.notInstallableReason
                          ? ` — ${item.notInstallableReason}`
                          : ""}
                      </span>
                    ) : null}
                    {installed && (
                      <button
                        onClick={() => void runUninstall(item)}
                        disabled={isBusy}
                        className="rounded bg-[#f38ba8]/20 px-2.5 py-1 text-xs text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/30 disabled:opacity-50"
                      >
                        {isBusy
                          ? t("harness.store.processing")
                          : t("harness.store.registry.uninstall")}
                      </button>
                    )}
                    {item.homepage && (
                      <a
                        href={item.homepage}
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
      ))}

      {/* 설치 전 권한 공시 모달 (§4.6) */}
      {disclosureFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-[#313244] bg-[#1e1e2e] p-4 shadow-2xl">
            <h4 className="mb-1 text-sm font-semibold text-[#cdd6f4]">
              {t("harness.store.registry.disclosureTitle")} —{" "}
              {disclosureFor.name}
            </h4>
            <p className="mb-3 text-xs text-[#7f849c]">
              {t("harness.store.registry.disclosureNote")}
            </p>
            <div className="mb-4 flex flex-wrap gap-1">
              {!disclosureFor.permissionsDeclared ? (
                <span className="rounded bg-[#f9e2af]/15 px-1.5 py-0.5 text-[10px] text-[#f9e2af]">
                  {t("harness.store.registry.permissionsUndeclared")}
                </span>
              ) : disclosureFor.permissions.length === 0 ? (
                <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
                  {t("harness.store.registry.permissionsNone")}
                </span>
              ) : (
                disclosureFor.permissions.map((perm) => (
                  <span
                    key={perm}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      HIGH_RISK_RE.test(perm)
                        ? "bg-[#f38ba8]/15 text-[#f38ba8]"
                        : "bg-[#313244] text-[#a6adc8]"
                    }`}
                  >
                    {HIGH_RISK_RE.test(perm)
                      ? `⚠ ${perm} (${t("harness.store.registry.highRisk")})`
                      : perm}
                  </span>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisclosureFor(null)}
                className="rounded bg-[#313244] px-2.5 py-1 text-xs text-[#a6adc8] transition-colors hover:bg-[#45475a]"
              >
                {t("harness.store.registry.disclosureCancel")}
              </button>
              <button
                onClick={() => void runInstall(disclosureFor)}
                className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30"
              >
                {t("harness.store.registry.disclosureConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
