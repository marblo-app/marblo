---
title: 라이브 GUI 검증 금지
tags: [domain/constraints, topic/verification, topic/electron, topic/agents, verdict/adopt, method/vitest]
status: verified
date: 2026-08-24
links: [[empty-query-first]], [[do-not-retry]]
---

# 라이브 GUI 검증 금지

> **한 줄 판정**: ★채택 — 사장님이 이 저장소의 앱을 쓰는 동안 에이전트가 Electron/브라우저 창을 띄우면 제품이 아니라 **방해**다. 2026-08-24 실측 1회("계속 열렸다 끄는 게 뭐냐"), 오케가 돌리던 `playwright test` 를 강제 종료했다.

## 무엇을 물었나

UI를 바꿨으면 브라우저로 확인해야 하는가. 예외는 언제인가.

## 무엇을 했나

당일 사고를 `AGENTS.md` 필수 규칙으로 고정한 원문을 읽었다. 위키는 그 규칙을 요약하고 기각 원장(WebContentsView · webviewTag)과 잇는다. 원문 `AGENTS.md` 는 한 글자도 이 노트를 위해 바꾸지 않았다.

## 결과 (수치)

| 지표 | 값 |
| --- | --- |
| 실측 사고 | 2026-08-24 1회 |
| 사용자 반응 | 창이 반복해 열렸다 꺼짐 |
| 강제 종료 대상 | `playwright test` (`launchMarblo`, `electron.launch`) |
| 허용 증명 | `vitest` 단위·렌더 (창 없음) |
| 실화면 기본값 | "지금은 아니다" — `ask_orchestrator` 로만 잡는다 |

표본 n=1 사고 + 규범 1파일. 통계가 아니라 **운영 제약**이다.

## 왜

에이전트 검증 수명은 초~분이고, 사장님 작업 세션은 그 창을 점유한 채다. 헤드리스가 아닌 Electron 런처는 같은 앱 인스턴스/프로필을 건드려 포커스를 뺏는다. 빈 화면을 보고 "기능이 없다"고 읽으면 [[empty-query-first]] 와 같은 오진이다.

## 한계 / 정직성

- n=1. 다른 OS/패키징에서의 재현 횟수는 없다.
- 금지 대상은 **창을 띄우는** 검증이다. vitest 렌더·순수 함수·타입체크는 허용.
- WebContentsView / webviewTag 재활성화는 이 제약과 같은 간섭 축이라 [[do-not-retry]] 에 넣었다. 코드 검색 0건 — 트리에 구현이 없다는 것이 근거고, 설계 문서 부재는 한계다.
- **수치가 갈리면 원본 `AGENTS.md` 가 옳다.**

## 실제 영향

`AGENTS.md` 에 이미 반영됨. 이 노트는 무변경. 에이전트는 playwright Electron 스펙을 돌려 이 규칙을 검증하지 않는다.

## Evidence

- [AGENTS.md](../../../AGENTS.md) — `★GUI 를 띄우는 검증 금지`
- [[do-not-retry]] DNR-02 · DNR-03

## Backlinks

- [[empty-query-first]] · [[do-not-retry]] · [[overview]] · [[progress]] · [[verify-without-gui]] · [[human-only-ops-backlog]] · [[functions-deploy-env-and-bq-views]] · [[in-app-link-routing]] · [[wiring-proven-on-screen]]
- [[electron-power-switches-are-layer-scoped]] — 화면 대신 `pmset -g assertions` 로 OS 에 되물어 확인한 사례
- [[notification-needs-a-recipient]] — 배달 폴백을 GUI 없이 유닛 테스트로 증명한 사례
