# 파운더 100인 베타 퍼널 — 6/24 오픈 Readiness 감사

- **감사일**: 2026-06-20
- **대상 커밋**: `origin/main` @ `0656fee`
- **티켓**: `egIPeWmpe4aCwiMC2qVp`
- **범위**: 읽기 전용 감사 (코드 수정 없음 · 발견·문서화만)
- **경로 표기**: 별도 표기 없으면 `marblo-web/` 기준, Cloud Functions 는 `v3/functions/src/index.ts`

> **결론(요약)**: 퍼널은 랜딩→신청→피드백→보상→어드민까지 **전 구간이 코드로 구현·서버 강제**되어 있어 **수동 우회 없이도 6/24 오픈 가능**하다. 단 **1개 차단요소**(100석 고정 캡 노출 — 결정과 충돌)와 **2개 배포 env 확인**(`ADMIN_UID`, `RESEND_API_KEY)`이 오픈 전 선결 조건이다.

---

## 1. 항목별 상태표

| #   | 점검 항목                                        | 상태                        | 근거 (file:line)                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 랜딩/가입 — 베타 랜딩 라우트 존재·도달가능       | **완료**                    | `/founders` 라우트 `src/app/[locale]/founders/page.tsx`; 구 `/foundation50`→`/founders` 리다이렉트 `next.config.ts:9-19`; 홈 섹션 `src/app/[locale]/page.tsx:103`; 사이트 전역 프로모바 `src/app/[locale]/layout.tsx:79`                                                                                                                                                 |
| 1b  | PIPA 동의 게이팅                                 | **완료**                    | 연령확인+개인정보 동의 체크박스 `BetaTester50SignupForm.tsx:49-58, 156-196` (둘 다 필수, `/legal/privacy` 링크); **서버 강제** `v3/firestore.rules:283-289` (`agreed == true` 없으면 create 거부)                                                                                                                                                                        |
| 2   | 신청 흐름 — 폼→Firestore 저장                    | **완료**                    | `BetaTester50SignupForm.tsx:64-71` `addDoc(betatester50_waitlist, {email,locale,source,agreed,agreedAt,createdAt})`; 키·이메일·source 화이트리스트 검증 `firestore.rules:283-289`; 카운트 집계는 `getWaitlistCount` (index.ts:1539-1542)                                                                                                                                 |
| 3   | 피드백 — 3일내 6문항 폼·제출 저장·기한 로직      | **완료**                    | 폼 `src/app/[locale]/founders/feedback/page.tsx` (q1·q2·q4·q5·reason 필수 + q3 선택 + 1~10 평점 = 6문항); 로그인 게이트 `:48-61`; 서버 검증 `submitFounderFeedback` index.ts:1337-1467 — 이메일인증(`email_verified`)·선정여부·중복제출·**접근후 3일 deadline**(`FOUNDER_FEEDBACK_WINDOW_DAYS=3`, index.ts:989, 1414-1422) 트랜잭션 강제; 저장 `founder_feedback` 컬렉션 |
| 4   | 보상 — 피드백→Pro 3개월 / 인터뷰→Pro 6개월 grant | **완료**                    | 피드백 grant = **자동·결제우회**: `submitFounderFeedback`가 제출 성공 시 `grantFounderProInternal(uid, 3, "founder_feedback")` 호출 (index.ts:1446-1450; `paymentProvider="founder_grant"` index.ts:1034); 인터뷰 +3개월(누적 6) = **수동(어드민)**: `markFounderInterviewed` (index.ts:1471-1523) — `/admin` "인터뷰 보너스 적용" 버튼(`admin/page.tsx:258-276`)        |
| 5   | 이메일 — 선정/피드백 안내 자동화                 | **완료(구현됨)·env 게이트** | `sendFounderAccessEmail` Resend API (index.ts:1206-1240), 선정 시 자동 발송 `markFounderSelected` (index.ts:1296-1304); ko/en/ja 템플릿(index.ts:1068-1189); 어드민 수동 재발송 `resendFounderAccessEmail` (index.ts:1311-1334) → `/admin` 재발송 버튼. **`RESEND_API_KEY` 미설정 시 발송 스킵**(index.ts:1211-1214) — 이때도 어드민 재발송/수동 메일로 6/24 진행 가능   |
| 6   | 어드민 — 선정/grant 관리 UI                      | **완료**                    | `src/app/[locale]/admin/page.tsx` 풀 UI: 대기자 명단+선정(`markFounderSelected`), 인터뷰 보너스, 파운더 현황(상태·접근부여·피드백·Pro개월), 접근이메일 재발송, 6문항 피드백 열람 모달. 서버 게이트 `requireAdmin`=`ADMIN_UID` (index.ts:1004-1009)                                                                                                                       |
| 7   | 6/24 공개 오픈 차단요소                          | **부분**                    | 아래 §2 갭 참조 — 코드 차단요소 1건(100석 캡 노출) + 배포 env 2건                                                                                                                                                                                                                                                                                                        |

---

## 2. 심각도별 갭 리스트

### 🔴 Blocker — 오픈 전 반드시 처리

**B1. 100석 고정 캡이 노출되어 있고, 100명에서 신청이 자동 마감됨** _(결정과 직접 충돌)_

요건 결정: _받을 인원 미정 → 고정 캡(100석·seats_left·"한정 100명")을 노출하지 않는다._ 현재 코드는 캡을 노출할 뿐 아니라 **카운트가 100에 도달하면 신청 폼을 자동으로 닫는다.**

- 카운터 메커니즘 — `src/components/BetaTester50Section.tsx`
  - `SEAT_CAP = 100` (`:11`)
  - `getWaitlistCount` 호출 → `seatsLeft = 100 - count` (`:29-36`)
  - 라이브 카운터 노출 `showLiveCounter` / `t("seats_left")` (`:50-51, 67-69`)
  - **자동 마감**: `isClosed = seatsLeft === 0` → 폼 비활성 + "모집 마감" (`:46`, `BetaTester50SignupForm.tsx:41,115,131,138`)
- 캡 노출 i18n 문자열 (`betatester50` 블록)
  - `seats_left`: ko `messages/ko.json:311`("남은 자리 {n}명") / en `:311` / ja `:311`
  - `seats_loading`: ko `:312`("한정 100명") / en `:312`("Limited to 100") / ja `:312`("限定 100 名")
  - `closed`: ko `:318`("100인 모집 마감") / ja `:318`

**조치(6/24까지)**: 라이브 좌석 카운터·`isClosed` 자동마감 로직 제거(또는 `SEAT_CAP` 캡 비활성), `seats_left`/`seats_loading`/`closed` 노출 문구 제거. 카운터 *부재*는 정상이므로 추가 작업 불필요.

### 🟠 High

**H1. "100인 한정" 류 고정 캡 문구가 랜딩 전반에 노출** _(결정과 충돌, 카피)_

캠페인 명칭·배지·노트에 "100인 한정/모집/마감"이 다수 노출. 인원 미정 방침과 충돌하므로 비수치 표현("파운더 선별 모집" 등)으로 교체 권장.

- `promoBar.message` ko `messages/ko.json:245` / ja `:245` ("파운더 100인 모집 …")
- `foundation50.badge` ko `:253`("100인 한정") / en `:253`("100 seats only") / ja `:253`
- `foundation50.title` ko `:254` / ja `:254` ("마블로 파운더 100인 모집")
- `foundation50.limit_note` ko `:256`("100인 한정 · 선별 모집…") / en `:256` / ja `:256` — 렌더 위치 `founders/page.tsx:83`
- `foundation50.cta_heading` ko `:279` / ja `:279` ("…100인 신청하기")
- `betatester50.badge`/`title` ko `:308-309` / en `:308` / ja `:308-309`
- `receive_item3` ko `:329`("100인만 들어오는…") / ja `:329`

> 참고: "100인만 들어오는 비공개 채널"(`benefit3_body :263`, `q4_body :303`)은 커뮤니티 규모 설명에 가깝지만 동일하게 수치 캡을 암시 → 함께 검토 권장.

### 🟡 Med

**M1. 배포 env 확인 — `ADMIN_UID` 미설정 시 어드민 전 기능 불능**
`requireAdmin`이 `ADMIN_UID` env 단일 체크(index.ts:1004-1009). 미설정/계정불일치면 `/admin`의 선정·인터뷰·현황·피드백열람이 전부 `permission-denied`. **오픈 전 functions 배포 환경에 `ADMIN_UID` 설정 확인 필수.**

**M2. 배포 env 확인 — `RESEND_API_KEY` 미설정 시 자동 이메일 스킵**
미설정 시 선정 안내 이메일이 발송되지 않고 스킵(index.ts:1211-1214). 수동 재발송/메일로 우회 가능하나, 자동화를 켜려면 `RESEND_API_KEY`(+선택 `FOUNDER_FROM_EMAIL`, `DISCORD_INVITE_URL`) 설정 필요. 발신 도메인(`founders@marblo.app`) SPF/DKIM 검증도 사전 확인 권장.

### 🟢 Low

**L1. 문서/코드 드리프트(차단 아님)**

- `v3/functions/src/index.ts:979` 주석 "이메일 발송은 수동 MVP" — 실제 코드는 선정 시 **자동 발송**. 주석 정정 필요.
- 프로젝트 메모 "이메일자동화·어드민UI 보류"는 **구현 완료되어 outdated**. 두 기능 모두 DONE.

---

## 3. 판정 — "수동 우회로 6/24 오픈 가능한가"

**가능(YES).** 이메일/어드민 자동화는 이미 코드로 구현되어 있으며, 설령 자동 이메일을 끄더라도(`RESEND_API_KEY` 미설정) 어드민 재발송 버튼·수동 메일로 전 흐름을 운영할 수 있다. 어드민 UI는 `ADMIN_UID`만 설정되면 완전 동작한다. 보상(Pro 3개월) grant는 피드백 제출 시 **자동·결제우회**로 부여되어 수동 개입이 불필요하다.

**단, 오픈 전 선결 3건:**

1. **(Blocker B1)** 100석 좌석 카운터 + 100명 자동마감 제거 — 결정(인원 미정)과 충돌하고, 방치 시 100 신청에서 접수가 막힌다.
2. **(Med M1)** functions 배포 env `ADMIN_UID` 설정 확인 — 미설정 시 어드민 운영 불가.
3. **(High H1)** "100인 한정" 캡 카피 비수치 표현으로 교체(카운터 제거와 함께 일괄).

`RESEND_API_KEY`(M2)는 자동 이메일 편의용 — 미설정이어도 수동 우회로 오픈 자체는 가능.

---

## 4. 6/24까지 액션 체크리스트

- [ ] **(B1)** `BetaTester50Section.tsx` 좌석 카운터·`isClosed` 자동마감 제거 / `seats_left`·`seats_loading`·`closed` i18n 노출 제거 (ko/en/ja)
- [ ] **(H1)** "100인 한정/모집/마감" 카피를 비수치 표현으로 교체 (ko/en/ja, §2-H1 라인 목록)
- [ ] **(M1)** functions 배포 환경 `ADMIN_UID` 설정 + 어드민 계정으로 `/admin` 1회 동작 확인
- [ ] **(M2, 선택)** `RESEND_API_KEY`(+발신 도메인 SPF/DKIM) 설정 후 선정 1건 자동 이메일 수신 확인 — 미설정 시 어드민 재발송 운영 합의
- [ ] **(L1)** index.ts:979 주석 정정 (자동 발송 반영)
- [ ] (회귀) 비로그인 → `/founders/feedback` 진입 시 로그인 리다이렉트, 신청 폼 동의 미체크 시 차단 1회 스모크 테스트
