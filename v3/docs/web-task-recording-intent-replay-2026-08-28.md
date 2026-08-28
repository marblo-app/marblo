# 웹 작업 녹화 → 봇 재생: 설계 판정과 PoC

**작성**: 2026-08-28 · 티켓 `ZXdNwUxWKhACrVg6f4WH` (스파이크)
**범위**: 설계 + 좁은 PoC 까지. 제품 배선·UI 는 다음 티켓.
**병렬 티켓**: 런타임·패키징·크레덴셜 *보관 방식* 판정은 티켓 A(`DHkrzbdA`) 몫이다. 이 문서는 그 판정에 필요한 실측치만 넘기고 결론은 내지 않는다.

---

## 판정

> **채택 — 단, "순수 record-replay" 가 아니라 "의도 스크립트 + 셀렉터 힌트 + 모델 폴백" 형태로만.**
> 순수 셀렉터 재생은 PoC 에서 실제로 썩었고, 그냥 죽는 게 아니라 **틀린 칸에 돈을 적고 제출까지 했다**. 의도 스크립트는 같은 파괴 6종 중 6종을 복구했다. 모델 폴백 호출당 정확도 39/40, **오답(엉뚱한 요소 선택) 0건** — 실패는 전부 "못 찾겠다" 였고 그건 사람에게 넘기면 되는 실패다.

---

## 1. 표적 경계 — 어디에 쓰고 어디에 안 쓰는가

**이 기능은 공식 API 가 있는 서비스에 쓰지 않는다. 범위 밖이다.**

| | 예 | 자동화 수단 | 이 기능 |
|---|---|---|---|
| API 있음 | Google Ads, Meta Ads, Slack, Stripe, 네이버 커머스 API | **공식 API 를 쓴다** | ❌ 쓰지 마라 |
| API 없음 | 국내 쇼핑몰 어드민, 정산·세무 사이트, 거래처 포털, 물류사 페이지 | 없음 | ✅ 여기가 표적 |

이유는 취향이 아니라 리스크다.

1. **약관.** 주요 광고·소셜 플랫폼 약관은 API 외 자동 접근을 금지한다. 위반은 계정 정지 사유다.
2. **봇 탐지 = 광고 정지.** 광고 계정이 잠기면 그 순간 매출이 멈춘다. 배포 사고보다 비싸다.
3. **애초에 더 쉽다.** "예산을 30,000원으로 바꿔라" 는 Google Ads API 호출 **한 번**이다. 브라우저를 띄우고 DOM 을 뒤지는 것보다 빠르고, 안 깨지고, 감사 로그도 남는다.

> **다음 사람에게**: "Google Ads 예산 자동 변경" 요청이 또 들어오면 이 기능이 아니라 Google Ads API 로 보내라. 이 문단이 그 답이다.

우리가 이길 자리는 **자동화 수단이 아예 없는 곳**이다. 거기엔 경쟁 도구가 없고, 사람이 매달 같은 화면에서 같은 클릭을 반복하고 있다.

---

## 2. 핵심 판정 — 순수 record-replay vs 의도 스크립트

### 2.1 두 설계

| | **A. 순수 record-replay** | **B. 의도 스크립트** |
|---|---|---|
| 녹화 산출물 | 셀렉터 + 액션 시퀀스 | **의도** + 셀렉터는 *힌트* |
| 재생 | 셀렉터 그대로 실행 | 힌트 우선 → 안 맞으면 모델이 스냅샷 보고 재탐색 |
| 사이트가 바뀌면 | 죽는다 | 다시 찾는다 |
| 비용 | 0 | 폴백이 걸린 단계당 모델 호출 1회 |
| 대표 구현 | Playwright codegen, Selenium IDE | 이 문서의 제안 |

A 는 이미 존재하는 것이다(Playwright codegen). 새로 만들 이유는 B 가 실제로 더 오래 사는가에 달려 있다. 그래서 측정했다.

### 2.2 PoC 설계

외부 사이트는 건드리지 않는다. 로컬 정적 HTML(`127.0.0.1` 임시 포트)로 **국내 정산 어드민 형태의 폼**을 만들고, V0 에서 한 번 녹화한 뒤 **같은 녹화본**을 점점 심하게 망가진 5개 변종에 재생했다.

