// 통합 뷰 단위 테스트 — GUI 없이, BigQuery 없이 잠근다.
//
// 실행: cd v3/functions && npm run test:install-unified
//
// ★여기서 검증하는 것은 "SQL 이 돈다" 가 아니라 **규약이 안 깨진다** 는 것이다.
//   특히 0 과 미적재를 가르는 사유 사다리 — 그게 이 티켓의 본체다.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTIVATION_REASON_NO_FIRST_RUN,
  CHANNEL_REASONS,
  GA4_CAMPAIGN_SENTINELS,
  IDENTITY_DATASET,
  REVENUE_REASONS,
  REVENUE_REASON_GATE_CLOSED,
  RETENTION_REASON_NO_DAILY_ROWS,
  TELEMETRY_DATASET,
  VIEW_INSTALL_UNIFIED,
  VIEW_INSTALL_UNIFIED_REVENUE,
  buildReasonCase,
  buildRevenueViewDdl,
  buildRevenueViewSql,
  buildUnifiedViewDdl,
  buildUnifiedViewSql,
  findForbiddenTokens,
  resolveChannelMissingReason,
  resolveRevenueMissingReason,
  sqlString,
  type ChannelFacts,
  type RevenueFacts,
} from "./installUnified";
import { resolvePersonAxisGate, type PersonAxisGate } from "./personAxis";

const PROJECT = "marblo-2253d";

const OPEN_GATE: PersonAxisGate = {
  open: true,
  reasonCode: null,
  reason: null,
  effectiveFrom: "2026-04-01",
};

const CLOSED_GATE: PersonAxisGate = resolvePersonAxisGate({});

/** 채널이 완전히 채워진 설치. 각 테스트는 여기서 한 칸씩만 무너뜨린다. */
function fullChannel(): ChannelFacts {
  return {
    hasLedgerRow: true,
    hasGaClientId: true,
    hasGaKeyHmac: true,
    hasGa4Row: true,
    campaign: "summer_launch",
  };
}

function fullRevenue(): RevenueFacts {
  return {
    gateOpen: true,
    hasInstallKeyHmac: true,
    personLinkCount: 1,
    currencyCount: 1,
  };
}

// ── 1. 채널 사유 사다리 ──────────────────────────────────────────────────────

test("채널이 다 갖춰지면 사유가 없다 — NULL 은 '캠페인이 실재한다' 는 뜻이다", () => {
  assert.equal(resolveChannelMissingReason(fullChannel()), null);
});

test("사다리는 위에서부터 첫 번째 해당을 고른다 — 여러 개가 동시에 맞아도 하나다", () => {
  // 전부 무너진 설치. 가장 바깥(원장 없음)이 이겨야 한다.
  const nothing: ChannelFacts = {
    hasLedgerRow: false,
    hasGaClientId: false,
    hasGaKeyHmac: false,
    hasGa4Row: false,
    campaign: null,
  };
  assert.equal(resolveChannelMissingReason(nothing), "no_ledger_row");
});

test("각 단계가 자기 사유를 낸다", () => {
  const cases: ReadonlyArray<[Partial<ChannelFacts>, string]> = [
    [{ hasLedgerRow: false }, "no_ledger_row"],
    [{ hasGaClientId: false }, "no_ga_client_id"],
    [{ hasGaKeyHmac: false }, "key_mismatch"],
    [{ hasGa4Row: false }, "no_ga4_row"],
    [{ campaign: null }, "no_utm"],
  ];
  for (const [patch, want] of cases) {
    assert.equal(
      resolveChannelMissingReason({ ...fullChannel(), ...patch }),
      want,
      `${JSON.stringify(patch)} → ${want}`
    );
  }
});

test("★key_mismatch 와 no_ga4_row 는 다른 사유다 — 합치면 무엇을 고쳐야 할지 못 읽는다", () => {
  // #1195 배포 전 행: 원시 키는 있는데 가명 키가 없다 → key_mismatch 가 **정상값**.
  const preDeploy = { ...fullChannel(), hasGaKeyHmac: false, hasGa4Row: false };
  assert.equal(resolveChannelMissingReason(preDeploy), "key_mismatch");

  // 브리지 동기화 창 밖: 키는 들고 있는데 브리지에 방문자가 없다.
  const outsideWindow = { ...fullChannel(), hasGa4Row: false };
  assert.equal(resolveChannelMissingReason(outsideWindow), "no_ga4_row");
});

