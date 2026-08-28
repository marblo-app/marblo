# 구글 민감 스코프 0 — 설계와 경로 판정

> 티켓 5UI2a7MsD75QqgRB8icV. **설계 문서다. 이 티켓에서 배선·entitlement 변경·
> Apps Script 실물은 만들지 않는다.** 코드 변경은 `electron/google-restricted-scopes.ts`
> 의 목록·주석까지다. 구현 분할안은 §9 에 있다.
>
> 앞 작업: #1267 이 restricted 3개(`drive.readonly` · `gmail.readonly` ·
> `gmail.compose`)를 빼고 `google-restricted-scopes.ts` 를 만들었다. 이 문서는
> 그 파일의 두 원칙을 그대로 이어받는다 — **삭제가 아니라 보류**, 그리고
> **게이트는 토큰이 아니라 앱에**.

---

## 1. 왜 0 인가 — 1개와 0개 사이에 심사가 있다

Google 은 OAuth 스코프를 non-sensitive / sensitive / restricted 셋으로 나눈다.
#1267 이 restricted 를 빼면서 **CASA 보안평가**(유료·연 1회 갱신)는 사라졌다.
남은 것은 6개인데, ★그중 **sensitive 는 5개**다. `drive.file` 은 Google 콘솔의 **"민감하지 않은 범위"** 칸에 `openid`·`userinfo.email` 과 함께 있다(2026-08-28 사장님이 실제 콘솔 화면으로 확인). 그리고 sensitive 는 공짜가 아니다.

앱을 게시(publishing status = In production)할 때 붙는 **검증 심사**는
"sensitive **또는** restricted 스코프를 요청하는 경우"에 발동한다. 그 심사가
요구하는 것:

- **데모 영상** — 요청하는 **스코프마다** 그 권한이 실제로 쓰이는 장면
- **도메인 소유권 확인** — 홈페이지·개인정보처리방침 도메인
- **브랜드 검증** — 앱 이름·로고·동의 화면
- **스코프 정당화** — 각 스코프가 왜 최소한인지, 정책 개정 왕복

이건 며칠이 아니라 왕복 단위다. 그리고 **1개만 남아도 통째로 붙는다.** 6개를
1개로 줄이는 것은 심사 부담을 6분의 1로 줄이는 게 아니라, 아무것도 줄이지
않는다. 0 만이 심사를 없앤다.

0 이 되면 남는 것은 로그인용 `openid` · `email` · `profile` 셋뿐이고, 이 셋은
전부 non-sensitive 다. 스코프가 유발하는 심사가 사라지고, 동의 화면을 그날
production 으로 전환할 수 있다.

> **정직하게 적어 둘 한 가지.** 사라지는 것은 **스코프가 유발하는 검증**이다.
> 커스텀 로고·앱 이름을 동의 화면에 쓰면 **브랜드 검증**은 별도로 남을 수
> 있다(스코프와 무관한, 훨씬 가벼운 트랙). 게시 시점에 콘솔이 무엇을 요구하는지
> 한 번 확인하고, 브랜드 검증이 걸리면 그건 이 설계의 실패가 아니라 별개
> 항목이다. "0 개면 아무 확인도 없다"고 미리 단정하지 않는다.

---

## 2. 지금 남은 6개(sensitive 5 + non-sensitive 1)와 그 실제 소비자

스코프를 뺄 때 무엇이 죽는지는 스코프 이름이 아니라 **호출 경로**가 말한다.
코드를 따라가 확인한 소비자는 아래가 전부다.

| 스코프                  | 분류      | 실제 소비자                                                      |
| ----------------------- | --------- | ---------------------------------------------------------------- |
| `calendar.readonly`     | sensitive | MCP `calendar_list` · 비서 **일정 트리거**(`assistant-triggers`) |
| `calendar.events`       | sensitive | MCP `calendar_create` · `calendar_patch`                         |
| `gmail.send`            | sensitive | MCP `gmail_send` (2단계 확인 계약)                               |
| `contacts.readonly`     | sensitive | MCP `contacts_search` — **내부 소비자 0**, 에이전트 도구뿐       |
| `spreadsheets.readonly` | sensitive | 비서 **시트 새 행 트리거**                                       |
| `drive.file`            | **non-sensitive** | MCP `drive_write` — **이미 잠겨 있다**                   |

★ 마지막 줄이 이 표에서 제일 중요하다. `drive_write` 는 #1267 이
`WITHHELD_CAPABILITIES` 에 넣어 이미 막았다. 목적지인 프로젝트 위키 폴더가
사용자 소유 폴더라 `drive.file` 로는 메타데이터조차 못 읽기 때문이다. 즉
**`drive.file` 은 지금 아무 능력도 사주지 않는다.** (심사를 부르지는 않는다 — non-sensitive 다. 그래서 회수는 최소권한 정리이지 심사 제거가 아니다.)

---

## 3. 건별 판정

각 항목은 **판정 / 대체 / 무엇을 잃나 / 어디서 되나** 넷을 말한다.
"잃는 것 없음"이라고 쓸 수 있는 항목은 하나뿐이고, 나머지는 값을 치른다.
그 값을 여기서 숨기지 않는다.

### 3.1 `drive.file` → **회수. 대체 불필요.** (비용 0)

**판정: 즉시 뺀다.** 유일한 소비자 `drive_write` 가 이미 잠겨 있으므로 이
스코프를 빼서 새로 잃는 기능은 **0** 이다. 6개 중 유일하게 공짜다.

