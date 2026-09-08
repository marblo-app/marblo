---
title: Solar native Responses는 한 과제에서 3회씩 완주했지만 오케 편입 근거는 아직 아니다
tags: [domain/investigations, topic/verification, topic/observability, verdict/adopt, kind/archive]
status: verified
date: 2026-09-05
links: [[condition-must-ride-with-the-score]], [[routing-label-coverage]], [[counting-unit-first]], [[verify-result-row]]
---

# Solar native Responses는 한 과제에서 3회씩 완주했지만 오케 편입 근거는 아직 아니다

> **한 줄 판정**: ★채택 — `django__django-15731`에서 bridge와 native Responses를 각각 3회씩 실행해 6/6 완주했다. 첫 회의 432초 대 40초로 세운 체계적 bridge 오버헤드 가설은 이 데이터가 지지하지 않는다. 다만 한 인스턴스·n=3/arm이고 옛 3/12의 7개 무산출 원본 호출 로그가 없으므로, Solar를 오케 기본 후보로 편입하지 않는다.

## 무엇을 물었나

`MARBLO_UPSTAGE_NATIVE_RESPONSES`가 실제 Upstage `/v1/responses`로 가는가, 그 경로에서 행동이 끊기지 않는가, 그리고 2026-08-20의 Solar 3/12를 모델 실패로 읽어도 되는가를 확인했다.

## 무엇을 했나

현재 실행 중인 Electron main-process가 #1454 토글을 포함한 커밋인지 먼저 확인했다. 같은 SWE-bench 과제·프롬프트·base commit·`solar-pro4@medium`·키 주입 경로·채점기를 고정하고, bridge(토글 미설정)와 native(토글=1)만 바꿨다. 각 arm을 3회 실행했다. 창은 열지 않았고 키의 존재 상태만 헤드리스 런처에서 확인했다.

## 결과 (수치)

| arm    | route 증거                                              | 완주 | agent 시간 (초)           | 함수 호출 수 |
| ------ | ------------------------------------------------------- | ---: | ------------------------- | ------------ |
| bridge | `upstage/openai-compat via local responses→chat bridge` |  3/3 | 432.281 · 89.215 · 24.151 | 72 · 16 · 5  |
| native | `upstage/responses-native direct`                       |  3/3 | 39.665 · 89.605 · 29.607  | 8 · 13 · 6   |

모든 실행은 F2P 1/1·P2P 58/58이고 `apply_patch`를 한 번씩 실제 호출했다. 실패·조용한 종료·무한 대기·도구 호출 없는 텍스트 완료는 이 6회에서 관측되지 않았다.

## 판정

- **3/12의 원인**: 모델 단독 실패라고 판정할 수 없다. 옛 12회는 bridge와 model catalog 미방출이 겹쳤고, 원인이 확정된 1건은 `apply_patch` 거절이다. 나머지 7개 무산출은 전체 호출 트랜스크립트가 보존되지 않아 소급 원인 판정 불가다. 새 6회는 도구 카탈로그가 있는 현재 조건에서 bridge/native 모두 완주함을 보일 뿐, 옛 7건을 특정 원인으로 환원하지 않는다.
- **3/12와 직접 비교할 수 있는가**: 아니다. 옛 실험은 v2 scaffold·12개 과제·bridge·model catalog 미방출, 이번은 v3a scaffold·그중 한 인스턴스·현재 도구 카탈로그다. effort=medium과 `django__django-15731`은 같지만 다른 축이 남는다. 과거 실패율 25%가 참이어도 3회 연속 성공 확률은 약 42%, 양 arm 6/6 성공도 약 18%라서 이 표본은 3/12를 배제하지 못한다.
- **432초 대 40초**: 첫 n=1에서 세운 고정 bridge 왕복 오버헤드 가설은 이 데이터가 지지하지 않는다. bridge 최저 24.151초가 native 최고 89.605초보다 빠르고 arm 내부 분산이 더 크다. 호출 수도 72/16/5 대 8/13/6으로 같지 않다. n=3이 작으므로 bridge 오버헤드가 없다는 결론도 내리지 않는다.
- **native route 라벨**: `LIVE UNVERIFIED`는 더 이상 맞지 않는다. 2026-09-05의 native 3회는 실제 direct route에서 채점까지 완주했다. 다만 이 검증은 벤치 호환성만 뜻하며 제품 롤아웃·잔액·장기 가용성은 검증하지 않았다.
  - ★(2026-09-07 갱신, 티켓 hj7tpt0FFdyc1oGhSGgz) 이 결과를 근거로 **전송 경로의 기본값 자체**를 네이티브로 뒤집었다 — `codex-vendor-provider.ts`의 `needsChatBridge`가 이제 기본 `false`다(코드 축은 그대로, 방향만 반전 — 문제가 생기면 `MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE=1`로 브리지 롤백 가능, 브리지 코드는 삭제하지 않았다). ★**이건 전송 경로만의 얘기다** — 아래 "오케 편입" 판정은 이 변경과 무관하게 그대로 보류다. 둘을 섞지 말 것.
