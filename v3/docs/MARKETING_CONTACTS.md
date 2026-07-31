# marketing_contacts SoT — 운영 가이드

이메일/푸시 마케팅의 데이터 기반. **Firestore = 운영 SoT**(수신동의·unsubscribe·실시간),
**BigQuery = 분석 미러**(세그먼트·캠페인 집계). cf 감사 티켓 `qFEzBLhBCpGIBnJJg9Xg`,
구현 티켓 `kKgzB91jskKwAgxT5Ukp`.

## 스키마

### Firestore `marketing_contacts/{contactId}`

- `contactId = sha256(normalize(email))` — 이메일당 문서 1개(멱등 백필·dedupe 가 docId 로 보장)
- 평문 이메일은 **저장하지 않는다**. `emailEnc`(AES-256-GCM) + `normalizedEmailHash` + `emailDomain`(집계용)만.

| 필드                    | 설명                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `uid`                   | Firebase Auth uid (nullable — waitlist 만 있는 리드는 null)                                         |
| `emailEnc`              | `v1:<iv>:<tag>:<ct>` AES-256-GCM. 키 미설정 환경에선 null(키 설정 후 백필 재실행으로 채움)          |
| `source`                | 최초 유입: `auth_signup` \| `waitlist` \| `founder` \| `subscription` \| `manual`                   |
| `signupAt`              | Auth `metadata.creationTime` (더 이른 값 유지)                                                      |
| `founderStatus`         | `founders/{email}.status` 미러 (`selected`/`rejected`/`pending`…)                                   |
| `subscription`          | `{plan(planType), status, provider(paymentProvider), periodEnd}` 미러                               |
| `emailMarketingConsent` | `{status: granted\|pending\|revoked\|unknown, source, version, consentedAt, revokedAt, legalBasis}` |
| `unsubscribe`           | `{status: subscribed\|unsubscribed, tokenHash, unsubscribedAt}`                                     |
| `segments[]`            | `waitlist`/`auth_user`/`founder`/`founder_rejected`/`paid`/`beta_active` (파생)                     |
| `lifecycleStage`        | `lead → signup → founder → subscriber` (파생)                                                       |

- 하위컬렉션 `consent_events/*`: 동의/철회/수신거부 감사로그(append-only).
- `push_tokens/{docId}`: **스키마만 예약**(uid·deviceId·platform·tokenHash·pushMarketingConsent).
  푸시 동의는 이메일 동의와 완전히 분리된 축. 적재는 후속 티켓.
- Firestore 룰: `marketing_contacts`·`consent_events`·`push_tokens` 전부 클라이언트 차단(Admin SDK 전용).

### 동의 규약 — GDPR/PIPA/CAN-SPAM

**status 의미** (발송 가능 = `granted` 하나뿐):

- `granted`: 유효한 마케팅 수신동의 (`legalBasis=explicit_opt_in`)
- `pending`: **재동의 캠페인 대상 풀 — 발송 불가**. waitlist 폼의 "활동/인용 동의"
  (`agreed`) 체크박스는 개인정보(이메일) 수집·이용/마케팅 수신동의가 아니다
  (`marblo-web/docs/COMPLIANCE-AUDIT.md` **D2**, PIPA Med — 처리방침 링크·수집목적 미명시).
  `agreed` 만 있고 별도 마케팅 체크박스가 unchecked 인 신청은 granted 로 승격하지 않고
  pending 으로만 적재한다(사장님 결정 2026-07-18). ★2026-07-31(zaLMLwYf) 부터 폼에
  별도 `marketingConsent` 체크박스(기본 unchecked)가 추가돼, 이걸 체크한 신청자는
  `pending` 이 아니라 바로 `granted` 로 적재된다 — 아래 "waitlist 폼 마케팅 동의" 참고.
- `unknown`: 동의 증거 없음(Auth-만 가입자) → 발송 불가
- `revoked`: 철회/수신거부 → 발송 불가. 훅은 revoked 를 절대 되살리지 않는다.

**legalBasis**: `explicit_opt_in`(granted 의 유일한 정상 근거) | `none`. 근거를 날조하지 말 것 — waitlist agreed 는 근거가 아니다.

**전이 경로**: `unknown → pending`(markPending, 재동의 풀 편입) / `unknown|pending → granted`(grantConsent, 가입 폼 마케팅 체크박스·정식 재동의 캠페인) / `granted|pending → revoked`(설정에서 동의 해제) / `* → revoked`(unsubscribe). 모든 전이는 `consent_events` 에 기록된다(`pending_init`/`granted`/`revoked`/`unsubscribed`).

