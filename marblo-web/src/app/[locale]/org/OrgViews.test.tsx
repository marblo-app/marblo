/**
 * ★조직 화면 규약을 **렌더된 HTML 바이트로** 확인한다(`TeamUsageView.test.tsx`
 * 규약). 이 화면이 실패하는 방식은 넷이다:
 *   1. 조직이 하나뿐인데 스위처가 그려진다 → 대부분의 사용자에게 잡음.
 *   2. 개인 조직에 팀 개념이 그려진다 → 혼자인 사람에게 빈 개념을 판다(#1336).
 *   3. 권한으로 가려진 칸이 빈칸/0 으로 그려진다 → 여섯 번째 부재(#1205 §4.2).
 *   4. 빈 상태(팀 0·결합 0)에서 화면이 비거나 깨진다 → 기본 상태가 실패 상태.
 * 아래 테스트는 정확히 그 넷을 본다. ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildOrgCopy } from "./orgCopy";
import { buildTeamCopy } from "../team/teamCopy";
import { OrgChooserView, OrgHomeView, OrgSwitcherView } from "./OrgViews";
import type { OrgDetail, OrgListEntry } from "./orgContract";

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

const PERSONAL: OrgListEntry = {
  orgId: "personal_uid_1",
  displayName: null,
  isPersonal: true,
  role: "org_owner",
};

function org(
  orgId: string,
  role: OrgListEntry["role"] = "org_member"
): OrgListEntry {
  return { orgId, displayName: `이름-${orgId}`, isPersonal: false, role };
}

function personalDetail(): OrgDetail {
  return {
    orgId: "personal_uid_1",
    displayName: null,
    isPersonal: true,
    myRole: "org_owner",
    // ★서버 계약: 개인 조직엔 팀 개념이 아예 없다 — null 로 온다.
    teams: null,
    bindings: null,
  };
}

function orgDetail(overrides: Partial<OrgDetail> = {}): OrgDetail {
  return {
    orgId: "o1",
    displayName: "하이프마크",
    isPersonal: false,
    myRole: "org_admin",
    teams: [],
    bindings: [],
    ...overrides,
  };
}

function render(node: React.ReactElement): { html: string; text: string } {
  const html = renderToStaticMarkup(node);
  return { html, text: html.replace(/<[^>]+>/g, " ") };
}

// ── 1. ★스위처 노출 조건 ────────────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 조직이 하나뿐이면 스위처가 아예 그려지지 않는다`, () => {
    const { html } = render(
      <OrgSwitcherView
        copy={copy}
        locale={locale}
        orgs={[PERSONAL]}
        currentOrgId={PERSONAL.orgId}
      />
    );
    assert.equal(html, "");
  });

  test(`[${locale}] 비개인 조직이 있으면 스위처가 전 조직을 나열한다`, () => {
    const { html, text } = render(
      <OrgSwitcherView
        copy={copy}
        locale={locale}
        orgs={[PERSONAL, org("a"), org("b")]}
        currentOrgId="a"
      />
    );
    assert.ok(text.includes(copy.text["org.personalName"]));
    assert.ok(text.includes("이름-a"));
    assert.ok(text.includes("이름-b"));
    // ★개인 조직 링크는 /org/me 다 — uid 가 실린 orgId 를 URL 에 싣지 않는다.
    assert.ok(
      html.includes(
        'href="' + (locale === "ko" ? "" : `/${locale}`) + '/org/me"'
      )
    );
    assert.ok(!html.includes("personal_uid_1"));
    assert.ok(html.includes('aria-current="page"'));
  });
}

// ── 2. ★개인 조직에 팀 개념이 없다(#1336 §4.1) ─────────────────────────────

for (const { locale, copy, teamCopy } of LOCALES) {
  test(`[${locale}] 개인 조직 화면에 팀·결합·조직 사용량 영역이 없다`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={personalDetail()}
        orgs={[PERSONAL]}
        inviteForm={<div>초대폼-슬롯</div>}
      />
    );
    assert.ok(text.includes(copy.text["org.personalName"]));
    assert.ok(text.includes(copy.text["personal.subtitle"]));
    // 콤보도, 미지정 버킷도, 팀 접기도 없다.
    assert.ok(!text.includes(copy.text["teams.title"]));
    assert.ok(!text.includes(copy.text["bindings.title"]));
    assert.ok(!text.includes(copy.text["bind.open"]));
    assert.ok(!text.includes(copy.text["usage.title"]));
    // ★초대는 조직의 개념이다 — 개인 조직에는 슬롯을 꽂아 줘도 안 그린다.
    assert.ok(!text.includes("초대폼-슬롯"));
  });

  // ★빈 상태 규약(#1333 §7): 비개인 조직 0건이 기본값 — 왜 이것뿐이고 언제
  //   차는지를 개인 조직 화면이 말하고, 조직 생성 입구(/org/new)로 잇는다.
  test(`[${locale}] 조직 0건 기본값 — 개인 조직 화면이 이유와 다음 걸음을 말한다`, () => {
    const { html, text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={personalDetail()}
        orgs={[PERSONAL]}
      />
    );
    assert.ok(text.includes(copy.text["personal.createHint"]));
    assert.ok(text.includes(copy.text["personal.createCta"]));
    const prefix = locale === "ko" ? "" : `/${locale}`;
    assert.ok(html.includes(`href="${prefix}/org/new"`));
  });

  test(`[${locale}] 비개인 조직이 있으면 생성 안내를 접는다 — 잡음이다`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={personalDetail()}
        orgs={[PERSONAL, org("a")]}
      />
    );
    assert.ok(!text.includes(copy.text["personal.createHint"]));
  });

  test(`[${locale}] 비개인 조직에서는 초대 폼 슬롯이 그려진다`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={orgDetail()}
        orgs={[PERSONAL, org("o1")]}
        inviteForm={<div>초대폼-슬롯</div>}
      />
    );
    assert.ok(text.includes("초대폼-슬롯"));
  });
}

// ── 3. ★restricted — 빈칸이 아니라 사유로 그린다(#1205 §4.2) ────────────────

for (const { locale, copy, teamCopy } of LOCALES) {
  test(`[${locale}] org_member 의 조직 전체 사용량 칸은 권한 없음 + 다음 할 일`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={orgDetail({ myRole: "org_member", bindings: null })}
        orgs={[PERSONAL, org("o1")]}
      />
    );
    assert.ok(text.includes(teamCopy.text["cell.restrictedBadge"]));
    // 사유는 서버 코드 사전(org_scope_denied)의 문장이다 — 화면이 지어내지 않는다.
    assert.ok(text.includes(teamCopy.reasons["org_scope_denied"]));
    // "권한이 없습니다" 로 끝내지 않고 무엇이 필요한지 말한다.
    assert.ok(text.includes(teamCopy.text["cell.restrictedRequiresOrgAdmin"]));
    // ★숫자·통화 기호가 그려지지 않는다 — 빈칸도 0 도 이 칸에서는 거짓말이다.
    assert.ok(!text.includes("$"));
    // 결합 목록도 빈칸이 아니라 '누가 볼 수 있는지' 로 그린다.
    assert.ok(text.includes(copy.text["bindings.restricted"]));
    assert.ok(!text.includes(copy.text["bindings.empty"]));
  });

  test(`[${locale}] 관리자의 조직 전체 사용량 칸은 미배선으로 정직하게 그린다`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={orgDetail({ myRole: "org_admin" })}
        orgs={[PERSONAL, org("o1")]}
      />
    );
    assert.ok(text.includes(teamCopy.text["cell.unwiredBadge"]));
    assert.ok(!text.includes(teamCopy.text["cell.restrictedBadge"]));
  });
}

// ── 4. ★빈 상태가 기본값이다 ────────────────────────────────────────────────

for (const { locale, copy, teamCopy } of LOCALES) {
  test(`[${locale}] 팀 0 · 결합 0 에서 화면이 깨지지 않고 문장으로 말한다`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={orgDetail()}
        orgs={[PERSONAL, org("o1")]}
      />
    );
    assert.ok(text.includes(copy.text["teams.empty"]));
    assert.ok(text.includes(copy.text["bindings.empty"]));
  });

  test(`[${locale}] 결합 행은 현재 유효 결합만 — 팀 라벨이 이름으로 해석된다`, () => {
    const { text } = render(
      <OrgHomeView
        copy={copy}
        teamCopy={teamCopy}
        locale={locale}
        detail={orgDetail({
          teams: [
            { teamId: "t1", displayName: "플랫폼", archived: false },
            { teamId: "t9", displayName: "보관됨", archived: true },
          ],
          bindings: [
            {
              bindingId: "b1",
              projectId: "p1",
              teamId: "t1",
              effectiveFromMs: 100,
              recordedAtMs: 100,
            },
            {
              bindingId: "b2",
              projectId: "p1",
              teamId: null,
              effectiveFromMs: 200,
              recordedAtMs: 200,
            },
            {
              bindingId: "b3",
              projectId: "p2",
              teamId: "t9",
              effectiveFromMs: 100,
              recordedAtMs: 100,
            },
          ],
        })}
        orgs={[PERSONAL, org("o1")]}
      />
    );
    // p1 은 재배정 후 팀 미지정이 현재값 — "없다고 답함" 을 그대로 그린다.
    assert.ok(text.includes(copy.text["bindings.noTeam"]));
    // 보관된 팀의 라벨도 과거 결합 행에서는 이름으로 해석된다.
    assert.ok(text.includes("보관됨"));
    // 보관된 팀은 팀 라벨 목록(칩)에는 나오지 않는다.
    const teamsSection = text.slice(
      text.indexOf(copy.text["teams.title"]),
      text.indexOf(copy.text["bindings.title"])
    );
    assert.ok(teamsSection.includes("플랫폼"));
    assert.ok(!teamsSection.includes("보관됨"));
  });
}

// ── 조직 선택 화면(§5.8 규칙 3) ─────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 선택 화면은 개인 조직을 포함해 전 조직을 나열한다`, () => {
    const { html, text } = render(
      <OrgChooserView
        copy={copy}
        locale={locale}
        orgs={[PERSONAL, org("a", "org_owner"), org("b")]}
      />
    );
    assert.ok(text.includes(copy.text["choose.title"]));
    assert.ok(text.includes(copy.text["choose.body"]));
    assert.ok(text.includes(copy.text["org.personalName"]));
    assert.ok(text.includes("이름-a"));
    assert.ok(text.includes("이름-b"));
    // 링크 규약: 개인 조직은 /org/me, 비개인은 /org/<id>.
    const prefix = locale === "ko" ? "" : `/${locale}`;
    assert.ok(html.includes(`href="${prefix}/org/me"`));
    assert.ok(html.includes(`href="${prefix}/org/a"`));
  });

  test(`[${locale}] 이름 없는 비개인 조직은 id 대신 이름 폴백으로 그린다`, () => {
    const noName: OrgListEntry = {
      orgId: "opaque-id-123",
      displayName: null,
      isPersonal: false,
      role: "org_member",
    };
    const { text } = render(
      <OrgChooserView copy={copy} locale={locale} orgs={[PERSONAL, noName]} />
    );
    assert.ok(text.includes(copy.text["org.unnamed"]));
  });
}
