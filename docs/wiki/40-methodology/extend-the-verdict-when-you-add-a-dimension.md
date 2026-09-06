---
title: 새 관측 차원을 넣으면 판정 함수도 같이 넓힌다 — 안 넓히면 그 차원의 실패가 기존 "정상" 분기로 흡수된다
tags: [domain/methodology, topic/observability, verdict/adopt, kind/knowledge, method/vitest]
status: verified
date: 2026-09-06
links: [[name-the-actor-not-just-the-resource]], [[staleness-meter-must-not-be-driven-by-what-it-measures]], [[firestore-lease-actor-and-server-time]], [[same-assumption-repeats-across-layers]], [[wiring-proven-on-screen]], [[do-not-retry]], [[marblo-bot-messaging]], [[count-callers-before-closing-a-gate]], [[electron-power-switches-are-layer-scoped]]
---

## 지금 무엇이 참인가

시계열에 필드를 **기록**하는 코드와, 그 표본을 한 단어 결론으로 **판정**하는 코드는 별개다. 새 차원을 넣을 때 앞의 것만 고치고 뒤의 것을 안 고치면, 그 차원의 실패 상태는 판정 함수의 **분기 어디에도 안 걸려** 마지막 `else` 로 떨어진다. 그리고 관측 시스템의 마지막 `else` 는 거의 언제나 **"정상"** 이다.

그래서 결과가 단순한 누락이 아니다 — **고장이 정상으로 기록된다.** 조사하는 사람은 "신호가 없다"를 "이상이 없다"로 읽고, 진짜 신호는 사람이 겪는 증상(사장님이 "메시지가 안 오네")으로만 남는다.

★**판정 함수는 자기가 모르는 차원에 대해 침묵하지 않는다. 그 차원이 정상이라고 적극적으로 주장한다.** 이것이 이 노트의 전부다.

### 이 저장소에서 두 번 났다 — 같은 파일, 같은 마지막 분기

|                            | 1차 (티켓 `3asM22VKCCXgAlfnNXTJ`, 2026-09-04) | 2차 (티켓 `4wLWuuzWwGJ6O965nYnw`, 2026-09-06) |
| -------------------------- | --------------------------------------------- | --------------------------------------------- |
| 새로 들어온 차원           | `consecutivePollErrors` (연속 폴링 실패)      | `lease` (기기 간 폴러 소유권)                 |
| 그 차원의 고장             | HTTP 409 가 **105건 연속**                    | 다른 기기가 리스를 가져가 **폴러 박탈**       |
| 판정 함수가 그 차원을 봤나 | ❌                                            | ❌                                            |
| 그래서 찍힌 값             | `idle-ok`                                     | `idle-ok`                                     |
| `idle-ok` 의 doc 문구      | "조용한 건 보낸 사람이 없어서다"              | (동일)                                        |
| 사람이 알아챈 경로         | 사후 저널 정독                                | 사장님이 "메시지가 안 오네"                   |
| 저널의 이상 신호 건수      | 0                                             | **0 / 3316줄 (15.5시간)**                     |

2차에서는 `getRouteHealth()` 가 `lease` · `contention` · `consecutive409` · `since409` 를 **이미 계산하고 있었다.** 저널이 그 네 칸을 **버렸고**, 판정 함수는 애초에 읽지 않았다. 계산은 됐고 기록과 판정만 없었다.

### 왜 하필 `idle-ok` 로 떨어지나 — 침묵은 모든 검사를 통과한다

리스에 막힌 폴러의 모양을 따라가면 이유가 보인다. 그 기기는 네트워크로 **나가기 전에** 막히므로:

| 판정 함수의 검사             | 왜 안 걸리나                                                 |
| ---------------------------- | ------------------------------------------------------------ |
| 보류(`hold`) 있나            | 없다 — 메시지를 받지도 못했으니 붙잡을 것이 없다             |
| 루프가 죽었나(`loopRunning`) | 아니다 — 루프는 등록돼 있고 리스를 기다리는 중이다           |
| 왕복이 정체됐나              | 검사 자체를 건너뛴다 — 왕복 기록이 `null` 이라 기준점이 없다 |
| 오류가 쌓였나                | 0 이다 — 실패한 게 아니라 **시도를 안 했다**                 |

★일반형: **"아무것도 안 하고 있음"은 "정상적으로 조용함"과 모든 부정 검사에서 동일하다.** 부정 검사(무엇이 실패했나)만으로 짜인 판정 함수는 이 둘을 영원히 못 가른다. 갈리게 하려면 긍정 검사(무엇을 하고 있어야 하는데 안 하고 있나)를 넣어야 하고, 그것이 곧 새 차원을 읽는 분기다.

## 무엇을 하라 — 새 차원을 넣을 때의 4문

| #   | 자문                                                          | 통과 못 하면                                                              |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 이 차원의 **고장 상태**에 이름이 있나                         | 그 상태는 기존 분기 중 하나로 흡수된다                                    |
| 2   | 판정 함수가 그 이름을 **반환할 수 있나**                      | 기록만 늘고 판독은 그대로다 — 사람이 매번 원본을 정독해야 한다            |
| 3   | 그 상태에서 **마지막 분기가 무엇인지** 직접 실행해 봤나       | ★대개 "정상"이다. 짐작하지 말고 테스트로 고정한다                         |
| 4   | 그 상태가 **가드가 꺼진 채 도는 것**이라면 그것도 이름이 있나 | fail-open 은 실패가 아니라서 오류 검사에 안 걸린다 — 가장 조용한 고장이다 |

