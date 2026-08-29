# 이메일 기반 결합키(UID2 방식)와 GA4 태깅 — 조사·판정 (2026-08-29)

티켓 `GEa0Hanjj7rDBogGqy0d`. 사장님 지시(텔레그램 2026-08-29):

> "이메일 아이디를 1차 변형하고 해시하는 형태로 연결키를 만들자. **TTD의 오픈ID
> 컨셉** 봐봐 — 그건 GA4 전송도 하거든. 이메일 기준 표준화시키고 해시 걸어서
> **사용자 속성값으로 추가 태깅**해서 **이벤트 단위로 양쪽 같이 묶어야** 할 것
> 같아, GA4랑 텔레메트리."

> ★**GA4 로 아무것도 보내지 않았다. 코드는 한 줄도 고치지 않았다.** 이 문서는
> 설계·근거까지다.

> ★**법률 판단 유보 표기 규칙**(#1316 계승). "확인 필요" 는 조사가 게을렀다는
> 뜻이 아니라 **변호사가 답해야 하는 질문**이라는 뜻이다. 계약 문면(GA4 약관)처럼
> **읽으면 확정되는 것**과, 법 적용(PIPA)처럼 **읽어도 확정되지 않는 것**을
> 구분해 적었다.

선행 문서 셋을 다시 조사하지 않았다:
`join-disclosure-and-ga4-key-decision-2026-08-29.md`(#1316) ·
`person-axis-event-stamp-2026-08-29.md`(#1315) ·
`install-ledger-events-join-2026-08-29.md`(#1318).

---

## 0. 한 줄 결론

**사장님도 `#1316` 도 각각 반쪽 맞다. 컨셉은 맞고 원안은 틀렸다 — 그리고 그
컨셉은 이미 우리 코드에 있다.** 다만 실측 하나가 이 논의의 전제를 바꾼다:
**앱은 지금 GA4 로 아무것도 보내지 않는다.** 그래서 "GA4 에 태깅해 이벤트 단위로
묶는다" 는 한 줄 추가가 아니라 **제3자 국외 전송 채널을 새로 여는 일**이다.

| 쟁점                                     | 판정                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `#1316`: GA4 약관 §7 이 해시 업로드 금지 | ★**인용은 정확하다**(원문 대조 완료). 다만 **읽기가 넓었다** — §7 이 막는 것은 "해시" 가 아니라 "Google 이 PII 로 **알아볼 수 있는 값**" 이다 |
| 사장님: "UID2 는 GA4 전송도 한다"        | ★**GA4 에 UID2 가 들어가는 근거는 못 찾았다.** UID2 는 bidstream(SSP→DSP) 규약이고 Google 제품 연동 경로가 문서에 0건이다                     |
| 사장님: 이메일 파생 키를 GA4 에          | ★**컨셉은 된다.** GA4 **User-ID** 가 공식 축이고, 문서가 "이메일로 고유 ID 를 만들어 쓰라"고 직접 예시한다                                    |
| 원안 `sha256(정규화 이메일)`             | ★**안 된다.** 솔트가 없으면 이메일 목록만으로 전수 역산 — §7 이 정확히 겨냥하는 값                                                            |
| ★UID2 알고리즘 자체                      | ★**우리 방식과 같다.** UID2 도 **비밀 솔트로 재해시**한다. 즉 "TTD 오픈ID 컨셉" 은 `analyticsPseudonym.ts` 로 **이미 구현돼 있다**            |
| 솔트 딜레마                              | ★**풀린다.** "값을 안다" ≠ "솔트를 안다" — 서버가 계산해 **자기 키 하나만** 내려주면 된다. 대가는 다른 데 있다(§4)                            |
| (가) `_ga` 경로 vs (나) GA4 태깅         | ★**(가) 유지 권고.** (나)가 더 주는 것이 지금은 붙일 대상이 없다(외부 유입 0건). 병목은 키가 아니라 링크 커버리지다                           |
| `EVENTS_PERSON_STAMP_FROM` 게이트        | ★**열자.** 방침 안쪽이고, 사장님 질문("텔레메트리만으로 사람 구분되나")의 직접적 답이다. 전제조건은 §7                                        |
| 방침 추가 개정                           | (가)+게이트 → **불필요**. (나) → **필수**, 그리고 앱 GA4 를 켠다면 **전면 재동의 검토 대상**                                                  |

---

## 1. ★먼저 — 이 논의의 전제를 바꾸는 실측 둘

### 1-1. 앱은 지금 GA4 로 아무것도 보내지 않는다

`v3/src/lib/telemetry/ga4.ts` 는 존재한다. 그런데:

```
$ grep -rn "maybeInitGA4|telemetry/ga4" v3 --include=*.ts --include=*.tsx
v3/src/lib/telemetry/ga4.ts:45:export async function maybeInitGA4(...)   ← 정의 한 줄뿐
```

- ★**호출자가 0 이다.** 이 모듈은 통째로 죽은 코드다.
- `VITE_GA4_MEASUREMENT_ID` 는 `v3/.env.example` 에도 없고 저장소 어디에도 값이
  없다. 설정돼 있어도 `maybeInitGA4` 를 아무도 안 부르므로 스크립트가 안 붙는다.
- GA4 측정 ID 가 실제로 있는 곳은 `marblo-web/.env.production` **하나뿐**이다.

★즉 **GA4 는 마케팅 웹사이트에만 있다.** 사장님이 말씀하신 "GA4랑 텔레메트리를
이벤트 단위로 묶는다" 에서 "GA4" 는 **앱 이벤트가 아니라 웹 방문 이벤트**다.
앱 이벤트를 GA4 리포트에 넣으려면 **앱→GA4 송신을 처음으로 켜야 한다.**

### 1-2. 배포된 방침은 그것을 **평서문으로 금지**하고 있다

`v3/src/components/legal/privacyContent.tsx` 의 "오류·크래시 리포트" 항 원문:

> "앱은 **GA4·Mixpanel 등 사용 분석 도구로 데이터를 보내지 않습니다.**"
> EN: "The app **does not send data to usage-analytics tools like GA4 or
> Mixpanel.**"

그리고 "웹사이트 분석 (GA4)" 항:

> "마블로 웹사이트(marblo.app)는 데스크톱 앱과 **별개로** GA4를 사용해 익명 방문
> 통계를 수집하며 … **데스크톱 앱에는 적용되지 않습니다.**"

★`#1315` §5.2 는 깨지는 문장을 요약문 끝의 **괄호**로 봤다. 실제로는 그보다
강하다 — **독립 항목의 평서문 약속**이 둘이다. 앱에서 GA4 로 무엇이든 보내는
순간 이 두 문장이 동시에 거짓이 된다. 문면 교체 한 줄로 덮을 크기가 아니다.

---

## 2. ★1순위 — GA4 약관 확인 (원문 대조)

### 2-1. `#1316` 의 인용은 정확하다

Google Analytics Terms of Service **§7 Privacy**
(https://marketingplatform.google.com/about/analytics/terms/us/) — 원문 대조 완료
(2026-08-29):

> "You will not and will not assist or permit any third party to pass
> information, **hashed or otherwise**, to Google that **Google could use or
> recognize as personally identifiable information**, except where permitted by,
> and subject to, the policies or terms of Google Analytics features made
> available to You, and only if, any information passed to Google for such Google
> Analytics feature is hashed using industry standards."

같은 §7 의 고지 의무도 원문대로다:

> "You must post a Privacy Policy and that Privacy Policy must provide notice of
> Your use of cookies, identifiers … **You must disclose the use of Google
> Analytics**, and how it collects and processes data. This can be done by
> displaying a prominent link to the site "How Google uses information from sites
> or apps that use our services", (located at
> **www.google.com/policies/privacy/partners/** …)"

### 2-2. ★그런데 `#1316` 이 못 본 문서가 있다 — Google 이 PII 를 직접 정의한다

**Understanding PII in Google's contracts and policies**
(https://support.google.com/analytics/answer/7686480) 원문:

> "Google interprets PII as information that could be used **on its own** to
> directly identify, contact, or precisely locate an individual. This includes:
> **email addresses**, mailing addresses, phone numbers, precise locations …,
> full names or usernames"
>
> "Google interprets PII **to exclude**, for example: pseudonymous cookie IDs,
> pseudonymous advertising IDs, IP addresses, **other pseudonymous end user
> identifiers**."

★**이것이 판정선을 바꾼다.** §7 이 막는 것은 "해시된 값" 이 아니다. "Google 이
PII 로 **쓰거나 알아볼 수 있는** 값" 이고, Google 스스로 **가명 최종사용자
식별자는 PII 가 아니라고** 적어 놓았다. 그래서 두 값의 운명이 갈린다:

| 값                                        | Google 이 알아볼 수 있나                                                                              | §7 판정                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **솔트 없는** `sha256(정규화 이메일)`     | ★**있다.** Google 은 이메일↔사람 대응표를 가진 쪽이다. 자기 이메일을 같은 규칙으로 해시해 대조하면 끝 | ★**"hashed or otherwise" 가 겨냥하는 값**                              |
| **HMAC + 비밀 솔트** 가명 (`us_` + hex24) | ★**없다.** 솔트가 함수 런타임 env 에만 있어 역산도 대조도 불가                                        | "other pseudonymous end user identifiers" 에 해당 → **금지 대상 아님** |

★**단정할 수 있는 것 / 없는 것**을 나눠 적는다(#1316 규율 계승):

- ★**공학적 사실(단정 가능)**: 솔트 없는 해시는 이메일 목록만으로 전수 역산된다.
  솔티드 HMAC 은 솔트 없이는 역산되지 않는다.
- ★**계약 문면(읽으면 확정)**: §7 은 "해시" 자체가 아니라 "Google 이 PII 로
  알아볼 수 있는 정보" 를 막는다. Google 문서는 가명 식별자를 PII 에서 제외한다.
- ★**확인 필요(변호사)**: 우리 `us_` 가명이 Google 이 말하는 "pseudonymous end
  user identifier" 에 **해당한다고 Google 이 실제로 판단할지**. Google 문서 자체가
  "consult an attorney if you are in doubt" 라고 적고 있다
  (https://support.google.com/analytics/answer/6366371).

### 2-3. User-ID 는 공식 축이고, 이메일 파생을 **문서가 직접 예시한다**

**[GA4] Measure activity across platforms with User-ID**
(https://support.google.com/analytics/answer/9213390) 원문:

> "when a user signs in, you could use their **email address to generate a unique
> ID** that you can reference throughout your website or application. Each user ID
> must be **256 characters or less**."
>
> "You're responsible for ensuring that your use of the user ID is in accordance
> with the Google Analytics Terms of Service. This includes avoiding the use of
> **impermissible personally identifiable information**, and **providing
> appropriate notice of your use of identifiers in your Privacy Policy**. Your
> user ID **must not contain information that a third party could use to determine
> a user's identity**."

→ ★**사장님 컨셉은 문서가 허용한다.** "이메일을 정규화하고 해시해서 키를 만든다"
자체는 Google 이 예시로 드는 방식이다. 걸리는 것은 **어떻게 해시하느냐**다.
마지막 조건("제3자가 신원을 알아낼 수 없어야")을 원안은 못 넘고, 우리 HMAC+솔트는
넘는다.

설계에 직접 영향을 주는 부수 사실 셋(전부 같은 문서 원문):

1. > "When you collect user IDs and you have linked Analytics to BigQuery, that
   > information is exported to BigQuery **regardless of the consent status of
   > your users.**"

   ★**동의 게이트를 GA4 쪽에 맡길 수 없다.** 막을 수 있는 자리는 **우리가 값을
   set 하는 순간** 하나뿐이다. 미동의자 미태깅은 클라이언트 코드의 책임이다.

2. > "Before signing in: If a user triggers events before a User-ID is set,
   > Analytics will associate those initial events with that User-ID."

   ★**같은 세션 안에서만**이다. 우리 퍼널(웹 랜딩 → 다운로드 → **앱** 로그인)은
   세션도 플랫폼도 다르므로 이 소급은 거의 도움이 안 된다. `#1316` §2-4 와 같은
   결론.

3. **[GA4] Best practices for User-ID**
   (https://support.google.com/analytics/answer/12675187) 원문:

   > "It is recommended that you **do not register a user ID as a custom
   > dimension.** Creating unnecessary high-cardinality custom dimensions, like
   > User ID, negatively impact your reports and explorations, and cause data to
   > be condensed under the **(other)** row. **Instead, use the User-ID feature.**"

   ★**사장님이 지목하신 "사용자 속성값(user property)" 은 Google 이 권하지 않는
   자리다.** GA4 의 user property 는 사용자 범위 맞춤 측정기준이 되고, 사람 단위
   키는 카디널리티가 사용자 수와 같아 리포트가 `(other)` 로 뭉개진다. 같은 목적을
   위한 자리가 따로 있다 — `user_id`(User-ID 기능). ★**만약 (나)로 간다면 user
   property 가 아니라 User-ID 로 가야 한다.**

### 2-4. 해시 이메일을 받는 공식 필드는 있다 — 우리 용도가 아니다 (#1316 재확인)

Measurement Protocol `user_data.sha256_email_address`
(https://developers.google.com/analytics/devguides/collection/ga4/uid-data) 원문:

> "The Measurement Protocol is using **the same normalization and hashing
> algorithm as the Google Ads API Enhanced Measurement feature**."
> "we recommend that you also include the **user_id** parameter whenever
> `user_data` is provided"

→ `#1316` §2-3 그대로다. 이건 **Google Ads 매칭용 목적 한정 필드**이지 범용 조인
키 자리가 아니다. 재조사하지 않았고 결론도 바꾸지 않는다.

---

## 3. ★UID2 가 GA4 에 들어가는가 — 근거를 못 찾았다

### 3-1. 찾은 것

UID2 공식 문서(https://unifiedid.com/docs) 전수 확인:

| 문서                                                                         | 확인 내용                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UID2 overview](https://unifiedid.com/docs/intro)                            | "enables deterministic identity for **advertising opportunities on the open internet**" · "publisher websites, mobile apps, and CTV apps to **monetize through programmatic workflows**" |
| [Identifier types](https://unifiedid.com/docs/ref-info/uid-identifier-types) | raw UID2 = "Shared in bidstream? **No**" / UID2 token = "**Yes**". "SSPs pass UID2 tokens **in the bidstream** and DSPs decrypt them at bid request time"                                |
| [Participants](https://unifiedid.com/docs/overviews/participants-overview)   | 참가자 유형: Publishers · Advertisers · **DSPs** · Data providers. Core Administrator = **The Trade Desk**. ★**Google 제품 연동 경로 0건**                                               |

★그리고 GA4 쪽에서 외부 식별자를 받는 자리는 문서상 셋뿐이다: (1) `user_id`(내가
만든 값), (2) `user_data.sha256_*`(Ads 매칭 규격), (3) `client_id`. **UID2 를 받는
필드는 없다.**

### 3-2. 판정 — 사장님 기억은 다른 플랫폼의 것일 가능성이 높다

★티켓이 열어 두라고 한 가능성이 **근거로 뒷받침된다.** UID2 의 소비 지점은
bidstream(SSP→DSP)이고, GA4 는 Google 제품으로 자체 식별자(`client_id` /
`user_id`)를 쓴다. 두 세계가 만나는 문서상 지점이 없다.

★**단정하지 않는 것**: "TTD 나 다른 참가자가 GA4 로 UID2 를 보낸 적이 한 번도
없다" — 이건 **부정 증명**이라 문서로 못 세운다. 우리가 말할 수 있는 것은
**"공식 문서 어디에도 그 경로가 없다"** 까지다. → ★**확인 못 함**으로 남긴다.

### 3-3. ★그런데 사장님 컨셉은 맞다 — 그리고 우리는 이미 그걸 하고 있다

UID2 가 raw UID2 를 만드는 방법(원문, identifier-types):

> "To avoid revealing the source data, the input value is hashed if it was not
> already hashed, **and then hashed again using a secret salt value** to create the
> raw UID2."

그 솔트의 출처(원문, participants-overview):

> "Operators periodically receive and store up-to-date encryption keys **and
> salts** from the UID2 Core Service, **salt and hash** directly identifying
> information (DII) to return raw UID2s"

★**즉 UID2 는 솔트 없는 이메일 해시가 아니다.** 정규화 → SHA-256 → **비밀 솔트로
재해시**이고, 솔트는 클라이언트가 아니라 **Operator 서버**에 있다. 클라이언트/
퍼블리셔는 솔트를 절대 안 받고 **토큰만** 받아 간다.

| 축                       | UID2 raw UID2                          | 우리 `us_` 키                              |
| ------------------------ | -------------------------------------- | ------------------------------------------ |
| 입력                     | 정규화 이메일                          | Firebase uid                               |
| 비밀값                   | Core Service 배포 salt (Operator 보관) | `ANALYTICS_ID_SALT` (함수 런타임 env 전용) |
| 연산                     | SHA-256 → salt 재해시                  | HMAC-SHA256(salt, "user:"+uid)             |
| 클라이언트가 솔트를 아나 | **아니오**                             | **아니오**                                 |
| 역산 가능성              | 솔트 없이는 불가                       | 솔트 없이는 불가                           |

★**결론: "TTD 의 오픈ID 컨셉으로 가자" 는 지시는 이미 이행돼 있다.**
`v3/functions/src/analyticsPseudonym.ts` 가 구조적으로 같은 것을 한다. 그리고
원안 `sha256(가입일자 + 이메일)` 은 **UID2 컨셉이 아니다** — UID2 가 반드시 넣는
비밀 솔트가 빠져 있다. 사장님 제안을 기각하는 게 아니라, **사장님이 참조하신
표준이 우리 현행 방식 편**이라는 뜻이다.

---

## 4. ★솔트 딜레마 — 풀린다. 다만 대가가 다른 데 있다

티켓의 전제: "GA4 에 키를 실으려면 클라이언트가 그 값을 알아야 하는데, 솔트를
클라이언트에 두면 솔트가 아니다."

★**전제 안에 숨은 등호가 하나 틀렸다: "값을 안다" ≠ "솔트를 안다".**

- 클라이언트가 알아야 하는 것은 **자기 자신의 키 하나**다. 남의 키가 아니다.
- 그 키는 **로그인 후 서버가 계산해서 내려준다**(인증된 콜러블 1회 호출). 솔트는
  함수 런타임 env 에 그대로 남는다.
- 자기 키 하나를 아는 것으로는 남의 키를 못 만든다 — HMAC 이라 솔트 없이는 다른
  입력의 출력을 계산할 수 없다. **역산 위협 모델이 성립하지 않는다.**
- ★UID2 도 정확히 이 구조다(§3-3). 퍼블리셔는 Operator 에 DII 를 보내고 **결과
  토큰만** 받는다. 솔트는 절대 클라이언트로 안 나간다.

그래서 `#1316` §2-6 표의 (b) 행("서버 계산 후 하달") 이 솔트 문제에 관한 한
**정답이다.** 이 티켓이 새로 확인한 것은, 그 방식이 **UID2 표준이 실제로 쓰는
방식과 같다**는 점이다.

### 4-1. ★그럼 진짜 대가는 무엇인가 — 셋

솔트는 안 나간다. 대신 이것들이 남는다. **이쪽이 (나)의 실제 비용이다.**

1. **로그인 전 구간을 못 잡는다.** 서버가 키를 주려면 로그인이 필요하다. 웹
   랜딩·다운로드 구간에는 계정이 없다. ★그 구간은 **(가) `_ga` 경로가 이미
   잡는다** — 조인 축이 계정이 아니라 브라우저의 GA4 `client_id` 라서 계정이
   생기기 전에 이미 값이 있다(`#1316` §2-6).
2. ★**우리 가명이 축 가드 밖 표에 착지한다.** GA4 export 는
   `asia-northeast3` 의 `analytics_*.events_*` 로 돌아온다
   (`v3/functions/src/ga4Bridge.ts`). 우리
   `analyticsProfiles.assertAxisPurity` / `FORBIDDEN_ON_ANONYMOUS_AXIS` 는 **우리
   표만** 본다. 즉 축 경계 규칙이 기계로 강제되지 않는 곳에 사람키가 놓인다.
3. ★**동의 무관 export**(§2-3 부수사실 1). GA4 에 한 번 들어간 user_id 는
   동의 상태와 무관하게 BQ 로 나간다. 되돌리는 절차가 우리 손에 없다 —
   삭제요청 대응이 `buildPersonAxisEraseSql` + `buildEventStampEraseSql` 두 개로
   끝나지 않고 **GA4 쪽 삭제 요청**이 하나 더 붙는다.

★**요약: 솔트 딜레마는 못 푸는 문제가 아니다. 못 푸는 것은 "GA4 에 들어간 값을
우리 규율 안으로 되돌리는 것" 이다.**

---

## 5. (가) vs (나) — 무엇을 얻고 무엇을 감수하나

|                  | **(가) 현행 `_ga` 인바운드**       | **(나) GA4 에 사람키 태깅**                                            |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| 방향             | GA4 → 우리 (client_id 를 받아온다) | 우리 → GA4 (**처음으로 뒤집는다**)                                     |
| GA4 로 나가는 것 | ★**0**                             | 사람 단위 가명 키                                                      |
| 로그인 전 유입   | ★**잡는다**(축이 브라우저)         | 못 잡는다(축이 계정)                                                   |
| 얻는 것          | 우리 BQ 안에서 채널↔설치↔계정      | ★**GA4 리포트 화면 안에서도** 사람 단위 · 로그인한 웹 방문자 ↔ 앱 계정 |
| 배선             | ★**이미 있다**(550/593 실측)       | 웹: 신규. 앱: **GA4 자체가 없다**(§1-1)                                |
| 방침             | #1317 문면이 덮는다                | ★**개정 필수**(§8)                                                     |
| 축 가드          | 우리 표 안 → 기계가 강제           | ★가드 밖 표에 착지                                                     |
| 되돌리기         | SQL 두 개                          | + GA4 삭제 요청                                                        |

### 5-1. ★권고 — (가) 유지. (나)는 지금 하지 않는다

셋 다 성립해야 하는 근거가 아니라, **하나만으로도 서는 근거 셋**이다.

1. ★**붙일 사람이 지금 없다.** `#1318` 실측: `install_attribution` 647행 중
   **external 0 · internal 646 · synthetic 1**. 실사용자 유입이 아직 한 건도
   없다. (나)가 유일하게 더 주는 "웹 방문자 ↔ 앱 계정" 의 모수가 0 이다.
   ★도구를 먼저 만들고 대상이 나중에 오는 순서 자체는 이상하지 않다. 문제는 이
   도구의 비용이 **되돌리기 어려운 종류**(§4-1)라는 점이다.
2. ★**병목이 키가 아니다.** `#1315` §3.2 실측: 링크 커버리지 **4/10**,
   `analytics_identity.ft_*` 는 컬럼만 있고 데이터가 0. (나)는 이 둘 중
   **아무것도 안 풀어준다.** 새 키를 심어도 링크가 4/10 이면 보이는 것도 4/10 이다.
3. ★**앱 쪽은 "한 줄 추가" 가 아니다.** §1-1·§1-2 — GA4 자체가 없고, 방침이
   평서문으로 금지한다. 앱→GA4 를 켜는 것은 수집 항목·처리자·전송국가가 통째로
   생기는 변경이고, 배너가 아니라 **전면 재동의** 검토 대상이다(§8-2).

### 5-2. ★그럼 사장님이 원하신 것은 무엇으로 답하나

지시의 실제 목적은 "GA4 라는 도구" 가 아니라 **"이벤트 단위로 사람을 구분해서
양쪽을 같이 보는 것"** 이다. 그 목적은 (나) 없이 둘로 답한다:

- **텔레메트리 쪽 사람 축** → `EVENTS_PERSON_STAMP_FROM` 게이트 개방(§7). 이게
  "텔레메트리만으로 사람 구분되나" 의 직접적인 답이다.
- **채널 ↔ 설치 ↔ 계정** → 이미 배선돼 있다(`#1315` §3.1). 남은 일은 링크
  커버리지를 올리는 것이고, 그건 `#1318` 의 링크백 수리(A)가 앱 배포되면
  1 → 최대 42 로 오른다.

### 5-3. ★만약 사장님이 (나)를 그래도 원하신다면 — 최소 조건

기각이 아니라 조건부다. 아래를 **전부** 만족해야 한다.

1. ★**웹 로그인 세션만.** 앱→GA4 는 켜지 않는다(§1-2 의 방침 약속을 지킨다).
   얻는 것은 "로그인한 웹 방문자 ↔ 계정" 하나로 좁아지지만, 방침 개정 범위도
   그만큼 좁아진다.
2. ★**값은 `user_property` 가 아니라 `user_id`.** Google 이 명시적으로 권고한다
   (§2-3 부수사실 3). user property 로 넣으면 리포트가 `(other)` 로 뭉개진다.
3. ★**값은 반드시 `pseudonymizeAnalyticsId("user", uid, ANALYTICS_ID_SALT)`.**
   새 kind·새 솔트를 만들지 않는다. 그래야 GA4 export 가 돌아왔을 때
   `analytics_user_install.user_key` / `events.userKey` 와 **같은 키 공간**에
   떨어진다. 길이 27자 ≤ 256자 제한(§2-3) 통과.
4. ★**이메일 파생으로 바꾸지 않는다.** uid 파생 그대로 간다(§6).
5. ★**서버가 계산해 내려준다.** 솔트는 클라이언트·SQL·GA4 어디로도 안 나간다(§4).
6. ★**미동의자 미태깅을 클라이언트가 보장한다.** GA4 동의 신호는 못 쓴다
   (§2-3 부수사실 1).
7. ★**방침 개정 배포가 선행**한다(§8-2). 그리고 GA4 ToS §7 이 요구하는
   `www.google.com/policies/privacy/partners/` 링크가 웹 방침에 들어가 있어야
   한다 — 이건 (나)와 무관하게 **이미 미충족**이다(§8-3).

---

## 6. 이메일 정규화 — UID2 표준을 따를 것인가

### 6-1. 두 규약의 차이 (원문 대조)

UID2 [Normalization and encoding](https://unifiedid.com/docs/getting-started/gs-normalization-encoding)
원문 규칙:

> "Remove leading and trailing spaces. If there are uppercase characters, convert
> them to lowercase. **In gmail.com addresses only**: … remove [the period] … [and]
> remove the plus sign (+) and all subsequent characters."

우리 `v3/functions/src/analyticsInternal.ts` `normalizeEmail`:

| 규칙                | UID2                            | 우리                                          |
| ------------------- | ------------------------------- | --------------------------------------------- |
| trim + 소문자화     | ○                               | ○                                             |
| `.` 제거            | `gmail.com` 만                  | `gmail.com` + `googlemail.com`                |
| ★`+` 이후 절단      | ★**`gmail.com` 만**             | ★**모든 도메인**                              |
| 이메일 모양 아닌 값 | (규정 없음)                     | `null` 반환 — 원시값 폴백 없음                |
| 출력 인코딩         | Base64(SHA-256 raw bytes), 44자 | (해당 없음 — 우리는 이메일을 해시하지 않는다) |

★차이는 실질적이다. `janesaoirse+work@example.com` 을 UID2 는 **그대로 두고**
(비-gmail 이므로) 우리는 `janesaoirse@example.com` 으로 접는다. **두 규약은 같은
값을 만들지 않는다.**

### 6-2. ★판정 — UID2 표준을 따르지 않는다. 그리고 키를 이메일 파생으로 바꾸지 않는다

1. ★**표준을 따르는 유일한 이득이 우리에게 없다.** "나중에 다른 플랫폼과도
   묶인다" 가 그 이득인데, 그러려면 UID2 참가 협약 · Operator 연동 · DSP 가
   있어야 한다. 우리는 셋 다 없고 광고 집행 자체가 없다(#1318: 외부 유입 0건).
   ★필요가 생기면 그때 정규화를 UID2 규칙으로 맞추면 된다 — **되돌릴 수 있는
   결정**이다.
2. ★**더 중요한 것: 우리 키는 이메일 파생이 아니다.** `us_` 키는
   `HMAC(salt, "user:" + uid)` — **Firebase uid 파생**이다. 이메일 정규화는
   `analyticsInternal` 의 **내부 계정 판정**에서만 쓰인다. 키를 이메일 파생으로
   바꾸면:
   - 기존 `analytics_user_install.user_key` · `analytics_purchase.user_key` ·
     각인 값이 **전부 무효**가 된다. 과거 데이터와 조인이 끊긴다.
   - **이메일을 바꾸면 같은 사람이 둘로 갈린다.** uid 는 안 바뀐다.
   - 굳이 이메일을 재료로 쓸 이유가 없다 — 사람 단위 구분에 uid 가 이미 충분하고,
     더 안전하다(계정 시스템 밖으로 새어 나갈 재료가 하나 줄어든다).
3. ★**`+` 절단 규칙 차이는 그대로 둔다.** 우리가 더 공격적인 것은 의도된
   보수성이다 — 내부 계정 판정에서 `john+test@hypemarc.com` 을 놓치면 운영자
   트래픽이 통계에 섞인다. 다만 **이 문서에 적어 둔다**: 우리 `normalizeEmail` 은
   **UID2 규약이 아니다.** 나중에 누가 "UID2 와 같다" 고 읽고 값을 교차 대조하면
   조용히 어긋난다.

---

## 7. ★`EVENTS_PERSON_STAMP_FROM` 게이트 — 지금 열 것인가

### 7-1. 판정 — 연다

사장님 질문 "텔레메트리만으로 사람 구분이 되나" 의 직접적인 답이다.
**지금은 안 된다. 게이트를 열면 된다.** 근거 셋:

1. ★**방침이 이미 그렇게 고지 중이다.** 배포된 `privacyContent.tsx` "비식별 1차
   지표" 항 원문: _"로그인한 계정의 식별자를 그대로 쓰지 않고 가명처리해 만든
   가명 구분값을 **이 기록에 함께 적습니다**."_ → 게이트를 여는 것은 방침 확장이
   아니라 **코드를 방침에 맞추는 일**이다. 지금은 **과소 구현** 상태다.
2. ★**정책 게이트는 이미 열려 있다.** `PERSON_AXIS_EFFECTIVE_FROM=2026-04-01`.
   남은 것은 기술 게이트(컬럼이 있나)뿐이다.
3. ★**같은 방침 문장이 "운영자 본인 활동 제외" 도 약속**하는데 지금 그게 안
   된다(`adminEventExclusion()` 이 항상 NULL 통과). 각인이 있으면 조인 없이
   지켜진다.

### 7-2. ★전제조건 — 순서를 바꾸면 텔레메트리가 죽는다

`#1315` §6.1 이 정본이다. 여기서는 **여는 조건**만 정리한다.

| #   | 무엇                                                                | 안 지키면                                                                                                                  |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cd v3/functions && npm run provision:event-user-key -- --apply`    | ★**1 을 건너뛰고 2·3 을 하면** 없는 컬럼에 스트리밍 insert → `logTelemetryBatch` 가 배치째 실패 = **텔레메트리 수집 중단** |
| 2   | `functions/.env.<project>` 에 `EVENTS_PERSON_STAMP_FROM=YYYY-MM-DD` | 각인 안 함(기본값). 장애가 아니다                                                                                          |
| 3   | `npm run deploy` (functions 배포)                                   | 여기서부터 각인 시작                                                                                                       |
| 4   | 화면이 `buildEventStampBoundarySql` 로 경계를 **데이터에서** 읽는다 | env 상수를 그리면 배포가 밀렸을 때 화면이 거짓말한다                                                                       |

★코드 방어는 있다(게이트 꺼짐 = 행에 컬럼을 언급조차 안 함). **방어는 실수의
대가를 줄이는 것이지 순서를 대신하지 않는다.**

### 7-3. ★백필 — 하지 않는다

- 각인은 **forward-only** 다. 과거 437,114행은 각인 없이 남는다.
- 그것들을 사람에게 붙이는 경로는 **링크표 하나뿐**이고, 그건 이미 있다
  (`v_person_all_time`).
- ★`#1318` 의 교훈을 그대로 적용한다: 소급 백필은 *"631건 조인" 이라는 더
  그럴듯한 거짓말*을 만든다. **우리가 만든 숫자는 지표로 쓸 수 없다.**

### 7-4. ★기존 행 처리 — NULL 의 뜻을 화면이 말해야 한다

`EVENT_USER_KEY_FIELD_SCHEMA` 의 description 에 이미 적혀 있다:

> "NULL 은 '사람이 없다' 가 아니라 '**각인 이전이거나 미인증 경로**' 다 — 화면이
> 둘을 구분해 말해야 한다."

★그리고 커버리지는 **어느 설계로도 100% 가 안 된다.** 미인증 경로
(`functions/src/index.ts` 의 `logAnonymousTelemetryBatch`)는 auth 가 없어 uid
자체가 없다. ★행 번호로 인용하지 않는다 — `index.ts` 는 계속 움직인다(`#1315`
가 인용한 `:8007` 은 오늘 이미 `:8262` 다).
`summarizeEventStampCoverage()` 가 `state: "off" | "stamping" | "complete"` 를
내고, `stamping` 동안 퍼센트를 헤드라인으로 그리지 말라는 사유가 이미 실려 있다.

### 7-5. 비용

| 항목                | 실측/추정                                                                               |
| ------------------- | --------------------------------------------------------------------------------------- |
| `events` 크기       | 437,114행 / 68 MB (`#1315` 실측 2026-08-29)                                             |
| 컬럼 추가           | `STRING NULLABLE`, 값 27자(`us_` + hex24). 신규 행에만 실린다 — 기존 행은 NULL(0바이트) |
| 삭제요청 UPDATE     | `UPDATE events SET userKey = NULL WHERE userKey = @k` — 68 MB 표라 싸다                 |
| ★`agent_heartbeats` | **각인 대상 아님.** 14,502,795행 / 1,753 MB — 삭제 비용이 25배라 같은 논거가 안 선다    |

### 7-6. ★게이트를 여는 순간 생기는 운영 의무

삭제요청(PIPA 제36조)은 **SQL 두 개가 짝**이다:

- `buildPersonAxisEraseSql` — 링크표에서 행 제거
- `buildEventStampEraseSql` — 각인 SET NULL

★한쪽만 부르면 반쪽이 남는다. 링크만 지우면 각인된 행이 사람 축에 남고, 각인만
지우면 과거 소급이 링크표로 살아 있다. **이 짝을 운영 절차에 넣는 것이 게이트를
여는 조건에 포함된다.**

---

## 8. 방침 추가 개정이 필요한가

### 8-1. (가) 유지 + 게이트 개방 → ★추가 개정 불필요

- GA4 로 나가는 것이 **0** 이므로 §5 제3자 제공 · §7 국외이전에 새로 걸리는 것이
  없다. `#1316` §2-6 의 논거 그대로 — §7 금지는 "pass information **to** Google"
  에 걸리는 규정이고, (가)는 방향이 반대다.
- 각인은 `#1317` 로 갱신된 문면 안쪽이다(§7-1 근거 1). 오히려 지금이 과소 구현이다.
- ★**확인 필요(변호사)**: 가명 사람키를 이벤트 행에 각인하는 것이 PIPA 제28조의2
  가명정보 처리 요건(특히 **추가정보 분리보관**)을 만족하는지. 우리가 사실로 말할
  수 있는 것은 코드뿐이다 — 솔트는 함수 런타임 env 에만 있고 BigQuery 에 없다.
  `analyticsPseudonym.ts` 주석이 이미 못박고 있듯 **"HMAC 을 씌웠으니 동의가
  면제된다" 는 논리는 우리 코드베이스가 스스로 부정한다.**

### 8-2. (나) 채택 → ★개정 필수. 그리고 앱까지 켜면 전면 재동의 검토 대상

현행 문면으로 **못 덮는다.** 최소 넷:

1. **§5 제3자 제공** — 가명이라도 **Google LLC 에 제공**하는 행위가 새로 생긴다.
   현행 방침은 GA4 를 "웹사이트가 별개로 쓰는 것" 으로만 적는다.
2. **§7 국외이전** — 이전 항목에 "**개인을 알아볼 수 없도록 처리한 사용자
   식별값**" 을 추가해야 한다. 현행 "웹사이트 GA4: 미국" 항목은 **익명 방문
   통계**를 전제로 쓰여 있다. 목적지는 같아도 **항목이 달라진다.**
3. ★**앱까지 켜면 §1-2 의 평서문 둘이 거짓이 된다** — "앱은 GA4·Mixpanel 등
   사용 분석 도구로 데이터를 보내지 않습니다" / "데스크톱 앱에는 적용되지
   않습니다". 이건 문면 교체가 아니라 **수집 항목·처리자·전송국가가 통째로 새로
   생기는 변경**이다.
4. ★그러므로 **버전 판단이 달라진다.** `#1316` §3-3 이 참조한 선례(사람 축 개방)는
   "버전은 안 올리되 배너는 반드시" 였다. 그 선례는 **우리 안에서 일어나는 결합**
   이었다. (나)는 **제3자·국외로 나가는 새 흐름**이라 같은 선례로 못 덮는다 —
   `CURRENT_POLICY_VERSION` 상향(전면 재동의) 검토 대상이다.
   ★**확인 필요(변호사).**

★그리고 GA4 ToS §7 의 고지 요구는 **법률 검토를 기다릴 필요가 없다** — 계약이
직접 요구한다(`#1316` §3-1 그대로).

### 8-3. ★(나)와 무관하게 이미 미충족인 것 — 되짚어 적는다

`#1316` §1-2 가 진단한 그대로다. `marblo-web` 웹 방침 §11(쿠키)은 **GA4 도,
Google 도, 분석 쿠키도 한 글자가 없다.** GA4 ToS §7 이 이름을 지목해 요구하는
`www.google.com/policies/privacy/partners/` 링크도 없다.

★이 티켓이 만든 문제가 아니고, (나)를 안 해도 남아 있다. `#1316` §6 의 미결
결정 5번이다. 여기서 다시 적는 이유는, **(나)를 검토하면서 "GA4 고지" 를 새 일로
착각하지 않게** 하기 위해서다 — 이미 밀린 일이다.

---

## 9. 미동의자 태깅 금지 — 어디서 보장되나

| 경로            | 보장 지점                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 텔레메트리 각인 | 미동의면 이벤트 자체가 안 온다 → 각인 대상이 없다. 게이트 둘 + 솔트 + uid, 넷 중 하나만 없어도 각인 안 함(`planEventUserKeyStamp`)        |
| 앱 GA4          | ★지금은 **호출자가 없어** 애초에 스크립트가 안 붙는다(§1-1). `maybeInitGA4(consented)` 도 동의 후에만 붙인다                              |
| 웹 GA4          | 웹사이트 자체 쿠키 동의                                                                                                                   |
| ★(나) 채택 시   | ★**우리가 값을 set 하는 순간 하나뿐이다.** GA4 의 동의 신호로는 못 막는다 — User-ID 는 "**동의 상태와 무관하게**" BQ 로 export 된다(§2-3) |

---

## 10. 이 티켓에서 하지 않은 것 (의도적)

- ★**GA4 로 아무것도 보내지 않았다.** `user_id` 도 `user_properties` 도 코드에
  넣지 않았다.
- ★**솔트를 SQL·GA4·클라이언트 어디로도 내보내지 않았다.**
- ★**코드를 한 줄도 고치지 않았다.** 게이트를 열지도 않았다 — §7 은 판정과
  전제조건이고, 실행(ALTER·env·배포)은 사장님 승인 후다.
- 방침 본문(`privacyContent.tsx`, `legal/privacy/page.tsx`)을 손대지 않았다.
- `normalizeEmail` 을 UID2 규약으로 바꾸지 않았다(§6-2 판정에 따라).

---

## 11. 사장님 결정이 필요한 것

1. ★**(가) 유지 + 게이트 개방**으로 갈지 (백엔드 권고: **예**). (나)는 보류.
2. ★**`EVENTS_PERSON_STAMP_FROM` 게이트를 지금 열지.** 열면 §7-2 의 4단계를
   그 순서로 실행한다. ★삭제요청 SQL 짝(§7-6)이 운영 절차에 들어가는 것에 동의.
3. (나)를 그래도 원하시면 → §5-3 의 **7개 조건 전부**를 전제로만. 특히
   **웹 로그인 세션만 · `user_property` 가 아니라 `user_id` · uid 파생 유지**.
4. ★**(나) 로 가실 경우 방침 개정 범위** — 배너로 갈지 전면 재동의로 갈지.
   백엔드 판단으로는 §8-2 의 4번 때문에 **선례를 그대로 못 쓴다**. 법률 검토 권고.
5. ★`#1316` §6 의 미결 5번(웹 방침 §11 GA4 미언급)을 언제 고칠지. 이미 밀린 일이다.
6. §8-1 · §8-2 의 **확인 필요** 항목들에 법률 검토를 받으실지.

---

## 12. ★확인 못 한 것 (추측으로 덮지 않는다)

- **"UID2 가 GA4 로 전송된 사례가 없다"** — 부정 증명이라 문서로 못 세운다.
  확인된 것은 "UID2 공식 문서에 Google 제품 연동 경로가 없다" 까지다(§3-2).
- **우리 `us_` 가명을 Google 이 "pseudonymous end user identifier" 로 실제로
  판단할지** — Google 문서가 변호사에게 물으라고 적고 있다(§2-2).
- **Analytics SDK / User-ID Feature Policy 원문** — User-ID 문서가 링크하는
  `developers.google.com/analytics/devguides/collection/app-web/policy` 가 GA4
  개요 페이지로 리다이렉트된다(2026-08-29 확인). ★(나)로 갈 경우 이 정책 원문을
  다시 찾아 읽어야 한다.
- **PIPA 제28조의2 · 제30조 적용 여부** — `#1316` §3-2 그대로 미해결.
