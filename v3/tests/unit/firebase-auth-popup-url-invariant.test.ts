import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ★설치된 firebase 가 팝업을 **URL 없이** 열지 않는다는 것을 CI 가 지킨다 —
 * 티켓 6iultrqezxzGXD8a9zIl.
 *
 * `resolveAppWindowOpen` 은 목적지 없는 `window.open` 을 억제한다. 그 억제가
 * 안전한 유일한 이유는 **firebase 의 signInWithPopup 이 항상 실제 https
 * authDomain 핸들러 URL 을 넘기기 때문**이다. 사장님이 GitHub 로그인을 쓰시므로
 * 이건 이론상 위험이 아니라 실제 경로다.
 *
 * ★오케 리뷰의 지적이 정확했다. `@firebase/auth` 의 `_open` 은 이렇게 생겼다:
 *
 *     window.open(url || '', target, optionsString);
 *
 * 그 `|| ''` 는 "url 이 falsy 일 수 있다"는 신호로 읽힌다. 설치본(@firebase/auth
 * 1.7.9 / firebase 10.14.1, 브라우저 번들 `dist/esm2017/`)을 열어 확인한 결과:
 *
 *  1. `_open` 의 선언 타입이 `url?: string` — **선택 인자**다. `|| ''` 는 그
 *     선택 인자의 방어적 기본값이지, 팝업 경로의 살아 있는 분기가 아니다.
 *  2. `_open` 호출부는 **정확히 하나**뿐이고 `_openPopup` 의
 *     `_open(auth, url, _generateEventId())` 다.
 *  3. 그 `url` 은 `await _getRedirectUrl(...)` 인데, 그 함수는
 *     `_assert(auth.config.authDomain, …)` 로 **던지지 falsy 를 돌려주지 않고**,
 *     반환값은 `https://${config.authDomain}/${WIDGET_PATH}` 로 시작하는 템플릿
 *     리터럴이라 **빈 문자열이 될 수 없다**.
 *
 * → 이 버전에서 팝업 경로의 `url` 은 falsy 가 될 수 없다. 그래서 탈출구
 *   ("opener 가 앱 origin 이고 features 에 팝업 신호가 있으면 blank 도 살려준다")를
 *   **일부러 넣지 않았다.** 넣으면 2단계 open 의 첫 걸음(빈 창)도 똑같이 앱
 *   origin + 팝업 features 로 오므로, 이 PR 이 닫은 구멍을 그대로 다시 연다.
 *
 * 위 3개가 "한 번 읽어봤다"로 끝나면 firebase 업그레이드 한 번에 조용히
 * 무너진다 — 그때 증상은 `console.warn` 한 줄과 안 뜨는 로그인 창뿐이다. 그래서
 * **설치본을 직접 읽어** 불변식으로 못 박는다. 업그레이드가 이걸 깨면 이 테스트가
 * 빨개지고, 올린 사람이 이유를 여기서 읽는다.
 *
 * 범위는 **브라우저가 실제로 로드하는 번들 하나**(`dist/esm2017/`)로 좁혔다.
 * cordova·react-native·web-extension·node 빌드는 이 앱이 싣지 않으므로 그것까지
 * 확인 대상으로 삼으면 통과·실패가 무의미해진다.
 */

const require_ = createRequire(import.meta.url);

/** 번들러가 `firebase/auth` 를 풀 때와 같은 경로로 설치본을 찾는다. */
function resolveFirebaseAuthDist(): { version: string; esm2017Dir: string } {
  // `firebase/auth` 의 실제 엔트리 파일에서 위로 걸어 올라가 풀어야 nested
  // `node_modules/firebase/node_modules/@firebase/auth` 설치본을 만난다.
  const pkgPath = require_.resolve("@firebase/auth/package.json", {
    paths: [dirname(require_.resolve("firebase/auth"))],
  });
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return {
    version: pkg.version,
    esm2017Dir: join(dirname(pkgPath), "dist", "esm2017"),
  };
}

const { version, esm2017Dir } = resolveFirebaseAuthDist();

/** `_open` 을 정의한 브라우저 청크. 파일명이 해시라 내용으로 찾는다. */
function readPopupChunk(): string {
  const chunks = readdirSync(esm2017Dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(join(esm2017Dir, name), "utf8"))
    .filter((src) => src.includes("function _open("));
  expect(
    chunks.length,
    `dist/esm2017 에서 _open 을 정의한 청크를 정확히 하나 찾지 못했다 (firebase ${version})`,
  ).toBe(1);
  return chunks[0] as string;
}

const popupChunk = readPopupChunk();

describe(`@firebase/auth ${version} — 팝업은 URL 없이 열리지 않는다`, () => {
  it("_open 호출부는 하나뿐이고 url 을 넘긴다 (무인자 open 이 아니다)", () => {
    const callSites = popupChunk
      .split("\n")
      // 정의 줄(`function _open(auth, url, name, …`)은 호출부가 아니다.
      .filter((line) => !line.includes("function _open("))
      .filter((line) => line.includes("_open(auth,"))
      .map((line) => line.trim());

    expect(callSites).toEqual(["return _open(auth, url, _generateEventId());"]);
  });

  it("그 url 은 _getRedirectUrl 의 결과다", () => {
    expect(popupChunk).toContain(
      "const url = await _getRedirectUrl(auth, provider, authType, _getCurrentUrl(), eventId);",
    );
  });

  it("_getRedirectUrl 은 authDomain 이 없으면 falsy 를 돌려주지 않고 던진다", () => {
    expect(popupChunk).toContain("_assert(auth.config.authDomain");
  });

  it("핸들러 URL 은 https://<authDomain>/ 로 시작하는 템플릿이라 빈 문자열이 될 수 없다", () => {
    expect(popupChunk).toContain(
      "return `https://${config.authDomain}/${WIDGET_PATH}`;",
    );
  });

  it("`|| ''` 가 있는 이유: _open 의 url 은 선언상 선택 인자다", () => {
    const dts = readFileSync(
      join(esm2017Dir, "src", "platform_browser", "util", "popup.d.ts"),
      "utf8",
    );
    expect(dts).toContain("url?: string");
  });
});
