/**
 * 선불 잔액의 **수위 판정** — 순수 규칙(2026-08-21, 티켓 7HthjBEf).
 *
 * 사용량 탭의 벤더 크레딧 카드(PR #1073)는 잔액 **숫자**와 조회 실패 사유는 그리지만
 * "이 숫자가 적은 건지" 는 말하지 않는다. 그래서 잔액이 0.30 USD 여도 화면은 초록
 * 체크(키 등록됨)와 숫자 하나만 보여주고, 사용자는 다음 오케가 왜 안 뜨는지 그때
 * 처음 안다. 이 파일이 그 한 줄을 만든다.
 *
 * ── ★electron 쪽 규칙의 미러다 ──────────────────────────────────────────
 * 원본은 `electron/orchestrator-vendor-gate.ts` 의 `LOW_BALANCE_THRESHOLDS` 이고,
 * 오케 스폰 게이트가 **같은 임계**로 차단/경고를 가른다. 두 곳이 벌어지면 화면은
 * "충분함" 인데 스폰은 막히는(또는 그 반대) 상태가 되므로,
 * `tests/unit/orchestrator-vendor-gate.test.ts` 가 두 상수를 대조한다.
 * `src/` ↔ `electron/` cross-import 를 두지 않는 repo 규약(`src/lib/rootPathScope.ts`)
 * 때문에 미러이고, 그 규약이 이 파일의 존재 이유 전부다.
 *
 * ── ★통화를 환산하지 않는다 ─────────────────────────────────────────────
 * DeepSeek 은 계정에 따라 CNY 로 답한다. 우리는 환율을 들고 있지 않으므로 임계도
 * **통화별로 따로** 둔다(환산이 아니라 독립적으로 고른 두 숫자다). 모르는 통화는
 * `"low"` 판정을 하지 않는다 — 그 단위에서 "적다" 가 얼마인지 모르는 채로 경고를
 * 띄우면 그건 지어낸 사실이다. 반면 **소진(≤ 0)은 통화와 무관**하므로 그대로 산다.
 */

/** 통화별 저잔액 임계. `electron/orchestrator-vendor-gate.LOW_BALANCE_THRESHOLDS` 미러. */
export const LOW_BALANCE_THRESHOLDS: Readonly<Record<string, number>> = {
  USD: 2,
  CNY: 15,
};

export type VendorBalanceLevel =
  /** 여유 있음(또는 임계를 알 수 없는 통화). 경고 없음. */
  | "ok"
  /** 임계 이하 — 아직 쓸 수 있지만 곧 끊긴다. */
  | "low"
  /** 0 이하 — 지금 쓸 수 없다. */
  | "depleted";

/** 금액 한 줄(`VendorBalanceAmount` 중 이 판정이 쓰는 두 칸만). */
export interface BalanceLevelAmount {
  currency: string;
  total: number;
}

/**
 * 통화별 잔액 목록 하나의 수위. 빈 배열은 `"ok"` 다 — **없는 값은 0 이 아니다**
 * (조회 실패는 이 함수가 아니라 `balanceProblemMessage` 의 상태 분기가 말한다).
 */
export function vendorBalanceLevel(
  amounts: readonly BalanceLevelAmount[],
): VendorBalanceLevel {
  if (amounts.length === 0) return "ok";
  if (amounts.every((a) => a.total <= 0)) return "depleted";
  const known = amounts.filter(
    (a) => LOW_BALANCE_THRESHOLDS[a.currency.toUpperCase()] !== undefined,
  );
  if (known.length === 0) return "ok";
  return known.every(
    (a) => a.total <= LOW_BALANCE_THRESHOLDS[a.currency.toUpperCase()],
  )
    ? "low"
    : "ok";
}
