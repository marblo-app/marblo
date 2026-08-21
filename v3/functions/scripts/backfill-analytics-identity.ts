// analytics_identity 익명축 백필 (ticket dTpcKWwRw5DvEMKxpCZi).
//
// 실행:
//   cd v3/functions && npm run backfill:analytics-identity -- --dry-run
//   cd v3/functions && npm run backfill:analytics-identity -- --apply
//
// ── ★축 경계 ────────────────────────────────────────────────────────────────
//   익명축  analytics_identity              install_key / ga_key / first_touch
//   계정축  analytics_purchase / cost_logs  user_key / 금액
//   링크축  analytics_user_install          (user_key, install_key) 쌍 ★단 하나
//   ★두 축을 잇는 자리는 위 링크표 **하나뿐**이고, 그마저 PERSON_AXIS_EFFECTIVE_FROM
//     게이트가 열려 있을 때만 채워진다(#1084). 그 밖에서는 잇지 않는다.
//     근거: 배포된 처리방침 privacyContent.tsx:127 (EN :246)
//           "두 기록이 공유하는 조인 키는 없습니다 / the two share no join key"
//           — 이 문장은 개정(#1080)에서 지운 게 아니라 범위를 넓혀 유지했다.
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
  classifyIdScheme,
  isSharedSentinel,
  resolveLinkConfidence,
  type IdScheme,
  type LinkConfidence,
} from "../src/analyticsIdScheme";

const PROJECT_ID = "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts:183 과 동일해야 한다.
const DATASET = "marblo_telemetry";
const TABLE = "analytics_identity";

/** 백필 하한 — 티켓 범위는 2026-04 ~ 08. 텔레메트리 최초행은 04-19. */
const SINCE = "2026-04-01";

/** ★익명축 전용 스키마. user_key 없음(자리도 없음). */
const SCHEMA = [
  { name: "install_key", type: "STRING", mode: "REQUIRED" },
  { name: "ga_key", type: "STRING", mode: "NULLABLE" },
  { name: "ft_source", type: "STRING", mode: "NULLABLE" },
  { name: "ft_medium", type: "STRING", mode: "NULLABLE" },
  { name: "ft_campaign", type: "STRING", mode: "NULLABLE" },
  { name: "ft_referrer_host", type: "STRING", mode: "NULLABLE" },
  { name: "ft_landing_path", type: "STRING", mode: "NULLABLE" },
  { name: "ft_device", type: "STRING", mode: "NULLABLE" },
  { name: "first_visit_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "linked_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "id_scheme", type: "STRING", mode: "REQUIRED" },
  { name: "link_confidence", type: "STRING", mode: "REQUIRED" },
] as const;

interface TelemetryRow {
  installId: string;
  firstVisitAt: { value: string } | string | null;
}

interface AttributionRow {
  installId: string;
  gaClientId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  platform: string | null;
  linkedAt: { value: string } | string | null;
}

interface IdentityRow {
  install_key: string;
  ga_key: string | null;
  ft_source: string | null;
  ft_medium: string | null;
  ft_campaign: string | null;
  ft_referrer_host: string | null;
  ft_landing_path: string | null;
  ft_device: string | null;
  first_visit_at: string | null;
  linked_at: string | null;
  id_scheme: IdScheme;
  link_confidence: LinkConfidence;
}

function tsValue(v: { value: string } | string | null): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : v.value;
}

/**
 * 텔레메트리(익명 세계)에 등장한 설치와 **최초 등장 시각**.
 * first_touch 기준을 유입 시점으로 고정하기 위해 MIN 을 쓴다 — 나중 값으로
 * 덮지 않는다.
 */
const TELEMETRY_SQL = `
WITH u AS (
  SELECT userId AS installId, timestamp AS ts
  FROM \`${PROJECT_ID}.${DATASET}.agent_heartbeats\`
  WHERE userId IS NOT NULL AND timestamp >= TIMESTAMP("${SINCE}")
  UNION ALL
  SELECT userId AS installId, timestamp AS ts
  FROM \`${PROJECT_ID}.${DATASET}.events\`
  WHERE userId IS NOT NULL AND timestamp >= TIMESTAMP("${SINCE}")
)
SELECT installId, MIN(ts) AS firstVisitAt
FROM u GROUP BY installId
`;

/**
 * 어트리뷰션 첫 행(설치당 가장 이른 linkedAt).
 * ★first_touch 는 유입 시점 값으로 고정 — 뒤 행으로 덮지 않는다.
 */
