---
title: 위키는 머지 때 쓰고, 작업 전 읽는다
tags: [domain/methodology, topic/wiki, topic/agents, verdict/adopt, method/source-link]
status: active
date: 2026-08-26
links: [[CONVENTION]], [[LINT]], [[WIKI-SKIP]], [[marblo-bot-messaging]], [[decision-sentence-first]], [[empty-query-first]], [[artifact-scope-boundary]]
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
| 오케 `merge_and_close` | 머지로 지식이 확정된다. 오케가 여러 PR을 보며 일회성 사건과 반복 규칙을 가를 수 있다 | 오케가 매 머지마다 의무로 느끼면 머지 병목과 빈 노트가 생긴다. 그래서 "후보 판정"만 매번 하고, 실제 작성은 기준 충족 때만 한다 | 기본값 |
| 주기적 검사 | 몰아서 stale와 누락을 볼 수 있다 | 맥락이 식은 뒤라 근거 추적 비용이 커지고, 대량 티켓으로 밀리면 위키가 청소 작업이 된다 | 보조망. 낡은 것 잡기와 스킵 대장 정리용 |

규칙: `merge_and_close` 때 오케는 "이번 변경이 반복될 규칙인가"를 판정한다. 규칙이면 위키 노트를 쓰거나 기존 노트를 고친다. 아니면 [WIKI-SKIP](../_meta/WIKI-SKIP.md)에 사유를 남긴다. 자동 생성은 기본값이 아니다. LLM은 초안 제안까지만 하고, 사람 문서 반영은 오케의 판단 작업이다.

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

- 이 노트는 `merge_and_close`에 새 자동화를 추가하지 않는다. 코드 무변경 설계 규칙이다.
- `submit_for_review` 단계의 작업자는 위키 후보를 가장 잘 알 수 있으므로, 후보 신호를 남기는 역할은 계속 유효하다.
- 주기적 검사는 보조망이다. 정본 쓰기 판단을 대체하지 않는다.
- 수치와 구현 상세가 갈리면 원본이 옳다.

## 실제 영향

문서 변경만. 이후 오케는 머지 시점에 위키 후보를 판정하고, 에이전트는 작업 전 프로젝트 지식이 결과를 바꿀 수 있으면 `wiki_query`를 먼저 한다. 위키 노트는 반복 규칙, 판정 기준, 상대경로 Evidence만 남긴다.

## Evidence

- 기존 위키 규약: [../_meta/CONVENTION.md](../_meta/CONVENTION.md)
- 위키 린트와 freshness 게이트: [../_meta/LINT.md](../_meta/LINT.md), [../_meta/check_wiki_freshness.py](../_meta/check_wiki_freshness.py), [../_meta/lint_wiki.py](../_meta/lint_wiki.py)
- 스킵 결정 대장: [../_meta/WIKI-SKIP.md](../_meta/WIKI-SKIP.md)
- 위키 도구 스캐폴드: [../../WIKI_system/WIKI-SKills.md](../../WIKI_system/WIKI-SKills.md)
- MCP 위키 도구 구현: [../../../v3/electron/mcp-server/wiki-maintenance.ts](../../../v3/electron/mcp-server/wiki-maintenance.ts), [../../../v3/electron/mcp-server/tools.ts](../../../v3/electron/mcp-server/tools.ts)
- Knowledge가 켜진 봇의 `wiki_query` 사용 지시: [../../../v3/src/lib/botDefinition.ts](../../../v3/src/lib/botDefinition.ts)
- 마케팅 용어 사전 사고의 기준 노트: [../10-offerings/marblo-bot-messaging.md](../10-offerings/marblo-bot-messaging.md)

## Backlinks

- [[marblo-bot-messaging]] · [[decision-sentence-first]] · [[empty-query-first]] · [[artifact-scope-boundary]]
