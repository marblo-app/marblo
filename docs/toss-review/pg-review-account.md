# PG 심사관용 테스트 계정 (KG이니시스 / 카카오페이 / 카드사 심사 제출용)

티켓: `tZQj7pEAJIR3DQ3Adijj` (최초 발급) · `i1cmV7TfWoPrKhHFfA72` (2026-08-31 재검증)
발급일: 2026-08-01
**재검증일: 2026-08-31 — 계정 그대로 유효, 비밀번호 변경 없음. 결제창은 토스 → 포트원(KG이니시스)로 바뀌었다.**
대상: PG 신청서 "테스트 계정 ID/PW" 란 (KG이니시스 전자계약 · 카카오페이 · 카드사 심사)

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

★2026-08-31 재확인: **비밀번호 변경 없음** — 위 값을 그대로 신청서에 적으면 된다.

계정 상태 (2026-08-31 admin SDK `getUserByEmail` 재확인, 2026-08-01 과 동일):

- `emailVerified: true` — 심사관이 이메일 인증 절차 없이 바로 로그인 가능
- `disabled: false`
- provider: `password` (이메일/비밀번호 단독, Google 로그인 불필요)
- `customClaims: null` — 관리자 권한 없음, 일반 사용자와 동일한 화면

> 참고: `https://marblo.app/ko/...` 로 들어가면 정상(200) 이지만 주소창은 `/auth/login`,
> `/checkout` 으로 `ko` 프리픽스가 빠진 형태로 정규화된다. 동작은 같으니 신청서에는
> `ko` 포함 URL 을 그대로 적어도 된다.

## 2. 심사관 확인 경로 (2026-08-31 기준)

1. https://marblo.app/ko/auth/login 접속 → 위 ID/PW 입력 → 로그인
   (로그인 후에는 마블로 홈으로 이동합니다. 별도 모달·조직 설정 화면은 뜨지 않습니다.)
2. https://marblo.app/ko/checkout?plan=pro 접속
   (미로그인 상태로 이 URL을 먼저 열면 `?redirect=` 를 달고 로그인 페이지로 보냈다가,
   로그인 후 자동으로 결제 페이지로 되돌아옵니다. 2026-08-31 실측 확인)
3. 주문 요약 확인: 플랜 **Pro**, **₩19,000/월**, 자동갱신·해지 안내 문구 노출
4. **결제수단** 선택: **신용·체크카드**(기본) 또는 **카카오페이**
5. ★**전화번호 (필수)** 입력 — 없으면 [결제하기] 가 활성화되지 않습니다
6. **[필수] 결제 진행 및 결제대행사(포트원 및 KG이니시스)로의 개인정보 제3자 제공 동의** 체크
   → **결제하기** 활성화
7. **결제하기** 클릭 →
   - 신용·체크카드 선택 시: **KG이니시스 카드 등록창(정기결제 빌링키 등록)** 오픈
   - 카카오페이 선택 시: **카카오페이 자동결제 등록창(QR/카톡결제)** 오픈

여기까지가 심사에서 확인할 "결제창 도달"입니다. **카드번호·주민등록번호는 입력하지 않아도 됩니다.**

> ★확인이 끝나면 결제창은 창 안의 **X 버튼으로 닫아 주세요.** 결제창을 띄운 채로 페이지를
> 새로고침하거나 다른 페이지로 이동하면 브라우저 세션에 진행중 표시가 남아, 다시 [결제하기]를
> 누를 때 "결제가 이미 진행 중입니다" 안내가 최대 15분간 나올 수 있습니다.
> (그 경우 브라우저 탭을 새로 열면 즉시 해소됩니다.)

### 2-1. 최초 로그인 시 동의 모달

신규 계정 최초 로그인 시 **"서비스 이용을 위한 동의가 필요합니다"** 모달이 뜹니다
(개인정보 수집·이용, 국외 이전 — PIPA 제28조의8). 검증 과정에서 이미 동의 처리해 두었으므로
심사관은 보지 않습니다(2026-08-31 재확인: 로그인 직후 모달 0개). 만약 뜨면
**"전체 동의하기" → "동의하고 계속"** 을 누르면 됩니다.

## 3. 실측 검증 결과 (2026-08-31, 프로덕션 marblo.app) ★최신

헤드리스 브라우저(gstack browse)로 §2 의 1~7 단계를 실제로 완주했습니다.

| 단계                    | 결과                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| 로그인                  | ✅ 성공                                                                  |
| 미로그인 → 결제 URL     | ✅ `/auth/login?redirect=%2Fcheckout%3Fplan%3Dpro` 로 게이트 후 자동 복귀 |
| 로그인 직후 화면        | ✅ 마블로 홈. 모달 0개, 조직 온보딩 유도 없음                            |
| 콘솔 에러               | ✅ 없음                                                                  |
| 결제창 도달(카드)       | ✅ **KG이니시스** 카드 등록 iframe 오픈                                  |
| 결제창 도달(카카오페이) | ✅ **카카오페이** 자동결제 등록창(QR) 오픈                               |
| 실결제 발생             | ❌ 없음 (카드번호·주민번호 미입력)                                       |