const ATTRIBUTION_SQL = `
SELECT installId, gaClientId, utmSource, utmMedium, utmCampaign,
       referrerHost, landingPath, platform, linkedAt
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY installId ORDER BY linkedAt ASC
  ) AS rn
  FROM \`${PROJECT_ID}.${DATASET}.install_attribution\`
  WHERE installId IS NOT NULL
)
WHERE rn = 1
`;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  const salt = readAnalyticsIdSalt();
  if (!salt) {
    // fail-safe: 솔트 없이 돌면 install_key 가 전부 null 이 된다. 조용히
    // 빈 표를 만드느니 멈춘다.
    throw new Error(
      "ANALYTICS_ID_SALT 미설정 — 가명키를 만들 수 없어 중단한다. " +
        "8월 행과 같은 스킴이어야 하므로 임의 솔트로 대체하면 안 된다."
    );
  }

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    location: BQ_LOCATION,
  });

  const [telRows] = (await bigquery.query({
    query: TELEMETRY_SQL,
    location: BQ_LOCATION,
  })) as unknown as [TelemetryRow[]];
  const [attRows] = (await bigquery.query({
    query: ATTRIBUTION_SQL,
    location: BQ_LOCATION,
  })) as unknown as [AttributionRow[]];

  console.log(
    `[read] telemetry installs=${telRows.length} attribution installs=${attRows.length}`
  );

  const attById = new Map<string, AttributionRow>();
  for (const r of attRows) attById.set(r.installId, r);
  const telById = new Map<string, TelemetryRow>();
  for (const r of telRows) telById.set(r.installId, r);

  const allIds = new Set<string>([...telById.keys(), ...attById.keys()]);

  const out: IdentityRow[] = [];
  let skippedSharedSentinel = 0;

  for (const rawId of allIds) {
    // ★공유 리터럴('anon')만 제외한다 — 모든 설치가 같은 값을 쓰므로 키로
    //   삼으면 전원이 한 사람으로 뭉쳐 인원이 왜곡된다. 세서 보고한다.
    if (isSharedSentinel(rawId)) {
      skippedSharedSentinel += 1;
      continue;
    }
    // ★그 외 미분류 모양은 **버리지 않는다**(id_scheme='unknown').
    //   빼면 인원이 줄어 보이고 그게 "이탈" 로 오독된다.
    const scheme = classifyIdScheme(rawId);

    const tel = telById.get(rawId) ?? null;
    const att = attById.get(rawId) ?? null;

    // ★joined = 익명축 양쪽(제품사용 + 유입)이 다 있다는 뜻이다.
    //   계정축과는 무관하다 — 여기서 계정은 취급하지 않는다.
    const confidence = resolveLinkConfidence(tel !== null && att !== null);

    const installKey = pseudonymizeAnalyticsId("install", rawId, salt);
    if (typeof installKey !== "string") {
      throw new Error("install_key 생성 실패 — 솔트/입력을 확인해라.");
    }

    const gaRaw = att?.gaClientId ?? null;
    const gaKey =
      gaRaw && gaRaw.length > 0
        ? pseudonymizeAnalyticsId("ga", gaRaw, salt)
        : null;

    out.push({
      install_key: installKey,
      ga_key: typeof gaKey === "string" ? gaKey : null,
      ft_source: att?.utmSource ?? null,
      ft_medium: att?.utmMedium ?? null,
      ft_campaign: att?.utmCampaign ?? null,
      ft_referrer_host: att?.referrerHost ?? null,
      ft_landing_path: att?.landingPath ?? null,
      ft_device: att?.platform ?? null,
      first_visit_at: tsValue(tel?.firstVisitAt ?? null),
      linked_at: tsValue(att?.linkedAt ?? null),
      id_scheme: scheme,
      link_confidence: confidence,
    });
  }

  // 집계만 출력한다 — 원시 id 도, 가명 전문도 찍지 않는다.
  const byConfidence = new Map<string, number>();
  const byScheme = new Map<string, number>();
  for (const r of out) {
    byConfidence.set(
      r.link_confidence,
      (byConfidence.get(r.link_confidence) ?? 0) + 1
    );
    byScheme.set(r.id_scheme, (byScheme.get(r.id_scheme) ?? 0) + 1);
  }
  console.log(`[build] rows=${out.length}`);
  console.log(
    `[build] link_confidence=${JSON.stringify(
      Object.fromEntries(byConfidence)
    )}`
  );
  console.log(
    `[build] id_scheme=${JSON.stringify(Object.fromEntries(byScheme))}`
  );
  console.log(
    `[build] ga_key present=${out.filter((r) => r.ga_key !== null).length}`
  );
  if (skippedSharedSentinel > 0) {
    // ★조용히 빼지 않는다 — 몇 개를 왜 뺐는지 남긴다.
    console.log(
      `[build] skipped(공유 리터럴 'anon' — 키로 쓰면 인원이 뭉친다)=${skippedSharedSentinel}`
    );
  }

  if (dryRun) {
    console.log("[dry-run] 적재하지 않았다. --apply 로 실행해라.");
    return;
  }

  const dataset = bigquery.dataset(DATASET);
  const table = dataset.table(TABLE);
  const [exists] = await table.exists();
  if (!exists) {
    await dataset.createTable(TABLE, {
      schema: { fields: SCHEMA as unknown as object[] },
      location: BQ_LOCATION,
    });
    console.log(`[ddl] ${TABLE} 생성됨(익명축 전용, user_key 없음)`);
  }

  // 재실행 안전: 가명은 결정적이라 같은 입력이면 같은 행이 된다.
  // 중복 적재를 막기 위해 지우고 다시 넣는다(원본 테이블은 건드리지 않는다).
  const [rows] = await table.getRows({ maxResults: 1 });
  if (rows.length > 0) {
    await bigquery.query({
      query: `DELETE FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\` WHERE TRUE`,
      location: BQ_LOCATION,
    });
    console.log("[ddl] 기존 행 삭제(재실행 멱등)");
  }

  await table.insert(out);
  console.log(`[apply] ${out.length}행 적재 완료.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[backfill-analytics-identity] 실패: ${msg}`);
  process.exit(1);
});
