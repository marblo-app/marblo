/**
 * ★빈 조직이 "없습니다" 반복이 아니라 **다음 단계**로 읽힌다(감사 #1495 P1-1).
 *
 * 감사가 실측한 것: 결합 0인 조직 홈은 같은 톤의 "없습니다" 가 네 번 연달아
 * 나온다(사용량·성과·팀 라벨·결합 프로젝트). 문장 하나하나는 옳은데 화면
 * 전체가 버려진 페이지로 읽힌다. 시작 카드 하나를 앞에 세워 그 넷을 증상이
 * 아니라 설명으로 바꾼다.
 *
 * ★이 파일이 막는 실패 넷:
 *   1. 시작 카드가 안 뜬다 → 고친 게 없다.
 *   2. ★org_member 에게 뜬다 → 할 수 없는 일을 시킨다(`bindings === null`).
 *   3. 결합이 있는 조직에도 뜬다 → 정상 화면에 온보딩이 눌러앉는다.
 *   4. ★결합 폼이 두 번 그려진다 → 어느 쪽에 입력해야 하는지 모호해진다.
 *
 * ★기존 빈 상태 문구(`usage.empty.why`/`when`)는 건드리지 않는다 —
 *   `OrgUsageView.test.tsx` 의 단언이 그대로 살아 있어야 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildOrgCopy } from "./orgCopy";
import { buildTeamCopy } from "../team/teamCopy";
import { OrgHomeView, isOrgUnstarted } from "./OrgViews";
import type { OrgBindingEntry, OrgDetail, OrgListEntry } from "./orgContract";

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

/** 렌더된 HTML 과 대조할 문구는 React 의 이스케이프를 그대로 따라간다. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const ORGS: OrgListEntry[] = [
  {
    orgId: "org_1",
    displayName: "하이프마크",
    isPersonal: false,
    role: "org_admin",
  },
];

function detail(overrides: Partial<OrgDetail> = {}): OrgDetail {
  return {
    orgId: "org_1",
    displayName: "하이프마크",
    isPersonal: false,
    myRole: "org_admin",
    teams: [],
    bindings: [],
    ...overrides,
  };
}

const BOUND: OrgBindingEntry[] = [
  {
    bindingId: "b1",
    projectId: "p1",
    teamId: null,
    effectiveFromMs: Date.parse("2026-09-01T00:00:00.000Z"),
    recordedAtMs: Date.parse("2026-09-01T00:00:00.000Z"),
  },
];

function render(
  entry: (typeof LOCALES)[number],
  d: OrgDetail,
  bindForm?: React.ReactNode,
): string {
  return renderToStaticMarkup(
    <OrgHomeView
      copy={entry.copy}
      teamCopy={entry.teamCopy}
      locale={entry.locale}
      detail={d}
      orgs={ORGS}
      bindForm={bindForm}
    />,
  );
}

// ── 판정 함수 자체 ──────────────────────────────────────────────────────────

test("★isOrgUnstarted — 결합 0인 비개인 조직만 true", () => {
  assert.equal(isOrgUnstarted(detail()), true, "결합 0인데 false");
  assert.equal(
    isOrgUnstarted(detail({ bindings: BOUND })),
    false,
    "결합이 있는데 true",
  );
});

test("★개인 조직은 시작 카드 대상이 아니다 — 팀 개념이 없는 화면이다", () => {
  assert.equal(isOrgUnstarted(detail({ isPersonal: true })), false);
});

test("★bindings === null 은 0 이 아니다 — org_member 에게 못 할 일을 시키지 않는다", () => {
  assert.equal(
    isOrgUnstarted(detail({ bindings: null, myRole: "org_member" })),
    false,
    "목록을 못 받는 사람에게 '프로젝트를 결합하세요' 가 떴다",
  );
});

// ── 렌더 ────────────────────────────────────────────────────────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★빈 조직에 시작 카드가 뜨고 세 단계를 말한다`, () => {
    const html = render(entry, detail());
    for (const key of [
      "start.title",
      "start.body",
      "start.step1",
      "start.step2",
      "start.step3",
    ] as const) {
      assert.ok(
        html.includes(esc(entry.copy.text[key])),
        `${key} 가 화면에 없다`,
      );
    }
  });

  test(`[${entry.locale}] ★시작 카드는 아래 빈 칸들과 다르게 생긴다 — 점선을 한 번 더 쓰지 않는다`, () => {
    const html = render(entry, detail());
    const card = html.slice(
      html.indexOf(esc(entry.copy.text["start.title"])) - 400,
      html.indexOf(esc(entry.copy.text["start.title"])),
    );
    assert.ok(
      !card.includes("border-dashed"),
      "시작 카드가 점선이다 — '없습니다' 가 한 번 더 늘 뿐이다",
    );
  });

  test(`[${entry.locale}] ★결합이 있으면 시작 카드가 사라진다 — 정상 화면에 눌러앉지 않는다`, () => {
    const html = render(entry, detail({ bindings: BOUND }));
    assert.ok(
      !html.includes(esc(entry.copy.text["start.title"])),
      "결합이 있는데 온보딩이 남아 있다",
    );
  });

  test(`[${entry.locale}] ★결합 폼은 화면에 한 번만 나온다`, () => {
    const marker = "BIND_FORM_MARKER";
    const form = <div>{marker}</div>;

    const empty = render(entry, detail(), form);
    assert.equal(
      empty.split(marker).length - 1,
      1,
      "빈 조직에서 결합 폼이 두 번 그려졌다",
    );

    const bound = render(entry, detail({ bindings: BOUND }), form);
    assert.equal(
      bound.split(marker).length - 1,
      1,
      "결합이 있는 조직에서 결합 폼이 사라졌거나 두 번 그려졌다",
    );
  });

  test(`[${entry.locale}] ★기존 빈 상태 문구를 밀어내지 않는다 — bindings.empty 는 그대로 있다`, () => {
    const html = render(entry, detail());
    assert.ok(
      html.includes(esc(entry.copy.text["bindings.empty"])),
      "시작 카드가 기존 빈 상태 설명을 덮었다",
    );
  });
}
