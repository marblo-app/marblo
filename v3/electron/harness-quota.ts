/**
 * 하네스별 잔여 쿼터의 **단일 합성 지점**.
 *
 * ── 왜 이 파일이 있나(티켓 AS4noeJq) ─────────────────────────────────────
 * 같은 "잔여 쿼터" 를 세 곳이 읽는데 각자 합성하고 있었다:
 *
 *   · Usage 탭      — `getAccountRateLimits()` 를 창(5h/weekly)별로 그린다.
 *   · dispatch 라우팅 — bridge-server 안의 사설 헬퍼 두 개가 계정 프로브와
 *                     주간 토큰 롤업을 max 합성해 `budgetSnapshot` 을 만들었다.
 *   · get_model_guidance — 아무것도 안 봤다(오케가 explicit 핀을 할 때 잔여를
 *                     못 보는 사각이었다).
 *
 * 같은 사실을 세 번 합성하면 언젠가 갈라진다. 그래서 합성은 여기 한 번만 하고,
 * dispatch 도 guidance 도 **이 함수의 결과**를 쓴다(읽는 셀 = 쓰는 셀).
 *
 * ── 두 소스와 그 서열 ────────────────────────────────────────────────────
 *   1. **계정 프로브**(`account-usage.getAccountRateLimits`) — Usage 탭이 화면에
 *      그리는 그 실측이다. claude 는 헤드리스 `get_usage`, gpt 는 codex
 *      app-server `account/rateLimits/read`. 창이 둘(5h·weekly)일 수 있어
 *      **더 빡센 쪽**(max)을 쓴다 — 어느 창이든 먼저 닿는 벽이 진짜 제약이다.
 *   2. **주간 토큰 롤업**(`usage-rollup`) — cost_logs 로컬 거울에서 파생한
 *      *추정치*다(list-price·soft limit 기반). **실측이 없을 때만** 발언한다.
 *
 * ★서열이 max 가 아니라 "실측 우선" 인 이유(라이브 측정 2026-08-07): 종전 코드는
 * 둘을 max 합성했는데, 그 추정치가 정상 운용 기기에서 **상시 100% 로 포화**돼
 * 있었다(아래 `weeklyRollupCap` 주석의 자릿수 문제). 그래서 계정 실측이 "claude
 * 10% 사용" 이라고 말하는데도 라우터는 89~100% 를 읽었다 — Usage 탭 화면과
 * 라우터가 88%p 갈라진 상태였고, 그게 이 티켓이 잡으러 온 그 불변식 위반이다.
 * 실측이 있으면 실측이 정본이다. 추정치는 그 자리를 메우는 용도지 덮어쓰는
 * 용도가 아니다. 대신 **얼마나 벌어졌는지**를 같이 돌려준다 — 조용히 다른 두
 * 숫자가 굴러다니는 상태를 만들지 않기 위해서다.
 *
 * ★grok 이 없는 것은 누락이 아니다. Grok Build CLI 에는 usage/quota 명령이
 * 없어서(#713) 프로브가 구조적으로 null 이고, null 을 0% 사용으로 접으면
 * "쿼터 무한" 이라는 없는 사실을 라우터에 먹인다. 그래서 키 자체를 만들지 않고
 * `budgetBiasScore` 가 no-data → 중립(0)으로 처리하게 둔다.
 */

import type { ModelBudgetSnapshot, ModelType } from "./dispatch-scoring";
import type { AccountRateLimits } from "./account-usage";
import type { RateLimitInfo } from "./session-parsers";
import {
  weeklyUsedPercentForHarness,
  type UsageRollupSnapshot,
} from "./usage-rollup";

/** 오늘 계정 잔여를 **실제로 조회할 수 있는** 하네스. */
export const QUOTA_PROBED_HARNESSES = ["claude", "gpt"] as const;
export type QuotaHarness = (typeof QUOTA_PROBED_HARNESSES)[number];

/**
 * 두 소스가 이 %p 이상 벌어지면 계측 로그를 남긴다. 값 자체가 틀렸다는 뜻은
 * 아니다(추정치와 실측은 원래 다르다) — 한쪽이 통째로 깨졌을 때 그 사실이
 * 눈에 보이게 하려는 임계다.
 */
export const QUOTA_DIVERGENCE_WARN_PCT = 15;