파괴는 누적이다 — 실제 사이트가 리뉴얼될 때 한 번에 같이 일어나는 것들이다.

| 변종 | 무엇을 깨뜨렸나 | 노리는 것 |
|---|---|---|
| **V0** | (원본) | 기준선 |
| **M1** | 모든 id·class 를 해시로 교체 | CSS 힌트 |
| **M2** | M1 + 라벨/버튼 문구 변경 (`정산 금액`→`정산액`, `정산 등록`→`등록`) | role + 접근성 이름 |
| **M3** | M2 + DOM 래퍼 추가, fieldset 분리, **필드 순서 변경** | XPath·구조 경로 |
| **M4** | M3 + `name`/`placeholder` 속성 개명 + **미끼 필드 `선결제액` 추가** | 남은 모든 결정적 힌트 |
| **M5** | **id 재사용** — 옛 `#budget` 이 이제 *선결제* 칸이고, 진짜 정산 칸은 새 id | ★조용한 오염 |

**M5 가 왜 따로 있나**: 나머지는 "안 되면 안 되는 게 보인다". M5 는 셀렉터가 **여전히 맞는데 딴 걸 가리킨다**. 사이트가 필드를 하나 추가하면서 id 를 재활용하면 실제로 일어난다. 이건 크래시가 아니라 **틀린 데이터**다.

측정은 재생기 자신의 자평이 아니라 **별도 오라클**이 한다. 오라클은 픽스처의 `data-behavior` 앵커를 읽어 (1) 폼이 의도한 상태가 됐는지 (2) **값이 맞는 칸에 들어갔는지** 를 본다. 재생기·리졸버는 그 앵커를 절대 못 본다(스냅샷에서 제거하고, 녹화본에 새면 하네스가 중단한다 — `run-poc.mjs` 의 가드).

### 2.3 결과

세 가지 재생 전략을 같은 녹화본으로 돌렸다.

- `selector-only` — 기록된 CSS/XPath 만. 정합성 검사 없음. **codegen 이 주는 것 그대로.**
- `intent-deterministic` — 힌트 4단(css → xpath → role+이름 → name/placeholder) + 정합성 검사. 모델 없음.
- `intent-full` — 위 + 모델 폴백.

```
VARIANT                                    | selector-only | intent-deterministic | intent-full
-------------------------------------------+---------------+----------------------+-------------
V0 baseline                                | PASS          | PASS                 | PASS
M1 selector churn (id/class hashed)        | PASS          | PASS                 | PASS
M2 + copy churn (labels/button reworded)   | PASS          | FAIL-CLEAN           | PASS
M3 + structural churn (wrappers, reorder)  | FAIL-CLEAN    | FAIL-CLEAN           | PASS
M4 + field renames + decoy field           | FAIL-CLEAN    | FAIL-CLEAN           | PASS
M5 id reuse (old #budget = prepayment box) | FAIL-DIRTY    | PASS                 | PASS
```

3회 반복 전부 동일. `FAIL-CLEAN` = 아무것도 안 쓰고 멈춤(안전). `FAIL-DIRTY` = **틀린 칸에 쓰고 나서** 멈춤.

**읽는 법:**

1. **순수 셀렉터 재생은 M5 에서 30,000원을 `선결제액` 칸에 적었다.** 로그상으론 "셀렉터 매치 성공" 이다. 정합성 검사가 없으면 이 사고는 안 보인다. 이게 A 를 기각하는 이유다 — A 의 실패는 조용하고, 조용한 실패가 정산 화면에서 제일 비싸다.
2. 셀렉터 재생이 M1·M2 를 통과한 건 XPath 가 살아남아서다. 구조가 조금이라도 바뀌는 순간(M3) 끝났다. 리뉴얼은 항상 구조를 바꾼다.
3. **결정적 힌트만으로는 M2 부터 부족했다.** 죽은 지점은 전부 **제출 버튼**이다 — 버튼엔 `name`·`placeholder` 가 없어서, 문구가 바뀌면 붙잡을 게 남지 않는다. 모델 폴백이 없으면 의도 스크립트도 반쪽이다.
4. **M4 는 모델만 풀었다.** 4단계 전부 폴백으로 갔고 전부 맞췄다. 미끼 `선결제액` 을 한 번도 고르지 않았다.
5. **M5 는 모델 없이 풀렸다** — 정합성 검사가 오염된 힌트를 거부하고 라벨 매칭으로 내려갔다. 즉 정합성 검사는 모델과 별개로 **그 자체가 값어치가 있다**.