test("★GA4 센티널은 캠페인이 아니다 — 전부 no_utm 이고 '(direct)' 를 캠페인으로 세지 않는다", () => {
  for (const sentinel of GA4_CAMPAIGN_SENTINELS) {
    assert.equal(
      resolveChannelMissingReason({ ...fullChannel(), campaign: sentinel }),
      "no_utm",
      sentinel
    );
    // 대소문자·공백이 섞여도 같다.
    assert.equal(
      resolveChannelMissingReason({
        ...fullChannel(),
        campaign: `  ${sentinel.toUpperCase()}  `,
      }),
      "no_utm"
    );
  }
  // 빈 문자열도 캠페인이 아니다.
  assert.equal(
    resolveChannelMissingReason({ ...fullChannel(), campaign: "" }),
    "no_utm"
  );
});

test("★no_utm 만 '진짜 0' 이고 나머지는 '모른다' 다", () => {
  const kinds = new Map(CHANNEL_REASONS.map((r) => [r.reason, r.kind]));
  assert.equal(kinds.get("no_utm"), "true_zero");
  for (const reason of [
    "no_ledger_row",
    "no_ga_client_id",
    "key_mismatch",
    "no_ga4_row",
  ]) {
    assert.equal(kinds.get(reason), "unknown", reason);
  }
});

test("모든 입력 조합에서 사유는 정확히 0개 또는 1개다 (전수)", () => {
  const bools = [true, false];
  const campaigns = [null, "", "(direct)", "real_campaign"];
  let known = 0;
  let unknown = 0;
  for (const hasLedgerRow of bools)
    for (const hasGaClientId of bools)
      for (const hasGaKeyHmac of bools)
        for (const hasGa4Row of bools)
          for (const campaign of campaigns) {
            const facts: ChannelFacts = {
              hasLedgerRow,
              hasGaClientId,
              hasGaKeyHmac,
              hasGa4Row,
              campaign,
            };
            const reason = resolveChannelMissingReason(facts);
            if (reason === null) {
              known++;
              // ★사유가 없으면 반드시 캠페인이 실재해야 한다. 이게 깨지면
              //   빈 값이 값으로 읽힌다.
              assert.equal(hasLedgerRow, true);
              assert.equal(hasGaKeyHmac, true);
              assert.equal(hasGa4Row, true);
              assert.equal(campaign, "real_campaign");
            } else {
              unknown++;
              assert.ok(
                CHANNEL_REASONS.some((r) => r.reason === reason),
                `모르는 사유: ${reason}`
              );
            }
          }
  assert.equal(known, 1, "캠페인이 실재하는 조합은 정확히 하나여야 한다");
  assert.equal(known + unknown, 2 * 2 * 2 * 2 * 4);
});

// ── 2. 결제 사유 사다리 ──────────────────────────────────────────────────────

test("결제 축이 다 갖춰지면 사유가 없다 — 그때 금액은 0 일 수 있다", () => {
  assert.equal(resolveRevenueMissingReason(fullRevenue()), null);
});

test("게이트가 닫히면 다른 무엇보다 먼저 person_axis_closed 다", () => {
  const closed = { ...fullRevenue(), gateOpen: false, hasInstallKeyHmac: false };
  assert.equal(resolveRevenueMissingReason(closed), REVENUE_REASON_GATE_CLOSED);
});

test("결제 사다리 각 단계", () => {
  const cases: ReadonlyArray<[Partial<RevenueFacts>, string]> = [
    [{ hasInstallKeyHmac: false }, "no_install_key_hmac"],
    [{ personLinkCount: 0 }, "no_person_link"],
    [{ personLinkCount: 2 }, "shared_device"],
    [{ currencyCount: 2 }, "mixed_currency"],
  ];
  for (const [patch, want] of cases) {
    assert.equal(
      resolveRevenueMissingReason({ ...fullRevenue(), ...patch }),
      want,
      `${JSON.stringify(patch)} → ${want}`
    );
  }
});

test("★공용 기기는 귀속을 고르지 않고 센다", () => {
  assert.equal(
    resolveRevenueMissingReason({ ...fullRevenue(), personLinkCount: 3 }),
    "shared_device"
  );
});

test("★결제 사유는 전부 '모른다' 다 — '결제 없음' 은 사유가 아니라 0 이다", () => {
  for (const rung of REVENUE_REASONS) {
    assert.equal(rung.kind, "unknown", rung.reason);
  }
  assert.ok(
    !REVENUE_REASONS.some((r) => r.reason === "no_purchase"),
    "결제 없음을 사유로 만들면 0 과 미적재가 다시 섞인다"
  );
});

