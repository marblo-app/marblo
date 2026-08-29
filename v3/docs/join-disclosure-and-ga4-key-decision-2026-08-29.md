# 결합 고지 문면 + GA4 조인 키 방식 — 조사·설계 (2026-08-29)

티켓 `UXG62ooEMza9kLfnGage`. 사장님 지시(텔레그램) 세 가지에 대한 조사 결과와
권고다. **이 문서는 결정이 아니라 결정 재료다.** 방침 문면 반영은 사장님 승인
후이고, 결합 배선은 별건(`VZ0K2FIeASLrWy9bwvN1`)이다.

> ★**법률 판단 유보 표기 규칙.** 이 문서에서 "확인 필요" 라고 적은 것은 조사가
> 게을렀다는 뜻이 아니라 **변호사가 답해야 하는 질문**이라는 뜻이다. 지어낸 법
> 해석이 이 문서에서 가장 위험하다. 계약 문면(GA4 약관)처럼 **읽으면 확정되는
> 것**과, 법 적용(PIPA 해석)처럼 **읽어도 확정되지 않는 것**을 구분해 적었다.

---

## 0. 한 줄 요약

| 지시                                      | 결론                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. "조인 키는 없습니다" 문구를 지운다     | ★**전제가 틀렸다.** 그 문장은 사장님이 짐작한 곳(웹 방침)엔 없고 **앱 방침에는 있다.** 어드민 화면의 인용은 고쳤다(출처 명시). 방침 본문은 손대지 않았다 — 승인 사항 |
| 2. `sha256(가입일자+이메일)` 로 양쪽 결합 | ★**쓰지 마시길 권고.** GA4 약관이 "hashed or otherwise" 로 명시 금지. 그리고 **더 나은 방법이 이미 코드에 있다** — GA4 로 아무것도 안 보내고도 결합된다              |
| 3. 옵트인으로 가되 "굳이 멘션 안 하고"    | ★**고지 생략은 불가.** PIPA 해석을 기다릴 것도 없이 **GA4 이용약관 §7 이 직접 요구**한다. 동의 여부는 별개 문제이고 그쪽은 법률 검토 필요                            |

---

## 1. 지시 1 — 문구는 어디에 있나 (전수 확인)

우리에겐 **처리방침이 둘**이다. 이것이 혼선의 원인이다.

| 문서                                  | 경로                                                          | 그 문장     | 언어                                       |
| ------------------------------------- | ------------------------------------------------------------- | ----------- | ------------------------------------------ |
| **웹** 개인정보처리방침               | `marblo-web/src/app/[locale]/legal/privacy/page.tsx` (§1~§14) | ❌ **없다** | 본문 **한국어 하드코딩** (제목만 ko/en/ja) |
| **데스크톱 앱** 인앱 개인정보처리방침 | `v3/src/components/legal/privacyContent.tsx`                  | ✅ **있다** | **ko / en 만. ja 없음**                    |

앱 방침 ko 원문:

> "위 비식별 지표와는 별도 테이블이고, **두 기록이 공유하는 조인 키는 없습니다**
> — 즉 두 기록을 서로 이어 붙일 수 있는 공통 항목이 없습니다."

en 원문:

> "It lives in a separate table from the de-identified metrics above, and
> **the two share no join key** — that is, the two records have no field in
> common that anyone could match them up on."

### 1-1. 웹 방침에 "같은 취지" 문장이 있는가 — 있다, 그러나 문면이 다르다

§10(안전성 확보조치)·§11(쿠키) 근처를 포함해 §1~§14 를 전수 확인했다. 조인 키를
말하는 문장은 없다. **가장 가까운 것은 §2(처리 목적)** 다:

> "서비스 개선을 위한 통계 분석 (**식별 가능 형태로 저장하지 않습니다**)"

★이 문장도 결합을 켜면 검토 대상이다. "식별 가능 형태로 저장하지 않는다" 와
"가명 식별자로 두 축을 결합한다" 가 양립하는지는 **가명정보를 개인정보로 볼
것인가**에 달려 있고, 그건 아래 §3 의 법률 질문과 같은 질문이다.

### 1-2. ★웹 방침 §11 은 GA4 를 언급하지 않는다 — 이미 살아있는 리스크

