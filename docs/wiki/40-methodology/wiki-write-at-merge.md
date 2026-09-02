---
title: 위키는 머지 때 쓰고, 작업 전 읽는다
tags: [domain/methodology, topic/wiki, topic/agents, verdict/adopt, method/source-link]
status: active
date: 2026-09-01
links: [[CONVENTION]], [[LINT]], [[WIKI-SKIP]], [[marblo-bot-messaging]], [[decision-sentence-first]], [[empty-query-first]], [[artifact-scope-boundary]], [[b2b-web-first-onboarding]]
---

# 위키는 머지 때 쓰고, 작업 전 읽는다

> **한 줄 판정**: ★채택 — 위키 쓰기 기본 트리거는 에이전트 완료가 아니라 오케의 `merge_and_close` 판단이다. 머지는 지식이 참으로 확정된 순간이고, 위키 읽기는 작업 시작 전 프로젝트 지식이 결과를 바꿀 수 있을 때 의무다.

## 무엇을 물었나

우리 시스템에서 누가 언제 위키를 업데이트하고, 에이전트는 언제 위키를 읽어야 하는가.

## 무엇을 했나

기존 게이트와 도구를 다시 만들지 않고 현재 장치를 읽었다. `check_wiki_freshness.py`는 새 `v3/docs` 문서와 stale 근거를 막고, `lint_wiki.py`와 `wiki_lint`는 그래프를 막는다. 빠진 것은 쓰기와 읽기의 운영 규칙이다.

## 트리거 위치

