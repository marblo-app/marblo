// 통합 뷰를 **실제로 만든다** (ticket L8RvsReu6Vch5eNYYCJR).
// 설계 정본: v3/docs/install-unified-view-2026-08-24.md
//
// 실행:
//   cd v3/functions && npm run provision:install-unified            # dry-run(기본)
//   cd v3/functions && npm run provision:install-unified -- --apply # 실제 생성
//
// ── ★이 스크립트가 하지 않는 것 ─────────────────────────────────────────────
//   - DROP / ALTER / DELETE / TRUNCATE / INSERT 를 **한 줄도 내보내지 않는다.**
//   - 원본 표를 만들지도 고치지도 않는다. **있는지, 그리고 필요한 컬럼이
//     실제로 있는지** 확인만 한다.
//   - 데이터셋을 만들지 않는다. `marblo_identity` 는 좁힌 ACL 로 이미 존재해야
//     한다(provision-person-axis.ts 소관). 없으면 **실패**한다 — 여기서 만들면
//     기본 ACL 로 만들어져 링크표 격리가 조용히 풀린다.
//
// ── ★배포 전에는 일부러 실패한다 ────────────────────────────────────────────
//   `install_attribution.gaKeyHmac` 은 #1195 가 배포된 뒤 첫 쓰기에서
//   `ensureAttributionTable()` 이 덧붙인다. 그전에 뷰를 만들려 하면 BigQuery 가
//   "no such field" 로 거절한다. 그 에러를 그대로 흘리는 대신 **무엇을 기다리고
//   있는지** 말하고 멈춘다 — 조용한 실패를 만들지 않으려고 만든 뷰다.

import { BigQuery } from "@google-cloud/bigquery";

import { resolvePersonAxisGate } from "../src/personAxis";
import {
  IDENTITY_DATASET,
  SOURCE_GA4_CURRENT,
  SOURCE_GA4_ECOMMERCE_CURRENT,
  SOURCE_INSTALL_ATTRIBUTION,
  SOURCE_INSTALL_PROFILE,
  SOURCE_PURCHASE,
  SOURCE_USER_DAILY,
  TELEMETRY_DATASET,
  VIEW_INSTALL_UNIFIED,
  VIEW_INSTALL_UNIFIED_REVENUE,
  VIEW_INSTALL_UNIFIED_REVENUE_PERSON,
  buildRevenuePersonViewDdl,
  buildRevenuePersonViewSql,
  buildRevenueViewDdl,
  buildRevenueViewSql,
  buildUnifiedViewDdl,
  buildUnifiedViewSql,
  findForbiddenTokens,
} from "../src/installUnified";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts 와 같아야 한다.

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

interface LiveField {
  name: string;
}

/**
 * 원본이 있는지, 그리고 **뷰가 참조하는 컬럼이 실제로 있는지** 본다.
 *
 * ★컬럼까지 보는 이유: 표만 확인하고 넘어가면 `gaKeyHmac` 이 없는 상태로
 *   `CREATE VIEW` 를 던지게 되고, 그때 나오는 BigQuery 에러는 "무엇을 배포해야
 *   하는지" 를 말해 주지 않는다.
 */
async function requireSource(
  dataset: string,
  name: string,
  requiredColumns: ReadonlyArray<string>,
  hint: string
): Promise<void> {
  const table = bigquery.dataset(dataset).table(name);
  const [exists] = await table.exists();
  if (!exists) {
    fail(`${dataset}.${name} 이 없다. ${hint}`);
    return;
  }
  const [metadata] = await table.getMetadata();
  const live: LiveField[] = metadata?.schema?.fields ?? [];
  const liveNames = new Set(live.map((f) => f.name));
  const missing = requiredColumns.filter((c) => !liveNames.has(c));
  if (missing.length > 0) {
    fail(
      `${dataset}.${name} 에 컬럼이 없다: ${missing.join(", ")} — ${hint}`
    );
    return;
  }
  note(`[ok] ${dataset}.${name} — 필요한 컬럼 ${requiredColumns.length}개 확인`);
}

