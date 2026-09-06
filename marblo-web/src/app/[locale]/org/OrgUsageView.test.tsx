/**
 * ★조직 롤업(L0) 화면 규약을 **렌더된 HTML 바이트로** 확인한다
 * (`OrgViews.test.tsx` 규약). 이 화면이 실패하는 방식은 넷이다:
 *   1. 빈 상태가 이유 없이 빈다 → "왜 비었고 언제 차는가" 가 없으면 고장처럼 보인다.
 *   2. restricted 가 0/빈칸으로 그려진다 → 여섯 번째 부재(#1205 §4.2).
 *   3. 잘린 스코프가 조용히 넘어간다 → 합계가 전체인 척 거짓말한다.
 *   4. 미지정 버킷이 사라진다 → 팀 소계 합 ≠ 총계.
 * ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildOrgCopy } from "./orgCopy";
import { buildTeamCopy } from "../team/teamCopy";
import { OrgUsageSection } from "./OrgUsageView";
import { normalizeOrgUsage, type OrgUsageData } from "./orgUsageContract";

const LOCALES = [
  {
    locale: "ko",
    copy: buildOrgCopy(ko.org),
    teamCopy: buildTeamCopy(ko.team),
  },
  {
    locale: "en",
    copy: buildOrgCopy(en.org),
    teamCopy: buildTeamCopy(en.team),
  },
  {
    locale: "ja",
    copy: buildOrgCopy(ja.org),
    teamCopy: buildTeamCopy(ja.team),
  },
];

const NOW = Date.parse("2026-09-01T01:00:00.000Z");

/** 렌더된 HTML 과 대조할 문구는 React 의 이스케이프를 그대로 따라간다. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function render(entry: typeof LOCALES[number], data: OrgUsageData): string {
  return renderToStaticMarkup(
    <OrgUsageSection
      copy={entry.copy}
      teamCopy={entry.teamCopy}
      locale={entry.locale}
      now={NOW}
      state={{ kind: "loaded", data }}
    />
  );
}

function dataEnvelope(overrides: Record<string, unknown> = {}): OrgUsageData {
  return normalizeOrgUsage({
    restricted: false,
    rangeDays: 30,
    generatedAt: "2026-09-01T00:00:00.000Z",
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 900 },
    teamUsage: {
      state: "complete",
      disabledReason: null,
      disabledReasonCode: null,
      effectiveFrom: "2026-04-01",
      basis: "account_ledger",
      basisLabel: "로그인한 계정 기준으로 집계합니다.",
      costLabel: "사용량 환산 비용(추정)",
      costNotBillingNote: "청구액이 아닙니다.",
      scope: "team",
      projectsInScope: 3,
      projectsOmitted: 0,
      projectsTruncatedNote: null,
    },
    orchestratorAxis: {
      state: "not_collected",
      reason: null,
      reasonCode: "orchestrator_not_collected",
      collectingSince: null,
      legacySegment: null,
    },
    totals: {
      costUsd: 13,
      inputTokens: 110,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: 140,
    },
    byDay: [{ day: "2026-08-31", costUsd: 13, tokens: 140, partial: false }],
    byMember: [],
    byProject: [
      {
        projectId: "p1",
        projectName: "프로젝트-A",
        costUsd: 10,
        tokens: 100,
        teamId: "t1",
        teamDisplayName: "플랫폼팀",
      },
      {
        projectId: "p2",
        projectName: "프로젝트-B",
        costUsd: 3,
        tokens: 40,
        teamId: null,
        teamDisplayName: null,
      },
    ],
    byTeam: [
      {
        teamId: "t1",
        teamDisplayName: "플랫폼팀",
        costUsd: 10,
        tokens: 100,
        projects: 1,
      },
      {
        teamId: null,
        teamDisplayName: null,
        costUsd: 3,
        tokens: 40,
        projects: 1,
      },
    ],
    byModel: [],
    byActorKind: [],
    coverage: { rowsInWindow: 5 },
    ...overrides,
  });
}

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★빈 상태가 이유를 말한다 — 왜 비었고 언제 차는가`, () => {
    const html = render(
      entry,
      dataEnvelope({
        teamUsage: {
          state: "empty",
          disabledReason: null,
          disabledReasonCode: null,
          effectiveFrom: "2026-04-01",
          basis: "account_ledger",
          scope: "team",
          projectsInScope: 0,
          projectsOmitted: 0,
        },
        totals: null,
        byDay: [],
        byProject: [],
        byTeam: [],
        coverage: { rowsInWindow: 0 },
      })
    );
    assert.ok(html.includes(esc(entry.copy.text["usage.empty.title"])));
    assert.ok(
      html.includes(esc(entry.copy.text["usage.empty.why"])),
      "왜 비었는지가 없다"
    );
    assert.ok(
      html.includes(esc(entry.copy.text["usage.empty.when"])),
      "언제 차는지가 없다"
    );
    // ★집계 기준(로그인한 계정)도 빈 상태에서 이미 보인다.
    assert.ok(html.includes(esc(entry.copy.text["usage.loginBasis"])));
    // ★빈 상태에 0 을 크게 그리지 않는다.
    assert.ok(!html.includes("$0.00"), "빈 상태가 0 으로 그려졌다");
  });

  test(`[${entry.locale}] ★restricted 는 숫자 없이 '무엇이 필요한지' 만 말한다`, () => {
    const html = render(entry, {
      kind: "restricted",
      requires: "org_admin",
      reasonCode: "org_scope_denied",
      reason: null,
    });
    assert.ok(!html.includes("$"), "restricted 에 금액이 그려졌다");
    assert.ok(!html.includes("0.00"), "restricted 가 0 으로 접혔다");
  });

  test(`[${entry.locale}] 게이트 닫힘 — 숫자를 아예 그리지 않고 사유만`, () => {
    const html = render(
      entry,
      dataEnvelope({
        teamUsage: {
          state: "disabled",
          disabledReason: "방침 게이트가 닫혀 있습니다.",
          disabledReasonCode: "gate_unset",
          effectiveFrom: null,
          basis: "account_ledger",
          scope: "team",
          projectsInScope: 0,
          projectsOmitted: 0,
        },
        totals: null,
        byDay: [],
        byProject: [],
        byTeam: [],
        coverage: null,
      })
    );
    assert.ok(html.includes("방침 게이트가 닫혀 있습니다."));
    assert.ok(!html.includes("$"), "disabled 인데 금액이 그려졌다");
  });

  test(`[${entry.locale}] 팀 소계·프로젝트 행·★미지정 버킷·합계가 한 표에 내려간다`, () => {
    const html = render(entry, dataEnvelope());
    assert.ok(html.includes("플랫폼팀"), "팀 소계 행이 없다");
    assert.ok(html.includes("프로젝트-A"));
    assert.ok(html.includes("프로젝트-B"));
    assert.ok(
      html.includes(esc(entry.copy.text["usage.table.unassigned"])),
      "미지정 버킷이 사라졌다"
    );
    assert.ok(html.includes(esc(entry.copy.text["usage.table.total"])));
    // 일별 표.
    assert.ok(html.includes("2026-08-31"));
    // ★라벨 없는 숫자 금지 — 집계 기준이 상시 표기된다.
    assert.ok(html.includes("로그인한 계정 기준으로 집계합니다."));
  });

  test(`[${entry.locale}] ★잘린 프로젝트 개수가 화면에 밝혀진다`, () => {
    const data = dataEnvelope();
    assert.equal(data.kind, "data");
    if (data.kind !== "data") return;
    const truncated: OrgUsageData = {
      ...data,
      projectsOmitted: 7,
      projectsTruncatedNote: null,
    };
    const html = render(entry, truncated);
    assert.ok(
      html.includes(esc(entry.copy.text["usage.truncatedFallback"])),
      "잘림 문장이 없다"
    );
    assert.ok(html.includes("(7)"), "잘린 개수가 없다");
  });

  // ── ★조회 창의 실제 경계(티켓 EmHUecXSgXSyrF2XgJ8b) ────────────────────────
  //
  // 게이트(effectiveFrom)는 창의 하한일 뿐 창의 길이와 무관하다. 이 칸이
  // 없으면 effectiveFrom 문구 옆의 숫자가 "발효일부터의 합계" 로 읽힌다 —
  // 오케가 정확히 이렇게 속았다.

  test(`[${entry.locale}] ★조회 창 시작일·끝날이 게이트 발효일과 별개로 그려진다`, () => {
    const data = dataEnvelope();
    assert.equal(data.kind, "data");
    if (data.kind !== "data") return;
    // 실측 시나리오: 게이트는 4월로 당겨졌지만 창은 여전히 최근 30일뿐이다.
    const windowed: OrgUsageData = {
      ...data,
      windowFromDay: "2026-08-09",
      windowToDay: "2026-09-07",
    };
    const html = render(entry, windowed);
    assert.ok(
      html.includes(
        esc(
          fillTemplate(entry.copy.text["usage.window"], {
            from: "2026-08-09",
            to: "2026-09-07",
          })
        )
      ),
      "조회 창 문구가 없다"
    );
    assert.ok(
      html.includes(
        esc(
          fillTemplate(entry.copy.text["usage.effectiveFrom"], {
            date: "2026-04-01",
          })
        )
      ),
      "게이트 발효일 문구가 없다 — 둘 다 있어야 오독을 막는다"
    );
    // ★두 날짜가 다르다는 사실 자체가 화면 바이트에 남는다.
    assert.ok(
      !html.includes(
        esc(
          fillTemplate(entry.copy.text["usage.window"], {
            from: "2026-04-01",
            to: "2026-09-07",
          })
        )
      ),
      "창 시작일이 실제로는 8월인데 4월로 그려지면 안 된다"
    );
  });

  test(`[${entry.locale}] ★조회 창 날짜를 모르면(옛 배포) 그 문구를 안 그린다 — 지어내지 않는다`, () => {
    const data = dataEnvelope();
    assert.equal(data.kind, "data");
    if (data.kind !== "data") return;
    const html = render(entry, {
      ...data,
      windowFromDay: null,
      windowToDay: null,
    });
    // "usage.window" 템플릿의 정적 부분(자리표시자 제외)조차 없어야 한다.
    const staticPart =
      entry.copy.text["usage.window"].split(/\{from\}|\{to\}/)[0];
    if (staticPart.trim() !== "") {
      assert.ok(
        !html.includes(esc(staticPart)),
        "값이 없는데 창 문구 껍데기가 그려졌다"
      );
    }
  });
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