판정은 전부 순수 함수 `marketingContacts.mergeEmailConsent` 하나로 수렴한다(훅·백필 공통). 불변식: ①**철회가 동의를 이긴다** ②`revoked` 는 훅으로 되살아나지 않는다 ③이미 `granted` 면 재적용해도 이벤트를 남기지 않는다(멱등).

- 마케팅 동의는 프라이버시/텔레메트리 동의와 **별개 필드**로만 관리한다.

### 가입 시 동의 → 발송 게이트 배선 (훅 1b)

**마케팅 수신동의의 유일한 소스는 `users/{uid}.webPrivacyConsent.marketing` 이다.**
가입 폼(`marblo-web` signup)과 설정 화면(`my/privacy`)이 둘 다 이 필드에 저장하고,
`syncMarketingConsentOnUserWrite` (Firestore `users/{uid}` onWrite) 가 컨택트로 잇는다.

- 데스크탑 앱의 `users/{uid}.privacyConsent` 는 텔레메트리 동의 스키마로 **`marketing` 필드가 없다** — 읽지 않는다.
- 이메일은 users 문서가 아니라 **Auth 를 SoT** 로 삼는다(`admin.auth().getUser(uid)`). 클라이언트가 쓴 값을 신뢰하지 않고, 에이전트 custom-token 계정은 `isRealSignupUser` 가 걸러낸다.
- **★순서 무관**: auth `onCreate` 훅과 폼의 `saveConsent` 는 실행 순서가 보장되지 않는다. 어느 쪽이 먼저여도 `granted` 로 수렴한다.
  - onCreate 먼저 → 컨택트가 `unknown` 으로 생성 → 이 훅이 승격
  - saveConsent 먼저 → 이 훅이 컨택트를 `granted` 로 생성 → 뒤늦은 onCreate 는 `grantConsent` 없이 upsert 하므로 `mergeEmailConsent` 가 granted 를 보존
- **미체크는 건드리지 않는다** — 승격도 철회도 없다(`never_opted_in`). `true→false` 전이만 철회다.
- 무관한 users 문서 write 는 `unchanged`/`no_consent_record` 로 조기 반환 — Firestore 읽기도 Auth 호출도 하지 않는다.

### waitlist 폼 마케팅 동의 (훅 2, `zaLMLwYf1kQfeQJqdAkz`)

`betatester50_waitlist/{docId}` 는 인증 전(uid 없음) 이메일 캡처라 훅 1b 경로(users
문서)를 못 탄다 — 그래서 별도 축으로 배선한다.

- 폼(`marblo-web/src/components/BetaTester50SignupForm.tsx`)에 `agreed`(활동/인용
  동의, 필수)와 별개로 `marketingConsent`(마케팅 수신동의, **★기본 unchecked**,
  선택 — 미체크해도 신청 자체는 진행)를 신설. 체크 시에만
  `marketingConsent: true` + `marketingConsentVersion` + `marketingConsentAt` 을
  문서에 함께 기록한다.
- 판정은 순수 함수 `marketingContacts.decideWaitlistConsentGrant(doc)` 하나로 수렴
  (`grant` | `pending` | `none`) — `syncMarketingContactOnWaitlistCreate` 훅은 이
  결과를 그대로 `upsertMarketingContact` 의 `grantConsent`/`markPending` 에 옮긴다.
  - `marketingConsent === true` → `grantConsent`(`legalBasis=explicit_opt_in`,
    `source=waitlist_form_marketing_optin`) — **grant 근거는 이것 하나뿐**.
  - `marketingConsent` 없이 `agreed === true` → 기존과 동일하게 `markPending`.
  - 둘 다 없으면 아무것도 하지 않음.
- `agreed` 는 여전히 grant 근거로 쓰지 않는다(D2 판정 유지) — 두 체크박스는 완전히
  분리된 동의다.

## 발송 게이트

- 단일 판정: `marketingContacts.isEmailable` — `granted && !unsubscribed` 만 발송 가능.
- 배선 완료: `sendFounderFollowupEmails`, `previewFounderSurveyOffer`(confirmSend 경로) — 게이트 미통과는 `skippedNoConsent` 로 집계.
- transactional(파운더 접근 안내, 신청 접수 확인, 결제 안내)은 게이트 비대상.
- 마케팅 메일에는 `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`(RFC 8058) 헤더와 푸터 수신거부 링크가 자동 부착된다. 발신은 `team@marblo.app` 단일(기존 `postResendEmail` 경로).

## unsubscribe

