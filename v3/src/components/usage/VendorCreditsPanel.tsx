import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { billingFor } from "../../lib/vendorBilling";
import type { BillingAxis } from "../../lib/vendorBilling";
import { vendorColor } from "../../lib/usageBreakdown";

/**
 * 벤더 크레딧 / 쿼터 패널.
 *
 * ── ★왜 숫자가 없는가 ────────────────────────────────────────────────────
 * 이 티켓의 원래 요구는 "GLM(zai)/MiniMax 프리페이드 잔액을 API 로 조회해 표시"
 * 였다. 두 벤더의 1차 문서를 전수 확인한 결과 **둘 다 잔액·쿼터 조회 공개 API 가
 * 없고**, 애초에 프리페이드도 아니다(구독형 쿼터 — 5시간 롤링 + 주간 창).
 * 근거는 `lib/vendorBilling.ts` 상단에 인용해 뒀다.
 *
 * 그래서 이 패널은 **없는 수치를 지어내지 않는다.** 대신 세 가지 사실만 보여준다:
 *
 *   1. 과금축 — 구독 / 구독형 쿼터 / 미상 (문서 확인분)
 *   2. 크레덴셜 설정 여부 — 메인 프로세스가 `process.env` 로 판정해
 *      `models:quickLaneCatalog` 로 내려준 값(★키 **이름**과 boolean 뿐, 값은
 *      렌더러로 내려오지 않는다). 이건 실측이라 그대로 표시한다.
 *   3. 조회불가 사유 + 벤더 콘솔 딥링크 — 사용자가 1클릭으로 실물을 확인.
 *
 * 벤더가 나중에 조회 API 를 내면 `vendorBilling.quotaApi` 에 배선하는 것만으로
 * 이 패널이 수치를 그리게 된다.
 *
 * ★남은 한도의 **실측치**는 이미 아래 "한도(Rate limit) 상태" 패널이 그린다
 * (claude/codex 는 `usage:accountRateLimits` 프로브). 여기서 중복해 그리지 않고
 * 그쪽을 가리킨다.
 */

const AXIS_LABEL_KEYS: Record<BillingAxis, MessageKey> = {
  subscription: "usage.credits.axis.subscription",
  "subscription-quota": "usage.credits.axis.subscriptionQuota",
  unknown: "usage.credits.axis.unknown",
};

export function VendorCreditsPanel({
  groups,
}: {
  groups: QuickLaneVendorGroup[];
}) {
  const { t } = useTranslation();

  // 카탈로그가 아직 안 왔거나(Electron 밖) 비었으면 패널 자체를 숨긴다 —
  // 벤더 목록을 렌더러가 지어낼 수는 없기 때문이다.
  if (groups.length === 0) return null;

  // 같은 벤더가 하네스별로 쪼개져 올 수 있다(카탈로그 규약). 크레딧은 벤더 축의
  // 사실이므로 벤더로 한 번 접는다 — 필요 키는 합집합, available 은 전부 AND.
  const byVendor = new Map<string, QuickLaneVendorGroup>();
  for (const g of groups) {
    const prev = byVendor.get(g.vendor);
    if (!prev) {
      byVendor.set(g.vendor, g);
      continue;
    }
    byVendor.set(g.vendor, {
      ...prev,
      models: [...prev.models, ...g.models],
      requiredEnvKeys: [
        ...new Set([...prev.requiredEnvKeys, ...g.requiredEnvKeys]),
      ],
      missingEnvKeys: [
        ...new Set([...prev.missingEnvKeys, ...g.missingEnvKeys]),
      ],
      available: prev.available && g.available,
    });
  }

  const rows = [...byVendor.values()];

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-gray-300">
        {t("usage.credits.title")}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((g) => {
          const fact = billingFor(g.vendor);
          const needsKey = g.requiredEnvKeys.length > 0;
          return (
            <div
              key={g.vendor}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: vendorColor(g.vendor) }}
                />
                <span className="text-sm font-medium text-gray-200">
                  {g.label}
                </span>
                <span className="rounded border border-gray-600 px-1 text-[10px] text-gray-400">
                  {t(AXIS_LABEL_KEYS[fact.axis])}
                </span>
                {/* 잔여 수치 자리 — 오늘은 전 벤더가 조회불가다. 0 이나 "—" 로
                    비우면 "잔액 0" 으로 오독되므로 사유를 단어로 쓴다. */}
                <span className="ml-auto text-xs text-gray-500">
                  {t("usage.credits.unavailable")}
                </span>
              </div>

              {/* 크레덴셜 상태 — 유일하게 실측인 축(값이 아니라 키 이름/boolean) */}
              {needsKey && (
                <p className="mt-2 text-[11px] leading-snug">
                  {g.available ? (
                    <span className="text-green-500/90">
                      ✓{" "}
                      {t("usage.credits.keySet", {
                        keys: g.requiredEnvKeys.join(", "),
                      })}
                    </span>
                  ) : (
                    <span className="text-amber-500/90">
                      !{" "}
                      {t("usage.credits.keyMissing", {
                        keys: g.missingEnvKeys.join(", "),
                      })}
                    </span>
                  )}
                </p>
              )}

              <p className="mt-2 text-[11px] leading-snug text-gray-500">
                {fact.axis === "subscription"
                  ? t("usage.credits.subscriptionNote")
                  : t("usage.credits.noApi")}
              </p>

              {fact.consoleUrl && (
                <button
                  type="button"
                  // main 의 setWindowOpenHandler 가 외부 https 를
                  // shell.openExternal 로 넘긴다(새 IPC 없음).
                  onClick={() =>
                    window.open(fact.consoleUrl, "_blank", "noopener")
                  }
                  className="mt-2 text-[11px] text-blue-400 underline-offset-2 hover:underline"
                >
                  {t("usage.credits.console")} ↗
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-snug text-gray-600">
        ⓘ {t("usage.credits.footer")}
      </p>
    </div>
  );
}

export default VendorCreditsPanel;
