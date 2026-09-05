---
title: 조건이 숫자와 함께 다니지 않으면 나중에 모델 탓으로 오독된다
tags: [domain/methodology, topic/verification, verdict/adopt, method/experiment-design]
status: verified
date: 2026-09-05
links: [[control-must-differ-on-the-tested-axis]], [[binary-resolved-cant-split-same-price-frontier-pairs]]
---

# 조건이 숫자와 함께 다니지 않으면 나중에 모델 탓으로 오독된다

> **한 줄 판정**: ★채택 — 벤치 점수를 낸 **조건**(하네스 배선·브리지 유무·도구 카탈로그 유무)이 점수 자체와 같은 자리에 안 적히면, 그 문서가 조건을 이미 경고했더라도 나중에 숫자만 재사용하는 사람은 "(모델+조건)"을 "모델 단독"으로 읽는다. 실측 1건에서 이 오독이 모델 하나를 실작업에서 **약 1시간 만에** 반려시켰다.

## 무엇을 물었나

벤치 문서 본문에 "이건 모델 단독 비교가 아니라 (모델, 하네스) 비교다"라는 경고가 이미 있었는데도, 왜 그 숫자가 나중에 모델 단독 성능으로 소비됐는가.

## 무엇을 했나

2026-08-20 SWE-bench 라운드에서 `solar-pro4` 가 3/12(25.0%)로 이상치 판정을 받아 분포 계산에서 손으로 제외된 사건을 사후 분해했다. 원장(`~/.marblo/swe-bench/results/runs.jsonl`)의 solar-pro4 런 12건을 직접 열어 `agent.noOutput`/`agent.patch`/`grade.f2pPassed` 를 확인하고, 같은 런의 조건 라벨(`vendorRoute`)과 벤치 스펙(`emitModelCatalog`)을 대조했다.

## 결과 (수치)

- 그 런의 실제 조건은 원장에 `vendorRoute: "upstage/openai-compat via local responses→chat bridge (codex custom provider, apikey auth)"` 로 박혀 있다 — 모델 단독이 아니라 **(모델 + 로컬 프로토콜 변환 브리지)** 를 잰 값이다.
- 같은 런은 `model_catalog_json` 도 꺼진 채였다(`emitModelCatalog: false`) — `apply_patch` 툴이 등록되지 않는 **두 번째** 조건 차이가 겹쳐 있었다.
- 3/12 중 **8/12 가 무산출**(patch=0바이트)이었다. 그중 원인이 확인되는 것은 **1건**(`django__django-15731`, 라우터가 `unsupported call: apply_patch` 로 명시 거절)뿐이고, 나머지 7건은 원인 미상이다 — 예: `django__django-16256` 은 모델이 체크리스트로 완료를 서술했지만 실제 patch=0바이트, F2P 0/9.
- 원 문서(`swebench-solar-pro4-2026-08-20.md`)는 이 조건 차이를 §1 표와 §4 "교란요인"에 **이미 명시**했다. 그런데도 한 시간 뒤 오케(사람이 아니라 이 조직의 오케스트레이터 역할)가 "3/12" 라는 숫자만으로 해당 모델을 실작업에서 반려했다 — 조건 문단을 다시 읽지 않고 점수만 재사용했다.

## 왜

경고가 **문서 본문**에만 있고 **데이터 행 자체**(숫자가 흘러가는 자리)에는 없었기 때문이다. 숫자는 표·API·후속 판단으로 계속 복제되지만 그 옆에 있던 산문 경고는 복제되지 않는다. 사람도 시스템도 "숫자 하나"를 보면 그것이 측정하려던 대상(모델)의 속성이라고 기본 가정한다 — 조건이 같은 자리에 찍혀 있지 않으면 그 가정을 깰 신호가 없다.

## 한계 / 정직성

- 사건 n=1의 사후 분해다. 빈도를 주장하지 않는다.
- 8/12 무산출 중 7건의 원인(브리지의 프로토콜 변환 결함인지 모델 자체의 도구호출 신뢰성 문제인지)은 이 노트가 밝히지 못한다 — 원장에는 요약 로그(`tailLog`)만 있고 전체 tool-call 트랜스크립트가 보존되지 않아 재구성이 안 된다. "조건이 안 붙어 오독됐다"는 것과 "그 조건이 점수 차이의 원인이었다"는 것은 별개 주장이고, 이 노트는 전자만 판정한다.
- **수치가 갈리면 원본이 옳다.**

## 실제 영향

방법론 채택. 코드 변경(별도 티켓 `pW7c7b0p2FdAmhaLj1Xq`): 브리지 유무를 코드 축(`MARBLO_UPSTAGE_NATIVE_RESPONSES` 토글, `v3/electron/codex-vendor-provider.ts`)으로 만들어 조건이 바뀌면 `scaffoldFor()`(`v3/electron/scripts/bench/manifest.ts`)가 다른 문자열을 내도록 했다 — 조건이 다르면 시계열이 자동으로 갈린다. 처방: 벤치 데이터·화면 양쪽에 조건축을 숫자와 **같은 행**에 상시 표시한다(오늘 머지된 `OurBenchPanel` 이 `cliVersion` 을 점수와 병기하는 것과 같은 방향). 산문 경고는 다음 사람이 다시 읽는다는 보장이 없다 — 조건은 숫자가 지나가는 자리에 구조로 붙어야 한다.

## Evidence

- [v3/docs/benchmark/swebench-solar-pro4-2026-08-20.md](../../../v3/docs/benchmark/swebench-solar-pro4-2026-08-20.md) — §1 조건 표, §3~4 무산출 8/12·교란요인
- [v3/docs/benchmark/swebench-round3-astra-vs-fable-2026-09-05.md](../../../v3/docs/benchmark/swebench-round3-astra-vs-fable-2026-09-05.md) — §2 라운드2 진단, solar-pro4 제외 근거
- [v3/electron/model-bench-ours-data.ts](../../../v3/electron/model-bench-ours-data.ts) — 조건 라벨이 데이터에 박히는 자리
- [v3/electron/scripts/bench/vendor.ts](../../../v3/electron/scripts/bench/vendor.ts) — `emitModelCatalog`/`needsChatBridge` 축 정의

## Backlinks

- [[control-must-differ-on-the-tested-axis]] — 같은 계열: 실험 조건이 실제로 무엇을 건드렸는지 확인하지 않으면 결과를 잘못 읽는다
- [[binary-resolved-cant-split-same-price-frontier-pairs]] — 같은 벤치 원장을 다루는 자매 노트: 완주율 격차의 통계적 해석 한계
