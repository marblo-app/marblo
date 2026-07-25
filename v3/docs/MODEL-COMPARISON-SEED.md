# Claude ↔ GPT 모델 비교 + 지식그래프 1차 콜드스타트 주입

- 티켓: `150oZRiDRDNzC2N9JBli` (라우팅·데이터 P1)
- 작성: 2026-07-25
- 관련: `docs/superpowers/specs/2026-07-22-live-knowledge-graph-routing-design.md`, `electron/routing-graph.ts`, `electron/dispatch-scoring.ts`, `electron/agent-config.ts`

---

## 0. 30초 요약

1. **GPT 가격을 공식 출처에서 확정**했고, 그 과정에서 **사내에 박혀 있던 GPT 가격 가정이 틀렸다**는 걸 발견했다 (`gpt-5.5` 출력 $20 로 기록 → 실제 **$30**).
2. **"GPT = 저가 fleet" 이라는 전제가 현재 설정에선 성립하지 않는다.** 우리가 실제로 돌리는 `gpt-5.5`($5/$30)는 우리 Claude simple 티어인 `sonnet-5`($3/$15)보다 **비싸다**.
3. **complex 티어에 비대칭이 있다.** Claude 는 complex 에서 *모델*을 최상위(`fable-5`)로 올리는데, GPT 는 _reasoning effort_ 만 올리고 모델은 그대로다 — OpenAI 의 최상위 난제 모델(`gpt-5.5-pro`)은 한 번도 쓰이지 않는다.
4. **1차 프라이어 4셀을 정식 경로로 주입**했다. 실질 라우팅 변화는 **최대 2점**(clamp 20 의 10%), 원클릭 롤백 가능.

---

## 1. GPT / OpenAI 가격 — 크롤 증거

### 1.1 출처

| 항목          | 값                                                                |
| ------------- | ----------------------------------------------------------------- |
| 요청 URL      | `https://platform.openai.com/docs/pricing`                        |
| 실제 응답 URL | `https://developers.openai.com/api/docs/pricing` (301 리다이렉트) |
| HTTP          | 200                                                               |
| 크롤 시각     | 2026-07-25T10:12:24Z                                              |
| 도구          | gstack `/browse` (전역 규칙 준수 — MCP Chrome 미사용)             |

`https://openai.com/api/pricing/` 는 **403 + 봇 검증 인터스티셜**로 본문을 주지 않았다("Verification successful. Waiting for openai.com to respond" 만 반환, reload 후에도 동일). 그래서 같은 표를 서빙하는 개발자 문서 경로를 정본으로 썼다.

### 1.2 크롤 원문 (Flagship, Standard 티어) — 검증용 verbatim

```
ModelInputCached inputCache writesOutputInputCached inputCache writesOutput
gpt-5.6-sol$5.00$0.50$6.25$30.00$10.00$1.00$12.50$45.00
gpt-5.6-terra$2.50$0.25$3.125$15.00$5.00$0.50$6.25$22.50
gpt-5.6-luna$1.00$0.10$1.25$6.00$2.00$0.20$2.50$9.00
gpt-5.5$5.00$0.50-$30.00$10.00$1.00-$45.00
gpt-5.5-pro$30.00--$180.00$60.00--$270.00
gpt-5.4$2.50$0.25-$15.00$5.00$0.50-$22.50
gpt-5.4-mini$0.75$0.075-$4.50----
gpt-5.4-nano$0.20$0.02-$1.25----
gpt-5.4-pro$30.00--$180.00$60.00--$270.00
```

(앞 4열 = short context, 뒤 4열 = long context. 컬럼 헤더가 `Input / Cached input / Cache writes / Output` 두 벌 반복되는 구조.)

Specialized 섹션 verbatim:

```
Codexgpt-5.3-codex$1.75$0.175$14.00        (Standard)
Codexgpt-5.3-codex$3.50$0.35$28.00         (Priority)
Cybergpt-5.4-cyber---                      (가격 미공개)
ChatGPTchat-latest$5.00$0.50$30.00
```

### 1.3 정리표 (Standard · short context · $/1M)

