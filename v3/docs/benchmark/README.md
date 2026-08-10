# `v3/docs/benchmark/` — 우리가 직접 잰 벤치 결과가 사는 곳

이 디렉터리는 **우리가 실행한 측정**만 담는다. 벤더가 발표한 점수는 여기 오지
않는다 — 그건 `v3/electron/model-bench-reference.ts` 의 참조표가 정본이다.

| 문서                                                                                                     | 무엇                                                              | 성격                 |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| [`swebench-our-measured.md`](./swebench-our-measured.md)                                                 | 공개 SWE-bench Verified 인스턴스를 **우리 스폰 경로**로 돌린 실측 | 실행됨 (tiny N)      |
| [`../marblo-swe-benchmark-feasibility-2026-08-09.md`](../marblo-swe-benchmark-feasibility-2026-08-09.md) | 자체 벤치를 만들 것인가에 대한 전략 판단 (#896)                   | 코드 무변경 스파이크 |

## 세 물건을 섞지 않는다

feasibility 문서 §1 이 가른 셋을 그대로 상속한다:

| #   | 물건                      | 출처                    | 어디                                           |
| --- | ------------------------- | ----------------------- | ---------------------------------------------- |
| ①   | 벤더 공개 점수 인용       | 벤더 발표·공식 리더보드 | `electron/model-bench-reference.ts` → 사용량탭 |
| ②   | 우리 함대 관측 리포트(T0) | 우리 텔레메트리         | 공개 리포 `docs/benchmark/`                    |
| ③   | **우리가 실행한 실험**    | **우리 실행**           | **여기**                                       |

①과 ③을 한 표에 놓는 것은 금지다. 이유는 표본 크기가 아니라 **실행환경이 다르기
때문**이다 — 자세한 것은 `swebench-our-measured.md` §3.

## ③이 앱 화면까지 가는 길 (2026-08-11 배선)

종전엔 ③이 이 디렉터리의 마크다운과 실행 머신의 `results/runs.jsonl` 에만 있어
**사용량 탭에서 한 글자도 보이지 않았다.** 지금은 같은 생성기가 화면용 소스까지
같이 뽑는다 — 사람이 표를 보고 옮겨 적는 단계가 없으므로 문서와 화면이 갈라질 수
없다.

```
results/runs.jsonl                     ← 정본(실행 머신)
  └─ scripts/bench/report.ts           ← 생성기 하나
       ├─ docs/benchmark/generated-report.md      (사람이 읽는 표)
       └─ electron/model-bench-ours-data.ts       (앱이 읽는 구조화 데이터)
            └─ electron/model-bench-ours.ts       (스키마 + 로드 시점 검증)
                 └─ IPC `models:ourBench`
                      └─ src/components/usage/OurBenchPanel.tsx  (Usage 탭)
```

- 재생성: `npm run bench:swe:emit` (마크다운 + 데이터 모듈을 **한 번에**, 같은 생성
  시각으로 찍는다). 이미 발간된 리포트를 구조화 데이터로만 백필할 땐
  `--generated-at=<ISO>` 로 그 리포트의 시각을 그대로 쓴다.
- ①(벤더 공개치)과의 분리는 약속이 아니라 구조다: IPC 채널·스토어·타입이 모두
  갈라져 있고, `tests/unit/model-bench-ours.test.ts` 가 양방향 import 금지와
  화면 분리를 소스 스캔으로 강제한다.
- 화면은 **접힌 상태에서도** 한 줄 요약·대조행(noop 0% / gold 100%)·"공식 Docker
  아님 → 리더보드 비교 불가" 캡션을 지우지 않는다. 캡션 문구는 위 마크다운 헤더와
  같은 문자열이고, 그 일치도 테스트가 못박는다.
