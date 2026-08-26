---
title: 마블로는 AI-native 팀의 control plane 이다
tags: [domain/foundations, topic/wiki, topic/agents, method/source-link]
status: active
date: 2026-08-26
links: [[glossary]], [[architecture]], [[progress]], [[telemetry-identity-axes]], [[do-not-retry]]
---

# 마블로 오버뷰

> **한 줄 판정**: ★채택 — 마블로는 에이전트를 여러 개 띄우는 실행기가 아니라, 그 작업들의 맥락·진행·diff·테스트·결정을 모아 사람이 안전하게 merge 하게 하는 control plane 이다. 실행기는 commodity, 해자는 그 위 레이어.

## 무엇을 물었나

처음 온 사람이나 새 오케 세션이 **어디서 시작**하는가. 마블로가 무엇이고, 지금 어디까지 왔고, 무엇을 보려면 어느 문서로 가는가.

## 무엇을 했나

포지셔닝 원본과 위키 1판(방법론 5장·제약 1장·식별자 1장)을 입구 한 장으로 묶었다. 원문 수치는 옮기지 않았다.

## 결과 (수치)

| 축 | 지금 |
| --- | --- |
| 제품 한 줄 | AI-native 팀의 control plane. 실행기 아님 |
| 런타임 | Electron 데스크톱 + Firestore 영속. Docker 없는 로컬 루프 |
| 위키 입구 이전 | 콘텐츠 노트 6장, 오버뷰·아키텍처·글로서리·진행상황 없음 |
| 위키 입구 이후 | 이 넷이 시작점. 보드가 진행 정본 |

표본: 포지셔닝 원본 1장 + 위키 실측(티켓 전제, 2026-08-26). 유의성은 장 수·슬롯이지 다운로드 수가 아니다.

## 왜

에이전트 병렬 실행은 IDE·모델 벤더가 흡수한다. 마블로가 쌓는 것은 코드가 아니라 trajectory(문제→행동→diff→사람 결정→머지/리버트)다. 그 레이어가 비면 에이전트를 10개 띄워도 팀이 추적·merge 에서 마비된다.

## 한계 / 정직성

- 4기둥(provenance, decision log, 머지/배포 캡처, 인라인 diff+CI)의 토대(보드·런타임)는 있다. **머지/배포는 아직 앱 밖**이고 사람 결정은 채팅에 휘발한다.
- BYO-model. 파운데이션 모델을 학습시키지 않는다. 데이터 용처는 routing / evals / merge-risk.
- **갈리면 원본 [CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) 가 옳다.**

## 실제 영향

새 세션은 이 순서로 읽는다.

| 질문 | 가는 곳 |
| --- | --- |
| 같은 말이 다른 것을 가리키나 | [[glossary]] — ★먼저 |
| 구성 요소가 어떻게 닿나 | [[architecture]] |
| 지금 무엇이 돌고 막혔나 | [[progress]] |
| userId 를 조인해도 되나 | [[telemetry-identity-axes]] |
| 그거 전에 해봤나 | [[do-not-retry]] |
| 쿼리가 비다 / 숫자가 있다 | [[empty-query-first]] · [[verify-result-row]] · [[counting-unit-first]] |
| 화면으로 확인하고 싶다 | [[no-live-gui-verify]] |

코드·설정·운영 변경 없음. 무변경.

## Evidence

- [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) — 포지셔닝·4기둥·갭
- [v3/docs/COMMUNICATION-ARCHITECTURE.md](../../../v3/docs/COMMUNICATION-ARCHITECTURE.md) — 데스크톱 런타임 루프
- [docs/wiki/README.md](../README.md) — 위키 홈·슬롯

## Backlinks

- [[glossary]] · [[architecture]] · [[progress]] · [[telemetry-identity-axes]] · [[empty-query-first]] · [[verify-result-row]] · [[counting-unit-first]] · [[no-live-gui-verify]]