- **비용**: 이 벤치는 독립 `codex` 자식을 직접 실행하므로 제품의 agent-manager/cost-tracker 스폰 경로를 통과하지 않는다. 따라서 `cost_logs` 0행은 비용 0이 아니라 이 하네스의 비용 커버리지 부재일 수 있고, 이 실험으로 cost_logs 적재를 검증하지 않았다.
- **오케 편입**: 보류. Upstage에는 공개 잔액 API가 없어 현재의 잔액 게이트와 동등한 자동 차단 신호가 없다. 우선은 명시 선택만 허용하고, `codex-solar doctor`가 키 유효성·최근 성공 호출·최근 비용/한도 실패를 비밀값 없이 검증한 뒤에만 스폰하는 대체 게이트를 설계·검증해야 한다.
  - ★(2026-09-07 갱신) 전송 경로가 네이티브로 바뀐 것과 **무관하게 이 판정은 그대로다**. 이 보류의 근거였던 n=3·한 인스턴스 표본, 옛 3/12의 무산출 원인 미확정, Upstage 잔액 API 부재는 그 사이 하나도 해소되지 않았다. "전송이 네이티브가 됐다"를 "오케가 Solar를 자동 후보로 고른다"로 읽지 말 것 — 둘은 다른 축이다.

## 다음 사람이 하는 일

다른 인스턴스를 같은 양 arm에 배치하고, 요청 시작·각 도구 호출·응답·종료의 단조 타임라인을 결과 행에 남긴다. 그래야 bridge 왕복 지연과 모델의 도구 사용 패턴을 분리할 수 있다. cost_logs는 agent-manager를 거친 제품 스폰에서 별도로 확인한다.

## Evidence

- [라이브 A/B 원본 JSONL](../../../v3/electron/scripts/bench/results/solar-pro4-ab-2026-09-05.jsonl)
- [토글과 provider route](../../../v3/electron/codex-vendor-provider.ts) — ★2026-09-07 갱신: 이 파일의 `needsChatBridge` 기본값이 이 노트의 결과를 근거로 반전됐다(위 판정 참고). 링크는 여전히 유효하다.
  - ★(2026-09-08 갱신, 티켓 L78q6A41ubvsN8WX8394) **다음 사람이 반드시 밟을 함정**: `model_providers.<id>.http_headers`(이 파일이 렌더링)로 얹은 값은 native 경로(위 route)에서는 그대로 나가지만, bridge 경로([codex-chat-bridge.ts](../../../v3/electron/codex-chat-bridge.ts))는 codex가 보낸 요청을 중계하지 않고 **브리지→업스트림 구간에 별도 `fetch`를 새로 만들기 때문에** 그 헤더가 조용히 사라진다. "provider 설정에 얹었으니 나간다"고 믿으면 브리지가 롤백 경로(`MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE=1`)로 살아 있는 한 계속 틀린다. 마블로 식별 헤더는 그래서 브리지의 그 `fetch` 에도 명시적으로 다시 실었다 — 새 provider 헤더를 추가할 땐 이 갭을 매번 확인할 것.
- [벤치 vendor 배선](../../../v3/electron/scripts/bench/vendor.ts)
- [옛 3/12 조건 분해](../40-methodology/condition-must-ride-with-the-score.md)

## Backlinks

- [[condition-must-ride-with-the-score]] · [[routing-label-coverage]] · [[counting-unit-first]] · [[verify-result-row]]