★단 이유를 정확히 적어 둔다. `drive.file` 은 **non-sensitive 라 애초에 심사를 유발하지 않는다.** 즉 이걸 빼는 것은 심사 제거에 기여하지 않는다 — 빼는 이유는 "아무 능력도 사주지 않는 스코프를 동의 화면에 남겨 두지 않는다"는 최소권한이다. 남겨 두어도 심사 관점에서는 무해하므로, T1 에서 우선순위를 낮게 두어도 된다.

Drive 위키가 하려던 역할은 이미 두 번 대체돼 있다.

- **로컬 위키** — `defaultWikiRootPath` 가 `<프로젝트>/docs/wiki` 를 가리키고,
  `wiki_query` · `wiki_ingest` · `wiki_lint` 가 그대로 돈다. #1267 의
  `drive_read` 문구가 이미 사용자를 여기로 보내고 있다.
- **노션 커넥터** — `notion-auth.ts` · `notion-connector.ts` ·
  `notion-project-binding.ts` 와 도구 `notion_search` / `notion_fetch` /
  `notion_write`. **구글과 무관한 자체 OAuth 다.** 구글 스코프를 0으로 만들어도
  이 경로는 손대지 않는다.

**새로 만들 것이 없다.** 이 항목은 §9 의 T1 에서 스코프 문자열만 고치면 끝난다.

### 3.2 `calendar.readonly` + `calendar.events` → **애플 캘린더** (macOS 전용)

**판정: macOS 에서 대체. Windows/Linux 에서는 잃는다.**

#### 왜 이게 성립하는가 — 대부분의 사용자에게 구글 캘린더는 그대로다

macOS 사용자가 구글 캘린더를 시스템 설정에 추가해 두면(가장 흔한 구성) Apple
Calendar 는 그 캘린더를 CalDAV 로 들고 있다. 그러면 **우리가 Apple Calendar 에
쓴 일정은 사용자의 구글 캘린더로 그대로 동기화된다.** 참석자 초대 메일도
구글이 사용자 계정으로 보낸다. 우리는 OAuth 스코프를 하나도 갖지 않은 채
같은 결과를 얻는다 — 우리가 구글을 대신 만지는 대신, 사용자의 기기가 이미
갖고 있는 연결을 쓰기 때문이다.

이것이 이 대체가 "차선"이 아닌 이유다. 데이터 경로가 **우리를 거치지 않게**
된다는 점에서 오히려 낫다.

#### 구현 수단 — JXA(`osascript -l JavaScript`) 를 먼저 쓴다

| 후보                       | 비용                                                                                                    | 판정                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| **JXA → Calendar.app**     | 네이티브 모듈 0. `automation.apple-events` entitlement + `NSAppleEventsUsageDescription`                | ★**1순위**                |
| EventKit (네이티브 애드온) | 네이티브 모듈 빌드(arm64 rebuild·asar unpack·공증) + `NSCalendarsFullAccessUsageDescription`(macOS 14+) | 성능이 실측으로 막힐 때만 |
| 클래식 AppleScript 문자열  | JXA 와 권한 동일, 출력 파싱이 취약                                                                      | 안 쓴다                   |

JXA 를 1순위로 두는 근거는 취향이 아니라 **이 저장소의 선례**다. `main.ts:10234`
가 이미 `osascript -l JavaScript` 를 `execFile` 로 띄워 클립보드를 읽고 있고,
그 코드의 머리주석이 "AppleScript 문자열 강제 변환이 실측으로 틀렸다"는 이유로
JXA 를 택한 이력을 남겨 놓았다. 같은 이유가 여기서도 그대로 성립한다 — JXA 는
결과를 JSON 으로 뱉을 수 있어 파싱이 계약이 된다.

#### ★가장 큰 미지수 — 읽기 지연

Calendar.app 의 스크립팅 인터페이스는 캘린더가 크면 날짜 범위 질의가 느리다는
것이 널리 보고돼 있다. 일정 트리거는 `upcomingMinutes` 만큼의 **좁은 창**만
보면 되므로 괜찮을 가능성이 높지만, **가능성으로 배선을 결정하지 않는다.**
T4 는 스파이크로 시작한다: 실제 계정에서 "지금부터 N분" 질의의 지연을 측정하고,
트리거 주기(`pollMinutes`, 최소값 존재) 안에 들어오지 못하면 그때 EventKit
네이티브 모듈로 분기한다. 판정 기준을 미리 못 박아 둔다 — **p95 3초.**

#### 무엇을 잃나 (숨기지 않는다)

- **Windows/Linux 에서 일정 기능 전부.** §6 이 무엇을 보여줄지 정한다.
- **`send_updates` 의 보장.** 구글 계정이 Apple Calendar 에 연결돼 있으면 구글이
  초대를 보내지만, 로컬 캘린더에만 쓰면 초대가 나가지 않는다. 도구는 "어느
  캘린더에 썼는지"를 결과에 적어야 하고, "초대를 보냈다"고 말해서는 안 된다.
- **Calendar.app 이 첫 호출에서 실행된다.** 사용자 화면에 앱이 뜬다. 놀라지
  않게 하려면 첫 사용 안내가 필요하다(T4).

### 3.3 `gmail.send` → **Resend + 애플 메일, 둘 다** (기본 경로가 다르다)

**판정: 둘 다 만든다. 하나로 합치지 않는다.** 두 경로가 서로 다른 것을 사기
때문이다.

