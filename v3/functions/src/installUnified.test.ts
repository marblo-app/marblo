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
  GA4_ECOMMERCE_REASONS,
  GA4_JOIN_REASONS,
  GA4_REVENUE_REASONS,
  IDENTITY_DATASET,
  REVENUE_DIVERGENCE_REASONS,
  REVENUE_REASONS,
  REVENUE_REASON_GATE_CLOSED,
  RETENTION_REASON_NO_DAILY_ROWS,
  REVENUE_LEDGER_KINDS,
  TELEMETRY_DATASET,
  VIEW_INSTALL_UNIFIED,
  VIEW_INSTALL_UNIFIED_REVENUE,
  VIEW_INSTALL_UNIFIED_REVENUE_PERSON,
  buildReasonCase,
  buildRevenuePersonViewDdl,
  buildRevenuePersonViewSql,
  buildRevenueViewDdl,
  buildRevenueViewSql,
  buildUnifiedViewDdl,
  buildUnifiedViewSql,
  findForbiddenTokens,
  resolveChannelMissingReason,
  resolveGa4EcommerceMissingReason,
  resolveGa4RevenueMissingReason,
  resolveRevenueDivergenceReason,
  resolveRevenueMissingReason,
  sqlString,
  type ChannelFacts,
  type Ga4EcommerceFacts,
  type RevenueDivergenceFacts,
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
      `${JSON.stringify(patch)} → ${want}`,
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
      sentinel,
    );
    // 대소문자·공백이 섞여도 같다.
    assert.equal(
      resolveChannelMissingReason({
        ...fullChannel(),
        campaign: `  ${sentinel.toUpperCase()}  `,
      }),
      "no_utm",
    );
  }
  // 빈 문자열도 캠페인이 아니다.
  assert.equal(
    resolveChannelMissingReason({ ...fullChannel(), campaign: "" }),
    "no_utm",
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
                `모르는 사유: ${reason}`,
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
  const closed = {
    ...fullRevenue(),
    gateOpen: false,
    hasInstallKeyHmac: false,
  };
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
      `${JSON.stringify(patch)} → ${want}`,
    );
  }
});

test("★공용 기기는 귀속을 고르지 않고 센다", () => {
  assert.equal(
    resolveRevenueMissingReason({ ...fullRevenue(), personLinkCount: 3 }),
    "shared_device",
  );
});

test("★결제 사유는 전부 '모른다' 다 — '결제 없음' 은 사유가 아니라 0 이다", () => {
  for (const rung of REVENUE_REASONS) {
    assert.equal(rung.kind, "unknown", rung.reason);
  }
  assert.ok(
    !REVENUE_REASONS.some((r) => r.reason === "no_purchase"),
    "결제 없음을 사유로 만들면 0 과 미적재가 다시 섞인다",
  );
});

// ── 3. SQL 생성 — 사다리와 CASE 가 갈리지 않는다 ────────────────────────────

test("CASE 는 사다리 배열 순서를 그대로 쓴다", () => {
  const sql = buildReasonCase(CHANNEL_REASONS);
  const order = CHANNEL_REASONS.map((r) => sql.indexOf(sqlString(r.reason)));
  for (const idx of order)
    assert.ok(idx > 0, "모든 사유가 CASE 에 있어야 한다");
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], "CASE 순서가 사다리 순서와 같아야 한다");
  }
  assert.match(sql, /ELSE NULL/);
});

test("생성된 뷰 SQL 에 모든 사유 문자열이 들어 있다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  for (const r of CHANNEL_REASONS)
    assert.ok(sql.includes(`'${r.reason}'`), r.reason);
  assert.ok(sql.includes(`'${ACTIVATION_REASON_NO_FIRST_RUN}'`));
  assert.ok(sql.includes(`'${RETENTION_REASON_NO_DAILY_ROWS}'`));

  const rev = buildRevenueViewSql(PROJECT, OPEN_GATE);
  for (const r of REVENUE_REASONS)
    assert.ok(rev.includes(`'${r.reason}'`), r.reason);
});

