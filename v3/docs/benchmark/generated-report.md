# SWE-bench — Marblo 자체 실측 (our-measured)

> ★이 표의 숫자는 **우리가 우리 스폰 경로로 직접 잰 값**이다. 벤더 공개치(`electron/model-bench-reference.ts`)와 **같은 표에 놓지 않는다**.
> ★**(모델, 하네스)** 비교이며 단발 런이라 재실행 분산은 아직 측정하지 않았다.
> ★실행환경이 공식 SWE-bench Docker 이미지가 아니므로 **공식 리더보드 수치와 비교할 수 없다.** 여기서 읽어도 되는 것은 *같은 execEnv·같은 scaffold 안에서의 상대 비교*뿐이다.

- 데이터셋: `princeton-nlp/SWE-bench_Verified`
- 인스턴스(전 라운드 합집합 N=29): `django__django-14725`, `django__django-14771`, `django__django-15022`, `django__django-15037`, `django__django-15098`, `django__django-15103`, `django__django-15128`, `django__django-15161`, `django__django-15252`, `django__django-15268`, `django__django-15278`, `django__django-15280`, `django__django-15375`, `django__django-15503`, `django__django-15629`, `django__django-15731`, `django__django-15814`, `django__django-15851`, `django__django-15863`, `django__django-15957`, `django__django-15987`, `django__django-16136`, `django__django-16256`, `django__django-16263`, `django__django-16315`, `django__django-16429`, `django__django-16560`, `django__django-16631`, `django__django-16642`
  - 라운드 `marblo-swebench-spike/v1(single-shot,no-mcp,no-board)` — 고정 N=3
  - 라운드 `marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)` — 고정 N=12
  - 라운드 `marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)` — 고정 N=20
  - 라운드 `marblo-swebench-spike/v3a(12-mixed-difficulty,single-shot,no-mcp,no-board,metered)` — 고정 N=12
- 총 런: 325

## 셀별 요약