- `unsubscribeMarketingEmail` (HTTPS, us-central1): GET=확인 페이지, POST=처리(one-click 포함).
- 토큰 = `HMAC-SHA256(MARKETING_UNSUB_SECRET, "unsub:"+contactId)` — 평문 토큰 비저장, stateless 검증.
- 처리 시: consent `revoked` + `unsubscribe.unsubscribed` + `consent_events` 기록. 멱등, 미존재 컨택트도 200(열거 방지).

## BigQuery 미러 (`marblo_marketing`)

- `contacts_daily`: 일1회(04:45 KST, `scheduledMirrorMarketingContacts`) 전체 스냅샷 append, `snapshot_date` DAY 파티션. 같은 날 재실행은 파티션 선삭제로 멱등.
- `contacts_latest` 뷰: 최신 스냅샷만 — 분석/세그먼트 쿼리 진입점.
- **BQ 에는 평문 이메일도 `emailEnc` 도 없다** — 해시·도메인·상태·세그먼트만(`contactToBqRow` 가 구조적으로 배제, 단위테스트로 고정).
- 수동 트리거: `mirrorMarketingContactsToBq` (어드민 onCall).

## 백필 런북

1. env 확인(값 출력 금지): `MARKETING_EMAIL_ENC_KEY`(base64 32B), `MARKETING_UNSUB_SECRET` 설정.
2. `backfillMarketingContacts({})` — dryRun 기본. `authRealUsers`(~34 예상), `waitlistRows`(~41), `founderRows`(~37), `authSkippedNonReal`(~4,920 custom-token 에이전트) 확인.
   ★ `authScanned ≈ authRealUsers` 로 나오면 provider 필터가 깨진 것 — 중단.
3. `backfillMarketingContacts({dryRun:false})` — 실적재. `MARKETING_EMAIL_ENC_KEY` 없으면 failed-precondition 으로 거부됨.
   ★ 백필 직후 기대치: `consentGranted=0`, `consentPending≈41`(waitlist), 나머지 unknown.
   **emailable 모수 0 이 정상이다** — granted 는 재동의 캠페인(explicit_opt_in) 후에만 생긴다. 수치를 부풀리지 말고 실측 그대로 보고할 것.
4. `mirrorMarketingContactsToBq({})` — 첫 BQ 스냅샷.
5. 이후는 훅 5개(`syncMarketingContactOn{AuthCreate,WaitlistCreate,FounderWrite,SubscriptionWrite}` + `syncMarketingConsentOnUserWrite`)가 실시간 유지.
   ★기존 사용자의 동의 백필은 별도 티켓(N8sAY4Tj). 훅 1b 는 **신규 write 만** 처리한다 — 이미 동의했지만 컨택트가 unknown 인 기존 사용자는 users 문서를 다시 쓰기 전까지 승격되지 않는다.

## 앱(v3) 마케팅 opt-in 2곳 (`SnJ4WbpSbypzAyMT62tc`)

데스크탑 앱에도 동의 수집 창구를 냈다. **둘 다 새 훅 없이** 기존
`users/{uid}.webPrivacyConsent.marketing` → 훅 1b 경로를 그대로 탄다.

1. **온보딩 체크박스** — `PrivacyConsentModal`(첫 실행 플로우 ② 단계, 정책 버전
   상승 시 재노출) 맨 아래 "마케팅 정보 수신 동의 (선택)". ★기본 unchecked.
   - 체크 후 "허용" → `saveMarketingOptIn` 이 `webPrivacyConsent`
     (`marketing:true`, `version`, `locale`, `acceptedAt`) 를 merge write.
   - 미체크(또는 "나중에") → **아무것도 쓰지 않는다**. `marketing:false` 를 쓰는
     경로 자체가 앱에 없다 — 훅은 그것을 `never_opted_in` 으로 접는다.
   - 로그인 전 단계라 uid 가 없으므로 답은 `marblo:pendingMarketingConsent` 로
     park 되고 `PrivacyConsentGate` 가 uid 등장 시 flush(프라이버시 동의 파킹과
     **별도 키**: flush 대상 문서 필드가 다르다). write 성공 시에만 park 을 지운다.
   - 위 텔레메트리 동의(`privacyConsent`)와는 완전히 분리된 축 — 서로를 근거로
     쓰지 않는다.
