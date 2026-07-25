/**
 * P2-4 — 모델별 효과집계: `(model@effort, 난도, taskType) → 성공률 · 비용 · 비용당성공`.
 *
 * ── 데이터 출처(★조인이 어디서 일어나는가) ──────────────────────────────
 * 설계문서 §3 넷-뉴 3 은 이 지표를 `task_outcomes ⋈ cost_logs on taskId` 로 정의한다.
 * 그 조인은 **이미 `tasks/{id}` 문서에서 물질화돼 있다**:
 *   - `costTotal`/`costInputTokens`/`costOutputTokens` — `services/taskRollups.ts` 가
 *     `cost_logs` 와 같은 taskId 스탬프(조인률 98.6%)로 누적한 per-task 비용.
 *   - `dispatchMeta.{spawnedModelKey, model, complexity, taskType, role}` — dispatch
 *     시점 결정. `spawnedModelKey` 는 실제 스폰 argv 관측(P2-2/P2-3).
 *   - `status` — DONE/FAILED/BLOCKED. `task_outcomes.success` 가 이 값에서 파생된다
 *     (`src/lib/telemetry/taskOutcome.ts`: DONE=성공, FAILED/BLOCKED=실패).
 * 그래서 BigQuery 왕복 없이 같은 정의를 이 Mac 에서 바로 계산할 수 있고, 오케가
 * MCP 도구로 즉시 읽을 수 있다. (BQ 쪽 동일 집계는 같은 필드로 SQL 을 쓰면 된다 —
 * 정의가 한 곳에 있다는 게 요점이다.)
 *
 * ── 규율: 없는 숫자를 만들지 않는다 ─────────────────────────────────────
 * 1. **터미널 상태만 센다.** 진행중 티켓은 성공도 실패도 아니다 → `skipped` 로 세어
 *    보고한다(빠진 걸 조용히 0 으로 만들지 않는다).
 * 2. **비용 0/누락 ≠ 비용 0원.** 비용 롤업이 없는 행은 `costedN` 에서 빠지고,
 *    `avgCost`·`successPerDollar` 는 그 행들을 제외한 값이며 `costCoverage` 로
 *    "몇 %가 실제 비용을 갖고 있나" 를 함께 보고한다. 비용 합이 0 이면
 *    `successPerDollar` 는 **null**(∞ 아님).
 * 3. **해상도를 표시한다.** `spawnedModelKey` 가 있는 행은 `model@effort`,
 *    구 dispatchMeta 만 있는 행은 `provider` 다. 둘을 한 칸에 섞지 않는다 —
 *    섞으면 "claude 평균" 이 변종별 판단으로 오독된다.
 * 4. **임계값·판정 없음.** "5.5 low 로 충분한가" 같은 결론은 데이터가 쌓인 뒤
 *    사람이 내린다(설계문서 §3 검증법 "판정 보류").
 */

/** 집계 입력 한 행 = `tasks/{id}` 하나. */
export interface EffectivenessInputRow {
  taskId: string;
  /** 보드 상태 원문(DONE/FAILED/BLOCKED/IN_PROGRESS/…). */
  status?: string | null;
  /** dispatchMeta.spawnedModelKey — 실제 스폰 관측 키(`gpt-5.5@medium`). */
  spawnedModelKey?: string | null;
  /** dispatchMeta.model — 프로바이더(claude/gpt/…). 구 문서의 유일한 모델 축. */
  provider?: string | null;
  complexity?: string | null;
  taskType?: string | null;
  role?: string | null;
  /** tasks/{id}.costTotal (USD). 누락/음수/비유한 → 비용 미측정으로 취급. */
  costTotal?: number | null;
}

/** 모델 축의 해상도. 한 칸 안에서는 항상 하나다. */
export type ModelKeyResolution = "model@effort" | "provider";

