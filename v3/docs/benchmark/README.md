# `v3/docs/benchmark/` — 우리가 직접 잰 벤치 결과가 사는 곳

이 디렉터리는 **우리가 실행한 측정**만 담는다. 벤더가 발표한 점수는 여기 오지
않는다 — 그건 `v3/electron/model-bench-reference.ts` 의 참조표가 정본이다.

| 문서                                                                                                     | 무엇                                                              | 성격                 |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| [`swebench-our-measured.md`](./swebench-our-measured.md)                                                 | 공개 SWE-bench Verified 인스턴스를 **우리 스폰 경로**로 돌린 실측 | 실행됨 (tiny N)      |
| [`swebench-solar-pro4-2026-08-20.md`](./swebench-solar-pro4-2026-08-20.md)                               | Solar Pro 4 의 라운드2 합류 — 조건 대조·교란요인·파일럿 대조      | 실행됨 (n=12)        |
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

## env-swap 벤더(Upstage Solar)를 태울 때

`solar-pro4` 는 codex 하네스를 쓰지만 **다른 codex 모델과 스폰 경로가 같지 않다.**
codex 0.147+ 는 ChatGPT 로그인이 있으면 `OPENAI_BASE_URL` 을 무시하고 ChatGPT
백엔드로 보내고(solar-pro4 → HTTP 400), codex 0.148.0 은 `wire_api="chat"` 을
설정 로드 시점에 거부한다. 그래서 벤치는 **커스텀 프로바이더 + 로컬
Responses→Chat 브리지**로 붙는다(`scripts/bench/vendor.ts`).

```
npm run bench:swe:vendor -- --harness=codex --model=solar-pro4 --effort=medium --out=electron/scripts/bench/results/runs.jsonl
```

- 키(`UPSTAGE_API_KEY`)는 `~/.marblo/vendor-secrets.enc.json` 에 safeStorage 로만
  있다. 순수 node 인 러너는 그걸 못 열기 때문에 `scripts/bench/secret-launcher.ts`
  가 Electron 으로 떠서 복호화하고 **자식 env 로만** 넘긴다. 평문은 stdout·로그·
  argv 어디에도 나가지 않는다.
- ★키가 없으면 러너가 **죽는다**. 조용히 기본 경로로 떨어지면 codex 가 기본
  계정으로 붙어 "다른 모델을 재고 라벨만 solar" 인 행이 남는데, 그게 이 벤치에서
  가장 비싼 사고다.
- 이 셀만 다른 홉을 탄다는 사실은 행마다 `vendorRoute` 로 박히고, 마크다운 표와
  사용량 탭("벤더 경유" 배지)이 그대로 보여 준다 — 조건 차이를 표에서 지우지 않는다.
- ★조건 차이 하나 더: 라운드2의 gpt 셀들은 `codex-cli 0.147.0` 으로 쟀고 Solar 는
  `0.148.0` 이다(벤더 경로가 0.148 에서만 성립한다). 셀별 `cliVersion` 이 그 사실을
  들고 다니므로 표에서 확인할 수 있다.

### ★프로바이더 실패는 0점이 아니다

벤더가 429(레이트리밋)로 응답을 주지 않아 codex 가 재시도 한도를 넘겨 죽으면, 그 런에서
**모델은 답을 낸 적이 없다.** 그걸 그대로 채점해 `resolved=false` 로 적으면 **벤더 장애가
모델 실력으로 둔갑**한다(2026-08-20 solar 파일럿에서 6건 중 2건이 이 상태였다).

- `agent.ts: providerFailure(tailLog)` — codex 가 **스스로 포기했다고 적은 줄**
  (`exceeded retry limit, last status: NNN`) 하나로만 판정한다. 로그를 해석해 추측하지 않는다.
- `run.ts` — 그 판정이 섰을 때**만** 재시도한다(`--agent-retries`, `--retry-backoff`).
  ★모델이 못 푼 런은 절대 재시도하지 않는다 — 그건 표본을 유리하게 고르는 짓이다.
  재시도 전에 `resetWorktree()` 로 base 커밋 상태를 복구해 앞 시도의 편집이 섞이지 않게 한다.
- 상한까지 가도 실패면 `record.error` 로 분류돼 **분모 밖**으로 나가고 리포트에 따로 뜬다.
- ★반대로 `unsupported call: apply_patch`(도구 표면 불일치)는 **프로바이더 실패로 치지 않는다.**
  모델이 답을 냈고 하네스가 그 행동을 거절한 것이라 측정은 성립했다 — 분모에서 빼면 점수를
  유리하게 만드는 조작이 된다.
