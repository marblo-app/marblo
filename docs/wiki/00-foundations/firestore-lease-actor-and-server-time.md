---
title: 폴러 리스는 기기명이 아니라 인증 행위자와 서버 시각으로 보호한다
tags: [domain/foundations, topic/observability, topic/teams, verdict/adopt, method/experiment-design]
status: verified
date: 2026-09-05
links: [[name-the-actor-not-just-the-resource]], [[count-callers-before-closing-a-gate]], [[marblo-bot-messaging]], [[electron-power-switches-are-layer-scoped]]
---

# 폴러 리스는 기기명이 아니라 인증 행위자와 서버 시각으로 보호한다

> **한 줄 판정**: ★채택 — 단일 소비자 리스에서 로컬 `machineId`는 표시용 식별자일 뿐 권한 증명이 아니다. 쓰기 주체는 인증 UID로 서명하고, 만료·인수는 클라이언트 시계가 아닌 Firestore 서버 시각으로 판정한다. 일시적인 리스 저장 실패는 fail-open으로 폴링을 계속하되, `fail-open` 상태와 사유를 route health 및 JSONL 저널에 남긴다.

## 무엇을 물었나

프로젝트 멤버가 쓰는 `projects/{id}.telegramPollerLease`를 허용하면서, 다른 기기를 임의로 막거나 만료 전 인수하는 경로를 어떻게 닫는가.

## 무엇을 했나

리스 레코드에 `holderUid`를 넣고 Firestore 게이트웨이가 현재 인증 UID를 기록하게 했다. 갱신 시각은 `serverTimestamp()`로 쓰고 룰의 `request.time`과 일치해야 한다. 룰은 같은 UID의 갱신, 또는 서버 기준 90초 만료 뒤 인수만 허용한다. 해제는 현재 holder UID만 할 수 있다.

## 결과

| 전이 | 허용 조건 |
| --- | --- |
| 신규 획득·자기 갱신 | `holderUid == request.auth.uid` 및 서버 시각 갱신 |
| 타인 리스 인수 | 기존 `renewedAt + 90초 <= request.time` |
| 해제 | 기존 `holderUid == request.auth.uid` |

에뮬레이터 규칙 테스트는 정당한 소유자 쓰기, 남의 UID·machineId로 심기 거부, 만료 전 탈취 거부, 타인 해제 거부를 함께 고정한다. 검증 함수를 `true`로 뮤테이션하면 거부 단언 3건이 실제로 실패했다. 룰 배포는 이 판정의 일부가 아니다. 라이브 룰셋과 같던 `v3/firestore.rules`는 이 변경을 병합·승인하기 전까지 새 필드 검증 부분에서 달라진다.

## 한계 / 정직성

- UID 서명은 같은 사용자 계정의 서로 다른 기기를 구별하지 않는다. 기기 표시는 `holderId`·`hostLabel`이 맡고, 권한은 UID가 맡는다.
- fail-open은 상호배제를 보장하지 못하는 상태다. 다만 룰 또는 네트워크 장애가 텔레그램 전체를 멈추게 하지 않는 선택이며, 관측 상태를 남겨 조용한 영구 실패를 막는다.

## Evidence

- [v3/firestore.rules](../../../v3/firestore.rules) — 별도 lease write tier, UID·서버시간·만료·해제 검증
- [v3/electron/telegram-channel-sync.ts](../../../v3/electron/telegram-channel-sync.ts) — 인증 UID와 `serverTimestamp()`를 쓰는 gateway
- [v3/electron/telegram-poller-lease.ts](../../../v3/electron/telegram-poller-lease.ts) — 리스 스키마·fail-open 결정
- [v3/firestore.rules.test.ts](../../../v3/firestore.rules.test.ts) — 에뮬레이터 허용·거부·인수 회귀 테스트
- [v3/tests/unit/telegram-single-consumer.test.ts](../../../v3/tests/unit/telegram-single-consumer.test.ts) — fail-open route health 관측 단언

## Backlinks

- [[name-the-actor-not-just-the-resource]] — 행위자 축의 범위를 기기 간 경합으로 넓힌 사례
- [[count-callers-before-closing-a-gate]] — allowlist에 새 writer를 들일 때의 census와 내용 검증
- [[marblo-bot-messaging]] — 프로젝트 문서에 저장하는 텔레그램 메타의 제품 경계
- [[electron-power-switches-are-layer-scoped]] — 절전이 아니라 소유권 층에서 단일 소비자 계약을 흡수한 이유
