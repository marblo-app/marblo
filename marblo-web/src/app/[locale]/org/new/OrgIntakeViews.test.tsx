/**
 * (b) 조직 정보 1화면 — 렌더 규약(AnalyticsPanel 규약, ko·en·ja 전부).
 *   - 입력칸은 조직명 **하나**다(#1338 §3.1 (b) — 도메인·로고·업종을 묻지 않는다).
 *   - 거절 5종이 각각 다른 문구로 그려진다(validateTeamOrgIntake 어휘의 화면 번역).
 *   - unavailable 문구는 결제가 유효함을 함께 말한다(재진입 배너 설계의 전제).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../../messages/ko.json";
import en from "../../../../../messages/en.json";
import ja from "../../../../../messages/ja.json";
import { buildOrgOnboardingCopy } from "@/lib/orgOnboardingCopy";
import { IntakeForm, IntakeSuccess } from "./OrgIntakeViews";

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

test("폼: 입력칸은 정확히 하나 — 조직명뿐이다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = renderToStaticMarkup(
      <IntakeForm
        copy={copy}
        value=""
        submitting={false}
        failure={null}
        onChange={noop}
        onSubmit={noop}
      />
    );
    const inputs = html.match(/<input/g) ?? [];
    assert.equal(inputs.length, 1, locale);
    assert.ok(includesText(html, copy["intake.title"]), locale);
    assert.ok(includesText(html, copy["intake.submit"]), locale);
  }
});

test("거절 5종이 각각 다른 문구로 그려진다", () => {
  const failures = [
    "name_required",
    "too_short",
    "too_long",
    "invalid_chars",
    "unavailable",
  ] as const;
  for (const { locale, copy } of LOCALES) {
    const rendered = failures.map((failure) =>
      renderToStaticMarkup(
        <IntakeForm
          copy={copy}
          value="x"
          submitting={false}
          failure={failure}
          onChange={noop}
          onSubmit={noop}
        />
      )
    );
    assert.equal(new Set(rendered).size, failures.length, locale);
    failures.forEach((failure, i) => {
      assert.ok(
        includesText(rendered[i], copy[`intake.err.${failure}`]),
        `${locale}/${failure}`
      );
    });
  }
});

test("성공: 조직 이름과 조직 홈으로의 다음 걸음을 그린다", () => {
  for (const { locale, copy } of LOCALES) {
    const html = renderToStaticMarkup(
      <IntakeSuccess
        copy={copy}
        org={{ orgId: "o1", displayName: "하이프마크" }}
        orgHomeHref="/org/o1"
        downloadHref="/download"
        guideHrefBase="/guide"
      />
    );
    assert.ok(html.includes("하이프마크"), locale);
    assert.ok(html.includes('href="/org/o1"'), locale);
    assert.ok(includesText(html, copy["intake.inviteCta"]), locale);
    // 관리자 본인도 설치·가이드가 필요하다(#1338 §3.1) — 진입점이 이어진다.
    assert.ok(html.includes('href="/guide#'), locale);
  }
});