§11(쿠키)은 "로그인 상태 유지, 다국어 설정 보존" 만 적는다. **GA4 도, 분석
쿠키도, Google 도 한 글자가 없다.** 그런데 앱 방침 요약은 "마블로 웹사이트는 앱과
별개로 GA4를 사용하며, 웹사이트 자체 쿠키 동의의 적용을 받습니다" 라고 적고 있다.
아래 §3-1 의 GA4 약관 §7 이 요구하는 고지(“You must disclose the use of Google
Analytics”)와 대조하면 **결합을 켜기 전부터 미충족 소지가 있다.** ★확인 필요 —
다만 이건 이 티켓이 만든 문제가 아니라 이미 있던 문제다.

### 1-3. 그래서 어드민 화면은 "지우는" 게 아니라 "정정"했다

`marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` 의 `BetaAccessExpiryWarning`
은 _"처리방침이 「…조인 키는 없습니다」라고 이미 고지했습니다"_ 라고만 적었다.
문장은 실재하므로 **거짓 인용은 아니다.** 틀린 것은 두 가지다:

1. **어느 방침인지 안 밝혔다.** 방침이 둘이고 내용이 다르므로 그 말로는 확인이
   불가능하다. → 출처를 앱 방침으로 명시했다.
2. **인용 범위를 넓혀 읽었다.** 앱 방침의 그 문장이 짝지은 상대는 **사용량·비용
   기록**이지, 이 화면이 말하는 Firestore `subscriptions`(접근권)가 아니다. 축
   경계(익명축 ↔ 계정축)라는 취지는 같지만 그 문장이 `subscriptions` 를 이름으로
   지목한 적은 없다. → 화면에 "그 문장을 접근권 축의 근거로 넓혀 읽지 말라"고
   적었다.

★**지우면 안 되는 이유가 따로 있다.** 이 문장은 코드 6곳이 축 경계 규칙의
**근거로 인용**한다 — `analyticsPseudonym.ts`, `analyticsUserKey.ts`,
`analyticsProfiles.ts`, `backfill-analytics-identity.ts`, `functions/src/index.ts`,
그리고 `BetaScorecard.test.tsx` 는 이 문구를 **테스트로 강제**한다. 문장을 지우면
규칙의 근거가 통째로 사라지고 테스트가 깨진다. 문면을 바꾸려면 그 6곳을 같은
커밋에서 함께 옮겨야 한다.

---

## 2. 지시 2 — 키 방식

### 2-1. 사장님 제안 `sha256(가입일자 + 이메일)` 의 문제

**(가) 솔트가 없다.** 이메일과 가입일자를 아는 사람은 누구나 키를 재생성한다.
**(나) 가입일자는 엔트로피가 사실상 0 이다.** 하루 단위이므로 이메일 하나당 후보가
1년치라도 365개다. 공격자는 이메일 목록만 있으면 전수 재생성한다 — 즉 이것은
**이메일 단독 SHA-256 과 실질적으로 같다.**

우리 `v3/functions/src/analyticsPseudonym.ts` 가 **HMAC + 비밀 솔트**
(`ANALYTICS_ID_SALT`, 함수 런타임 env 전용)를 쓰는 이유가 정확히 이것이다.

### 2-2. GA4 약관 — "해시하면 된다"는 명문으로 부정된다