/**
 * ★추정치는 **차단을 말하지 못한다**(라이브 실측 2026-08-07, 티켓 AS4noeJq).
 *
 * 무엇이 있었나: `HARNESS_WEEKLY_TOKEN_SOFT_LIMIT`(claude 80M / gpt 60M 주간
 * 토큰)은 실제 사용량과 자릿수가 다르다. 이 개발 Mac 의 `usage-weekly.json` 은
 * **하루치**로 claude 161M(=201%), gpt 510M(=850%) 였다 — 롤업이 세는 토큰에
 * 캐시 read/write 가 포함되기 때문이다(`recordUsageDelta`). 그래서
 * `weeklyUsedPercentForHarness` 는 정상 운용 중인 기기에서 **상시 100%** 로
 * 포화돼 있었고, 그 값이 계정 실측과 max 합성되면
 *
 *     usedPercent 100 → budgetBiasScore → bias=null → "모든 후보 소진"
 *
 * 이 되어 model 미지정 dispatch 가 통째로 차단됐다. 즉 관측된 "완전소진 자동차단"
 * 의 절반은 진짜 쿼터가 아니라 **추정치의 포화**였다.
 *
 * 원칙: 실측(계정 프로브)만 "멈춰" 라고 말할 수 있고, 추정치는 "아껴" 까지만
 * 말한다. 그래서 롤업 기여분을 예비선 **바로 위**에서 자른다 — 추정치 혼자서는
 * 소진 하드게이트도, near-limit 후보 제외도 발동시키지 못한다. 계정 실측이
 * 그보다 빡세면 실측이 그대로 이긴다(캡은 롤업 쪽에만 걸린다).
 *
 * ★한도 상수 자체의 재측정은 별건이다. 여기서 임의로 새 숫자를 박으면 그것도
 * 같은 죄(없는 사실 만들기)라, 포화가 관측되면 로그로 드러내고 상수는 측정
 * 근거가 생길 때 고친다.
 */
export function weeklyRollupCap(reservePct: number): number {
  return Math.max(0, Math.min(100, 100 - reservePct - 1));
}

export type QuotaSource = "account-probe" | "weekly-rollup" | "none";

export interface HarnessQuotaRow {
  harness: QuotaHarness;
  /** 라우터가 실제로 읽는 값(두 소스 중 더 빡센 쪽). 없으면 null. */
  usedPercent: number | null;
  /** 100 − usedPercent. 없으면 null(= 모름, 0% 잔여가 아니다). */
  remainingPercent: number | null;
  /** Usage 탭이 그리는 계정 프로브 실측(창 중 더 빡센 쪽). */
  accountUsedPercent: number | null;
  /** cost_logs 로컬 거울 기반 주간 추정치 **원값**(캡 전). */
  weeklyRollupUsedPercent: number | null;
  /**
   * 추정치가 캡에 걸렸나(= soft-limit 상수가 실사용과 자릿수가 다르다는 신호).
   * `weeklyRollupCap` 주석 참조 — 캡에 걸린 추정치는 차단을 발동시키지 않는다.
   */
  weeklyRollupCapped: boolean;
  /** 위 값이 어디서 왔나. */
  source: QuotaSource;
  /** 두 소스 차이(%p). 둘 다 있을 때만. */
  divergencePct: number | null;
  /** 계정 프로브가 말한 요금제(있으면). */
  planType: string | null;
}

function maxWindowPercent(info: RateLimitInfo | null): number | null {
  if (!info) return null;
  const readings = [info.primaryPercent, info.secondaryPercent].filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p),
  );
  if (readings.length === 0) return null;
  return Math.max(...readings);
}

/**
 * 계정 프로브 + 주간 롤업 → 하네스별 잔여 한 줄씩.
 * 순수 함수다(프로브 호출·파일 읽기는 호출자 몫) — 그래서 유닛테스트가
 * 설치된 CLI 없이 합성 규칙 자체를 고정할 수 있다.
 */
