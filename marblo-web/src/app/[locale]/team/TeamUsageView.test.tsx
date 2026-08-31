/**
 * ★화면 규약을 **렌더된 HTML 바이트로** 확인한다(AnalyticsPanel.test.tsx 규약).
 *
 * 이 화면이 실패하는 방식은 셋이다:
 *   1. 미수집 칸에 0 이 그려진다 → 오너가 "오케는 공짜" 로 읽는다.
 *   2. 금액이 '청구액' 이라고 불린다 → 답할 수 없는 걸 답하는 척한다.
 *   3. 데이터가 없을 때 화면이 비거나 깨진다 → v1 의 기본 상태가 실패 상태가 된다.
 * 아래 테스트는 정확히 그 셋을 본다. ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildTeamCopy } from "./teamCopy";
import { TeamUsageView, UsageCellView, UsageEmpty } from "./TeamUsageView";
import {
  normalizeTeamUsage,
  type TeamUsageEnvelope,
} from "./teamUsageContract";

const LOCALES = [
  { locale: "ko", copy: buildTeamCopy(ko.team) },
  { locale: "en", copy: buildTeamCopy(en.team) },
  { locale: "ja", copy: buildTeamCopy(ja.team) },
];

const NOW = Date.parse("2026-08-21T09:05:00.000Z");

/** 오케 축이 미수집인, 지금 실제 상태의 봉투. */
function envNotCollected(
  overrides: Record<string, unknown> = {}
): TeamUsageEnvelope {
  return normalizeTeamUsage({
    rangeDays: 30,
    generatedAt: "2026-08-21T09:00:00.000Z",
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 900 },
    teamUsage: {
      state: "complete",
      disabledReason: null,
      effectiveFrom: "2026-08-01",
      basis: "account_ledger",
      scope: "team",
      projectsInScope: 1,
    },
    orchestratorAxis: {
      state: "not_collected",
      reason: "오케 세션은 비용 트래커에 붙는 경로가 아직 없다.",
      reasonCode: "orchestrator_not_collected",
      collectingSince: null,
      legacySegment: { from: "2026-05-05", to: "2026-06-22" },
    },
    totals: {
      costUsd: 67782,
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 10,
      cacheWriteTokens: 20,
    },
    byActorKind: [{ actorKind: "worker", costUsd: 67782, tokens: 1_200_000 }],
    byMember: [
      {
        memberKey: "tm_aaaa1111",
        displayName: "김동원",
        costUsd: 40000,
        tokens: 800_000,
        share: 0.59,
      },
      {
        memberKey: "tm_bbbb2222",
        displayName: null,
        costUsd: 0,
        tokens: 0,
        share: 0,
      },
    ],
    byProject: [
      {
        projectId: "p1",
        projectName: "Marblo",
        costUsd: 67782,
        tokens: 1_200_000,
      },
    ],
    byModel: [{ model: "claude-opus-5", costUsd: 67782, tokens: 1_200_000 }],
    byDay: [{ day: "2026-08-21", costUsd: 100, tokens: 1000, partial: true }],
    coverage: {
      rowsZeroPct: 0.55,
      rowsWithoutTaskPct: 0.83,
      unattributedRows: 139972,
      membersWithNoRows: 1,
      telemetryOptOutNote: null,
    },
    ...overrides,
  });
}

/** 팀이 아직 없는, **가장 흔한** 봉투. */
function envEmpty(): TeamUsageEnvelope {
  return normalizeTeamUsage({
    rangeDays: 30,
    generatedAt: "2026-08-21T09:00:00.000Z",
    teamUsage: {
      state: "empty",
      disabledReason: null,
      effectiveFrom: "2026-08-01",
      basis: "account_ledger",
      scope: "team",
      projectsInScope: 1,
    },
    orchestratorAxis: {
      state: "not_collected",
      reason: "수집 경로 없음",
      reasonCode: "orchestrator_not_collected",
      collectingSince: null,
      legacySegment: null,
    },
    byActorKind: [],
    byMember: [],
    byProject: [],
    byModel: [],
    byDay: [],
  });
}

/**
 * 텍스트만 남긴다 — 클래스명·속성 안의 숫자가 검사에 섞이지 않게.
 *
 * ★문구 비교는 반드시 이걸로 한다(아래 `render`).
 *
 * ★엔티티도 되돌린다. React 는 작은따옴표를 `&#x27;` 로 이스케이프하는데, 그대로
 *   두면 문구 원문(`copy.text[...]`)과 렌더 결과가 문자열로 안 맞아 "이 문장 안에서만
 *   허용" 류의 검사가 조용히 통과해 버린다.
 */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** raw HTML(태그 모양 검사용)과 텍스트(문구 검사용)를 같이 돌려준다. */
