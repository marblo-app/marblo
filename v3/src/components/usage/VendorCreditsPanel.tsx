import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";
import type { TFunction } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { billingFor } from "../../lib/vendorBilling";
import type { BillingAxis } from "../../lib/vendorBilling";
import { vendorColor } from "../../lib/usageBreakdown";
import {
  useVendorBalanceStore,
  vendorBalanceEntry,
} from "../../stores/vendorBalanceStore";

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
 * ── ★그 배선이 실제로 생겼다 — DeepSeek (2026-08-21) ────────────────────
 * `quotaApi` 가 null 이 아닌 벤더는 이제 이 **같은 카드 안에** 실제 잔액을 그린다
 * (총 잔액 / 무료분 / 충전액). 새 패널을 만들지 않은 이유는 사실의 축이 같기
 * 때문이다 — "이 벤더가 무엇을 소진하는가" 의 수치 칸이 비어 있었을 뿐이다.
 *
 * 이 자리의 규율 다섯:
 *   1. **키는 렌더러에 없다.** 조회는 메인(`electron/vendor-balance.ts`)이 하고
 *      여기로 오는 것은 금액·통화·상태, 그리고 키가 없을 때 그 **이름**뿐이다.
 *   2. **폴링 없음.** 탭 첫 진입 1회 + 사용자가 누른 새로고침뿐이고, 그마저
 *      메인의 TTL(10분)·연타 하한(15초)을 통과해야 실제 요청이 된다. 카드가
 *      여러 장이어도 요청은 **조회 가능한 벤더 수**만큼만 나간다.
 *   3. **실패를 구분해서 말한다.** 키 없음 / 401 / HTTP 오류 / 네트워크 / 형식
 *      불일치가 각각 다른 문장이다. 뭉치면 사용자는 충전이 안 된 건지 키가 틀린
 *      건지 알 수 없다(Solar 조용한 실패의 학습).
 *   4. **무료분과 충전액을 합쳐서만 보여주지 않는다.** 무료분은 만료 가능하고
 *      먼저 소진되므로, 총액만 보면 "아직 충전액이 남았다" 로 오독된다.
 *   5. **환산하지 않는다.** DeepSeek 은 CNY 로 답할 수 있고, 우리는 환율을 모른다.
 *
 * ★남은 한도의 **실측치**는 이미 아래 "한도(Rate limit) 상태" 패널이 그린다
 * (claude/codex 는 `usage:accountRateLimits` 프로브). 여기서 중복해 그리지 않고
 * 그쪽을 가리킨다.
 */

const AXIS_LABEL_KEYS: Record<BillingAxis, MessageKey> = {
  subscription: "usage.credits.axis.subscription",
  "subscription-quota": "usage.credits.axis.subscriptionQuota",
  prepaid: "usage.credits.axis.prepaid",
  unknown: "usage.credits.axis.unknown",
};

export function VendorCreditsPanel({
  groups,
}: {
  groups: QuickLaneVendorGroup[];
}) {
  const { t } = useTranslation();

  // 카탈로그가 아직 안 왔거나(Electron 밖) 비었을 때 — ★패널을 숨기지 않는다.
  // 벤더 목록을 렌더러가 지어낼 수는 없으므로 **내용**은 비우되, 제목과 사유는
  // 남긴다. 종전엔 `return null` 이라 섹션이 통째로 사라졌고, 화면에서 조용히
  // 없어진 섹션은 "데이터가 없다" 가 아니라 "앱이 고장났다" 로 읽힌다
  // (티켓 kEMh5HGDGggponXrsgby 의 사장님 리포트가 정확히 그 모양이었다).
  if (groups.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-gray-300">
          {t("usage.credits.title")}
        </h2>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.credits.empty")}
        </div>
      </div>
    );
  }

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
        {rows.map((g) => (
          <VendorCreditCard key={g.vendor} group={g} />
        ))}
      </div>
      <p className="text-[11px] leading-snug text-gray-600">
        ⓘ {t("usage.credits.footer")}
      </p>
    </div>
  );
}