export interface EffectivenessCell {
  modelKey: string;
  resolution: ModelKeyResolution;
  complexity: string;
  taskType: string;
  /** 터미널 티켓 수(=성공+실패). */
  n: number;
  successes: number;
  failures: number;
  /** successes / n. */
  successRate: number;
  /** 비용 롤업이 있는 티켓 수. */
  costedN: number;
  /** 그 티켓들의 비용 합(USD). */
  costTotal: number;
  /** costTotal / costedN — 비용 미측정 행은 분모에서 빠진다. null = 측정 0건. */
  avgCost: number | null;
  /** costedN / n — 이 칸의 비용 축을 얼마나 믿을 수 있나. */
  costCoverage: number;
  /**
   * ★비용당성공 = (비용측정 티켓 중 성공 수) / costTotal.
   * 분자도 비용측정 부분집합으로 맞춘다 — 전체 성공 수를 부분 비용으로 나누면
   * 비용 커버리지가 낮은 칸이 실제보다 효율적으로 보인다. costTotal ≤ 0 → null.
   */
  successPerDollar: number | null;
  /** 위 분자 — 감사용으로 노출한다. */
  costedSuccesses: number;
}

export interface EffectivenessReport {
  cells: EffectivenessCell[];
  totals: {
    rows: number;
    counted: number;
    successes: number;
    failures: number;
    costTotal: number;
    costedN: number;
  };
  /** 왜 빠졌는지 — 침묵하지 않는다. */
  skipped: {
    /** 아직 터미널이 아닌 티켓. */
    nonTerminal: number;
    /** 모델 축을 못 잡은 티켓(dispatchMeta 자체가 없음). */
    noModel: number;
  };
}

const SUCCESS_STATUSES = new Set(["DONE"]);
const FAILURE_STATUSES = new Set(["FAILED", "BLOCKED"]);

const UNKNOWN = "-";

function label(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v ? v.toLowerCase() : UNKNOWN;
}