| 모델            | Input     | Cached in | Output     | 비고                   |
| --------------- | --------- | --------- | ---------- | ---------------------- |
| `gpt-5.6-sol`   | $5.00     | $0.50     | $30.00     | 5.6 최상위             |
| `gpt-5.6-terra` | $2.50     | $0.25     | $15.00     | 5.6 중간               |
| `gpt-5.6-luna`  | $1.00     | $0.10     | $6.00      | **5.6 최저가**         |
| **`gpt-5.5`**   | **$5.00** | **$0.50** | **$30.00** | ★우리가 실제 쓰는 모델 |
| `gpt-5.5-pro`   | $30.00    | —         | $180.00    | 난제 티어              |
| `gpt-5.4`       | $2.50     | $0.25     | $15.00     |                        |
| `gpt-5.4-mini`  | $0.75     | $0.075    | $4.50      |                        |
| `gpt-5.4-nano`  | $0.20     | $0.02     | $1.25      | 최저가                 |
| `gpt-5.3-codex` | $1.75     | $0.175    | $14.00     | Codex 특화             |

- **Batch API = 정확히 50% 할인** (별도 표 확인). **Flex = Batch 와 동일가**. **Priority = 약 2.5배**(`gpt-5.5` $12.50/$75).
- Long context 는 대략 2배(`gpt-5.5` $10/$45).
- 2026-03-05 이후 출시 모델의 data-residency 엔드포인트는 **10% 가산**.

### 1.4 ★"gpt-5.5 의 low/med/high" 는 가격 티어가 아니다

티켓 표현("gpt-5.5(effort low/med/high), 고가 5.6 계열")을 사실관계로 정정한다.

- `reasoning_effort` 는 **요청 파라미터**다. 단가는 effort 에 따라 **변하지 않는다** — 위 표에 effort 별 행이 없다. 비용이 늘어나는 경로는 단가가 아니라 **추론 토큰 수량**이다(high = 더 많은 reasoning 토큰 = 더 많은 output 과금).
- **"5.6 = 고가"도 절반만 맞다.** `gpt-5.6-sol` 만 `gpt-5.5` 와 동가($5/$30)이고, `terra`($2.50/$15)와 `luna`($1/$6)는 **`gpt-5.5` 보다 싸다**. 즉 5.6 세대는 고가 라인이 아니라 **3단 가격 라인업**이다.

### 1.5 우리 fleet 이 실제로 무엇을 돌리는가 (라이브 확인)

`~/.codex/config.toml` (모델 키만 조회, 시크릿 미출력):

```
model = "gpt-5.5"
model_reasoning_effort = "medium"
```

- Codex CLI `0.145.0`.
- `dispatch-scoring.ts:463` 의 `MODEL_ALIASES`: **`codex` → ModelType `gpt`**. 즉 보드상 "gpt" = Codex CLI = 현재 `gpt-5.5`.
- `agent-config.ts:758` `modelTierForComplexity()`: **gpt 는 `--model` 을 넘기지 않는다.** `codexReasoning` (simple→`low`, standard→`medium`, complex→`high`)만 조절 → **실제 모델은 항상 config.toml 의 `gpt-5.5`.**

---

## 2. Claude 가격 — 재확인 (확정값)

`claude-api` 스킬의 모델 카탈로그(캐시 2026-06-24) 기준. 티켓에 적힌 값과 **전부 일치**했다.

| 모델      | 모델 ID            | Context | Input                             | Output                 |
| --------- | ------------------ | ------- | --------------------------------- | ---------------------- |
| Fable 5   | `claude-fable-5`   | 1M      | $10.00                            | $50.00                 |
| Opus 5    | `claude-opus-5`    | 1M      | $5.00                             | $25.00                 |
| Opus 4.8  | `claude-opus-4-8`  | 1M      | $5.00                             | $25.00                 |
| Sonnet 5  | `claude-sonnet-5`  | 1M      | $3.00 (인트로 $2.00, ~2026-08-31) | $15.00 (인트로 $10.00) |
| Haiku 4.5 | `claude-haiku-4-5` | 200K    | $1.00                             | $5.00                  |

→ 티켓의 "Opus5 = Opus4.8" 도 맞다(둘 다 $5/$25).

### 2.1 우리 fleet 의 Claude 티어 (`agent-config.ts`)

| complexity | 해석 함수                                                                        | 실제 모델   | 단가    |
| ---------- | -------------------------------------------------------------------------------- | ----------- | ------- |
| simple     | `resolveSimpleClaudeModel()` (env, 기본 `sonnet`)                                | Sonnet 5    | $3/$15  |
| standard   | 리터럴 `"opus"`                                                                  | Opus 5      | $5/$25  |
| complex    | `resolveTopClaudeModel()` (기본 `fable`, CLI ≥2.1.170 게이트, 미달 시 opus 폴백) | **Fable 5** | $10/$50 |

