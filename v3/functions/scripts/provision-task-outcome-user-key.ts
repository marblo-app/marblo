// `task_outcomes.userKey` 각인 컬럼을 forward-only로 추가한다 (Phase 4a).
//
// 실행:
//   cd v3/functions && npm run provision:task-outcome-user-key
//   cd v3/functions && npm run provision:task-outcome-user-key -- --apply
//
// ★이 스크립트는 기존 행을 UPDATE/MERGE 하지 않는다. ALTER가 끝난 순간에도
// 기존 행은 NULL이고, 함수 배포 뒤 새 행만 `logTaskOutcome`에서 각인된다.
// ★배포 순서: ① 이 ALTER ② EVENTS_PERSON_STAMP_FROM 설정 ③ functions 배포.
// 함수 배포는 승인 사항이며 이 스크립트가 수행하지 않는다.

import { BigQuery } from "@google-cloud/bigquery";

import {
  assertAxisPurity,
  TABLE_TASK_OUTCOMES,
  type BqField,
} from "../src/analyticsProfiles";
import {
  EVENT_USER_KEY_FIELD,
  EVENT_USER_KEY_FIELD_SCHEMA,
  buildEventUserKeyAlterSql,
  resolveEventStampGate,
} from "../src/personAxisStamp";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US";
const DATASET = "marblo_telemetry";
const APPLY = process.argv.includes("--apply");

const bigquery = new BigQuery({ projectId: PROJECT_ID, location: BQ_LOCATION });

async function main(): Promise<void> {
  const table = bigquery.dataset(DATASET).table(TABLE_TASK_OUTCOMES);
  const [exists] = await table.exists();
  if (!exists) {
    console.error(`[fail] ${DATASET}.${TABLE_TASK_OUTCOMES} 가 없다. 중단한다.`);
    process.exitCode = 1;
    return;
  }

  const [meta] = await table.getMetadata();
  const live: Array<{ name: string; type: string; mode?: string }> =
    meta.schema?.fields ?? [];
  const already = live.some((field) => field.name === EVENT_USER_KEY_FIELD);

  // ALTER 전에 검증한다. 이벤트 축은 가명 userKey 한 벌만 허용하며 솔트나
  // 원시 uid를 SQL/BQ 스키마로 반출하지 않는다.
  const after: BqField[] = already
    ? live.map((field) => ({
        name: field.name,
        type: field.type,
        mode: (field.mode ?? "NULLABLE") as BqField["mode"],
      }))
    : [
        ...live.map((field) => ({
          name: field.name,
          type: field.type,
          mode: (field.mode ?? "NULLABLE") as BqField["mode"],
        })),
        EVENT_USER_KEY_FIELD_SCHEMA as BqField,
      ];
  assertAxisPurity(TABLE_TASK_OUTCOMES, after);
  console.log(
    `[ok] 축 가드 통과 — ${TABLE_TASK_OUTCOMES} 에 ${EVENT_USER_KEY_FIELD} 를 ` +
      "더해도 이벤트 축 금지 컬럼이 생기지 않는다."
  );

  if (already) {
    const field = live.find((candidate) => candidate.name === EVENT_USER_KEY_FIELD);
    console.log(
      `[skip] ${EVENT_USER_KEY_FIELD} 가 이미 있다 (mode=${field?.mode ?? "NULLABLE"}).`
    );
  }

  const sql = buildEventUserKeyAlterSql(
    PROJECT_ID,
    DATASET,
    TABLE_TASK_OUTCOMES
  );
  console.log("\n--- ALTER ---\n" + sql + "\n");

  const gate = resolveEventStampGate();
  console.log(
    gate.on
      ? `[env] EVENTS_PERSON_STAMP_FROM=${gate.stampFrom} — 함수 배포 후 신규 outcome 각인이 시작된다.`
      : `[env] 각인 게이트 꺼짐 (${gate.reasonCode}). ALTER만으로는 값을 쓰지 않는다.`
  );

  if (!APPLY) {
    console.log("\n[dry-run] --apply 를 붙여야 실제로 ALTER 한다.");
    return;
  }
  if (already) {
    console.log("[apply] 이미 있으므로 ALTER 를 보내지 않는다.");
    return;
  }

  await bigquery.query({ query: sql, location: BQ_LOCATION });
  console.log(
    `[apply] ${DATASET}.${TABLE_TASK_OUTCOMES}.${EVENT_USER_KEY_FIELD} 추가 완료. 기존 행은 변경하지 않았다.`
  );
  console.log(
    "다음: 승인 후 EVENTS_PERSON_STAMP_FROM 설정과 functions 배포. T0는 배포 뒤 첫 각인 행의 시각이다."
  );
}

main().catch((err: unknown) => {
  console.error("[fail]", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