function render(node: React.ReactElement): { html: string; text: string } {
  const html = renderToStaticMarkup(node);
  return { html, text: visibleText(html) };
}

// ── ★1. 미수집 칸에 0 이 없다 ───────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 미수집 칸은 숫자 0 을 그리지 않고 사유를 그린다`, () => {
    const { html, text } = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{
          kind: "notCollected",
          reasonCode: "orchestrator_not_collected",
          reason: "server prose",
          legacySegment: {
            from: "2026-05-05",
            to: "2026-06-22",
            noteCode: null,
            note: null,
          },
        }}
        title={copy.text["orchestrator.orchestrator"]}
        basis="account_ledger"
      />
    );
    assert.ok(text.includes(copy.text["cell.notCollectedBadge"]));
    // ★가짜 0 금지 — 금액도 토큰수도 그리지 않는다.
    assert.doesNotMatch(text, /\$\s*0/);
    assert.doesNotMatch(text, /(^|\s)0($|\s)/);
    // 사유는 로케일 사전에서 온다(코드를 알기 때문에).
    assert.ok(text.includes(copy.reasons["orchestrator_not_collected"]));
    // ★서버 산문이 아니라 로케일 문장이 그려져야 한다.
    assert.ok(!html.includes("server prose"));
    // 잔재 구간은 사실로 밝히되 시계열로 그리지 않는다.
    assert.ok(html.includes("2026-05-05"));
    assert.ok(html.includes("2026-06-22"));
  });

  test(`[${locale}] 적재 전 칸도 0 을 그리지 않는다`, () => {
    const { html, text } = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{ kind: "pending", since: "2026-09-01" }}
        title="orch"
        basis="account_ledger"
      />
    );
    assert.ok(text.includes(copy.text["cell.pendingBadge"]));
    assert.doesNotMatch(visibleText(html), /\$\s*0/);
    // ★'미수집' 과 **다른 말**이어야 한다. 같으면 셋을 가른 의미가 없다.
    assert.notEqual(
      copy.text["cell.pendingBadge"],
      copy.text["cell.notCollectedBadge"]
    );
  });

  test(`[${locale}] 실측 0 은 0 을 그리되 '실측' 이라고 밝힌다`, () => {
    const { html, text } = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{ kind: "measured", costUsd: 0, tokens: 0 }}
        title="worker"
        basis="account_ledger"
      />
    );
    assert.match(visibleText(html), /0/);
    assert.ok(text.includes(copy.text["cell.zeroBadge"]));
    assert.ok(text.includes(copy.text["cell.zeroNote"]));
    // 라벨 없는 숫자 금지 — 금액 라벨과 기준 배지가 같이 있어야 한다.
    assert.ok(text.includes(copy.text["money.label"]));
    // ★기준 배지는 서버 값이 아니라 **사람이 읽는 라벨**을 그린다.
    assert.ok(text.includes(copy.basisValues["account_ledger"]));
    assert.ok(!text.includes("account_ledger"));
  });

  test(`[${locale}] 다섯 상태의 배지 문구가 서로 다르다`, () => {
    const badges = new Set([
      copy.text["cell.unwiredBadge"],
      copy.text["cell.notCollectedBadge"],
      copy.text["cell.pendingBadge"],
      copy.text["cell.zeroBadge"],
      copy.text["disabled.badge"],
    ]);
    assert.equal(badges.size, 5);
  });
}

// ── ★2. 금액은 '청구액' 이 아니다 ───────────────────────────────────────────