| harness  | model             | effort | n(채점) | resolved |  resolved% | 무산출 | 에러 | 평균 에이전트 시간 |   입력토큰 | 출력토큰 | 벤더청구$ |
| -------- | ----------------- | ------ | ------: | -------: | ---------: | -----: | ---: | -----------------: | ---------: | -------: | --------: |
| `noop`   | (cli default)     | -      |       3 |        0 |   **0.0%** |      0 |    0 |                  - |     미계측 |   미계측 |    미제공 |
| `gold`   | (cli default)     | -      |       3 |        3 | **100.0%** |      0 |    0 |                  - |     미계측 |   미계측 |    미제공 |
| `claude` | claude-opus-5     | -      |       3 |        3 | **100.0%** |      0 |    0 |                33s |     미계측 |   미계측 |    미제공 |
| `claude` | claude-fable-5    | -      |       3 |        3 | **100.0%** |      0 |    0 |                42s |     미계측 |   미계측 |    미제공 |
| `claude` | claude-sonnet-5   | -      |       3 |        3 | **100.0%** |      0 |    0 |                21s |     미계측 |   미계측 |    미제공 |
| `codex`  | gpt-5.6-sol       | medium |       3 |        3 | **100.0%** |      0 |    0 |                39s |     미계측 |   미계측 |    미제공 |
| `codex`  | gpt-5.6-luna      | medium |       3 |        2 |  **66.7%** |      0 |    0 |                55s |     미계측 |   미계측 |    미제공 |
| `noop`   | (cli default)     | -      |      12 |        0 |   **0.0%** |      0 |    0 |                  - |     미계측 |   미계측 |    미제공 |
| `gold`   | (cli default)     | -      |      24 |       24 | **100.0%** |      0 |    0 |                  - |     미계측 |   미계측 |    미제공 |
| `claude` | claude-opus-5     | -      |      12 |       11 |  **91.7%** |      0 |    0 |               180s |     미계측 |   미계측 |    미제공 |
| `claude` | claude-fable-5    | -      |      12 |       12 | **100.0%** |      0 |    0 |                94s |     미계측 |   미계측 |    미제공 |
| `claude` | claude-sonnet-5   | -      |      12 |        9 |  **75.0%** |      0 |    0 |               147s |     미계측 |   미계측 |    미제공 |
| `codex`  | gpt-5.6-sol       | medium |      12 |       11 |  **91.7%** |      0 |    0 |                92s |     미계측 |   미계측 |    미제공 |
| `codex`  | gpt-5.6-terra     | medium |      12 |        9 |  **75.0%** |      0 |    0 |                61s |     미계측 |   미계측 |    미제공 |
| `codex`  | gpt-5.6-luna      | medium |      12 |       10 |  **83.3%** |      0 |    0 |                94s |     미계측 |   미계측 |    미제공 |
| `codex`  | gpt-5.5           | medium |      12 |       11 |  **91.7%** |      0 |    0 |               124s |     미계측 |   미계측 |    미제공 |
| `grok`   | grok-4.5          | -      |      12 |       10 |  **83.3%** |      2 |    0 |                90s |     미계측 |   미계측 |    미제공 |
| `codex`  | solar-pro4        | medium |      12 |        3 |  **25.0%** |      8 |    0 |               226s |     미계측 |   미계측 |    미제공 |
| `codex`  | deepseek-v4-flash | high   |      12 |       11 |  **91.7%** |      0 |    0 |                73s |     미계측 |   미계측 |    미제공 |
| `codex`  | deepseek-v4-pro   | high   |      12 |       12 | **100.0%** |      0 |    0 |               142s |     미계측 |   미계측 |    미제공 |
| `gold`   | (cli default)     | -      |      20 |       20 | **100.0%** |      0 |    0 |                  - |     미계측 |   미계측 |    미제공 |
| `noop`   | (cli default)     | -      |      20 |        0 |   **0.0%** |      0 |    0 |                  - |     미계측 |   미계측 |    미제공 |
| `claude` | claude-fable-5-1  | -      |      12 |       11 |  **91.7%** |      0 |    0 |                98s |  4,794,624 |   81,316 |    $12.75 |
| `codex`  | gpt-6-astra       | medium |      12 |       10 |  **83.3%** |      0 |    0 |                61s |  1,703,939 |   16,551 |    미제공 |
| `claude` | claude-opus-5     | -      |      12 |       10 |  **83.3%** |      0 |    0 |                74s |  6,469,726 |   64,673 |     $8.44 |
| `claude` | claude-fable-5-1  | -      |      20 |       18 |  **90.0%** |      0 |    0 |               243s | 11,053,578 |  173,610 |    $25.13 |
| `codex`  | gpt-6-astra       | medium |      20 |       14 |  **70.0%** |      0 |    0 |                69s |  3,843,724 |   27,964 |    미제공 |
| `claude` | claude-opus-5     | -      |      20 |       19 |  **95.0%** |      0 |    0 |               171s | 17,886,666 |  179,103 |    $20.68 |

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
- `gold` (cli default) scaffold=`marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `noop` (cli default) scaffold=`marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`-`
- `claude` claude-fable-5-1 scaffold=`marblo-swebench-spike/v3a(12-mixed-difficulty,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.261 (Claude Code)`
- `codex` gpt-6-astra scaffold=`marblo-swebench-spike/v3a(12-mixed-difficulty,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.153.3`
- `claude` claude-opus-5 scaffold=`marblo-swebench-spike/v3a(12-mixed-difficulty,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.261 (Claude Code)`
- `claude` claude-fable-5-1 scaffold=`marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.261 (Claude Code)`
- `codex` gpt-6-astra scaffold=`marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`codex-cli 0.153.4`
- `claude` claude-opus-5 scaffold=`marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)` execEnv=`native-venv/macos-arm64(no-docker)` grader=`v2(id-alias+mismatch-gate)` cli=`2.1.261 (Claude Code)`

## 인스턴스 × 셀 (라운드별)

### scaffold `marblo-swebench-spike/v1(single-shot,no-mcp,no-board)`

| instance               | `noop`                  | `gold`                  | `claude`<br>claude-opus-5 | `claude`<br>claude-fable-5 | `claude`<br>claude-sonnet-5 | `codex`<br>gpt-5.6-sol<br>effort=medium | `codex`<br>gpt-5.6-luna<br>effort=medium |
| ---------------------- | ----------------------- | ----------------------- | ------------------------- | -------------------------- | --------------------------- | --------------------------------------- | ---------------------------------------- |
| `django__django-15851` | ❌ (F2P 0/1, P2P 8/8)   | ✅ (F2P 1/1, P2P 8/8)   | ✅ (F2P 1/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)      | ✅ (F2P 1/1, P2P 8/8)       | ✅ (F2P 1/1, P2P 8/8)                   | ✅ (F2P 1/1, P2P 8/8)                    |
| `django__django-16429` | ❌ (F2P 2/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21) | ✅ (F2P 4/4, P2P 21/21)   | ✅ (F2P 4/4, P2P 21/21)    | ✅ (F2P 4/4, P2P 21/21)     | ✅ (F2P 4/4, P2P 21/21)                 | ❌ (F2P 1/4, P2P 17/21)                  |
| `django__django-16642` | ❌ (F2P 0/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21) | ✅ (F2P 1/1, P2P 21/21)   | ✅ (F2P 1/1, P2P 21/21)    | ✅ (F2P 1/1, P2P 21/21)     | ✅ (F2P 1/1, P2P 21/21)                 | ✅ (F2P 1/1, P2P 21/21)                  |

### scaffold `marblo-swebench-spike/v2(12-mixed-difficulty,single-shot,no-mcp,no-board)`

| instance               | `noop`                    | `gold`                                                 | `claude`<br>claude-opus-5 | `claude`<br>claude-fable-5 | `claude`<br>claude-sonnet-5 | `codex`<br>gpt-5.6-sol<br>effort=medium | `codex`<br>gpt-5.6-terra<br>effort=medium | `codex`<br>gpt-5.6-luna<br>effort=medium | `codex`<br>gpt-5.5<br>effort=medium | `grok`<br>grok-4.5        | `codex`<br>solar-pro4<br>effort=medium | `codex`<br>deepseek-v4-flash<br>effort=high | `codex`<br>deepseek-v4-pro<br>effort=high |
| ---------------------- | ------------------------- | ------------------------------------------------------ | ------------------------- | -------------------------- | --------------------------- | --------------------------------------- | ----------------------------------------- | ---------------------------------------- | ----------------------------------- | ------------------------- | -------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `django__django-15731` | ❌ (F2P 0/1, P2P 58/58)   | ✅ (F2P 1/1, P2P 58/58)<br>✅ (F2P 1/1, P2P 58/58)     | ✅ (F2P 1/1, P2P 58/58)   | ✅ (F2P 1/1, P2P 58/58)    | ✅ (F2P 1/1, P2P 58/58)     | ✅ (F2P 1/1, P2P 58/58)                 | ✅ (F2P 1/1, P2P 58/58)                   | ✅ (F2P 1/1, P2P 58/58)                  | ✅ (F2P 1/1, P2P 58/58)             | ✅ (F2P 1/1, P2P 58/58)   | ❌ (F2P 0/1, P2P 58/58)                | ✅ (F2P 1/1, P2P 58/58)                     | ✅ (F2P 1/1, P2P 58/58)                   |
| `django__django-15814` | ❌ (F2P 0/1, P2P 29/29)   | ✅ (F2P 1/1, P2P 29/29)<br>✅ (F2P 1/1, P2P 29/29)     | ✅ (F2P 1/1, P2P 29/29)   | ✅ (F2P 1/1, P2P 29/29)    | ✅ (F2P 1/1, P2P 29/29)     | ✅ (F2P 1/1, P2P 29/29)                 | ✅ (F2P 1/1, P2P 29/29)                   | ✅ (F2P 1/1, P2P 29/29)                  | ✅ (F2P 1/1, P2P 29/29)             | ✅ (F2P 1/1, P2P 29/29)   | ❌ (F2P 0/1, P2P 29/29)                | ✅ (F2P 1/1, P2P 29/29)                     | ✅ (F2P 1/1, P2P 29/29)                   |
| `django__django-15851` | ❌ (F2P 0/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)<br>✅ (F2P 1/1, P2P 8/8)         | ✅ (F2P 1/1, P2P 8/8)     | ✅ (F2P 1/1, P2P 8/8)      | ✅ (F2P 1/1, P2P 8/8)       | ✅ (F2P 1/1, P2P 8/8)                   | ✅ (F2P 1/1, P2P 8/8)                     | ✅ (F2P 1/1, P2P 8/8)                    | ✅ (F2P 1/1, P2P 8/8)               | ✅ (F2P 1/1, P2P 8/8)     | ❌ (F2P 0/1, P2P 8/8)                  | ✅ (F2P 1/1, P2P 8/8)                       | ✅ (F2P 1/1, P2P 8/8)                     |
| `django__django-15863` | ❌ (F2P 0/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)<br>✅ (F2P 1/1, P2P 9/9)         | ✅ (F2P 1/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)      | ✅ (F2P 1/1, P2P 9/9)       | ✅ (F2P 1/1, P2P 9/9)                   | ✅ (F2P 1/1, P2P 9/9)                     | ✅ (F2P 1/1, P2P 9/9)                    | ✅ (F2P 1/1, P2P 9/9)               | ✅ (F2P 1/1, P2P 9/9)     | ✅ (F2P 1/1, P2P 9/9)                  | ✅ (F2P 1/1, P2P 9/9)                       | ✅ (F2P 1/1, P2P 9/9)                     |
| `django__django-15957` | ❌ (F2P 0/4, P2P 89/89)   | ✅ (F2P 4/4, P2P 89/89)<br>✅ (F2P 4/4, P2P 89/89)     | ✅ (F2P 4/4, P2P 89/89)   | ✅ (F2P 4/4, P2P 89/89)    | ✅ (F2P 4/4, P2P 89/89)     | ✅ (F2P 4/4, P2P 89/89)                 | ✅ (F2P 4/4, P2P 89/89)                   | ✅ (F2P 4/4, P2P 89/89)                  | ✅ (F2P 4/4, P2P 89/89)             | ✅ (F2P 4/4, P2P 89/89)   | ❌ (F2P 0/4, P2P 89/89)                | ✅ (F2P 4/4, P2P 89/89)                     | ✅ (F2P 4/4, P2P 89/89)                   |
| `django__django-15987` | ❌ (F2P 0/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)<br>✅ (F2P 1/1, P2P 52/52)     | ✅ (F2P 1/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)    | ❌ (F2P 0/1, P2P 52/52)     | ✅ (F2P 1/1, P2P 52/52)                 | ❌ (F2P 0/1, P2P 52/52)                   | ✅ (F2P 1/1, P2P 52/52)                  | ✅ (F2P 1/1, P2P 52/52)             | ❌ (F2P 0/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)                | ✅ (F2P 1/1, P2P 52/52)                     | ✅ (F2P 1/1, P2P 52/52)                   |
| `django__django-16136` | ❌ (F2P 1/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)<br>✅ (F2P 2/2, P2P 7/7)         | ✅ (F2P 2/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)      | ✅ (F2P 2/2, P2P 7/7)       | ✅ (F2P 2/2, P2P 7/7)                   | ✅ (F2P 2/2, P2P 7/7)                     | ✅ (F2P 2/2, P2P 7/7)                    | ✅ (F2P 2/2, P2P 7/7)               | ✅ (F2P 2/2, P2P 7/7)     | ✅ (F2P 2/2, P2P 7/7)                  | ✅ (F2P 2/2, P2P 7/7)                       | ✅ (F2P 2/2, P2P 7/7)                     |
| `django__django-16256` | ❌ (F2P 0/9, P2P 53/53)   | ✅ (F2P 9/9, P2P 53/53)<br>✅ (F2P 9/9, P2P 53/53)     | ✅ (F2P 9/9, P2P 53/53)   | ✅ (F2P 9/9, P2P 53/53)    | ❌ (F2P 6/9, P2P 53/53)     | ❌ (F2P 6/9, P2P 53/53)                 | ❌ (F2P 6/9, P2P 53/53)                   | ❌ (F2P 6/9, P2P 53/53)                  | ❌ (F2P 6/9, P2P 53/53)             | ✅ (F2P 9/9, P2P 53/53)   | ❌ (F2P 0/9, P2P 53/53)                | ❌ (F2P 6/9, P2P 53/53)                     | ✅ (F2P 9/9, P2P 53/53)                   |
| `django__django-16263` | ❌ (F2P 0/3, P2P 100/100) | ✅ (F2P 3/3, P2P 100/100)<br>✅ (F2P 3/3, P2P 100/100) | ❌ (F2P 1/3, P2P 100/100) | ✅ (F2P 3/3, P2P 100/100)  | ✅ (F2P 3/3, P2P 100/100)   | ✅ (F2P 3/3, P2P 100/100)               | ✅ (F2P 3/3, P2P 100/100)                 | ✅ (F2P 3/3, P2P 100/100)                | ✅ (F2P 3/3, P2P 100/100)           | ❌ (F2P 0/3, P2P 100/100) | ❌ (F2P 0/3, P2P 100/100)              | ✅ (F2P 3/3, P2P 100/100)                   | ✅ (F2P 3/3, P2P 100/100)                 |
| `django__django-16315` | ❌ (F2P 0/1, P2P 42/42)   | ✅ (F2P 1/1, P2P 42/42)<br>✅ (F2P 1/1, P2P 42/42)     | ✅ (F2P 1/1, P2P 42/42)   | ✅ (F2P 1/1, P2P 42/42)    | ✅ (F2P 1/1, P2P 42/42)     | ✅ (F2P 1/1, P2P 42/42)                 | ❌ (F2P 0/1, P2P 35/42)                   | ❌ (F2P 0/1, P2P 35/42)                  | ✅ (F2P 1/1, P2P 42/42)             | ✅ (F2P 1/1, P2P 42/42)   | ❌ (F2P 0/1, P2P 42/42)                | ✅ (F2P 1/1, P2P 42/42)                     | ✅ (F2P 1/1, P2P 42/42)                   |
| `django__django-16560` | ❌ (F2P 0/8, P2P 66/66)   | ✅ (F2P 8/8, P2P 66/66)<br>✅ (F2P 8/8, P2P 66/66)     | ✅ (F2P 8/8, P2P 66/66)   | ✅ (F2P 8/8, P2P 66/66)    | ✅ (F2P 8/8, P2P 66/66)     | ✅ (F2P 8/8, P2P 66/66)                 | ✅ (F2P 8/8, P2P 66/66)                   | ✅ (F2P 8/8, P2P 66/66)                  | ✅ (F2P 8/8, P2P 66/66)             | ✅ (F2P 8/8, P2P 66/66)   | ❌ (F2P 0/8, P2P 66/66)                | ✅ (F2P 8/8, P2P 66/66)                     | ✅ (F2P 8/8, P2P 66/66)                   |
| `django__django-16631` | ❌ (F2P 0/1, P2P 12/12)   | ✅ (F2P 1/1, P2P 12/12)<br>✅ (F2P 1/1, P2P 12/12)     | ✅ (F2P 1/1, P2P 12/12)   | ✅ (F2P 1/1, P2P 12/12)    | ❌ (F2P 0/1, P2P 12/12)     | ✅ (F2P 1/1, P2P 12/12)                 | ✅ (F2P 1/1, P2P 12/12)                   | ✅ (F2P 1/1, P2P 12/12)                  | ✅ (F2P 1/1, P2P 12/12)             | ✅ (F2P 1/1, P2P 12/12)   | ❌ (F2P 0/1, P2P 12/12)                | ✅ (F2P 1/1, P2P 12/12)                     | ✅ (F2P 1/1, P2P 12/12)                   |

### scaffold `marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)`

| instance               | `gold`                    | `noop`                    | `claude`<br>claude-fable-5-1 | `codex`<br>gpt-6-astra<br>effort=medium | `claude`<br>claude-opus-5 |
| ---------------------- | ------------------------- | ------------------------- | ---------------------------- | --------------------------------------- | ------------------------- |
| `django__django-14725` | ✅ (F2P 3/3, P2P 64/64)   | ❌ (F2P 0/3, P2P 64/64)   | ✅ (F2P 3/3, P2P 64/64)      | ✅ (F2P 3/3, P2P 64/64)                 | ✅ (F2P 3/3, P2P 64/64)   |
| `django__django-14771` | ✅ (F2P 1/1, P2P 60/60)   | ❌ (F2P 0/1, P2P 60/60)   | ✅ (F2P 1/1, P2P 60/60)      | ❌ (F2P 0/1, P2P 60/60)                 | ✅ (F2P 1/1, P2P 60/60)   |
| `django__django-15022` | ✅ (F2P 3/3, P2P 56/56)   | ❌ (F2P 0/3, P2P 56/56)   | ✅ (F2P 3/3, P2P 56/56)      | ✅ (F2P 3/3, P2P 56/56)                 | ✅ (F2P 3/3, P2P 56/56)   |
| `django__django-15037` | ✅ (F2P 1/1, P2P 14/14)   | ❌ (F2P 0/1, P2P 14/14)   | ✅ (F2P 1/1, P2P 14/14)      | ✅ (F2P 1/1, P2P 14/14)                 | ✅ (F2P 1/1, P2P 14/14)   |
| `django__django-15098` | ✅ (F2P 2/2, P2P 88/88)   | ❌ (F2P 1/2, P2P 88/88)   | ✅ (F2P 2/2, P2P 88/88)      | ❌ (F2P 1/2, P2P 87/88)                 | ✅ (F2P 2/2, P2P 88/88)   |
| `django__django-15103` | ✅ (F2P 2/2, P2P 17/17)   | ❌ (F2P 0/2, P2P 17/17)   | ✅ (F2P 2/2, P2P 17/17)      | ✅ (F2P 2/2, P2P 17/17)                 | ✅ (F2P 2/2, P2P 17/17)   |
| `django__django-15128` | ✅ (F2P 1/1, P2P 282/282) | ❌ (F2P 0/1, P2P 282/282) | ✅ (F2P 1/1, P2P 282/282)    | ✅ (F2P 1/1, P2P 282/282)               | ✅ (F2P 1/1, P2P 282/282) |
| `django__django-15161` | ✅ (F2P 3/3, P2P 208/208) | ❌ (F2P 0/3, P2P 208/208) | ✅ (F2P 3/3, P2P 208/208)    | ✅ (F2P 3/3, P2P 208/208)               | ✅ (F2P 3/3, P2P 208/208) |
| `django__django-15252` | ✅ (F2P 2/2, P2P 34/34)   | ❌ (F2P 0/2, P2P 34/34)   | ❌ (F2P 0/2, P2P 34/34)      | ❌ (F2P 0/2, P2P 34/34)                 | ✅ (F2P 2/2, P2P 34/34)   |
| `django__django-15268` | ✅ (F2P 3/3, P2P 130/130) | ❌ (F2P 0/3, P2P 130/130) | ✅ (F2P 3/3, P2P 130/130)    | ✅ (F2P 3/3, P2P 130/130)               | ✅ (F2P 3/3, P2P 130/130) |
| `django__django-15278` | ✅ (F2P 1/1, P2P 138/138) | ❌ (F2P 0/1, P2P 138/138) | ✅ (F2P 1/1, P2P 138/138)    | ✅ (F2P 1/1, P2P 138/138)               | ✅ (F2P 1/1, P2P 138/138) |
| `django__django-15280` | ✅ (F2P 1/1, P2P 85/85)   | ❌ (F2P 0/1, P2P 85/85)   | ✅ (F2P 1/1, P2P 85/85)      | ✅ (F2P 1/1, P2P 85/85)                 | ✅ (F2P 1/1, P2P 85/85)   |
| `django__django-15375` | ✅ (F2P 1/1, P2P 95/95)   | ❌ (F2P 0/1, P2P 95/95)   | ✅ (F2P 1/1, P2P 95/95)      | ✅ (F2P 1/1, P2P 95/95)                 | ✅ (F2P 1/1, P2P 95/95)   |
| `django__django-15503` | ✅ (F2P 2/2, P2P 78/78)   | ❌ (F2P 1/2, P2P 78/78)   | ✅ (F2P 2/2, P2P 78/78)      | ✅ (F2P 2/2, P2P 78/78)                 | ✅ (F2P 2/2, P2P 78/78)   |
| `django__django-15629` | ✅ (F2P 2/2, P2P 115/115) | ❌ (F2P 0/2, P2P 115/115) | ✅ (F2P 2/2, P2P 115/115)    | ❌ (F2P 1/2, P2P 115/115)               | ❌ (F2P 1/2, P2P 115/115) |
| `django__django-15987` | ✅ (F2P 1/1, P2P 52/52)   | ❌ (F2P 0/1, P2P 52/52)   | ✅ (F2P 1/1, P2P 52/52)      | ✅ (F2P 1/1, P2P 52/52)                 | ✅ (F2P 1/1, P2P 52/52)   |
| `django__django-16256` | ✅ (F2P 9/9, P2P 53/53)   | ❌ (F2P 0/9, P2P 53/53)   | ❌ (F2P 6/9, P2P 53/53)      | ❌ (F2P 6/9, P2P 53/53)                 | ✅ (F2P 9/9, P2P 53/53)   |
| `django__django-16263` | ✅ (F2P 3/3, P2P 100/100) | ❌ (F2P 0/3, P2P 100/100) | ✅ (F2P 3/3, P2P 100/100)    | ❌ (F2P 1/3, P2P 100/100)               | ✅ (F2P 3/3, P2P 100/100) |
| `django__django-16315` | ✅ (F2P 1/1, P2P 42/42)   | ❌ (F2P 0/1, P2P 42/42)   | ✅ (F2P 1/1, P2P 42/42)      | ✅ (F2P 1/1, P2P 42/42)                 | ✅ (F2P 1/1, P2P 42/42)   |
| `django__django-16631` | ✅ (F2P 1/1, P2P 12/12)   | ❌ (F2P 0/1, P2P 12/12)   | ✅ (F2P 1/1, P2P 12/12)      | ✅ (F2P 1/1, P2P 12/12)                 | ✅ (F2P 1/1, P2P 12/12)   |

### scaffold `marblo-swebench-spike/v3a(12-mixed-difficulty,single-shot,no-mcp,no-board,metered)`

| instance               | `claude`<br>claude-fable-5-1 | `codex`<br>gpt-6-astra<br>effort=medium | `claude`<br>claude-opus-5 |
| ---------------------- | ---------------------------- | --------------------------------------- | ------------------------- |
| `django__django-15731` | ✅ (F2P 1/1, P2P 58/58)      | ✅ (F2P 1/1, P2P 58/58)                 | ✅ (F2P 1/1, P2P 58/58)   |
| `django__django-15814` | ✅ (F2P 1/1, P2P 29/29)      | ✅ (F2P 1/1, P2P 29/29)                 | ✅ (F2P 1/1, P2P 29/29)   |
| `django__django-15851` | ✅ (F2P 1/1, P2P 8/8)        | ✅ (F2P 1/1, P2P 8/8)                   | ✅ (F2P 1/1, P2P 8/8)     |
| `django__django-15863` | ✅ (F2P 1/1, P2P 9/9)        | ✅ (F2P 1/1, P2P 9/9)                   | ✅ (F2P 1/1, P2P 9/9)     |
| `django__django-15957` | ✅ (F2P 4/4, P2P 89/89)      | ✅ (F2P 4/4, P2P 89/89)                 | ✅ (F2P 4/4, P2P 89/89)   |
| `django__django-15987` | ✅ (F2P 1/1, P2P 52/52)      | ✅ (F2P 1/1, P2P 52/52)                 | ✅ (F2P 1/1, P2P 52/52)   |
| `django__django-16136` | ✅ (F2P 2/2, P2P 7/7)        | ✅ (F2P 2/2, P2P 7/7)                   | ✅ (F2P 2/2, P2P 7/7)     |
| `django__django-16256` | ❌ (F2P 6/9, P2P 53/53)      | ❌ (F2P 6/9, P2P 53/53)                 | ❌ (F2P 6/9, P2P 53/53)   |
| `django__django-16263` | ✅ (F2P 3/3, P2P 100/100)    | ❌ (F2P 1/3, P2P 100/100)               | ✅ (F2P 3/3, P2P 100/100) |
| `django__django-16315` | ✅ (F2P 1/1, P2P 42/42)      | ✅ (F2P 1/1, P2P 42/42)                 | ✅ (F2P 1/1, P2P 42/42)   |
| `django__django-16560` | ✅ (F2P 8/8, P2P 66/66)      | ✅ (F2P 8/8, P2P 66/66)                 | ❌ (F2P 6/8, P2P 66/66)   |
| `django__django-16631` | ✅ (F2P 1/1, P2P 12/12)      | ✅ (F2P 1/1, P2P 12/12)                 | ✅ (F2P 1/1, P2P 12/12)   |

_생성: `npm run bench:swe:report` · 2026-09-05T08:50:40.551Z_