결제창 도달 후 Firestore 를 확인해 **과금 흔적이 전혀 없음**을 검증했습니다:

- `subscriptions` / `payments` / `orders` / `billingKeys` / `billingCharges` — 이 uid 로 문서 **0건**
- `organizations` / `orgMembers` / `memberships` — 이 uid 로 문서 **0건** (조직 온보딩 영향 없음)
- `users/{uid}` — `webPrivacyConsent` 필드만 존재 (위 2-1 동의 기록)

구독 결제 경로는 **빌링키 발급**(카드 등록)을 호출합니다. 등록창을 여는 것만으로는
주문·결제 레코드가 생성되지 않고, 카드 정보를 입력해 완료해야 비로소 구독이 만들어집니다.
따라서 심사관이 결제창까지만 확인하는 한 과금은 발생하지 않습니다.

### 3-1. ★심사관이 보게 될 결제창 = 포트원(KG이니시스)

2026-08-01 실측 때는 토스페이먼츠 샌드박스 창이었습니다. **지금은 아닙니다.**
2026-08-31 실측 기준 네트워크 로그에 `tosspayments.com` 호스트는 **0건**입니다.

신용·체크카드 선택 시:

- 최상위 iframe: `https://checkout-service.prod.iamport.co/page/...` (포트원 V2 체크아웃, `id="imp-iframe"`)
- 그 안 실제 결제창 호스트: `stgstdpay.inicis.com` · `stdux.inicis.com` · `ds-cdn.inicis.com` · `fds-g.inicis.com`
- 창 안 상호: **KG 이니시스** / 문구 "안전하고 편리한 이니시스결제입니다."
- 우측 패널 상품명: **Marblo Pro 구독**, 제공기간 "별도제공기간없음"
- 입력 폼: 카드번호 · 유효기간 · 카드구분(개인/법인) · 주민등록번호 + 전자금융이용약관 등 4개 동의 → [확 인]
- **테스트 배지 없음** — 창 안에 "테스트입니다" 류 표시가 뜨지 않습니다.
  다만 호스트가 `stgstdpay`(이니시스 테스트 엔드포인트)이므로 **현재 채널은 테스트 MID** 로 물려 있습니다.
  라이브 MID 발급 후에는 `stdpay.inicis.com` 으로 바뀝니다.

카카오페이 선택 시:

- iframe: `https://checkout-service.prod.iamport.co/driver-host?definitionPath=pg/kakaopay/issue-billing-key/...`
- 호스트: `online-payment.kakaopay.com` · `pay-api-gw.kakaopay.com` (프로덕션)
- 창 모습: 카카오페이 자동결제 등록 — **QR결제 / 카톡결제** 탭, QR 코드 표시

★카드사·PG 심사를 테스트 MID 상태로 받는 것은 정상 절차입니다(라이브 MID 는 심사 통과 후 발급).
신청서·심사 문의 시 **"라이브 MID 미발급 상태라 테스트 결제창으로 확인 부탁드립니다"** 를
미리 안내하는 편이 안전합니다.

증적 스크린샷: `captures/2026-08-31_01_post_login.png` · `_02_checkout.png` ·
`_03_inicis_window.png` · `_04_kakaopay_window.png`

### 3-2. (참고) 2026-08-01 최초 실측 — 지금은 유효하지 않음

당시 결제창은 토스페이먼츠 샌드박스였습니다:
host `payment-gateway-sandbox.tosspayments.com/billing/pc`, clientKey `test_ck_***`,
창 안 배지 "실제 결제가 안되는 테스트입니다", 창 상단 상호 "(주) 비바리퍼블리카".
**국내 결제가 포트원으로 일원화되면서 이 경로는 신규 진입이 닫혔습니다.**
자세한 배경은 `docs/payment/toss-teardown-prerequisites.md` 참조.

## 4. 주의사항

- ★**심사 진행 중 로그인 게이트·결제 진입 화면을 변경하지 마세요.**
  결제 페이지 진입 전 로그인 요구 여부, `?redirect=` 복귀 동작, 필수 동의 체크박스 구성,
  전화번호 필수 입력, 결제수단 토글 구성을 심사가 끝날 때까지 그대로 유지해야 합니다.
  바꾸면 심사관이 본 화면과 달라져 재심사 사유가 됩니다.
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
    password: '<새 비밀번호>'
  }).then(u => console.log(u.uid));
"
```