### 2.4 모델 폴백은 믿을 만한가 — 40회 측정

한 번 맞은 건 증거가 아니다. 제일 어려운 M4 의 4개 프롬프트를 각 10회, 총 40회 돌렸다.

| 단계 | 정답 | 정답 | NONE(못 찾음) | **오답(엉뚱한 요소)** | 미끼 선택 |
|---|---|---|---|---|---|
| s1 거래처 선택칸 | `@e4` | 9/10 | 1 | **0** | – |
| s2 정산 금액 입력칸 | `@e7` | 10/10 | 0 | **0** | **0/10** |
| s3 메모 입력칸 | `@e5` | 10/10 | 0 | **0** | – |
| s4 정산 등록 버튼 | `@e9` | 10/10 | 0 | **0** | – |
| **합계** | | **39/40 (97.5%)** | 1 | **0** | 0 |

**이 표에서 중요한 건 97.5% 가 아니라 오답 0 이다.** 실패가 전부 `NONE` 이었다 — 즉 실패 모드가 "잘못 눌렀다" 가 아니라 "모르겠으니 멈춘다" 다. 멈춘 건 사람에게 넘기면 된다(§4). 잘못 누른 건 되돌릴 수 없다.

단, 1회 오차가 실재하므로 **모델 폴백은 반드시 재시도 + 단계별 `verify` 와 함께 써야 한다.** PoC 리졸버는 `NONE`/전송오류 시 1회 재시도한다. 그 재시도가 붙은 뒤 전체 매트릭스는 3/3 회 재현됐다.

### 2.5 정직하게, 이 PoC 가 증명하지 않은 것

- **로컬 픽스처 한 개다.** 실제 국내 어드민의 iframe, 팝업 창, 동적 테이블, ActiveX 잔재, 세션 타임아웃은 안 건드렸다.
- 파괴는 **내가 만들었다.** 실제 리뉴얼이 이 6종 안에 들어온다는 보장은 없다.
- 모델 전송이 로컬 `claude -p` CLI 다. 제품에선 credit proxy 경유가 되어야 하고, 지연·요금·실패 모드가 다시 측정돼야 한다.
- 폴백 지연이 **호출당 중앙값 12–14초**다(최악 77초 관측 1회). 단계마다 폴백이 걸리면 4단계 폼이 1분이다. 배치·백그라운드 작업이면 괜찮고, 사람이 보고 기다리는 UI 면 안 괜찮다.
- 미끼는 **하나**였다. 비슷한 금액 칸이 5개인 실제 정산 화면에서도 오답 0 이 유지되는지는 미검증이다.

---

## 3. 계약 — 의도 스크립트 스키마 v1.0

**이 절이 이 티켓의 실질 산출물이다.** 이게 확정돼야 다음 단계에서 *녹화 구현*과 *재생 구현*을 다른 사람이 병렬로 만들 수 있다.

### 3.1 최상위

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `schemaVersion` | `"1.0"` | ✅ | 스키마 버전. 재생기는 모르는 major 를 거부한다 |
| `id` | `string` | ✅ | 플로우 식별자 (`flow_` 접두) |
| `name` | `string` | ✅ | 사람이 읽는 이름 |
| `recordedAt` | `string` (ISO 8601) | ✅ | 녹화 시각 |
| `origin` | `string` | ✅ | 녹화된 오리진. **재생기는 다른 오리진으로 넘어가면 중단한다** |
| `startUrl` | `string` | ✅ | 시작 URL |
| `inputs` | `Input[]` | ✅ | 실행 시 주입되는 변수 (없으면 `[]`) |
| `steps` | `Step[]` | ✅ | 단계 목록 |
| `outcome` | `Outcome` | ✅ | 성공 판정 기준 |

`Input`: `{ name: string, type: "string"|"number"|"date", example: string, required: boolean }`

`Outcome`: `{ kind: "textContains"|"urlMatches", description: string, hints: Hints, expect: string }`

