---
title: 폴러 리스는 기기명이 아니라 인증 행위자와 서버 시각으로 보호한다
tags: [domain/foundations, topic/observability, topic/teams, verdict/adopt, method/experiment-design]
status: verified
date: 2026-09-05
links: [[name-the-actor-not-just-the-resource]], [[count-callers-before-closing-a-gate]], [[marblo-bot-messaging]], [[electron-power-switches-are-layer-scoped]], [[extend-the-verdict-when-you-add-a-dimension]]
---

# 폴러 리스는 기기명이 아니라 인증 행위자와 서버 시각으로 보호한다

> **한 줄 판정**: ★채택 — 단일 소비자 리스에서 로컬 `machineId`는 표시용 식별자일 뿐 권한 증명이 아니다. 쓰기 주체는 인증 UID로 서명하고, 만료·인수는 클라이언트 시계가 아닌 Firestore 서버 시각으로 판정한다. 일시적인 리스 저장 실패는 fail-open으로 폴링을 계속하되, `fail-open` 상태와 사유를 route health 및 JSONL 저널에 남긴다.
>
> **★2026-09-06 정정 — 위 "서버 시각으로 판정한다"는 룰에서만 참이었다** (티켓 `4wLWuuzWwGJ6O965nYnw`). Firestore 룰은 `request.time` 으로 만료를 봤지만, **클라이언트의 만료 판정**(`telegram-poller-lease.ts` 의 `isLive()`)은 `Date.now()` 로 나이를 쟀다. `renewedAt` 은 `serverTimestamp()` 로 **서버 시계**에 찍히므로, 두 시계가 벌어진 만큼이 그대로 TTL 판정 오차였다. 게다가 그 코드는 리스가 미래로 보이면 "상대 기기 시계가 고장났다"고 보고 **인수**했는데 — 모든 기기가 한 서버 시계로 쓰므로 미래로 보이는 원인은 **내 시계가 뒤처진 것** 하나뿐이다. 결과: **잠에서 막 깬 노트북(NTP 재동기 전)이 정상 보유자의 살아 있는 리스를 즉시 빼앗았다.** 실제로 2026-09-06 에 그 시나리오로 폴러가 넘어갔다.
>
> ★이 노트가 그 사실을 가렸다는 점이 중요하다 — "서버 시각으로 판정한다"는 문장이 **룰과 클라이언트 양쪽에 대한 보증처럼** 읽혔고, 그래서 아무도 클라이언트 쪽을 다시 보지 않았다. **보증을 쓸 때는 그 보증이 미치는 층을 같이 적는다.**
>
> 지금 참인 값: 클라이언트 `isLive()` 는 만료(`renewedAt + TTL < now`) **하나만** 인수 사유로 인정하고, 미래로 보이는 리스는 살아 있는 것으로 본다(보유자가 죽으면 로컬 시각이 흘러 결국 만료되므로 회수는 늦어질 뿐 사라지지 않는다). 갱신 20초 · TTL 90초. 획득·갱신은 Firestore 트랜잭션 compare-and-set 이라 두 기기가 같은 만료 리스를 동시에 봐도 하나만 잡는다. fail-open 은 유지하되 **"마지막으로 성공한 읽기에서 남이 유효하게 쥐고 있었으면 막는다"** 로 좁혔다.

## 무엇을 물었나

프로젝트 멤버가 쓰는 `projects/{id}.telegramPollerLease`를 허용하면서, 다른 기기를 임의로 막거나 만료 전 인수하는 경로를 어떻게 닫는가.

## 무엇을 했나

리스 레코드에 `holderUid`를 넣고 Firestore 게이트웨이가 현재 인증 UID를 기록하게 했다. 갱신 시각은 `serverTimestamp()`로 쓰고 룰의 `request.time`과 일치해야 한다. 룰은 같은 UID의 갱신, 또는 서버 기준 90초 만료 뒤 인수만 허용한다. 해제는 현재 holder UID만 할 수 있다.