// ── 3. SQL 생성 — 사다리와 CASE 가 갈리지 않는다 ────────────────────────────

test("CASE 는 사다리 배열 순서를 그대로 쓴다", () => {
  const sql = buildReasonCase(CHANNEL_REASONS);
  const order = CHANNEL_REASONS.map((r) => sql.indexOf(sqlString(r.reason)));
  for (const idx of order) assert.ok(idx > 0, "모든 사유가 CASE 에 있어야 한다");
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], "CASE 순서가 사다리 순서와 같아야 한다");
  }
  assert.match(sql, /ELSE NULL/);
});

test("생성된 뷰 SQL 에 모든 사유 문자열이 들어 있다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  for (const r of CHANNEL_REASONS) assert.ok(sql.includes(`'${r.reason}'`), r.reason);
  assert.ok(sql.includes(`'${ACTIVATION_REASON_NO_FIRST_RUN}'`));
  assert.ok(sql.includes(`'${RETENTION_REASON_NO_DAILY_ROWS}'`));

  const rev = buildRevenueViewSql(PROJECT, OPEN_GATE);
  for (const r of REVENUE_REASONS) assert.ok(rev.includes(`'${r.reason}'`), r.reason);
});

// ── 4. ★조인 키 공간 — 여기가 갈리면 뷰가 조용히 빈다 ───────────────────────

test("★채널 조인은 가명 = 가명이다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  assert.ok(
    sql.includes("ON a.gaKeyHmac = g.gaKey"),
    "gaKeyHmac = gaKey 로 조인해야 한다"
  );
});

test("★원시 gaClientId 로 조인하지 않는다 — 그 조인은 영원히 0행이다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  assert.ok(!/gaClientId\s*=\s*\w+\.gaKey/.test(sql));
  assert.ok(!/gaKey\s*=\s*\w+\.gaClientId/.test(sql));
  // ga_key(원시) 로 조인하는 프로필 컬럼도 쓰지 않는다.
  assert.ok(!/p\.ga_key/.test(sql), "analytics_install_profile.ga_key 는 원시다");
});

test("★결제 조인은 gaKey 를 거치지 않는다 — 한 브라우저의 결제가 480개 설치로 복제된다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.ok(!/gaKeyHmac\s*=\s*\w+\.(user_key|install_key)/.test(sql));
  assert.ok(sql.includes("ON b.installKey = h.install_key"));
  assert.ok(sql.includes("ON h.installKeyHmac = l.installKeyHmac"));
  assert.ok(sql.includes("ON l.personKey = pu.user_key"));
});

// ── 5. 행수 보존 ────────────────────────────────────────────────────────────

test("★붙는 쪽은 전부 사전 집계이거나 유일키로 접혀 있다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  // 원장·GA4 는 QUALIFY 로 1행씩 접는다.
  assert.match(sql, /QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY installId/);
  assert.match(sql, /QUALIFY ROW_NUMBER\(\) OVER \(\s*\n?\s*PARTITION BY gaKey/);
  // 일별은 install_key 로 GROUP BY 한다.
  assert.match(sql, /GROUP BY d\.install_key/);
  // 정본은 프로필이고 **LEFT** JOIN 만 쓴다(INNER 면 설치가 사라진다).
  assert.match(sql, /FROM `marblo-2253d\.marblo_telemetry\.analytics_install_profile` p/);
  const joinsAfterFrom = sql.slice(sql.indexOf("FROM `marblo-2253d.marblo_telemetry.analytics_install_profile` p"));
  assert.ok(!/\bINNER JOIN\b/.test(joinsAfterFrom));
  assert.equal((joinsAfterFrom.match(/LEFT JOIN/g) ?? []).length, 3);
});

test("★결제 뷰도 사전 집계 뒤에 LEFT JOIN 한다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.match(sql, /GROUP BY install_key/);
  assert.match(sql, /GROUP BY user_key/);
  const tail = sql.slice(sql.indexOf("FROM ${BASE}".replace("${BASE}", "")) );
  assert.ok(!/\bINNER JOIN\b/.test(tail));
  assert.equal((sql.match(/LEFT JOIN/g) ?? []).length, 3);
});

// ── 6. PII·자리표시자 금지 ──────────────────────────────────────────────────

test("★뷰 SQL 에 uid·이메일·솔트·'(unknown)' 이 없다", () => {
  assert.deepEqual(findForbiddenTokens(buildUnifiedViewDdl(PROJECT)), []);
  assert.deepEqual(findForbiddenTokens(buildRevenueViewDdl(PROJECT, OPEN_GATE)), []);
  assert.deepEqual(findForbiddenTokens(buildRevenueViewDdl(PROJECT, CLOSED_GATE)), []);
});