### 3.2 Step

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `id` | `string` | ✅ | 단계 id (`s1`, `s2`…) |
| `kind` | `"goto"\|"fill"\|"select"\|"click"\|"check"\|"waitFor"\|"assert"\|"handoff"\|"extract"` | ✅ | 액션 종류 |
| `intent` | `string` | ✅ | **사람 말로 쓴 이 단계의 목적.** 모델 폴백의 1차 입력 |
| `target` | `Target` | ✅ (`goto` 제외) | 대상 요소 |
| `value` | `Value` | `fill`/`select` 필수 | 넣을 값 |
| `verify` | `Verify` | 권장 | 실행 직후 자기 검증 |
| `onResolveFail` | `"escalate"\|"skip"\|"abort"` | ✅ | 못 찾았을 때. `escalate` = 사람에게 넘김 |

`Target`:

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `description` | `string` | ✅ | 요소를 사람 말로 설명 (모델이 읽는다) |
| `role` | `"textbox"\|"combobox"\|"button"\|"link"\|"checkbox"\|"radio"` | ✅ | 역할. **폴백이 고른 요소도 이건 반드시 맞아야 한다** |
| `name` | `string` | ✅ | 녹화 당시 접근성 이름(라벨/버튼 문구) |
| `hints` | `Hints` | ✅ | ★**힌트일 뿐이다. 여기 없다고 실패가 아니고, 여기 맞았다고 성공도 아니다** |

`Hints`: `{ css: string, xpath: string, attrs: { name: string, placeholder: string, type: string }, text: string, nearbyText: string[] }`

`Value`: `{ from: "input", ref: string }` 또는 `{ from: "literal", text: string }`
`Verify`: `{ kind: "valueEquals"|"textContains", expect: string }` — `{{inputName}}` 치환 지원

### 3.3 실제 예시 1건

PoC 가 실제로 뱉은 산출물에서 그대로 가져온 한 단계다 (전체: `v3/docs/spike-intent-replay/recorded/settlement-filing.intent.json`).

```json
{
  "id": "s2",
  "kind": "fill",
  "intent": "'정산 금액' 입력칸에 값을 넣는다",
  "target": {
    "description": "'정산 금액' 라벨이 붙은 입력칸",
    "role": "textbox",
    "name": "정산 금액",
    "hints": {
      "css": "#budget",
      "xpath": "/html/body[1]/main[1]/form[1]/div[2]/input[1]",
      "attrs": { "name": "budget", "placeholder": "금액을 입력하세요", "type": "text" },
      "text": "",
      "nearbyText": ["정산", "금액", "원"]
    }
  },
  "value": { "from": "input", "ref": "amount" },
  "verify": { "kind": "valueEquals", "expect": "{{amount}}" },
  "onResolveFail": "escalate"
}
```

### 3.4 재생기가 반드시 지키는 규칙 (구현자용)

1. **해석 순서**: `hints.css` → `hints.xpath` → `role`+`name` → `attrs` → 모델 폴백. 먼저 맞는 것을 쓴다.
2. ★**정합성 검사 의무**: 힌트로 찾은 요소라도 (a) `role` 이 맞고 (b) 라벨·버튼문구·`name`·`placeholder` 중 **최소 하나**가 아직 일치해야 채택한다. 안 맞으면 버리고 다음 단으로 내려간다. — 이게 없으면 M5 사고가 난다.
3. **모델 폴백 결과는 `role` 만 검증한다.** 라벨·속성이 다른 게 정상이다(그래서 폴백까지 온 거다). 대신 `verify` 로 실제 결과를 확인한다.
4. **모델 폴백은 최소 1회 재시도**한다. 그래도 `NONE` 이면 `onResolveFail` 을 따른다.
5. **오리진 고정**: 실행 중 `origin` 밖으로 나가면 즉시 중단. 피싱·리다이렉트 방어.
6. 모델에 넘기는 스냅샷에는 **화면에서 사람이 볼 수 있는 것만** 담는다(역할·라벨·문구·placeholder·현재값·그룹 제목). id/class 는 넣지 않는다 — 바로 그게 썩는 부분이라 오히려 오답을 유도한다.

---

## 4. 사람 개입 — 로그인·2FA·CAPTCHA

**자동화하지 않는다.** 사람에게 넘기고 이어받는다.

