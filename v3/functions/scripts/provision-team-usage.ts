// 팀 오버뷰 BigQuery 뷰를 **실제로 만든다** (설계 §10-T2,
// docs/team-usage-overview-design-2026-08-21.md).
//
// 실행:
//   cd v3/functions && npm run provision:team-usage            # dry-run(기본)
//   cd v3/functions && npm run provision:team-usage -- --apply # 실제 생성
//   cd v3/functions && npm run provision:team-usage -- --apply --replace-views
//
// ── ★이 스크립트가 하지 않는 것 (되돌릴 수 없는 쪽) ─────────────────────────
//   - DROP / ALTER / DELETE / TRUNCATE / INSERT 를 **한 줄도 내보내지 않는다.**
//   - ★원본 원장(cost_logs)을 만들지도 고치지도 않는다. 있는지 **확인만** 한다.
//     스키마 변경·파티셔닝은 이 티켓이 금지당한 행위다(별건 티켓 + 명시 승인).
//   - 뷰가 이미 있고 본문이 다르면 `--replace-views` 없이는 바꾸지 않는다.
//
// ── 만드는 것 ───────────────────────────────────────────────────────────────
//   1) `marblo_telemetry.v_team_usage_daily`        — 일별 팀 사용량(계정축)
//   2) `marblo_telemetry.v_team_usage_unattributed` — 귀속 불가 행의 **규모만**
//
// ★게이트(`TEAM_USAGE_EFFECTIVE_FROM`)와 무관하게 만들어도 안전하다. 게이트는
//   뷰가 아니라 **콜러블**이 적용한다(`day >= @fromDay`) — 뷰 자체는 원장의 접기
//   그 이상이 아니고, 접근은 IAM 이 가른다. 이 점이 사람 축 뷰와 다르다.

import { BigQuery } from "@google-cloud/bigquery";

import { assertAxisPurity, type BqField } from "../src/analyticsProfiles";
import {
  SOURCE_TABLE_COST_LOGS,
  TEAM_USAGE_DAILY_SCHEMA,
  TEAM_USAGE_DATASET,
  TEAM_USAGE_UNATTRIBUTED_SCHEMA,
  VIEW_TEAM_USAGE_DAILY,
  VIEW_TEAM_USAGE_UNATTRIBUTED,
  buildTeamUsageDailyViewDdl,
  buildTeamUsageDailyViewSql,
  buildTeamUsageUnattributedViewDdl,
  buildTeamUsageUnattributedViewSql,
} from "../src/teamUsage";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts 의 BQ_LOCATION 과 같아야 한다.

const APPLY = process.argv.includes("--apply");
const REPLACE_VIEWS = process.argv.includes("--replace-views");

const bigquery = new BigQuery({ projectId: PROJECT_ID, location: BQ_LOCATION });

const problems: string[] = [];
const actions: string[] = [];

function note(line: string): void {
  console.log(line);
}

function fail(line: string): void {
  problems.push(line);
  console.error(`[fail] ${line}`);
}

/**
 * 뷰 본문을 비교 가능한 모양으로 접는다. BigQuery 는 `AS` 앞뒤의 주석 블록을
 * 저장하지 않아서, 빌더 출력과 저장본을 그대로 비교하면 항상 "다르다" 가 나온다
 * (provision-person-axis.ts 가 실측으로 겪은 자리 — 그대로 계승한다).
 */
function normalizeViewBody(sql: string): string {
  const lines = sql.split("\n");
  const isTrim = (l: string): boolean =>
    l.trim().length === 0 || l.trim().startsWith("--");
  let start = 0;
  while (start < lines.length && isTrim(lines[start])) start += 1;
  let end = lines.length;
  while (end > start && isTrim(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join("\n").trim();
}

/** ★원본은 확인만 한다 — 만들지도 고치지도 않는다. */
async function requireSourceTable(): Promise<void> {
  const [exists] = await bigquery
    .dataset(TEAM_USAGE_DATASET)
    .table(SOURCE_TABLE_COST_LOGS)
    .exists();
  if (!exists) {
    fail(
      `${TEAM_USAGE_DATASET}.${SOURCE_TABLE_COST_LOGS} 이 없다 — 이 스크립트는 ` +
        "원본을 만들지 않는다. 원장이 아직 안 생겼는지 확인해라."
    );
    return;
  }
  note(`[ok] 원본 ${TEAM_USAGE_DATASET}.${SOURCE_TABLE_COST_LOGS} 확인(수정 안 함)`);
}

async function ensureView(
  name: string,
  schema: ReadonlyArray<BqField>,
  ddl: string,
  body: string
): Promise<void> {
  // ★축 검사를 **BQ 에 만들기 전에** 돌린다. 잘못된 컬럼이 생성되기 전에 막는 게
  //   요점이다 — 생성 후엔 컬럼 삭제가 안 된다.
  assertAxisPurity(name, schema);

  const view = bigquery.dataset(TEAM_USAGE_DATASET).table(name);
  const [exists] = await view.exists();
  if (exists) {
    const [meta] = await view.getMetadata();
    const live: string = meta?.view?.query ?? "";
    if (normalizeViewBody(live) === normalizeViewBody(body)) {
      note(`[skip] 뷰 ${name} 이미 같은 본문이다 — 아무것도 하지 않는다.`);
      return;
    }
    if (!REPLACE_VIEWS) {
      fail(
        `뷰 ${name} 이 이미 있고 본문이 다르다. 덮어쓰기는 되돌릴 수 없으므로 ` +
          "`--replace-views` 를 명시하지 않으면 바꾸지 않는다."
      );
      return;
    }
    actions.push(`CREATE OR REPLACE VIEW ${TEAM_USAGE_DATASET}.${name} (★기존 본문 교체)`);
  } else {
    actions.push(`CREATE VIEW ${TEAM_USAGE_DATASET}.${name}`);
  }
  if (!APPLY) {
    note(ddl);
    return;
  }
  await bigquery.query({ query: ddl, location: BQ_LOCATION });
  note(`[ok] 뷰 ${name} ${exists ? "교체" : "생성"}`);
}

async function main(): Promise<void> {
  note(
    `[teamUsage] project=${PROJECT_ID} location=${BQ_LOCATION} ` +
      `mode=${APPLY ? "APPLY" : "dry-run"}${REPLACE_VIEWS ? " +replace-views" : ""}`
  );

  await requireSourceTable();

  await ensureView(
    VIEW_TEAM_USAGE_DAILY,
    TEAM_USAGE_DAILY_SCHEMA,
    buildTeamUsageDailyViewDdl(PROJECT_ID),
    buildTeamUsageDailyViewSql(PROJECT_ID)
  );
  await ensureView(
    VIEW_TEAM_USAGE_UNATTRIBUTED,
    TEAM_USAGE_UNATTRIBUTED_SCHEMA,
    buildTeamUsageUnattributedViewDdl(PROJECT_ID),
    buildTeamUsageUnattributedViewSql(PROJECT_ID)
  );

  if (actions.length > 0) {
    note(`\n[계획] ${APPLY ? "실행함" : "dry-run — 실행하지 않음"}:`);
    for (const a of actions) note(`  - ${a}`);
  } else {
    note("\n[계획] 바꿀 것이 없다.");
  }

  if (problems.length > 0) {
    console.error(`\n[teamUsage] 문제 ${problems.length}건 — 조용히 넘어가지 않는다.`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  // ★원시 에러 본문에 자격증명·경로가 섞일 수 있으므로 메시지만 남긴다.
  console.error(
    `[teamUsage] 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`
  );
  process.exitCode = 1;
});
