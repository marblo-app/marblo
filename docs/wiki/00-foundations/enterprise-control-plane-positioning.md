---
title: B2B 분석 정본 — Enterprise AI Agent Engineering Control Plane 과 성공 정의 객관화
tags: [domain/foundations, topic/agents, topic/observability, topic/kpi, status/normative]
status: active
date: 2026-08-31
links: [[overview]], [[telemetry-data-model-map]], [[counting-unit-first]], [[ci-empty-steps-is-billing]]
---

# B2B 분석 정본 — Enterprise AI Agent Engineering Control Plane 과 성공 정의 객관화

> **한 줄 판정**: ★채택(사장님 확정 2026-08-31) — 마블로 B2B 분석은 "AI 비용 분석 대시보드"가 아니라 **Enterprise AI Agent Engineering Control Plane** 으로 판다. 핵심 지표는 **Cost per Successful Task = #1334 의 "머지 티켓당 사용량 환산 비용(추정)" — 같은 것, 이름 하나로 통일**. 성공은 에이전트 자기보고가 아니라 객관 신호로 잡는다: 사장님이 요구한 신호 8개 중 **지금 가진 것 5**(PR merge · retriesCount · 사람 승인 · outcomeMode · errorCategory), **없는 것 5**(test pass · CI pass · acceptance criteria · rollback · human intervention). 합성은 가중 점수도 계단식도 아니라 **나란히 + 층화 표**(#1334 판정 유지 — 충돌 없음).

## 무엇을 물었나

