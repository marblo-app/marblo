# SWE-bench — Marblo 자체 실측 (our-measured)

> ★이 표의 숫자는 **우리가 우리 스폰 경로로 직접 잰 값**이다. 벤더 공개치(`electron/model-bench-reference.ts`)와 **같은 표에 놓지 않는다**.
> ★실행환경이 공식 SWE-bench Docker 이미지가 아니므로 **공식 리더보드 수치와 비교할 수 없다.** 여기서 읽어도 되는 것은 *같은 execEnv·같은 scaffold 안에서의 상대 비교*뿐이다.

- 데이터셋: `princeton-nlp/SWE-bench_Verified`
- 인스턴스(전 라운드 합집합 N=14): `django__django-15731`, `django__django-15814`, `django__django-15851`, `django__django-15863`, `django__django-15957`, `django__django-15987`, `django__django-16136`, `django__django-16256`, `django__django-16263`, `django__django-16315`, `django__django-16429`, `django__django-16560`, `django__django-16631`, `django__django-16642`
  - 라운드 `marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` — 고정 N=3
  - 라운드 `marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` — 고정 N=12
- 총 런: 177

## 셀별 요약

| harness  | model             | effort | n(채점) | resolved |  resolved% | 무산출 | 에러 | 평균 에이전트 시간 |
| -------- | ----------------- | ------ | ------: | -------: | ---------: | -----: | ---: | -----------------: |
| `noop`   | (cli default)     | -      |       3 |        0 |   **0.0%** |      0 |    0 |                  - |
| `gold`   | (cli default)     | -      |       3 |        3 | **100.0%** |      0 |    0 |                  - |
| `claude` | claude-opus-5     | -      |       3 |        3 | **100.0%** |      0 |    0 |                33s |
| `claude` | claude-fable-5    | -      |       3 |        3 | **100.0%** |      0 |    0 |                42s |
| `claude` | claude-sonnet-5   | -      |       3 |        3 | **100.0%** |      0 |    0 |                21s |
| `codex`  | gpt-5.6-sol       | medium |       3 |        3 | **100.0%** |      0 |    0 |                39s |
| `codex`  | gpt-5.6-luna      | medium |       3 |        2 |  **66.7%** |      0 |    0 |                55s |
| `noop`   | (cli default)     | -      |      12 |        0 |   **0.0%** |      0 |    0 |                  - |
| `gold`   | (cli default)     | -      |      12 |       12 | **100.0%** |      0 |    0 |                  - |
| `claude` | claude-opus-5     | -      |      12 |       11 |  **91.7%** |      0 |    0 |               180s |
| `claude` | claude-fable-5    | -      |      12 |       12 | **100.0%** |      0 |    0 |                94s |
| `claude` | claude-sonnet-5   | -      |      12 |        9 |  **75.0%** |      0 |    0 |               147s |
| `codex`  | gpt-5.6-sol       | medium |      12 |       11 |  **91.7%** |      0 |    0 |                92s |
| `codex`  | gpt-5.6-terra     | medium |      12 |        9 |  **75.0%** |      0 |    0 |                61s |
| `codex`  | gpt-5.6-luna      | medium |      12 |       10 |  **83.3%** |      0 |    0 |                94s |
| `codex`  | gpt-5.5           | medium |      12 |       11 |  **91.7%** |      0 |    0 |               124s |
| `grok`   | grok-4.5          | -      |      12 |       10 |  **83.3%** |      2 |    0 |                90s |
| `codex`  | solar-pro4        | medium |      12 |        3 |  **25.0%** |      8 |    0 |               226s |
| `codex`  | deepseek-v4-flash | high   |      12 |       11 |  **91.7%** |      0 |    0 |                73s |
| `codex`  | deepseek-v4-pro   | high   |      12 |       12 | **100.0%** |      0 |    0 |               142s |

