/**
 * "이 렌더러는 loopback OAuth 모드인가" 판정의 **단일 소스** (티켓 L1LQjuQhRiW2hIoBkOAs).
 *
 * ★왜 별도 모듈인가 — 게이트가 두 갈래로 갈라져 있었다
 *  - lib/firebase.ts 의 `isPackagedLoopbackAuth` = `!import.meta.env.DEV && …`
 *    → "패키징일 때만 loopback" 으로 보고 dev 에는 popupRedirectResolver 를 달았다.
 *  - AuthProvider.loginWithGoogle 의 게이트 = `electronAPI.auth.googleLoopback` 존재 여부
 *    → DEV 조건이 없다. 즉 **dev 도 이미 loopback 으로 로그인한다**
 *      (같은 파일 주석: "dev 를 signInWithRedirect 로 태웠더니 Electron/Chromium 에서
 *       조용히 실패 — CDP 트레이스로 확인" ).
 *
 * 결과적으로 Electron dev 는 "로그인은 loopback 으로 하는데 Auth 초기화는 redirect
 * 모드" 라는 어긋난 상태였다. 이게 왜 실제 피해인가:
 *
 *   initializeAuth 에 popupRedirectResolver 를 주면 firebase 는 부팅 시
 *   AuthImpl.initializeCurrentUser 안에서
 *       if (popupRedirectResolver && this.config.authDomain) { … await this.tryRedirectSignIn(…) }
 *   를 **await 한다** (@firebase/auth 10.14.1, browser-cjs/index-*.js:2680-2684).
 *   tryRedirectSignIn → _completeRedirectFn → _openIframe → authDomain 의
 *   `__/auth/iframe` 을 띄우고 gapi 핸드셰이크를 기다린다(같은 파일 9905, 10177).
 *   즉 **저장된 로그인 세션을 읽는 일 자체가 그 iframe 핸드셰이크 뒤로 밀린다.**
 *   Electron 에서 이 핸드셰이크가 막힌다는 건 이 저장소가 이미 두 번 실측한
 *   사실이다(티켓 Oq63rrnxMYv6fdeNeani, KVId8CCsu8pXYGhRGtz3). 그 사이
 *   AuthProvider 는 AUTH_INIT_TIMEOUT_MS(10s)에 포기하고 로그인 화면을 그린다 —
 *   localStorage 에 멀쩡한 firebase:authUser 가 있는데도.
 *
 * dev 는 loopback(signInWithCredential)만 쓰므로 resolver 도 getRedirectResult 도
 * 필요 없다. 그래서 게이트를 이 한 곳으로 합쳐 dev/패키징이 같은 길을 타게 한다.
 * 브라우저(웹)에는 electronAPI 자체가 없으므로 기존 redirect 흐름 그대로다.
 */

/**
 * Electron preload 브리지의 loopback OAuth 채널이 살아있는가.
 * dev·패키징을 구분하지 않는다 — 구분이 바로 위 주석의 버그였다.
 */
export function isElectronLoopbackAuth(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.electronAPI?.auth?.googleLoopback === "function"
  );
}
