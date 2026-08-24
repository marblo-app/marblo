/**
 * ANSI 정규화의 **재수출 껍데기**. 구현은 `electron/ansi.ts` 로 옮겼다.
 *
 * 왜 옮겼나(티켓 RtyOMpOArfI7a5JNSzsg): 답 주입 직전의 컴포저 판정이 **메인
 * 프로세스**(`PtyManager`)에서 돌아야 하는데, `electron/tsconfig.json` 의
 * `rootDir: "."` 때문에 메인은 `src/` 를 import 할 수 없다(반대 방향은 vite 가
 * 번들하므로 된다 — `src/lib/stuckLane.ts` → `electron/agent-stall-policy`,
 * `src/lib/gitUrlSafety.ts` → `electron/git-url-safety` 가 이미 그 경로다).
 * 그래서 렌더러·메인이 **같은** 정규화를 쓰려면 구현이 `electron/` 에 있어야 한다.
 * 복제하지 않는 것이 핵심이다 — 줄 분류기가 둘로 갈리면 화면을 다르게 읽는다.
 *
 * 기존 import 경로(`@/lib/ansi`, `../../lib/ansi`)는 전부 그대로 산다.
 */
export { stripAnsi, normalizeLine } from "../../electron/ansi";
