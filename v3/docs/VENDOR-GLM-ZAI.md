# Z.ai GLM 편입 런북 — 첫 env-swap 벤더 (MTtCVCP4)

> 선행: [`VENDOR-EXPANSION-SURVEY.md`](./VENDOR-EXPANSION-SURVEY.md) §2.4 (판정),
> PR#607 (provider≠harness 축 분리). 이 문서는 **그 위에 얹힌 실제 배선**과
> 켜는 절차다.
>
> 작성 2026-07-26 · 실측 크롤 docs.z.ai (gstack `/browse`, 1차 출처만)

## 0. 한 줄

GLM 은 **신규 하네스가 아니다**. 우리가 이미 스폰하는 `claude` 바이너리에 env 를
갈아끼우면 Z.ai 백엔드로 붙는다. 그래서 편입 비용이 레지스트리 **행 2개**다 —
스폰 switch·probe·MCP 생성기·cost 파서가 한 줄도 안 늘었다.

## 1. 실측값 (날조 0)

| 항목                      | 값                                                                                          | 출처                              |
| ------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| Anthropic 호환 엔드포인트 | `https://api.z.ai/api/anthropic`                                                            | docs.z.ai/devpack/latest-model    |
| OpenAI 호환 엔드포인트    | `https://api.z.ai/api/coding/paas/v4` (우리는 미사용)                                       | 동                                |
| 모델 id                   | `glm-5.2`, `glm-4.7` (+ `glm-4.5-air`, `[1m]` 변종)                                         | docs.z.ai/devpack/latest-model    |
| env 키                    | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | docs.z.ai/devpack/tool/claude     |
| 단가($/1M, API 리스트)    | glm-5.2 $1.4/$4.4 · glm-4.7 $0.6/$2.2                                                       | docs.z.ai/guides/overview/pricing |
| 구독                      | $18/월~, 5시간 + 주간 프롬프트 캡                                                           | docs.z.ai/devpack/overview        |

**등록하지 않은 것과 이유**

- `glm-5.2[1m]`(1M 컨텍스트) — `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 과 최신
  CLI 를 함께 요구한다. 라이브로 확인하지 못해 등록하지 않았다.
- `glm-4.5-air` — 벤더가 haiku 매핑으로 권하지만, 우리는 **레지스트리에 등록된 id
  만** env 로 내보낸다(미등록 id = cost-tracker 가 단가를 모르는 유령 비용).
  그래서 haiku 자리는 `glm-4.7` 로 접었다(벤더 문서의 기본 구성도 이 형태다).
- effort 축 — Z.ai 문서는 세션 내 `/effort` 가 GLM effort 로 매핑된다고 적지만,
  그건 우리 스폰 argv 가 건드리는 축이 아니다. 레지스트리 `efforts: []` 가 정직하다.

## 2. 켜는 법

```bash
# 1) z.ai 구독 후 Open Platform > API Keys 에서 키 발급
# 2) v3/.env 에 키 이름으로 추가 (값은 이 문서·코드·로그 어디에도 없다)
echo 'ZAI_API_KEY=<발급받은 키>' >> v3/.env
# 3) 앱 재시작 (dotenv 는 부팅 때 1회 로드)
# 4) 확인 — 키 **이름**만 출력한다
npm run verify:models            # [vendor] 섹션이 라이브 프로브까지 돈다
npm run verify:models -- --offline  # 무과금, 크레덴셜 설정 여부만
```

쓰는 법 (명시 지정 전용):

```
dispatch_task(model="glm-4.7")   # claude 바이너리 + Z.ai env 로 스폰
```

## 3. 설계 결정 3개 (다음 벤더가 그대로 따라올 것)

**① 시크릿은 값이 아니라 `${ENV_VAR}` 참조로 적는다.**
`model-registry.ts` 는 사실만 담는 파일이고 `process.env` 를 아예 읽지 않는다.
해석은 `agent-config.applyVendorEnv` 한 군데에서만 일어난다. 자리표시자는 **값
전체**여야 한다(부분보간 금지) — 부팅 가드가 강제한다.

**② 크레덴셜이 없으면 프로파일을 통째로 안 얹는다(전부-아니면-전무).**
`ANTHROPIC_BASE_URL` 만 얹히고 토큰이 빠지면 claude CLI 가 **우리 Anthropic
크레덴셜을 들고** 남의 엔드포인트로 붙는다. 유출이고, 증상도 "왜 인증이 안 되지"
로 오독된다. 그래도 **스폰은 계속된다**(throw 없음) — 티켓이 멈추는 것보다 CLI
정상 에러로 끝나는 편이 낫고, 원인은 경고 한 줄로 즉시 드러난다.

**③ 자동 선택 경로에는 아직 안 넣는다.**

- 라우팅 사다리: `LADDER_EXCLUSIONS` (별도 구독 필요 + 코딩 적합성 실측 0)
- 오케 셀렉터: `model-selection.selectorEligible` 이 네이티브 벤더만 통과시킨다.
  오케 모델 선택은 **프로젝트별 영구 저장**이라, 키 없는 상태로 한 번 저장되면
  재시작마다 조용히 잘못된 스폰이 반복된다. `max`/`ultra` effort 를 셀렉터에서
  빼는 것과 같은 논리다.

명시 지정(dispatch)만 열어 둔 이유: 그 경로는 **티켓 1건짜리 수명**이라 실패해도
그 티켓에서 끝난다.

## 4. 아직 안 한 것

- **라이브 스폰 검증** — 구독키 필요. 배선·유닛까지만 했다. 키가 생기면
  `npm run verify:models` 의 `[vendor]` 섹션이 자동으로 프로브한다. 첫 라이브
  실행에서 "요청 id vs 응답 모델명" 규약을 사람이 확인하고 그 검사의 severity 를
  확정할 것(지금은 보수적으로 warn).
- **쿼터 인지 라우팅** — GLM 은 피크시간(KST 15:00–19:00) 3× / 오프피크 2× 배수가
  있다. 우리 비용축이 **시각 의존**이 되는 첫 사례다(서베이 V1-5).
- **그래프 셀키에 벤더 넣기** — 같은 `claude` 하네스의 anthropic/zai 성과가 한 셀에
  섞이면 라우팅 학습이 오염된다. 축적 관측 마이그레이션이 필요해 별 티켓(V1-3).
- **capability 등급 확정** — 지금 값(5.2=top, 4.7=mid)은 벤더 자기 포지셔닝 기준
  잠정이다. SWE-bench Verified 73.8(glm-4.7, **벤더 자체 하네스**)은
  `model-bench-reference.ts` 에 있지만, 같은 GLM-4.6 이 스캐폴드만 바꿔 12.8pt
  차이가 나므로 우리 하네스 값의 대리지표로 쓰면 안 된다.

## 5. MiniMax 편입 시 (레퍼런스 패턴)

1. `VendorId` 에 이미 `minimax` 가 있다 → 유니온 수정 불필요.
2. `MODEL_REGISTRY` 에 행 추가: `harness: "claude"`, `provider: "minimax"`,
   `envProfile: { ANTHROPIC_BASE_URL: <실측>, ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}", ... }`.
3. `LADDER_EXCLUSIONS` 에 사유 한 줄(안 적으면 완결성 테스트가 깨진다).
4. `.env.example` 에 키 **이름**만 추가.
5. 테스트는 `tests/unit/vendor-glm-zai.test.ts` 를 복제해 값만 바꾼다.

**코드 변경은 0줄이다.** 그게 축 분리(PR#607)가 산 것이다.