/**
 * 금액 표기. ★통화 기호로 바꾸지도, 환산하지도 않는다 — 벤더가 준 코드를 그대로
 * 뒤에 붙인다("110.00 CNY"). 기호(¥/$)는 로케일에 따라 다른 통화를 가리킬 수 있어
 * 오히려 모호하고, 우리가 아는 사실은 "숫자 + 벤더가 말한 통화 코드" 뿐이다.
 */
function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

/**
 * 실패 사유 한 문장. ★상태별로 **다른** 문장이어야 한다 — 이 함수가 존재하는
 * 이유가 그것이다(뭉치면 충전 부족과 잘못된 키가 구분되지 않는다).
 * `ok`/`unsupported` 는 실패가 아니므로 null.
 */
export function balanceProblemMessage(
  result: VendorBalanceResult | null,
  bridgeError: string | null,
  t: TFunction
): string | null {
  if (bridgeError) return t("usage.credits.balance.err.bridge");
  if (!result) return null;
  switch (result.status) {
    case "no-key":
      return t("usage.credits.balance.err.noKey", {
        keys: (result.missingEnvKeys ?? []).join(", "),
      });
    case "unauthorized":
      return t("usage.credits.balance.err.unauthorized", {
        status: result.httpStatus ?? 401,
      });
    case "http-error":
      return t("usage.credits.balance.err.http", {
        status: result.httpStatus ?? 0,
      });
    case "network-error":
      return t("usage.credits.balance.err.network");
    case "malformed":
      return t("usage.credits.balance.err.malformed");
    default:
      return null;
  }
}

/**
 * 벤더 카드 한 장. 잔액 조회가 배선된 벤더(`quotaApi !== null`)만 수치를 그리고,
 * 나머지는 종전과 **한 픽셀도 다르지 않게** "조회불가" 로 남는다.
 */