---

## 3. ★비교 매트릭스 — 어떤 작업에 어떤 모델

### 3.1 먼저: 같은 난도에서 실제 단가 대조

| complexity | Claude 실모델 | Claude $/1M   | GPT 실모델       | GPT $/1M     | 누가 싼가                     |
| ---------- | ------------- | ------------- | ---------------- | ------------ | ----------------------------- |
| simple     | Sonnet 5      | $3 / **$15**  | gpt-5.5 (low)    | $5 / **$30** | **Claude 가 output 2배 싸다** |
| standard   | Opus 5        | $5 / **$25**  | gpt-5.5 (medium) | $5 / **$30** | Claude 가 소폭 싸다           |
| complex    | Fable 5       | $10 / **$50** | gpt-5.5 (high)   | $5 / **$30** | GPT 가 싸다                   |

**★이게 이번 조사의 가장 실무적인 발견이다.** "쉬운 건 codex 로 싸게" 라는 통념이 **현재 설정에선 거짓**이다 — simple 티어에서 Codex 는 Claude 보다 output 단가가 2배 비싸다. GPT 가 실제로 싸지는 건 **complex 뿐**이고, 그건 GPT 가 효율적이어서가 아니라 **우리가 GPT 를 complex 에서도 중간 모델로 두기 때문**이다(§3.3).

단, 두 가지 유보:

- Codex CLI 를 **ChatGPT 구독 계정**으로 로그인해 쓰면 토큰 과금이 아니라 플랜 소진이다. 다만 `~/.marblo/subscription-plans.json` **부재**를 확인했으므로, **스코어러 입장에선 per-token 테이블이 그대로 작동 중**이다(`costEfficiencyScore` Tier 2 경로).
- effort 가 토큰 *수량*을 바꾸므로 위 단가 비교는 "동일 토큰 수" 가정이다. low effort 는 수량이 적어 격차를 일부 상쇄한다.

### 3.2 난도 × 작업유형 매트릭스

기호: ◎ 1순위 · ○ 대안 · △ 비권장. 근거는 §1(가격 크롤) · §2(Claude 카탈로그) · 벤더 문서의 포지셔닝 서술 · Marblo fleet 구조(`agent-config.ts`) · 라이브 그래프 관측(§4.1).

| 작업유형                | simple                           | standard                        | complex                                |
| ----------------------- | -------------------------------- | ------------------------------- | -------------------------------------- |
| **코딩(구현)**          | ◎ Claude(Sonnet5) · ○ Codex(low) | ◎ Claude(Opus5) · ○ Codex(med)  | ◎ Claude(Fable5) · △ Codex(high, §3.3) |
| **리뷰·버그수정**       | ◎ Codex(low, 저비용 1패스)       | ◎ Claude(Opus5)                 | ◎ Claude(Opus5/Fable5)                 |
| **조사·리서치**         | ◎ Codex(low)                     | ○ Claude(Opus5) · ○ antigravity | ◎ Claude(Fable5)                       |
| **문서**                | ◎ Claude(Sonnet5)                | ◎ Claude(Opus5)                 | ○ Claude(Fable5)                       |
| **설계·아키텍처**       | — (해당 없음)                    | ◎ Claude(Opus5)                 | ◎ **Fable5** · △ Codex                 |
| **반복·보일러플레이트** | ◎ Codex(low)                     | ○ Codex(med)                    | —                                      |

근거 요약:

- **리뷰/버그수정에서 Claude 상위**: 벤더 문서가 Opus 5 를 코드리뷰·버그탐지에서 "high precision _and_ high recall" 로, Fable 5 를 버그탐지 강점(단 **보안 분석은 제외** — cyber 분류기가 거절할 수 있음)으로 명시. `MODEL_TAG_BONUSES` 에는 `review` 태그가 **아예 없어** 정적 테이블이 이 축을 못 잡는다.
- **simple 에서 Codex 를 남긴 이유**: 단가가 아니라 ① low effort 의 낮은 토큰수·지연 ② 정적 테이블이 이미 `simple-fix`/`quick-edit`/`boilerplate` 에 gpt 가점을 준다 ③ **fleet 분담 선호**(큰 작업을 claude 솔로로 몰지 않는 운영 방침).
- **설계·complex 에서 Codex △**: §3.3.
- **보안 감사(`/cso`)**: Fable5/Opus5 는 cyber 안전 분류기로 `stop_reason: "refusal"` 을 낼 수 있다(정상 200 응답). 공격적 보안 작업을 라우팅할 땐 이 거절 경로를 감안해야 하고, 코드가 `content[0]` 을 무조건 읽으면 깨진다. 별도 이슈로 남길 값어치가 있다.

