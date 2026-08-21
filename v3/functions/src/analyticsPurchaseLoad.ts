/**
 * `analytics_purchase` 적재 — 테이블 보장 + 스테이징 로드 + MERGE(멱등).
 *
 * analyticsPurchase.ts 가 "무엇을 적을지"(순수 매핑)를 정하고, 이 모듈이
 * "어떻게 넣을지"를 맡는다. BigQuery 클라이언트는 **주입**받는다 — 스케줄
 * 함수(index.ts)와 백필 스크립트가 같은 코드를 공유하게 하려는 것이고,
 * SQL 생성기는 순수 함수라 `node --test` 로 검증한다.
 *
 * ── ★왜 스트리밍 insert 가 아니라 로드 잡 + MERGE 인가 ──────────────────────
 * 이 티켓의 핵심 요구는 "재실행으로 중복 적재되면 매출이 두 배로 보인다" 다.
 *  - `table.insert()`(스트리밍)의 `insertId` 중복제거는 **best-effort, 수 분
 *    창** 이다. 어제 넣은 행을 오늘 다시 넣으면 그대로 두 줄이 된다.
 *  - 게다가 스트리밍 버퍼에 있는 행은 곧바로 조회·DML 대상이 되지 않아
 *    "이미 있나 SELECT 로 확인하고 없으면 insert" 도 안전하지 않다(방금 넣은
 *    행이 안 보여서 다시 넣게 된다).
 * 로드 잡은 스토리지에 직접 쓰므로 버퍼 지연이 없고, 그 위에 `MERGE ... ON
 * row_id` 를 걸면 **몇 번을 돌려도 행 수가 같다.** 그게 여기서 필요한 멱등이다.
 *
 * ★MERGE 의 UPDATE 절은 실제로 값이 달라졌을 때만 발화한다. 그래서 아무것도
 *   바뀌지 않은 재실행은 `numDmlAffectedRows = 0` 이 되고, 그 0 이 곧 멱등
 *   증명이 된다(운영에서 눈으로 확인할 수 있는 값).
 */

import { Readable } from "node:stream";

import {
  ANALYTICS_PURCHASE_COLUMNS,
  ANALYTICS_PURCHASE_SCHEMA,
  ANALYTICS_PURCHASE_STAGING_TABLE,
  ANALYTICS_PURCHASE_TABLE,
  dedupeRows,
  toNdjson,
  type PurchaseRow,
} from "./analyticsPurchase";

/** BigQuery 스키마 필드(클라이언트가 요구하는 느슨한 형태). */
type SchemaField = { name: string; type: string; mode: string };

const SCHEMA_FIELDS = ANALYTICS_PURCHASE_SCHEMA as unknown as SchemaField[];

/**
 * 필요한 것만 추린 BigQuery 인터페이스. 실제 `BigQuery` 인스턴스가 이걸
 * 만족하고, 테스트는 가짜를 넣는다.
 */
export interface BqTableLike {
  exists(): Promise<[boolean]>;
  create(options: unknown): Promise<unknown>;
  getMetadata(): Promise<[{ schema?: { fields?: { name: string }[] } }]>;
  setMetadata(metadata: unknown): Promise<unknown>;
  createWriteStream(metadata: unknown): NodeJS.WritableStream;
}

export interface BqDatasetLike {
  table(id: string): BqTableLike;
}

export interface BqJobLike {
  getQueryResults(): Promise<unknown>;
  getMetadata(): Promise<
    [{ statistics?: { query?: { numDmlAffectedRows?: string | number } } }]
  >;
}

export interface BqLike {
  dataset(id: string): BqDatasetLike;
  /** 실제 클라이언트는 [Job, IJob] 을 돌려준다 — 첫 원소만 쓴다. */
  createQueryJob(options: unknown): Promise<BqJobLike[]>;
}