function VendorCreditCard({ group }: { group: QuickLaneVendorGroup }) {
  const { t } = useTranslation();
  const fact = billingFor(group.vendor);
  const queryable = fact.quotaApi !== null;
  const needsKey = group.requiredEnvKeys.length > 0;

  const entry = useVendorBalanceStore((s) =>
    vendorBalanceEntry(s, group.vendor)
  );
  const load = useVendorBalanceStore((s) => s.load);
  const refresh = useVendorBalanceStore((s) => s.refresh);

  // ★조회 가능한 벤더에서만, ★한 번만 읽는다. 스토어가 "이미 읽었으면 no-op" 을
  // 보장하므로 탭을 여닫아도 IPC 가 반복되지 않는다(메인엔 TTL 캐시가 또 있다).
  useEffect(() => {
    if (queryable) void load(group.vendor);
  }, [queryable, group.vendor, load]);

  const result = entry.result;
  const loading = entry.state === "loading";
  const amounts = result?.status === "ok" ? result.amounts : [];
  const problem = queryable
    ? balanceProblemMessage(result, entry.bridgeError, t)
    : null;

  // 헤더 우측 한 칸. 0 이나 "—" 로 비우면 "잔액 0" 으로 오독되므로, 모르면 사유를
  // 단어로 쓴다(종전 규율 그대로).
  let headline: string;
  if (!queryable) headline = t("usage.credits.unavailable");
  else if (loading && !result) headline = t("usage.credits.balance.loading");
  else if (amounts.length > 0)
    headline = amounts.map((a) => formatMoney(a.total, a.currency)).join(" · ");
  else headline = t("usage.credits.unavailable");

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: vendorColor(group.vendor) }}
        />
        <span className="text-sm font-medium text-gray-200">{group.label}</span>
        <span className="rounded border border-gray-600 px-1 text-[10px] text-gray-400">
          {t(AXIS_LABEL_KEYS[fact.axis])}
        </span>
        <span
          className={`ml-auto text-xs ${
            amounts.length > 0 ? "text-gray-200" : "text-gray-500"
          }`}
        >
          {amounts.length > 0 && (
            <span className="mr-1 text-[10px] text-gray-500">
              {t("usage.credits.balance.total")}
            </span>
          )}
          {headline}
        </span>
      </div>

      {/* ★무료분 / 충전액을 갈라 적는다. 무료분이 먼저 소진되므로 총액만 보면
          "충전액이 아직 남았다" 로 오독된다. 벤더가 안 준 칸은 0 으로 채우지 않고
          아예 그리지 않는다. */}
      {amounts.map((a) => {
        const parts: string[] = [];
        if (a.granted !== null)
          parts.push(
            `${t("usage.credits.balance.granted")} ${formatMoney(
              a.granted,
              a.currency
            )}`
          );
        if (a.toppedUp !== null)
          parts.push(
            `${t("usage.credits.balance.toppedUp")} ${formatMoney(
              a.toppedUp,
              a.currency
            )}`
          );
        if (parts.length === 0) return null;
        return (
          <p
            key={a.currency}
            className="mt-1.5 text-[11px] leading-snug text-gray-400"
            title={t("usage.credits.balance.grantedHint")}
          >
            {parts.join(" · ")}
          </p>
        );
      })}

      {/* 벤더가 계정을 사용 불가로 표시한 경우 — 잔액이 남아 있어도 별개 사실이다. */}
      {result?.status === "ok" && result.isAvailable === false && (
        <p className="mt-1.5 text-[11px] leading-snug text-amber-500/90">
          ! {t("usage.credits.balance.notAvailableFlag")}
        </p>
      )}

      {/* 크레덴셜 상태 — 유일하게 실측인 축(값이 아니라 키 이름/boolean) */}
      {needsKey && (
        <p className="mt-2 text-[11px] leading-snug">
          {group.available ? (
            <span className="text-green-500/90">
              ✓{" "}
              {t("usage.credits.keySet", {
                keys: group.requiredEnvKeys.join(", "),
              })}
            </span>
          ) : (
            <span className="text-amber-500/90">
              !{" "}
              {t("usage.credits.keyMissing", {
                keys: group.missingEnvKeys.join(", "),
              })}
            </span>
          )}
        </p>
      )}

      {/* ★실패 사유 — 상태별로 다른 문장. 이 줄이 없으면 사용자는 충전이 안 된
          건지 키가 틀린 건지 알 수 없다. */}
      {problem && (
        <p className="mt-2 text-[11px] leading-snug text-amber-500/90">
          ! {problem}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-snug text-gray-500">
        {queryable
          ? t("usage.credits.prepaidNote")
          : fact.axis === "subscription"
            ? t("usage.credits.subscriptionNote")
            : t("usage.credits.noApi")}
      </p>

      {/* ★수동 새로고침만 있다. 자동 폴링은 없다(파일 상단 규율 2). */}
      {queryable && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh(group.vendor)}
            disabled={loading}
            className="text-[11px] text-blue-400 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-gray-600 disabled:no-underline"
          >
            {loading
              ? t("usage.credits.balance.loading")
              : `${t("usage.credits.balance.refresh")} ⟳`}
          </button>
          {result && result.fetchedAt > 0 && (
            <span className="text-[11px] text-gray-600">
              {t("usage.credits.balance.fetchedAt", {
                time: new Date(result.fetchedAt).toLocaleTimeString(),
              })}
            </span>
          )}
        </div>
      )}

      {fact.consoleUrl && (
        <button
          type="button"
          // main 의 setWindowOpenHandler 가 외부 https 를
          // shell.openExternal 로 넘긴다(새 IPC 없음).
          onClick={() => window.open(fact.consoleUrl, "_blank", "noopener")}
          className="mt-2 block text-[11px] text-blue-400 underline-offset-2 hover:underline"
        >
          {t("usage.credits.console")} ↗
        </button>
      )}
    </div>
  );
}

export default VendorCreditsPanel;
