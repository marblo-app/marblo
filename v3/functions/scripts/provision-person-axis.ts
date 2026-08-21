// 사람 축 표·뷰를 **실제로 만든다** (ticket euSq4AwHJrxSagMCjXeM,
// 구현문서 v3/docs/person-axis-implementation-2026-08-21.md §10 의 3~4단계).
//
// 실행:
//   cd v3/functions && npm run provision:person-axis            # dry-run(기본)
//   cd v3/functions && npm run provision:person-axis -- --apply # 실제 생성
//
// ── ★이 스크립트가 하지 않는 것 (되돌릴 수 없는 쪽) ─────────────────────────
//   - DROP / ALTER / DELETE / TRUNCATE 를 **한 줄도 내보내지 않는다.**
//   - 원본 테이블(events / cost_logs / analytics_identity / analytics_purchase)을
//     만들지도 고치지도 않는다. 있는지 **확인만** 한다.
//   - 이미 있는 객체를 조용히 넘어가지 않는다 — 스키마가 기대와 다르면 **실패**
//     하고 사유를 남긴다. 조용히 덮으면 어느 쪽이 살아있는지 아무도 모른다.
//   - 뷰가 이미 있고 본문이 다르면 `--replace-views` 없이는 바꾸지 않는다.
//     (게이트를 열고 뷰를 다시 만드는 것이 정상 절차이므로 플래그로 남긴다.)
//
// ── 만드는 것 ───────────────────────────────────────────────────────────────
//   1) 데이터셋 `marblo_identity` — ★기본 ACL 이 아니라 **좁힌 ACL** 로 만든다.
//      데이터셋만 나누고 권한이 같으면 이름만 다른 같은 방이다(설계 §4.2-3).
//   2) `marblo_telemetry.analytics_user_daily` / `_install_profile` /
//      `_account_profile` — 스케줄 빌드(index.ts)가 채우는 파생표. 사람 축 뷰가
//      `analytics_user_daily` 를 읽으므로 뷰보다 **먼저** 있어야 한다.
//   3) `marblo_identity.analytics_user_install` — 링크표(설계 §6.1).
//   4) 사람 축 뷰 두 벌 — `v_person_since_link` / `v_person_all_time`(§6.4).
//
// ★게이트가 닫힌 채로 돌려도 안전하다. 그때 뷰는 **0행 + 사유**로 만들어진다
//   ("만들되 켜지 않는다"). 게이트를 연 뒤 `--apply --replace-views` 로 다시
//   돌리면 뷰 본문만 바뀐다 — 그게 "소급을 조회로 옮기면 되돌릴 수 있다" 의 실물.

import { BigQuery } from "@google-cloud/bigquery";

import {
  ACCOUNT_PROFILE_SCHEMA,
  ANALYTICS_DATASET,
  INSTALL_PROFILE_SCHEMA,
  TABLE_ACCOUNT_PROFILE,
  TABLE_INSTALL_PROFILE,
  TABLE_USER_DAILY,
  USER_DAILY_SCHEMA,
  assertAxisPurity,
  type BqField,
} from "../src/analyticsProfiles";
import {
  IDENTITY_DATASET,
  TABLE_USER_INSTALL,
  TELEMETRY_DATASET,
  USER_INSTALL_SCHEMA,
  VIEW_PERSON_ALL_TIME,
  VIEW_PERSON_SINCE_LINK,
  buildPersonAxisViewDdl,
  buildPersonAxisViewSql,
  buildUserInstallTableDdl,
  maskPrincipal,
  resolvePersonAxisGate,
  type PersonAxisBasis,
} from "../src/personAxis";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts:204 와 같아야 한다.

const APPLY = process.argv.includes("--apply");
const REPLACE_VIEWS = process.argv.includes("--replace-views");

/**
 * ★링크표 데이터셋의 ACL. 기본값(projectOwners/projectWriters/projectReaders)을
 * 쓰지 않는 것이 이 절의 전부다.
 *
 *  - `projectReaders` 를 **넣지 않는다** — 넣으면 프로젝트 Viewer 전원이 링크표를
 *    읽는다. `assertLinkDatasetIsolation` 이 이걸 `public_principal` 로 잡는다.
 *  - `projectWriters` 를 **넣지 않는다** — 프로젝트 Editor(서비스 계정 3개)가
 *    marblo_telemetry 는 읽어도 링크표는 못 읽게 하는 것이 분리의 요점이다.
 *  - 함수 런타임 SA 만 WRITER 로 **명시** 부여한다. 이게 링크를 MERGE 한다.
 *
 * ★환경변수로 받는다 — 이메일을 소스에 박지 않는다.
 *   PERSON_AXIS_LINK_WRITER_SA : 함수 런타임 서비스 계정(WRITER)
 *   PERSON_AXIS_LINK_READER    : (선택) 사람 축을 읽어도 되는 사람(READER)
 */