/**
 * MERGE SQL 생성(순수).
 *
 * `IS DISTINCT FROM` 으로 NULL 안전 비교를 한다 — `!=` 만 쓰면 NULL 이 끼는
 * 순간 비교가 UNKNOWN 이 되어 "바뀌었는데 안 바뀐 걸로" 읽힌다(그러면 나중에
 * 채워질 refund 금액 같은 값이 영영 갱신되지 않는다).
 *
 * `ingested_at` 은 비교에서 뺀다 — 매 실행 값이 달라지므로 넣으면 모든 행이
 * 항상 "바뀐" 것이 되어 no-op 재실행의 0 이 사라진다.
 */
export function buildMergeSql(
  projectId: string,
  datasetId: string,
  targetTable: string = ANALYTICS_PURCHASE_TABLE,
  stagingTable: string = ANALYTICS_PURCHASE_STAGING_TABLE
): string {
  const target = `\`${projectId}.${datasetId}.${targetTable}\``;
  const staging = `\`${projectId}.${datasetId}.${stagingTable}\``;
  const updatable = ANALYTICS_PURCHASE_COLUMNS.filter((c) => c !== "row_id");
  const compared = updatable.filter((c) => c !== "ingested_at");

  const changed = compared
    .map((c) => `T.${c} IS DISTINCT FROM S.${c}`)
    .join("\n    OR ");
  const setClause = updatable.map((c) => `${c} = S.${c}`).join(",\n    ");
  const cols = ANALYTICS_PURCHASE_COLUMNS.join(", ");
  const values = ANALYTICS_PURCHASE_COLUMNS.map((c) => `S.${c}`).join(", ");

  return [
    `MERGE ${target} T`,
    `USING ${staging} S`,
    `ON T.row_id = S.row_id`,
    `WHEN MATCHED AND (`,
    `    ${changed}`,
    `) THEN UPDATE SET`,
    `    ${setClause}`,
    `WHEN NOT MATCHED THEN`,
    `  INSERT (${cols})`,
    `  VALUES (${values})`,
  ].join("\n");
}

/**
 * 대상 테이블을 최초 1회 생성한다. 이미 있으면 **새로 생긴 NULLABLE 컬럼만**
 * 덧붙인다(installAttribution 의 ensureAttributionTable 과 같은 규약).
 * 컬럼을 코드에만 추가하고 BQ 를 그대로 두면 로드 잡이 통째로 실패한다.
 */
export async function ensureAnalyticsPurchaseTable(
  bq: BqLike,
  datasetId: string,
  tableId: string = ANALYTICS_PURCHASE_TABLE
): Promise<"created" | "unchanged" | "extended"> {
  const table = bq.dataset(datasetId).table(tableId);
  const [exists] = await table.exists();
  if (!exists) {
    await table.create({
      schema: SCHEMA_FIELDS,
      timePartitioning: { type: "DAY", field: "event_at" },
      // 수익 질의는 거의 항상 kind(총/순매출 분해) 로 자르고, 사용자 단위
      // 조인은 user_key 로 간다.
      clustering: { fields: ["kind", "user_key"] },
    });
    return "created";
  }

  const [metadata] = await table.getMetadata();
  const live = metadata?.schema?.fields ?? [];
  const liveNames = new Set(live.map((f) => f.name));
  const missing = SCHEMA_FIELDS.filter((f) => !liveNames.has(f.name));
  // REQUIRED 를 기존 테이블에 붙이는 건 BigQuery 가 거부한다 — NULLABLE 만.
  const additive = missing.filter((f) => f.mode === "NULLABLE");
  if (additive.length === 0) return "unchanged";
  await table.setMetadata({ schema: { fields: [...live, ...additive] } });
  return "extended";
}

/**
 * 스테이징 테이블을 이번 배치로 통째로 덮어쓴다(WRITE_TRUNCATE).
 * 로드 잡이므로 스트리밍 버퍼가 없고, 끝나는 즉시 MERGE 대상이 된다.
 */