### 3.3 ★complex 티어의 비대칭 (구조적 문제)

|        | complex 에서 올라가는 것                     | 도달점                 | 벤더 최상위                      |
| ------ | -------------------------------------------- | ---------------------- | -------------------------------- |
| Claude | **모델** (`resolveTopClaudeModel()`)         | Fable 5 ($10/$50)      | Fable 5 ✅ 도달                  |
| GPT    | **effort 만** (`resolveTopCodexReasoning()`) | gpt-5.5 @high ($5/$30) | gpt-5.5-pro ($30/$180) ❌ 미사용 |

즉 complex 티켓에서 우리는 **"Claude 최상위 모델 vs GPT 중간 모델"** 을 비교하고 있다. 이건 벤더 역량 격차가 아니라 **우리 설정의 격차**다.

→ 후속 제안(이 티켓 범위 밖): `MARBLO_TOP_CODEX_MODEL` 을 추가해 complex 에서 `-m gpt-5.5-pro`(또는 `gpt-5.6-sol`)를 넘기게 하면 비교가 공정해진다. `codex --help` 에 `-m, --model <MODEL>` 이 있으므로 CLI 지원은 이미 있다.

### 3.4 비용민감도 축 — 진짜 저가 fleet 을 원한다면

현재 `gpt-5.5`($5/$30)는 저가 옵션이 **아니다**. 비용 절감이 목적이면 순서대로:

| 옵션             | Output $/1M | vs 현재        | 비고                    |
| ---------------- | ----------- | -------------- | ----------------------- |
| `gpt-5.6-luna`   | $6.00       | **5배 절감**   | 5.6 세대 최저가         |
| `gpt-5.4-mini`   | $4.50       | **6.7배 절감** | 구세대 소형             |
| `gpt-5.3-codex`  | $14.00      | 2.1배 절감     | Codex 특화, 세대는 낮음 |
| Claude Haiku 4.5 | $5.00       | 6배 절감       | Claude 쪽 저가 카드     |
| Batch API        | 50%         | 2배 절감       | 비대화형 작업 한정      |

★단 `gpt-5.5` → 저가 모델 전환은 **역량 저하를 동반**하므로 벤치 없이 바꾸면 안 된다. 이 문서는 "선택지와 단가"만 확정한다.

---

## 4. ★지식그래프 1차 콜드스타트 주입

### 4.1 주입 전 라이브 그래프 상태

`~/.marblo/routing-graph.json` (v1, scope=global, `updatedAt=2026-07-20T03:00:11Z`, 12셀 / seen 47).
전 셀이 `merged` **양성 신호만** 보유 — 부정 신호는 0건이었다.

| 셀                                                                                                                                          | n      | decayed   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- |
| `taskType:code\|claude`                                                                                                                     | 26     | merged 78 |
| `complexity:standard\|claude`                                                                                                               | 18     | merged 54 |
| `complexity:complex\|claude`                                                                                                                | 15     | merged 45 |
| `taskType:docs\|claude`                                                                                                                     | 9      | merged 27 |
| `taskType:code\|gpt`                                                                                                                        | 9      | merged 27 |
| `complexity:standard\|gpt`                                                                                                                  | 9      | merged 27 |
| `complexity:simple\|claude`                                                                                                                 | 3      | merged 9  |
| `complexity:simple\|gpt`, `taskType:docs\|gpt`, `taskType:code\|antigravity`, `complexity:standard\|antigravity`, `taskType:config\|claude` | 1 each | merged 3  |

### 4.2 주입 설계를 좁힌 3가지 제약 (★가장 중요한 부분)

**제약 1 — 읽기 경로가 안 보는 축에 시드하면 무의미.**
`bridge-server.ts:2186` 이 `GraphContext` 를 `{role, tags, complexity}` 로만 만든다. **`taskType` 이 없다** (electron↔src 경계 때문에 렌더러의 `classifyTaskType()` 을 못 씀 — 쓰기 경로만 taskType 을 채운다). 따라서 라이브 그래프에서 가장 큰 셀인 `taskType:code|claude`(n=26)조차 **dispatch 스코어링에 0 영향**이다. `taskType:*` 시드는 전부 inert → **안 함**.