test("위생 검사가 실제로 잡는다 (검사기 자체의 회귀 방지)", () => {
  assert.deepEqual(findForbiddenTokens("SELECT uid FROM t"), ["uid"]);
  assert.deepEqual(findForbiddenTokens("SELECT '(unknown)' AS x"), ["(unknown)"]);
  // 정상 이름을 오탐하지 않는다.
  assert.deepEqual(findForbiddenTokens("SELECT user_key, install_key FROM analytics_user_daily"), []);
  assert.deepEqual(findForbiddenTokens("SELECT installId -- 익명 설치 UUID"), []);
});

// ── 7. 컬럼 이름 규약 ───────────────────────────────────────────────────────

const SQL_TYPES = new Set([
  "STRING",
  "INT64",
  "TIMESTAMP",
  "NUMERIC",
  "BOOL",
  "DATE",
  "FLOAT64",
]);

function aliases(sql: string): string[] {
  const out: string[] = [];
  const re = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (!SQL_TYPES.has(m[1])) out.push(m[1]);
  }
  return out;
}

test("★컬럼은 전부 camelCase 다 (원천이 snake_case 여도 뷰에서 접는다)", () => {
  for (const sql of [
    buildUnifiedViewSql(PROJECT),
    buildRevenueViewSql(PROJECT, OPEN_GATE),
    buildRevenueViewSql(PROJECT, CLOSED_GATE),
  ]) {
    for (const alias of aliases(sql)) {
      assert.match(alias, /^[a-z][A-Za-z0-9]*$/, `camelCase 아님: ${alias}`);
    }
  }
});

test("설계 문서가 약속한 컬럼이 실제로 나온다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  const promised = [
    "installKey",
    "gaKeyHmac",
    "gaKeyInstallCount",
    "firstRunAt",
    "channelSource",
    "channelMedium",
    "channelCampaign",
    "channelContent",
    "channelTerm",
    "channelCountry",
    "channelDevice",
    "channelLandingPage",
    "channelAttributionSource",
    "hasGa4Row",
    "channelMissingReason",
    "ledgerUtmContent",
    "ledgerUtmTerm",
    "firstSpawnAt",
    "firstCompletedAt",
    "daysToFirstSpawn",
    "hasSpawned",
    "activationMissingReason",
    "activeDays7",
    "activeDays14",
    "activeDays30",
    "lastActiveDate",
    "retentionElapsedDays",
    "retentionMissingReason",
    "appVersion",
    "platform",
    "buildChannel",
    "isDevInstall",
  ];
  const found = new Set(aliases(sql));
  for (const col of promised) assert.ok(found.has(col), `누락: ${col}`);
});

test("결제 뷰의 약속 컬럼", () => {
  const promised = [
    "personKey",
    "personLinkCount",
    "personInstallCount",
    "firstPurchaseAt",
    "purchaseCount",
    "paidCount",
    "grantCount",
    "revenueTotal",
    "revenueCurrency",
    "revenueAmountUnknownCount",
    "accountClass",
    "isInternal",
    "revenueMissingReason",
    "personAxisEffectiveFrom",
  ];
  for (const gate of [OPEN_GATE, CLOSED_GATE]) {
    const found = new Set(aliases(buildRevenueViewSql(PROJECT, gate)));
    for (const col of promised) {
      assert.ok(found.has(col), `누락(${gate.open ? "open" : "closed"}): ${col}`);
    }
  }
});

// ── 8. 게이트 ───────────────────────────────────────────────────────────────

test("★게이트가 닫혀도 설치는 사라지지 않는다 — 결제 컬럼만 미상이다", () => {
  const sql = buildRevenueViewSql(PROJECT, CLOSED_GATE);
  assert.ok(sql.includes(`'${REVENUE_REASON_GATE_CLOSED}'`));
  assert.ok(sql.includes("SELECT\n  b.*"), "축약본 전 컬럼을 그대로 준다");
  // 0행으로 접는 WHERE 가 없어야 한다.
  assert.ok(!/WHERE\s+FALSE/i.test(sql));
  assert.ok(!/LIMIT\s+0/i.test(sql));
});

test("게이트가 열리면 소급 상한이 SQL 에 박힌다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.ok(sql.includes("TIMESTAMP(DATE '2026-04-01')"));
  assert.ok(sql.includes("DATE '2026-04-01' AS personAxisEffectiveFrom"));
});