3번이 실무의 핵심이다. 2차에서 결함을 재현한 것은 코드 정독이 아니라 **테스트 한 줄**이었다: `expect(classifyRoute(leaseBlocked(), now)).toBe("lease-blocked")` 가 `expected 'idle-ok' to be 'lease-blocked'` 로 떨어졌다. 판정 함수는 순수 함수이므로 이 확인은 언제나 싸다.

## 왜

기록 코드와 판정 코드는 **같은 커밋에서 태어나지만 다른 커밋에서 자란다.** 차원을 추가하는 사람의 머릿속 작업 목록은 "필드를 넣는다"이고, 판정 함수는 그 필드를 안 써도 컴파일되고 테스트도 통과한다 — 기존 테스트는 기존 차원만 먹이기 때문이다. 즉 **타입체커도 테스트도 이 누락을 잡아주지 않는다.** 그래서 사람이 절차로 막아야 한다.

## 한계 / 정직성

- n=2 다. 둘 다 같은 저장소·같은 파일(`telegram-route-journal.ts`)의 사후 분해이므로, 빈도가 아니라 **구조**가 근거다. 같은 모양은 판정·분류·헬스체크를 하는 모든 곳(상태 배지, 알림 임계, 대시보드 신호등)에서 재현된다.
- 이름을 붙인다고 원인이 잡히지는 않는다. 잡히는 것은 **"정상이 아니다"** 한 갈래뿐이다. 2차에서도 `lease-blocked` 라는 이름이 생겼을 뿐, **어느 fail-open 경로가 발동했는지는 여전히 모른다** — 그건 상대 기기의 기록이 있어야 답한다.
- 4번(fail-open 이름 붙이기)은 2차에서 저널까지만 닿았다. 화면 배지는 아직 fail-open 을 표시하지 않는다 — 데이터는 렌더러까지 가는데 배지가 안 쓴다. **관측 표면마다 따로 확인해야 한다.**
- **수치가 갈리면 원본이 옳다.**

## 실제 영향

코드 변경 있음. `classifyRoute()` 에 `lease-blocked` · `lease-fail-open` · `poller-contended` 세 판정을 넣고, `RouteSample` 에 `lease`(phase·hostLabel·failOpenReason)와 `contention`(kind·409 연속)을 기록하게 했다. 순서가 규칙이다 — 리스 차단은 정체 검사보다 **앞**이고(왕복 기록이 없어 정체 검사를 통과해 버린다), 409 경합은 폴링 실패보다 **앞**이다(409 도 오류 계수를 올리므로 뒤에 두면 경합이 영영 "폴링 실패"로만 보인다).

가드를 하나씩 꺼서 잰 검출력(대상 58건): 저널 리스 판정 OFF → **3건** red, 시계 수리 OFF → **2건**, fail-open 좁히기 OFF → **3건**, 원자적 인계 OFF → **3건**.

## Evidence

- [v3/electron/telegram-route-journal.ts](../../../v3/electron/telegram-route-journal.ts) — `RouteVerdict` 유니온과 `classifyRoute()` 의 분기 순서. 1차·2차의 사유가 각 값의 doc-comment 에 적혀 있다
- [v3/electron/telegram-poller.ts](../../../v3/electron/telegram-poller.ts) — `getRouteHealth()` 가 계산하지만 저널이 버리던 네 칸(`lease`·`contention`·`consecutive409`·`since409`)
- [v3/tests/unit/telegram-route-journal.test.ts](../../../v3/tests/unit/telegram-route-journal.test.ts) — 리스 차단·fail-open·경합 판정 고정, 표본 키 집합 allowlist
- [v3/tests/unit/telegram-single-consumer.test.ts](../../../v3/tests/unit/telegram-single-consumer.test.ts) — 1차(409 105건이 `idle-ok` 였다)의 재현 테스트

## Backlinks

- [[name-the-actor-not-just-the-resource]] — 1차의 앞 단계. 그 노트가 "행위자 축을 넣어라"까지 갔고, 이 노트가 "넣은 축을 판정도 읽게 하라"를 잇는다
- [[staleness-meter-must-not-be-driven-by-what-it-measures]] — 같은 계열. 관측이 자기가 재야 할 것을 전제로 깔 때 생기는 침묵
- [[firestore-lease-actor-and-server-time]] — 2차에서 판정 대상이 된 리스 모델. 그 노트의 서버 시각 조항이 클라이언트 판정까지는 안 닿아 있었다
- [[same-assumption-repeats-across-layers]] — 같은 가정이 층마다 복제되는 문제. 이 노트는 그 층이 "기록"과 "판정"으로 갈리는 경우다
- [[wiring-proven-on-screen]] — 한계 절의 "관측 표면마다 따로 확인한다"와 같은 규율
- [[marblo-bot-messaging]] — 2건째 사고가 제품 쪽에서 무엇을 바꿨나(두 번째 기기는 인바운드 수신만 쉰다)
- [[count-callers-before-closing-a-gate]] — 같은 사고에서 나온 자매 교훈. 룰이 검사하는 **상수**도 게이트이고, 그 불일치도 fail-open 이 삼킨다
- [[electron-power-switches-are-layer-scoped]] — 이 결함이 걸쳐 있던 전원/소유권 층 경계(깨어나는 쪽)
