---
title: 로그인 세션에 자동 행동을 붙이려면 승인 계층이 먼저다
tags: [domain/constraints, topic/privacy, topic/electron, topic/agents, kind/knowledge]
status: verified
date: 2026-09-05
links: [[in-app-link-routing]], [[no-live-gui-verify]]
---

## 지금 무엇이 참인가

우리에게 없는 건 브라우저가 아니라 **승인 계층**이다. 인앱 웹탭은
`persist:marblo-browser-tab` 파티션을 쓰므로 쿠키와 localStorage가 앱을 다시 켜도 남는다.
즉 사장님이 구글·노션·대시보드에 로그인한 실제 세션이 웹탭 표면에 살아 있다. 여기에
AI의 자동 행동을 연결하면 로그인된 계정으로 돈을 쓰고, 글을 올리고, 메시지를 보내고,
데이터를 지우거나 권한을 바꿀 수 있다. 이것은 브라우저 기능의 문제가 아니라 세션 권한을
누가 어떤 조건에서 행사할 수 있는가의 문제다.

| 층          | 지금 있는 것                                                               | 비어 있는 것                                        |
| ----------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| 세션        | `WebContentsView` 웹탭과 디스크에 남는 `persist:marblo-browser-tab` 파티션 | 태스크별 세션 격리·incognito 경계                   |
| 관찰        | 별도 헤드리스 자동화 자산과 공개 페이지용 `playwright` MCP                 | 로그인된 인앱 웹탭의 텍스트·접근성 트리 관찰 경로   |
| 행동        | 웹탭의 이동·새로고침·bounds 같은 표면 관리 API                             | 페이지 클릭·입력·폼 제출을 실행하는 API와 실패 처리 |
| 권한        | 라우팅의 `allow`/`external`/`deny` 분류, 에이전트의 YOLO 실행              | 관찰·이동·쓰기·지불·삭제를 나누는 승인 게이트       |
| 데이터 경계 | 브라우저 세션 유출 가드와 값 마스킹, 사람에게 묻는 handoff 배관            | 브라우저 행동 단위 감사 원장과 전역 중지·스텝 상한  |

따라서 현재 웹탭은 **보여주고 이동시키는 표면**이지, 로그인 세션을 에이전트에게
넘겨 다루게 하는 자동화 표면이 아니다. Aside의 공식 권한 모델이 `Read only`·`Guard`·
`Full access` 세션 모드와 `Allow`·`Ask`·`Deny` 규칙을 따로 두는 것은 이 가운데 비어
있는 층을 드러내는 비교 사례다. 그 모델을 복사한다고 해서 우리 세션이 안전해지는 것은
아니다. 우리 쪽 승인 계층이 먼저 있어야 한다.

## 멈추는 조건

- `persist:marblo-browser-tab`를 그대로 자동화 세션으로 재사용하지 않는다. 읽기든 쓰기든
  사장님의 실제 로그인 상태가 LLM과 행동 루프에 들어가는 순간 별도의 데이터 경계가
  필요하다.
- 페이지 읽기는 origin allowlist, 원문 마스킹, 프롬프트 스냅샷 유출 가드, untrusted
  external content 봉인을 모두 통과해야 한다. 읽기도 로그인 데이터의 반출이므로 공짜가
  아니다.
- 클릭·입력·폼 제출은 건별 승인 없이는 실행하지 않는다. 결제·게시·전송·삭제·권한 변경과
  인증 화면은 항상 사람 승인 또는 에이전트 진입 금지다. `kill_agent`만으로는 이미
  WebContentsView에서 진행 중인 행동을 멈출 수 없다.
- 승인 게이트·태스크별 세션 격리·전역 킬 스위치·스텝 상한·행동 감사 원장이 없는 동안
  Aside 같은 자율 브라우징을 제품 경로로 켜지 않는다. 로그인 뒤 콘솔을 확인할 필요가
  생기면 먼저 별도 헤드리스 세션의 읽기 전용 도구로 좁힌다.

## 확인 방법

1. `in-app-browser-policy.ts`와 `main.ts`에서 `persist:marblo-browser-tab`이 웹탭에
   주입되는지 확인한다. 인증·결제 라우팅은 자동화에도 같은 경계를 적용해야 한다.
2. `preload.ts`와 main IPC 표면에 페이지 관찰·행동 API가 있는지 확인한다. 현재 표면에는
   읽기·클릭 실행기가 없으므로 이를 추가했다고 자동 브라우징이 완성된 것으로 읽지 않는다.
3. `bridge-server.ts`의 YOLO 권한과 `danger-command.ts`의 PTY 문자열 방어가 브라우저
   행동까지 보호하는지 따로 확인한다. 문자열 방어만으로는 클릭·입력 승인을 증명할 수 없다.
4. 유출 가드와 순수 정책 함수는 vitest·정적 분석으로 검증한다. 사장님이 앱을 쓰는 동안
   Electron 창이나 브라우저를 띄우지 않는다.

## Evidence

- [Aside 자동 브라우징 현재 상태 조사](../../../v3/docs/aside-browser-agent-feasibility-2026-09-05.md) — 공식 자료와 Marblo 현재 경계의 근거 정리
- [인앱 브라우저 정책](../../../v3/electron/in-app-browser-policy.ts) — 세션 파티션과 인증·결제 라우팅
- [웹탭 생성·IPC 구현](../../../v3/electron/main.ts) — `WebContentsView` 표면과 pane 배선
- [웹탭 preload API](../../../v3/electron/preload.ts) — 렌더러에 노출된 웹탭 조작 표면
- [에이전트 YOLO 실행 경로](../../../v3/electron/bridge-server.ts) — 승인 없는 기본 실행
- [PTY 위험 명령 방어](../../../v3/electron/danger-command.ts) — 브라우저 행동에 닿지 않는 현재 방어 범위
- [브라우저 세션 유출 가드](../../../v3/electron/web-automation/leakage-guards.ts) — 프롬프트·로그·IPC 경계
- [라이브 GUI 검증 금지](../../../AGENTS.md) — 창을 띄우지 않는 검증 제약
- [Aside 권한 문서](https://docs.aside.com/help/security) · [Aside 개발자/MCP 문서](https://docs.aside.com/help/developers) — 비교 사례의 1차 자료

## Backlinks

- [[in-app-link-routing]]
- [[no-live-gui-verify]]
