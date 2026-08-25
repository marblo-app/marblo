/**
 * ★비용 축의 **조용한 단절**을 값으로 만든다 (ticket UGTAvo3d1hnxMqKHZ8i9).
 *
 * 이 프로젝트가 오늘까지 같은 종류의 사고를 네 번 밟았다 — 사람축, GA4 조인,
 * 첫스폰, 그리고 이것. 네 번 모두 모양이 같다: **에러가 없다.** 쿼리는 성공하고,
 * 화면은 그려지고, 값만 0 이다. 사람이 월별로 갈라 봐야만 보인다.
 *
 * 그래서 여기서 하는 일은 "0 을 0 이라고 부르지 않는 것" 하나다:
 *
 *   같은 기간에 **워커 비용이 있는데 오케 비용이 0** 이면, 그건 "그 달엔 오케를
 *   안 썼다" 가 아니라 **안 찍혔다** 이다. 워커는 오케가 붙여서 도는 것이므로,
 *   워커가 돈을 썼는데 오케가 0 인 기간은 물리적으로 존재할 수 없다.
 *
 * ★실측 근거 (BQ `marblo-2253d.marblo_telemetry.cost_logs`, 2026-08-24 읽기전용):
 *   2026-04   오케     0행       $0.00   / 워커    141행    $269.98   ← RED
 *   2026-05   오케   165행       $2.42   / 워커    549행      $5.75
 *   2026-06   오케 4,711행  $22,329.33   / 워커 40,125행  $54,084.45  (06-22 까지)
 *   2026-07   오케     0행       $0.00   / 워커 56,756행  $8,506.74   ← RED
 *   2026-08   오케 1,140행   $8,606.23   / 워커 277,962행 $18,411.61  (08-23 부터)
 *
 * 6/22 = `agent:reconnect` unclaimed-JSONL fallback 제거(#231) + machineId
 * 게이트(#235). 8/23 = 오케 비용 수집 재배선(#1107) 이 앱 재시작으로 발효된 날.
 * 즉 7/1~8/22 는 **수집 배선 자체가 없었다.**
 *
 * ★두 번째 규칙이 왜 필요한가 — 8월도 못 믿는다.
 * 2026-08 의 오케 $8,606 중 $6,978.23 이 **단 한 행**이다(08-23 15:18,
 * cacheRead 92.4억 토큰). CostTracker 는 워터마크가 없는 파일을 line 0 부터
 * 읽으므로(`restoreParseState` → null → `newParseState()`), 배선이 붙는 첫 폴이
 * **세션 파일 전체 역사를 한 행으로** 청구한다. 그 파일(152MB)의 실제 구간은
 * 2026-07-19 ~ 08-19 였고, 파일을 날짜별로 다시 합산하면 $6,978.23 이 **센트까지**
 * 재현된다(= 그 행의 $2,904.82 는 7월 지출이 8/23 로 오기된 것이다).
 * 그래서 "한 행이 그 기간 축 전체를 지배" 하면 그 기간 비중은 실사용이 아니다.
 *
 * 이 파일은 **순수함수만** 둔다 — BQ·Firestore·시간을 모른다. 호출부(스크립트,
 * 테스트, 화면)가 버킷을 만들어 넣는다.
 *
 * ★축 id 는 발명하지 않는다. 오케/워커 판정은 `session-kind.ts` 의
 * `isOrchestratorAgentId` 정본을 그대로 쓴다 — 축이 하나 더 생기면 조인이 하나
 * 더 깨진다.
 */

import { isOrchestratorAgentId } from "./session-kind";

// ── 입력 ────────────────────────────────────────────────────────────────

/** `cost_logs` 한 행에서 이 검사가 보는 최소 컬럼. */
export interface CostAxisRow {
  /** ★`cost` 가 아니라 `totalCost` 다 — 컬럼명 오인이 이 표를 한 번 틀리게 읽혔다. */
  totalCost: number;
  agentId: string | null | undefined;
  /** ISO 문자열 또는 Date. 버킷 키는 호출부가 정한 자리수만큼 자른다. */
  timestamp: string | Date;
}

/** 한 기간(일/월)의 두 축 집계. */
export interface CostAxisBucket {
  /** 기간 키. `"2026-07"`(월) 또는 `"2026-07-14"`(일). */
  period: string;
  workerRows: number;
  workerCost: number;
  orchRows: number;
  orchCost: number;
  /** 이 기간 오케 축에서 **가장 비싼 단일 행**. 백필 스파이크 판정용. */
  maxOrchRowCost: number;
  /** 이 기간에 오케 행이 하나라도 있는 날의 수. */
  orchActiveDays: number;
  /** 이 기간에 워커 행이 하나라도 있는 날의 수. */
  workerActiveDays: number;
}

