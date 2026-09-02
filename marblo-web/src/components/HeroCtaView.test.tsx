/**
 * ★사장님 재현: 가입 → 로그인 → 홈 → 파란 CTA 클릭 시 /download 로 가야 한다
 *   (더 이상 /auth/signup 아님). 비로그인은 기존대로 /auth/signup 유지.
 *   확정 전(pending)에는 "가입하기" 같은 문구가 화면에 보이면 안 된다.
 *
 * ★jsdom 이 이 워크트리 node_modules(undici)와 안 맞아 마운트 테스트가 전부
 *   깨진다(기존 차트 jsdom 테스트도 동일 증상 — 이 변경이 만든 문제가 아니다).
 *   그래서 렌더 결과는 순수 프레젠테이션 컴포넌트(HeroCtaView)를
 *   renderToStaticMarkup 으로 검증한다(OrgUsageView.test.tsx 관례). 실제
 *   Firebase 구독 배선(HeroCta.tsx)은 useEffect 대여섯 줄짜리 얇은 접착부라
 *   firebase/auth 를 건드리지 않는 이 파일에서는 검사 대상이 아니다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import HeroCtaView from "./HeroCtaView";

const LABELS = { signup: "무료 베타 시작하기", download: "다운로드" };

test("★사장님 재현: 로그인 상태(authed)로 렌더하면 /download 로 간다 — /auth/signup 아니다", () => {
  const html = renderToStaticMarkup(
    <HeroCtaView
      state="authed"
      locale="ko"
      signupLabel={LABELS.signup}
      downloadLabel={LABELS.download}
      className="cta"
    />
  );
  assert.ok(
    html.includes('href="/download"'),
    "로그인 상태인데 CTA가 /download 로 안 간다 — 원래 버그 재발"
  );
  assert.ok(
    !html.includes("/auth/signup"),
    "로그인 상태인데 여전히 가입 페이지 링크가 남아있다"
  );
  assert.ok(html.includes(LABELS.download));
  assert.ok(!html.includes(LABELS.signup));
  assert.ok(!html.includes("invisible"), "확정된 상태인데 여전히 숨겨진 채다");
  assert.ok(html.includes('aria-busy="false"'));
});

test("비로그인 상태(anon)는 그대로 /auth/signup 으로 간다 (회귀 방지)", () => {
  const html = renderToStaticMarkup(
    <HeroCtaView
      state="anon"
      locale="ko"
      signupLabel={LABELS.signup}
      downloadLabel={LABELS.download}
      className="cta"
    />
  );
  assert.ok(html.includes('href="/auth/signup"'));
  assert.ok(html.includes(LABELS.signup));
  assert.ok(!html.includes(LABELS.download));
  assert.ok(!html.includes("invisible"));
  assert.ok(html.includes('aria-busy="false"'));
});

test("★깜빡임 방지: 인증 확정 전(pending)에는 invisible 로 자리만 차지한다", () => {
  const html = renderToStaticMarkup(
    <HeroCtaView
      state="pending"
      locale="ko"
      signupLabel={LABELS.signup}
      downloadLabel={LABELS.download}
      className="cta"
    />
  );
  assert.ok(
    html.includes("invisible"),
    "pending 인데 이미 보이는 상태로 렌더된다 — 깜빡임 버그"
  );
  assert.ok(html.includes('aria-busy="true"'));
});
