# `docs/routing/` — 브레인 라우팅 문서

학습형 라우팅(모델이 라우팅을 결정하는 단계)으로 가기 전, **배관과 라벨**을 다루는 문서 묶음.

| 문서                                                                       | 무엇                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`label-capture-audit-2026-08-10.md`](./label-capture-audit-2026-08-10.md) | 라우팅 라벨이 **지금 어디에 어떤 모양으로 쌓이나** + 학습에 부족한 것(갭) |
| [`shadow-serving-stub.md`](./shadow-serving-stub.md)                       | 클라우드 라우팅 추천 **shadow 스텁**(행동 변경 0) 설계·검증·배포·쿼리     |

## ★이 묶음의 비목표 (2026-08 현재)

**모델 fine-tune 도, 실반영도 이 단계가 아니다.**
데이터가 사실상 오너 전용(외부 실사용 ≈ 0)이라 학습셋이 얇다. 지금 하는 일은 두 가지뿐이다:

1. **audit** — 무엇이 이미 담기고 무엇이 안 담기는지 못 박기(스키마는 소급되지 않는다).
2. **shadow 배관** — 클라우드가 추천을 돌려주는 왕복을 먼저 돌려 두고, 그 추천과 로컬
   실제 선택의 **차이를 기록만** 하기. 스폰은 언제나 로컬 결정 그대로다.

## 관련 문서(이 폴더 밖)

- [`../routing-label-instrumentation.md`](../routing-label-instrumentation.md) — #890 F-1~F-7 계측이 실제로 심은 필드·쿼리
- [`../routing-slm-dataset-design-2026-08-09.md`](../routing-slm-dataset-design-2026-08-09.md) — 데이터셋 설계 근거(F-번호의 출처)
- [`../bq-ml-training-data-audit-2026-08-08.md`](../bq-ml-training-data-audit-2026-08-08.md) — BQ 학습데이터 감사(G-번호의 출처)
- [`../spawn-autoselect-architecture.md`](../spawn-autoselect-architecture.md) — 2층 자동선택 구조
- [`../own-model-finetune-serving-roadmap-2026-08-09.md`](../own-model-finetune-serving-roadmap-2026-08-09.md) — 자체모델 로드맵(이 단계 **뒤**)