### 차용 판정: ★차용한다 — `gstack browse` 의 `handoff` → `resume` 패턴 (코드 복사 아님, 구조 차용)

`~/.claude/skills/gstack/browse/src/browser-manager.ts` 를 읽었다. 검증된 패턴이고, 우리가 필요한 3가지를 이미 정확히 풀고 있다.

| gstack 이 하는 것 | 어디 | 우리한테 왜 필요한가 |
|---|---|---|
| `saveState()` — 쿠키 + 탭별 localStorage/sessionStorage + URL 을 뜬다 | `browser-manager.ts:963` | 헤드리스 → 사람용 창으로 **로그인 상태를 잃지 않고** 넘기는 유일한 방법 |
| headed 브라우저를 새로 띄우고 `restoreState()` 후 스왑, 실패하면 **옛 브라우저를 살려둔 채 에러 반환** | `:1223–1313` | 인계 실패가 세션 유실로 번지지 않는다. 이 롤백은 그대로 가져올 것 |
| `resume()` — 스냅샷 ref 무효화 + 실패 카운터 리셋 후 **재스냅샷** | `:1321` | 사람이 화면을 바꿔놨을 수 있다. 옛 ref 로 이어서 누르면 사고다 |
| 연속 실패 3회 시 handoff 힌트 자동 제시 | `:1345` | 우리 `onResolveFail: "escalate"` 의 트리거로 그대로 쓸 수 있다 |

**그대로 못 쓰는 부분 — 새로 정해야 하는 것 하나:**
gstack 의 상태는 **메모리에만 있고 세션이 끝나면 사라진다**(코드 주석: *"Never persisted to disk"*). 우리 용도는 **다음 주에 같은 정산을 또 돌리는 것**이라 세션 간 유지가 필요하다. 즉 인계 UX 는 차용하되 **세션 지속 보관은 별도 판정**이며, 그건 §6 대로 티켓 A 소관이다.

또한 gstack browse 는 자체 서버·탭 세션 모델을 가진 독립 스킬이라 **모듈로 import 하는 건 부적절**하다. 가져올 것은 위 4가지 구조적 결정이지 파일이 아니다.

---

## 5. 현황 실측 (티켓 본문 주장 재검증)

| 티켓 주장 | 재검증 결과 |
|---|---|
| `@playwright/test` 1.60 은 devDependency | ✅ 사실. `v3/package.json:112`, `devDependencies`. deps 36 / devDeps 26 |
| `BrowserPane.tsx` 는 `<iframe>`, webviewTag 꺼져 있음 → 자동화 불가 | ✅ 사실. `v3/src/components/workspace/BrowserPane.tsx:7` 주석에 명시. iframe 은 cross-origin DOM 접근이 막혀 재생 불가 |
| flow-engine 노드에 브라우저 없음 | ✅ 별도 브라우저 런타임이 필요하다 |

### 패키징 관측치 — ★판정은 티켓 A(`DHkrzbdA`), 여기선 숫자만 넘긴다

| 항목 | 실측 |
|---|---|
| `playwright-core` 패키지 | **12 MB** |
| `playwright` 패키지 | **5.0 MB** |
| `@playwright/test` | 60 KB |
| 번들 Chromium | Playwright 1.60 은 `chromium_headless_shell-1223` 을 찾는데 **이 머신에 없다** → `browserType.launch` 실패. 별도 다운로드가 전제 |
| 다운로드된 headless shell 실측 크기 | **196 MB** (`chromium_headless_shell-1234` 기준) |
| `channel: "chrome"` | ✅ **성공. 다운로드 0 바이트.** 사용자의 Chrome 151.0.7922.174 를 그대로 구동 |

즉 관측된 선택지는 *≈200MB 증분* 대 *0MB 증분 + Chrome 설치 의존*이다. 후자의 실패 모드는 **Chrome 미설치 사용자**이고, 그때 `launch({channel:'chrome'})` 는 예외를 던진다(감지 가능 → 안내 가능). `devDependencies → dependencies` 이동은 **이번에 하지 않았다** — 이 저장소에서 Cloud Build 배포를 깨뜨린 전례가 있고, PoC 는 그 이동 없이 돌았다.

---

## 6. 크레덴셜 — 시크릿 유출 경로