#### ★애플 메일이 Resend 보다 나은 두 가지

1. **사용자 본인 주소로 나간다.** Resend 는 우리 도메인에서 발송한다. 사용자가
   자기 고객에게 보내는 메일이라면 받는 쪽에 우리 도메인이 찍히는 것은 그냥
   틀린 결과다. Apple Mail 은 사용자가 Mail.app 에 설정해 둔 계정(대개 본인
   Gmail)으로 나간다 — `gmail.send` 가 하던 일과 **정확히 같다.**
2. **★메일 읽기가 돌아온다.** `gmail.readonly` 를 포기하며 잃은 능력이다
   (#1267 의 `gmail_read` · `gmail_trigger`). Mail.app 은 사용자의 메일을 이미
   사용자 자격으로 로컬에 갖고 있고, 스크립팅으로 제목·발신자·본문·검색이
   된다. **구글 스코프를 0으로 만들면서 오히려 능력이 하나 돌아온다** — 이
   설계에서 유일하게 그런 항목이다.

#### Resend 가 사는 자리

- **크로스플랫폼 기본값.** Windows/Linux 에서 메일 발송이 살아남는 유일한 길이다.
- **자기 자신에게 보내는 브리핑.** 받는 사람이 본인이면 From 이 우리 도메인인
  것이 문제가 되지 않는다. 비서 트리거의 요약·리포트가 정확히 이 모양이다.
- **이미 배선돼 있다.** `functions/src/index.ts` 가 `api.resend.com/emails` 를
  치고 있고, `churnOutreach` · `releaseAnnouncement` · `releaseUpdateAnnouncement`
  · 파운더 메일들이 그 위에서 돈다. **다시 만들지 않는다.**

  ★단, 지금 있는 것은 **관리자용 서버 발송**이다. 에이전트가 쓰려면 callable
  하나(`sendAssistantEmail`)를 새로 열어야 하고, 그 위에 인증·사용자당 레이트
  리밋·수신자 정책이 붙어야 한다. "이미 있다"가 "그대로 쓸 수 있다"는 아니다.

#### 라우팅과 정직성

```
mail_send(to, subject, body, …, confirm)
  macOS + Mail.app 계정 ≥1 + 자동화 허용  → Apple Mail   (From: 사용자 주소)
  그 밖                                    → Resend       (From: 우리 도메인, Reply-To: 사용자)
```

★**어느 경로로 나갔는지와 From 주소를 결과 문장에 반드시 적는다.** 발신 주소가
조용히 바뀌는 것은 사용자가 나중에 답장함에서 발견하게 되는 종류의 배신이다.
확인 프롬프트(`confirm=true` 계약, #1267 의 `docs/GMAIL_DRAFT_REPLACEMENT.md`)에도
From 이 들어가야 한다.

#### 무엇을 잃나

- **메일 읽기는 macOS 전용이다.** Windows 에서는 여전히 없다. Resend 의 인바운드
  기능으로 흉내내는 안은 **기각** — 도메인·MX 설정을 사용자에게 요구하고, 읽는
  것은 사용자의 기존 메일함이 아니라 우리에게 새로 온 메일뿐이라 목적이 다르다.
- **Mail.app 을 안 쓰는 사용자.** 웹 Gmail 만 쓰면 Mail.app 에 계정이 0개다.
  `count of accounts` 로 감지해서 Resend 로 떨어뜨리고, 그 사실을 말한다.
- **Resend 경로는 본문이 우리 서버를 지나간다.** `gmail.send` 는 사용자→구글
  직행이었다. 프라이버시 축에서 한 걸음 뒤다. 그래서 기본값이 아니라 폴백이고,
  macOS 에서는 Apple Mail 이 우선한다.

### 3.4 `contacts.readonly` → **불필요. 지금은 대체하지 않는다.**

**판정: 회수하고 비워 둔다.** 애플 연락처로 대체하는 것은 기술적으로 쉽다 —
§5 의 entitlement 를 이미 깔고 나면 `Contacts.app` 도 같은 수단으로 읽힌다.
그런데도 하지 않는 이유는 셋이다.

1. **내부 소비자가 0 이다.** `contacts_search` 는 에이전트 도구로만 존재하고,
   플로우·미션·트리거 어느 것도 쓰지 않는다.
2. **★TCC 프롬프트는 예산이다.** 자동화 대상 앱마다 별도 승인 팝업이 뜬다
   (§5.3). Calendar 와 Mail 만으로 이미 두 번이다. 세 번째 팝업을 거의 안 쓰는
   기능에 쓰면, 정작 중요한 두 개의 승인률이 떨어진다.
3. 대체 행동이 싸다 — 에이전트가 이름 대신 이메일 주소를 물으면 된다.

그래서 **문구로 막고, 근거가 생기면 연다.** 잠금 문구는 #1267 의 뼈대를 따른다:
무엇이 / 왜 / 대신 무엇을. 재개 조건도 미리 적어 둔다 — 메일·일정 흐름에서
"이름만 알고 주소를 모른다"가 실측으로 반복되면 그때 T8 을 연다.

### 3.5 `spreadsheets.readonly` → **Apps Script → 이미 배포된 웹훅**

**판정: 대체. ★유일하게 Windows 에서도 되는 대체다.** Apps Script 는 사용자의
구글 계정 안에서 구글 클라우드가 돌리므로, 우리 앱의 플랫폼과 무관하다.

#### 다시 만들지 않는다 — 웹훅은 서버에 살아 있다

#1256 의 트리거가 배포돼 있다. 계약을 코드에서 확인했다
(`functions/src/assistantWebhook.ts`):

- **프로비저닝**: callable `provisionAssistantWebhook({ projectId, rotate? })`
  → `{ webhookId, url, secret }`. URL 은 `…/assistantWebhook?webhookId=awh_…`
- **서명**: 헤더 `x-marblo-signature: ts=<epoch초>;h1=<hex>`
  `h1 = HMAC_SHA256(secret, "<ts>:<요청 본문 문자열 그대로>")`
- **본문**: `{ event, source?, payload }` — `payload` 는 **평면 스칼라만**
  (string/number/boolean/null), 최대 20필드, 문자열 2,000자, 총 텍스트 8,000자,
  raw body 32KB
- **레이트 리밋**: 웹훅당 **60초에 10회**, 600초에 60회 (그리고 IP 당 별도)

#### ★Apps Script 는 반드시 배치로 보낸다

`onEdit` 를 그대로 웹훅에 연결하면 안 된다. 50행을 붙여넣는 순간 편집 이벤트가
쏟아져 60초 10회 제한에 즉시 걸리고, 그 뒤 이벤트는 조용히 버려진다.

설계는 **시간 구동 트리거 + 커서**다 — 지금 `sheets-connector.ts` 의
`detectNewSheetRows` 가 하는 일을 사용자의 스크립트 쪽으로 그대로 옮기는 것이다.

```
N분마다 (installable time-driven trigger)
  cursor = PropertiesService.getScriptProperties().get('marblo_last_row')
  새 행 = 시트 마지막 행 - cursor
  새 행이 없으면 아무 것도 보내지 않는다   ← 조용한 tick 이 정상이다
  있으면 POST 1회 (행 수 + 최근 행 요약, 20필드 예산 안에서)
  cursor 갱신
```

한 tick 에 POST 는 최대 1회. 레이트 리밋에 구조적으로 닿지 않는다.

#### Apps Script 쪽 함정 두 개 (T6 이 반드시 밟을 것)

1. **HMAC 바이트 부호.** `Utilities.computeHmacSha256Signature()` 는 **부호 있는**
   바이트 배열을 준다. 그대로 `toString(16)` 하면 음수가 나와 서명이 틀린다.
   `(b & 0xff).toString(16).padStart(2, '0')` 로 접어야 한다. Apps Script HMAC
   의 고전적인 버그다.
2. **서명 대상은 "보낼 본문 문자열 그대로"다.** 객체를 두 번 직렬화하면
   바이트가 달라져 서명이 깨진다. `const body = JSON.stringify(obj)` 를 한 번만
   만들고, 서명도 전송도 그 변수를 쓴다(`UrlFetchApp.fetch(url, { payload: body })`).

#### 무엇을 잃나 — 이게 이 설계에서 가장 비싼 항목이다

**설정 비용이 "구글 연결" 클릭 한 번에서 "스크립트 붙여넣기"로 올라간다.**
숨길 수 없는 퇴보다. 완화는 붙여넣기를 **한 번**으로 줄이는 것뿐이다: 설정
화면이 URL·시크릿·시트 ID 가 **이미 채워진** 스크립트 전문을 복사 버튼과 함께
보여 주고, 사용자는 붙여넣고 Apps Script 안에서 한 번 승인한다. 그 이상으로
매끄럽게 만들 방법은 없고, 있는 척하지 않는다.

부수 효과 하나는 좋다: `assistantTriggers.sheets` 가 `webhook` 트리거로
흡수되면 폴링 경로 하나가 통째로 사라진다. 단 **지우지 않는다** — #1267 의
규율대로 설정 스키마와 `detectNewSheetRows` 는 보류 상태로 남긴다.

---

## 4. ★Playwright 는 답이 아니다

이 안이 세 번 나왔다. 다음 사람이 또 물을 것이므로 여기 남긴다.

**구글 메일·캘린더를 Playwright 로 몰 수 없다.**

1. **기술적으로 막힌다.** 구글은 자동화된 브라우저의 로그인을 탐지해 차단한다
   (`이 브라우저 또는 앱은 안전하지 않을 수 있습니다`). 약관 이전에 그냥 동작하지
   않는다. 논쟁의 대상이 아니라 관측된 사실이다.
2. **우회하면 사용자가 다친다.** 탐지를 피하려 들면 계정 잠금·기기 확인 루프에
   걸린다. 망가지는 것은 우리 기능이 아니라 **사용자의 주 계정**이다.
3. **목적과 정반대다.** 우리는 보유물을 줄이려고 스코프를 뺐다. Playwright 경로는
   사용자의 비밀번호나 세션 쿠키를 우리 자동화 표면에 들이는 것이라, 모든 보안
   축에서 OAuth 보다 나쁘다.
4. **깨져도 안 알려 준다.** Gmail/Calendar 의 DOM 이 바뀌면 실패가 아니라 **틀린
   데이터**가 돌아온다. 트리거가 조용히 거짓말을 하기 시작한다.

### ★애플 캘린더·애플 메일은 완전히 다른 이야기다

같은 "자동화"라는 단어를 쓴다고 같은 것이 아니다.

|             | Playwright → Gmail       | JXA → Calendar.app / Mail.app                                  |
| ----------- | ------------------------ | -------------------------------------------------------------- |
| 대상        | 원격 서비스의 웹 UI      | **사용자 기기의 네이티브 앱**                                  |
| 수단        | 브라우저 조작 시뮬레이션 | Apple 이 이 목적으로 제공하는 **문서화된 스크립팅 인터페이스** |
| 상대의 의사 | 봇 탐지로 **막고 있다**  | 승인 절차(TCC)로 **허용하고 있다**                             |
| 자격증명    | 우리가 세션을 쥔다       | 우리는 아무것도 안 쥔다 — 앱이 사용자 자격으로 읽는다          |
| 깨지는 방식 | 조용히 틀린 값           | 명시적 오류 코드(-1743 등)                                     |

전자는 남의 문을 여는 것이고, 후자는 사용자가 자기 집 열쇠를 우리에게 잠깐
넘기는 것이다. 판단이 갈릴 자리가 아니다.

---

## 5. ★빌드 제약 — 여기가 조용히 실패하는 곳

앱은 서명·공증되고 **hardened runtime** 이다. 이 사실이 macOS 자동화 경로를
지배한다. 없으면 **팝업조차 뜨지 않고 그냥 실패한다.**

### 5.1 현재 상태 (실측)

`electron-builder.yml` (mac 절):

```yaml
hardenedRuntime: true
gatekeeperAssess: false
entitlements: resources/entitlements.mac.plist
entitlementsInherit: resources/entitlements.mac.plist
```

`resources/entitlements.mac.plist` — 현재 키는 **6개가 전부**다:

```
com.apple.security.cs.allow-jit
com.apple.security.cs.allow-unsigned-executable-memory
com.apple.security.cs.allow-dyld-environment-variables
com.apple.security.network.client
com.apple.security.network.server
com.apple.security.files.user-selected.read-write
```

★**`com.apple.security.automation.apple-events` 가 없다.**

★그리고 **`extendInfo` 가 `electron-builder.yml` 전체에 없다.** 즉 번들 Info.plist
에는 **UsageDescription 문자열이 하나도 없다.** (`grep -rn "extendInfo|UsageDescription"`
무결과로 확인했다.)

이 두 개가 없는 상태에서 다른 앱에 AppleEvent 를 보내면 팝업 없이
`errAEEventNotPermitted (-1743)` 로 끝난다.

### 5.2 무엇을 더해야 하나 (T3 의 정확한 작업 목록)

**(A) `resources/entitlements.mac.plist` 에 한 줄:**

```xml
<key>com.apple.security.automation.apple-events</key>
<true/>
```

`entitlements` 와 `entitlementsInherit` 가 같은 파일을 가리키므로 이 한 번의
수정이 헬퍼 프로세스까지 덮는다. ★나중에 둘을 분리하게 되면 이 키는 **메인 앱
쪽에 반드시 남아야 한다** — AppleEvent 를 보내는 것은 메인 프로세스다.

**(B) `electron-builder.yml` 의 `mac:` 절에 `extendInfo` 신설:**

```yaml
extendInfo:
  NSAppleEventsUsageDescription: >-
    Marblo가 캘린더 일정을 조회·생성하고 메일을 읽고 보내려면
    캘린더·메일 앱을 제어할 수 있어야 합니다.
```

★**JXA/AppleScript 경로에서 필요한 키는 이것 하나다.** `NSCalendarsUsageDescription`
· `NSCalendarsFullAccessUsageDescription` · `NSContactsUsageDescription` 은
**EventKit·Contacts 프레임워크를 우리가 직접 부를 때** 필요한 키다. Calendar.app
이 우리 대신 캘린더를 읽어 주는 구조에서는 우리가 캘린더 프레임워크를 만지지
않으므로 필요 없다. 이건 JXA 경로의 실질적인 단순성 이득이고, EventKit 으로
분기하는 순간(§3.2 스파이크가 실패하면) 이 키들이 같이 따라온다는 뜻이기도 하다.

**(C) 문자열은 반드시 비어 있지 않아야 한다.** `NSAppleEventsUsageDescription`
가 없거나 빈 문자열이면 macOS 는 팝업을 띄우지 않고 요청을 거절한다. 이 문자열은
사용자가 읽는 유일한 설명이므로, 무엇에 쓰는지를 구체적으로 적는다.

**(D) 공증.** 이 entitlement 는 공증에 특별 승인이 필요한 제한 entitlement 가
아니다. `scripts/notarize.js`(afterSign) 경로는 그대로 두면 된다. 단 서명이
바뀌므로 **재빌드·재공증이 필요하다.**

### 5.3 TCC 팝업이 언제 뜨나

- **앱 실행 시점이 아니다.** **대상 앱마다 첫 AppleEvent 를 보내는 순간**이다.
  Calendar 와 Mail 은 **각각 따로** 뜬다. Contacts 를 쓰면 세 번째다(§3.4 가 이걸
  이유로 Contacts 를 미룬다).
- 팝업 문구는 시스템 문장 + 우리의 `NSAppleEventsUsageDescription` 이다.
- 결정은 (앱, 대상앱) 쌍으로 기억된다. 시스템 설정 → 개인정보 보호 및 보안 →
  **자동화** 에서 뒤집을 수 있다. 개발 중 초기화는 `tccutil reset AppleEvents com.marblo.app`.
- **거부하면** `osascript` 가 0이 아닌 코드로 끝나고 stderr 에 **-1743**
  (`errAEEventNotPermitted`) 이 나온다. 대상 앱이 없으면 -600, 객체를 못 찾으면 -1728.
- ★**entitlement 가 없을 때도 똑같이 -1743 이다. 다만 팝업이 영원히 안 뜬다.**
  런타임에서 "거부당함"과 "entitlement 누락"이 **구분되지 않는다.** 이것이 이
  절의 존재 이유다.
- ★**서명이 바뀌면 기존 승인이 초기화될 수 있다.** TCC 는 코드 서명에 승인을
  건다. entitlement 를 추가한 업데이트를 받은 사용자가 팝업을 다시 볼 수 있다.
  놀라지 않게 릴리스 노트에 적는다.

### 5.4 ★dev 에서 되는 것은 증거가 아니다

패키징되지 않은 Electron 을 `npm run dev` 로 띄우면 AppleEvent 의 책임 프로세스가
터미널이나 Electron 바이너리가 되어 **entitlement 없이도 그냥 된다.** 그래서
"로컬에서 됐다"는 이 경로에 대해 아무것도 증명하지 않는다.

**T3 의 완료 기준은 서명·공증된 실 빌드에서의 동작 확인이다.** 그 외의 증거는
받지 않는다.

### 5.5 남은 미지수 하나 — 자식 프로세스 귀속

우리는 `/usr/bin/osascript`(Apple 서명 바이너리)를 자식으로 띄운다. AppleEvent 를
실제로 보내는 것은 그 자식이고, TCC 는 **책임 프로세스(responsible process)** 로
귀속을 판단한다. 통상 자식의 책임 프로세스는 그것을 띄운 우리 앱이므로 팝업에
"Marblo"가 뜨고 우리 entitlement 가 적용된다 — 이것이 기대값이다.

그런데 hardened runtime 앱이 osascript 를 띄웠을 때 귀속이 예상과 다르게 잡히는
사례 보고가 있다. **T3 은 이걸 실 빌드에서 판정하고, 어긋나면 분기한다:**
JXA 를 자식으로 띄우는 대신 `NSAppleScript` 를 **우리 프로세스 안에서** 부르는
작은 네이티브 모듈로 바꾼다. 그러면 발신자가 우리 자신이라 귀속 논쟁이 사라진다.

미리 정하지 않고 T3 의 결정 게이트로 남긴다 — 근거 없이 네이티브 모듈을 먼저
들이는 것은 비용만 확정하는 선택이다.

### 5.6 실행기 — 지금 있는 `captureStdout` 은 못 쓴다

`main.ts` 의 `captureStdout()` 은 **모든 실패를 빈 문자열로 접는다**(클립보드
용도에는 맞는 설계다). 캘린더·메일 경로에 그대로 쓰면 -1743 을 "결과 없음"으로
읽어 **권한 문제가 조용히 사라진다** — 이 문서가 통째로 막으려는 바로 그 실패다.

T3 은 형제 함수를 하나 만든다: **exit code 와 stderr 를 보존**하고, -1743 /
-600 / -1728 을 각각의 사용자 문구로 매핑하며(§6 의 문구 뼈대), 타임아웃은
클립보드의 2초가 아니라 **첫 호출에서 대상 앱이 실행될 시간을 감안한 값**을 쓴다.

---

## 6. ★macOS 전용이 되는 것 — Windows 사용자가 무엇을 보나

`docs/wiki/_meta/CONVENTION.md` 의 정직성 조항: **없는 기능을 "있다" 또는 "곧
된다"로 쓰지 않는다.** 조용히 없는 것처럼 보이게 하는 것도 같은 위반이다 —
사용자는 자기가 뭘 잘못했는지 찾다가 시간을 버린다.

### 6.1 플랫폼별 능력표

| 기능              | macOS                       | Windows / Linux | 비고                                   |
| ----------------- | --------------------------- | --------------- | -------------------------------------- |
| 일정 조회·생성    | ✅ Apple Calendar           | ❌              | 대체 없음. 시간·웹훅 트리거로 우회     |
| 일정 트리거       | ✅                          | ❌              | 시간 트리거 · 웹훅 트리거는 그대로     |
| 메일 **발송**     | ✅ Apple Mail (**내 주소**) | ✅ Resend       | Windows 는 From 이 우리 도메인         |
| 메일 **읽기**     | ✅ Apple Mail               | ❌              | macOS 에서 #1267 이 잃은 능력이 돌아옴 |
| 연락처 조회       | ❌ (보류, §3.4)             | ❌              | 이메일 주소를 직접 입력                |
| 시트 새 행 트리거 | ✅ Apps Script              | ✅ Apps Script  | ★플랫폼 무관                           |
| 위키·문서         | ✅ 로컬 + 노션              | ✅ 로컬 + 노션  | 구글과 무관                            |

정직하게 요약하면: **Windows 사용자는 이번 변경으로 일정 기능을 잃고, 메일
발송은 발신 주소가 바뀐 채로 유지된다.**

### 6.2 어디서 말하나 (네 곳, 전부 T7)

1. **설정/하네스 화면.** 구글 커넥터 카드는 로그인 외 스코프가 없어지므로
   사라지고, 그 자리에 "macOS 앱 연동" 카드가 들어간다. Windows 에서는 **카드를
   숨기지 않고** 비활성 상태로 두되 이유를 그 자리에 쓴다. 회색으로 죽어 있고
   설명이 없는 UI 는 숨긴 것과 같다.
2. **MCP 도구 설명.** #1267 이 세운 `UNAVAILABLE — 이유 — 대안` 뼈대를 그대로
   쓴다. Windows 빌드에서도 도구를 **등록은 유지**하고 설명만 바꾼다 — 그래야
   에이전트가 "없는 도구"가 아니라 "왜 안 되는지"를 읽는다.
3. **비서 트리거 설정.** 일정 트리거 토글은 Windows 에서 비활성 + 인라인 사유.
   선례가 이미 있다 — `assistantTriggerSettings` 의 `sheets_connector_required`.
4. **다운로드·마케팅 카피.** `marblo-web` 이 캘린더·메일을 플랫폼 구분 없이
   약속하고 있지 않은지 점검한다. 제품이 정직해도 랜딩이 거짓말하면 같은 위반이다.

### 6.3 단일 진실원 — `platform-capabilities.ts`

문구를 네 곳에 흩으면 반드시 갈린다. `google-restricted-scopes.ts` 와 **같은
모양**의 모듈을 하나 더 만든다:

- 능력 이름의 유니온 타입
- 능력 → 사유·대안 문구 맵 (**무엇이 / 왜 / 대신 무엇을**, 한 문장 안에)
- `{ ok: false, error }` 를 돌려주는 판정 함수 (이 코드베이스의 커넥터 실패 계약)
- ko/en 대칭

같은 모양으로 만드는 것 자체가 설계다 — 다음 사람이 한 파일을 읽으면 둘 다
읽은 것이 된다.

---

## 7. ★이미 있는 것을 다시 만들지 않는다

| 하려던 것           | 이미 있는 것                                                | 위치                                                                    |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 시트 이벤트 수신    | **비서 웹훅 트리거** (#1256, 배포 완료)                     | `functions/src/assistantWebhook.ts` · `provisionAssistantWebhook`       |
| 메일 발송 인프라    | **Resend 배선**                                             | `functions/src/index.ts` (`api.resend.com/emails`), churnOutreach 외    |
| Drive 위키          | **노션 커넥터** (구글과 무관한 자체 OAuth) **와 로컬 위키** | `notion-*.ts` · `notion_search`/`fetch`/`write` · `defaultWikiRootPath` |
| 초안 검토 흐름      | **`gmail_send` 2단계 계약**                                 | `docs/GMAIL_DRAFT_REPLACEMENT.md` (#1267)                               |
| 잠긴 기능 문구 뼈대 | **`google-restricted-scopes.ts`**                           | 무엇이 / 왜 / 대신 무엇을                                               |

새로 만들어야 하는 것은 정확히 셋이다: **macOS 자동화 기반(T3)**, **애플
캘린더·메일 배선(T4·T5)**, **Apps Script 템플릿과 그 붙여넣기 UI(T6)**.

---

## 8. 순서 — 스코프를 언제 빼는가

두 가지 순서가 가능하고, 값이 다르다.

**(가) 대체를 먼저 만들고 스코프를 뺀다** — 사용자가 아무것도 잃지 않는다.
대신 게시가 T3~T6 만큼 밀린다.

**(나) 스코프를 먼저 빼고 대체를 뒤따르게 한다** — 오늘 게시할 수 있다. 대신
그 사이 macOS 사용자도 일정·메일을 못 쓴다.

**권고는 (나) 다.** 근거:

- 게시가 이 티켓의 사업적 목적이고, 사장님 확정 사항이다.
- 잃는 기간을 **정직하게 말할 장치가 이미 있다.** #1267 이 세운 잠금 문구
  뼈대가 그 일을 한다 — 기능이 사라진 게 아니라 "지금은 못 쓴다"가 전달된다.
- **회수(T1·T2)는 작다.** 스코프 문자열·게이트·문구뿐이라 하루 규모다. 대체가
  붙는 데 걸리는 시간이 아니라 **창이 며칠이냐**가 실제 비용이고, T3~T6 을 바로
  뒤에 붙이면 창은 며칠이다.
- **T6(Apps Script)은 macOS 와 무관해서 병렬로 먼저 끝날 수 있다.** 시트 트리거는
  창에 들어가지 않을 가능성이 높다.

★그리고 회수 자체의 순서는 #1267 의 규율을 그대로 따른다.

1. 앱 쪽 게이트를 먼저 건다 (`WITHHELD_CAPABILITIES` 확장).
2. `DRIVE_AUTH_SCOPE` 요청 목록과 `GOOGLE_CONNECTOR_REQUIRED_SCOPES` 에서 뺀다.
   ★`REQUIRED` 에서 빼는 것은 선택이 아니다 — 남겨두면 콘솔 변경 이후의 **새
   연결이 전부** "필수 스코프 미부여"로 실패한다.
3. 콘솔에서 스코프를 지운다.
4. 동의 화면을 production 으로 전환한다.

**게이트가 1번인 이유**: 콘솔에서 지워도 이미 발급된 refresh_token 은 넓은
스코프를 그대로 갖는다. 구글은 소급 철회를 하지 않는다. "토큰에 스코프가 있으면
쓴다"로 두면 기존 사용자에 한해 우리는 여전히 sensitive 데이터를 다루는 앱이고,
그건 심사가 규율하려는 바로 그 행위다. 게이트는 **토큰이 무엇을 부여받았는지
묻지 않고 무조건 막는다.** 기존 토큰의 넓이는 그냥 무해하게 잠든다.

재연결은 강제하지 않는다 — 강제해 봐야 얻는 것이 없고, 아직 도는 것들만 끊긴다.

---

## 9. 분할안

| #       | 티켓                   | 하는 일                                                                                                                                                                 | 의존    | 크기              |
| ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------- |
| **T1**  | `drive.file` 회수      | 요청·필수 목록·`DRIVE_AUTH_SCOPE` 에서 제거, 회귀 테스트 갱신. **잃는 기능 0**(§3.1)                                                                                    | 없음    | 반나절            |
| **T2**  | 남은 5개 회수 + 게이트 | `google-restricted-scopes.ts` 에 sensitive 회수분 추가, `WITHHELD_CAPABILITIES` 확장, ko/en 문구, 콘솔 삭제, production 전환. **이 티켓이 끝나면 심사 대상이 사라진다** | T1      | 1~2일             |
| **T3**  | ★macOS 자동화 기반     | entitlement 1줄 + `extendInfo` 신설 + 오류 보존 실행기(-1743/-600/-1728 매핑). **서명·공증 실 빌드에서 검증**. §5.5 귀속 판정 게이트                                    | 없음    | 2~3일 (빌드 왕복) |
| **T4**  | 애플 캘린더 경로       | 지연 스파이크(p95 3초) → `calendar_list`/`create`/`patch` 재배선 + 일정 트리거                                                                                          | T3      | 3~4일             |
| **T5a** | Resend 발송 callable   | `sendAssistantEmail` (인증·레이트·수신자 정책). **크로스플랫폼**                                                                                                        | 없음    | 1~2일             |
| **T5b** | 애플 메일 발송·읽기    | 내 주소로 발송 + 메일 읽기 복원 + 라우팅/From 표기                                                                                                                      | T3, T5a | 3~4일             |
| **T6**  | Apps Script → 웹훅     | 배치 스크립트 템플릿(HMAC 부호 함정 포함) + 복붙 UI + `sheets` 트리거 보류                                                                                              | 없음    | 2~3일             |
| **T7**  | 플랫폼 정직성          | `platform-capabilities.ts` + 설정 화면·도구 설명·트리거 토글·랜딩 카피                                                                                                  | T2      | 1~2일             |
| **T8**  | (조건부) 애플 연락처   | §3.4 의 재개 조건이 실측될 때만                                                                                                                                         | T3      | —                 |

**병렬 가능**: T1·T3·T5a·T6 은 서로 의존이 없다. T2 는 T1 뒤, T7 은 T2 뒤.
게시를 막는 임계 경로는 **T1 → T2** 뿐이다.

---

## 10. 이 티켓에서 실제로 바꾼 것

`electron/google-restricted-scopes.ts` — **목록과 주석만.** 게이트는 하나도
건드리지 않았고, 요청 스코프도 그대로다. 오늘의 동작은 #1267 직후와 동일하다.

- 회수 예정 sensitive 6개를 상수와 `PLANNED_SENSITIVE_WITHDRAWALS` 로 적었다.
  각 항목이 **어느 능력을 사고 있는지 · 무엇으로 대체되는지 · 어느 플랫폼에서
  되는지**를 데이터로 들고 있다.
- ★`WITHHELD_RESTRICTED_SCOPES` 에는 넣지 않았다. 그 배열은 "지금 요청하지 않는
  것"의 목록이고 회귀 테스트가 `DRIVE_AUTH_SCOPE` 를 그것으로 검사한다. 아직
  요청 중인 스코프를 거기 넣으면 **테스트가 옳게 실패한다.** 회수는 T1·T2 의
  일이고, 그때 이 목록에서 저 목록으로 옮기면 된다.
- 머리주석에 sensitive 까지 0으로 가는 결정과 그 이유를 적어, 이 파일이 계속
  단일 진실원으로 남게 했다.

**검증**: `npx tsc --noEmit -p tsconfig.json` · `-p electron/tsconfig.json` 둘 다
exit 0. 변경 전 베이스라인도 둘 다 exit 0 이었다 — **delta 0**.

---

## 부록: 확인하지 못한 것

- **`calendar.app.created` 의 공식 분류.** 앱이 만든 보조 캘린더에만 접근하는
  좁은 Calendar 스코프다. 이것이 non-sensitive 로 분류돼 있다면 Windows 에서도
  구글 캘린더 경로를 스코프 0을 깨지 않고 살릴 수 있다 — §6.1 의 유일한 빈칸을
  메울 후보다. **다만 분류를 공식 표에서 확인하지 못했다.** T2 진행 시 콘솔의
  스코프 목록에서 sensitive 표시 여부를 직접 확인하고, non-sensitive 가 맞으면
  별도 티켓으로 연다. 확인 전에는 이 문서의 어느 판정도 이 스코프에 기대지 않는다.
- **Calendar.app 스크립팅의 실제 지연.** §3.2 의 p95 3초 기준은 판정 기준이지
  측정값이 아니다. T4 스파이크가 채운다.
- **자식 프로세스 TCC 귀속.** §5.5 — 실 빌드에서만 판정 가능하다. T3 의 게이트다.
- **웹훅 서명의 `ts` 신선도 검사.** `verifyAssistantWebhookSignature` 는 `ts` 를
  서명에 포함하지만 값의 신선도는 검사하지 않는다(리플레이 창이 열려 있다).
  기존 동작이고 이 설계가 만든 문제가 아니라 손대지 않았지만, 관측했으므로 적어
  둔다. Apps Script 가 트래픽을 늘리면 별도 티켓 후보다.
