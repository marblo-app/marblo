# DeepSeek × codex `type:"namespace"` MCP 도구 — 라이브 확정

- **티켓**: `Wx8jLTVl5inuMwv03yb5` (선행: `giW7eJbD` / PR #1067)
- **실행일**: 2026-08-21 · codex-cli 0.149.0 · `deepseek-v4-flash` · 실계정
- **결론 한 줄**: **가설이 틀렸다.** DeepSeek 은 `type:"namespace"` 로 실린 MCP 도구를 버리지 않는다 —
  받아서 호출하고, 응답에 `namespace` 필드까지 그대로 되돌려준다. **DeepSeek 으로 뜬 에이전트·오케는
  MCP 도구를 정상적으로 쓴다.**

## 1. 무엇이 가설이었나

PR #1067 이 **키 없이** 실측한 것(로컬 mock Responses upstream 으로 요청 바디 전량 캡처):

> codex 는 MCP 도구를 개별 `type:"function"` 이 아니라 **`type:"namespace"` 한 덩어리**로 보낸다.
> `mcp__marblo` → `[add_activity, dispatch_task]`, `multi_agent_v1` → 5개.

거기까지는 실측이었다. 그 뒤에 붙은 한 줄이 **추론**이었다:

> DeepSeek 공식 Responses 호환표(api-docs.deepseek.com/guides/responses_api, Tools 절)는
> `function` / `web_search` / `custom`(apply_patch 만) 셋만 열거하고 "그 외 built-in 도구는 무시" 라고 적는다.
> `namespace` 는 그 셋에 없으므로 조용히 버려질 것이다 → **에이전트는 뜨는데 MCP 도구가 0개**일 것이다.

이게 사실이면 딥시크는 벤치 점수와 무관하게 **에이전트로도 티켓을 못 다루는** 모델이 된다. 그래서
이 축은 벤치보다 먼저 확정해야 했다.

## 2. 계측 설계 — "못 봤다" 와 "안 썼다" 를 가르는 법

Solar 때 이 둘을 안 갈라서 하루를 태웠다. 모델이 게을러서 안 부른 것과 도구가 애초에 안 실린 것은
다른 문제고 해법도 다르다. **로그와 UI 로는 절대 갈리지 않는다.**

`v3/scripts/probe-codex-vendor-tools.mjs` 에 `--live` 를 붙였다. codex 와 진짜 벤더 사이에
**기록형 포워드 프록시**를 세워 **요청 바디와 응답 바디를 양쪽 다** 캡처한다.

```
codex 0.149.0 ──▶ 로컬 기록형 프록시(:8903) ──▶ https://api.deepseek.com
   │                    │  (요청·응답 전량 캡처)
   └── stdio MCP 서버(fake, 도구 2개, tools/call 을 파일에 기록)
```

- config.toml / model-catalog.json 은 **우리 실제 제품 코드**로 만든다
  (`renderCodexVendorProviderToml` + `buildCodexModelCatalog`). 손으로 흉내낸 config 를 검증해봐야
  라이브 경로를 증명하지 못한다.
- 권한 플래그는 제품(`agent-config.ts` gpt 분기)과 동일: `approval_policy="never"` +
  `sandbox_mode="danger-full-access"`.
- ★시크릿 규율: 프록시는 벤더 키를 **읽지 않는다.** codex 가 붙인 `authorization` 헤더를 다음 홉으로
  전달만 하고, 캡처 파일에는 **바디만** 적는다(헤더 통째 제외). 키는 `secret-launcher.ts` 가
  safeStorage 에서 꺼내 자식 env 로만 넘긴다.

판정은 **모델의 자기보고에 의존하지 않는다.** 하드 증거 두 개로만 한다:

| 증거                             | 무엇을 말하나                     |
| -------------------------------- | --------------------------------- |
| 벤더 응답 바디의 `function_call` | 모델이 그 도구를 **볼 수 있었다** |
| MCP 서버가 받은 `tools/call`     | 호출이 **끝까지 도달**했다        |

준비해 둔 A/B(같은 codex·같은 모델·같은 프롬프트, **도구 모양만** 변경):

- A `--live` — namespace 그대로
- B `--live --flatten` — `<namespace>__<tool>` 이름의 평탄한 `function` 으로 펼쳐서 전송

A 가 0건이고 B 가 ≥1건이면 **못 본 것**, A/B 둘 다 0건이면 **안 쓴 것**이다.

## 3. 결과 — A 에서 이미 양성이라 B 는 돌리지 않았다

프롬프트: "marblo MCP 서버의 `add_activity` 를 `task_id="probe-001"` 로 지금 호출하라.
그런 도구가 **없을 때만** `NO_MCP_TOOL_VISIBLE` 한 줄로 답하고 멈춰라."

**보낸 것** (요청 바디 캡처, tools 15개 — #1067 실측 그대로 재현):

```
function exec_command / write_stdin / update_plan / view_image / …
custom   apply_patch
namespace multi_agent_v1 -> [close_agent, resume_agent, send_input, spawn_agent, wait_agent]
namespace mcp__marblo    -> [add_activity, dispatch_task]
web_search
```

**돌아온 것** (DeepSeek 응답 SSE 캡처):

```json
{
  "type": "function_call",
  "id": "9f41d1ff-…",
  "call_id": "call_00_f0Uhmqfh4JUFl4bN793M4981",
  "name": "add_activity",
  "namespace": "mcp__marblo",
  "arguments": "{\"task_id\": \"probe-001\"}"
}
```

★도구를 받았을 뿐 아니라 **`namespace` 필드를 codex 가 기대하는 모양 그대로 되돌려준다.**

**루프 완결**: fake MCP 서버가 실제로 `tools/call {name:"add_activity", arguments:{task_id:"probe-001"}}` 를
수신했고, 결과가 모델까지 돌아가 최종 답이 다음과 같았다:

```
`add_activity` is available and returned `ok(probe)`.
```

→ **봤고, 썼고, 끝까지 도달했다.** A 가 양성이므로 B(평탄화 arm)는 판정에 아무것도 더하지 않는다.
실계정 잔액을 쓰는 실험이라 **돌리지 않았다.**

## 4. ★함정 — 1차 시도는 "버려진 것처럼" 보였다

첫 라이브 시도에서 probe 는 `sandbox_mode="read-only"` 로 떴다. 결과:

```
mcp: marblo/add_activity (failed)
MCP tool call requires approval, but approval policy is never
```

- MCP 서버가 받은 호출: **0건**
- 겉보기: "벤더가 도구를 버렸다" 와 **완전히 같은 그림**

갈라준 것은 **응답 바디**였다. 그 런에서도 DeepSeek 은 이미 `function_call` 을 냈고, 막은 것은
**우리 쪽 로컬 권한 설정**이었다. 요청만 봤거나 MCP 서버 로그만 봤다면 그대로 오판했을 것이다.

> **교훈**: 도구 문제를 진단할 땐 요청·응답·도구서버 셋을 **같이** 본다.
> "0건" 은 원인을 말해 주지 않는다.

그래서 probe 의 라이브 기본 sandbox 를 제품과 동일한 `danger-full-access` 로 맞췄다.

## 5. 부수 확정 — apply_patch

같은 계측기의 `--edit-check` 로 #1061 의 미확인 축도 라이브로 닫았다. 판정은 모델의 말이 아니라
**파일 내용**으로 한다.

- 시드: `alpha / bravo / charlie`
- 지시: apply_patch 로 `bravo` → `PATCHED_BY_PROBE`
- 결과: **파일이 실제로 바뀌었다**(다른 줄 무변경), `unsupported call: apply_patch` 거절 **0건**

`codex-model-catalog.ts` 의 벤더 카탈로그(`apply_patch_tool_type="freeform"`)가 라이브에서 동작한다.
Solar 를 무산출 8/12 로 만든 실패모드는 DeepSeek 경로에서 재현되지 않는다.

## 6. 이 결과가 바꾸는 것

| 대상                                                      | 무엇이 바뀌나                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `electron/codex-model-catalog.ts` 상단 "★미해결" 절       | **정정됨.** 추론이 반증됐다는 사실과 반증 증거를 그대로 적었다.                                      |
| 해법 후보 ① Responses→Responses 셔틀로 namespace 평탄화   | **불필요.** 별도 티켓을 내지 않는다.                                                                 |
| 해법 후보 ② codex `experimental_supported_tools`          | **불필요.** 같은 이유.                                                                               |
| `model-registry.ts` `DEEPSEEK_PROBE.cli`                  | "미보유 — 라이브 프로브 대기" → **실측 기록으로 갱신.** `method`(문서 대조)와 같은 칸에 섞지 않는다. |
| 오케 셀렉터 해제(`model-selection.ts` `selectorEligible`) | 이 축의 **차단 사유는 사라졌다.** 다만 해제 여부는 다른 사유(§7)로 별도 판단한다.                    |

## 7. 그래도 오케 셀렉터를 이 티켓에서 열지 않은 이유

`selectorEligible()` 주석이 적은 원래 사유는 MCP 가 아니다:

> 오케 모델 선택은 프로젝트별로 **영구 저장**된다. env-swap 벤더는 별도 구독키가 있어야 도는데,
> 키가 없는 상태로 한 번 저장되면 재시작·크래시 자동재시작·핸드오프가 전부 말없이 그 값으로 뜨고
> 매번 벤더 프로파일 미주입 → 하네스 기본 백엔드로 새는 스폰이 반복된다.

이 사유는 그대로 살아 있다. 키가 오늘 있다는 사실이 그 구조를 바꾸지 않는다 — **이 티켓 자체가
잔액 0 때문에 존재했다.** 안전한 해제는 셀렉터가 퀵레인처럼 `requiredEnvKeys` 게이트를 드는
설계 변경을 요구하므로, 벤치 티켓 말미에 필터 한 줄 지우는 것으로 처리하지 않는다.
명시 지정(`dispatch_task(model="deepseek-v4-flash")`)과 퀵레인 경로는 지금도 그대로 닿는다.

## 8. 재현

```bash
# 무과금 — codex 가 무엇을 보내는지만 본다(로컬 mock upstream)
node scripts/probe-codex-vendor-tools.mjs deepseek-v4-flash
node scripts/probe-codex-vendor-tools.mjs gpt-5.5          # 대조군(내장 카탈로그)

# 라이브 — 진짜 벤더로 흘리고 응답까지 본다. 키는 safeStorage 에서만 온다.
npx tsc -p electron/tsconfig.json
npx electron dist-electron/scripts/bench/secret-launcher.js \
  --secret=DEEPSEEK_API_KEY -- \
  node scripts/probe-codex-vendor-tools.mjs deepseek-v4-flash --live

# apply_patch 확증
npx electron dist-electron/scripts/bench/secret-launcher.js \
  --secret=DEEPSEEK_API_KEY -- \
  node scripts/probe-codex-vendor-tools.mjs deepseek-v4-flash --live --edit-check
```

각 라이브 런은 캡처 디렉터리에 `captured.json`(요청) · `transcript.jsonl`(응답) · `mcp-calls.jsonl` ·
`verdict.json`(판정 요약)을 남긴다. **어느 파일에도 키는 들어가지 않는다.**
