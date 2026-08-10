# SWE-bench — Marblo 자체 실측 (our-measured)

> ★이 표의 숫자는 **우리가 우리 스폰 경로로 직접 잰 값**이다. 벤더 공개치(`electron/model-bench-reference.ts`)와 **같은 표에 놓지 않는다**.
> ★실행환경이 공식 SWE-bench Docker 이미지가 아니므로 **공식 리더보드 수치와 비교할 수 없다.** 여기서 읽어도 되는 것은 *같은 execEnv·같은 scaffold 안에서의 상대 비교*뿐이다.

- 데이터셋: `princeton-nlp/SWE-bench_Verified`
- 인스턴스(고정 N=3): `django__django-15851`, `django__django-16429`, `django__django-16642`
- 총 런: 12

## 셀별 요약

| harness | model | effort | n(채점) | resolved | resolved% | 무산출 | 에러 | 평균 에이전트 시간 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `noop` | (cli default) | - | 3 | 0 | **0.0%** | 0 | 0 | - |
| `gold` | (cli default) | - | 3 | 3 | **100.0%** | 0 | 0 | - |
| `claude` | claude-sonnet-5 | - | 3 | 3 | **100.0%** | 0 | 0 | 39s |
| `codex` | gpt-5.6-luna | medium | 3 | 3 | **100.0%** | 0 | 0 | 53s |

- `noop` scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `gold` scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `claude` scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.226 (Claude Code)`
- `codex` scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.147.0`

## 인스턴스 × 하네스

| instance | noop | gold | claude | codex |
| --- | --- | --- | --- | --- |
| `django__django-15851` | ❌ (F2P 0/1, P2P 8/8) | ✅ (F2P 1/1, P2P 8/8) | ✅ (F2P 1/1, P2P 8/8) | ✅ (F2P 1/1, P2P 8/8) |
| `django__django-16429` | ❌ (F2P 2/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21) |
| `django__django-16642` | ❌ (F2P 0/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21) |

_생성: `npm run bench:swe:report` · 2026-08-10T09:23:36.158Z_