// ── 판정 ────────────────────────────────────────────────────────────────

export type CostAxisSeverity = "ok" | "warn" | "red";

export type CostAxisFindingCode =
  /** ★본 검사의 핵심 — 워커 비용은 있는데 같은 기간 오케 비용이 0. */
  | "orchestrator-silent"
  /** 오케 행이 있긴 한데, 워커가 돈 쓴 날의 일부에만 있다. */
  | "orchestrator-partial"
  /** 그 기간 오케 비용을 단 한 행이 지배한다 = 콜드스타트 백필 의심. */
  | "orchestrator-backfill-dominated";

export interface CostAxisFinding {
  code: CostAxisFindingCode;
  severity: CostAxisSeverity;
  period: string;
  /** 사람이 읽는 한 줄. 숫자를 문장 안에 박아 둔다 — 로그만 봐도 판단되게. */
  detail: string;
  /** 기계가 읽는 근거. 리포트/테스트가 문장 파싱을 하지 않도록. */
  evidence: {
    workerCost: number;
    workerRows: number;
    orchCost: number;
    orchRows: number;
    maxOrchRowCost: number;
    /** 오케 축이 이 기간 비용에서 차지하는 비중(0~1). 축이 비면 0. */
    orchShare: number;
    /** 최대 단일 오케 행이 오케 축 안에서 차지하는 비중(0~1). */
    maxOrchRowShare: number;
    orchActiveDays: number;
    workerActiveDays: number;
  };
}

/**
 * 화면 계약 — 이 기간의 오케 비용을 **어떻게 그려야 하는가**.
 *
 * ★`"unknown"` 을 0 으로 그리면 안 된다. "그 달엔 오케를 안 썼나 보다" 로 읽히고,
 * 기업 고객이 월별 비용에서 7월만 뚝 떨어진 걸 보면 우리 집계 전체를 못 믿는다.
 * 미수집은 0 이 아니라 **미상**이다.
 */
export type OrchestratorCostCoverage =
  /** 그 기간 내내 수집이 돌았다. 값을 그대로 써도 된다. */
  | "collected"
  /** 수집이 아예 없었다(또는 워커 활동일 전부가 오케 0). → 화면엔 "미상". */
  | "unknown"
  /** 값은 있으나 백필/부분수집이 섞였다. → 값 옆에 사유를 붙여야 한다. */
  | "suspect";

/** 한 기간을 어떻게 그릴지. `value: null` 이면 화면은 반드시 "미상" 으로 쓴다. */
export interface OrchestratorCostDisplay {
  coverage: OrchestratorCostCoverage;
  /** 그려도 되는 금액. `null` = 그리지 마라(0 으로도 그리지 마라). */
  value: number | null;
  /** 화면에 그대로 띄울 사유. `collected` 면 null. */
  note: string | null;
}

// ── 임계 ────────────────────────────────────────────────────────────────

/**
 * 한 행이 그 기간 오케 축의 이 비율 이상을 차지하면 백필 의심.
 *
 * 통계적 이상치 탐지가 아니라 **구조적** 판정이다: `cost_logs` 한 행은 15초 폴
 * 델타다. 한 행이 한 달 축의 절반을 넘는다는 건 그 행이 15초가 아니라 훨씬 긴
 * 구간을 담고 있다는 뜻이고, 그건 워터마크 없는 파일을 line 0 부터 읽은 것이다.
 * (2026-08 실측: 81.1%)
 */
export const BACKFILL_DOMINANCE_THRESHOLD = 0.5;

// ── 버킷 만들기 ─────────────────────────────────────────────────────────

