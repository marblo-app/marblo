# MiniMax 편입 런북 — 두 번째 env-swap 벤더 (tg6U7MKt)

> 선행: [`VENDOR-GLM-ZAI.md`](./VENDOR-GLM-ZAI.md) §5 (레퍼런스 패턴),
> [`VENDOR-EXPANSION-SURVEY.md`](./VENDOR-EXPANSION-SURVEY.md) §2.5 (판정),
> PR#607 (provider≠harness 축 분리), PR#609 (GLM 배선).
>
> 작성 2026-07-26 · 실측 크롤 platform.minimax.io (gstack `/browse`, 1차 출처만)

## 0. 한 줄

GLM 문서가 예고한 "MiniMax 편입 시" 절차를 **그대로** 밟았다. 레지스트리 행 2개 +
사다리 배제 사유 2줄 + `.env.example` 키 이름 1개. 스폰 switch·probe·MCP 생성기·
cost 파서는 여전히 한 줄도 안 늘었다.

**단, 코드 변경 0줄은 아니었다** — 아래 §3 ②. GLM 이 못 밟은 지뢰가 하나 있었다.

## 1. 실측값 (날조 0)

| 항목                      | 값                                                                     | 출처                            |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| Anthropic 호환 엔드포인트 | `https://api.minimax.io/anthropic`                                     | /token-plan/other-tools.md 표   |
| OpenAI 호환 엔드포인트    | `https://api.minimax.io/v1` (우리는 미사용)                            | 동                              |
| 중국 플랫폼 엔드포인트    | `https://api.minimaxi.com/anthropic` (**미등록** — 계정 자체가 다르다) | /token-plan/claude-code.md      |
| 모델 id                   | `MiniMax-M3`, `MiniMax-M2.7` (+ `-highspeed` 변종, M2.5 이하는 Legacy) | /guides/models-intro.md         |
| env 키                    | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_*`    | /token-plan/claude-code.md      |
| 단가($/1M, paygo 리스트)  | M3 $0.6/$2.4 (현재 "Permanent 50% off" → $0.3/$1.2) · M2.7 $0.3/$1.2   | /guides/pricing-paygo.md        |
| 구독                      | Plus $20 / Max $50 / Ultra $120 월, 5시간 롤링 + 주간 윈도             | /guides/pricing-token-plan.md   |
| 동시 에이전트 권장        | Plus 3–4 / Max 4–5 / Ultra 6–7                                         | 동                              |
| 키 형태                   | Subscription Key, `sk-cp-…` 접두                                       | /token-plan/other-tools.md (Pi) |

**등록하지 않은 것과 이유**

- `MiniMax-M3[1m]` — 벤더의 Claude Code 문서 기본값이 이 표기이고
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 을 함께 요구한다. 그 env 를 우리 스폰에
  얹었을 때의 동작을 라이브로 못 봤다. 안 얹으면 claude 가 자기 기본 임계에서 더
  일찍 compact 할 뿐이라 **안전한 쪽으로 틀린다**(GLM `glm-5.2[1m]` 과 같은 판단).
- `MiniMax-M2.7-highspeed` — M2.7 과 성능이 같고(벤더 문구) 단가가 2배다. 지연을
  라우팅 축으로 쓰지 않는 지금은 고를 근거가 없다.
- M2.5 / M2.1 / M2 — 벤더 문서가 Legacy 로 접었다.
- 중국(`minimaxi.com`) 엔드포인트 — 같은 키가 양쪽에서 통하지 않는다. 필요해지면
  별 행이 아니라 env 로 갈릴 축이다.

## 2. 켜는 법

```bash
# 1) platform.minimax.io Token Plan 구독 후 User Center 에서 Subscription Key 발급
# 2) v3/.env 에 키 이름으로 추가 (값은 이 문서·코드·로그 어디에도 없다)
echo 'MINIMAX_API_KEY=<발급받은 키>' >> v3/.env
# 3) 앱 재시작 (dotenv 는 부팅 때 1회 로드)
# 4) 확인 — 키 **이름**만 출력한다
npm run verify:models -- --offline   # 무과금, 크레덴셜 설정 여부만
npm run verify:models                # [vendor] 섹션이 라이브 프로브까지 돈다
```

쓰는 법 (명시 지정 전용):

```
dispatch_task(model="MiniMax-M3")    # claude 바이너리 + MiniMax env 로 스폰
dispatch_task(model="minimax-m3")    # 같다 — 조회는 대소문자를 안 가린다
```

## 3. GLM 과 달랐던 것 (다음 벤더가 미리 알 것)

**① 벤더 공식 모델 id 가 소문자가 아닐 수 있다.**
MiniMax 문서는 일관되게 `MiniMax-M3` 로 적는다. 우리가 소문자로 접어 등록하면
`--model minimax-m3` 이 남의 API 로 나가는데, 그게 유효한지 **구독키 없이는 확인할
방법이 없다**. 그래서 `id` 는 원문 표기 그대로 두었다.

**② 그래서 레지스트리 조회를 대소문자 무관으로 고쳤다(코드 2줄).**
`getModel` 은 처음부터 `norm`(trim+소문자)으로 조회했는데, `BY_ID`/`BY_ALIAS` 는
**원문 그대로** 키를 넣고 있었다. 우리 id 가 전부 소문자라 그 불일치가 드러난 적이
없었을 뿐이다. 그대로 뒀다면 `getModel("MiniMax-M3")` 가 영구 miss →
`envProfileForModel` 이 빈 객체 → **프로파일이 조용히 미주입되고 스폰이 Anthropic
으로 샌다**. 축 분리(PR#607)가 부팅 가드까지 세워 막으려던 바로 그 실패모드가,
가드를 통과한 채로 재현될 뻔했다. 접은 것은 **조회 키**뿐이고 `entry.id` 원문(CLI·
API 로 나가는 값)은 그대로다. 기존 id 는 전부 소문자라 회귀가 0 이다.

**③ 나머지 3개 규칙은 GLM 그대로다.**
시크릿은 `${MINIMAX_API_KEY}` 참조로만 / 크레덴셜 없으면 전부-아니면-전무 /
자동 선택 경로(`LADDER_EXCLUSIONS` + `selectorEligible`) 미편입.

## 4. 아직 안 한 것

- **라이브 스폰 검증** — Token Plan 구독키 필요. 배선·유닛까지만 했다. 키가 생기면
  `npm run verify:models` 의 `[vendor]` 섹션이 자동으로 프로브한다.
- **cost-tracker 키 대조** — `perTokenRateFor` 는 대소문자를 가리는 exact/prefix
  매치다. claude CLI 의 `modelUsage` 가 MiniMax 응답에서 어떤 표기로 모델명을
  돌려주는지 아직 못 봤다. 표기가 다르면 `default`($3/$15)로 떨어지는데, 그건
  **과대**보고라 라우팅 학습을 망치는 방향은 아니다. 첫 라이브 실행에서 실제 표기를
  확인하고 확정할 것(GLM 도 같은 상태다).
- **쿼터 인지 라우팅** — MiniMax 는 5시간 롤링 + 주간 윈도이고, 벤더가 **동시
  에이전트 권장치까지** 준다(Plus 3–4 …). 우리 `MAX_AGENTS` 정책과 맞물릴 첫
  사례다(서베이 V1-5).
- **capability 등급 확정** — M3=top 은 잠정이다. 벤더 자기 표기는 "Frontier" 지만
  우리 `frontier` 칸은 실측이 붙은 자리라 마케팅 문구로 주지 않았다.
