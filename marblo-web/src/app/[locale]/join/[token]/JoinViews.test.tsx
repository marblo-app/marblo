/**
 * ★조인 화면 상태 전수를 **렌더된 HTML 바이트로** 확인한다(AnalyticsPanel 규약).
 *
 * 완료 기준을 그대로 검사한다:
 *   - 에러 4종(만료·위조/취소·다른 계정·이미 수락)이 각각 다른 안내를 준다.
 *   - (g)는 입력이 없다 — 확인 화면에 input 이 하나도 없다.
 *   - 수락 완료 화면에서 다운로드 버튼이 가이드보다 먼저 나온다(문이지 벽이
 *     아니다 — #1338 §3.2 (h)).
 *   - 다른 계정 화면은 초대된 이메일을 그리지 않는다(#1205 §5.4 — 값 자체가
 *     오지 않지만, 화면도 지금 로그인된 계정만 말한다).
 * ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../../messages/ko.json";
import en from "../../../../../messages/en.json";
import ja from "../../../../../messages/ja.json";
import { buildOrgOnboardingCopy, formatCopy } from "@/lib/orgOnboardingCopy";
import type { ResolvedInvite } from "@/lib/orgOnboarding";
import {
  InviteAccepted,
  InviteConfirm,
  InviteFailureCard,
  InviteLanding,
  JoinResolving,
} from "./JoinViews";

const LOCALES = [
  {
    locale: "ko",
    copy: buildOrgOnboardingCopy((ko as Record<string, unknown>).orgOnboarding),
  },
  {
    locale: "en",
    copy: buildOrgOnboardingCopy((en as Record<string, unknown>).orgOnboarding),
  },
  {
    locale: "ja",
    copy: buildOrgOnboardingCopy((ja as Record<string, unknown>).orgOnboarding),
  },
];

const INVITE: ResolvedInvite = {
  orgDisplayName: "하이프마크",
  inviterName: "김대표",
  orgRole: "org_member",
  teamName: null,
  projectName: "marblo-web",
  invitedEmail: "invitee@example.com",
  expiresAtMs: null,
};

const noop = () => {};

/** React 가 이스케이프한 HTML 에서 원문 문구를 찾기 위한 미러 이스케이프. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function includesText(html: string, text: string): boolean {
  return html.includes(esc(text));
}

function failureHtml(
  copy: typeof LOCALES[number]["copy"],
  failure:
    | "expired"
    | "invalid"
    | "wrong_account"
    | "unavailable"
    | "unauthenticated",
  extras: { expiresAtMs?: number | null; signedInEmail?: string | null } = {}
) {
  return renderToStaticMarkup(
    <InviteFailureCard
      copy={copy}
      failure={failure}
      locale="ko"
      expiresAtMs={extras.expiresAtMs ?? null}
      signedInEmail={extras.signedInEmail ?? null}
      loginHref="/auth/login"
      onRetry={noop}
      onSwitchAccount={noop}
    />
  );
}

test("해석 중 화면", () => {
  for (const { copy } of LOCALES) {
    const html = renderToStaticMarkup(<JoinResolving copy={copy} />);
    assert.ok(includesText(html, copy["join.resolving"]));
  }
});

test("(e) 랜딩: 조직 표시명·초대자·역할을 보여주고 로그인/가입으로 잇는다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = renderToStaticMarkup(
      <InviteLanding
        copy={copy}
        invite={INVITE}
        loginHref="/auth/login?redirect=r"
        signupHref="/auth/signup?redirect=r"
      />
    );
    assert.ok(html.includes("하이프마크"), locale);
    assert.ok(html.includes("김대표"), locale);
    assert.ok(includesText(html, copy["join.role.org_member"]), locale);
    assert.ok(includesText(html, copy["join.loginCta"]), locale);
    assert.ok(includesText(html, copy["join.signupCta"]), locale);
    // ★초대된 이메일을 본문에 그리지 않는다 — 링크를 주운 사람에게 이메일을
    // 확인해 주지 않는다(프리필은 href 파라미터일 뿐, 화면 문구가 아니다).
    assert.ok(!html.includes("invitee@example.com"), locale);
  }
});

test("(g) 소속 확인: 조직·팀·프로젝트·역할을 보여주고 ★아무것도 묻지 않는다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = renderToStaticMarkup(
      <InviteConfirm
        copy={copy}
        invite={INVITE}
        signedInEmail="me@example.com"
        accepting={false}
        errorNote={null}
        onAccept={noop}
      />
    );
    assert.ok(html.includes("하이프마크"), locale);
    // ★"(팀 없음)" 이 정상값(#1336) — 빈 팀을 숨기지 않고 말로 쓴다.
    assert.ok(includesText(html, copy["join.noTeam"]), locale);
    assert.ok(html.includes("marblo-web"), locale);
    assert.ok(includesText(html, copy["join.accept"]), locale);
    // 확인 화면이다 — 입력칸 0.
    assert.ok(!html.includes("<input"), locale);
  }
});

test("수락 완료: 다운로드 버튼이 가이드 진입점보다 먼저다 — 문이지 벽이 아니다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = renderToStaticMarkup(
      <InviteAccepted
        copy={copy}
        orgDisplayName="하이프마크"
        alreadyMember={false}
        orgHomeHref="/org/o1"
        downloadHref="/download"
        guideHrefBase="/guide"
      />
    );
    assert.ok(
      includesText(
        html,
        formatCopy(copy["join.acceptedTitle"], { org: "하이프마크" })
      ),
      locale
    );
    const downloadAt = html.indexOf('href="/download"');
    const guideAt = html.indexOf('href="/guide#');
    assert.ok(downloadAt !== -1 && guideAt !== -1, locale);
    assert.ok(downloadAt < guideAt, `${locale}: 다운로드가 가이드 뒤에 있다`);
    assert.ok(includesText(html, copy["join.downloadSkipNote"]), locale);
  }
});

test("★에러 4종이 각각 다른 안내를 준다 — 로케일 세 벌 전부", () => {
  for (const { locale, copy } of LOCALES) {
    const rendered = {
      expired: failureHtml(copy, "expired"),
      invalid: failureHtml(copy, "invalid"),
      wrong_account: failureHtml(copy, "wrong_account", {
        signedInEmail: "other@example.com",
      }),
      // "이미 수락함" 은 실패 카드가 아니라 다음 단계 화면이다.
      already: renderToStaticMarkup(
        <InviteAccepted
          copy={copy}
          orgDisplayName={null}
          alreadyMember
          orgHomeHref={null}
          downloadHref="/download"
          guideHrefBase="/guide"
        />
      ),
    };
    assert.ok(includesText(rendered.expired, copy["join.expired.title"]), locale);
    assert.ok(includesText(rendered.invalid, copy["join.invalid.title"]), locale);
    assert.ok(
      includesText(rendered.wrong_account, copy["join.wrongAccount.title"]),
      locale
    );
    assert.ok(includesText(rendered.already, copy["join.already.title"]), locale);
    // 서로의 제목이 섞여 들어가지 않는다 — 4종이 4벌의 화면이다.
    assert.equal(new Set(Object.values(rendered)).size, 4, locale);
    assert.ok(!includesText(rendered.invalid, copy["join.expired.title"]), locale);
    assert.ok(!includesText(rendered.expired, copy["join.invalid.title"]), locale);
  }
});

test("만료: 서버가 만료 시각을 준 경우에만 시점을 그린다", () => {
  const { copy } = LOCALES[0];
  const withTime = failureHtml(copy, "expired", {
    expiresAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
  });
  assert.ok(withTime.includes("2026"));
  const withoutTime = failureHtml(copy, "expired", { expiresAtMs: null });
  assert.ok(!withoutTime.includes("2026"));
});

test("다른 계정: 지금 로그인된 계정만 말하고 전환 버튼을 준다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = failureHtml(copy, "wrong_account", {
      signedInEmail: "other@example.com",
    });
    assert.ok(html.includes("other@example.com"), locale);
    assert.ok(includesText(html, copy["join.wrongAccount.switch"]), locale);
    // 초대된 이메일은 룰이 read 를 거부해 값 자체가 없다 — 화면도 그리지 않는다.
    assert.ok(!html.includes("invitee@example.com"), locale);
  }
});

test("판정 불가(unavailable): 링크 탓을 하지 않고 재시도를 준다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = failureHtml(copy, "unavailable");
    assert.ok(includesText(html, copy["join.unavailable.title"]), locale);
    assert.ok(includesText(html, copy["join.retry"]), locale);
    assert.ok(!includesText(html, copy["join.invalid.title"]), locale);
  }
});