const BILLING_WORDS: Record<string, RegExp> = {
  ko: /청구/g,
  en: /\b(billed|invoiced|amount due|charged)\b/gi,
  ja: /請求/g,
};

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 금액 라벨에 '청구' 계열 단어가 없다`, () => {
    assert.doesNotMatch(copy.text["money.label"], BILLING_WORDS[locale]);
  });

  test(`[${locale}] '청구' 라는 말은 부인문 안에서만 등장한다`, () => {
    const { text } = render(
      <TeamUsageView
        env={envNotCollected()}
        copy={copy}
        locale={locale}
        now={NOW}
      />
    );
    // money.note 를 뺀 나머지 본문에는 한 번도 나오면 안 된다.
    const rest = text.split(copy.text["money.note"]).join(" ");
    assert.deepEqual(rest.match(BILLING_WORDS[locale]) ?? [], []);
  });

  test(`[${locale}] 금액 옆에는 항상 '사용량 추정 비용' 라벨이 붙는다`, () => {
    const { text } = render(
      <TeamUsageView
        env={envNotCollected()}
        copy={copy}
        locale={locale}
        now={NOW}
      />
    );
    const money = copy.text["money.label"];
    const labelCount = text.split(money).length - 1;
    assert.ok(
      labelCount >= 3,
      `금액 라벨이 ${labelCount}회 — 총계·표 머리마다 붙어야 한다`
    );
  });
}

// ── ★3. 빈 상태가 기본값이다 ────────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 팀이 없어도 화면이 깨지지 않고 빈 상태를 그린다`, () => {
    const { html, text } = render(
      <TeamUsageView env={envEmpty()} copy={copy} locale={locale} now={NOW} />
    );
    assert.ok(text.includes(copy.text["empty.title"]));
    assert.ok(text.includes(copy.text["empty.willShowTitle"]));
    // 빈 상태에 빈 표도, 0 원도 없다.
    assert.doesNotMatch(visibleText(html), /\$\s*0/);
    assert.doesNotMatch(html, /<tbody>\s*<\/tbody>/);
    // ★그래도 오케 축은 그린다 — 비었을 때 사라지면 그게 곧 "오케는 공짜" 다.
    assert.ok(text.includes(copy.text["cell.notCollectedBadge"]));
    // 빈 상태에도 팀이 들어오면 무엇이 보이는지 적혀 있다.
    for (const line of copy.willShow) assert.ok(html.includes(line));
    // undefined/NaN 이 새지 않는다.
    assert.doesNotMatch(html, /undefined|NaN|\[object/);
  });

  test(`[${locale}] 봉투가 통째로 비어도 던지지 않는다`, () => {
    const { html, text } = render(
      <TeamUsageView
        env={normalizeTeamUsage(undefined)}
        copy={copy}
        locale={locale}
        now={NOW}
      />
    );
    // 게이트가 없으면 '아직 열지 않음' 으로 접히고 숫자가 없다.
    assert.ok(text.includes(copy.text["disabled.badge"]));
    assert.doesNotMatch(visibleText(html), /\$/);
    assert.doesNotMatch(html, /undefined|NaN|\[object/);
  });

  test(`[${locale}] UsageEmpty 단독 렌더도 안전하다`, () => {
    const { html } = render(<UsageEmpty copy={copy} />);
    assert.ok(html.length > 0);
    assert.doesNotMatch(html, /undefined|NaN|\[object/);
  });
}

// ── ★철회된 수치가 화면에 없다 ─────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 오케 문구에 비중 주장도 시점도 없다`, () => {
    // ★6월 오케 행은 콜드부트 reconnect 버그의 중복청구였다(실지출 아님).
    //   비중을 말하면 그 자체가 거짓이고, "언제부터 끊겼다" 도 틀렸다 —
    //   오케는 **한 번도** 비용 트래커에 붙은 적이 없다.
    const stake = copy.text["orchestrator.stake"];
    assert.doesNotMatch(stake, /\d+\s*%/, "비중 주장 금지");
    assert.doesNotMatch(stake, /\d{4}-\d{2}-\d{2}/, "시점 금지");
    assert.doesNotMatch(copy.reasons["orchestrator_not_collected"], /\d+\s*%/);
    assert.doesNotMatch(
      copy.reasons["orchestrator_not_collected"],
      /\d{4}-\d{2}-\d{2}/
    );
  });

  test(`[${locale}] 렌더된 화면 어디에도 그 비중 주장이 없다`, () => {
    const { text } = render(
      <TeamUsageView
        env={envNotCollected()}
        copy={copy}
        locale={locale}
        now={NOW}
      />
    );
    assert.ok(!text.includes("29%"));
    // ★구간 날짜는 **서버가 준 데이터**라 그린다. 다만 그 행들을 사용량으로
    //   읽으면 안 된다는 것을 문장이 말해야 한다 — 화면이 해석을 지어내지 않는다.
    assert.ok(
      text.includes(copy.text["cell.legacySegment"].split("{")[0].trim())
    );
  });

  test(`[${locale}] 구간 문장은 서버 문장이 있으면 그걸 쓴다`, () => {
    const env = envNotCollected({
      orchestratorAxis: {
        state: "not_collected",
        reason: null,
        reasonCode: "orchestrator_not_collected",
        collectingSince: null,
        legacySegment: {
          from: "2026-05-05",
          to: "2026-06-22",
          noteCode: null,
          note: "그 구간 기록은 중복 청구로 확인됐습니다.",
        },
      },
    });
    const { text } = render(
      <TeamUsageView env={env} copy={copy} locale={locale} now={NOW} />
    );
    assert.ok(text.includes("그 구간 기록은 중복 청구로 확인됐습니다."));
  });
}