export async function loadStaging(
  bq: BqLike,
  datasetId: string,
  rows: ReadonlyArray<PurchaseRow>,
  stagingTable: string = ANALYTICS_PURCHASE_STAGING_TABLE
): Promise<void> {
  const table = bq.dataset(datasetId).table(stagingTable);
  const ndjson = toNdjson(rows);
  const stream = table.createWriteStream({
    sourceFormat: "NEWLINE_DELIMITED_JSON",
    schema: { fields: SCHEMA_FIELDS },
    writeDisposition: "WRITE_TRUNCATE",
    createDisposition: "CREATE_IF_NEEDED",
  });

  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    // 'complete' 는 로드 잡이 끝났을 때 job 과 함께 발화한다. 잡이 실패하면
    // errorResult 가 실려 오므로 여기서 던져 호출부가 알게 한다.
    stream.on("complete", (job: { status?: { errorResult?: unknown } }) => {
      const err = job?.status?.errorResult;
      if (err) {
        reject(new Error(`analytics_purchase staging load failed`));
        return;
      }
      resolve();
    });
    Readable.from([ndjson]).pipe(stream);
  });
}

/** MERGE 실행. 영향 행 수를 돌려준다(no-op 재실행이면 0). */
export async function mergeStagingIntoTarget(
  bq: BqLike,
  projectId: string,
  datasetId: string,
  location: string,
  targetTable: string = ANALYTICS_PURCHASE_TABLE,
  stagingTable: string = ANALYTICS_PURCHASE_STAGING_TABLE
): Promise<number> {
  const [job] = await bq.createQueryJob({
    query: buildMergeSql(projectId, datasetId, targetTable, stagingTable),
    location,
  });
  await job.getQueryResults();
  const [metadata] = await job.getMetadata();
  const affected = metadata?.statistics?.query?.numDmlAffectedRows;
  return typeof affected === "string"
    ? Number(affected)
    : typeof affected === "number"
    ? affected
    : 0;
}

export interface LoadOutcome {
  /** 이번 배치가 만든 행 수(중복 제거 후). */
  staged: number;
  /** 배치 안에서 row_id 가 겹쳐 접힌 수. 0 이 아니면 매핑을 의심하라. */
  collapsed: number;
  /** MERGE 가 실제로 바꾼 행 수. 재실행에서 0 이면 멱등이 지켜진 것. */
  affected: number;
  tableState: "created" | "unchanged" | "extended";
}

/**
 * 전체 적재 파이프라인. 스케줄 함수와 백필 스크립트가 이것 하나만 부른다.
 * 행이 0 건이면 스테이징을 비우고 MERGE 를 건너뛴다 — 빈 배치가 기존 데이터를
 * 건드리지 않게(이 MERGE 에는 DELETE 절이 없어 원래도 안전하지만, 잡을 굳이
 * 돌리지 않는다).
 */
export async function loadPurchaseRows(
  bq: BqLike,
  params: {
    projectId: string;
    datasetId: string;
    location: string;
    rows: ReadonlyArray<PurchaseRow>;
    /** 테이블 이름 override — 멱등 자가검증이 운영 테이블을 건드리지 않게 한다. */
    targetTable?: string;
    stagingTable?: string;
  }
): Promise<LoadOutcome> {
  const targetTable = params.targetTable ?? ANALYTICS_PURCHASE_TABLE;
  const stagingTable = params.stagingTable ?? ANALYTICS_PURCHASE_STAGING_TABLE;
  const tableState = await ensureAnalyticsPurchaseTable(
    bq,
    params.datasetId,
    targetTable
  );
  const deduped = dedupeRows(params.rows);
  const collapsed = params.rows.length - deduped.length;
  if (deduped.length === 0) {
    return { staged: 0, collapsed, affected: 0, tableState };
  }
  await loadStaging(bq, params.datasetId, deduped, stagingTable);
  const affected = await mergeStagingIntoTarget(
    bq,
    params.projectId,
    params.datasetId,
    params.location,
    targetTable,
    stagingTable
  );
  return { staged: deduped.length, collapsed, affected, tableState };
}