// ── 4. ★조인 키 공간 — 여기가 갈리면 뷰가 조용히 빈다 ───────────────────────

test("★채널 조인은 가명 = 가명이다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  assert.ok(
    sql.includes("ON a.gaKeyHmac = g.gaKey"),
    "gaKeyHmac = gaKey 로 조인해야 한다",
  );
});

test("★원시 gaClientId 로 조인하지 않는다 — 그 조인은 영원히 0행이다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  assert.ok(!/gaClientId\s*=\s*\w+\.gaKey/.test(sql));
  assert.ok(!/gaKey\s*=\s*\w+\.gaClientId/.test(sql));
  // ga_key(원시) 로 조인하는 프로필 컬럼도 쓰지 않는다.
  assert.ok(
    !/p\.ga_key/.test(sql),
    "analytics_install_profile.ga_key 는 원시다",
  );
});

test("★결제 조인은 gaKey 를 거치지 않는다 — 한 브라우저의 결제가 480개 설치로 복제된다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.ok(!/gaKeyHmac\s*=\s*\w+\.(user_key|install_key)/.test(sql));
  assert.ok(sql.includes("ON b.installKey = h.install_key"));
  assert.ok(sql.includes("ON h.installKeyHmac = l.installKeyHmac"));
  assert.ok(sql.includes("ON l.personKey = pu.user_key"));
});