## 결과

| 전이                | 허용 조건                                         |
| ------------------- | ------------------------------------------------- |
| 신규 획득·자기 갱신 | `holderUid == request.auth.uid` 및 서버 시각 갱신 |
| 타인 리스 인수      | 기존 `renewedAt + 90초 <= request.time`           |
| 해제                | 기존 `holderUid == request.auth.uid`              |

에뮬레이터 규칙 테스트는 정당한 소유자 쓰기, 남의 UID·machineId로 심기 거부, 만료 전 탈취 거부, 타인 해제 거부를 함께 고정한다. 검증 함수를 `true`로 뮤테이션하면 거부 단언 3건이 실제로 실패했다. 룰 배포는 이 판정의 일부가 아니다. 라이브 룰셋과 같던 `v3/firestore.rules`는 이 변경을 병합·승인하기 전까지 새 필드 검증 부분에서 달라진다.

## 한계 / 정직성

- UID 서명은 같은 사용자 계정의 서로 다른 기기를 구별하지 않는다. 기기 표시는 `holderId`·`hostLabel`이 맡고, 권한은 UID가 맡는다.
- fail-open은 상호배제를 보장하지 못하는 상태다. 다만 룰 또는 네트워크 장애가 텔레그램 전체를 멈추게 하지 않는 선택이며, 관측 상태를 남겨 조용한 영구 실패를 막는다.
- **★2026-09-06 — 위 "관측 상태를 남겨 조용한 영구 실패를 막는다"도 절반만 참이었다.** route health 에는 남았지만 **JSONL 저널이 `lease` 칸을 안 썼고**, 판정 함수도 리스를 안 봐서 리스에 막힌 기기가 `idle-ok` 로 찍혔다. 즉 상태를 계산해 두고 기록·판독에서 잃었다. 일반형은 [[extend-the-verdict-when-you-add-a-dimension]] 에 있다.
- 익명 인증(실사용자 아님) 상태에서는 게이트웨이가 던지므로 그 기기는 fail-open 으로 폴링한다. 좁힌 뒤에도 **한 번도 리스를 성공적으로 읽은 적이 없는** 기기는 여전히 fail-open 이다 — 막을 근거를 본 적이 없기 때문이다. 이 경계는 의도된 것이고, 그 대가는 "첫 기동이 남의 리스를 모른 채 시작할 수 있다"이다.

## Evidence

- [v3/firestore.rules](../../../v3/firestore.rules) — 별도 lease write tier, UID·서버시간·만료·해제 검증
- [v3/electron/telegram-channel-sync.ts](../../../v3/electron/telegram-channel-sync.ts) — 인증 UID와 `serverTimestamp()`를 쓰는 gateway
- [v3/electron/telegram-poller-lease.ts](../../../v3/electron/telegram-poller-lease.ts) — 리스 스키마·fail-open 결정
- [v3/firestore.rules.test.ts](../../../v3/firestore.rules.test.ts) — 에뮬레이터 허용·거부·인수 회귀 테스트
- [v3/tests/unit/telegram-single-consumer.test.ts](../../../v3/tests/unit/telegram-single-consumer.test.ts) — fail-open route health 관측 단언, ★시계 뒤처짐·fail-open 좁히기·원자적 인계 회귀

## Backlinks

- [[name-the-actor-not-just-the-resource]] — 행위자 축의 범위를 기기 간 경합으로 넓힌 사례
- [[count-callers-before-closing-a-gate]] — allowlist에 새 writer를 들일 때의 census와 내용 검증
- [[marblo-bot-messaging]] — 프로젝트 문서에 저장하는 텔레그램 메타의 제품 경계
- [[electron-power-switches-are-layer-scoped]] — 절전이 아니라 소유권 층에서 단일 소비자 계약을 흡수한 이유
- [[extend-the-verdict-when-you-add-a-dimension]] — 이 리스의 박탈 상태가 저널에 `idle-ok` 로 찍히던 경로와 그 일반형