- `noop` (cli default) scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `gold` (cli default) scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `claude` claude-opus-5 scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.226 (Claude Code)`
- `claude` claude-fable-5 scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.226 (Claude Code)`
- `claude` claude-sonnet-5 scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.226 (Claude Code)`
- `codex` gpt-5.6-sol scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.144.5`
- `codex` gpt-5.6-luna scaffold=`marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.144.5`
- `noop` (cli default) scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `gold` (cli default) scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `claude` claude-opus-5 scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.227 (Claude Code)`
- `claude` claude-fable-5 scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.227 (Claude Code)`
- `claude` claude-sonnet-5 scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.227 (Claude Code)`
- `codex` gpt-5.6-sol scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.147.0`
- `codex` gpt-5.6-terra scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.147.0`
- `codex` gpt-5.6-luna scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.147.0`
- `codex` gpt-5.5 scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.147.0`
- `grok` grok-4.5 scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`grok 1.0.0 (3cd0d0cbcebe)`
- `codex` solar-pro4 scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.148.0` vendorRoute=`upstage/openai-compat via local responses→chat bridge (codex custom provider, apikey auth)`
- `codex` deepseek-v4-flash scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.149.0` vendorRoute=`deepseek/responses-native direct (codex custom provider, apikey auth, model_catalog_json → apply_patch=freeform)`
- `codex` deepseek-v4-pro scaffold=`marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.149.0` vendorRoute=`deepseek/responses-native direct (codex custom provider, apikey auth, model_catalog_json → apply_patch=freeform)`

## 인스턴스 × 셀 (라운드별)

### scaffold `marblo-swebench-spike/v1(single-shot,no-mcp,no-board)`

| instance               | `noop`                  | `gold`                  | `claude`<br>claude-opus-5 | `claude`<br>claude-fable-5 | `claude`<br>claude-sonnet-5 | `codex`<br>gpt-5.6-sol<br>effort=medium | `codex`<br>gpt-5.6-luna<br>effort=medium |
| ---------------------- | ----------------------- | ----------------------- | ------------------------- | -------------------------- | --------------------------- | --------------------------------------- | ---------------------------------------- |
| `django__django-15851` | ❌ (F2P 0/1, P2P 8/8)   | ✅ (F2P 1/1, P2P 8/8)   | ✅ (F2P 1/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)      | ✅ (F2P 1/1, P2P 8/8)       | ✅ (F2P 1/1, P2P 8/8)                   | ✅ (F2P 1/1, P2P 8/8)                    |
| `django__django-16429` | ❌ (F2P 2/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21)   | ✅ (F2P 4/4, P2P 21/21)    | ✅ (F2P 4/4, P2P 21/21)     | ✅ (F2P 4/4, P2P 21/21)                 | ❌ (F2P 1/4, P2P 17/21)                  |
| `django__django-16642` | ❌ (F2P 0/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21)   | ✅ (F2P 1/1, P2P 21/21)    | ✅ (F2P 1/1, P2P 21/21)     | ✅ (F2P 1/1, P2P 21/21)                 | ✅ (F2P 1/1, P2P 21/21)                  |

### scaffold `marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)`

| instance               | `noop`                    | `gold`                    | `claude`<br>claude-opus-5 | `claude`<br>claude-fable-5 | `claude`<br>claude-sonnet-5 | `codex`<br>gpt-5.6-sol<br>effort=medium | `codex`<br>gpt-5.6-terra<br>effort=medium | `codex`<br>gpt-5.6-luna<br>effort=medium | `codex`<br>gpt-5.5<br>effort=medium | `grok`<br>grok-4.5        | `codex`<br>solar-pro4<br>effort=medium | `codex`<br>deepseek-v4-flash<br>effort=high | `codex`<br>deepseek-v4-pro<br>effort=high |
| ---------------------- | ------------------------- | ------------------------- | ------------------------- | -------------------------- | --------------------------- | --------------------------------------- | ----------------------------------------- | ---------------------------------------- | ----------------------------------- | ------------------------- | -------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `django__django-15731` | ❌ (F2P 0/1, P2P 58/58)   | ✅ (F2P 1/1, P2P 58/58)   | ✅ (F2P 1/1, P2P 58/58)   | ✅ (F2P 1/1, P2P 58/58)    | ✅ (F2P 1/1, P2P 58/58)     | ✅ (F2P 1/1, P2P 58/58)                 | ✅ (F2P 1/1, P2P 58/58)                   | ✅ (F2P 1/1, P2P 58/58)                  | ✅ (F2P 1/1, P2P 58/58)             | ✅ (F2P 1/1, P2P 58/58)   | ❌ (F2P 0/1, P2P 58/58)                | ✅ (F2P 1/1, P2P 58/58)                     | ✅ (F2P 1/1, P2P 58/58)                   |
| `django__django-15814` | ❌ (F2P 0/1, P2P 29/29)   | ✅ (F2P 1/1, P2P 29/29)   | ✅ (F2P 1/1, P2P 29/29)   | ✅ (F2P 1/1, P2P 29/29)    | ✅ (F2P 1/1, P2P 29/29)     | ✅ (F2P 1/1, P2P 29/29)                 | ✅ (F2P 1/1, P2P 29/29)                   | ✅ (F2P 1/1, P2P 29/29)                  | ✅ (F2P 1/1, P2P 29/29)             | ✅ (F2P 1/1, P2P 29/29)   | ❌ (F2P 0/1, P2P 29/29)                | ✅ (F2P 1/1, P2P 29/29)                     | ✅ (F2P 1/1, P2P 29/29)                   |
| `django__django-15851` | ❌ (F2P 0/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)      | ✅ (F2P 1/1, P2P 8/8)       | ✅ (F2P 1/1, P2P 8/8)                   | ✅ (F2P 1/1, P2P 8/8)                     | ✅ (F2P 1/1, P2P 8/8)                    | ✅ (F2P 1/1, P2P 8/8)               | ✅ (F2P 1/1, P2P 8/8)     | ❌ (F2P 0/1, P2P 8/8)                  | ✅ (F2P 1/1, P2P 8/8)                       | ✅ (F2P 1/1, P2P 8/8)                     |
| `django__django-15863` | ❌ (F2P 0/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)      | ✅ (F2P 1/1, P2P 9/9)       | ✅ (F2P 1/1, P2P 9/9)                   | ✅ (F2P 1/1, P2P 9/9)                     | ✅ (F2P 1/1, P2P 9/9)                    | ✅ (F2P 1/1, P2P 9/9)               | ✅ (F2P 1/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)                  | ✅ (F2P 1/1, P2P 9/9)                       | ✅ (F2P 1/1, P2P 9/9)                     |
| `django__django-15957` | ❌ (F2P 0/4, P2P 89/89)   | ✅ (F2P 4/4, P2P 89/89)   | ✅ (F2P 4/4, P2P 89/89)   | ✅ (F2P 4/4, P2P 89/89)    | ✅ (F2P 4/4, P2P 89/89)     | ✅ (F2P 4/4, P2P 89/89)                 | ✅ (F2P 4/4, P2P 89/89)                   | ✅ (F2P 4/4, P2P 89/89)                  | ✅ (F2P 4/4, P2P 89/89)             | ✅ (F2P 4/4, P2P 89/89)   | ❌ (F2P 0/4, P2P 89/89)                | ✅ (F2P 4/4, P2P 89/89)                     | ✅ (F2P 4/4, P2P 89/89)                   |
| `django__django-15987` | ❌ (F2P 0/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)    | ❌ (F2P 0/1, P2P 52/52)     | ✅ (F2P 1/1, P2P 52/52)                 | ❌ (F2P 0/1, P2P 52/52)                   | ✅ (F2P 1/1, P2P 52/52)                  | ✅ (F2P 1/1, P2P 52/52)             | ❌ (F2P 0/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)                | ✅ (F2P 1/1, P2P 52/52)                     | ✅ (F2P 1/1, P2P 52/52)                   |
| `django__django-16136` | ❌ (F2P 1/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)      | ✅ (F2P 2/2, P2P 7/7)       | ✅ (F2P 2/2, P2P 7/7)                   | ✅ (F2P 2/2, P2P 7/7)                     | ✅ (F2P 2/2, P2P 7/7)                    | ✅ (F2P 2/2, P2P 7/7)               | ✅ (F2P 2/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)                  | ✅ (F2P 2/2, P2P 7/7)                       | ✅ (F2P 2/2, P2P 7/7)                     |
| `django__django-16256` | ❌ (F2P 0/9, P2P 53/53)   | ✅ (F2P 9/9, P2P 53/53)   | ✅ (F2P 9/9, P2P 53/53)   | ✅ (F2P 9/9, P2P 53/53)    | ❌ (F2P 6/9, P2P 53/53)     | ❌ (F2P 6/9, P2P 53/53)                 | ❌ (F2P 6/9, P2P 53/53)                   | ❌ (F2P 6/9, P2P 53/53)                  | ❌ (F2P 6/9, P2P 53/53)             | ✅ (F2P 9/9, P2P 53/53)   | ❌ (F2P 0/9, P2P 53/53)                | ❌ (F2P 6/9, P2P 53/53)                     | ✅ (F2P 9/9, P2P 53/53)                   |
| `django__django-16263` | ❌ (F2P 0/3, P2P 100/100) | ✅ (F2P 3/3, P2P 100/100) | ❌ (F2P 1/3, P2P 100/100) | ✅ (F2P 3/3, P2P 100/100)  | ✅ (F2P 3/3, P2P 100/100)   | ✅ (F2P 3/3, P2P 100/100)               | ✅ (F2P 3/3, P2P 100/100)                 | ✅ (F2P 3/3, P2P 100/100)                | ✅ (F2P 3/3, P2P 100/100)           | ❌ (F2P 0/3, P2P 100/100) | ❌ (F2P 0/3, P2P 100/100)              | ✅ (F2P 3/3, P2P 100/100)                   | ✅ (F2P 3/3, P2P 100/100)                 |
| `django__django-16315` | ❌ (F2P 0/1, P2P 42/42)   | ✅ (F2P 1/1, P2P 42/42)   | ✅ (F2P 1/1, P2P 42/42)   | ✅ (F2P 1/1, P2P 42/42)    | ✅ (F2P 1/1, P2P 42/42)     | ✅ (F2P 1/1, P2P 42/42)                 | ❌ (F2P 0/1, P2P 35/42)                   | ❌ (F2P 0/1, P2P 35/42)                  | ✅ (F2P 1/1, P2P 42/42)             | ✅ (F2P 1/1, P2P 42/42)   | ❌ (F2P 0/1, P2P 42/42)                | ✅ (F2P 1/1, P2P 42/42)                     | ✅ (F2P 1/1, P2P 42/42)                   |
| `django__django-16560` | ❌ (F2P 0/8, P2P 66/66)   | ✅ (F2P 8/8, P2P 66/66)   | ✅ (F2P 8/8, P2P 66/66)   | ✅ (F2P 8/8, P2P 66/66)    | ✅ (F2P 8/8, P2P 66/66)     | ✅ (F2P 8/8, P2P 66/66)                 | ✅ (F2P 8/8, P2P 66/66)                   | ✅ (F2P 8/8, P2P 66/66)                  | ✅ (F2P 8/8, P2P 66/66)             | ✅ (F2P 8/8, P2P 66/66)   | ❌ (F2P 0/8, P2P 66/66)                | ✅ (F2P 8/8, P2P 66/66)                     | ✅ (F2P 8/8, P2P 66/66)                   |
| `django__django-16631` | ❌ (F2P 0/1, P2P 12/12)   | ✅ (F2P 1/1, P2P 12/12)   | ✅ (F2P 1/1, P2P 12/12)   | ✅ (F2P 1/1, P2P 12/12)    | ❌ (F2P 0/1, P2P 12/12)     | ✅ (F2P 1/1, P2P 12/12)                 | ✅ (F2P 1/1, P2P 12/12)                   | ✅ (F2P 1/1, P2P 12/12)                  | ✅ (F2P 1/1, P2P 12/12)             | ✅ (F2P 1/1, P2P 12/12)   | ❌ (F2P 0/1, P2P 12/12)                | ✅ (F2P 1/1, P2P 12/12)                     | ✅ (F2P 1/1, P2P 12/12)                   |

_생성: `npm run bench:swe:report` · 2026-08-21T04:10:47.371Z_