**제약 2 — 값 집합이 닫힌 축만.**

- `complexity` = `simple|standard|complex` **닫힌 enum** → 시드한 셀이 반드시 도달 ✅
- `tags` = **자유 문자열**(MCP 툴 설명이 "e.g., architecture, research, simple-fix" 로 예시만 제시, enum 아님) → 시드한 태그가 실제로 쓰일지 보장 없음 → **보류**
- `role` = 47건 관측 후에도 `role:*` 셀이 **0개** → 애초에 캡처가 안 되고 있다 → 시드하면 두 번 추측하는 셈 → **보류**

**제약 3 — 정적 스코어러가 이미 주는 신호를 복제하지 않는다.**
`MODEL_TAG_BONUSES` 를 그래프로 옮겨 적으면 같은 신호가 **두 번** 더해진다. 그래프의 역할은 정적 테이블의 **공백**을 메우는 것.

→ 결과: **complexity 축 4셀**. 작게 만든 건 게으름이 아니라 티켓의 제약("과주입=학습 압도 회피")을 지킨 결과다.

### 4.3 주입한 프라이어 (4셀)

| 셀                                | prior  | 근거                                                                                                                                                                                                                                           |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `complexity:complex\|claude`      | **+2** | complex → `fable-5`($10/$50) = 벤더 최상위 티어. 벤더 문서가 long-horizon agentic 최상위로 명시. 라이브 관측 15 merges·부정 0 으로 이미 뒷받침 → 사실상 관측 추인.                                                                             |
| `complexity:complex\|gpt`         | **−1** | §3.3 비대칭. complex 에서 effort 만 올라가고 모델은 `gpt-5.5` 고정, 벤더 난제 티어 `gpt-5.5-pro` 미사용. **−1(최소 단위)** 로 둔 이유: 원인이 라우팅이 아니라 **설정**이라 설정을 고치면 이 프라이어는 철회해야 한다.                          |
| `complexity:complex\|antigravity` | **−2** | `routing-graph.ts:49` 의 자체 분류 주석이 `no_activity_stale` 을 "**★antigravity case**"(살아있으나 진행 없음)로 명시. 해당 사분면의 in-repo 문서화된 실패 모드이고 셀이 비어 있어, 신규 complex 티켓이 기억 없이 antigravity 로 갈 수 있었다. |
| `complexity:simple\|gpt`          | **+1** | fleet 분담 유지 + codex-low 의 낮은 토큰/지연. **+1 로 억제한 이유: 가격 논거가 성립하지 않기 때문**(§3.1 — simple 에서 Claude 가 2배 싸다). `complexity:simple                                                                                | claude` 에 대항 시드를 **일부러 넣지 않았다** — 근접하므로 tie-band 와 실관측이 결정하게 둔다. |

### 4.4 주입 전/후 diff (실제 실행 로그)

```
[seed] before: 12 cells, updatedAt=2026-07-20T03:00:11.000Z
[seed] 4 applied, 0 rejected (bound |prior| ≤ 3)

── cell diff ──
  + complexity:complex|antigravity  prior=-2  n=0  (new, seed-only)
  ~ complexity:complex|claude  prior +0→+2  n=15 (prior weight 29%)
  + complexity:complex|gpt  prior=-1  n=0  (new, seed-only)
  ~ complexity:simple|gpt  prior +0→+1  n=1 (prior weight 86%)

── graphBias delta (what dispatch will actually see) ──
  complexity=complex
    claude +20→+20 (=)  |  gpt +0→-1  |  antigravity +0→-2  |  gemini +0→+0 (=)
  complexity=standard
    claude +20→+20 (=)  |  gpt +16.2→+16.2 (=)  |  antigravity +0.43→+0.43 (=)  |  gemini +0→+0 (=)
  complexity=simple
    claude +3→+3 (=)  |  gpt +0.43→+1.29  |  antigravity +0→+0 (=)  |  gemini +0→+0 (=)
```

주입 후: **14셀**, `updatedAt=2026-07-25T10:19:16.172Z`.

### 4.5 ★마그니튜드 근거 — 왜 이게 학습을 압도하지 않는가