function buildIdentityDatasetAccess(): Array<Record<string, string>> {
  const access: Array<Record<string, string>> = [
    { role: "OWNER", specialGroup: "projectOwners" },
  ];
  const writer = process.env.PERSON_AXIS_LINK_WRITER_SA?.trim();
  if (writer) access.push({ role: "WRITER", userByEmail: writer });
  const reader = process.env.PERSON_AXIS_LINK_READER?.trim();
  if (reader) access.push({ role: "READER", userByEmail: reader });
  return access;
}

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

/** 이미 있는 표의 실제 스키마가 기대 스키마를 **덮는지** 본다. */
type LiveField = { name: string; type: string; mode?: string };

/**
 * ★BigQuery API 는 표준 SQL 타입을 **레거시 별칭**으로 돌려준다 —
 * BOOL→BOOLEAN, INT64→INTEGER, FLOAT64→FLOAT, STRUCT→RECORD.
 * 별칭을 접지 않고 문자열로 비교하면 방금 만든 표를 "스키마가 갈렸다" 로
 * 오판한다(실제로 그렇게 오판했다). 같은 타입은 같은 이름으로 접는다.
 */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  BOOLEAN: "BOOL",
  INTEGER: "INT64",
  FLOAT: "FLOAT64",
  RECORD: "STRUCT",
};

function normalizeType(t: string): string {
  const upper = t.toUpperCase();
  return TYPE_ALIASES[upper] ?? upper;
}

function compareSchema(
  tableName: string,
  expected: ReadonlyArray<{ name: string; type: string; mode?: string }>,
  live: ReadonlyArray<LiveField>
): void {
  const liveByName = new Map(live.map((f) => [f.name, f]));
  for (const want of expected) {
    const got = liveByName.get(want.name);
    if (!got) {
      fail(
        `${tableName}: 기대 컬럼 '${want.name}' 이 실제 표에 없다. ` +
          "조용히 넘어가지 않는다 — 스키마가 갈렸다."
      );
      continue;
    }
    if (normalizeType(got.type) !== normalizeType(want.type)) {
      fail(
        `${tableName}.${want.name}: 타입이 다르다 (기대 ${want.type} / 실제 ${got.type}). ` +
          "BigQuery 는 타입을 바꿀 수 없다 — 사람이 판단해야 한다."
      );
    }
    const liveMode = got.mode ?? "NULLABLE";
    const wantMode = want.mode ?? "NULLABLE";
    if (liveMode !== wantMode) {
      fail(
        `${tableName}.${want.name}: 모드가 다르다 (기대 ${wantMode} / 실제 ${liveMode}).`
      );
    }
  }
}

async function ensureIdentityDataset(): Promise<void> {
  const dataset = bigquery.dataset(IDENTITY_DATASET);
  const [exists] = await dataset.exists();
  if (exists) {
    const [meta] = await dataset.getMetadata();
    const principals = (meta?.access ?? []).map(
      (e: Record<string, string>) =>
        e.userByEmail ?? e.groupByEmail ?? e.specialGroup ?? e.iamMember ?? e.domain
    );
    note(
      `[skip] 데이터셋 ${IDENTITY_DATASET} 이미 있음 — ACL 은 건드리지 않는다. ` +
        `principal ${principals.length}개: ` +
        principals.filter(Boolean).map(maskPrincipal).join(", ")
    );
    return;
  }
  const access = buildIdentityDatasetAccess();
  if (!process.env.PERSON_AXIS_LINK_WRITER_SA?.trim()) {
    fail(
      "PERSON_AXIS_LINK_WRITER_SA 미설정 — 함수 런타임 SA 에 WRITER 를 주지 않으면 " +
        "인증 경로의 링크 MERGE 가 권한오류로 죽는다. 값은 이 스크립트에 " +
        "환경변수로 넘겨라(소스에 이메일을 박지 않는다)."
    );
    return;
  }
  actions.push(
    `CREATE DATASET ${IDENTITY_DATASET} (location=${BQ_LOCATION}, ` +
      `access=${access.length}건, ★projectWriters/projectReaders 없음)`
  );
  if (!APPLY) return;
  await bigquery.createDataset(IDENTITY_DATASET, {
    location: BQ_LOCATION,
    access,
    description:
      "사람 축 링크표 전용. ★marblo_telemetry 와 **IAM 이 다르다** — " +
      "데이터셋만 나누고 권한이 같으면 이름표만 다른 같은 방이다(설계 §4.2-3). " +
      "projectWriters/projectReaders 를 일부러 부여하지 않았다.",
  });
  note(`[ok] 데이터셋 ${IDENTITY_DATASET} 생성`);
}

