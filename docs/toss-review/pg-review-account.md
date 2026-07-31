# PG 심사관용 테스트 계정 (카카오페이 / 카드사 심사 제출용)

티켓: `tZQj7pEAJIR3DQ3Adijj`
발급일: 2026-08-01
대상: PG(카카오페이) 신청서 "테스트 계정 ID/PW" 란

> ⚠️ **이 문서는 private repo(`melocream/marblo`) 전용입니다.** 공개 repo(`marblo-app/marblo`),
> marblo-web, 릴리스 노트, 블로그 어디에도 옮기지 마세요. 비밀번호 평문이 들어 있습니다.

---

## 1. 신청서에 적을 값

| 항목         | 값                               |
| ------------ | -------------------------------- |
| 로그인 URL   | https://marblo.app/ko/auth/login |
| ID (이메일)  | `pg-review@marblo.app`           |
| 비밀번호     | `hc2j$XA#9aQeVtEzMgFt`           |
| 표시 이름    | PG 심사 테스트                   |
| Firebase uid | `pcYA1qgUGrW2LGL3CKXvDThZYQ02`   |

계정 상태 (admin SDK `getUserByEmail` 재확인):

- `emailVerified: true` — 심사관이 이메일 인증 절차 없이 바로 로그인 가능
- `disabled: false`
- provider: `password` (이메일/비밀번호 단독, Google 로그인 불필요)
- `customClaims: null` — 관리자 권한 없음, 일반 사용자와 동일한 화면

## 2. 심사관 확인 경로

1. https://marblo.app/ko/auth/login 접속 → 위 ID/PW 입력 → 로그인
2. https://marblo.app/ko/checkout?plan=pro 접속
   (미로그인 상태로 이 URL을 먼저 열면 로그인 페이지로 보냈다가 로그인 후 자동으로 되돌아옵니다)
3. 주문 요약 확인: 플랜 **Pro**, **₩19,000/월**, 자동갱신·해지 안내 문구 노출
4. 하단 **[필수] 결제대행사 개인정보 제3자 제공 동의** 체크 → **결제하기** 활성화
5. **결제하기** 클릭 → 토스페이먼츠 카드 등록창(정기결제 빌링키 등록) 오픈

여기까지가 심사에서 확인할 "결제창 도달"입니다. **카드번호는 입력하지 않아도 됩니다.**

### 2-1. 최초 로그인 시 동의 모달

신규 계정 최초 로그인 시 **"서비스 이용을 위한 동의가 필요합니다"** 모달이 뜹니다
(개인정보 수집·이용, 국외 이전 — PIPA 제28조의8). 검증 과정에서 이미 동의 처리해 두었으므로
심사관은 보지 않을 가능성이 높지만, 만약 뜨면 **"전체 동의하기" → "동의하고 계속"** 을 누르면 됩니다.

## 3. 실측 검증 결과 (2026-08-01, 프로덕션 marblo.app)

헤드리스 브라우저로 위 1~5단계를 실제로 완주했습니다.

| 단계        | 결과                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| 로그인      | ✅ 성공, `?redirect=` 파라미터대로 `/ko/checkout?plan=pro` 로 자동 복귀 |
| 콘솔 에러   | ✅ 없음                                                                 |
| 결제창 도달 | ✅ 토스페이먼츠 카드 등록 iframe 오픈 (`등록할 카드를 입력해주세요`)    |
| 실결제 발생 | ❌ 없음 (카드번호 미입력)                                               |

결제창 도달 후 Firestore 를 확인해 **과금 흔적이 전혀 없음**을 검증했습니다:

- `subscriptions` / `payments` / `orders` / `billingKeys` — 이 uid 로 문서 **0건**
- `users/{uid}` — `webPrivacyConsent` 필드만 존재 (위 2-1 동의 기록)

구독 결제 경로는 `payment.requestBillingAuth()` 를 호출합니다. 카드 등록창을 여는 것만으로는
주문·결제 레코드가 생성되지 않고, 카드 정보를 입력해 successUrl 로 돌아와야 비로소 구독이 만들어집니다.
따라서 심사관이 결제창까지만 확인하는 한 과금은 발생하지 않습니다.

### 3-1. 심사관에게 보이는 결제창은 현재 **테스트(샌드박스)** 창입니다

실측한 iframe:

- host: `payment-gateway-sandbox.tosspayments.com/billing/pc`
- clientKey: `test_ck_***` (테스트 키)
- 창 안 배지: **"실제 결제가 안되는 테스트입니다"**
- 창 상단 상호: **(주) 비바리퍼블리카** (샌드박스라 토스 자체 법인명이 뜸, 하이프마크 아님)

★카드사 심사를 test 키 상태로 받는 것은 정상 절차입니다(라이브 키는 심사 통과 후 발급).
다만 심사관이 "테스트입니다" 배지와 토스 법인명을 보게 되므로, 신청서·심사 문의 시
**"라이브 키 미발급 상태라 샌드박스 결제창으로 확인 부탁드립니다"** 를 미리 안내하는 편이 안전합니다.

## 4. 주의사항

- ★**심사 진행 중 로그인 게이트 정책을 변경하지 마세요** (토스 심사 기준 §10).
  결제 페이지 진입 전 로그인 요구 여부, `?redirect=` 복귀 동작, 필수 동의 체크박스 구성을
  심사가 끝날 때까지 그대로 유지해야 합니다. 바꾸면 심사관이 본 화면과 달라져 재심사 사유가 됩니다.
- 이 계정에 **구독을 부여하거나 결제 데이터를 만들지 마세요.** 심사관은 결제창 도달만 확인합니다.
  구독이 이미 있으면 결제 페이지가 다른 화면으로 흐를 수 있습니다.
- 심사 종료 후에는 계정을 비활성화(`disabled: true`)하거나 비밀번호를 교체하세요.
- 비밀번호를 재발급해야 하면 Firebase Auth 콘솔 또는 admin SDK `updateUser` 로 교체한 뒤
  **이 문서의 값도 같이 갱신**하세요.

## 5. 재발급 방법

ADC(john.kim) 인증으로 admin SDK 를 씁니다. 이 맥에서 `gcloud` / `bq` CLI 는 temu 서비스계정이라
403 이 나므로 쓰지 마세요.

```
NODE_PATH=<v3/functions/node_modules 경로> GOOGLE_CLOUD_PROJECT=marblo-2253d node -e "
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'marblo-2253d' });
  admin.auth().updateUser('pcYA1qgUGrW2LGL3CKXvDThZYQ02', {
    password: '<새 비밀번호>', emailVerified: true,
  }).then(u => console.log(u.uid));
"
```
