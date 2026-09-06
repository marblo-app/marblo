import { describe, expect, it } from "vitest";
import {
  resolveAppWindowOpen,
  type AppWindowOpenContext,
} from "../../electron/in-app-browser-policy";

/**
 * 하얀 쪼그만 창 — 티켓 6iultrqezxzGXD8a9zIl.
 *
 * 사장님 원문: "링크 클릭해봤는데 하얀 쪼그만 창이 여전히 뜨네 그리고 이건
 * 안 들어가져."
 *
 * `applyExternalLinkHandling` 의 window-open 분기는 **외부 http(s) 가 아닌 모든
 * URL 에 `{action:"allow"}`** 를 줬다. Electron 에서 `allow` 는 "지금 창에서
 * 열어라"가 아니라 **BrowserWindow 를 새로 만들어라**다. 그래서 빈 문자열,
 * `about:blank`, `blob:`/`data:`/`javascript:`, 앱 origin 이 전부 목적지 없는
 * 네이티브 창이 됐다 — 하얗고(로드할 게 없다), 영원히 안 채워진다(라우팅은
 * 다른 데로 갔다).
 *
 * 왜 그 술어였나(git blame): `isInternalNavigationUrl` 은 PR #270 에서
 * **"어떤 URL 을 OS 브라우저로 쫓아내면 안 되는가"** 하나만 답하려고 태어났다.
 * catch 의 `return true` 는 "판단 못 하겠으면 쫓아내지 마라"는 방어적 폴백이다.
 * 그 술어를 그대로 window-open 의 allow 조건으로 재사용한 것이 사고였다.
 * "쫓아내지 마라"와 "네이티브 창을 새로 만들어라"는 다른 질문이다.
 *
 * ★그리고 그 catch 의 주석(`Unparseable / empty (e.g. "about:blank")`)은 사실이
 * 아니다 — `new URL("about:blank")` 는 파싱된다. catch 가 실제로 잡는 건 빈
 * 문자열과 스킴 없는 상대 URL 뿐이다. 아래 첫 두 테스트가 그 둘을 각각 못 박는다.
 *
 * 이 모듈이 답하는 질문은 하나뿐이다: **이 window.open 요청에 진짜 네이티브 창을
 * 내줘도 되는가.** 정답은 "정당한 auth 팝업일 때만"이다.
 */

const CTX: AppWindowOpenContext = {
  appOrigin: "http://127.0.0.1:51234",
  firebaseAuthDomain: "marblo-app.firebaseapp.com",
};

describe("resolveAppWindowOpen — 목적지 없는 창은 만들지 않는다", () => {
  it("빈 URL 로 여는 요청은 창을 만들지 않는다 (2단계 open 의 첫 걸음)", () => {
    expect(resolveAppWindowOpen("", CTX)).toEqual({
      kind: "suppress",
      reason: "blank",
    });
  });

  it("about:blank 는 창을 만들지 않는다", () => {
    expect(resolveAppWindowOpen("about:blank", CTX)).toEqual({
      kind: "suppress",
      reason: "blank",
    });
  });

  it("스킴 없는 상대 URL 은 창을 만들지 않는다 (catch 폴백이 실제로 잡던 것)", () => {
    expect(resolveAppWindowOpen("claude.ai/artifacts/abc", CTX)).toEqual({
      kind: "suppress",
      reason: "blank",
    });
  });

  it.each([
    "blob:https://claude.ai/9f2",
    "data:text/html,<b>x</b>",
    "javascript:void(0)",
    "file:///tmp/x.html",
  ])("비 http(s) 스킴은 창을 만들지 않는다: %s", (url) => {
    expect(resolveAppWindowOpen(url, CTX)).toEqual({
      kind: "suppress",
      reason: "non-http",
    });
  });

  it("앱 자신의 origin 도 창을 만들지 않는다 — 라우트 없는 두 번째 앱 창이 된다", () => {
    expect(resolveAppWindowOpen("http://127.0.0.1:51234/#/board", CTX)).toEqual(
      { kind: "suppress", reason: "app-origin" },
    );
  });

  it("appOrigin 을 아직 모르면 loopback 을 앱 창으로 오인해 열지 않는다", () => {
    expect(
      resolveAppWindowOpen("http://127.0.0.1:51234/#/board", {
        ...CTX,
        appOrigin: null,
      }),
    ).toEqual({ kind: "route-external" });
  });
});

describe("resolveAppWindowOpen — 정당한 auth 팝업은 살아 있어야 한다", () => {
  // firebase 는 signInWithPopup 에서 실제 https authDomain 핸들러 URL 을 그대로
  // window.open 에 넘긴다(@firebase/auth `_open`: `window.open(url || '', …)`).
  // 2단계 open 이 아니므로 위의 blank 억제가 GitHub 로그인을 죽이지 않는다.
  it.each([
    "https://marblo-app.firebaseapp.com/__/auth/handler?providerId=github.com",
    "https://other-project.firebaseapp.com/__/auth/handler",
    "https://marblo.web.app/__/auth/handler",
    "https://accounts.google.com/o/oauth2/auth?client_id=x",
    "https://github.com/login/oauth/authorize?client_id=x",
  ])("auth 팝업 대상은 창을 연다: %s", (url) => {
    expect(resolveAppWindowOpen(url, CTX)).toEqual({
      kind: "allow-auth-popup",
    });
  });

  it("authDomain 이 설정돼 있지 않아도 나머지 auth 호스트는 살아 있다", () => {
    expect(
      resolveAppWindowOpen("https://accounts.google.com/o/oauth2/auth", {
        ...CTX,
        firebaseAuthDomain: "",
      }),
    ).toEqual({ kind: "allow-auth-popup" });
  });

  it("github.com 의 OAuth 가 아닌 경로는 팝업이 아니라 외부 라우팅이다", () => {
    expect(
      resolveAppWindowOpen("https://github.com/marblo/marblo/pull/1483", CTX),
    ).toEqual({ kind: "route-external" });
  });
});

describe("resolveAppWindowOpen — 외부 링크 라우팅은 종전 그대로다", () => {
  it.each([
    "https://claude.ai/public/artifacts/abc",
    "http://localhost:3001/demo",
    "https://example.com/",
  ])("외부 http(s) 는 앱의 링크 라우팅으로 넘긴다: %s", (url) => {
    expect(resolveAppWindowOpen(url, CTX)).toEqual({ kind: "route-external" });
  });

  it("앱 origin 과 호스트만 같고 포트가 다른 loopback 은 사용자의 로컬 데모다", () => {
    // 종전 동작 유지: 두 번째 loopback 포트는 Web 탭이 돼야 한다(#1477 계열).
    expect(resolveAppWindowOpen("http://127.0.0.1:3001/demo", CTX)).toEqual({
      kind: "route-external",
    });
  });
});
