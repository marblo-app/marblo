import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation, t as translate, type Locale } from "../../lib/i18n";

/**
 * **공개 레지스트리 스토어** 섹션 (marblo-app/marblo). 최상위 스토어 탭
 * (`components/store/StoreTab`)이 이것을 통째로 렌더한다.
 *
 * `EnvSwapVendorSection` 과 같은 "레지스트리 파생 섹션" 패턴이다 — 내장
 * 카탈로그 격자(HarnessPackage)와 데이터 소스·IPC 채널·설치 경로를 전혀
 * 공유하지 않는다(설계 §4.4: untrusted 입력은 내장 카탈로그와 같은 경로를
 * 타면 안 된다).
 *
 * 표시 원칙:
 *  - tier·permissions 는 **공시**다. UI 카피가 "강제 아님"을 명시한다(§4.6).
 *  - ★community tier 는 **보이되 설치 불가**다(§6.3 기본 차단). 한때는 목록에서도
 *    빼서 개수만 GitHub 으로 보냈는데, 스토어가 탭으로 격상되면서 카탈로그를
 *    브라우징하는 화면이 됐다 — 카탈로그가 자기 카탈로그의 대부분을 감추면
 *    브라우징이 안 된다. 그래서 **표시 정책만** 바뀌었고 **설치 게이트
 *    (`installable`)는 그대로**다: 미검수 페이로드에 원클릭 설치를 달지 않는다.
 *    이 둘이 분리돼 있는 게 요점 — 표시를 열어도 차단은 유지된다.
 *  - install 계약이 없는 항목(v1 mcp-server 등)은 "자동 설치 불가"로 정직하게
 *    표시하고 홈페이지 링크만 준다 — 가짜 설치 버튼 금지.
 *  - 설치 전에는 항상 권한 공시 모달을 지난다. 고위험 스코프는 강조.
 *  - 레지스트리 실패는 이 섹션 안에서만 표현된다(스토어 전체는 항상 열림).
 */

interface RegistryStoreSectionProps {
  /** "skill" | "mcp-server" | undefined(전 타입). 스토어 탭은 필터를 주지 않는다. */
  typeFilter?: "skill" | "mcp-server";
}

const HIGH_RISK_RE = /^(shell:exec|secrets:read|repository:write)/;

/** 공개 레지스트리 저장소 — 전체 카탈로그의 정본. */
const REGISTRY_CATALOG_URL = "https://github.com/marblo-app/marblo";

/**
 * 타입 필터를 지난 항목을 "화면에 그릴 목록" 과 "그 중 참조 전용(community)
 * 개수" 로 가른다. 둘을 **같은 모집단**에서 뽑는 게 요점 — 카운트가 화면의
 * 필터와 어긋나면 "커뮤니티 N개" 가 거짓말이 된다.
 *
 * ★ community 는 이제 `visible` 에 **들어간다**. 설치 차단은 여기가 아니라
 * 카드의 `installable` 판정이 한다 — 목록 정책과 설치 게이트를 같은 곳에서
 * 결정하면, 목록을 여는 변경이 조용히 설치까지 열어버린다.
 */
const TIER_RANK: Record<RegistryStoreItem["tier"], number> = {
  official: 0,
  verified: 1,
  community: 2,
};

export function splitRegistryByTier(
  items: RegistryStoreItem[],
  typeFilter?: RegistryStoreSectionProps["typeFilter"],
): { visible: RegistryStoreItem[]; communityCount: number } {
  const scoped = items.filter((i) => !typeFilter || i.type === typeFilter);
  // 설치 가능한 것부터 보여준다. 레지스트리 순서 그대로 두면 community 가
  // 압도적으로 많아서(94개 중 대부분) official/verified 가 스크롤 아래로
  // 밀린다 — 감추는 대신 순서로 푼다. Array.sort 는 안정 정렬이라 같은 tier
  // 안에서는 레지스트리 순서가 그대로 유지된다.
  const visible = [...scoped].sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier],
  );
  return {
    visible,
    communityCount: scoped.filter((i) => i.tier === "community").length,
  };
}

/**
 * ★설치 게이트(§6.3). 인앱 원클릭 설치는 세 조건을 **모두** 만족할 때만 열린다:
 *  1. tier 가 official/verified — community 는 미검수 페이로드라 표시만 한다,
 *  2. 설치 계약(`install`)이 실제로 있다 — 없으면 "자동 설치 불가"로 정직하게,
 *  3. 회수(revoked)되지 않았다.
 *
 * 목록 필터(`splitRegistryByTier`)와 **일부러 분리**돼 있다. 예전엔 community 를
 * 목록에서 빼는 것이 사실상의 2차 방어선처럼 보였지만, 그건 착시였다 — 표시
 * 정책이 바뀌면 같이 사라지는 방어선은 방어선이 아니다. 실제 차단은 항상 이
 * 함수 하나였고, 스토어가 community 를 보여주게 된 지금도 그대로다.
 */
