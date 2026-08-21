// 사람 축 링크표의 **권한 분리**를 실제 IAM 으로 확인한다 (ticket cZWmTzoOXpHCg9HAUwqw).
//
// 실행:
//   cd v3/functions && npm run check:person-axis-isolation
//
// ── ★왜 이 스크립트가 있나 ──────────────────────────────────────────────────
// 설계 §6.1 은 링크표를 `marblo_identity` 라는 **다른 데이터셋**에 두라고 했다.
// 그런데 데이터셋을 나누는 것 자체는 권한 분리가 아니다. 두 데이터셋의 principal
// 집합이 같으면 **이름표만 다른 같은 방**이고, "익명축만 읽기 권한을 줄 수 있다"
// 는 §4.2-3 의 근거가 실현되지 않는다.
//
// 주석으로 "권한을 분리했다" 고 적어두면 아무도 확인하지 않는다. 그래서 기계가
// 대신 읽는다 — #1079 의 assertAxisPurity 와 같은 방향이다.
//
// ── 이 스크립트가 하지 않는 것 ──────────────────────────────────────────────
//  - 권한을 **바꾸지 않는다.** 읽고 판정만 한다(BQ 원본 수정·삭제 금지).
//  - 데이터를 한 행도 읽지 않는다. 데이터셋 메타데이터(access[])만 본다.
//  - 이메일 원문을 출력하지 않는다 — `maskPrincipal` 로 마스킹해서 찍는다.
//
// 종료코드: 분리가 확인되면 0, 아니면 1. CI/배포 게이트에 그대로 걸 수 있다.

import { BigQuery } from "@google-cloud/bigquery";

import {
  IDENTITY_DATASET,
  TELEMETRY_DATASET,
  assertLinkDatasetIsolation,
  maskPrincipal,
  type DatasetAccessEntry,
} from "../src/personAxis";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "marblo-2253d";
const BQ_LOCATION = "US"; // index.ts:183 과 동일해야 한다.

/** BQ 데이터셋 메타데이터의 access[] 한 줄. 필드명이 principal 종류를 말한다. */
type BqAccessEntry = {
  role?: string;
  userByEmail?: string;
  groupByEmail?: string;
  specialGroup?: string;
  iamMember?: string;
  domain?: string;
  view?: unknown;
  routine?: unknown;
  dataset?: unknown;
};

/**
 * access[] 한 줄을 (role, principal, principalType) 으로 접는다.
 *
 * ★`view`/`routine`/`dataset` 엔트리는 authorized view 부여라서 사람 principal 이
 * 아니다 — 건너뛴다. 이걸 principal 로 세면 분리 판정이 엉뚱해진다.
 */
function foldAccess(
  entries: ReadonlyArray<BqAccessEntry>
): DatasetAccessEntry[] {
  const out: DatasetAccessEntry[] = [];
  for (const e of entries) {
    const role = e.role ?? "UNKNOWN";
    if (typeof e.userByEmail === "string") {
      out.push({ role, principal: e.userByEmail, principalType: "user" });
    } else if (typeof e.groupByEmail === "string") {
      out.push({ role, principal: e.groupByEmail, principalType: "group" });
    } else if (typeof e.specialGroup === "string") {
      out.push({
        role,
        principal: e.specialGroup,
        principalType: "specialGroup",
      });
    } else if (typeof e.iamMember === "string") {
      out.push({ role, principal: e.iamMember, principalType: "iamMember" });
    } else if (typeof e.domain === "string") {
      out.push({ role, principal: e.domain, principalType: "domain" });
    }
    // view/routine/dataset 엔트리는 의도적으로 건너뛴다(위 주석 참조).
  }
  return out;
}

async function readAccess(
  bigquery: BigQuery,
  datasetId: string
): Promise<{ found: boolean; entries: DatasetAccessEntry[] }> {
  const dataset = bigquery.dataset(datasetId);
  const [exists] = await dataset.exists();
  if (!exists) return { found: false, entries: [] };
  const [metadata] = await dataset.getMetadata();
  const access = (metadata?.access ?? []) as BqAccessEntry[];
  return { found: true, entries: foldAccess(access) };
}

async function main(): Promise<void> {
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    location: BQ_LOCATION,
  });

  const telemetry = await readAccess(bigquery, TELEMETRY_DATASET);
  const identity = await readAccess(bigquery, IDENTITY_DATASET);

  if (!telemetry.found) {
    console.error(
      `[fail] ${TELEMETRY_DATASET} 데이터셋이 없다 — 프로젝트를 확인해라.`
    );
    process.exit(1);
  }
  if (!identity.found) {
    // ★아직 안 만든 상태는 실패가 아니다. 사람 축 게이트가 닫혀 있는 동안에는
    //   링크표도 데이터셋도 없는 게 정상이다("만들되 켜지 않는다").
    console.log(
      `[skip] ${IDENTITY_DATASET} 데이터셋이 아직 없다 — 링크표 생성 전이다. ` +
        "게이트가 닫혀 있는 동안에는 정상 상태다."
    );
    console.log(
      `[info] ${TELEMETRY_DATASET} principal 수=${telemetry.entries.length}`
    );
    return;
  }

  const report = assertLinkDatasetIsolation(
    telemetry.entries,
    identity.entries
  );

  console.log(
    "── 사람 축 권한 분리 점검 ─────────────────────────────────────"
  );
  console.log(
    `  ${TELEMETRY_DATASET} principal 수 : ${report.telemetryPrincipalCount}`
  );
  console.log(
    `  ${IDENTITY_DATASET} principal 수 : ${report.identityPrincipalCount}`
  );
  console.log(
    `  양쪽 다 읽는 principal          : ${report.overlapping.length}`
  );
  for (const p of report.overlapping) console.log(`    - ${p}`);
  console.log(
    `  링크표만 읽는 principal         : ${report.identityOnly.length}`
  );
  for (const p of report.identityOnly) console.log(`    - ${p}`);

  if (report.ok) {
    console.log("[ok] 데이터셋 이름이 아니라 IAM 으로 갈려 있다.");
    return;
  }

  console.error("[fail] 권한이 실제로는 분리되지 않았다:");
  for (const f of report.findings) {
    console.error(`  · [${f.code}] ${f.message}`);
    for (const p of f.principals) console.error(`      ${maskPrincipal(p)}`);
  }
  console.error(
    "  → 링크표를 따로 둔 이유(익명축만 읽기 권한을 줄 수 있다)가 실현되지 " +
      "않는다. marblo_identity 의 READER 를 사람 축 전용 principal 로 좁혀라."
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[check-person-axis-isolation] 실패: ${msg}`);
  process.exit(1);
});