/** `timestamp` → `YYYY-MM-DD` (UTC). BQ 가 UTC 로 적재하므로 UTC 로 자른다. */
export function dayKey(ts: string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** `timestamp` → `YYYY-MM` (UTC). */
export function monthKey(ts: string | Date): string {
  return dayKey(ts).slice(0, 7);
}

export type CostAxisGranularity = "day" | "month";

/**
 * 원시 행 → 기간 버킷. 축 판정은 `isOrchestratorAgentId` 정본만 쓴다.
 *
 * ★여기가 축을 가르는 **유일한** 자리다. 호출부가 각자 `LIKE 'orchestrator-%'`
 * 를 쓰기 시작하면 이 사고의 다음 판이 열린다.
 */
export function bucketCostRows(
  rows: readonly CostAxisRow[],
  granularity: CostAxisGranularity = "month"
): CostAxisBucket[] {
  const keyOf = granularity === "day" ? dayKey : monthKey;

  interface Acc {
    bucket: CostAxisBucket;
    orchDays: Set<string>;
    workerDays: Set<string>;
  }
  const acc = new Map<string, Acc>();

  for (const row of rows) {
    const period = keyOf(row.timestamp);
    if (!period) continue;
    const day = dayKey(row.timestamp);
    const cost = Number.isFinite(row.totalCost) ? row.totalCost : 0;

    let entry = acc.get(period);
    if (!entry) {
      entry = {
        bucket: {
          period,
          workerRows: 0,
          workerCost: 0,
          orchRows: 0,
          orchCost: 0,
          maxOrchRowCost: 0,
          orchActiveDays: 0,
          workerActiveDays: 0,
        },
        orchDays: new Set(),
        workerDays: new Set(),
      };
      acc.set(period, entry);
    }

    if (isOrchestratorAgentId(row.agentId)) {
      entry.bucket.orchRows += 1;
      entry.bucket.orchCost += cost;
      if (cost > entry.bucket.maxOrchRowCost)
        entry.bucket.maxOrchRowCost = cost;
      entry.orchDays.add(day);
    } else {
      entry.bucket.workerRows += 1;
      entry.bucket.workerCost += cost;
      entry.workerDays.add(day);
    }
  }

  return [...acc.values()]
    .map(({ bucket, orchDays, workerDays }) => ({
      ...bucket,
      orchActiveDays: orchDays.size,
      workerActiveDays: workerDays.size,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// ── 검사 ────────────────────────────────────────────────────────────────

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function evidenceOf(b: CostAxisBucket): CostAxisFinding["evidence"] {
  return {
    workerCost: b.workerCost,
    workerRows: b.workerRows,
    orchCost: b.orchCost,
    orchRows: b.orchRows,
    maxOrchRowCost: b.maxOrchRowCost,
    orchShare: share(b.orchCost, b.orchCost + b.workerCost),
    maxOrchRowShare: share(b.maxOrchRowCost, b.orchCost),
    orchActiveDays: b.orchActiveDays,
    workerActiveDays: b.workerActiveDays,
  };
}

/**
 * 한 기간을 검사한다. 발견이 없으면 빈 배열.
 *
 * 규칙은 셋뿐이고 전부 **비교가 아니라 물리**에 근거한다:
 *  1. 워커가 돈을 썼는데 오케가 0행  → 존재할 수 없다. 미수집이다.
 *  2. 오케 행이 워커 활동일의 일부에만 있다 → 그 기간 중간에 끊겼다.
 *  3. 한 행이 오케 축의 절반 이상 → 15초 델타가 아니다. 백필이다.
 */
export function inspectCostAxisBucket(b: CostAxisBucket): CostAxisFinding[] {
  const found: CostAxisFinding[] = [];
  const evidence = evidenceOf(b);

  // 1) ★본 검사 — 워커 비용은 있는데 같은 기간 오케 비용이 0.
  if (b.workerCost > 0 && b.orchRows === 0) {
    found.push({
      code: "orchestrator-silent",
      severity: "red",
      period: b.period,
      detail:
        `${b.period}: 워커 ${b.workerRows.toLocaleString()}행 ${usd(
          b.workerCost
        )} 이 있는데 ` +
        `오케 0행. 워커는 오케가 붙여서 도는 것이므로 이 조합은 존재할 수 없다 — ` +
        `"오케를 안 썼다" 가 아니라 **안 찍혔다**. 화면에 0 으로 그리지 말고 "미상" 으로 쓸 것.`,
      evidence,
    });
    return found; // 축이 통째로 비면 아래 두 규칙은 의미가 없다.
  }

  // 2) 중간에 끊겼다 — 워커가 돈 쓴 날의 일부에만 오케 행이 있다.
  if (
    b.orchRows > 0 &&
    b.workerActiveDays > 1 &&
    b.orchActiveDays < b.workerActiveDays
  ) {
    found.push({
      code: "orchestrator-partial",
      severity: "red",
      period: b.period,
      detail:
        `${b.period}: 워커 활동일 ${b.workerActiveDays}일 중 오케 행이 있는 날은 ` +
        `${b.orchActiveDays}일뿐이다. 나머지 ${
          b.workerActiveDays - b.orchActiveDays
        }일은 ` +
        `오케 수집이 끊긴 구간이다 — 이 기간의 오케 비중(${(
          evidence.orchShare * 100
        ).toFixed(1)}%)을 ` +
        `정상치로 쓰면 안 된다.`,
      evidence,
    });
  }

  // 3) 한 행이 축을 지배한다 — 콜드스타트 백필.
  if (
    b.orchCost > 0 &&
    b.maxOrchRowCost >= b.orchCost * BACKFILL_DOMINANCE_THRESHOLD &&
    b.orchActiveDays > 0
  ) {
    found.push({
      code: "orchestrator-backfill-dominated",
      severity: "red",
      period: b.period,
      detail:
        `${b.period}: 오케 ${usd(b.orchCost)} 중 ${usd(b.maxOrchRowCost)} ` +
        `(${(evidence.maxOrchRowShare * 100).toFixed(
          1
        )}%)가 **단 한 행**이다. ` +
        `cost_logs 한 행은 15초 폴 델타이므로 이건 실사용이 아니라 워터마크 없는 ` +
        `세션 파일을 line 0 부터 읽은 콜드스타트 백필이다 — 그 행의 지출은 이 기간이 ` +
        `아니라 파일이 실제로 걸쳐 있던 과거 구간의 것이다.`,
      evidence,
    });
  }

  return found;
}

/** 여러 기간을 한 번에. 기간 순서 유지. */
export function detectCostAxisGaps(
  buckets: readonly CostAxisBucket[]
): CostAxisFinding[] {
  return buckets.flatMap(inspectCostAxisBucket);
}

/** 하나라도 red 면 검사는 RED 다. 스크립트의 종료코드가 여기에 걸린다. */
export function isRed(findings: readonly CostAxisFinding[]): boolean {
  return findings.some((f) => f.severity === "red");
}

// ── 화면 계약 ───────────────────────────────────────────────────────────

/**
 * 이 기간의 오케 비용을 화면에 **어떻게 내보낼지**.
 *
 * ★0 을 돌려주지 않는 것이 요점이다. 미수집 구간에서 `value` 는 `null` 이고,
 * 렌더러는 `null` 을 숫자로 강제 변환하면 안 된다(`?? 0` 금지 — 그게 이 사고를
 * 화면까지 실어 나르는 마지막 한 줄이다).
 */
export function orchestratorCostDisplay(
  b: CostAxisBucket
): OrchestratorCostDisplay {
  const findings = inspectCostAxisBucket(b);
  const silent = findings.find((f) => f.code === "orchestrator-silent");
  if (silent) {
    return {
      coverage: "unknown",
      value: null,
      note: `${b.period} 오케 비용 미상 — 이 기간 수집이 돌지 않았다(워커 ${usd(
        b.workerCost
      )} 는 수집됨).`,
    };
  }

  const partial = findings.find((f) => f.code === "orchestrator-partial");
  const backfill = findings.find(
    (f) => f.code === "orchestrator-backfill-dominated"
  );
  if (partial || backfill) {
    const reasons: string[] = [];
    if (partial) {
      reasons.push(
        `수집이 ${b.workerActiveDays}일 중 ${b.orchActiveDays}일만 돌았다`
      );
    }
    if (backfill) {
      reasons.push(
        `${usd(b.maxOrchRowCost)} 는 과거 구간을 한 행으로 몰아 청구한 백필이다`
      );
    }
    return {
      coverage: "suspect",
      value: b.orchCost,
      note: `${b.period} 오케 비용 부분수집 — ${reasons.join(
        "; "
      )}. 비중을 정상치로 쓰지 말 것.`,
    };
  }

  return { coverage: "collected", value: b.orchCost, note: null };
}

// ── 리포트 ──────────────────────────────────────────────────────────────

/** 스크립트/로그가 그대로 뿌리는 한 덩어리. 사람이 읽을 것을 전제로 한다. */
export function formatCostAxisReport(
  buckets: readonly CostAxisBucket[],
  findings: readonly CostAxisFinding[]
): string {
  const lines: string[] = [];
  lines.push(
    "기간       오케행     오케$        워커행       워커$        오케비중  판정"
  );
  for (const b of buckets) {
    const d = orchestratorCostDisplay(b);
    const pct = share(b.orchCost, b.orchCost + b.workerCost) * 100;
    const verdict =
      d.coverage === "collected"
        ? "ok"
        : d.coverage === "unknown"
        ? "RED 미상"
        : "RED 의심";
    lines.push(
      [
        b.period.padEnd(10),
        String(b.orchRows).padStart(8),
        usd(b.orchCost).padStart(12),
        String(b.workerRows).padStart(10),
        usd(b.workerCost).padStart(12),
        `${pct.toFixed(1)}%`.padStart(8),
        `  ${verdict}`,
      ].join("")
    );
  }
  if (findings.length === 0) {
    lines.push("", "발견 없음.");
    return lines.join("\n");
  }
  lines.push("", `발견 ${findings.length}건:`);
  for (const f of findings) {
    lines.push(`  [${f.severity.toUpperCase()}] ${f.code} — ${f.detail}`);
  }
  return lines.join("\n");
}