test("★grant 와 paid 는 원장 CTE 부터 절대 합치지 않는다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.deepEqual(REVENUE_LEDGER_KINDS, ["paid", "renew"]);
  assert.match(sql, /paid AS \(/);
  assert.match(sql, /grant AS \(/);
  assert.match(sql, /AND kind IN \('paid', 'renew'\)/);
  assert.match(sql, /AND kind = 'grant'/);
  assert.match(sql, /LEFT JOIN paid pu ON l\.personKey = pu\.user_key/);
  assert.match(sql, /LEFT JOIN grant gr ON l\.personKey = gr\.user_key/);
  assert.match(sql, /gr\.grantCount AS grantCount/);
  assert.match(sql, /pu\.accountClass AS accountClass/);
  assert.ok(!/COUNTIF\(kind = 'grant'\)/.test(sql));
});

test("★grant 는 매출·accountClass·amount_unknown 계산에 들어가지 않는다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  const paidCte = sql.slice(sql.indexOf("paid AS ("), sql.indexOf("grant AS ("));
  const grantCte = sql.slice(sql.indexOf("grant AS ("), sql.indexOf("joined AS ("));
  assert.match(paidCte, /SUM\(IF\(pg_env = 'live' AND amount_known, amount, NULL\)\)/);
  assert.match(paidCte, /COUNTIF\(pg_env = 'live' AND NOT amount_known\)/);
  assert.match(paidCte, /account_class = 'external'/);
  assert.match(paidCte, /pg_env = 'live'/);
  assert.ok(!/kind = 'grant'/.test(paidCte));
  assert.ok(!/SUM\(IF\(amount_known/.test(grantCte));
  assert.ok(!/COUNTIF\(NOT amount_known\)/.test(grantCte));
  assert.ok(!/account_class =/.test(grantCte));
  assert.ok(!/currencyCount|revenueCurrency/.test(grantCte));
});

// ── 5. 행수 보존 ────────────────────────────────────────────────────────────

test("★붙는 쪽은 전부 사전 집계이거나 유일키로 접혀 있다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  // 원장·GA4 는 QUALIFY 로 1행씩 접는다.
  assert.match(sql, /QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY installId/);
  assert.match(
    sql,
    /QUALIFY ROW_NUMBER\(\) OVER \(\s*\n?\s*PARTITION BY gaKey/,
  );
  // 일별은 install_key 로 GROUP BY 한다.
  assert.match(sql, /GROUP BY d\.install_key/);
  // 정본은 프로필이고 **LEFT** JOIN 만 쓴다(INNER 면 설치가 사라진다).
  assert.match(
    sql,
    /FROM `marblo-2253d\.marblo_telemetry\.analytics_install_profile` p/,
  );
  const joinsAfterFrom = sql.slice(
    sql.indexOf(
      "FROM `marblo-2253d.marblo_telemetry.analytics_install_profile` p",
    ),
  );
  assert.ok(!/\bINNER JOIN\b/.test(joinsAfterFrom));
  // 원장 · GA4 유입 · GA4 이커머스 · 일별 — 네 벌 전부 LEFT 다.
  assert.equal((joinsAfterFrom.match(/LEFT JOIN/g) ?? []).length, 4);
  // ★이커머스도 gaKey 당 1행으로 접는다 — 안 접으면 설치 행이 부푼다.
  assert.match(
    sql,
    /FROM `marblo-2253d\.marblo_telemetry\.ga4_ecommerce_current`[\s\S]{0,200}QUALIFY ROW_NUMBER\(\) OVER \(\s*\n?\s*PARTITION BY gaKey/,
  );
});

test("★결제 뷰도 사전 집계 뒤에 LEFT JOIN 한다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  assert.match(sql, /GROUP BY install_key/);
  assert.match(sql, /GROUP BY user_key/);
  const tail = sql.slice(sql.indexOf("FROM ${BASE}".replace("${BASE}", "")));
  assert.ok(!/\bINNER JOIN\b/.test(tail));
  assert.equal((sql.match(/LEFT JOIN/g) ?? []).length, 4);
});

// ── 6. PII·자리표시자 금지 ──────────────────────────────────────────────────

test("★뷰 SQL 에 uid·이메일·솔트·'(unknown)' 이 없다", () => {
  assert.deepEqual(findForbiddenTokens(buildUnifiedViewDdl(PROJECT)), []);
  assert.deepEqual(
    findForbiddenTokens(buildRevenueViewDdl(PROJECT, OPEN_GATE)),
    [],
  );
  assert.deepEqual(
    findForbiddenTokens(buildRevenueViewDdl(PROJECT, CLOSED_GATE)),
    [],
  );
});

test("위생 검사가 실제로 잡는다 (검사기 자체의 회귀 방지)", () => {
  assert.deepEqual(findForbiddenTokens("SELECT uid FROM t"), ["uid"]);
  assert.deepEqual(findForbiddenTokens("SELECT '(unknown)' AS x"), [
    "(unknown)",
  ]);
  // 정상 이름을 오탐하지 않는다.
  assert.deepEqual(
    findForbiddenTokens(
      "SELECT user_key, install_key FROM analytics_user_daily",
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenTokens("SELECT installId -- 익명 설치 UUID"),
    [],
  );
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
    "testPaymentCount",
    "unknownPgEnvPaymentCount",
    // ★revenueTotal 이 아니다 — 매출 축이 둘이라 어느 쪽인지 이름이 말해야 한다.
    "revenueLedger",
    "revenueCurrency",
    "revenueAmountUnknownCount",
    "accountClass",
    "isInternal",
    "revenueMissingReason",
    "revenueDivergenceReason",
    "personAxisEffectiveFrom",
  ];
  for (const gate of [OPEN_GATE, CLOSED_GATE]) {
    const found = new Set(aliases(buildRevenueViewSql(PROJECT, gate)));
    for (const col of promised) {
      assert.ok(
        found.has(col),
        `누락(${gate.open ? "open" : "closed"}): ${col}`,
      );
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
  assert.ok(
    sql.includes(
      "IF(j.accountClass IS NULL, NULL, j.accountClass = 'internal')",
    ),
  );
});

test("★원장 매출은 pg_env='live' 만 센다 — test/null 은 별도 건수로 드러낸다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  const paidCte = sql.slice(sql.indexOf("paid AS ("), sql.indexOf("grant AS ("));
  assert.match(paidCte, /COUNTIF\(pg_env = 'live'\) AS purchaseCount/);
  assert.match(paidCte, /COUNTIF\(kind = 'paid' AND pg_env = 'live'\) AS paidCount/);
  assert.match(paidCte, /COUNTIF\(pg_env = 'test'\) AS testPaymentCount/);
  assert.match(paidCte, /COUNTIF\(pg_env IS NULL\) AS unknownPgEnvPaymentCount/);
  assert.match(
    paidCte,
    /SUM\(IF\(pg_env = 'live' AND amount_known, amount, NULL\)\) AS revenueKnownAmount/,
  );
  assert.ok(sql.includes("AS testPaymentCount"));
  assert.ok(sql.includes("AS unknownPgEnvPaymentCount"));
});

// ── 10. DDL ─────────────────────────────────────────────────────────────────

test("DDL 은 뷰만 만든다 — DROP/ALTER/DELETE 를 내보내지 않는다", () => {
  for (const ddl of [
    buildUnifiedViewDdl(PROJECT),
    buildRevenueViewDdl(PROJECT, OPEN_GATE),
    buildRevenuePersonViewDdl(PROJECT),
    buildRevenueViewDdl(PROJECT, CLOSED_GATE),
  ]) {
    assert.match(ddl, /^CREATE OR REPLACE VIEW /);
    for (const bad of [
      "DROP ",
      "ALTER ",
      "DELETE ",
      "TRUNCATE ",
      "INSERT ",
      "MERGE ",
    ]) {
      assert.ok(!ddl.toUpperCase().includes(bad), `${bad} 가 들어 있다`);
    }
  }
});

test("뷰가 각자 맞는 데이터셋에 만들어진다 — 결제는 링크표가 사는 곳이다", () => {
  assert.ok(
    buildUnifiedViewDdl(PROJECT).startsWith(
      `CREATE OR REPLACE VIEW \`${PROJECT}.${TELEMETRY_DATASET}.${VIEW_INSTALL_UNIFIED}\``,
    ),
  );
  assert.ok(
    buildRevenueViewDdl(PROJECT, OPEN_GATE).startsWith(
      `CREATE OR REPLACE VIEW \`${PROJECT}.${IDENTITY_DATASET}.${VIEW_INSTALL_UNIFIED_REVENUE}\``,
    ),
  );
  assert.ok(
    buildRevenuePersonViewDdl(PROJECT).startsWith(
      `CREATE OR REPLACE VIEW \`${PROJECT}.${IDENTITY_DATASET}.${VIEW_INSTALL_UNIFIED_REVENUE_PERSON}\``,
    ),
  );
});

test("★결제 뷰는 marblo_telemetry 에 만들어지지 않는다 (IAM 경계)", () => {
  const ddl = buildRevenueViewDdl(PROJECT, OPEN_GATE);
  assert.ok(
    !ddl.startsWith(
      `CREATE OR REPLACE VIEW \`${PROJECT}.${TELEMETRY_DATASET}.`,
    ),
  );
});

test("★한 사람의 결제가 여러 설치 행에 반복된다는 사실이 컬럼으로 드러난다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  // 설치 알갱이에서 피할 수 없는 성질이다 — 숨기는 대신 센다.
  assert.match(sql, /COUNT\(\*\) OVER \(PARTITION BY l\.personKey\)/);
  assert.ok(sql.includes("AS personInstallCount"));
  // 게이트가 닫혀도 컬럼 집합은 같아야 한다(스키마가 게이트로 바뀌면 안 된다).
  assert.ok(
    buildRevenueViewSql(PROJECT, CLOSED_GATE).includes("AS personInstallCount"),
  );
});

test("★사람 단위 수익 뷰가 SUM(revenueLedger) 금지의 안전한 경로다", () => {
  const sql = buildRevenuePersonViewSql(PROJECT);
  assert.match(sql, /FROM `marblo-2253d\.marblo_identity\.v_install_unified_revenue`/);
  assert.match(sql, /WHERE personKey IS NOT NULL/);
  assert.match(sql, /GROUP BY personKey/);
  assert.match(sql, /ANY_VALUE\(revenueLedger\) AS revenueLedger/);
  assert.match(sql, /ANY_VALUE\(paidCount\) AS paidCount/);
  assert.match(sql, /ANY_VALUE\(grantCount\) AS grantCount/);
  assert.match(sql, /ANY_VALUE\(testPaymentCount\) AS testPaymentCount/);
  assert.match(
    sql,
    /ANY_VALUE\(unknownPgEnvPaymentCount\) AS unknownPgEnvPaymentCount/,
  );
  assert.match(sql, /COUNT\(\*\) AS installRowsRepresented/);
  const selectBody = sql.slice(sql.indexOf("SELECT"), sql.indexOf("FROM "));
  assert.ok(!/SUM\s*\(\s*revenueLedger\s*\)/i.test(selectBody));
});

test("사람 단위 수익 뷰의 약속 컬럼", () => {
  const promised = [
    "personKey",
    "installRowsRepresented",
    "personInstallCount",
    "firstPurchaseAt",
    "purchaseCount",
    "paidCount",
    "grantCount",
    "testPaymentCount",
    "unknownPgEnvPaymentCount",
    "revenueLedger",
    "revenueCurrency",
    "revenueAmountUnknownCount",
    "accountClass",
    "isInternal",
    "revenueMissingReason",
    "revenueDivergenceReason",
    "personAxisEffectiveFrom",
  ];
  const found = new Set(aliases(buildRevenuePersonViewSql(PROJECT)));
  for (const col of promised) assert.ok(found.has(col), `누락: ${col}`);
});

test("★게이트 열림·닫힘의 컬럼 집합이 정확히 같다 — 스키마가 설정으로 바뀌면 안 된다", () => {
  // CTE 내부에서만 쓰이고 최종 SELECT 로 나가지 않는 이름들.
  const INTERNAL = new Set([
    "installKeyHmac",
    "revenueKnownAmount",
    "currencyCount",
    // resolved CTE 가 대조 직전에 두 축의 금액을 확정하는 자리. 최종 SELECT 의
    // EXCEPT 로 빠진다(원장은 revenueLedger, GA4 는 ga4RevenueTotal 로 나간다).
    "revenueLedgerAmount",
    "ga4RevenueAmount",
  ]);
  const cols = (sql: string): string[] =>
    [...new Set(aliases(sql))].filter((a) => !INTERNAL.has(a)).sort();
  assert.deepEqual(
    cols(buildRevenueViewSql(PROJECT, CLOSED_GATE)),
    cols(buildRevenueViewSql(PROJECT, OPEN_GATE)),
  );
});

test("sqlString 은 따옴표를 이스케이프한다", () => {
  assert.equal(sqlString("a'b"), "'a\\'b'");
  assert.equal(sqlString("a\\b"), "'a\\\\b'");
});

// ── 9. ★GA4 이커머스 사유 사다리 (ticket VV733VRpsfGvijYuPWCl) ──────────────

/** 이커머스가 완전히 채워진 설치. 각 테스트는 여기서 한 칸씩만 무너뜨린다. */
function fullEcommerce(): Ga4EcommerceFacts {
  return {
    hasLedgerRow: true,
    hasGaClientId: true,
    hasGaKeyHmac: true,
    hasEcommerceRow: true,
    currencyCount: 1,
  };
}

test("이커머스가 다 갖춰지면 사유가 없다 — 그때 퍼널 카운트는 0 일 수 있다", () => {
  assert.equal(resolveGa4EcommerceMissingReason(fullEcommerce()), null);
  assert.equal(resolveGa4RevenueMissingReason(fullEcommerce()), null);
});

test("★결제가 한 건도 없어도 사유는 NULL 이다 — 0 은 '안 샀다' 이지 '모른다' 가 아니다", () => {
  // currencyCount = 0 은 "그 방문자는 결제한 적이 없다" 는 사실이다.
  const noPurchase = { ...fullEcommerce(), currencyCount: 0 };
  assert.equal(resolveGa4EcommerceMissingReason(noPurchase), null);
  assert.equal(resolveGa4RevenueMissingReason(noPurchase), null);
});

test("이커머스 사다리 각 단계", () => {
  assert.equal(
    resolveGa4EcommerceMissingReason({
      ...fullEcommerce(),
      hasLedgerRow: false,
    }),
    "no_ledger_row",
  );
  assert.equal(
    resolveGa4EcommerceMissingReason({
      ...fullEcommerce(),
      hasGaClientId: false,
    }),
    "no_ga_client_id",
  );
  assert.equal(
    resolveGa4EcommerceMissingReason({
      ...fullEcommerce(),
      hasGaKeyHmac: false,
    }),
    "key_mismatch",
  );
  assert.equal(
    resolveGa4EcommerceMissingReason({
      ...fullEcommerce(),
      hasEcommerceRow: false,
    }),
    "no_ga4_ecommerce_row",
  );
});

test("★채널과 이커머스는 다리 세 칸을 같은 배열에서 만든다 — 손으로 두 벌 적지 않는다", () => {
  const shared = GA4_JOIN_REASONS.map((r) => r.reason);
  assert.deepEqual(
    CHANNEL_REASONS.slice(0, shared.length).map((r) => r.reason),
    shared,
  );
  assert.deepEqual(
    GA4_ECOMMERCE_REASONS.slice(0, shared.length).map((r) => r.reason),
    shared,
  );
  // SQL 문자열까지 같은 객체에서 나온다(같은 배열 원소를 그대로 편 것이다).
  for (let i = 0; i < shared.length; i++) {
    assert.equal(CHANNEL_REASONS[i], GA4_ECOMMERCE_REASONS[i]);
  }
});

test("★금액 사다리는 퍼널 사다리보다 정확히 한 칸 길다 — 통화가 섞이면 금액만 못 더한다", () => {
  assert.deepEqual(GA4_REVENUE_REASONS.slice(0, GA4_ECOMMERCE_REASONS.length), [
    ...GA4_ECOMMERCE_REASONS,
  ]);
  assert.equal(GA4_REVENUE_REASONS.length, GA4_ECOMMERCE_REASONS.length + 1);

  const mixed = { ...fullEcommerce(), currencyCount: 2 };
  // 퍼널 카운트는 멀쩡하다 — 통화 때문에 멀쩡한 사실을 버리지 않는다.
  assert.equal(resolveGa4EcommerceMissingReason(mixed), null);
  // 금액만 못 더한다.
  assert.equal(resolveGa4RevenueMissingReason(mixed), "ga4_mixed_currency");
});

test("★이커머스 사유는 전부 '모른다' 다 — '이커머스 단계를 안 밟았다' 는 0 이지 사유가 아니다", () => {
  for (const rung of GA4_REVENUE_REASONS) {
    assert.equal(rung.kind, "unknown", rung.reason);
  }
});

test("★장바구니 단계를 만들지 않는다 — 마블로는 장바구니 없는 구독이다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  assert.ok(!/addToCart|add_to_cart|viewCart|view_cart/i.test(sql));
  for (const rung of GA4_REVENUE_REASONS) {
    assert.ok(!/cart/i.test(rung.reason), rung.reason);
  }
});

test("★이커머스도 가명 = 가명이고 채널과 **같은** 다리를 쓴다", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  assert.match(sql, /LEFT JOIN ecom e ON a\.gaKeyHmac = e\.gaKey/);
  // 두 GA4 축이 다른 키로 붙으면 같은 방문자가 두 축에서 갈린다.
  assert.match(sql, /LEFT JOIN ga4 g ON a\.gaKeyHmac = g\.gaKey/);
  assert.ok(!/e\.gaClientId|ON a\.gaClientId/.test(sql));
});

test("★GA4 이커머스는 익명 gaKey 축이라 텔레메트리 뷰에 산다 (IAM 판단의 회귀 방지)", () => {
  const sql = buildUnifiedViewSql(PROJECT);
  // 이커머스 원천은 marblo_telemetry 다 — 링크표(marblo_identity)를 읽지 않는다.
  assert.match(sql, /`marblo-2253d\.marblo_telemetry\.ga4_ecommerce_current`/);
  // ★#1196 이 결제를 identity 로 가른 이유는 "뷰가 링크표를 읽는다" 였다. GA4
  //   이커머스는 그 표를 안 읽으므로 같은 근거가 성립하지 않는다. 표 참조로 잠근다
  //   (데이터셋 이름이 주석에 나오는 건 상관없다 — 읽는 표가 없으면 된다).
  const refs = sql.match(/`marblo-2253d\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+`/g) ?? [];
  for (const ref of refs) {
    assert.ok(
      !ref.includes(`.${IDENTITY_DATASET}.`),
      `텔레메트리 뷰가 읽는다: ${ref}`,
    );
  }
});

test("★원시 transaction_id 는 US 로 넘어가지 않는다 — 주문 식별자는 다른 공간이다", () => {
  for (const sql of [
    buildUnifiedViewSql(PROJECT),
    buildRevenueViewSql(PROJECT, OPEN_GATE),
  ]) {
    assert.ok(!/transaction_?[iI]d/.test(sql));
  }
});

test("이커머스 컬럼이 실제로 나온다", () => {
  const promised = [
    "ga4ViewItemListEvents",
    "ga4ViewItemEvents",
    "ga4BeginCheckoutEvents",
    "ga4AddPaymentInfoEvents",
    "ga4PurchaseEvents",
    "ga4FirstEcommerceDate",
    "ga4LastEcommerceDate",
    "ga4FirstPurchaseDate",
    "hasGa4EcommerceRow",
    "ga4EcommerceMissingReason",
    "ga4RevenueTotal",
    "ga4RevenueCurrency",
    "ga4RevenueUsdApprox",
    "ga4RevenueCurrencyCount",
    "ga4RevenueMissingReason",
  ];
  const found = new Set(aliases(buildUnifiedViewSql(PROJECT)));
  for (const col of promised) assert.ok(found.has(col), `누락: ${col}`);
});

// ── 10. ★원장 ↔ GA4 대조 ────────────────────────────────────────────────────

function agreed(): RevenueDivergenceFacts {
  return {
    ledgerReason: null,
    ga4Reason: null,
    ledgerAmount: 19000,
    ga4Amount: 19000,
    ledgerCurrency: "KRW",
    ga4Currency: "KRW",
  };
}

test("두 축이 같으면 사유가 없다", () => {
  assert.equal(resolveRevenueDivergenceReason(agreed()), null);
});

test("★둘 다 0원이어도 '같다' 다 — 0 은 불일치가 아니다", () => {
  assert.equal(
    resolveRevenueDivergenceReason({
      ...agreed(),
      ledgerAmount: 0,
      ga4Amount: 0,
      ledgerCurrency: null,
      ga4Currency: null,
    }),
    null,
  );
});

test("★한쪽을 모르면 대조하지 않는다 — 모르는 쪽을 0 으로 읽으면 없는 불일치가 생긴다", () => {
  assert.equal(
    resolveRevenueDivergenceReason({
      ...agreed(),
      ledgerReason: "no_install_key_hmac",
      ledgerAmount: null,
    }),
    "ledger_unknown",
  );
  assert.equal(
    resolveRevenueDivergenceReason({
      ...agreed(),
      ga4Reason: "no_ga4_ecommerce_row",
      ga4Amount: null,
    }),
    "ga4_unknown",
  );
});

test("★원장을 모르는 것이 GA4 를 모르는 것보다 먼저다 — 정본이 먼저 답해야 한다", () => {
  assert.equal(
    resolveRevenueDivergenceReason({
      ...agreed(),
      ledgerReason: "no_person_link",
      ga4Reason: "key_mismatch",
      ledgerAmount: null,
      ga4Amount: null,
    }),
    "ledger_unknown",
  );
});

test("★통화가 다르면 환산하지 않는다 — 여기서 환율을 고르면 어디에도 안 적힌다", () => {
  assert.equal(
    resolveRevenueDivergenceReason({ ...agreed(), ga4Currency: "USD" }),
    "currency_mismatch",
  );
});

test("GA4 가 샌 경우와 원장이 못 잡은 경우를 가른다", () => {
  assert.equal(
    resolveRevenueDivergenceReason({
      ...agreed(),
      ga4Amount: 0,
      ga4Currency: null,
    }),
    "ga4_missed",
  );
  assert.equal(
    resolveRevenueDivergenceReason({
      ...agreed(),
      ledgerAmount: 0,
      ledgerCurrency: null,
    }),
    "ledger_missed",
  );
});

test("금액이 다르면 amount_differs 다", () => {
  assert.equal(
    resolveRevenueDivergenceReason({ ...agreed(), ga4Amount: 15000 }),
    "amount_differs",
  );
});

test("★대조 사유는 '모른다' 와 '다르다' 를 가른다 — 뭉치면 대조가 무의미해진다", () => {
  const kinds = new Map(
    REVENUE_DIVERGENCE_REASONS.map((r) => [r.reason, r.kind]),
  );
  assert.equal(kinds.get("ledger_unknown"), "unknown");
  assert.equal(kinds.get("ga4_unknown"), "unknown");
  assert.equal(kinds.get("currency_mismatch"), "unknown");
  assert.equal(kinds.get("ga4_missed"), "divergent");
  assert.equal(kinds.get("ledger_missed"), "divergent");
  assert.equal(kinds.get("amount_differs"), "divergent");
});

test("모든 입력 조합에서 대조 사유는 정확히 0개 또는 1개다 (전수)", () => {
  const reasons = [null, "x"];
  const amounts = [null, 0, 19000];
  const currencies = [null, "KRW", "USD"];
  for (const ledgerReason of reasons) {
    for (const ga4Reason of reasons) {
      for (const ledgerAmount of amounts) {
        for (const ga4Amount of amounts) {
          for (const ledgerCurrency of currencies) {
            for (const ga4Currency of currencies) {
              const f: RevenueDivergenceFacts = {
                ledgerReason,
                ga4Reason,
                ledgerAmount,
                ga4Amount,
                ledgerCurrency,
                ga4Currency,
              };
              const hits = REVENUE_DIVERGENCE_REASONS.filter((r) => r.test(f));
              const resolved = resolveRevenueDivergenceReason(f);
              if (hits.length === 0) assert.equal(resolved, null);
              else assert.equal(resolved, hits[0].reason);
            }
          }
        }
      }
    }
  }
});

test("★게이트가 닫혀도 대조 컬럼이 있고 값은 ledger_unknown 이다", () => {
  const sql = buildRevenueViewSql(PROJECT, CLOSED_GATE);
  assert.ok(sql.includes("AS revenueDivergenceReason"));
  assert.ok(sql.includes(sqlString("ledger_unknown")));
});

test("★대조는 두 축의 금액을 확정한 **뒤에** 한다 — 미상과 0 을 값이 다르다로 읽지 않는다", () => {
  const sql = buildRevenueViewSql(PROJECT, OPEN_GATE);
  // resolved CTE 가 joined 뒤에 오고, 최종 SELECT 는 resolved 를 읽는다.
  assert.ok(sql.indexOf("resolved AS (") > sql.indexOf("joined AS ("));
  assert.match(sql, /FROM resolved j\s*$/);
});

test("생성된 뷰 SQL 에 새 사유 문자열이 전부 들어 있다", () => {
  const unified = buildUnifiedViewSql(PROJECT);
  for (const r of GA4_REVENUE_REASONS) {
    assert.ok(unified.includes(sqlString(r.reason)), r.reason);
  }
  const revenue = buildRevenueViewSql(PROJECT, OPEN_GATE);
  for (const r of REVENUE_DIVERGENCE_REASONS) {
    assert.ok(revenue.includes(sqlString(r.reason)), r.reason);
  }
});