export function isRegistryItemInstallable(
  item: Pick<RegistryStoreItem, "tier" | "install" | "status">,
): boolean {
  return (
    item.tier !== "community" && !!item.install && item.status !== "revoked"
  );
}

/**
 * 표시용 이름·설명 — 앱 로케일에 맞는 오버레이가 **그 필드에** 있으면 그것을,
 * 없으면 영어 base 를 쓴다.
 *
 * 폴백이 필드 단위인 게 요점이다: 이름만 번역된 항목은 이름만 한국어로 나오고
 * 설명은 영어로 남는다. "둘 다 있어야 번역을 쓴다" 로 만들면 부분 번역이 통째로
 * 사라져서, 기여자가 정확히 옮길 수 있는 것만 옮기는 선택지가 없어진다.
 *
 * 영어는 오버레이가 아니라 base 자체다(공개 스키마의 i18n 키에 `en` 이 없다) —
 * 그래서 en 은 조회 없이 곧장 base 로 간다.
 */
export function localizedItemText(
  item: Pick<RegistryStoreItem, "name" | "description" | "i18n">,
  locale: Locale,
): { name: string; description: string } {
  const overlay = locale === "en" ? undefined : item.i18n?.[locale];
  return {
    name: overlay?.name ?? item.name,
    description: overlay?.description ?? item.description,
  };
}

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
  const { t, locale } = useTranslation();
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

  const { visible, communityCount } = useMemo(
    () => splitRegistryByTier(items, typeFilter),
    [items, typeFilter],
  );
  const groups = useMemo(() => {
    const skills = visible.filter((i) => i.type === "skill");
    const mcps = visible.filter((i) => i.type === "mcp-server");
    // 레지스트리는 우리 빌드보다 먼저 새 타입(agent/workflow/…)을 낼 수 있다.
    // 알려진 두 그룹만 그리면 그런 항목은 조용히 사라진다 — 카탈로그 화면에서
    // "없는 것"과 "우리가 못 그리는 것"은 다르다. 남는 건 여기로 모은다.
    const known = new Set(["skill", "mcp-server"]);
    const others = visible.filter((i) => !known.has(i.type));
    return [
      {
        key: "skills",
        label: t("harness.store.registry.skills"),
        rows: skills,
      },
      { key: "mcp", label: t("harness.store.registry.mcp"), rows: mcps },
      { key: "other", label: t("harness.store.registry.other"), rows: others },
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
              // 알림도 카드와 같은 이름을 써야 한다 — 카드엔 한국어 이름이,
              // 알림엔 영어 이름이 뜨면 사용자는 다른 걸 설치했다고 읽는다.
              name: localizedItemText(item, locale).name,
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
    [load, locale],
  );

  const runUninstall = useCallback(
    async (item: RegistryStoreItem) => {
      if (
        !confirm(
          translate("harness.store.registry.uninstallConfirm", {
            name: localizedItemText(item, locale).name,
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
              name: localizedItemText(item, locale).name,
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
    [load, locale],
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
      {/* 빈 상태 = 레지스트리에서 이 화면 조건에 맞는 항목이 하나도 안 왔다는
          뜻이다(이제 tier 로 감추는 항목이 없으므로 정말로 비어 있는 것). */}
      {available && !loading && visible.length === 0 && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.registry.emptyCatalog")}
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
              const display = localizedItemText(item, locale);
              const installed =
                item.installState === "installed" ||
                item.installState === "outdated";
              const communityListOnly = item.tier === "community";
              const installable = isRegistryItemInstallable(item);
              return (
                <div
                  key={`${item.type}:${item.id}`}
                  className="rounded-md border border-[#313244] bg-[#181825] p-3 transition-colors hover:border-[#45475a]"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-[#cdd6f4]">
                        {display.name}
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
                    {display.description}
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

      {/* 전체 카탈로그의 정본은 GitHub 이다. 목록에 섞여 있는 community 항목이
          몇 개인지도 여기서 한 번 더 공시한다 — 카드마다 붙는 '참조 전용' 배지를
          훑지 않아도 "이 중 N개는 설치가 안 된다"가 한 줄로 읽히게. 레지스트리에
          닿지 못한 상태(!available)에선 개수가 0 이라 링크만 남는다. */}
      {available && !loading && (
        <p className="mt-3 text-[11px] text-[#6c7086]">
          {communityCount > 0 && (
            <>
              {t("harness.store.registry.communityListedNote", {
                count: communityCount,
              })}
              {" · "}
            </>
          )}
          <a
            href={REGISTRY_CATALOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#89b4fa] hover:underline"
          >
            {t("harness.store.registry.githubCatalog")}
          </a>
        </p>
      )}

      {/* 설치 전 권한 공시 모달 (§4.6) */}
      {disclosureFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-[#313244] bg-[#1e1e2e] p-4 shadow-2xl">
            <h4 className="mb-1 text-sm font-semibold text-[#cdd6f4]">
              {t("harness.store.registry.disclosureTitle")} —{" "}
              {localizedItemText(disclosureFor, locale).name}
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