/** 파생표를 보장한다. ★축 검사를 **BQ 에 만들기 전에** 돌린다(index.ts 와 같은 규약). */
async function ensureProfileTable(
  tableName: string,
  schema: ReadonlyArray<BqField>,
  partitionField?: string
): Promise<void> {
  assertAxisPurity(tableName, schema);
  const table = bigquery.dataset(ANALYTICS_DATASET).table(tableName);
  const [exists] = await table.exists();
  if (exists) {
    const [meta] = await table.getMetadata();
    compareSchema(tableName, schema, meta?.schema?.fields ?? []);
    note(`[skip] ${ANALYTICS_DATASET}.${tableName} 이미 있음 — 스키마 대조만 했다.`);
    return;
  }
  actions.push(`CREATE TABLE ${ANALYTICS_DATASET}.${tableName}`);
  if (!APPLY) return;
  await table.create({
    schema: schema as unknown as { name: string; type: string }[],
    ...(partitionField
      ? { timePartitioning: { type: "DAY", field: partitionField } }
      : {}),
  });
  note(`[ok] ${ANALYTICS_DATASET}.${tableName} 생성`);
}

/** 원본은 확인만 한다 — 만들지도 고치지도 않는다. */
async function requireSourceTable(tableName: string): Promise<void> {
  const [exists] = await bigquery
    .dataset(TELEMETRY_DATASET)
    .table(tableName)
    .exists();
  if (!exists) {
    fail(
      `${TELEMETRY_DATASET}.${tableName} 이 없다 — 이 스크립트는 원본을 만들지 않는다. ` +
        "선행 티켓(백필)이 안 돌았는지 확인해라."
    );
    return;
  }
  note(`[ok] 원본 ${TELEMETRY_DATASET}.${tableName} 확인(수정 안 함)`);
}

async function ensureLinkTable(): Promise<void> {
  const table = bigquery.dataset(IDENTITY_DATASET).table(TABLE_USER_INSTALL);
  const [datasetExists] = await bigquery.dataset(IDENTITY_DATASET).exists();
  if (!datasetExists) {
    note(`[plan] ${IDENTITY_DATASET} 생성 뒤 링크표를 만든다.`);
    actions.push(`CREATE TABLE ${IDENTITY_DATASET}.${TABLE_USER_INSTALL}`);
    if (!APPLY) return;
  }
  const [exists] = datasetExists ? await table.exists() : [false];
  if (exists) {
    const [meta] = await table.getMetadata();
    compareSchema(TABLE_USER_INSTALL, USER_INSTALL_SCHEMA, meta?.schema?.fields ?? []);
    const part = meta?.timePartitioning?.field;
    if (part !== "first_linked_at") {
      fail(
        `${TABLE_USER_INSTALL}: 파티션 컬럼이 다르다 (기대 first_linked_at / 실제 ${part ?? "없음"}).`
      );
    }
    note(`[skip] ${IDENTITY_DATASET}.${TABLE_USER_INSTALL} 이미 있음 — 스키마 대조만 했다.`);
    return;
  }
  const ddl = buildUserInstallTableDdl(PROJECT_ID);
  actions.push(`CREATE TABLE IF NOT EXISTS ${IDENTITY_DATASET}.${TABLE_USER_INSTALL}`);
  if (!APPLY) {
    note(ddl);
    return;
  }
  await bigquery.query({ query: ddl, location: BQ_LOCATION });
  note(`[ok] ${IDENTITY_DATASET}.${TABLE_USER_INSTALL} 생성`);
}

