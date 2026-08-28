# 시트 새 행 트리거 — Apps Script → 기존 웹훅

> 티켓 kJbIsaRPjMnGQTvDbR1V (설계 §3.5 · §9 **T6**). 설계 원본은
> `docs/GOOGLE_SCOPE_ZERO_DESIGN.md` 이고, 이 문서는 **T6 이 실제로 무엇을
> 만들었고 무엇을 대조했으며 사용자가 얼마나 고생하는가**를 적는다.
>
> ★이 문서에 웹훅 시크릿 **원문은 없다.** 시크릿은 앱 화면(발급·재발급 직후)과
> 사용자가 붙여넣은 스크립트 안에만 존재한다.

---

## 1. 무엇이 바뀌었나 — 방향이 뒤집혔다

`spreadsheets.readonly` 는 **sensitive** 다. sensitive 가 하나라도 남으면 게시
검증 심사가 통째로 붙는다(설계 §1). 그래서 회수한다. 회수하면 우리는 시트를
읽을 수 없다.

**우리가 시트를 읽는 게 아니라 시트가 우리를 부른다.** 사용자의 구글 계정 안에서
구글이 돌리는 Apps Script 가 새 행을 감지해 우리 웹훅을 POST 한다.

| | 이전 (#1259) | 지금 (T6) |
| --- | --- | --- |
| 누가 읽나 | 우리 서버·앱이 Sheets API 폴링 | 사용자 시트의 Apps Script |
| 구글 스코프 | `spreadsheets.readonly` (sensitive) | **0** |
| 자격증명 | 우리가 사용자 토큰 보관 | 우리는 아무것도 안 쥔다 |
| 플랫폼 | 무관 | 무관 (★스코프 0 대체 중 유일) |
| 설정 비용 | 시트 URL 붙여넣기 | **스크립트 붙여넣기 + 승인 1회** |

마지막 줄이 값이다. §4 가 그것을 숨기지 않고 센다.

## 2. 다시 만들지 않은 것

수신부는 **서버에 살아 있다**(#1256, 배포·라이브 확인 완료). T6 은 그것을 향해
쏘는 클라이언트 코드를 문자열로 만들었을 뿐이다.

- `functions/src/assistantWebhook.ts` — 서명 검증 · 페이로드 계약 · 레이트 리밋
- callable `provisionAssistantWebhook({ projectId, rotate? })` → `{ webhookId, url, secret }`
- 앱 화면의 웹훅 발급 UI (`AssistantTriggerSettingsPanel`) — 이미 있었다

새로 만든 것은 `electron/apps-script-sheets-trigger.ts`(템플릿 생성기)와 그
붙여넣기 안내 UI 뿐이다.

## 3. ★HMAC 을 어떻게 맞췄나 — 눈으로 비교하지 않았다

설계 문서가 "여기가 조용히 어긋나는 자리"라고 지목했으므로, 문자열을 대조하는
대신 **생성된 스크립트를 실제로 실행**해서 나온 서명을 서버의 검증기에 그대로
먹였다. `tests/unit/apps-script-sheets-trigger.test.ts` 가 그 대조다.

### 3.1 절차

1. **계약을 코드에서 읽었다** — `functions/src/assistantWebhook.ts`
   - `h1 = HMAC_SHA256(secret, "<ts>:<rawBody>")`, `.digest("hex")` → **소문자**
   - 비교는 `timingSafeEqualHex` — **hex 문자열의 바이트**를 비교한다
   - Node 의 `createHmac("sha256", secretString)` 은 키를 UTF-8 로 읽고
     `.update(str)` 도 UTF-8 이다 → Apps Script 의 기본과 같다
2. **Apps Script 런타임을 `node:vm` 안에 세웠다.** 흉내의 핵심은 하나다 —
   `Utilities.computeHmacSha256Signature()` 스텁이 Java `byte[]` 와 같은
   **-128..127 부호 있는 값**을 돌려준다(`byte > 127 ? byte - 256 : byte`).
   ★부호 없는 0..255 로 스텁하면 템플릿의 버그를 테스트가 덮어 버린다.
3. **생성된 스크립트를 그 컨텍스트에서 실행**하고 `marbloInstall()` →
   행 추가 → `marbloCheckNewRows()` 를 돌렸다.
4. 잡아낸 `x-marblo-signature` 와 전송 본문 문자열을
   `verifyAssistantWebhookSignature()` 에 그대로 넣어 **true** 를 확인했다.
5. 같은 본문을 `validateAssistantWebhookPayload()` 에도 넣어 **ok** 를 확인했다
   (평면 스칼라 · 필드 수 · 길이 예산).

### 3.2 세 개의 함정 — 전부 테스트가 지킨다

| # | 함정 | 증상 | 템플릿의 대응 | 테스트 |
| --- | --- | --- | --- | --- |
| 1 | **부호 있는 바이트** | `raw[i].toString(16)` 이 `-3f` 를 낸다 | `(raw[i] & 0xff).toString(16).padStart(2, '0')` | 접지 않은 hex 가 검증 **false** 임을 직접 확인 |
| 2 | **두 번 직렬화** | 서명한 바이트와 보낸 바이트가 갈린다 | `var body = JSON.stringify(...)` 를 한 번만 만들고 서명·전송이 같은 변수 | 헤더가 `ts=<ts>;h1=<Node 가 같은 문자열로 계산한 hex>` 와 **정확히 일치** |
| 3 | **대문자 hex** | 값이 같아도 `timingSafeEqualHex` 가 불일치 | `toString(16)` 의 소문자를 건드리지 않는다 | 같은 서명의 대문자판이 검증 **false** |

개행도 확인했다 — `JSON.stringify` 기본(들여쓰기 없음)이라 본문에 `\n` 이 없고,
서명 문자열은 `"<ts>:" + body` 하나뿐이다. 한글·이모지 셀로도 통과해 UTF-8
다바이트 경로를 덮었다.

### 3.3 덤으로 잡은 것 — `everyMinutes()` 는 아무 수나 받지 않는다

Apps Script 시간 트리거는 **1·5·10·15·30분**만 받고 나머지는 실행 시점에
예외로 죽는다. 우리 설정은 1~60 을 허용했으므로 `normalizeAppsScriptIntervalMinutes`
가 가장 가까운 허용값으로 접는다. 동률(예: 3분, 45분)은 **느린 쪽**으로 간다 —
과발화가 지연보다 비싸기 때문이다. 60 은 `.everyHours(1)` 로 **호출 자체를**
바꿔 내보낸다.

## 4. ★사용자 마찰 — 정직하게 센다

설계 §3.5 가 "이게 이 설계에서 가장 비싼 항목"이라고 적었다. 그 값을 여기서
숨기지 않는다.

### 4.1 몇 단계인가 — **6단계**, 그중 5단계가 구글 화면에서 일어난다

| 어디 | # | 무엇 |
| --- | --- | --- |
| Marblo | 0 | 비서 트리거 설정 → Webhook 조건 → **URL 발급** (시크릿이 이때만 보인다) |
| Marblo | — | 시트 이름·주기 고르고 **스크립트 복사** (같은 화면, 한 번의 클릭) |
| Google | 1 | 시트 메뉴 → 확장 프로그램 → Apps Script |
| Google | 2 | 편집기의 기존 코드 지우고 붙여넣기 |
| Google | 3 | 저장 (Cmd/Ctrl+S) |
| Google | 4 | 함수 목록에서 `marbloInstall` 선택 → 실행 |
| Google | 5 | 권한 승인 (최초 1회) |

한 번만 하면 되고, 그 뒤로는 사용자가 아무것도 하지 않는다. 그래도 **"구글
연결" 클릭 한 번**에서 여기까지 온 것은 숨길 수 없는 퇴보다.

### 4.2 어디서 막히나 (전부 화면 안에 문구로 있다)

1. **4단계에서 함수 목록에 `marbloInstall` 이 없다** — 3단계(저장)를 안 한
   것이다. 목록은 저장된 파일에서만 채워진다.
2. **5단계에서 "이 앱은 확인되지 않았습니다" 경고** — 자기가 방금 붙여넣은
   자기 스크립트인데도 뜰 수 있다(계정·조직 설정에 따라 다르다). 고급 →
   (프로젝트 이름)(으)로 이동. ★조직 정책이 Apps Script 를 막아 둔 계정에서는
   여기서 **정말로 막힌다.** 그 경우 우회로가 없다는 것을 말해야 한다.
3. **설치 직후 조용하다** — 정상이다. 설치는 현재 상태를 **기준선**으로 잡고
   그 뒤 늘어난 행부터 알린다(폴링 시절 규칙 1과 같다). 바로 확인하려면 행을
   하나 넣고 `marbloTestNow` 를 실행한다.
4. **★시크릿 원문은 발급·재발급 직후에만 보인다.** 서버가 그 뒤로는 마스킹만
   돌려주므로, 화면을 떠난 뒤 스크립트를 다시 만들려면 **재발급**해야 하고,
   재발급하면 이미 붙여넣은 스크립트는 401 로 실패한다. 이게 이 흐름에서 제일
   비싼 마찰이고, 화면이 그 사실을 그대로 말한다(`appsScript.needsSecret`).
5. **시크릿이 스크립트 안에 평문으로 있다** — 시트 공동 편집자는 읽을 수 있다.
   편집 권한이 있는 사람만 있는 시트에 붙여넣으라고 말한다.

### 4.3 안내를 어디에 뒀나

**웹훅 섹션 안**이다. 시트 섹션이 아니다.

이 스크립트가 부르는 것은 시트 커넥터가 아니라 **방금 위에서 발급한 웹훅
URL** 이고, 시크릿 원문도 바로 위 버튼에서만 나온다. 두 화면으로 쪼개면
사용자가 URL·시크릿을 손에 들고 이동해야 한다 — 정확히 유출이 일어나는 모양이다.

시트 섹션에는 **"보류됨" 배지 + 이동 안내**만 남겼다(§5).

## 5. 기존 시트 경로는 보류다 — 삭제가 아니다

`#1267` 의 규율(삭제가 아니라 보류 · 게이트는 토큰이 아니라 앱에)을 그대로 따랐다.

| 무엇 | 상태 |
| --- | --- |
| `electron/sheets-connector.ts` (`detectNewSheetRows` 외) | **그대로** — 한 줄도 안 지웠다 |
| `AssistantTriggerManager.startSheetsPoll` 본문 | **그대로** — 앞에 `if (withheld) { … return }` 만 세웠다 |
| `assistantTriggers.sheets` 설정 스키마·저장값 | **그대로** — 사용자 값도 지우지 않는다 |
| 옛 검증 규칙(스코프·스프레드시트·1~60분) | **그대로** — `else` 가지에 남고 전용 테스트가 지킨다 |
| 게이트 | `google-restricted-scopes.ts` 의 `sheets_trigger` 하나 |

되살리는 법은 한 줄이다: `WITHHELD_CAPABILITIES` 에서 `"sheets_trigger"` 를 뺀다.
그러면 폴링·검증·화면 배지가 한꺼번에 돌아온다.

### ★"연결 필요" 라고 말하지 않는다

이게 이 항목의 요점이다. 스코프가 없으면 화면이 "Google 계정을 다시 연결해
주세요" 라고 말하기 쉬운데, 그러면 사용자는 **없는 연결을 찾아다니다** 시간을
버린다. 연결 문제가 아니라 **방식이 바뀐 것**이므로 문구도 그렇게 끝난다:

- 엔진 → 오케스트레이터: "…이제 폴링으로 동작하지 않습니다. 설정은 지우지
  않았습니다 — Webhook 조건의 Apps Script 를 시트에 붙여넣으면 같은 알림이
  그대로 돌아옵니다."
- 화면(시트 섹션): **보류됨** 배지 + "연결이 끊긴 것이 아니라 방식이 바뀌었습니다"
- 화면(저장 시도): `sheets_trigger_withheld` — 체크박스를 끄고 Webhook 조건으로
  가라고 말한다. `sheets_connector_required` 와 **다른 이슈로 나눠 둔 이유가
  이 문구**다.
- 커넥터 배지에서 **"Sheets" 를 내렸다.** 앰버 배지는 화면에서 "연결이 필요하다"
  로 읽힌다. 보류가 풀리면 배지도 돌아온다.

## 6. 배치 규율 — 레이트 리밋에 구조적으로 닿지 않는다

웹훅 레이트 리밋은 **60초 10회 / 600초 60회**다. 편집 이벤트를 그대로 연결하면
50행 붙여넣기 한 번에 넘고 그 뒤가 **조용히 버려진다.**

```
시간 트리거 (기본 5분)            onChange (가속기)
        └──────────┬──────────────────┘
                   ▼
          marbloCheckNewRows()
            LockService 로 직렬화
            cursor = ScriptProperties['marblo_last_row:<시트>']
            lastRow <= cursor  → 커서만 갱신하고 **아무것도 안 보낸다**
            그 밖             → POST 1회 (최근 5행 + 총 개수 + truncated)
            2xx 아니면 커서를 **전진시키지 않는다** → 다음 tick 이 재시도
```

- 한 tick 에 POST 는 **최대 1회**. 40행을 한꺼번에 넣어도 1회다(테스트로 확인).
- `onChange` 는 60초 쿨다운을 넘지 못한다. 쿨다운에 걸린 변화는 **버려지지
  않고** 다음 시간 트리거가 같은 커서로 집어간다.
- 첫 설치는 기준선만 잡는다. 행이 줄면(삭제) 발화하지 않고 커서만 내린다 —
  "삭제 후 추가" 를 다음 tick 이 잡게 하는 유일한 방법이다.
- 실패는 예외로 올린다. Apps Script 가 실행 실패를 소유자에게 메일로 알린다 —
  조용히 사라지는 것보다 낫다.

★설계 문서는 `onEdit` 를 금지했다. `onChange` 를 가속기로 얹은 것은 그 금지의
이유(레이트 리밋)를 **쿨다운 + 공유 커서**로 구조적으로 막았기 때문이고,
뼈대는 여전히 시간 트리거 + 커서다.

## 7. 검증한 것 / 확인하지 못한 것

**검증했다** (로컬)

- `npx vitest run tests/unit/apps-script-sheets-trigger.test.ts` — 21 tests
  (실행 대조 · 서명 · 부호 함정 역증명 · 페이로드 계약 · 배치 · ko/en 대칭)
- `npx vitest run tests/unit/assistant-triggers.test.ts` — 엔진이 시트를 읽지
  않고 Apps Script 경로를 안내하는지 포함
- `npx vitest run tests/unit/assistant-trigger-settings.test.ts` ·
  `…-sheets-restored.test.ts` — 보류 동작과, 보류가 풀렸을 때의 옛 규칙 양쪽
- `npx vitest run tests/unit/google-drive-auth.test.ts` — `sheets_trigger` 문구가
  "다시 연결" 로 유도하지 않는지
- `npx tsc --noEmit` · `npx tsc -p electron/tsconfig.json --noEmit` — 둘 다 exit 0

**확인하지 못했다** (실사용 검증으로 넘긴다)

- ★**실제 구글 시트에 붙여넣어 돌린 적은 없다.** 사장님 시트는 남의 데이터라
  건드리지 않았다. 남은 것은 (a) 권한 승인 화면의 실제 문구, (b) TCC 가 아닌
  구글 조직 정책이 Apps Script 를 막는 계정에서의 실패 모양, (c) 라이브 웹훅이
  200 을 주는지다. **(c) 는 신규 시트 하나로 5분이면 판정된다.**
- **`ts` 신선도.** `verifyAssistantWebhookSignature` 는 `ts` 를 서명에 포함하지만
  값의 신선도는 검사하지 않는다(리플레이 창이 열려 있다). 설계 문서 부록이 이미
  관측해 둔 기존 동작이고 T6 이 만든 문제가 아니라 손대지 않았다. Apps Script 가
  트래픽을 늘리므로 별도 티켓 후보다.