/**
 * 뷰 본문을 비교 가능한 모양으로 접는다. BigQuery 는 `CREATE VIEW ... AS` 뒤의
 * 선행·후행 주석 블록을 저장하지 않으므로 앞뒤 주석·빈 줄만 걷어낸다
 * (provision-person-axis.ts 와 같은 규약).
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

async function ensureView(
  dataset: string,
  name: string,
  ddl: string,
  body: string
): Promise<void> {
  const [datasetExists] = await bigquery.dataset(dataset).exists();
  if (!datasetExists) {
    fail(
      `데이터셋 ${dataset} 이 없다. ★여기서 만들지 않는다 — 기본 ACL 로 만들어지면 ` +
        "링크표 격리가 조용히 풀린다. provision-person-axis 를 먼저 돌려라."
    );
    return;
  }
  const view = bigquery.dataset(dataset).table(name);
  const [exists] = await view.exists();

  if (exists) {
    const [metadata] = await view.getMetadata();
    const live: string = metadata?.view?.query ?? "";
    if (normalizeViewBody(live) === normalizeViewBody(body)) {
      note(`[skip] 뷰 ${dataset}.${name} 이미 같은 본문이다 — 아무것도 하지 않는다.`);
      return;
    }
    if (!REPLACE_VIEWS) {
      fail(
        `뷰 ${dataset}.${name} 이 이미 있고 본문이 다르다. 덮어쓰기는 되돌릴 수 ` +
          "없으므로 `--replace-views` 를 명시하지 않으면 바꾸지 않는다."
      );
      return;
    }
    actions.push(`CREATE OR REPLACE VIEW ${dataset}.${name} (★기존 본문 교체)`);
  } else {
    actions.push(`CREATE VIEW ${dataset}.${name}`);
  }

  if (!APPLY) {
    note(ddl);
    return;
  }
  await bigquery.query({ query: ddl, location: BQ_LOCATION });
  note(`[ok] 뷰 ${dataset}.${name} ${exists ? "교체" : "생성"}`);
}

async function main(): Promise<void> {
  const gate = resolvePersonAxisGate();
  note("── 통합 뷰 프로비저닝 ─────────────────────────────────────────");
  note(`  프로젝트   : ${PROJECT_ID} (${BQ_LOCATION})`);
  note(`  모드       : ${APPLY ? "★APPLY(실제 생성)" : "dry-run(기본)"}`);
  note(
    `  사람 축    : ${
      gate.open
        ? `open — 소급 상한 ${gate.effectiveFrom}`
        : `closed(${gate.reasonCode}) — 결제 컬럼만 미상으로 만들어진다`
    }`
  );
  note("");

  const unifiedBody = buildUnifiedViewSql(PROJECT_ID);
  const revenueBody = buildRevenueViewSql(PROJECT_ID, gate);
  const revenuePersonBody = buildRevenuePersonViewSql(PROJECT_ID);

  // ★SQL 위생 — 만들기 전에 본다. 뷰 본문은 BQ 에 영구히 남는다.
  for (const [label, sql] of [
    [VIEW_INSTALL_UNIFIED, unifiedBody],
    [VIEW_INSTALL_UNIFIED_REVENUE, revenueBody],
    [VIEW_INSTALL_UNIFIED_REVENUE_PERSON, revenuePersonBody],
  ] as ReadonlyArray<readonly [string, string]>) {
    const hits = findForbiddenTokens(sql);
    if (hits.length > 0) {
      fail(`${label} 본문에 금지 토큰이 있다: ${hits.join(", ")}`);
    }
  }

  // 원본 확인 — 만들지 않는다. ★컬럼까지 본다.
  await requireSource(
    TELEMETRY_DATASET,
    SOURCE_INSTALL_PROFILE,
    ["install_key", "id_scheme", "first_run_at", "first_spawn_at", "built_at"],
    "analytics_install_profile 은 스케줄 빌드가 만든다(provision-person-axis).",
  );
  await requireSource(
    TELEMETRY_DATASET,
    SOURCE_INSTALL_ATTRIBUTION,
    // ★utmCampaign·buildChannel 은 외부성 사다리의 self_verification_utm /
    //   pre_tag_dev_browser 칸이 읽는다. 없으면 뷰가 조용히 깨지는 게 아니라
    //   여기서 멈춘다.
    [
      "installId",
      "gaClientId",
      "gaKeyHmac",
      "utmCampaign",
      "buildChannel",
      "utmContent",
      "utmTerm",
    ],
    "★#1195 가 **배포**되어야 ensureAttributionTable() 이 이 컬럼들을 덧붙인다. " +
      "배포 전에는 뷰를 만들 수 없다(설계 §6-1).",
  );
  await requireSource(
    TELEMETRY_DATASET,
    SOURCE_GA4_CURRENT,
    ["gaKey", "source", "medium", "campaign", "content", "term"],
    "ga4_first_touch_current 는 GA4 브리지가 만든다(#1111).",
  );
  await requireSource(
    TELEMETRY_DATASET,
    SOURCE_GA4_ECOMMERCE_CURRENT,
    [
      "gaKey",
      "viewItemListEvents",
      "beginCheckoutEvents",
      "purchaseEvents",
      "purchaseRevenue",
      "purchaseCurrency",
      "currencyCount",
    ],
    "ga4_ecommerce_current 는 GA4 이커머스 동기화가 만든다(VV733VRp). " +
      "★배포 후 syncGa4Bridge 를 한 번 돌려야 표와 뷰가 생긴다 — 그전에는 " +
      "이 뷰를 만들 수 없다(없는 표를 참조하면 CREATE VIEW 가 실패한다).",
  );
  await requireSource(
    TELEMETRY_DATASET,
    SOURCE_USER_DAILY,
    ["install_key", "install_key_hmac", "day", "active"],
    "analytics_user_daily 는 스케줄 빌드가 만든다.",
  );
  if (gate.open) {
    await requireSource(
      TELEMETRY_DATASET,
      SOURCE_PURCHASE,
      ["user_key", "event_at", "kind", "amount", "amount_known", "account_class"],
      "analytics_purchase 는 결제 원장 적재가 만든다(#1077).",
    );
  }

  if (problems.length === 0) {
    await ensureView(
      TELEMETRY_DATASET,
      VIEW_INSTALL_UNIFIED,
      buildUnifiedViewDdl(PROJECT_ID),
      unifiedBody
    );
    await ensureView(
      IDENTITY_DATASET,
      VIEW_INSTALL_UNIFIED_REVENUE,
      buildRevenueViewDdl(PROJECT_ID, gate),
      revenueBody
    );
    await ensureView(
      IDENTITY_DATASET,
      VIEW_INSTALL_UNIFIED_REVENUE_PERSON,
      buildRevenuePersonViewDdl(PROJECT_ID),
      revenuePersonBody
    );
  } else {
    note("");
    note("  ★원본 확인에서 막혔다 — 뷰는 만들지 않는다.");
  }

  note("");
  note("── 계획/실행 요약 ─────────────────────────────────────────────");
  if (actions.length === 0) note("  (변경 없음)");
  for (const a of actions) note(`  · ${a}`);

  if (problems.length > 0) {
    console.error("");
    console.error(`[fail] ${problems.length}건 — 조용히 넘어가지 않는다:`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  if (!APPLY) {
    note("");
    note("  dry-run 이다. 실제로 만들려면 `-- --apply` 를 붙여라.");
    note("  만든 뒤에는 설계 §7-2 의 검증 쿼리를 순서대로 돌려라.");
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[provision-install-unified] 실패: ${msg}`);
  process.exit(1);
});