// ── ★'적재 전' 은 '빈 상태' 와 다른 문구다 ─────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] not_provisioned 을 empty 와 다르게 그린다`, () => {
    const env = normalizeTeamUsage({
      rangeDays: 30,
      generatedAt: "2026-08-21T09:00:00.000Z",
      teamUsage: {
        state: "not_provisioned",
        disabledReason: null,
        effectiveFrom: null,
        basis: "account_ledger",
        scope: "team",
        projectsInScope: 1,
      },
      orchestratorAxis: {
        state: "not_collected",
        reason: null,
        reasonCode: "orchestrator_not_collected",
        collectingSince: null,
        legacySegment: null,
      },
    });
    const { text } = render(
      <TeamUsageView env={env} copy={copy} locale={locale} now={NOW} />
    );
    assert.ok(text.includes(copy.text["notProvisioned.title"]));
    // ★빈 상태 문구가 뜨면 오너가 "우리 팀이 안 썼구나" 로 읽는다.
    assert.ok(!text.includes(copy.text["empty.title"]));
    // 숫자를 한 개도 안 그린다.
    assert.doesNotMatch(text, /\$\s*\d/);
    // 셋이 서로 다른 말이어야 한다.
    const badges = new Set([
      copy.text["notProvisioned.badge"],
      copy.text["cell.notCollectedBadge"],
      copy.text["cell.zeroBadge"],
    ]);
    assert.equal(badges.size, 3);
  });

  test(`[${locale}] 기록 없는 멤버에 0 원을 그리지 않는다`, () => {
    const env = envNotCollected({
      byMember: [
        {
          memberKey: "tm_cccc3333",
          displayName: "옵트아웃",
          costUsd: 0,
          tokens: 0,
          share: 0,
          hasRows: false,
        },
      ],
    });
    const { text } = render(
      <TeamUsageView env={env} copy={copy} locale={locale} now={NOW} />
    );
    assert.ok(text.includes(copy.text["members.noRows"]));
    // ★0 으로 그리면 텔레메트리를 끈 사람이 "가장 일 안 한 사람" 이 된다.
    assert.doesNotMatch(text, /\$0\.00/);
    assert.ok(text.includes(copy.text["members.noRowsNote"]));
  });
}

// ── 게이트 닫힘 — 숫자를 아예 안 그린다 ─────────────────────────────────────

