---
title: 데스크톱 루프와 클라우드 루프는 다르다
tags: [domain/foundations, topic/electron, topic/agents, topic/bigquery, method/source-link]
status: active
date: 2026-08-26
links: [[overview]], [[glossary]], [[progress]], [[telemetry-identity-axes]]
---

# 아키텍처

> **한 줄 판정**: ★채택 — 에이전트 런타임은 Electron 메인 한 프로세스의 로컬 루프(PTY + localhost HTTP + stdio MCP)이고, 결제·텔레메트리·웹은 Functions / Firestore / BigQuery / marblo-web 루프다. 2026-06-19 원본이 "외부 의존은 Firestore 하나"라고 쓴 문장은 **데스크톱 통신 루프에만** 맞다.

## 무엇을 물었나

메인 · 렌더러 · MCP · Firestore · Functions · BigQuery · marblo-web 이 각자 무엇을 맡고 어디서 닿는가.

## 무엇을 했나

현재 소스 경로로 책임을 갈랐다. 2026-06-19 통신 문서는 데스크톱 허브의 근거이고, 결제·BQ·웹은 그 이후에 커진 면이다. 다이어그램이 본문이다.

## 결과 (수치)

| 면 | 프로세스 | 역할 |
| --- | ---: | --- |
| 데스크톱 허브 | 1 (Electron 메인) | spawn, PTY, bridge HTTP, IPC |
| 에이전트 | N (node-pty CLI) | 코드 작업. 보드를 직접 모름 |
| MCP | 에이전트당 1 (stdio → `dist-mcp`) | 툴 호출을 localhost HTTP 로 변환 |
| 클라우드 쓰기 | Functions | 결제, 텔레메트리 적재, 어드민 조회 |
| 분석 창고 | BigQuery | events / cost_logs / 설치 프로필. 런타임 루프 아님 |
| 웹 | marblo-web | 마케팅·체크아웃·강의·어드민. 데스크톱 아님 |

표본: 통신 문서 1장(2026-06-19) + 현재 소스. 재현 단위는 프로세스 경계.

## 데스크톱 루프

```
┌──────── Electron 메인 (허브) ────────┐
│  bridge-server  127.0.0.1:<port>     │
│  AgentManager / PtyManager           │
│  OrchestratorManager                 │
│  ipcMain.handle ← 렌더러             │
└───────────┬───────────┬──────────────┘
            │ HTTP      │ PTY
            ▼           ▼
     dist-mcp (stdio)   에이전트 CLI
            │
            └── Firestore (영속·크로스머신 우편함)
```

- 에이전트는 컨테이너가 아니다. 로컬 CLI다.
- MCP 는 소스(`mcp-server/*.ts`)가 아니라 **`dist-mcp/*.js`** 가 실행된다. 고치면 `build:mcp` 없이 반영되지 않는다.
- 렌더러는 UI. 긴 작업·스폰·워크트리는 메인 IPC.

## 클라우드 · 웹 루프

```
marblo-web ──콜러블──► Functions ──insert──► BigQuery
                 │
                 └──► Firestore ◄── Electron (태스크·에이전트·구독 투영)
```

| 조각 | 책임 | 닿는 곳 |
| --- | --- | --- |
| Electron 메인 | 런타임 허브 | 렌더러 IPC, MCP HTTP, Firestore |
| 렌더러 | 화면 | preload → `ipcMain.handle` |
| MCP 서버 | 에이전트 툴 표면 | bridge localhost |
| Firestore | 공유 진실원 + 기기 간 큐 | 메인, Functions, 웹 규칙 |
| Functions | 결제·자격·텔레메트리·어드민 쿼리 | Firestore, BigQuery, PG |
| BigQuery | 분석 창고 | Functions 가 쓴다. 에이전트는 직접 안 본다 |
| marblo-web | 사이트·결제창·강의 | Functions 콜러블, Firestore |

## 왜

데스크톱은 사장님 머신에서 CLI 를 붙여야 해서 로컬 PTY 가 맞다. 결제와 집계는 클라에 비밀키를 둘 수 없어 Functions 로 간다. 같은 "마블로"라도 프로세스가 다르면 식별자·권한이 다르다 — [[glossary]] · [[telemetry-identity-axes]].

## 한계 / 정직성

- 2026-06-19 문서는 렌더러·Functions·BQ·marblo-web 을 한 장에 그리지 않았다. **그 문장을 전체 시스템 한 줄로 읽지 마라.**
- 오케·스폰·워크트리·보드 운영 순서는 이 노트의 범위가 아니다. 시스템 플로우 노트(다른 슬롯)가 맡는다.
- **갈리면 코드가 옳다.** 통신 문서는 근거이지 현재 전체도가 아니다.

## 실제 영향

무변경. 새 기능을 "웹에 넣을지 메인에 넣을지"는 이 표로 가른다. GUI 로 이 다이어그램을 검증하지 않는다.

## Evidence

- [v3/docs/COMMUNICATION-ARCHITECTURE.md](../../../v3/docs/COMMUNICATION-ARCHITECTURE.md)
- [v3/electron/bridge-server.ts](../../../v3/electron/bridge-server.ts)
- [v3/electron/worktree-ipc.ts](../../../v3/electron/worktree-ipc.ts)
- [v3/functions/src/index.ts](../../../v3/functions/src/index.ts)
- [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts)
- [docs/supported-harnesses-and-architecture.md](../../supported-harnesses-and-architecture.md)

## Backlinks

- [[overview]] · [[glossary]] · [[progress]] · [[telemetry-identity-axes]]
- [[electron-power-switches-are-layer-scoped]] — main 프로세스 루프를 절전·스로틀 스위치가 지켜주지 않는 층 경계
- [[notification-needs-a-recipient]] — 이 허브의 알림 배달 층: 대상 오케 풀이 비면 라우팅은 폐기가 된다