| 후보 | 장점 | 오탐 비용 | 판정 |
| --- | --- | --- | --- |
| 에이전트 `submit_for_review` | 작업자가 방금 배운 맥락을 가장 많이 안다 | 모든 완료가 위키 작성 요구로 보이면 저품질 요약과 형식 맞추기 PR이 늘어난다. 반복되면 사람은 "위키 쓰라" 신호를 무시한다 | 기본값 아님. PR 설명이나 `add_activity`에 "위키 후보"를 남기는 정도 |
| 오케 `merge_and_close` | 머지로 지식이 확정된다. 오케가 여러 PR을 보며 일회성 사건과 반복 규칙을 가를 수 있다 | 오케가 매 머지마다 의무로 느끼면 머지 병목과 빈 노트가 생긴다. 그래서 "후보 판정"만 매번 하고, 실제 작성은 기준 충족 때만 한다 | 기본값. ★2026-09-01: 이 판정을 실행으로 옮기는 자동 프롬프트가 코드로 붙었는데도(2026-08-28) 오늘 표본에서 발동 흔적 0 — [강제 메커니즘 재검토](#강제-메커니즘-재검토--2026-09-01) 참고 |
| 주기적 검사 | 몰아서 stale와 누락을 볼 수 있다 | 맥락이 식은 뒤라 근거 추적 비용이 커지고, 대량 티켓으로 밀리면 위키가 청소 작업이 된다 | 보조망. 낡은 것 잡기와 스킵 대장 정리용 |

규칙: `merge_and_close` 때 오케는 "이번 변경이 반복될 규칙인가"를 판정한다. 규칙이면 위키 노트를 쓰거나 기존 노트를 고친다. 아니면 [WIKI-SKIP](../_meta/WIKI-SKIP.md)에 사유를 남긴다. 자동 생성은 기본값이 아니다. LLM은 초안 제안까지만 하고, 사람 문서 반영은 오케의 판단 작업이다.

## 강제 메커니즘 재검토 — 2026-09-01

★재판정: 트리거 위치는 그대로 오케 `merge_and_close`(기본값)다. 이번에 뒤집힌 건 위치가 아니라 "그 판정을 실제로 하게 만드는 장치가 있어야 한다"는 것 — 규약을 문서로 적어도(2026-08-26, 이 노트), 그 판정 프롬프트를 코드로 `merge_and_close` 에 박아도(2026-08-28, PR #1274) 실측에서 발동 0건이었다. 티켓 oowabLVRXxeYmSCbNsyR 의 실측.

### 실측

| 구간 | 표본 | 위키 갱신 |
| --- | --- | --- |
| 2026-09-01 머지(비-docs) | 6건 | 0 |
| 2026-08-26(이 노트 작성일) 이후 main 머지 | 110건 | docs/wiki 터치 17건 — 그중 16건은 별도 `docs(wiki):` 단독 PR(몰아쓰기), 제품 변경과 같은 PR 에서 같이 쓴 건 1건뿐(0.9%, PR #1290) |
| 같은 구간 `WIKI-SKIP.md` 커밋 | — | 0 — "판정했지만 스킵"이 아니라 판정 자체가 흔적이 없다 |
| `merge_and_close` 의 `[wiki-decision:pending]` 자동 기록(2026-08-28 배선, MERGED 마다 무조건 기록하도록 코드에 있음) | 오늘 확인 가능한 5/6건 | 0 |

### '위키를 요구하는 머지'의 정의 — 오늘 6건으로 예시

위 "무엇을 쓰는가" 기준(반복될 규칙 · 판정 기준 · 함정 발견)을 그대로 적용한다. 단순 버그수정·리팩토링·이미 있는 설계문서의 화면 구현은 제외.

| 머지 | 요구? | 근거 |
| --- | --- | --- |
| `createOrganization` 콜러블 신설(#1360) | 예 | 원자 트랜잭션 + 멱등 재사용 패턴 — 다음 콜러블에도 반복될 판정 |
| 팀요금제 rules 게이트(#1353) | 예 | 플랜 축 vs 멤버 축 판정 + rules 문서접근 한도 함정(evaluation error 15건, 오케가 직접 반려·재현) |
| 프로젝트 초대 콜러블 이관(#1356) | 예 | "구버전 클라 비중이 무시할 만해지면 rules 를 조인다"는 신규 판정 기준 |
| in-app-browser ack 타임아웃(#1354) | 예 | 단방향 IPC(`send`) 유실 함정 발견 + 회귀 테스트 패턴 |
| 초대 폼 UI(#1355) | 아니오 | 상위 설계문서 3종(#1338/#1336/#1333)이 판정을 이미 기록 — 화면은 그 판정의 구현일 뿐 |
| task outcomes 사람키 각인(#1358) | 경계 | 기존 텔레메트리 사람축 판정의 연장 — 새 판정이 없으면 아니오 |

4/6(경계 포함 5/6)이 후보였는데 0건이 썼다 — "오탐 비용" 문제가 아니라 후보인데도 안 쓴 문제다.

### 강제 지점 비교

| 후보 | 사각지대 |
| --- | --- |
| (a) PR 템플릿 체크박스 | 형식 체크만 하고 실제로는 안 쓸 수 있다 — 자가판정과 실패 양상이 같다 |
| (b) CI 가 라벨로 판단 | ★이 레포는 private 이고 이 GitHub 플랜은 브랜치 보호(필수 상태 체크)를 지원하지 않는다(`gh api repos/melocream/marblo/branches/main/protection` → 403 "Upgrade to GitHub Pro to enable this feature", 2026-09-01 실측). CI 는 구조적으로 머지를 막을 수 없고 항상 참고 신호에 그친다. 게다가 lint 잡이 이미 45 errors 상시 빨간불이라 죽은 신호 위에 신호를 얹는 꼴이 된다 |
| (c) 오케 `merge_and_close` 가 물어보기 | ★이미 코드로 있다(PR #1274, 2026-08-28). 그런데도 오늘 표본 5/5에서 발동 흔적이 0 — 원인 미확정(merge_and_close 를 아예 안 부르고 `update_task_status(DONE)`/`gh pr merge` 로 직접 닫았거나, 불렀는데 기록이 조용히 실패했거나). 오케에 확인 요청함(질문 oowabLVRXxeYmSCbNsyR#qmticnieqmt27, 2026-09-01 기준 미응답). 설계가 아니라 "실행됐는지 아무도 확인 안 한다"가 실패 지점이다. 사람이 GitHub UI로 직접 머지하는 경로는 애초에 이 도구를 거치지 않는다는 사각지대도 남는다 |
| (d) 티켓 완료기준에 넣기 | 결국 작업자(에이전트) 자가보고다 — 이 노트가 "에이전트 `submit_for_review`" 를 기본값으로 두지 않은 이유(형식 맞추기 위험)와 같은 약점을 반복한다. 티켓 없이 사람이 직접 머지하는 경로엔 애초에 적용되지 않는다 |

### 권고

새 게이트를 추가하지 않는다. (a)(b)(d)는 각자의 사각지대로 기각한다 — 특히 (b)는 이 레포·플랜에서 구조적으로 불가능하다. (c)는 유일하게 사실상 모든 머지가 지나가는 지점이고 이미 구현돼 있으므로 자리는 유지하되, ★더 얹지 않는다. 지금 필요한 건 "이미 있는 자동 프롬프트가 왜 오늘 한 번도 발동 흔적을 안 남겼는지" 진단이지, 네 번째 장치가 아니다. 문서 한 번(2026-08-26)과 코드 한 번(2026-08-28)이 이미 같은 실패를 냈다 — 원인 진단 없이 세 번째를 얹으면 같은 패턴이 반복된다.

## 무엇을 쓰는가

위키는 원본 전문 복사본이 아니다. 다음 셋만 쓴다.

| 쓰는 것 | 기준 |
| --- | --- |
| 반복될 규칙 | 다음 에이전트의 판단이나 구현을 바꿀 문장 |
| 판정 기준 | 어떤 조건이면 채택, 보류, 기각, 정정인지 |
| 근거 링크 | `## Evidence`에 상대경로 마크다운 링크. 그래야 freshness가 근거 변경을 읽는다 |

노트 본문은 [[CONVENTION]]의 R1~R6을 따른다. 단, [[artifact-scope-boundary]]가 가른 제작물에는 이 판정 노트 형식을 적용하지 않는다. 수치와 세부 표는 원본에 둔다. 수치가 갈리면 원본이 옳다.

## 무엇을 안 쓰는가

문서 수를 늘리는 것이 목표가 아니다. 아래는 기본적으로 위키에 쓰지 않는다.

| 안 쓰는 것 | 이유 |
| --- | --- |
| 한 번 일어난 사건 | 재발 기준 없이 쓰면 운영 로그와 위키가 섞인다 |
| 구현 세부 전체 | 원본 문서, PR, 코드가 정본이다 |
| 시점 의존 가격·벤더·정책 | 바뀌기 쉬운 값을 위키에 고정하면 stale 비용이 커진다 |
| 화면 상태 스냅샷 | 라이브 검증과 같은 관측 기록은 원본에 둔다 |
| 반려 전 PR 지식 | 머지 전에는 참으로 확정되지 않았다 |

쓰기 기준은 보수적으로 둔다.

| 상황 | 처리 |
| --- | --- |
| 같은 실수가 두 번째 나왔다 | 위키 후보로 승격한다 |
| 기존 판정이 뒤집혔다 | 기존 노트를 정정하고 `date`를 갱신한다 |
| 새 근거가 기존 노트를 거짓으로 만든다 | 같은 변경에서 기존 노트를 고치거나, 사유 있는 스킵을 남긴다 |
| 한 PR에만 닫히는 구현 맥락이다 | PR 설명과 원본 문서에 남기고 위키는 건드리지 않는다 |

## 읽는 규칙

위키는 써도 읽지 않으면 실패한다. [[marblo-bot-messaging]]에 마케팅 용어 사전이 있어도 로케일 작업자가 읽지 않으면 `오케`를 임의 음차할 수 있다. 따라서 에이전트는 아래 작업 전에 `wiki_query(root_path="docs/wiki", query=...)`를 먼저 호출한다.

| 작업 전 조회가 필요한 경우 | 질의 예 |
| --- | --- |
| 카피, 랜딩, README, 로케일, 용어 변경 | "마블로봇 메시징 오케 외부어 로케일" |
| 분석, 지표, 대시보드, 원장 변경 | "지표 결정 문장 세는 단위 행 검증" |
| 검증 방식, GUI, CI, 릴리스 작업 | "GUI 검증 금지 CI 린트 릴리스 검증" |
| MCP 태스크, 오케, dispatch, merge 흐름 변경 | "오케 태스크 submit_for_review merge_and_close activity" |
| 위키 자체 변경 | "위키 규약 lint freshness skip evidence" |

조회 결과가 없으면 "규칙 없음"으로 바로 쓰지 않는다. [[empty-query-first]]와 같은 원칙으로 `root_path`, 질의어, 언어를 먼저 바꿔 확인한다. 그래도 없으면 새 규칙 후보로 남긴다.

읽기 의무의 오탐 비용도 있다. 모든 파일 변경 전에 형식적으로 `wiki_query`를 강제하면 에이전트가 결과를 읽지 않고 통과 의식으로 만든다. 그래서 기준은 "프로젝트 지식이 결과를 바꿀 수 있는 작업"으로 제한한다.

## 운영 순서

사장님이 못박은 순서는 "자동으로 쓰지 말고 먼저 낡은 것을 잡기"다.

1. freshness와 lint로 낡거나 깨진 것을 먼저 잡는다.
2. stale이면 기존 노트를 사람이 고치거나 [WIKI-SKIP](../_meta/WIKI-SKIP.md)에 사유를 적는다.
3. 머지 때 오케가 반복 규칙인지 판정한다.
4. 기준을 넘으면 `/wiki-note` 흐름으로 노트를 쓰고 `/wiki-ingest`를 커밋 전 게이트로 돌린다.
5. 자동 생성은 초안 제안까지만 허용하고 사람 문서에 자동 반영하지 않는다.

## 한계 / 정직성

- ~~이 노트는 `merge_and_close`에 새 자동화를 추가하지 않는다~~ — ★2026-09-01 정정: 이미 거짓이다. PR #1274(2026-08-28, 이 노트 작성 이틀 뒤)가 `merge_and_close`에 위키 판정 프롬프트 자동화를 추가했다(`WIKI_DECISION_PENDING_MARKER`, `recordMergeWikiDecisionPrompt`). "코드 무변경"은 이 노트가 작성된 시점의 사실이었을 뿐 현재는 아니다. 수치와 구현 상세가 갈리면 원본이 옳다는 원칙 그대로, 코드가 정본이고 이 문장을 고쳤다.
- ★그 자동화조차 2026-09-01 표본(5건)에서 발동 흔적이 0이었다 — [강제 메커니즘 재검토](#강제-메커니즘-재검토--2026-09-01) 참고. 자동화를 추가하는 것과 그 자동화가 지켜지는 것은 별개다.
- `submit_for_review` 단계의 작업자는 위키 후보를 가장 잘 알 수 있으므로, 후보 신호를 남기는 역할은 계속 유효하다.
- 주기적 검사는 보조망이다. 정본 쓰기 판단을 대체하지 않는다.
- 수치와 구현 상세가 갈리면 원본이 옳다.

## 실제 영향

문서 변경만 — 2026-09-01 개정도 코드를 바꾸지 않는다(devops 티켓 oowabLVRXxeYmSCbNsyR 의 결론이 "새 게이트를 추가하지 않는다"였기 때문). 이후 오케는 머지 시점에 위키 후보를 판정하고, 에이전트는 작업 전 프로젝트 지식이 결과를 바꿀 수 있으면 `wiki_query`를 먼저 한다. 위키 노트는 반복 규칙, 판정 기준, 상대경로 Evidence만 남긴다.

## Evidence

- 기존 위키 규약: [../_meta/CONVENTION.md](../_meta/CONVENTION.md)
- 위키 린트와 freshness 게이트: [../_meta/LINT.md](../_meta/LINT.md), [../_meta/check_wiki_freshness.py](../_meta/check_wiki_freshness.py), [../_meta/lint_wiki.py](../_meta/lint_wiki.py)
- 스킵 결정 대장(2026-08-26 이후 커밋 0건): [../_meta/WIKI-SKIP.md](../_meta/WIKI-SKIP.md)
- 위키 도구 스캐폴드: [../../WIKI_system/WIKI-SKills.md](../../WIKI_system/WIKI-SKills.md)
- MCP 위키 도구 구현: [../../../v3/electron/mcp-server/wiki-maintenance.ts](../../../v3/electron/mcp-server/wiki-maintenance.ts), [../../../v3/electron/mcp-server/tools.ts](../../../v3/electron/mcp-server/tools.ts)
- Knowledge가 켜진 봇의 `wiki_query` 사용 지시: [../../../v3/src/lib/botDefinition.ts](../../../v3/src/lib/botDefinition.ts)
- 마케팅 용어 사전 사고의 기준 노트: [../10-offerings/marblo-bot-messaging.md](../10-offerings/marblo-bot-messaging.md)
- `merge_and_close` 위키 판정 프롬프트 구현(2026-08-28, PR #1274): [../../../v3/electron/mcp-server/merge-closeout.ts](../../../v3/electron/mcp-server/merge-closeout.ts)(`WIKI_DECISION_PENDING_MARKER`, `formatMergeWikiDecisionPrompt`), [../../../v3/electron/mcp-server/tools.ts](../../../v3/electron/mcp-server/tools.ts)(`recordMergeWikiDecisionPrompt`, 10598행 부근 호출부)
- `merge_and_close`를 "무조건" 호출로 규정한 오케 스킬 문서: [../../../v3/skills/orchestrator_agent.md](../../../v3/skills/orchestrator_agent.md)
- 2026-09-01 devops 실측 티켓(이 개정의 근거): oowabLVRXxeYmSCbNsyR

## Backlinks

- [[marblo-bot-messaging]] · [[decision-sentence-first]] · [[empty-query-first]] · [[artifact-scope-boundary]]
- [[b2b-web-first-onboarding]] — 네 원본 설계문서에서 다시 구현해야 할 판정을 추출한 사례