export function harnessQuotaRows(
  rateLimits: Partial<AccountRateLimits> | null | undefined,
  usage: UsageRollupSnapshot | null | undefined,
  opts: { reservePct?: number } = {},
): HarnessQuotaRow[] {
  const cap = weeklyRollupCap(opts.reservePct ?? 10);
  return QUOTA_PROBED_HARNESSES.map((harness) => {
    const info = rateLimits?.[harness] ?? null;
    const accountUsedPercent = maxWindowPercent(info);
    const weeklyRollupUsedPercent = usage
      ? weeklyUsedPercentForHarness(harness, usage)
      : null;
    // ★추정치는 캡을 넘지 못한다 — 차단은 실측만 말한다(weeklyRollupCap 주석).
    const cappedRollup =
      typeof weeklyRollupUsedPercent === "number"
        ? Math.min(weeklyRollupUsedPercent, cap)
        : null;

    // ★실측 우선. 추정치는 실측이 없을 때만 자리를 메운다(파일 헤더 참조).
    let usedPercent: number | null = null;
    let source: QuotaSource = "none";
    if (typeof accountUsedPercent === "number") {
      usedPercent = accountUsedPercent;
      source = "account-probe";
    } else if (typeof cappedRollup === "number") {
      usedPercent = cappedRollup;
      source = "weekly-rollup";
    }

    return {
      harness,
      usedPercent,
      remainingPercent:
        usedPercent === null
          ? null
          : 100 - Math.min(100, Math.max(0, usedPercent)),
      accountUsedPercent,
      weeklyRollupUsedPercent,
      weeklyRollupCapped:
        typeof weeklyRollupUsedPercent === "number" &&
        weeklyRollupUsedPercent > cap,
      source,
      // 불일치는 **원값**으로 잰다 — 캡 후 값으로 재면 캡이 불일치를 가려 버려서
      // "soft-limit 상수가 자릿수부터 틀렸다" 는 사실이 로그에서 사라진다.
      divergencePct:
        typeof accountUsedPercent === "number" &&
        typeof weeklyRollupUsedPercent === "number"
          ? Math.abs(accountUsedPercent - weeklyRollupUsedPercent)
          : null,
      planType: info?.planType ?? null,
    };
  });
}

/**
 * 라우팅이 읽는 예산 스냅샷. 값이 없는 하네스는 **키를 만들지 않는다** —
 * `budgetBiasScore` 가 그 부재를 중립(0)으로 읽는 것이 계약이다.
 */
export function budgetSnapshotFromQuotaRows(
  rows: readonly HarnessQuotaRow[],
): ModelBudgetSnapshot {
  const budgets: ModelBudgetSnapshot = {};
  for (const row of rows) {
    if (typeof row.usedPercent !== "number") continue;
    budgets[row.harness as ModelType] = { usedPercent: row.usedPercent };
  }
  return budgets;
}

/**
 * 계측용 — 두 소스가 임계 이상 벌어진 행. 비어 있으면 로그도 없다.
 * "Usage 탭 수치 == autoselect 가 읽는 수치" 불변식이 깨지면 여기서 드러난다.
 */
export function quotaDivergences(
  rows: readonly HarnessQuotaRow[],
  warnPct: number = QUOTA_DIVERGENCE_WARN_PCT,
): HarnessQuotaRow[] {
  return rows.filter(
    (row) =>
      typeof row.divergencePct === "number" && row.divergencePct >= warnPct,
  );
}

/** 로그 한 줄(사람이 읽는다). 시크릿·계정 식별자는 담지 않는다. */
export function formatQuotaRow(row: HarnessQuotaRow): string {
  if (row.usedPercent === null) {
    return `${row.harness}: 잔여 no-data(프로브·롤업 둘 다 없음)`;
  }
  const acct =
    row.accountUsedPercent === null
      ? "계정프로브 없음"
      : `계정프로브 ${Math.round(row.accountUsedPercent)}% 사용`;
  const roll =
    row.weeklyRollupUsedPercent === null
      ? "주간롤업 없음"
      : `주간롤업 ${Math.round(row.weeklyRollupUsedPercent)}% 사용` +
        (row.weeklyRollupCapped
          ? "(★포화 — soft-limit 상수가 실사용과 자릿수가 다르다. 캡 적용: 추정치는 차단을 발동하지 못한다)"
          : "");
  return (
    `${row.harness}: 잔여 ${Math.round(row.remainingPercent!)}% ` +
    `(채택=${row.source}; ${acct}, ${roll}` +
    (row.planType ? `, plan=${row.planType}` : "") +
    ")"
  );
}