**보관 방식 선택은 티켓 A 소관이다.** 여기 적는 건 그 결정이 반드시 막아야 하는 것들이다. 이건 이 기능 고유의 위험이라 넘기기 전에 적어둔다.

이 기능은 성격이 다르다. 지금까지 우리가 보관한 건 **우리가 발급받은 OAuth 토큰**(`google-drive-token-store.ts` 의 `safeStorage` 패턴)이다. 여기서 보관하는 건 **제3자 사이트의 로그인 세션 쿠키** — 범위가 넓고(사이트 전체 권한), 만료가 불명확하고, 사용자가 회수할 방법이 우리 UI 에 없다.

**유출 경로 (각각에 대해 티켓 A 가 답을 내야 한다):**

1. **디스크 평문** — 브라우저 프로필 디렉터리(`launchPersistentContext` 의 userDataDir)나 `storageState` JSON 이 그대로 남는 경로. Playwright 의 `storageState()` 출력은 **평문 쿠키**다.
2. **로그·트레이스** — Playwright trace/HAR, 스크린샷, 콘솔 로그에 세션 쿠키·`Authorization` 헤더·화면의 개인정보가 그대로 박힌다. 스파이크에서 trace 를 켜지 않은 이유가 이것이다.
3. **모델 프롬프트** — ★이 설계 고유의 경로다. 폴백은 화면 스냅샷을 모델에 보낸다. 정산 화면에는 사업자번호·계좌·거래액이 있다. PoC 스냅샷은 조작 가능한 요소만 담아 노출을 줄였지만 `value` 는 담고 있다 — **입력칸 현재값의 마스킹 규칙이 필요하다.**
4. **백업·동기화** — 프로필 디렉터리가 iCloud/Time Machine/우리 백업에 딸려 나가는 경로.
5. **오리진 이탈** — 재생 중 리다이렉트로 다른 도메인에서 폼을 채우면 자격증명을 남의 사이트에 입력하는 셈. §3.4 규칙 5(오리진 고정)가 이걸 막는다. **이건 재생기 쪽 방어라 내 몫이고, 계약에 넣었다.**

---

## 7. 다음 단계 (이 티켓 아님)

계약(§3)이 고정됐으므로 아래는 병렬로 쪼갤 수 있다.

1. **녹화기** — 실제 브라우저 확장/CDP 로 사람 조작을 잡아 §3 스키마를 출력. `intent`/`description` 문구는 모델이 초안을 쓰고 **사람이 검수 화면에서 고친다**(PoC 는 결정적으로 생성했다 — 실제 문구 품질은 미검증이다).
2. **재생기** — §3.4 규칙 1–6 구현. 모델 폴백 전송은 credit proxy 경유.
3. **런타임·패키징·크레덴셜 보관** — 티켓 A.
4. **인계 UX** — §4 패턴으로 handoff/resume.
5. **재검증** — 실제 국내 어드민 1곳에서 4주간 주 1회 재생. 스파이크가 답 못 한 건 결국 "실제 사이트가 얼마나 자주, 어떻게 바뀌는가" 다.

---

## 재현 방법

```bash
[ -e v3/node_modules ] || ln -sfn /Users/dongwonkim/Documents/programming/marblo/v3/node_modules v3/node_modules
export PATH="$HOME/.nvm/versions/node/v22.13.0/bin:$PATH"
cd v3/docs/spike-intent-replay

node record.mjs      # V0 에서 녹화 → recorded/settlement-filing.intent.json
node run-poc.mjs     # 6개 변종 × 3개 전략 매트릭스 → out/results.json
node run-poc.mjs --arms selector-only   # 모델 없이(무료) 셀렉터 재생만
```

- 제품 코드 변경 0. `v3/src` 미변경, `package.json` 미변경.
- 외부 사이트 접속 0 — 픽스처는 `127.0.0.1` 임시 포트의 정적 HTML.
- 모델 전송은 로컬 `claude -p` CLI (`SPIKE_MODEL` 로 교체 가능, 기본 `haiku`).
- 증거: `out/results.json`(전체 트레이스 — 모델 프롬프트·응답·지연 포함), `out/reliability.json`(40회 측정), `out/results-intent-full-run{1,2,3}.json`(3회 재현).
