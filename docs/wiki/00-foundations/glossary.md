---
title: 같은 말이 다른 객체를 가리킨다
tags: [domain/foundations, topic/identity, topic/agents, method/source-link]
status: active
date: 2026-09-04
links: [[2026-kpi-targets]], [[overview]], [[architecture]], [[progress]], [[telemetry-identity-axes]], [[counting-unit-first]], [[do-not-retry]], [[telemetry-data-model-map]]
---

# 글로서리 — 혼동 쌍

> **한 줄 판정**: ★채택 — 이 저장소에서 같은 말이 다른 객체를 가리키는 쌍이 **24개**다. 토스페이≠토스페이먼츠, `userId`≠`userId`, 설치≠사람, 돌고 있는 미션≠implicit 라벨. 글로서리 한 줄이 없으면 PG 를 하나 더 붙이자는 틀린 조언이 나오고, 0건인 폐루프가 3건으로 보인다.

## 무엇을 물었나

에이전트·오케가 같은 단어로 다른 것을 집었을 때, 무엇을 짝으로 두고 어떻게 가르는가.

## 무엇을 했나

티켓이 준 7쌍을 코드·원본으로 확인하고, 같은 패턴의 쌍을 저장소에서 더 찾았다. 확인 못 한 운영 사실(토스페이먼츠 계약 해지 완료 여부, "자동결제 반려" 원문)은 추측하지 않았다.