test("게이트가 닫히면 총계도 표도 그리지 않는다", () => {
  const copy = buildTeamCopy(ko.team);
  const env = normalizeTeamUsage({
    rangeDays: 30,
    generatedAt: "2026-08-21T09:00:00.000Z",
    teamUsage: {
      state: "disabled",
      disabledReason: "고지 개정 전이다",
      disabledReasonCode: "gate_unset",
      effectiveFrom: null,
      basis: "account_ledger",
      scope: "team",
      projectsInScope: 0,
    },
    totals: {
      costUsd: 99807,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    byMember: [
      {
        memberKey: "tm_aaaa1111",
        displayName: "김동원",
        costUsd: 40000,
        tokens: 1,
        share: 0.5,
      },
    ],
  });
  const { html, text } = render(
    <TeamUsageView env={env} copy={copy} locale="ko" now={NOW} />
  );
  assert.ok(text.includes(copy.text["disabled.badge"]));
  // ★서버가 실수로 숫자를 실어 보내도 화면은 안 그린다.
  assert.doesNotMatch(html, /99,807|99807/);
  assert.doesNotMatch(html, /김동원/);
  // 사유는 코드로 번역된다 — 서버 산문이 아니라.
  assert.ok(text.includes(copy.reasons["gate_unset"]));
  assert.ok(!text.includes("고지 개정 전이다"));
});

test("모르는 사유 코드는 서버 산문으로 떨어진다 (빈칸이 되지 않는다)", () => {
  const copy = buildTeamCopy(ko.team);
  const env = normalizeTeamUsage({
    teamUsage: {
      state: "disabled",
      disabledReason: "새로 생긴 사유 문장",
      disabledReasonCode: "brand_new_code",
      effectiveFrom: null,
      basis: "account_ledger",
      scope: "team",
      projectsInScope: 0,
    },
  });
  const { text } = render(
    <TeamUsageView env={env} copy={copy} locale="ko" now={NOW} />
  );
  assert.ok(text.includes("새로 생긴 사유 문장"));
});

// ── 라벨 없는 숫자 금지 ─────────────────────────────────────────────────────

test("basis 가 비면 기준 배지가 그 사실을 표시한다", () => {
  const copy = buildTeamCopy(ko.team);
  const env = envNotCollected({
    teamUsage: {
      state: "complete",
      disabledReason: null,
      effectiveFrom: "2026-08-01",
      basis: "",
      scope: "team",
      projectsInScope: 1,
    },
  });
  const { html } = render(
    <TeamUsageView env={env} copy={copy} locale="ko" now={NOW} />
  );
  // ★이 문장은 `title` 속성에 들어간다 — 태그를 걷어낸 텍스트에는 안 남으므로
  //   여기서만 raw HTML 로 본다.
  assert.ok(
    html.includes(copy.text["basis.missing"]),
    "기준 라벨이 없으면 화면이 그 사실을 말해야 한다"
  );
});

// ── 프라이버시 ──────────────────────────────────────────────────────────────

test("원시 uid·이메일·가명 키는 화면에 등장하지 않는다", () => {
  const copy = buildTeamCopy(ko.team);
  const env = normalizeTeamUsage({
    rangeDays: 30,
    generatedAt: "2026-08-21T09:00:00.000Z",
    teamUsage: {
      state: "complete",
      disabledReason: null,
      effectiveFrom: "2026-08-01",
      basis: "account_ledger",
      scope: "team",
      projectsInScope: 1,
    },
    orchestratorAxis: {
      state: "not_collected",
      reason: "x",
      reasonCode: "orchestrator_not_collected",
      collectingSince: null,
      legacySegment: null,
    },
    byMember: [
      {
        memberKey: "tm_aaaa1111",
        displayName: "john.kim@hypemarc.com",
        costUsd: 1,
        tokens: 1,
        share: 1,
      },
      {
        memberKey: "aB3xY7zQ1mN5pR8sT2vW4uK6",
        displayName: "새는 사람",
        costUsd: 9,
        tokens: 9,
        share: 1,
      },
    ],
  });
  const { html, text } = render(
    <TeamUsageView env={env} copy={copy} locale="ko" now={NOW} />
  );
  assert.doesNotMatch(html, /@hypemarc\.com/);
  assert.doesNotMatch(html, /aB3xY7zQ1mN5pR8sT2vW4uK6/);
  assert.doesNotMatch(html, /새는 사람/);
  // 가명 키 자체도 그리지 않는다 — 축을 넘는 조인 키를 화면에 노출할 이유가 없다.
  assert.doesNotMatch(html, /tm_aaaa1111/);
  // 이름이 걸러진 자리는 빈칸이 아니라 '이름 없는 멤버' 다.
  assert.ok(text.includes(copy.text["members.unnamed"]));
});

test("멤버 순위 위에 옵트아웃·귀속 고지가 먼저 온다", () => {
  const copy = buildTeamCopy(ko.team);
  const { text } = render(
    <TeamUsageView env={envNotCollected()} copy={copy} locale="ko" now={NOW} />
  );
  const note = text.indexOf(copy.text["members.optOutNote"]);
  const firstRow = text.indexOf("김동원");
  assert.ok(note >= 0 && firstRow > note, "고지가 순위표보다 앞에 있어야 한다");
  assert.ok(text.includes(copy.text["members.hostNote"]));
});

// ── 신선도 / 진행 중 배지 ───────────────────────────────────────────────────

test("헤더는 generatedAt 기준 'N분 전' 을 그리고, 오늘 막대엔 진행 중 배지가 붙는다", () => {
  const copy = buildTeamCopy(ko.team);
  const { text } = render(
    <TeamUsageView env={envNotCollected()} copy={copy} locale="ko" now={NOW} />
  );
  assert.ok(text.includes("5분 전 기준"));
  assert.ok(text.includes(copy.text["today.partialBadge"]));
});

test("커버리지가 없으면 0% 가 아니라 '모른다' 고 쓴다", () => {
  const copy = buildTeamCopy(ko.team);
  const env = envNotCollected({ coverage: null });
  const { text } = render(
    <TeamUsageView env={env} copy={copy} locale="ko" now={NOW} />
  );
  assert.ok(text.includes(copy.text["coverage.unknown"]));
});

// ── ★위양성 짝 — 이 파일의 부정 검사들이 살아 있는지 확인한다 ────────────────
//
// 부정 검사(`~가 없다`)는 검사 자체가 죽어도 초록이다. 이 파일의 "'청구' 는
// 부인문 안에서만" 류 검사는 **`visibleText` 가 엔티티를 되돌린다는 전제**에
// 얹혀 있다. 그 전제가 깨지면(누가 복원을 지우면) 원문과 렌더 결과가 영영
// 안 맞아 검사가 조용히 통과한다 — 초록인데 아무것도 안 보는 상태다.
//
// 그래서 전제를 직접 검사한다: 작은따옴표가 든 문구는 **raw HTML 에는 없고**
// **복원된 텍스트에는 있어야** 한다.
test("★위양성 짝: 엔티티 복원이 없으면 문구 검사가 죽는다", () => {
  const copy = buildTeamCopy(ko.team);
  const bait = copy.text["money.note"];
  assert.ok(bait.includes("'"), "미끼 문구에 작은따옴표가 있어야 의미가 있다");

  const { html, text } = render(
    <TeamUsageView env={envNotCollected()} copy={copy} locale="ko" now={NOW} />
  );

  // React 가 ' 를 &#x27; 로 이스케이프하므로 raw HTML 에는 원문이 없다.
  assert.ok(
    !html.includes(bait),
    "raw HTML 비교가 성립하면 이 짝 검사가 무의미하다"
  );
  // 복원된 텍스트에는 있다 — 다른 검사들이 이걸 딛고 선다.
  assert.ok(text.includes(bait), "엔티티 복원이 동작해야 한다");
});

// ── ★여섯 번째 부재 — 권한으로 가려진 칸(#1205 §4.2) ────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] restricted 칸은 빈칸도 0 도 아니라 '권한 없음' + 사유 + 다음 할 일`, () => {
    const { text } = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{
          kind: "restricted",
          requires: "org_admin",
          reasonCode: "org_scope_denied",
          reason: null,
        }}
        title="조직 전체"
        basis=""
      />
    );
    assert.ok(text.includes(copy.text["cell.restrictedBadge"]));
    assert.ok(text.includes(copy.text["cell.restrictedBody"]));
    // 사유는 로케일 사전(org_scope_denied)의 문장이다 — 화면이 지어내지 않는다.
    assert.ok(text.includes(copy.reasons["org_scope_denied"]));
    // "권한이 없습니다" 로 끝내지 않고 무엇이 필요한지 말한다.
    assert.ok(text.includes(copy.text["cell.restrictedRequiresOrgAdmin"]));
    // ★금액이 그려지지 않는다 — 흐린 0 도 0 으로 읽힌다.
    //   (문구 자체가 "0 으로 읽지 마라" 를 말하므로 숫자 문자가 아니라
    //    통화 표기의 부재로 검사한다.)
    assert.ok(!text.includes("$"));
  });

  test(`[${locale}] restricted 칸의 requires 가 project_admin 이면 그쪽 안내를 그린다`, () => {
    const { text } = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{
          kind: "restricted",
          requires: "project_admin",
          reasonCode: null,
          reason: null,
        }}
        title="팀 합계"
        basis=""
      />
    );
    assert.ok(text.includes(copy.text["cell.restrictedRequiresProjectAdmin"]));
    assert.ok(!text.includes(copy.text["cell.restrictedRequiresOrgAdmin"]));
  });

  test(`[${locale}] restricted 칸에서 사유 코드가 사전에 없으면 서버 산문 → 폴백 순서다`, () => {
    const prose = "이 칸은 다른 사람의 권한 범위입니다";
    const withProse = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{
          kind: "restricted",
          requires: "org_admin",
          reasonCode: "unknown_future_code",
          reason: prose,
        }}
        title="조직 전체"
        basis=""
      />
    );
    assert.ok(withProse.text.includes(prose));

    const bare = render(
      <UsageCellView
        copy={copy}
        locale={locale}
        cell={{
          kind: "restricted",
          requires: "org_admin",
          reasonCode: null,
          reason: null,
        }}
        title="조직 전체"
        basis=""
      />
    );
    assert.ok(bare.text.includes(copy.text["reason.fallback"]));
  });
}
