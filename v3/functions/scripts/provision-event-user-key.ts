// `events.userKey` 각인 컬럼을 **실제로 추가한다** (ticket VZ0K2FIeASLrWy9bwvN1,
// 설계 v3/docs/person-axis-event-stamp-2026-08-29.md §6).
//
// 실행:
//   cd v3/functions && npm run provision:event-user-key            # dry-run(기본)
//   cd v3/functions && npm run provision:event-user-key -- --apply # 실제 ALTER
//
// ── ★왜 provision-person-axis.ts 에 넣지 않았나 ─────────────────────────────
// 그 스크립트는 자기 머리주석에 "DROP / ALTER / DELETE / TRUNCATE 를 **한 줄도
// 내보내지 않는다**" 고 못박아 뒀다. 거기에 ALTER 를 슬쩍 넣으면 그 문장이
// 거짓이 되고, 다음 사람이 "이 스크립트는 원본을 안 건드린다" 를 믿고 돌린다.
// 되돌릴 수 없는 일은 **자기 이름을 가진 스크립트**로 분리한다.
//
// ── ★이 ALTER 가 되돌릴 수 있는 범위 ────────────────────────────────────────
//   되돌린다: 값. `buildEventStampEraseSql` 이 `SET userKey = NULL` 한 줄이다.
//   못 되돌린다: **컬럼 자체.** BigQuery 는 컬럼 삭제가 사실상 불가하다.
//   그래서 이름을 바꿀 기회는 지금 한 번뿐이다(personAxisStamp.EVENT_USER_KEY_FIELD).
//
// ── ★배포 순서 (이 순서가 아니면 텔레메트리가 죽는다) ──────────────────────
//   1) 이 스크립트 `--apply`               ← 컬럼 추가. 이 시점에 값은 전부 NULL.
//   2) `EVENTS_PERSON_STAMP_FROM=YYYY-MM-DD` 를 functions/.env.<project> 에 넣는다.
//   3) `npm run deploy` (함수 배포)        ← 여기서부터 각인이 시작된다.
//   ★2·3 을 1 보다 먼저 하면 존재하지 않는 컬럼에 스트리밍 insert 가 나가
//     `logTelemetryBatch` 가 배치째 실패한다 = 텔레메트리 수집 중단.
//     (코드 쪽에도 방어가 있다 — 게이트가 꺼져 있으면 컬럼을 **언급조차** 하지
//      않는다. 그래도 순서를 지켜라. 방어는 실수의 대가를 줄이는 것이지 순서를
//      대신하는 게 아니다.)

import { BigQuery } from "@google-cloud/bigquery";

import { assertAxisPurity, TABLE_EVENTS, type BqField } from "../src/analyticsProfiles";
import {
  EVENT_USER_KEY_FIELD,
  EVENT_USER_KEY_FIELD_SCHEMA,
  buildEventUserKeyAlterSql,
  resolveEventStampGate,
} from "../src/personAxisStamp";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts 의 BQ_LOCATION 과 같아야 한다.
const DATASET = "marblo_telemetry";
const APPLY = process.argv.includes("--apply");

const bigquery = new BigQuery({ projectId: PROJECT_ID, location: BQ_LOCATION });

async function main(): Promise<void> {
  const table = bigquery.dataset(DATASET).table(TABLE_EVENTS);
  const [exists] = await table.exists();
  if (!exists) {
    console.error(`[fail] ${DATASET}.${TABLE_EVENTS} 가 없다. 중단한다.`);
    process.exitCode = 1;
    return;
  }

  const [meta] = await table.getMetadata();
  const live: Array<{ name: string; type: string; mode?: string }> =
    meta.schema?.fields ?? [];

  // ★ALTER 전에 축 가드를 돌린다. 컬럼이 BQ 에 **생기기 전에** 막는 게 요점이다
  //   (생성 후엔 삭제가 안 된다 — analyticsProfiles.assertAxisPurity 주석).
  const after: BqField[] = [
    ...live.map((f) => ({
      name: f.name,
      type: f.type,
      mode: (f.mode ?? "NULLABLE") as BqField["mode"],
    })),
    EVENT_USER_KEY_FIELD_SCHEMA as BqField,
  ];
  assertAxisPurity(TABLE_EVENTS, after);
  console.log(
    `[ok] 축 가드 통과 — ${TABLE_EVENTS} 에 ${EVENT_USER_KEY_FIELD} 를 더해도 ` +
      "이벤트 축 금지 컬럼이 생기지 않는다."
  );

  const already = live.some((f) => f.name === EVENT_USER_KEY_FIELD);
  if (already) {
    const f = live.find((x) => x.name === EVENT_USER_KEY_FIELD);
    console.log(`[skip] ${EVENT_USER_KEY_FIELD} 가 이미 있다 (mode=${f?.mode ?? "NULLABLE"}).`);
  }

  const sql = buildEventUserKeyAlterSql(PROJECT_ID, DATASET, TABLE_EVENTS);
  console.log("\n--- ALTER ---\n" + sql + "\n");

  // 각인 게이트 상태를 같이 알려준다 — 컬럼만 만들고 env 를 안 넣으면 아무 일도
  // 안 일어나고, 그걸 "안 되네" 로 읽는 것이 이 작업의 가장 흔한 오해다.
  const gate = resolveEventStampGate();
  console.log(
    gate.on
      ? `[env] EVENTS_PERSON_STAMP_FROM=${gate.stampFrom} — 배포하면 각인이 시작된다.`
      : `[env] 각인 게이트 꺼짐 (${gate.reasonCode}). 컬럼을 만들어도 값은 안 들어온다.`
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
  console.log(`[apply] ${DATASET}.${TABLE_EVENTS}.${EVENT_USER_KEY_FIELD} 추가 완료.`);
  console.log(
    "다음: functions/.env.<project> 에 EVENTS_PERSON_STAMP_FROM 을 넣고 함수를 배포해라."
  );
}

main().catch((err) => {
  console.error("[fail]", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