// ── 9. 내부·테스트 분리 — 컬럼이되 필터가 아니다 ────────────────────────────

test("★내부·테스트를 기본 필터로 숨기지 않는다", () => {
  const unified = buildUnifiedViewSql(PROJECT);
  assert.ok(unified.includes("AS isDevInstall"));
  // dev 를 걸러내는 WHERE 가 있으면 안 된다.
  assert.ok(!/WHERE[^)]*buildChannel\s*(!=|<>)/i.test(unified));
  assert.ok(!/WHERE[^)]*isDevInstall/i.test(unified));

  const revenue = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.ok(revenue.includes("AS isInternal"));
  assert.ok(!/WHERE[^)]*account_class\s*(!=|<>)/i.test(revenue));
});

test("★account_class 규약을 재사용한다 — 새 판정을 만들지 않는다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.ok(sql.includes("account_class = 'internal'"));
  assert.ok(sql.includes("account_class = 'external'"));
  // 판정 불가(NULL)를 external 로 승격하지 않는다.
  assert.ok(sql.includes("IF(j.accountClass IS NULL, NULL, j.accountClass = 'internal')"));
});

// ── 10. DDL ─────────────────────────────────────────────────────────────────

test("DDL 은 뷰만 만든다 — DROP/ALTER/DELETE 를 내보내지 않는다", () => {
  for (const ddl of [
    buildUnifiedViewDdl(PROJECT),
    buildRevenueViewDdl(PROJECT, OPEN_GATE),
    buildRevenueViewDdl(PROJECT, CLOSED_GATE),
  ]) {
    assert.match(ddl, /^CREATE OR REPLACE VIEW /);
    for (const bad of ["DROP ", "ALTER ", "DELETE ", "TRUNCATE ", "INSERT ", "MERGE "]) {
      assert.ok(!ddl.toUpperCase().includes(bad), `${bad} 가 들어 있다`);
    }
  }
});

test("뷰가 각자 맞는 데이터셋에 만들어진다 — 결제는 링크표가 사는 곳이다", () => {
  assert.ok(
    buildUnifiedViewDdl(PROJECT).startsWith(
      `CREATE OR REPLACE VIEW \`${PROJECT}.${TELEMETRY_DATASET}.${VIEW_INSTALL_UNIFIED}\``
    )
  );
  assert.ok(
    buildRevenueViewDdl(PROJECT, OPEN_GATE).startsWith(
      `CREATE OR REPLACE VIEW \`${PROJECT}.${IDENTITY_DATASET}.${VIEW_INSTALL_UNIFIED_REVENUE}\``
    )
  );
});

test("★결제 뷰는 marblo_telemetry 에 만들어지지 않는다 (IAM 경계)", () => {
  const ddl = buildRevenueViewDdl(PROJECT, OPEN_GATE);
  assert.ok(
    !ddl.startsWith(`CREATE OR REPLACE VIEW \`${PROJECT}.${TELEMETRY_DATASET}.`)
  );
});

test("★한 사람의 결제가 여러 설치 행에 반복된다는 사실이 컬럼으로 드러난다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  // 설치 알갱이에서 피할 수 없는 성질이다 — 숨기는 대신 센다.
  assert.match(sql, /COUNT\(\*\) OVER \(PARTITION BY l\.personKey\)/);
  assert.ok(sql.includes("AS personInstallCount"));
  // 게이트가 닫혀도 컬럼 집합은 같아야 한다(스키마가 게이트로 바뀌면 안 된다).
  assert.ok(buildRevenueViewSql(PROJECT, CLOSED_GATE).includes("AS personInstallCount"));
});

test("★게이트 열림·닫힘의 컬럼 집합이 정확히 같다 — 스키마가 설정으로 바뀌면 안 된다", () => {
  // CTE 내부에서만 쓰이고 최종 SELECT 로 나가지 않는 이름들.
  const INTERNAL = new Set(["installKeyHmac", "revenueKnownAmount", "currencyCount"]);
  const cols = (sql: string): string[] =>
    [...new Set(aliases(sql))].filter((a) => !INTERNAL.has(a)).sort();
  assert.deepEqual(
    cols(buildRevenueViewSql(PROJECT, CLOSED_GATE)),
    cols(buildRevenueViewSql(PROJECT, OPEN_GATE))
  );
});

test("sqlString 은 따옴표를 이스케이프한다", () => {
  assert.equal(sqlString("a'b"), "'a\\'b'");
  assert.equal(sqlString("a\\b"), "'a\\\\b'");
});
