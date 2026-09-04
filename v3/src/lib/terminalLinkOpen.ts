/**
 * 터미널(xterm) 안에서 링크를 클릭했을 때 무엇을 하는가 — 티켓 Gebe84T64LVUh1iO1hQR.
 *
 * `new WebLinksAddon()` 을 인자 없이 만들면 라이브러리 **기본 핸들러**가 쓰이는데,
 * 그건 링크를 두 단계로 연다:
 *
 *     const w = window.open();   // ★URL 없이 — about:blank
 *     w.location.href = uri;     // 그 다음에 이동시킨다
 *
 * Electron 에선 이 2단계가 정책을 두 번 빠져나간다. 1단계의 `window.open` 은 URL 이
 * 비어 있어 main 의 `isInternalNavigationUrl` 이 "내부"로 보고 `action:"allow"` 를
 * 주므로 **기본 옵션(800×600, preload 없음) BrowserWindow 가 새로 뜬다** — 사장님이
 * 보신 "새로 뜨는 조그만 창 하나". 2단계의 이동은 그 **새 창**의 webContents 에서
 * 일어나는데, 그 창은 Web 탭 서피스를 등록한 적이 없으므로 `no-tab-target` 으로
 * 판정돼 OS 브라우저(크롬 탭) + "웹을 호스트할 창이 없다" 안내가 뜬다.
 *
 * 그래서 터미널도 앱의 **다른 모든 링크와 같은 한 줄**을 쓴다: 진짜 URL 을 그대로
 * `window.open(url, "_blank")` 에 넘긴다. 그러면 main 의 `setWindowOpenHandler` 가
 * 실제 URL 을 분류하고, owner 는 셸의 webContents 이므로 등록된 Web 탭으로 간다
 * (docs/link-routing-spec.md — "주소창에 쳐서 열리는 것은 클릭해서도 열린다").
 *
 * `noopener` 는 앱의 다른 호출부(WorktreeTab, ModelFactSheet …)와 같은 표기다.
 */
export function openTerminalLink(_event: MouseEvent, uri: string): void {
  window.open(uri, "_blank", "noopener");
}
