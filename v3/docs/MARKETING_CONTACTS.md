# marketing_contacts SoT — 운영 가이드

이메일/푸시 마케팅의 데이터 기반. **Firestore = 운영 SoT**(수신동의·unsubscribe·실시간),
**BigQuery = 분석 미러**(세그먼트·캠페인 집계). cf 감사 티켓 `qFEzBLhBCpGIBnJJg9Xg`,
구현 티켓 `kKgzB91jskKwAgxT5Ukp`.

## 스키마

### Firestore `marketing_contacts/{contactId}`

- `contactId = sha256(normalize(email))` — 이메일당 문서 1개(멱등 백필·dedupe 가 docId 로 보장)
- 평문 이메일은 **저장하지 않는다**. `emailEnc`(AES-256-GCM) + `normalizedEmailHash` + `emailDomain`(집계용)만.

| 필드 | 설명 |
| --- | --- |
| `uid` | Firebase Auth uid (nullable — waitlist 만 있는 리드는 null) |
| `emailEnc` | `v1:<iv>:<tag>:<ct>` AES-256-GCM. 키 미설정 환경에선 null(키 설정 후 백필 재실행으로 채움) |
| `source` | 최초 유입: `auth_signup` \| `waitlist` \| `founder` \| `subscription` \| `manual` |
| `signupAt` | Auth `metadata.creationTime` (더 이른 값 유지) |
| `founderStatus` | `founders/{email}.status` 미러 (`selected`/`rejected`/`pending`…) |
| `subscription` | `{plan(planType), status, provider(paymentProvider), periodEnd}` 미러 |
| `emailMarketingConsent` | `{status: granted\|pending\|revoked\|unknown, source, version, consentedAt, revokedAt, legalBasis}` |
| `unsubscribe` | `{status: subscribed\|unsubscribed, tokenHash, unsubscribedAt}` |
| `segments[]` | `waitlist`/`auth_user`/`founder`/`founder_rejected`/`paid`/`beta_active` (파생) |
| `lifecycleStage` | `lead → signup → founder → subscriber` (파생) |

- 하위컬렉션 `consent_events/*`: 동의/철회/수신거부 감사로그(append-only).
- `push_tokens/{docId}`: **스키마만 예약**(uid·deviceId·platform·tokenHash·pushMarketingConsent).
  푸시 동의는 이메일 동의와 완전히 분리된 축. 적재는 후속 티켓.
- Firestore 룰: `marketing_contacts`·`consent_events`·`push_tokens` 전부 클라이언트 차단(Admin SDK 전용).

### 동의 규약 — GDPR/PIPA/CAN-SPAM

**status 의미** (발송 가능 = `granted` 하나뿐):

- `granted`: 유효한 마케팅 수신동의 (`legalBasis=explicit_opt_in`)
- `pending`: **재동의 캠페인 대상 풀 — 발송 불가**. waitlist 폼 체크박스는
  "파운더 활동/인용 동의"이지 개인정보(이메일) 수집·이용/마케팅 수신동의가 아니다
  (`marblo-web/docs/COMPLIANCE-AUDIT.md` **D2**, PIPA Med — 처리방침 링크·수집목적 미명시).
  따라서 waitlist 41명은 granted 로 승격하지 않고 pending 으로만 적재한다(사장님 결정 2026-07-18).
- `unknown`: 동의 증거 없음(Auth-만 가입자) → 발송 불가
- `revoked`: 철회/수신거부 → 발송 불가. 훅은 revoked 를 절대 되살리지 않는다.

**legalBasis**: `explicit_opt_in`(granted 의 유일한 정상 근거) | `none`. 근거를 날조하지 말 것 — waitlist agreed 는 근거가 아니다.

**전이 경로**: `unknown → pending`(markPending, 재동의 풀 편입) / `unknown|pending → granted`(grantConsent, 정식 재동의 캠페인·마케팅 전용 체크박스) / `* → revoked`(unsubscribe). 모든 전이는 `consent_events` 에 기록된다(`pending_init`/`granted`/`unsubscribed`).

- 마케팅 동의는 프라이버시/텔레메트리 동의와 **별개 필드**로만 관리한다.

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
5. 이후는 훅 4개(`syncMarketingContactOn{AuthCreate,WaitlistCreate,FounderWrite,SubscriptionWrite}`)가 실시간 유지.

## 배포

```bash
cd v3/functions && npm run build
GCLOUD_PROJECT=marblo-2253d firebase deploy --only functions,firestore:rules --project marblo-2253d
```

- 리전: us-central1 (전 함수 공통).
- 신규 env 2개는 functions 환경(.env/Secret Manager)에 설정 — 저장소에 값 커밋 금지.

## 테스트

```bash
cd v3/functions && npm run test:marketing   # 순수 로직 11 케이스
```