/**
 * 뷰 본문을 비교 가능한 모양으로 접는다.
 *
 * ★BigQuery 는 `CREATE VIEW ... AS` 뒤의 **선행 주석 블록을 저장하지 않는다**
 * (본문 중간 주석은 그대로 남는다). **후행** 주석도 마찬가지로 잘려 나간다 —
 * `v_person_all_time` 은 마지막 두 줄이 주석이라 여기에 정확히 걸린다.
 * 그래서 빌더가 만든 SQL 과 저장된 SQL 을 그대로 비교하면 항상 "다르다" 가
 * 나오고, 그러면 이 경고가 늑대소년이 된다. 앞뒤 주석·빈 줄만 걷어내고 나머지는
 * **글자 그대로** 비교한다 — 공백까지 정규화하면 진짜 차이를 놓친다.
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

async function ensureView(basis: PersonAxisBasis): Promise<void> {
  const gate = resolvePersonAxisGate();
  const name = basis === "since_link" ? VIEW_PERSON_SINCE_LINK : VIEW_PERSON_ALL_TIME;
  const ddl = buildPersonAxisViewDdl(basis, gate, PROJECT_ID);
  const view = bigquery.dataset(IDENTITY_DATASET).table(name);
  const [datasetExists] = await bigquery.dataset(IDENTITY_DATASET).exists();
  const [exists] = datasetExists ? await view.exists() : [false];

  if (exists) {
    const [meta] = await view.getMetadata();
    const live: string = meta?.view?.query ?? "";
    // ★DDL 문자열을 잘라 쓰지 않는다 — 본문 안에도 " AS " 가 있어서 엉뚱한
    //   자리에서 잘리고, 그러면 "본문이 다르다" 를 항상 거짓으로 말한다.
    //   본문은 본문 빌더에서 직접 받는다.
    const want = buildPersonAxisViewSql(basis, gate, PROJECT_ID);
    if (normalizeViewBody(live) === normalizeViewBody(want)) {
      note(`[skip] 뷰 ${name} 이미 같은 본문이다 — 아무것도 하지 않는다.`);
      return;
    }
    if (!REPLACE_VIEWS) {
      fail(
        `뷰 ${name} 이 이미 있고 본문이 다르다. 덮어쓰기는 되돌릴 수 없으므로 ` +
          "`--replace-views` 를 명시하지 않으면 바꾸지 않는다. " +
          `(게이트: ${gate.open ? `open ${gate.effectiveFrom}` : `closed/${gate.reasonCode}`})`
      );
      return;
    }
    actions.push(`CREATE OR REPLACE VIEW ${IDENTITY_DATASET}.${name} (★기존 본문 교체)`);
  } else {
    actions.push(`CREATE VIEW ${IDENTITY_DATASET}.${name}`);
  }
  if (!APPLY) {
    note(ddl);
    return;
  }
  await bigquery.query({ query: ddl, location: BQ_LOCATION });
  note(`[ok] 뷰 ${name} ${exists ? "교체" : "생성"}`);
}

async function main(): Promise<void> {
  const gate = resolvePersonAxisGate();
  note("── 사람 축 표·뷰 프로비저닝 ───────────────────────────────────");
  note(`  프로젝트   : ${PROJECT_ID} (${BQ_LOCATION})`);
  note(`  모드       : ${APPLY ? "★APPLY(실제 생성)" : "dry-run(기본)"}`);
  note(
    `  게이트     : ${
      gate.open
        ? `open — 상한 ${gate.effectiveFrom}`
        : `closed(${gate.reasonCode}) — 뷰는 0행 + 사유로 만들어진다`
    }`
  );
  note("");

  // 원본은 확인만. ★analytics_identity 는 익명축 정본이고 여기서 안 건드린다.
  await requireSourceTable("analytics_identity");
  await requireSourceTable("events");

  await ensureIdentityDataset();
  await ensureProfileTable(TABLE_USER_DAILY, USER_DAILY_SCHEMA, "day");
  await ensureProfileTable(TABLE_INSTALL_PROFILE, INSTALL_PROFILE_SCHEMA);
  await ensureProfileTable(TABLE_ACCOUNT_PROFILE, ACCOUNT_PROFILE_SCHEMA);
  await ensureLinkTable();
  await ensureView("since_link");
  await ensureView("all_time");

  note("");
  note("── 계획/실행 요약 ─────────────────────────────────────────────");
  if (actions.length === 0) note("  (변경 없음 — 전부 이미 있다)");
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
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[provision-person-axis] 실패: ${msg}`);
  process.exit(1);
});