**(a) 실효 변화가 최대 2점이다.** 위 로그에서 `standard` 는 전부 무변화, `complex` 는 gpt −1 / antigravity −2, `simple` 은 gpt +0.86. 스코어러 스케일 대조: 역할 하드게이트 **100**, 태그 보너스 **최대 30**, reuse 보너스 **30**, `TIED_SCORE_BAND` **5**, graphBias clamp **±20**. 즉 프라이어는 **tie-break 가능·override 불가**.

**(b) 4개 중 1개는 현재 효과가 0이다.** `complexity:complex|claude` 는 claude 가 이미 clamp(+20)에 **포화**돼 있어(관측 45 × shrink 0.71 = 32 → clamp 20) 프라이어가 묻힌다. 증거가 decay 하거나 역전될 때만 살아나는 **바닥(floor)** 으로만 기능한다.

**(c) 증거가 프라이어를 _밀어낸다_.** `cellBias` 를 베이지안 혼합으로 바꿨다:

```
bias = prior · K/(n+K)  +  netDecayed · n/(n+K)      (K = SHRINKAGE_K = 6)
```

| n   | 프라이어 가중 | 관측 가중 |
| --- | ------------- | --------- |
| 0   | 100%          | 0%        |
| 1   | 86%           | 14%       |
| 6   | 50%           | 50%       |
| 15  | 29%           | 71%       |
| 30  | 17%           | 83%       |

프라이어를 단순 가산하지 않으므로 **틀린 프라이어는 데이터가 쌓이면 자가 치유**된다. 유닛테스트로 검증: 프라이어 −3 에 양성 관측 20건 → **bias 부호 역전**.

**(d) 프라이어는 절대 증거로 위장되지 않는다.** 별도 필드이며 `n`·`raw`·`decayed` 를 건드리지 않는다. 감사 시 "관측 15건" 과 "누가 시드한 믿음" 이 섞이지 않는다. `|prior| > SEED_PRIOR_MAX(3)` 요청은 **조용히 clamp 하지 않고 거부**한다(clamp 하면 시드가 적용된 것처럼 보이니까).

### 4.6 ★되돌리는 법 (2경로)

```bash
cd v3

# 경로 1 — 정식 revert (권장). 먼저 dry-run 으로 확인:
npm run graph:seed -- --revert
npm run graph:seed -- --revert --apply

# 경로 2 — apply 시 자동 생성된 백업 복원
cp ~/.marblo/routing-graph.backup-2026-07-25T10-19-16-179Z.json \
   ~/.marblo/routing-graph.json
```

`--revert` 의 의미론: **관측이 있는 셀은 `prior` 만 제거하고 셀은 남기고**, **시드 때문에만 생긴 셀(n=0, raw/decayed 공백)은 셀 자체를 삭제**한다. 그래서 revert 가 inert 껍데기를 남기지 않고 pre-seed 상태를 정확히 복원한다 (라운드트립 테스트 있음: `tests/unit/routing-graph-seed.test.ts` → "round-trips: seed → revert restores the pre-seed bias exactly").

### 4.7 정식 주입 경로 (JSON 직접 편집 금지)

| 구성요소                                    | 위치                                               |
| ------------------------------------------- | -------------------------------------------------- |
| `applyColdStartPriors(graph, priors, atMs)` | `electron/routing-graph.ts`                        |
| `removeColdStartPriors(graph, atMs)`        | 동일                                               |
| `clampSeedPrior()`, `SEED_PRIOR_MAX = 3`    | 동일                                               |
| 셀 필드 `prior` / `priorNote`               | `RoutingGraphCell`                                 |
| 시드 데이터 + 러너                          | `electron/scripts/seed-routing-graph.ts`           |
| npm 스크립트                                | `npm run graph:seed` (**기본 dry-run**)            |
| 테스트                                      | `tests/unit/routing-graph-seed.test.ts` (15케이스) |

쓰기는 기존 `saveRoutingGraph()` 의 원자적 temp+rename 경로를 그대로 탄다.

---

## 5. 발견한 별건 이슈 (이 티켓 범위 밖 — 수정 안 했음)

### 5.1 ★`cost-tracker.ts` 가격 테이블이 낡아 비용을 과소보고한다

`electron/cost-tracker.ts:141` `MODEL_PRICING`:

