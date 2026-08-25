/**
 * 비용 축 연속성 검사 — **실데이터에 대고** 돌린다 (ticket UGTAvo3d1hnxMqKHZ8i9).
 *
 * 왜 스크립트인가: 픽스처만 검사하는 가드는 이 사고를 못 막는다. 이 사고는
 * "코드가 틀렸다" 가 아니라 "코드가 맞는데 아무것도 안 들어온다" 이기 때문이다.
 * 사람이 월별로 갈라 봐야만 발견되던 그 갈라보기를, 여기서 한 번에 한다.
 *
 * 하는 일:
 *   BQ `cost_logs` 를 **읽기전용**으로 월/일 단위 집계 → `cost-axis-continuity`
 *   의 순수 판정에 통과 → red 가 하나라도 있으면 종료코드 1.
 *
 * 사용:
 *   npm run cost:axis-check                    # 전체 기간, 월 단위
 *   npm run cost:axis-check -- --since 2026-07 # 그 이후만
 *   npm run cost:axis-check -- --daily         # 일 단위(어느 날 끊겼는지 본다)
 *   npm run cost:axis-check -- --json          # 기계 판독용
 *
 * 인증: john.kim ADC. `gcloud auth print-access-token` 으로 토큰만 받아 REST 를
 * 친다 — 새 npm 의존성 없음, 자격증명은 프로세스 밖으로 나가지 않고 출력에도
 * 실리지 않는다. 쿼리는 SELECT 뿐이고 원본 표를 건드리지 않는다.
 *
 * ★uid·이메일 같은 식별자는 SELECT 하지 않는다. 이 검사에 필요한 건 축과 금액뿐이다.
 */
import { execFileSync } from "node:child_process";

import {
  detectCostAxisGaps,
  formatCostAxisReport,
  isRed,
  orchestratorCostDisplay,
  type CostAxisBucket,
  type CostAxisFinding,
} from "../cost-axis-continuity";
import { ORCHESTRATOR_AGENT_ID_PREFIX } from "../session-kind";

const PROJECT_ID = "marblo-2253d";
const DATASET = "marblo_telemetry";
const TABLE = "cost_logs";
const LOCATION = "US";

interface Args {
  since: string | null;
  daily: boolean;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const sinceIdx = argv.indexOf("--since");
  return {
    since: sinceIdx >= 0 ? argv[sinceIdx + 1] ?? null : null,
    daily: argv.includes("--daily"),
    json: argv.includes("--json"),
  };
}

function accessToken(): string {
  try {
    return execFileSync("gcloud", ["auth", "print-access-token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(
      "ADC 토큰을 얻지 못했다. `gcloud auth application-default login` 후 다시 시도하라. " +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * 집계는 BQ 에서 끝낸다 — 34만 행을 클라이언트로 끌어올 이유가 없다.
 *
 * ★축 판정 문자열은 `session-kind.ts` 의 정본 접두를 그대로 파라미터로 넘긴다.
 * SQL 안에 `'orchestrator-%'` 를 손으로 적으면 축 정의가 두 벌이 된다.
 */
function buildQuery(args: Args): { sql: string; prefix: string } {
  const grain = args.daily
    ? 'FORMAT_TIMESTAMP("%Y-%m-%d", timestamp)'
    : 'FORMAT_TIMESTAMP("%Y-%m", timestamp)';
  const where = args.since
    ? 'WHERE FORMAT_TIMESTAMP("%Y-%m-%d", timestamp) >= @since'
    : "";
  const sql = `
      WITH tagged AS (
        SELECT
          ${grain} AS period,
          FORMAT_TIMESTAMP("%Y-%m-%d", timestamp) AS day,
          agentId LIKE @prefix AS is_orch,
          totalCost
        FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\`
        ${where}
      )
      SELECT
        period,
        COUNTIF(NOT is_orch) AS workerRows,
        IFNULL(SUM(IF(NOT is_orch, totalCost, 0)), 0) AS workerCost,
        COUNTIF(is_orch) AS orchRows,
        IFNULL(SUM(IF(is_orch, totalCost, 0)), 0) AS orchCost,
        IFNULL(MAX(IF(is_orch, totalCost, NULL)), 0) AS maxOrchRowCost,
        COUNT(DISTINCT IF(is_orch, day, NULL)) AS orchActiveDays,
        COUNT(DISTINCT IF(NOT is_orch, day, NULL)) AS workerActiveDays
      FROM tagged
      GROUP BY period
      ORDER BY period
    `;
  return { sql, prefix: `${ORCHESTRATOR_AGENT_ID_PREFIX}%` };
}

interface BqField {
  name: string;
}
interface BqCell {
  v: string | null;
}
interface BqRow {
  f: BqCell[];
}
interface BqResponse {
  schema?: { fields: BqField[] };
  rows?: BqRow[];
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  jobComplete?: boolean;
}

async function runQuery(args: Args): Promise<CostAxisBucket[]> {
  const { sql, prefix } = buildQuery(args);
  const token = accessToken();

  const queryParameters: Array<Record<string, unknown>> = [
    {
      name: "prefix",
      parameterType: { type: "STRING" },
      parameterValue: { value: prefix },
    },
  ];
  if (args.since) {
    // `--since 2026-07` 은 그 달 1일부터로 읽는다.
    const since = args.since.length === 7 ? `${args.since}-01` : args.since;
    queryParameters.push({
      name: "since",
      parameterType: { type: "STRING" },
      parameterValue: { value: since },
    });
  }

  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        location: LOCATION,
        timeoutMs: 120_000,
        parameterMode: "NAMED",
        queryParameters,
      }),
    }
  );

  const body = (await res.json()) as BqResponse;
  if (!res.ok || body.error || body.errors?.length) {
    const msg =
      body.error?.message ?? body.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`BigQuery 질의 실패: ${msg}`);
  }

  const fields = body.schema?.fields ?? [];
  const idx = (name: string): number =>
    fields.findIndex((f) => f.name === name);
  const num = (row: BqRow, name: string): number => {
    const i = idx(name);
    if (i < 0) return 0;
    const v = row.f[i]?.v;
    const n = v == null ? 0 : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (body.rows ?? []).map((row) => ({
    period: row.f[idx("period")]?.v ?? "",
    workerRows: num(row, "workerRows"),
    workerCost: num(row, "workerCost"),
    orchRows: num(row, "orchRows"),
    orchCost: num(row, "orchCost"),
    maxOrchRowCost: num(row, "maxOrchRowCost"),
    orchActiveDays: num(row, "orchActiveDays"),
    workerActiveDays: num(row, "workerActiveDays"),
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const buckets = await runQuery(args);
  const findings: CostAxisFinding[] = detectCostAxisGaps(buckets);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          granularity: args.daily ? "day" : "month",
          red: isRed(findings),
          buckets: buckets.map((b) => ({
            ...b,
            display: orchestratorCostDisplay(b),
          })),
          findings,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `비용 축 연속성 검사 — ${PROJECT_ID}.${DATASET}.${TABLE} ` +
        `(${args.daily ? "일" : "월"} 단위${
          args.since ? `, ${args.since} 이후` : ""
        })\n`
    );
    console.log(formatCostAxisReport(buckets, findings));
  }

  if (isRed(findings)) {
    console.error(
      `\n★RED — 비용 축이 끊긴 기간이 있다. 위 기간의 오케 비용을 화면에 0 으로 그리면 안 된다.`
    );
    process.exitCode = 1;
    return;
  }
  console.log("\n연속성 이상 없음.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
