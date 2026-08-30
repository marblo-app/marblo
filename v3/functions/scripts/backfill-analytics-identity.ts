// analytics_identity 익명축 동기화 — 수동/1회성 실행용 CLI.
// (원래 ticket dTpcKWwRw5DvEMKxpCZi, 멱등 append/upgrade 로 재설계: EFnVgBSdcjGVRRmNQ1dK)
//
// 실행:
//   cd v3/functions && npm run backfill:analytics-identity -- --dry-run
//   cd v3/functions && npm run backfill:analytics-identity -- --apply
//
// ★2026-08-30 개정: 이 스크립트가 유일하게 analytics_identity 를 채우는 경로
//   였고, npm script(수동 실행)로만 존재했다 — 스케줄이 없어서 2026-08-20
//   백필 이후 9일간 신규 원장행이 반영되지 않았다(#1321). 이제 같은 로직이
//   `functions/src/index.ts` 의 `scheduledSyncAnalyticsIdentity`(일 1회
//   15:40 KST)로도 돈다 — 이 스크립트는 스케줄의 대체가 아니라 수동 복구·
//   국소 검증용으로 남는다. 행 조립·멱등 계획 로직은 전부
//   `src/analyticsIdentitySync.ts`(순수 함수, 스케줄 함수와 공유)에 있다.
// ★DELETE 하지 않는다 — 이전 판(전량 삭제 후 재적재)과 달리 이제
//   append(새 install_key)/upgrade(unmapped→joined) 만 한다. 두 번 --apply
//   해도 두 번째는 inserted=0·upgraded=0 이다(analyticsIdentitySync.test.ts
//   의 idempotency 테스트로 단위검증, 이 스크립트 자체도 실행 로그로 실측
//   가능하다).
//
// ── ★축 경계 ────────────────────────────────────────────────────────────────
//   익명축  analytics_identity              install_key / ga_key / first_touch
//   계정축  analytics_purchase / cost_logs  user_key / 금액
//   링크축  analytics_user_install          (user_key, install_key) 쌍 ★단 하나
//   ★두 축을 잇는 자리는 위 링크표 **하나뿐**이고, 그마저 PERSON_AXIS_EFFECTIVE_FROM
//     게이트가 열려 있을 때만 채워진다(#1084). 그 밖에서는 잇지 않는다.
//     근거: 배포된 처리방침 privacyContent.tsx, 항목 "사용량·비용 기록 (계정
//           연결)" — "연결한 결과는 통계 분석에만 쓰이고, 특정 개인을 알아보거나
//           특정 계정이 무엇을 했는지 되짚는 데는 쓰지 않습니다"
//           (EN: "used only for statistical analysis, never to identify a
//            particular person or to retrace what a particular account did").
//     ★행 번호로 인용하지 마라. privacyContent.tsx 는 계속 움직인다.
//
// 이 스크립트는 `user_key` 를 만들지 않는다. 컬럼 자리도 만들지 않는다 —
// 빈 컬럼이 있으면 다음 사람이 "채우면 되겠네" 로 읽는다. 왜 없는지는
// analyticsPseudonym.ts 상단 주석에 있다.
//
// ── ★솔트를 SQL 에 넣지 마라 ────────────────────────────────────────────────
// BQ 는 **쿼리 본문을 job 히스토리에 보관**한다(수개월). 솔트를 SQL 리터럴로
// 넣으면 job 읽기 권한만 있어도 솔트가 보이고, 그러면 "솔트는 웨어하우스에
// 없다" 는 #915 의 전제가 그 자리에서 깨진다. 그래서 HMAC 은 **전부 Node
// 안에서** 계산한다. BQ 로 나가는 SQL 에는 원시 id 도, 솔트도 없다.
//
// 원시 설치 id 는 이 프로세스 메모리에만 머문다 — 로그·에러·결과 어디에도
// 찍지 않는다(출력은 건수와 가명 접두뿐).

import { BigQuery } from "@google-cloud/bigquery";