| 항목                                                               | 테이블 값                           | 실제 (공식)        | 영향                       |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------ | -------------------------- |
| `gpt-5.5`                                                          | $5 / **$20**                        | $5 / **$30**       | 출력 비용 **33% 과소**     |
| Claude 5 계열 (`claude-fable-5`·`claude-opus-5`·`claude-sonnet-5`) | **행 자체 없음** → `default` $3/$15 | Fable5 $10/**$50** | Fable5 출력 **3.3배 과소** |
| `claude-haiku-4-5`                                                 | $0.8 / $4                           | $1 / $5            | 20% 과소                   |

Marblo 는 complex 를 **기본 Fable5** 로 돌리는데(`DEFAULT_TOP_CLAUDE_MODEL = "fable"`) 그 모델이 가격표에 없어 `default` $3/$15 로 계산된다. **비용 대시보드가 가장 비싼 워크로드를 가장 크게 과소보고**하는 구조다. 스코프(`routing-graph.ts`/`docs`/`routing-graph.json`) 밖이라 손대지 않았다. **후속 티켓 권장.**

### 5.2 `COST_EFFICIENCY_WEIGHT` 의 전제가 뒤집혔다

`dispatch-scoring.ts:162` 은 `claude: 3`(비싸다) / `gpt: 10`(가장 싸다)로 두고, 주석 근거가 "Opus ~$15/$75", "gpt-4.1-nano ~$0.10, mini ~$0.40" — **둘 다 stale**. 현재 실제 설정에선 simple/standard 티어에서 **Claude 가 GPT 보다 싸다**(§3.1). 이 상수는 라우팅에 직접 들어가므로 재조정 대상이지만, 조정하면 라우팅이 크게 흔들리므로 **별도 티켓 + 벤치**가 맞다.

### 5.3 `taskType` 이 읽기 경로에 없어 학습의 상당부가 사장된다

라이브 그래프 최대 셀 `taskType:code|claude`(n=26, 전체 관측의 절반 이상)가 **dispatch 에 0 영향**이다(§4.2 제약 1). 쓰기는 되는데 읽기가 안 되는 반쪽 배선. `GraphContext` 에 taskType 을 넣으려면 electron 쪽에서 taskType 을 확보하는 경로가 필요하다. **가장 ROI 높은 후속 작업으로 보인다.**

### 5.4 `role` 캡처 부재

47건 관측 후에도 `role:*` 셀 0개. `dispatchMeta.role` 이 그래프까지 도달하지 않는 것으로 보인다.

---

## 6. 검증 상태

| 항목            | 방법                                                                  | 결과                                       |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| GPT 모델명·가격 | gstack `/browse` 공식 문서 크롤, verbatim 첨부                        | ✅ 확정 (§1.2)                             |
| Claude 가격     | `claude-api` 스킬 모델 카탈로그                                       | ✅ 티켓 값과 전부 일치                     |
| 우리 GPT 실모델 | `~/.codex/config.toml` 모델 키 조회 + `codex --version`               | ✅ `gpt-5.5` / effort medium / CLI 0.145.0 |
| 시드 메커니즘   | `tests/unit/routing-graph-seed.test.ts` 15케이스                      | ✅ 통과                                    |
| 무회귀          | 기존 `routing-graph` / `graph-bias-dispatch` / `graph-updater` 테스트 | ✅ 4파일 54/54 통과                        |
| 타입            | `tsc -p electron/tsconfig.json --noEmit`                              | ✅ 0 에러                                  |
| 주입 결과       | `graph:seed` dry-run → apply → JSON 재조회                            | ✅ 14셀·prior 4개 확인, 백업 생성          |

**라이브 확인이 남은 것** (이 세션에서 증명 불가):

- 실제 dispatch 가 새 bias 로 라우팅하는지 — `dist-electron` 재빌드 + 앱 재시작 필요. 메모 `dev_main_process_no_autorestart_on_tsc_watch` 대로 electron 메인은 `tsc --watch` 로 자동 재시작되지 않고, 오케가 앱 안에서 도는 중이라 재시작은 사장님만 가능하다.
- ★그래프 파일 자체는 이미 갱신됐고 읽기 경로는 mtime 캐시라, **재시작 없이도 다음 dispatch 가 새 값을 읽을 가능성이 높다**(`readGraphFileCached` 가 mtime 변화를 감지). 다만 실제 `dispatch:decision` 로그로 확인된 바는 아니다.
- 프라이어 방향의 타당성은 **실사용 데이터로만** 검증된다 — 그게 이 주입의 목적이다.