**2026-09-04 개정**: 미션 쌍 2개(18·19)를 추가했다. 이 쌍이 갈리지 않아 화면과 인수인계가 동시에 같은 거짓말을 한 사건이 있었다(PR #1402 진단 · #1407 수정).

## 결과 (수치)

항목 **24**. 근거는 상대경로 링크. 표본: 이 워크트리 2026-08-26 소스 + 2026-09-04 미션 실측. 재현 단위는 파일이지 인터뷰가 아니다.

구분 규칙: **짝을 먼저 적고, 가르는 키(컬럼·채널·프로세스)를 적는다.**

### 결제

| # | 말 | 이쪽 | 혼동되는 짝 | 가르는 키 |
| --- | --- | --- | --- | --- |
| 1 | **토스페이** | 간편결제 지갑. PortOne 채널 `TOSSPAY`. 가맹점 심사 대상 | **토스페이먼츠** — PG 직결 `api.tosspayments.com` | 지갑 vs PG. "PG 하나 더"는 토스페이를 토스페이먼츠로 읽은 것 |
| 2 | **단건** | `onetime` 채널키. 강의 구매 | **정기** — `billing` 채널키. 요금제 구독 | `PORTONE_*_ONETIME_*` vs `PORTONE_*_BILLING_*` |
| 3 | **강의 단건** | `lecturePurchases` + `oneTimeEntitlements`. 구독을 열지 않음 | **요금제 구독** — 빌링키 경로만 `subscriptions` 를 연다 | 단건 완료가 구독을 active 로 쓰던 버그가 있었다 |
| 4 | **PortOne** | 지금 체크아웃 기본 PG | **토스페이먼츠** — 진입 닫힘. URL `?provider=toss` 로 못 되돌림 | 기본값 `portone`. 롤백은 env + `TOSS_ENTRY_ENABLED` 둘 다 |
| 5 | **Paddle** | 해외/USD 구독 | **PortOne** — 국내/KRW | `paymentProvider` 값 `paddle` vs `portone`/`toss` |

토스페이 가맹점 **3차 반려**는 환불 문구 회귀 테스트로 남아 있다. 티켓의 "자동결제 반려"·"토스페이먼츠 계약 취소"는 **이 워크트리에서 완료 여부를 확인 못 했다.** 해지 절차는 정리 체크리스트에만 있다.

### 사람 · 설치

| # | 말 | 이쪽 | 혼동되는 짝 | 가르는 키 |
| --- | --- | --- | --- | --- |
| 6 | **`events.userId`** | 설치 clientId, 보통 36자 | **`cost_logs.userId`** — Firebase uid 28자 | `canJoinUserId('events','cost_logs') === false` |
| 7 | **설치** | `install_key` 1행. 2026-08-25 총행 **675** | **사용자** — 로그인 계정 | 설치 행을 "명"으로 읽지 마라 |
| 8 | **브라우저** | `ga_key` / `gaClientId` | **설치** | 2026-08-24: 어트리뷰션 631행의 고유 브라우저 **5**. 675와 5는 **날짜가 다른 측정**이라 한 문장으로 묶지 않는다 |
| 9 | **`analytics_identity`** | 익명축 (install / ga) | **`analytics_user_install`** — 사람 축 링크 표 **하나뿐** | `user_key` 로 identity 에 직접 조인하지 마라 |

### 런타임

| # | 말 | 이쪽 | 혼동되는 짝 | 가르는 키 |
| --- | --- | --- | --- | --- |
| 10 | **봇** | `BotDefinition` — 페르소나·미션·모델·롤 템플릿 | **에이전트** — 그 정의로 뜬 PTY 인스턴스 | 컬렉션 정의 vs spawn 된 CLI |
| 11 | **오케** | 팀 리더 세션. 자체도 CLI+PTY | **하네스** — 스폰할 바이너리 (`claude`/`codex`/`grok`/`agy`) | 세션 ≠ 바이너리 ≠ 모델 |
| 12 | **모델** | 레지스트리 행 (id·단가·provider) | **하네스** | GLM 은 하네스가 아니라 `claude` + env-swap **벤더** |
| 13 | **프로바이더** | 토큰이 가는 백엔드 | **하네스** | `harness !== provider`. 축을 합치면 GLM 을 네이티브 CLI 로 착각한다 |
| 14 | **`gpt` 축** | 저장된 모델 타입 리터럴 | **`codex` 바이너리** | `gpt` CLI 는 없다. 스폰은 Codex |
| 15 | **alias** (`opus`) | CLI 가 해석하는 이동표적 | **구체 id** (`claude-opus-5`) | 핀은 구체 id. alias 는 폴백만 |

### 제품 표면

| # | 말 | 이쪽 | 혼동되는 짝 | 가르는 키 |
| --- | --- | --- | --- | --- |
| 16 | **퀵레인** | 오케 없이 독립 워크트리에서 작은 병렬 작업 | **미션** — 템플릿 자동화. 강의 "학습 미션" 아님 | 한 탭에 섹션이 둘. 정리 중 |
| 17 | **레인 (옛)** | 에이전트 관찰 작업대라는 강의 의미 | **퀵레인** | 관찰은 왼쪽 PTY. 탭 라벨은 퀵레인 |
| 18 | **돌고 있는 미션** | `steps` 를 가진 실행 계획. 엔진이 픽업해 지휘자가 운전한다 | **implicit 라벨** — 실행 계획이 아니라 완료 작업 묶음에 붙인 Replay 이름. `steps: []` | `missionKind`. `wire.ts` 의 `isImplicitMission` 가드가 라벨을 픽업에서 뺀다. 라벨을 쓰는 화면은 완료이력의 Mission Replay |
| 19 | **`status: "active"`** | 미션 doc 의 상태값. **implicit 라벨도 이 값으로 만들어진다** | **"돌고 있는"** — 실행 가능(비-implicit) + 비종료 | 상태값만 세면 라벨이 섞인다. `isRunnableMission` 하나로 센다 |
| 20 | **하네스 탭** | CLI·채널·env-swap **연결** | **스토어 탭** — 스킬·MCP 카탈로그 | 2026-08 강의 감사: 스토어로 이동됨 |
| 21 | **워크트리** | 태스크당 격리 워킹카피 | **프로젝트 폴더** — 공유 cwd | 공유 카피에 에이전트 2개면 파일을 밟는다 |
| 22 | **위키 노트** | `docs/wiki` 판정 한 장 | **원본** (`v3/docs`, `docs/lectures`) | 복사 금지. 갈리면 원본 |

★**18 과 19 를 같은 자리에 같은 모양으로 두지 않는다.** 라벨을 실행 중인 미션 옆에 같은 배지로 놓으면 0건이 3건으로 읽힌다. 2026-09-04 실측: 미션 문서 24건(active 3 / completed 21) 가운데 **active 3건이 전부 implicit·`steps: []`** 이라 운전할 대상은 0건인데, 레인 탭은 "Active · 0%" 카드 3장을, 인수인계 스냅샷은 새 오케에게 `3 active mission(s)` 를 내놨다 — 사장님의 관찰은 "폐루프가 안 도는 것 같다"였다.

**세는 곳이 여럿이면 정의를 한 곳에 모은다.** 이때 세는 곳이 넷(레인 탭·미션 탭·인수인계 스냅샷·오케 패널)이었고 넷의 정의가 각자 달랐다 — 미션 탭만 라벨을 걸렀고 나머지 셋은 안 걸렀다. 정의를 `missionVisibility.ts` 한 곳으로 모으고 나머지가 그것을 부른다.

### 데이터 면

| # | 말 | 이쪽 | 혼동되는 짝 | 가르는 키 |
| --- | --- | --- | --- | --- |
| 23 | **Firestore** | 런타임 진실원 (태스크·구독) | **BigQuery** — 분석 창고 | 에이전트는 BQ 를 직접 안 본다 |
| 24 | **Electron 앱** | 데스크톱 control plane | **marblo-web** — 사이트·체크아웃·강의 | 같은 Firebase 프로젝트여도 프로세스가 다르다 |

최소 15. 결제한 것은 24.

## 왜

이름이 같으면 조인·조언·UI가 컴파일된다. 객체는 다르다. 토스페이(지갑)를 토스페이먼츠(PG)로 읽으면 "PG 를 하나 더"가 되고, `userId` 를 이으면 빈 집합이 사람이 된다. 미션 쌍은 한 걸음 더 간다 — 라벨을 미션으로 읽으면 **아무것도 안 돌고 있다는 사실 자체가 화면에서 사라진다.** 틀린 조언보다 나쁜 것은 물어볼 생각이 안 드는 화면이다.

## 한계 / 정직성

- 운영 상태(계약 해지 완료, 심사 현재 라운드)는 보드·사장님이 정본. 여기는 코드가 가리키는 객체만.
- implicit 라벨 3건이 **왜 아직 `active` 로 남아 있는지**(닫는 경로가 없는지, 조건 미충족인지)는 확인하지 않았다. 이 노트가 가르는 것은 두 객체이지, 라벨의 수명이 아니다.
- 675와 5는 측정일이 다르다. [[counting-unit-first]].
- **갈리면 링크된 원본이 옳다.**

## 실제 영향

코드 변경 있음 — 미션 쌍(18·19)은 PR #1407 로 `missionVisibility.ts` 에 규칙으로 박혔고, 레인 탭·미션 탭·인수인계 스냅샷이 그것을 부른다. 나머지 22쌍은 무변경. 새 노트·조언·쿼리는 이 표의 짝을 먼저 고른다.

## Evidence

- [docs/payment/toss-teardown-prerequisites.md](../../payment/toss-teardown-prerequisites.md)
- [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) — 채널키·단건이 구독을 안 염
- [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts)
- [marblo-web/src/app/[locale]/legal/refundPolicy.test.ts](../../../marblo-web/src/app/[locale]/legal/refundPolicy.test.ts)
- [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts)
- [v3/docs/activation-metric-repair-2026-08-24.md](../../../v3/docs/activation-metric-repair-2026-08-24.md)
- [v3/docs/chart-data-integrity-2026-08-25.md](../../../v3/docs/chart-data-integrity-2026-08-25.md)
- [v3/functions/src/analyticsUserKey.ts](../../../v3/functions/src/analyticsUserKey.ts)
- [v3/src/lib/botDefinition.ts](../../../v3/src/lib/botDefinition.ts)
- [v3/electron/model-registry.ts](../../../v3/electron/model-registry.ts)
- [docs/supported-harnesses-and-architecture.md](../../supported-harnesses-and-architecture.md)
- [v3/src/locales/ko/lanes.ts](../../../v3/src/locales/ko/lanes.ts)
- [v3/src/types/mission.ts](../../../v3/src/types/mission.ts) — `missionKind` · `isImplicitMission`
- [v3/src/lib/missionVisibility.ts](../../../v3/src/lib/missionVisibility.ts) — "돌고 있는"의 단일 정의
- [v3/electron/mission-engine/wire.ts](../../../v3/electron/mission-engine/wire.ts) — 픽업에서 라벨을 빼는 가드
- [v3/electron/mcp-server/implicit-mission.ts](../../../v3/electron/mcp-server/implicit-mission.ts) — 라벨을 `status: "active"` · `steps: []` 로 만든다
- [v3/electron/orchestrator-handoff.ts](../../../v3/electron/orchestrator-handoff.ts) — 인수인계 `activeMissions` 집계
- [v3/src/components/lanes/LanesTab.tsx](../../../v3/src/components/lanes/LanesTab.tsx) — 라벨을 접힌 별도 그룹으로 분리
- [v3/src/locales/ko/harness.ts](../../../v3/src/locales/ko/harness.ts)
- [docs/lectures/v3/AUDIT-2026-08.md](../../lectures/v3/AUDIT-2026-08.md)
- [v3/electron/worktree-ipc.ts](../../../v3/electron/worktree-ipc.ts)
- [v3/docs/COMMUNICATION-ARCHITECTURE.md](../../../v3/docs/COMMUNICATION-ARCHITECTURE.md)

## Backlinks

- [[2026-kpi-targets]] — Qualified·Activated·Retained 의 확정 정의
- [[overview]] · [[architecture]] · [[progress]] · [[telemetry-identity-axes]] · [[counting-unit-first]]
- [[telemetry-data-model-map]] — 표별 키 형식(27자 가명 / 36자 설치 / 28자 uid)과 연결고리