function finiteCost(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * 순수 집계. 입력 순서에 무결하고, 셀 정렬은 (n desc, modelKey, complexity,
 * taskType) 로 결정적이다.
 */
export function aggregateEffectiveness(
  rows: readonly EffectivenessInputRow[],
): EffectivenessReport {
  const cells = new Map<string, EffectivenessCell>();
  const skipped = { nonTerminal: 0, noModel: 0 };
  const totals = {
    rows: rows.length,
    counted: 0,
    successes: 0,
    failures: 0,
    costTotal: 0,
    costedN: 0,
  };

  for (const row of rows) {
    const status = (row.status ?? "").trim().toUpperCase();
    const success = SUCCESS_STATUSES.has(status);
    const failure = FAILURE_STATUSES.has(status);
    if (!success && !failure) {
      skipped.nonTerminal++;
      continue;
    }
    const precise = (row.spawnedModelKey ?? "").trim();
    const provider = (row.provider ?? "").trim();
    if (!precise && !provider) {
      skipped.noModel++;
      continue;
    }
    const modelKey = (precise || provider).toLowerCase();
    const resolution: ModelKeyResolution = precise
      ? "model@effort"
      : "provider";
    const complexity = label(row.complexity);
    const taskType = label(row.taskType);
    const key = `${modelKey}|${complexity}|${taskType}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        modelKey,
        resolution,
        complexity,
        taskType,
        n: 0,
        successes: 0,
        failures: 0,
        successRate: 0,
        costedN: 0,
        costTotal: 0,
        avgCost: null,
        costCoverage: 0,
        successPerDollar: null,
        costedSuccesses: 0,
      };
      cells.set(key, cell);
    }
    cell.n++;
    if (success) cell.successes++;
    else cell.failures++;
    const cost = finiteCost(row.costTotal);
    if (cost !== null) {
      cell.costedN++;
      cell.costTotal += cost;
      if (success) cell.costedSuccesses++;
      totals.costedN++;
      totals.costTotal += cost;
    }
    totals.counted++;
    if (success) totals.successes++;
    else totals.failures++;
  }

  const out = [...cells.values()];
  for (const cell of out) {
    cell.successRate = cell.n > 0 ? cell.successes / cell.n : 0;
    cell.costCoverage = cell.n > 0 ? cell.costedN / cell.n : 0;
    cell.avgCost = cell.costedN > 0 ? cell.costTotal / cell.costedN : null;
    cell.successPerDollar =
      cell.costTotal > 0 ? cell.costedSuccesses / cell.costTotal : null;
  }
  out.sort(
    (a, b) =>
      b.n - a.n ||
      a.modelKey.localeCompare(b.modelKey) ||
      a.complexity.localeCompare(b.complexity) ||
      a.taskType.localeCompare(b.taskType),
  );
  return { cells: out, totals, skipped };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * 오케가 그대로 읽는 텍스트 리포트. 데이터가 얇을 때 "얇다" 고 말하는 것이 이
 * 포매터의 절반이다 — 표만 보여주면 n=1 짜리 칸이 결론처럼 읽힌다.
 */
export function formatEffectivenessReport(
  report: EffectivenessReport,
  opts: { scanned: number; cap: number } = { scanned: 0, cap: 0 },
): string {
  const { totals, skipped, cells } = report;
  const lines: string[] = [];
  lines.push(
    `라우팅 효과집계 — (model@effort × 난도 × taskType). 스캔 ${opts.scanned}건` +
      (opts.cap && opts.scanned >= opts.cap
        ? ` (★상한 ${opts.cap} 에 걸렸다 — 더 오래된 티켓은 이 집계에 없다)`
        : ""),
  );
  lines.push(
    `집계대상 ${totals.counted}건(성공 ${totals.successes} / 실패 ${totals.failures})` +
      ` · 제외: 진행중 ${skipped.nonTerminal}, 모델미상 ${skipped.noModel}` +
      ` · 비용측정 ${totals.costedN}/${totals.counted}건 합계 ` +
      // 측정 0건에 "$0.0000" 을 찍으면 "공짜였다" 로 읽힌다. 칸 단위에서 지키는
      // 규율(미측정 ≠ 0원)을 총계에서도 지킨다.
      `${totals.costedN > 0 ? usd(totals.costTotal) : "미측정"}`,
  );
  if (cells.length === 0) {
    lines.push(
      "칸이 없다. 터미널 상태 + dispatchMeta 를 가진 티켓이 아직 없다는 뜻이다(콜드=결론없음).",
    );
    return lines.join("\n");
  }
  lines.push("");
  lines.push(
    "| model@effort | 해상도 | 난도 | taskType | n | 성공률 | 평균비용 | 비용당성공 | 비용커버리지 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of cells) {
    lines.push(
      `| ${c.modelKey} | ${c.resolution} | ${c.complexity} | ${c.taskType} | ${c.n}` +
        ` | ${pct(c.successRate)} (${c.successes}/${c.n})` +
        ` | ${c.avgCost === null ? "미측정" : usd(c.avgCost)}` +
        ` | ${
          c.successPerDollar === null
            ? "미측정"
            : `${c.successPerDollar.toFixed(1)}/$`
        }` +
        ` | ${pct(c.costCoverage)} |`,
    );
  }
  lines.push("");
  lines.push(
    "★읽는 법: `해상도=provider` 인 칸은 dispatchMeta 에 실스폰 model@effort 가 없던 " +
      "(P2-2 이전) 티켓이다 — 변종별 판단의 근거로 쓰지 말 것. `비용커버리지` 가 낮은 " +
      "칸의 비용 축은 아직 신뢰할 수 없다. n 이 작은 칸으로 모델 우열을 판정하지 말라 " +
      "(임계값은 데이터가 쌓인 뒤 사람이 정한다).",
  );
  return lines.join("\n");
}