import {
  pseudonymizeAnalyticsId,
  readAnalyticsIdSalt,
} from "../src/analyticsPseudonym";
import {
  ANALYTICS_IDENTITY_SCHEMA,
  ANALYTICS_IDENTITY_SINCE,
  ANALYTICS_IDENTITY_TABLE,
  buildAnalyticsIdentityCandidates,
  buildAttributionLedgerSql,
  buildExistingIdentityRowsQuery,
  buildTelemetryFirstVisitSql,
  buildUpgradeIdentityRowParams,
  buildUpgradeIdentityRowSql,
  planAnalyticsIdentitySync,
  type AttributionLedgerRow,
  type LinkConfidence,
  type TelemetryFirstVisitRow,
} from "../src/analyticsIdentitySync";

const PROJECT_ID = "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts:183 과 동일해야 한다.
const DATASET = "marblo_telemetry";

function unwrap(raw: unknown): unknown {
  let cur: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (cur && typeof cur === "object" && "value" in cur) {
      cur = (cur as { value: unknown }).value;
      continue;
    }
    break;
  }
  return cur;
}

function asString(raw: unknown): string | null {
  const v = unwrap(raw);
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asTimestampIso(raw: unknown): string | null {
  const v = unwrap(raw);
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  const salt = readAnalyticsIdSalt();
  if (!salt) {
    // fail-safe: 솔트 없이 돌면 install_key 가 전부 null 이 된다. 조용히
    // 빈 표를 만드느니 멈춘다.
    throw new Error(
      "ANALYTICS_ID_SALT 미설정 — 가명키를 만들 수 없어 중단한다. " +
        "8월 행과 같은 스킴이어야 하므로 임의 솔트로 대체하면 안 된다.",
    );
  }

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    location: BQ_LOCATION,
  });

  const [telRowsRaw] = await bigquery.query({
    query: buildTelemetryFirstVisitSql({
      project: PROJECT_ID,
      dataset: DATASET,
    }),
    // ★`types: { since: "DATE" }` 를 일부러 안 쓴다 — 실측(2026-08-30):
    //   @google-cloud/bigquery 8.3.1 에서 STRING 값에 명시적 DATE 타입을
    //   씌우면 파라미터가 조용히 NULL 로 바인딩된다(WHERE 절이 0행을 준다,
    //   에러 없음). 타입을 생략하면 클라이언트가 STRING 으로 자동판정하고
    //   `TIMESTAMP(@since)` 가 그 STRING 을 정상 캐스팅한다 — 그래서 뺐다.
    params: { since: ANALYTICS_IDENTITY_SINCE },
    location: BQ_LOCATION,
  });
  const [attRowsRaw] = await bigquery.query({
    query: buildAttributionLedgerSql({ project: PROJECT_ID, dataset: DATASET }),
    location: BQ_LOCATION,
  });

  const telemetryRows: TelemetryFirstVisitRow[] = (
    telRowsRaw as Array<{ installId: unknown; firstVisitAt: unknown }>
  )
    .filter((r) => asString(r.installId) !== null)
    .map((r) => ({
      installId: asString(r.installId) as string,
      firstVisitAt: asTimestampIso(r.firstVisitAt),
    }));

  const attributionRows: AttributionLedgerRow[] = (
    attRowsRaw as Array<Record<string, unknown>>
  )
    .filter((r) => asString(r.installId) !== null)
    .map((r) => ({
      installId: asString(r.installId) as string,
      gaClientId: asString(r.gaClientId),
      utmSource: asString(r.utmSource),
      utmMedium: asString(r.utmMedium),
      utmCampaign: asString(r.utmCampaign),
      referrerHost: asString(r.referrerHost),
      landingPath: asString(r.landingPath),
      platform: asString(r.platform),
      linkedAt: asTimestampIso(r.linkedAt),
    }));

  console.log(
    `[read] telemetry installs=${telemetryRows.length} attribution installs=${attributionRows.length}`,
  );

  const built = buildAnalyticsIdentityCandidates({
    telemetryRows,
    attributionRows,
    pseudonymizeInstall: (raw) => {
      const v = pseudonymizeAnalyticsId("install", raw, salt);
      return typeof v === "string" ? v : null;
    },
    pseudonymizeGa: (raw) => {
      const v = pseudonymizeAnalyticsId("ga", raw, salt);
      return typeof v === "string" ? v : null;
    },
  });

  // 집계만 출력한다 — 원시 id 도, 가명 전문도 찍지 않는다.
  const byConfidence = new Map<string, number>();
  const byScheme = new Map<string, number>();
  for (const r of built.rows) {
    byConfidence.set(
      r.link_confidence,
      (byConfidence.get(r.link_confidence) ?? 0) + 1,
    );
    byScheme.set(r.id_scheme, (byScheme.get(r.id_scheme) ?? 0) + 1);
  }
  console.log(`[build] candidates=${built.rows.length}`);
  console.log(
    `[build] link_confidence=${JSON.stringify(Object.fromEntries(byConfidence))}`,
  );
  console.log(
    `[build] id_scheme=${JSON.stringify(Object.fromEntries(byScheme))}`,
  );
  console.log(
    `[build] ga_key present=${built.rows.filter((r) => r.ga_key !== null).length}`,
  );
  console.log(
    `[build] ga_key null: no ledger row(원장 행 자체가 없음)=${built.gaKeyNullNoLedgerRow}, ` +
      `ledger row but no gaClientId(원장은 있는데 GA client id 없음)=${built.gaKeyNullLedgerNoGaClientId}`,
  );
  if (built.skippedSharedSentinel > 0) {
    console.log(
      `[build] skipped(공유 리터럴 'anon' — 키로 쓰면 인원이 뭉친다)=${built.skippedSharedSentinel}`,
    );
  }

  const dataset = bigquery.dataset(DATASET);
  const table = dataset.table(ANALYTICS_IDENTITY_TABLE);
  const [exists] = await table.exists();

  if (!exists) {
    console.log(
      `[plan] ${ANALYTICS_IDENTITY_TABLE} 표가 없다 — 전량이 INSERT 대상이다.`,
    );
  }

  const existing = exists
    ? await (async () => {
        const [rows] = await bigquery.query({
          query: buildExistingIdentityRowsQuery({
            project: PROJECT_ID,
            dataset: DATASET,
          }),
          location: BQ_LOCATION,
        });
        const map = new Map<string, LinkConfidence>();
        for (const r of rows as Array<{
          install_key: unknown;
          link_confidence: unknown;
        }>) {
          const key = asString(r.install_key);
          const conf = asString(r.link_confidence);
          if (key && (conf === "joined" || conf === "unmapped")) {
            map.set(key, conf as LinkConfidence);
          }
        }
        return map;
      })()
    : new Map<string, LinkConfidence>();

  const plan = planAnalyticsIdentitySync(built.rows, existing);
  console.log(
    `[plan] existing=${existing.size} toInsert=${plan.toInsert.length} toUpgrade=${plan.toUpgrade.length}`,
  );

  if (dryRun) {
    console.log("[dry-run] 적재하지 않았다. --apply 로 실행해라.");
    return;
  }

  if (!exists) {
    await dataset.createTable(ANALYTICS_IDENTITY_TABLE, {
      schema: { fields: ANALYTICS_IDENTITY_SCHEMA as unknown as object[] },
      location: BQ_LOCATION,
    });
    console.log(
      `[ddl] ${ANALYTICS_IDENTITY_TABLE} 생성됨(익명축 전용, user_key 없음)`,
    );
  }

  if (plan.toInsert.length > 0) {
    await table.insert(plan.toInsert);
  }
  console.log(`[apply] inserted=${plan.toInsert.length}`);

  if (plan.toUpgrade.length > 0) {
    const upgradeSql = buildUpgradeIdentityRowSql({
      project: PROJECT_ID,
      dataset: DATASET,
    });
    for (const row of plan.toUpgrade) {
      const { params, types } = buildUpgradeIdentityRowParams(row);
      await bigquery.query({
        query: upgradeSql,
        params,
        types,
        location: BQ_LOCATION,
      });
    }
  }
  console.log(`[apply] upgraded=${plan.toUpgrade.length}`);
  console.log(
    `[apply] 완료. inserted=${plan.toInsert.length} upgraded=${plan.toUpgrade.length} (0/0 이면 이미 최신 — 재실행 멱등)`,
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[backfill-analytics-identity] 실패: ${msg}`);
  process.exit(1);
});