2. **기존 파운더 재동의 배너** — `MarketingReconsentBanner`(Layout·WorkspaceShell
   상단 1줄, 모달 아님). 아래 "안 A" 를 그대로 구현한 것.
   - 노출 게이트: `emailMarketingConsent.status==="unknown"` **이고** 파운더이며
     수신거부가 아닐 때만. `granted`/`pending`/`revoked`/컨택트 없음은 미노출 —
     특히 수신거부자에게 다시 조르지 않는다(unsub 왕복 유지).
   - `marketing_contacts` 는 클라이언트 차단이라 상태는 onCall
     `getMyMarketingConsentStatus` 로만 읽는다. 응답은 `{status, unsubscribed,
isFounder, shouldPromptReconsent}` 뿐 — **이메일은 평문·암호문·해시 모두 없다**.
     조회 실패는 "미동의" 가 아니라 "모름" 이라 배너를 띄우지 않는다.
   - 체크박스 ★기본 unchecked, 체크해야 "동의 저장" 버튼이 활성. "다시 안 보기"
     는 uid 별 localStorage 억제일 뿐 동의/거부 기록이 아니다.
   - 판정은 순수 함수로 이중 고정: 서버 `marketingConsentStatusView` +
     `shouldPromptReconsent`, 렌더러 `shouldShowReconsentBanner`.
   - ★배너는 **수동 노출 UI 일 뿐**이다. 재동의 캠페인 메일을 쏘는 관리자 액션은
     범위 밖(별도 승인).

## 기존 파운더 재동의 — 설계

`zaLMLwYf1kQfeQJqdAkz` 범위: **신규** opt-in 수집 경로만 구현했고, 기존
파운더(당시 미동의 ~30명, `emailMarketingConsent.status=unknown`) 재동의는
아래 두 설계 중 **안 A 가 `SnJ4WbpSbypzAyMT62tc` 에서 구현**됐다(위 참고).
안 B 는 여전히 미구현.

- **안 A — 다음 로그인 시 배너(★구현됨)**: v3 앱이 로그인 직후
  `emailMarketingConsent.status==="unknown"` 인 실가입 파운더에게 얇은 배너로
  "마케팅 소식 받아보기" opt-in 을 노출. 체크 시 `users/{uid}.webPrivacyConsent.marketing=true`
  를 쓰는 기존 훅 1b(`syncMarketingConsentOnUserWrite`) 경로를 그대로 재사용 —
  **새 훅이 필요 없다**. 장점: 코드 재사용 최대, PIPA 상 능동적 opt-in 요건을
  가장 깔끔히 충족. 단점: 로그인해야만 노출되므로 휴면 파운더는 못 잡는다.
- **안 B — 트랜잭션 메일 opt-in 링크**: 파운더 접근 안내 등 기존 transactional
  메일(게이트 비대상이라 발송 가능) 본문에 "마케팅 소식도 받아보기" 링크를 추가.
  클릭 시 `unsubscribeMarketingEmail` 과 대칭인 신규 HTTPS 엔드포인트가
  `grantConsent(explicit_opt_in, source=reconsent_email_link)` 를 호출. 장점:
  휴면 파운더도 도달. 단점: 신규 엔드포인트(HMAC 토큰 설계 포함) 필요 — 구현 비용 A 보다 큼.
- 두 경로 모두 **grant 근거는 클릭/체크 그 자체**(explicit_opt_in) — 이번 백필/과거
  `agreed` 를 근거로 소급 승격하지 않는다(D2 불변식 유지).
- 실발송(re-consent 캠페인 자체를 트리거하는 관리자 액션)은 별도 결정 사안 — 이
  설계는 opt-in 수집 경로만 다룬다.

## 배포

```bash
cd v3/functions && npm run build
GCLOUD_PROJECT=marblo-2253d firebase deploy --only functions,firestore:rules --project marblo-2253d
```

- 리전: us-central1 (전 함수 공통).
- 신규 env 2개는 functions 환경(.env/Secret Manager)에 설정 — 저장소에 값 커밋 금지.

## 테스트

```bash
cd v3/functions && npm run test:marketing      # 순수 로직 42 케이스 (의존성 0, node --test)
cd v3/functions && npm run test:consent-sync   # 동의 배선 28 케이스 (Firestore+Auth 에뮬레이터)
cd v3 && npx vitest run tests/unit/marketingConsent.test.ts   # 앱측 배너/파킹 판정 13 케이스
```

`test:consent-sync` 는 컴파일된 `lib/index.js` 의 실제 훅을 에뮬레이터에 붙여 문서 전이를
검증한다 — 손 fixture 로 로직을 재구현하지 않는다(거짓 초록 방지).
★JDK 21+ 필요: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`.

**★`v3/functions` 에 devDependency 를 추가하지 말 것** — Cloud Build 의 `npm ci` 가 EUSAGE 로
배포를 통째로 실패시킨다. 테스트는 의존성 0(node:test / 에뮬레이터)으로만 짜고, 변경 후
`npm ci --dry-run` 으로 확인한다.