2026-08-31 사장님 지시: _"이거 설계도 아예 문서로 정리한번 하고 갈래? 위키 문서로 설계하고 이어서 가자."_ 하루에 나온 설계 4건(#1333 로드맵·조직 URL, #1334 지표·화면, #1335 방침 문안, #1336 4층·팀 라벨)을 정본 한 장으로 묶고, 그 위에 사장님 포지셔닝 전략·성공 정의 객관화를 얹으면 **무엇이 바뀌는가**.

## 무엇을 했나

원본 4건을 정독하고(무수정), 사장님 전략의 두 주장 — "사슬이 제품 안에서 이어진다" 와 "성공 신호를 합쳐야 한다" — 을 코드와 대조했다. 경쟁 제품 서술은 검증하지 않았고 인용으로만 표시했다.

## 결과

### 1. 포지셔닝 — 사장님 전략을 정본으로

사장님 원문 요지(2026-08-31, 인용):

> "AI 비용 분석 대시보드"로 설명하면 안 된다. Langfuse 는 모델·사용자·유스케이스별 비용과 품질을, LangSmith 는 trace 별 비용·토큰·tool error·evaluation 을 이미 제공한다 — LLM observability 와 cost tracking 은 빠르게 기본 기능화되고 있다. 마블로는 **Enterprise AI Agent Engineering Control Plane** 으로 가야 한다: 누가 어떤 AI 에이전트에게 어떤 일을 시켰고 → 어떤 모델과 비용으로 수행했고 → 실제로 성공했는지 → 어떤 코드가 변경됐고 → 누가 승인했는지까지.

★위 문단의 Langfuse·LangSmith 기능 서술은 **사장님 서술의 인용이며 이 노트가 검증하지 않았다(확인 필요).** "그들은 못 한다" 는 주장은 이 위키 어디에도 근거 없이 적지 않는다 — 우리의 차별화 논거는 경쟁사의 부재가 아니라 **아래 사슬이 우리 제품 안에 있다는 사실**이다.

이 포지셔닝은 새 것이 아니라 기존 SSoT [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md)("Marblo is the control plane for AI-native software teams" · 실행기는 commodity, 해자는 추적·결정 레이어)의 **enterprise/B2B 분석 표면으로의 연장**이다. 원장은 읽기 전용이라 고치지 않고, 이 노트가 B2B 분석 문맥의 정본이 된다.

**"사슬이 제품 안에서 이어진다" 는 코드로 뒷받침되는가** — 조각별로 대조했다:

| 사슬 고리      | 코드 실체                                                                                                                             | 지금 상태                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Project → Task | Firestore `tasks.projectId`                                                                                                           | ✅                                                                   |
| Task → Agent   | `tasks.claimedBy` · `cost_logs.agentId` · `task_outcomes.role`                                                                        | ✅ (개체 축은 화면에 안 냄 — #1333 §4.4)                             |
| → Model        | `task_outcomes.model` · `cost_logs` 모델 컬럼                                                                                         | ✅                                                                   |
| → Execution    | 원장 `project_event_ledger`(툴 호출·`worktreeId`)                                                                                     | ✅ MCP 경유 작업만                                                   |
| → Artifact     | `merge_history`(diff 규모·`prNumber`·브랜치) — `v3/electron/main.ts:4089` `recordMergeHistory` · `v3/functions/src/index.ts:801` 웹훅 | ⚠️ 캡처 경로 2 중 웹훅은 현재 미가동(아래 한계)                      |
| → Result       | `task_outcomes.success`(자기보고) + BQ `events.task:merged`(머지 라벨)                                                                | ⚠️ 머지 라벨 행수 미실측(#1334 이 첫 구현 티켓의 확인 항목으로 지정) |
| → Cost         | `task_outcomes.totalCost` · `cost_logs`                                                                                               | ✅                                                                   |
| → Human        | 원장 `merge_and_close` actor(`v3/electron/mcp-server/merge-closeout.ts`) · `merge_history.mode(manual/auto)`                          | ✅ 부분 — `merge_history` 에 행위자 필드 없음(#1334 §1.1)            |

판정: **조각은 전부 제품 안에 있다 — 그러나 오늘 "한 줄로 이어진 조회 가능한 사슬"은 아직 아니다.** 세 저장소(Firestore / BQ 계정 축 / BQ 익명 축)로 갈라져 있고, 축 분리는 방침에 의한 설계다([[telemetry-data-model-map]]). 잇는 다리(taskId 가명 조인·프로젝트 가명 매핑·userKey 각인)는 #1333 §5·#1334 §4.3 로드맵이 정의한다. 즉 "자연스럽게 연결**할 수 있다**"(외부 SDK 로 trace 를 받는 제품과 달리 캡처 지점이 전부 우리 것)는 참이고, "연결**돼 있다**"는 아직 아니다.

### 2. ★성공 정의 객관화 — 이 노트에서 가장 중요한 절

사장님 지적(인용): _"에이전트가 '완료했습니다'라고 말한 것을 성공으로 잡으면 데이터 신뢰도가 떨어진다. Test pass · CI pass · PR merge · acceptance criteria 충족 · human approval · rollback 여부 · retry 횟수 · human intervention 을 합쳐 결과를 만들어야 한다."_

우리가 실제로 가진 신호의 대조표 — **있는 척하지 않는다**:

| 신호                     |  있나   | 실체 / 얻는 시점                                                                                                                                                                         |
| ------------------------ | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR merge                 |   ✅    | `merge_history`(앱 Merge 버튼 + GH Actions 웹훅) · 익명 축 `events.task:merged`. 단 웹훅 경로는 결제 차단으로 현재 미가동(한계 절)                                                       |
| retry 횟수               |   ✅    | `task_outcomes.retriesCount`(`index.ts:8939`) · `tasks.retriesCount` 롤업                                                                                                                |
| human approval           |   ✅    | 원장 `merge_and_close` actor = 사람 승인 · `merge_history.mode(manual/auto)`                                                                                                             |
| outcomeMode              |   ✅    | `task_outcomes.outcomeMode`(`index.ts:8941`)                                                                                                                                             |
| errorCategory            |   ✅    | `task_outcomes.errorCategory`(#1333 §5.2 스키마 실측 19열에 포함)                                                                                                                        |
| test pass                | ❌ 없다 | CONTROL-PLANE §3-④·§8.1 "GitHub 심화 / Full 척추"(베타 후) — #1333 Phase 0~5 밖의 별도 연동 트랙                                                                                         |
| CI pass                  | ❌ 없다 | 같은 Full 척추 트랙 — 그리고 **지금은 신호원 자체가 안 돈다**: GitHub Actions 가 결제 차단으로 최소 5주 정지, Build & Release 성공 0([[ci-empty-steps-is-billing]]). 결제 복구는 사람 일 |
| acceptance criteria 충족 | ❌ 없다 | 티켓 본문에 자유 텍스트 완료 기준은 있으나 구조화·판정 신호 없음. 미계획 — Full 척추의 decision log 위에서 설계할 별건                                                                   |
| rollback 여부            | ❌ 없다 | 머지 후 revert 추적 없음. CONTROL-PLANE §5.2 merge-risk 예측(v4+ routing/evals 단계)의 재료 — 좌표만 있고 설계 없음                                                                      |
| human intervention 횟수  | ❌ 없다 | 원장에 질문·개입 사건은 남지만 지표화 안 됨. 미계획 — 원장 집계로 낼 수 있는 후보, 별건 판정 필요                                                                                        |

### 3. 신호 합성 방식 판정 — #1334 와 충돌하는가: 안 한다

세 후보를 놓고 판정한다. #1334 §8 은 이미 **"모델 종합 점수·자동 추천 제외"** 를 판정했다.

| 방식                                              | 판정 | 근거                                                                                                                                                  |
| ------------------------------------------------- | :--: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 가중 점수(신호들을 한 숫자로)                     |  ✗   | #1334 판정 그대로 — 층화 합산은 심슨 역설, 가중치를 정당화할 표본이 없다(비율 셀당 n≥35 규율, [[counting-unit-first]])                                |
| 계단식(merge 면 성공 → 아니면 CI → 없으면 미판정) |  ✗   | 지금 신호가 머지/완료보고 2개뿐이라 사실상 나란히와 같고, CI 가 생겨도 "CI 통과" 와 "머지됨" 은 다른 뜻의 성공이다 — 한 열에 접으면 라벨이 거짓말한다 |
| ★**나란히 + 층화 표**                             |  ✅  | #1334 §4.2 그대로: 머지율(정본 성공률)·완료 보고율을 **다른 라벨로 나란히**, 복잡도×역할 층화, 셀 n<35 는 `n/35` 표기                                 |

**사장님 문장과의 화해**: 사장님 "합쳐 결과를 만들어야 한다" 의 표적은 **자기보고 단독 사용**이지 "한 숫자로 접어라" 가 아니다. #1334 의 "머지가 분자다" 가 그 요구의 절반(자기보고 대체)을 이미 답했고, 이 노트의 §2 대조표가 나머지 신호의 현황·시점을 답한다. **충돌 없음 — #1334 판정 유지.**

### 4. 핵심 지표는 하나 — Cost per Successful Task

사장님의 **Cost per Successful Task** 와 #1334 §6 의 **"머지 티켓당 사용량 환산 비용(추정)"** 은 같은 것이다(분자 = 기간 비용 전부(실패·재시도 포함), 분모 = 머지된 티켓). **화면 정본 낱말은 #1334 것("머지 티켓당 사용량 환산 비용(추정)"), 영업·포지셔닝 낱말은 Cost per Successful Task** — 이때 Successful = merged 라는 각주를 항상 단다.

사장님 예시(인용 — ★실측이 아니라 가상 수치):

> Claude 성공률 91%·태스크당 $2.80 vs Codex 84%·$1.20. 그런데 단순 문서 수정은 Codex 가 효율적이고, 복잡한 리팩터링은 Claude 성공률이 20%p 높다. → AX 담당자가 처음으로 "우리 회사는 AI 코딩 에이전트를 어디에·어떤 모델로·얼마를 쓰는 것이 가장 효율적인가" 에 답할 수 있게 된다.

이 예시가 보여주는 것이 정확히 #1334 §4 의 층화 규율이다 — 모델 순위는 같은 복잡도 안에서만, 종합 점수 없음.

### 5. 분석 축 7개 × 4층 — 축은 관점, 층은 행

★축 7개는 드릴다운 계층이 아니라 **관점 목록**이다. 층은 #1336 이 확정한 4층(조직 > 팀 > 프로젝트 > 사람) 그대로이고, 층을 7개로 만들지 않는다.

| 축           | 4층 어디에 나타나나                                                          |
| ------------ | ---------------------------------------------------------------------------- |
| Organization | **L0 행 층**(`/org/<orgId>` 카드·합계 행)                                    |
| Team         | **L0 주 표의 그룹 소계 행**(#1336 §5 — 층·라우트 추가 없음, `?team=` 필터)   |
| Project      | **L1 행 층**(`/org/<orgId>/projects/<pid>`)                                  |
| User         | **L2 행 층**(`/org/<orgId>/members/<memberKey>`)                             |
| Task         | **열·상세 목록** — 완료/실패·리드타임·재시도 열, 완료 티켓 목록(L2 하단)     |
| Model        | **열·별도 탭** — L2 주 표의 행(모델×실행자), 모델별 결과 탭(4b/4c 모델 카드) |
| Audit        | **별도 탭** — "활동 기록(원장)", 게이트 밖·금액 없음(#1333 §2)               |

즉 앞 4개 축이 행 계층 그 자체이고, Task·Model 은 각 층 표의 열과 상세이며, Audit 은 층이 아니라 탭이다. #1333 §4.1 의 "L3 은 층이 아니라 L2 표의 열" 판정이 그대로 산다.

### 6. 해자 경로 — 로드맵 끝 좌표와 기존 라우터

**Observe → Analyze → Govern → Optimize → Route** 를 #1333 Phase 위에 좌표로 얹으면: Observe = Phase 0~3(사용량·머지·감사가 보인다) · Analyze = Phase 4b/4c(모델×복잡도 층화 표) · Govern = 권한표·withheld 상시 노출·방침 고지(#1333 §6, Phase 0·2 에 내장) · Optimize = Cost per Successful Task 로 좌석·예산·모델 정책 결정(#1334 각 지표의 "관리자의 결정" 열) · Route = 그 데이터를 모델 자동 할당에 되먹이는 것.

★Route 는 백지가 아니다 — **모델 자동선택이 이미 있다**: `v3/electron/dispatch-scoring.ts` 가 complexity→provider 소프트 라우팅과 rung 선택을 하고, 결정은 `model:tier_resolved`(`v3/electron/telemetry.ts:671`)로 라벨링돼 `task_outcomes` 의 `taskType·taskComplexity·model` 로 떨어진다. 4b 층화 표는 그 자동 결정을 사람이 검증하는 화면이고(#1334 §4.2), Route 단계는 검증된 팀·조직별 머지율×비용 표를 라우터의 사전확률로 되먹이는 일이다 — CONTROL-PLANE §6.3(routing/evals, v4+)과 같은 좌표. **라우터 설계는 이 노트의 범위가 아니다(별건).**

### 7. 차트 규율 한 줄

Recharts 가 이미 있다(`marblo-web` ^3.10.1 · `v3` ^3.8.1, `marblo-web/src/components/charts/` 의 MultiSeriesChart·TimeSeriesChart·primitives·discipline.test.tsx). **새 차트 라이브러리 도입 금지.**

### 8. 뒤집지 않는 것 (#1336 확정 + 사장님 확정)

팀 = **경량 라벨**(`org_teams` + `OrgProjectBinding.teamId`, 멤버십·권한 없음) · 화면 층 추가 없이 L0 주 표 그룹핑 · #1335 방침 문안 무변(팀 라벨은 새 열람자를 안 만든다) · 마이그레이션 0(Phase 1 미구현·결합표 0건 — 지금이 유일하게 공짜인 시점). 그리고 **사장님 확정(권고 아님, 결정)**: _"프로젝트를 팀에 넣으면 멤버 따라오는 방식으로 가자"_ — **팀원은 별도 저장 없이 결합 프로젝트 멤버에서 파생**한다. #1336 의 무멤버십 설계와 정합한다(파생값이라 정본이 둘이 되지 않는다).

### 9. 왜 #1336 문서에는 이 전략이 없나 — 오케 실수 기록

오케가 이 포지셔닝 지시를 #1336 에이전트에게 `add_pending_instruction` 으로 보냈으나 **이미 제출한 뒤라 닿지 않았다.** 그래서 #1336 문서에는 포지셔닝·성공 정의·Cost per Successful Task 가 없다 — 결함이 아니라 전달 시점 문제이고, **이 노트가 그 갭을 메운다.**

## 한계 / 정직성

- **경쟁 제품(Langfuse·LangSmith) 서술은 전부 사장님 인용이고 미검증이다.** 확인 필요 상태로 두며, 검증 없이 영업 자료에 옮기지 않는다.
- §4 의 91%·$2.80 등은 **사장님의 가상 예시**다. 실측이 아니고, 실측은 4b 배포 후에야 나온다(내부 21개 프로젝트분 소급 — #1334 §4.3).
- 머지 신호는 지금 **과소 수집 상태**다: 캡처 경로 2 중 GH Actions 웹훅이 결제 차단으로 안 돌고(런이 3~5초 failure, [[ci-empty-steps-is-billing]]), gh CLI 머지는 앱 버튼 경로도 안 탄다. `events.task:merged` 행수는 이 세션도 재지 않았다 — 첫 구현 티켓의 확인 항목(#1334 §1.1).
- 원본 4건(#1333~#1336)과 CONTROL-PLANE.md 는 한 글자도 고치지 않았다. **수치·판정이 갈리면 원본이 옳다.**
- 표본 규율은 이 노트가 새로 정한 것이 아니라 #1333 §5.3(비율 n≥35)·#1334 §5.1(중앙값 n≥10)의 계승이다.

## 실제 영향

무변경 — 코드·설정·운영 변경 0. 문서(이 노트 + 위키 인덱스류 + [[overview]] 한계 절의 낡은 문장 정정)만.

## Evidence

- [docs/org-analytics-b2b-design-2026-08-31.md](../../org-analytics-b2b-design-2026-08-31.md) — #1333 로드맵·조직 URL·"로그" 3뜻·성공률 사람 축
- [docs/org-analytics-metrics-and-screens-2026-08-31.md](../../org-analytics-metrics-and-screens-2026-08-31.md) — #1334 지표 정의·머지 출처·층화·뺀 지표
- [docs/team-usage-policy-notice-draft-2026-08-31.md](../../team-usage-policy-notice-draft-2026-08-31.md) — #1335 방침 문안 초안(승인 대기)
- [docs/org-team-layer-design-2026-08-31.md](../../org-team-layer-design-2026-08-31.md) — #1336 4층·경량 팀 라벨
- [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) — 포지셔닝 SSoT(읽기 전용)
- 코드 앵커: [v3/electron/main.ts](../../../v3/electron/main.ts) `recordMergeHistory:4089` · [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) `logTaskOutcome:8904`(retriesCount:8939·outcomeMode:8941)·`recordGitHubMergeHistory:801` · [v3/electron/mcp-server/merge-closeout.ts](../../../v3/electron/mcp-server/merge-closeout.ts) · [v3/electron/dispatch-scoring.ts](../../../v3/electron/dispatch-scoring.ts) · [v3/electron/telemetry.ts](../../../v3/electron/telemetry.ts) `model:tier_resolved:671`

## Backlinks

- [[overview]] — control plane 포지셔닝의 위키 입구. 이 노트는 그 enterprise/B2B 연장
- [[telemetry-data-model-map]] — 사슬이 오늘 끊겨 있는 곳(축 3개)과 다리
- [[counting-unit-first]] — 표본 규율(n≥35)의 방법론 원본
- [[ci-empty-steps-is-billing]] — CI 신호가 지금 존재하지 않는 이유
