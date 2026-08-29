// PIPA 제36조 삭제요청 — **사람 축 연결을 푸는 유일한 운영 경로**
// (ticket rOyHBh6IiL6HvfVoLJfn, 설계 v3/docs/person-axis-event-stamp-2026-08-29.md §6.3).
//
// 실행:
//   cd v3/functions && npm run erase:person-axis -- --uid <firebase-uid>            # dry-run(기본)
//   cd v3/functions && npm run erase:person-axis -- --uid <firebase-uid> --apply    # 실제 실행
//
// ── ★왜 이 스크립트가 생겼나 ────────────────────────────────────────────────
// 설계 §6.3 은 "링크표 DELETE 와 각인 SET NULL 은 **짝**이다. 한쪽만 부르면
// 반쪽이 남는다" 고 적어 뒀다. 그런데 각인을 켜기 직전 실측에서 **둘 다 호출자가
// 한 명도 없었다** — 두 SQL 빌더가 export 만 돼 있고 부르는 자리가 없었다.
// 즉 삭제요청은 사람이 손으로 SQL 을 붙여 넣는 경로였고, 짝의 존재는 주석에만
// 있었다. 각인이 켜지면 그 주석 하나가 유일한 방어선이 된다. 그래서 경로를
// 만들되 **반쪽을 부를 수 없는 모양**으로 만든다(`buildPersonErasePlan`).
//
// ── ★원시 uid 는 여기서 소비되고 버려진다 ───────────────────────────────────
// HMAC 은 Node 안에서 계산하고, BQ 로 나가는 것은 `us_` 가명 하나다. 로그에도
// 원시 uid 도 솔트도 찍지 않는다 — BQ 는 쿼리 본문을 job 히스토리에 수개월
// 보관하고, 터미널 로그는 어디로 갈지 모른다.
//
// ── ★스트리밍 버퍼 ──────────────────────────────────────────────────────────
// `events` 는 스트리밍 적재라 최근 행은 UPDATE 가 **문장째 거절된다**
// (실측 2026-08-29). 그래서 각인 문장에 시간 가드가 붙어 있고, 남은 행 수를
// 반드시 센다. 잔여가 0 이 아니면 **삭제요청은 아직 안 끝난 것이다** — 그 사람의
// 활동이 잦아든 뒤 다시 돌려라.

import { BigQuery } from "@google-cloud/bigquery";

import { pseudonymizeAnalyticsId } from "../src/analyticsPseudonym";
import { buildPersonErasePlan } from "../src/personAxisStamp";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts 의 BQ_LOCATION 과 같아야 한다.
const DATASET = "marblo_telemetry";
const TABLE = "events";
const APPLY = process.argv.includes("--apply");

function getArg(name: string): string {
  const prefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
    if (arg === `--${name}` && process.argv[i + 1]) {
      return process.argv[i + 1].trim();
    }
  }
  return "";
}

/** 가명키도 통째로는 안 찍는다 — 어느 요청인지 알아볼 만큼만 남긴다. */
function maskKey(key: string): string {
  return key.length <= 10 ? "us_***" : `${key.slice(0, 7)}…${key.slice(-3)}`;
}

async function main(): Promise<void> {
  const uid = getArg("uid");
  if (uid.length === 0) {
    console.error("[fail] --uid <firebase-uid> 가 필요하다.");
    process.exitCode = 1;
    return;
  }

  const salt = (process.env.ANALYTICS_ID_SALT ?? "").trim();
  if (salt.length === 0) {
    // ★솔트가 없으면 원시값 폴백이 아니라 **중단**이다. 폴백하면 원시 uid 가
    //   SQL 파라미터로 BQ job 히스토리에 들어간다.
    console.error(
      "[fail] ANALYTICS_ID_SALT 가 없다. 가명키를 만들 수 없으므로 중단한다 — " +
        "원시 uid 로 폴백하지 않는다.",
    );
    process.exitCode = 1;
    return;
  }

  const userKey = pseudonymizeAnalyticsId("user", uid, salt);
  if (typeof userKey !== "string" || userKey.length === 0) {
    console.error("[fail] 가명키 생성 실패. 중단한다.");
    process.exitCode = 1;
    return;
  }
  console.log(`[key] 대상 사람키 ${maskKey(userKey)} (원시 uid 는 안 찍는다)`);

  const plan = buildPersonErasePlan(PROJECT_ID, DATASET, TABLE);
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    location: BQ_LOCATION,
  });
  const params = { user_key: userKey };

  for (const [i, statement] of plan.statements.entries()) {
    console.log(
      `\n--- ${i + 1}/${plan.statements.length} ${statement.label} ---`,
    );
    console.log(statement.sql);
    if (!APPLY) continue;
    const [job] = await bigquery.createQueryJob({
      query: statement.sql,
      params,
      location: BQ_LOCATION,
    });
    await job.getQueryResults();
    const [meta] = await job.getMetadata();
    const affected =
      meta.statistics?.query?.dmlStats?.updatedRowCount ??
      meta.statistics?.query?.dmlStats?.deletedRowCount ??
      "0";
    console.log(`[apply] 영향 행 ${affected}`);
  }

  if (!APPLY) {
    console.log(
      "\n[dry-run] --apply 를 붙여야 실제로 실행한다. " +
        "★두 문장은 **같이** 나간다 — 한쪽만 돌리지 마라.",
    );
    return;
  }

  // ★여기가 이 스크립트의 요점이다: 시간 가드 때문에 못 지운 행이 있으면
  //   삭제요청은 아직 안 끝났다. 세지 않으면 그게 조용한 반쪽이다.
  console.log(`\n--- ${plan.residualCheck.label} ---`);
  const [rows] = await bigquery.query({
    query: plan.residualCheck.sql,
    params,
    location: BQ_LOCATION,
  });
  const residual = Number(rows?.[0]?.residual_rows ?? 0);
  if (residual > 0) {
    console.warn(
      `[incomplete] 각인이 ${residual}행 남았다 — 스트리밍 버퍼(최근 ~90분) 안의 ` +
        "행은 BQ 가 UPDATE 를 거절한다. 그 사람의 활동이 잦아든 뒤 이 스크립트를 " +
        "다시 돌려라. ★끝난 것으로 보고하지 마라.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "[ok] 잔여 0 — 링크표와 각인 양쪽에서 이 사람의 연결이 사라졌다.",
  );
}

main().catch((err) => {
  console.error("[fail]", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