Google Analytics Terms of Service §7 Privacy
(https://marketingplatform.google.com/about/analytics/terms/us/):

> "You will not and will not assist or permit any third party to pass
> information, **hashed or otherwise**, to Google that Google could use or
> recognize as personally identifiable information, **except where permitted by,
> and subject to, the policies or terms of Google Analytics features** made
> available to You, and only if, any information passed to Google for such Google
> Analytics feature is hashed using industry standards."

→ 해시는 면제 사유가 아니다. 예외는 "그것을 허용하는 GA 기능을 통할 때" 뿐이다.

보조 근거 — Best practices to avoid sending PII
(https://support.google.com/analytics/answer/6366371):

> "Google policies mandate that no data be passed to Google that Google could use
> or recognize as personally identifiable information (PII). PII includes... email
> addresses..."
> "consult an attorney if you are in doubt whether certain information might
> constitute PII or not."

★**단정하지 않는 것**: "솔트 없는 SHA-256 해시 이메일이 Google 이 말하는
impermissible PII 에 **법적으로** 해당하는가" — Google 문서 자체가 변호사에게
물으라고 적고 있다. **확인 필요.**
★**단정할 수 있는 것**: 솔트 없는 해시는 이메일 목록만으로 역산된다는 것. 이건
법 해석이 아니라 공학적 사실이다.

### 2-3. 예외 기능은 실재한다 — 다만 우리 용도가 아니다

Measurement Protocol `user_data.sha256_email_address`
(https://developers.google.com/analytics/devguides/collection/ga4/uid-data)는
해시 이메일을 받는 **공식 필드가 맞다.** 그러나:

- `user_id` 동반이 필수이고, 정규화 + SHA-256 hex 규격이 강제된다
- 성격상 **Google Ads 매칭(enhanced conversions)용 목적 한정** 필드다
- 쓰는 순간 Google Ads 쪽 UPD/Customer Match 동의 의무가 딸려온다

즉 "범용 조인 키" 자리가 아니다. 이 문을 여는 것은 **우리가 원하는 것보다 훨씬 큰
문을 여는 것**이다.

### 2-4. User-ID 는 되는가 — 조건부로 된다

[GA4] Measure activity across platforms with User-ID
(https://support.google.com/analytics/answer/9213390):

> "when a user signs in, you could use their **email address to generate a unique
> ID**" — 허용된다.
> 단 "Your user ID **must not contain information that a third party could use to
> determine a user's identity**" 그리고 "**providing appropriate notice of your
> use of identifiers in your Privacy Policy**".

→ **사장님 제안은 이 조건을 못 넘는다**(§2-1 의 역산 가능성). **우리 HMAC+솔트
방식은 넘는다.** 그리고 두 번째 조건이 §3 의 고지 문제로 직결된다.

부수 사실 두 가지(설계에 영향):

- "Before signing in: If a user triggers events before a User-ID is set, Analytics
  will associate those initial events with that User-ID." → **같은 세션 안**에서는
  로그인 전 이벤트가 소급 결합된다. 단 웹 세션과 데스크톱 앱 로그인은 애초에 다른
  세션·다른 플랫폼이라 우리 퍼널(랜딩→다운로드→앱 로그인)엔 거의 도움이 안 된다.
- "When you collect user IDs and you have linked Analytics to BigQuery, that
  information is exported to BigQuery **regardless of the consent status of your
  users.**" → 동의 게이트를 GA4 쪽에 맡길 수 없다는 뜻이다.

### 2-5. 오케 제안 (c) Measurement Protocol — 틀리진 않으나 문제를 풀지 못한다

https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events

MP 웹 스트림은 body 에 **`client_id` 를 요구하고, 그 값은 "should match the ID
generated by the Google Analytics tag on your website"** 다. 즉 MP 는 **우리가 정한
새 키를 GA4 에 심는 통로가 아니라, 이미 존재하는 GA4 client_id 에 서버 이벤트를
덧붙이는 통로**다. 솔트가 클라이언트에 안 나가는 건 맞지만 **조인 축은 여전히
client_id** 이고, 그 축은 아래 §2-6 처럼 이미 우리 것이다.

부수 제약(설계 시 필요): 요청당 이벤트 25개 · 파라미터 25개 · 파라미터 값 100자 ·
body 130kB · 백데이트 72시간 · 시간당 비전환 요청 1억건.

### 2-6. ★권고 — (a)~(d) 어느 것도 필요 없다. 조인은 이미 서버 안에 있다

전수 확인 결과, **GA4 로 아무것도 내보내지 않고도** 채널 축과 계정 축이 이어진다.
배선이 이미 있다:

```
_ga 쿠키(GA4 client_id)
  └ marblo-web/src/lib/attribution.ts:86  readGaClientId()
      └ LinkClient.tsx:55  →  콜러블 linkInstallAttribution
          └ install_attribution.gaClientId          (원본, 서버 보관)
              └ 서버: pseudonymizeAnalyticsId("ga", …, ANALYTICS_ID_SALT)
                  └ analytics_identity.ga_key       (가명, BigQuery)
                      └ 링크표 marblo_identity.analytics_user_install
                        (install_key ↔ user_key)   ★PERSON_AXIS_EFFECTIVE_FROM 게이트
                          └ 계정축 user_key
```

이 방식이 사장님 제안과 오케 제안 (a)~(d) 를 **모든 축에서 이긴다**:

|                             | 솔트가 클라이언트에 나가나 | GA4 로 PII 를 보내나  | 로그인 전 유입을 잡나     | 새 배선 필요  |
| --------------------------- | -------------------------- | --------------------- | ------------------------- | ------------- |
| (a) 클라이언트 계산         | ★**나간다** (= 솔트 없음)  | 보낸다                | 잡는다                    | 있음          |
| (b) 서버 계산 후 하달       | 안 나감                    | 보낸다                | ★**못 잡음**(로그인 후만) | 있음          |
| (c) MP 서버 전송            | 안 나감                    | 보낸다                | 부분적                    | 있음          |
| (d) GA4 User-ID             | 구현에 따름                | 보낸다                | 부분적                    | 있음          |
| ★**(e) 기존 gaClientId 축** | **안 나감**                | ★**아무것도 안 보냄** | ★**잡는다**               | **거의 없음** |

(e)가 로그인 전 유입을 잡는 이유: 조인 축이 계정이 아니라 **브라우저의 GA4
client_id** 라서, 계정이 생기기 전인 랜딩·다운로드 구간에서 이미 값이 존재한다.
오케가 (b)의 결정적 약점으로 본 구간이 (e)에서는 약점이 아니다.

★**그리고 (e)는 GA4 약관 문제를 아예 회피한다.** §2-2 의 금지는 "pass information
**to** Google" 에 걸리는 규정이다. (e)는 Google 로 아무것도 보내지 않고, GA4 가 이미
발급한 값을 **우리 쪽으로 가져와** 우리 솔트로 가명화한다. 방향이 반대다.

### 2-7. ★남은 진짜 갭은 키 설계가 아니다

`install_attribution` 에 가명 컬럼 `gaKeyHmac` 이 없어서, 원본(`gaClientId`)과
가명(`ga_key`)을 조인하면 **문법·타입이 맞으면서 영원히 0행**이다. 실측
(2026-08-24): installs 632 / with_ga_client_id 631 / **joined 0**.

이건 이미 진단돼 있다 — `v3/docs/install-attribution-ga-key-join-2026-08-24.md`
(#1195). ★즉 사장님이 "결합할 방법을 새로 만들어 달라"고 보신 문제는 실은
**이미 설계된 결합이 컬럼 하나 때문에 0행인 문제**다. 새 키 체계를 만드는 것보다
이 컬럼을 채우는 쪽이 싸고, 안전하고, 이미 검토를 통과했다.

★`ANALYTICS_ID_SALT` 는 바꾸지 마라. 바꾸면 과거 가명키가 전부 무효가 된다.

---

## 3. 지시 3 — 동의와 고지 (가장 신중해야 하는 부분)

사장님 말씀에 **두 가지가 섞여 있다.** 분리해서 답해야 한다.

- **"옵트인으로 간다"** = 동의를 받는다 → 동의 문제
- **"굳이 멘션 안 하고"** = 별도 고지를 안 한다 → **고지 문제**

### 3-1. 고지 — ★법률 검토를 기다릴 필요가 없다. 계약이 직접 요구한다

GA4 ToS §7 (위와 같은 문서):

> "You must **post a Privacy Policy** and that Privacy Policy **must provide notice
> of Your use of cookies, identifiers** for mobile devices or similar technology
> used to collect data. **You must disclose the use of Google Analytics**, and how
> it collects and processes data."

그리고 User-ID 문서: "**providing appropriate notice of your use of identifiers in
your Privacy Policy**".

→ ★**"굳이 멘션 안 하고" 는 GA4 를 쓰는 한 선택지가 아니다.** PIPA 해석이 어떻게
나오든 무관하게, **우리가 이미 서명한 계약이 고지를 요구**한다. 이건 "확인 필요"가
아니라 문면을 읽으면 확정되는 사실이다.

### 3-2. 동의 — 여기는 확인 필요다. 단정하지 않는다

오케가 정리한 이해(★**이하 전부 법률 검토 대상. 우리 판단은 근거가 되지 못한다**):

- 「개인정보 보호법」 제28조의2: 가명정보는 통계작성·과학적연구 등 목적으로
  **동의 없이** 처리 가능 — 이라는 취지로 알려져 있다. ★조문 적용 여부 **확인 필요**
- 같은 법 제30조: 처리방침 기재 의무 — **동의 면제가 곧 기재 면제는 아니다**는 것이
  오케 이해다. ★**확인 필요**
- 우리는 **원본 이메일을 보유**한다 → 결합하면 재식별 가능 → 가명정보 요건인
  **추가정보 분리보관** 이 걸린다. ★적용 범위 **확인 필요**

★우리가 사실로 말할 수 있는 것은 코드 쪽뿐이다: 솔트(`ANALYTICS_ID_SALT`)는 함수
런타임 env 에만 있고 BigQuery 에는 없다. `analyticsPseudonym.ts` 주석이 이미
**"가명화는 익명화가 아니다 — `user_key` 는 HMAC 가명이지 익명값이 아니고 PIPA 상
여전히 개인정보다"** 라고 못박고 있다. 즉 **"HMAC 을 씌웠으니 동의가 면제된다"는
논리는 우리 코드베이스가 이미 스스로 부정하고 있다.**

### 3-3. ★그래서 권고는 "지우기"가 아니라 "바꾸기"다

"두 기록이 공유하는 조인 키는 없습니다" 는 **자기구속적 약속**이다. 결합을 켜는
순간 이 문장은 거짓이 된다. 선택지는 셋이고, 셋 다 사장님 결정 사항이다.

|                                      | 내용                                                                                              | 장점                                                                                           | 리스크                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A. 문장 삭제**                     | 그 문장만 뺀다                                                                                    | 가장 쉬움                                                                                      | ★**최악.** 약속을 조용히 거두는 모양. 코드 6곳의 근거가 사라지고 테스트가 깨짐. 결합 사실은 여전히 미고지 |
| **B. 문장 교체** (★오케·백엔드 권고) | "조인 키가 없습니다" → "가명처리된 식별자로 결합합니다 + 그 키를 되돌리는 정보는 분리 보관합니다" | 사실과 일치. 법정 기재사항·GA4 약관 고지 요구를 동시에 충족. 코드 근거를 새 문장으로 옮기면 됨 | 사용자가 "결합한다"는 사실을 처음 알게 됨 → 1회성 인앱 고지 배너 필요 여부 판단                           |
| **C. 결합을 안 켠다**                | 문장을 그대로 둔다                                                                                | 아무것도 안 바뀜                                                                               | 사장님이 원하신 매체·캠페인 단위 분석을 포기                                                              |

★**B 를 택하실 경우 반드시 함께 결정해야 하는 것**: `CURRENT_POLICY_VERSION` 을
올려 전 사용자 재동의 모달을 띄울지, 아니면 `PRIVACY_CLARIFICATION_VERSION` 만
올려 1회성 배너로 갈지. 이 파일(`privacyContent.tsx`) 머리말에 **선례 넷**이
기록돼 있고, 그중 가장 가까운 선례(사람 축 개방, `CjNfGmXvynZ5bk5vLuCZ`)는
**"약속을 거두는 변경"이라 판정을 사장님까지 올렸고, 결론은 "버전은 안 올리되
배너는 반드시 띄운다"** 였다. 이번 건은 그 선례와 **같은 종류**로 보인다.

---

## 4. 방침 문면 초안 (ko / en / ja) — ★반영은 승인 후

★**아직 어느 파일에도 넣지 않았다.** marblo-web 은 Vercel 자동배포라 머지 즉시
사용자에게 나간다. 승인 전 머지 금지.

### 4-0. ★선결 문제 — 지금은 ko/en/ja 가 같은 약속을 할 수 없다

| 문서             | ko   | en                           | ja                           |
| ---------------- | ---- | ---------------------------- | ---------------------------- |
| 웹 처리방침 본문 | 있음 | ❌ **없음**(한국어 하드코딩) | ❌ **없음**(한국어 하드코딩) |
| 앱 인앱 처리방침 | 있음 | 있음                         | ❌ **없음**                  |

`messages/{ko,en,ja}.json` 에 `legal` 키 자체가 없고 번역된 것은 **제목뿐**이다
(`footer.privacy`). 즉 en/ja 이용자는 영어/일본어 제목 밑에서 **한국어 본문**을
본다. 아래 초안을 3개 언어로 넣으려면 **웹 방침 본문의 다국어화가 선행**되어야
하고, 그건 이 티켓보다 큰 작업이다. ★사장님 판단 필요 — 별건으로 뺄지, 이번에
같이 할지.

### 4-1. 앱 방침(`privacyContent.tsx`) 교체 초안 — 선택지 B 기준

**ko** — 기존 문장을 대체:

> 위 비식별 지표와는 별도 테이블입니다. 광고·유입 경로의 효과를 측정하기 위해,
> 이 두 기록을 **가명처리된 식별자로 결합**하는 경우가 있습니다. 결합에 쓰이는
> 식별자는 원본 값이 아니라 비밀 키로 만든 가명이며, **그 가명을 원래 값으로
> 되돌리는 데 필요한 정보는 결합된 데이터가 저장되는 곳에 두지 않습니다**(분리
> 보관). 결합은 통계 분석 목적으로만 쓰이고, 특정 개인을 식별하거나 특정 계정의
> 행동을 되짚는 데는 쓰지 않습니다. 코드·프롬프트·응답 원문은 여기에도 포함되지
> 않습니다.

**en**:

> It lives in a separate table from the de-identified metrics above. To measure how
> people find us and whether our advertising works, we may **join these two records
> using pseudonymised identifiers**. The identifiers used for that join are not raw
> values but pseudonyms derived with a secret key, and **the information needed to
> reverse those pseudonyms is not stored where the joined data lives** (it is kept
> separately). The join is used only for statistical analysis — never to identify a
> particular person or to trace a particular account's activity. Code and raw
> prompts/responses are not included here either.

**ja**:

> 上記の非識別指標とは別のテーブルに保存されます。広告や流入経路の効果を測定する
> ため、これら 2 つの記録を**仮名化された識別子で結合する**ことがあります。結合に
> 用いる識別子は元の値ではなく秘密鍵から生成した仮名であり、**その仮名を元の値に
> 戻すために必要な情報は、結合されたデータが保存される場所には置きません**（分離
> 保管）。結合は統計分析の目的にのみ用い、特定の個人を識別したり、特定のアカウント
> の行動をさかのぼったりする目的では使用しません。コードおよびプロンプト・応答の
> 原文は、ここにも含まれません。

★세 언어가 하는 약속이 동일한지 확인용 체크리스트 — (1) 결합한다는 사실, (2)
가명 식별자를 쓴다는 사실, (3) **되돌리는 정보를 분리 보관**한다는 사실, (4) 목적이
통계 분석으로 한정된다는 사실, (5) 코드·원문 미포함. 위 세 초안은 다섯 항목을 모두
같은 순서로 담고 있다.

### 4-2. 웹 방침 §11(쿠키) 보강 초안 — GA4 약관 §7 대응

**ko** — §11 에 추가:

> 회사는 웹사이트 이용 통계 분석을 위해 Google LLC 의 Google Analytics 4 를
> 사용합니다. 이 과정에서 분석용 쿠키를 통해 브라우저 단위의 익명 식별자
> (client_id), 방문 경로, 이용 기록이 수집됩니다. 정보주체는 브라우저 설정 또는
> Google 애널리틱스 차단 브라우저 부가기능(https://tools.google.com/dlpage/gaoptout)
> 을 통해 수집을 거부할 수 있습니다. Google 이 사이트·앱 데이터를 처리하는 방식은
> "Google 이 파트너 사이트·앱에서 얻은 정보를 사용하는 방법"
> (https://www.google.com/policies/privacy/partners/) 에서 확인하실 수 있습니다.

**en** / **ja** 초안은 같은 5개 사실(GA4 사용 · 수집 항목 · 쿠키 · 거부 방법 ·
Google 파트너 정책 링크)을 담아 4-1 과 같은 방식으로 작성한다. ★단 §4-0 의 선결
문제(웹 방침 본문 다국어화) 때문에 지금 넣을 자리가 없다.

★위 링크(`policies/privacy/partners/`)는 GA4 ToS §7 이 **이름을 지목해 요구**하는
링크다. 넣을지 말지는 선택 사항이 아니다.

---

## 5. 이 티켓에서 하지 않은 것 (의도적)

- ★결합을 켜지 않았다. GA4 로 아무것도 보내지 않았다.
- ★솔트를 SQL·GA4·클라이언트 어디로도 내보내지 않았다.
- ★방침 본문(`privacyContent.tsx`, `legal/privacy/page.tsx`)을 **한 글자도 수정하지
  않았다.** 위 초안은 이 문서 안에만 있다.
- `install_attribution.gaKeyHmac` 컬럼 추가 — 별건(#1195 / `VZ0K2FIeASLrWy9bwvN1`).

## 6. 사장님 결정이 필요한 것

1. **§3-3 의 A / B / C** 중 무엇으로 갈지 (오케·백엔드 권고: **B**)
2. B 라면 **재동의 모달 vs 1회성 배너** (선례는 배너)
3. **§2-6 (e) 방식**으로 확정해도 되는지 (권고: 예 — `sha256(가입일자+이메일)` 폐기)
4. **§4-0 웹 방침 본문 다국어화**를 이번에 할지, 별건으로 뺄지
5. **§1-2 웹 방침 §11 의 GA4 미언급**을 언제 고칠지 (결합과 무관하게 이미 리스크)
6. **§3-2 의 PIPA 질문들**에 대해 법률 검토를 받으실지
