# 이탈 사용자 사유 청취 메일 — 발송 직전 상태 (사장님 결재 반영본)

티켓: `qcwgC4h3XPm2IZQrhntq`
사장님 지시: "이탈 사용자에게 물어보기와, 피드백 주시면 프로 3개월 무료로 준다고 하자."
실측 기준일: **2026-08-24**
관련 선례: `founder-survey-offer-email-campaign.md` (설문 오퍼 캠페인 — 대상 세그먼트가 다르다)

> ★**아직 아무것도 발송하지 않았다.** 발송은 **오케가** 6절의 명령으로 실행한다.
> 스크립트는 기본이 dry-run 이고, `--send` 와 `--confirm` 이 **둘 다** 있어야만
> 메일이 나간다. 이 저장소에서 실발송 명령은 한 번도 실행되지 않았다
> (dry-run 만 반복 실행 — 6절에 출력 그대로 붙였다).
>
> ★2026-08-24 사장님 결재 4건 반영본이다: ① 앵커 방식 확정 ② 발신자 인증 확인
> ③ B 제외 승인 ④ 감사 인사 추가.
>
> ★이 문서에는 이메일 주소·uid 가 없다. 대상은 A/B/C/D 코드와 uid 해시 앞
> 8자리로만 지칭한다. 실제 식별자는 스크립트가 발송 시점에만 메모리에서 쓴다.

---

## 0. 세 줄 요약

1. 토큰을 쓴 비운영자는 **정확히 4명**이 맞다. 그중 **B 는 사장님 본인 계정**임이
   확인됐으므로(사장님 결재) 모수에서 뺀다 → **활성화율 3/32 = 9.4%**.
   "이틀에 5,740만 토큰·$47" 인물은 실재한다 — 아래 **A** 다.
2. **발송 대상은 A·D 두 명.** B 는 사장님 계정, C 는 수신동의 철회 + 실결제 고객
   이라 그랜트가 결제를 깬다. 스크립트 dry-run 이 이 2명을 그대로 뽑는다.
3. **"Pro 3개월"이 진짜 3개월이 되도록 코드를 고쳤다.** `upsertProSubscription` 에
   이어붙이기 모드를 넣고(앵커를 트랜잭션 안에서 계산), 전용 부여 콜러블
   `grantChurnInterviewPro` 를 붙였다. A·D 모두 **+92일**이 dry-run 으로 실측된다.

---

## 1. 대상 실측 — 토큰을 쓴 비운영자 4명

**출처**: BigQuery `marblo-2253d.marblo_telemetry.cost_logs` (원시 uid 를 보관하는
유일한 원장 — 분석 표의 `user_key` 는 가명이라 연락에 못 쓴다).
distinct `userId` 는 전체 **5명**, 그중 1명이 `ADMIN_UID`(운영자)다. sha256 대조로
확인했고 값은 어디에도 출력하지 않았다. 나머지 4명이 아래다.

**모수 검증**: Firestore `subscriptions` 중 `founderGrant == true` 는 **34건**
(founder_backfill 13 / beta_selected 12 / beta_signup 7 / experience_share_reward 1 /
team_test_grant 1). 운영자 1명을 빼면 **33** — 티켓의 "비운영자 계정 33개"와 일치.

> ⚠️ 사장님께 보고할 때 주의: Firebase Auth **전체 계정은 5,308개**다. "33"은
> **grant 보유자** 모수지 전체 가입자가 아니다. "가입 33명 중 4명이 썼다"로
> 새어나가면 숫자가 완전히 다른 이야기가 된다.

| 코드  | uid 해시   |        총 토큰 |       비용 | 사용 구간                       | 활동일 | 마지막 로그인/토큰갱신  |   무활동 |
| ----- | ---------- | -------------: | ---------: | ------------------------------- | -----: | ----------------------- | -------: |
| **A** | `2024e2ef` | **57,406,548** | **$47.13** | 07-30 ~ 07-31 (94건, 2프로젝트) |    2일 | 07-31 / 07-31           | **24일** |
| **B** | `f624a23f` |      5,376,968 |      $5.60 | 08-13 ~ 08-21 (71건, 2프로젝트) |    6일 | **08-24(오늘)** / 08-24 |      0일 |
| **C** | `4dd697a8` |        262,875 |      $0.23 | 08-01 ~ 08-13 (5건)             |    2일 | 08-13 / **08-24(오늘)** |     11일 |
| **D** | `e0d54aa0` |        112,709 |      $0.11 | 07-21 (4건)                     |    1일 | 07-21 / 07-21           | **34일** |

**A 가 사장님이 말씀하신 그 사람이다.** 계정 생성 07-29 23:16 → 다음날 새벽부터
이틀간 5,740만 토큰을 태우고 07-31 02:09 마지막 로그인 후 24일째 무소식.
"안 써봐서"가 아니라 "써보고" 떠난 유일한 사례라는 진단이 실측으로 확인된다.
**A 의 grant 는 08-29 만료**다 — 닷새 뒤. 이 캠페인에 시한이 있는 이유다.

### ★활성화율 정정 (사장님 결재)

**B 는 사장님 본인 계정**이다(grant 사유 `"team_test_grant (사장님 요청 팀연결
테스트)"`, 오늘 로그인도 사장님). 내부 계정이므로 분자·분모에서 함께 뺀다.

| 계산             | 분자 | 분모 | 활성화율 |
| ---------------- | ---: | ---: | -------- |
| 초판(B 포함)     |    4 |   33 | 12.1%    |
| **확정(B 제외)** |    3 |   32 | **9.4%** |

광고 집행 근거로 쓰실 숫자는 **9.4%** 다.

---

## 2. 발송 대상 — A·D 두 명 (확정)

| 코드  | 발송                           | 근거                                                                                                                                                                              |
| ----- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | ✅ **발송** (deep_churn 문면)  | 24일 무활동, 수신거부 아님, 결제 흔적 없음                                                                                                                                        |
| **B** | ❌ **제외** (사장님 결재)      | 사장님 본인 계정. 더해서 `emailMarketingConsent.status = "revoked"`(08-15), 오늘 로그인 = 이탈자 아님, 이미 파운더 설문 제출·3개월 부여 완료(Pro 12-24까지)                       |
| **C** | ❌ **제외**                    | ① `emailMarketingConsent.status = "revoked"`(08-01) ② **portone 실결제 고객** — `portoneBillingKey`·`portonePaymentId`·monthly, 08-07 결제 ③ 그랜트를 넣으면 4절의 결제 오염 발생 |
| **D** | ✅ **발송** (light_trial 문면) | 34일 무활동, 수신거부 아님, 결제 흔적 없음                                                                                                                                        |

이 표는 손으로 만든 게 아니다. `selectChurnAudience()` 가 같은 판정을 하고,
6절의 dry-run 출력이 정확히 이 2명을 뽑는다.

### 수신동의 상태 (출처: `marketing_contacts.emailMarketingConsent`)

| 코드 | status        | legalBasis                   | 비고                                                                          |
| ---- | ------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| A    | `pending`     | `none`                       | source=waitlist_form, unsubscribe=subscribed, locale=ko                       |
| B    | **`revoked`** | explicit_opt_in → 08-15 철회 | 발송 금지                                                                     |
| C    | **`revoked`** | explicit_opt_in → 08-01 철회 | 발송 금지                                                                     |
| D    | `pending`     | `none`                       | source=backfill_waitlist, unsubscribe=subscribed, locale=ko, 도메인 naver.com |

### ★A·D 는 `granted` 가 아니다 — 그래서 근거를 코드에 명시하게 만들었다

A·D 는 철회는 안 했지만 `pending`(명시적 동의 없음)이다. 기존 마케팅 게이트
(`isEmailable`)는 `granted` 만 통과시키므로, **그 기준으로는 대상이 0명**이다.

그래서 발송 근거를 `--consent-basis` 로 **명시**하게 했다. 조용히 넓어지는 경로는
없다.

| 값                        | 의미                                                                | 대상 수 |
| ------------------------- | ------------------------------------------------------------------- | ------: |
| `granted_only` (**기본**) | `granted` 인 사람만. 기존 마케팅 발송과 동일 기준                   | **0명** |
| `relationship`            | 거래관계(무료 grant 이용) 기반 의견 청취로 보고 `pending` 까지 포함 | **2명** |

**철회자는 어느 값으로도 통과하지 못한다** — 테스트로 고정했다
(`★relationship 근거로도 철회자는 절대 통과하지 못한다`).

`relationship` 으로 보낼 때 함께 거는 것:

1. **본문 무게중심을 의견 청취에 둔다.** 제목·본문의 질문이 "무엇 때문에
   멈추셨나요"이고 Pro 는 한 문장이다. 거래관계 기반 CS 문의의 성격이 본체다.
2. **수신거부 경로를 반드시 붙인다.** 아래 ⚠️ 참조 — 원클릭 인프라가 없어서
   `mailto` 폴백으로 간다.
3. **1회 발송, 리마인더 없음.** 쿨다운 365일. 답이 없으면 그걸로 끝.

> ⚠️ **실측: `MARKETING_UNSUB_SECRET` 이 프로덕션 어디에도 설정돼 있지 않다.**
> `unsubscribeMarketingEmail` 함수의 env 에도 없다(키 목록 확인). 즉
> `marketingEmailDelivery()` 는 항상 `null` 을 반환하고, **기존 파운더 설문 오퍼
> 캠페인도 List-Unsubscribe 없이 나가고 있다.** 이건 이 티켓이 만든 문제가 아니라
> 드러낸 문제다(7절).
>
> 이번 캠페인은 원클릭이 없다고 멈추지 않는다 — 대신 **`mailto` 폴백**을 쓴다:
> `List-Unsubscribe: <mailto:team@marblo.app?subject=수신거부>` 헤더(RFC 2369)와
> 본문 푸터 `이 메일에 "수신거부"라고만 답장해 주세요`. 자동 처리는 안 되지만
> 2명짜리 캠페인에서 사람이 처리하기에 충분하고, **수신거부 경로가 없는 발송은
> 하지 않는다**는 원칙은 지킨다. 시크릿이 설정되면 스크립트가 자동으로 원클릭으로
> 올라선다(코드 수정 불필요).

> ★이건 법률 자문이 아니다. 위 조치는 리스크를 줄이지 면제하지 않는다.
> "그래도 보내지 말자"는 판단은 사장님 몫이고, 그 경우 `--consent-basis` 를
> 기본값(`granted_only`)으로 두면 대상이 0명이라 아무것도 나가지 않는다.

### 표본이 2명뿐인 문제

진짜 큰 구멍은 "써보고 떠난 1명"이 아니라 **grant 를 받고 토큰을 한 번도 안 쓴
29명**이다. 오케 퍼널 실측(앱 첫 실행 577 → 첫 스폰 18 → 첫 태스크 완료 2)도 같은
곳을 가리킨다 — 96.9%가 첫 스폰 전에 사라진다. 광고 집행 근거로는 이쪽 표본이
훨씬 크다. 다만 그건 다른 질문("왜 시작조차 안 하셨나요")이고 기존
`sendFounderFollowupEmails`(미가입 팔로업)와 세그먼트가 겹치는지 봐야 한다.
**별도 티켓 제안.**

> ★그 퍼널 사실을 **메일에 쓰지 않았다.** 우리가 원인을 안다고 쓰면 열린 질문이
> 유도질문이 된다. 문면은 그대로 질문 하나다.

---

## 3. 메일 문면 (확정)

발신·답장은 `team@marblo.app` — 배포된 함수 env(`FOUNDER_FROM_EMAIL`,
`FOUNDER_REPLY_TO`)에서 실측 확인했고, **Resend 인증 발신자임을 사장님이
확인**하셨다(결재 2번). 발송 스킵 걱정 없음.

아래는 `buildChurnInterviewEmail(locale, segment)` 의 **실제 출력**이다
(스크립트 dry-run 이 찍은 것을 그대로 붙였다 — 손으로 옮긴 게 아니다).

### 3-1. A 용 — `ko` / `deep_churn`

- 제목: **무엇 때문에 멈추셨나요?**

```
며칠 동안 마블로로 실제 작업을 돌려보신 뒤, 발길이 끊기셨습니다.

무엇 때문에 멈추셨나요?

한 줄이면 충분합니다. 이 메일에 그대로 답장만 주세요. 설문도, 양식도 없습니다.

답장 주시면 지금 남아 있는 기간에 이어서 Pro 3개월을 무료로 얹어 드리겠습니다. 다른 조건은 없습니다.

무엇보다, 베타 사용자로서 마블로를 사용해 주셔서 감사합니다.

감사합니다.
마블로 팀 드림

Marblo · team@marblo.app

수신거부: 이 메일에 "수신거부"라고만 답장해 주세요. (Unsubscribe: reply with "unsubscribe")
```

### 3-2. D 용 — `ko` / `light_trial`

첫 문장만 다르다. 질문·제안·감사·서명은 동일하다(문면이 갈라져 관리가 흩어지지
않게).

```
마블로를 한 번 열어보신 뒤, 다시 오지 않으셨습니다.

무엇 때문에 멈추셨나요?
(이하 3-1 과 동일)
```

### 3-3. 영문 (이번 발송에는 미사용 — A·D 모두 `locale=ko`)

- Subject: **What made you stop?**

```
You put Marblo through real work for a couple of days, then stopped.

What made you stop?

One line is enough — just reply to this email. No form, no survey.

Reply and we'll add 3 months of Pro on top of whatever time you have left. No strings.

Above all — thank you for being a beta user and giving Marblo a try.

Thank you,
The Marblo team
```

### 감사 인사 (사장님 결재 4번)

사장님 원문: _"무엇보다 베타사용자로써 마블로를 사용해주셔서 감사합니다"_
→ 문법만 다듬어 **"무엇보다, 베타 사용자로서 마블로를 사용해 주셔서 감사합니다."**
로 넣었다. 위치는 **제안 뒤·서명 앞** — 첫머리에 두면 질문이 인사에 묻히고,
제안 앞에 두면 대가처럼 읽힌다. 순서까지 테스트로 고정했다.

### 제약 대조 (전부 테스트로 고정 — 41케이스)

| 사장님 제약              | 초안이 지킨 방식                         | 고정 수단                    |
| ------------------------ | ---------------------------------------- | ---------------------------- |
| 짧게                     | 본문 텍스트 약 250자                     | 500자 상한 테스트            |
| 핵심 질문 하나           | 제목·본문 모두 "무엇 때문에 멈추셨나요?" | 물음표 **정확히 1개** 테스트 |
| 제품 자랑·기능 나열 금지 | 제품 이야기 0줄                          | 금지어 목록 테스트           |
| 개선했다는 변명 금지     | 개선·업데이트 언급 0                     | 금지어 목록 테스트           |
| 설문 N문항 조건 금지     | "설문도, 양식도 없습니다"                | 조건 문구 테스트             |
| 한 줄 답장이면 Pro 3개월 | "답장 주시면 … 다른 조건은 없습니다"     | 테스트                       |
| **감사 인사 추가(신규)** | 서명 직전 1문장, 평서문                  | 문장·위치·제약유지 3테스트   |

---

## 4. ★그랜트 — 코드를 고쳐서 진짜 3개월이 되게 했다 (사장님 결재 1번)

초판에서 "코드 수정 없이 앵커만 바꾸면 된다"고 보고했으나, 그 방식은 운영자가
`founder_feedback` 문서의 `createdAt` 에 **미래 날짜를 심는** 편법이었다. 설문
타임라인이 오염되고 그 편법이 관례가 된다. 사장님이 "코드가 문면과 일치하게
만들라"고 하셨으므로 **정공법으로 고쳤다.**

### 4-1. 무엇이 문제였나

`upsertProSubscription` 은 `periodEnd = max(기존 만료일, targetEnd)` 다 —
**더하기가 아니라 채우기**. `targetEnd = now + 3개월` 로 주면:

| 코드 | 기존 만료일 | `now` 앵커 실효 | **이어붙이기 실효** | 부여 후 만료일 |
| ---- | ----------- | --------------: | ------------------: | -------------- |
| A    | 2026-08-29  |            86일 |            **92일** | 2026-11-29     |
| B    | 2026-12-24  |         **0일** |                90일 | 2027-03-24     |
| C    | 2026-09-07  |            78일 |                91일 | 2026-12-07     |
| D    | 2026-11-15  |         **9일** |            **92일** | 2027-02-15     |

D 에게 "3개월"이라 써놓고 **9일**을 주게 된다. 사장님이 짚으신 위험이 여기 있었다.

### 4-2. 무엇을 고쳤나

**(a) `upsertProSubscription` 에 이어붙이기 모드** — 선택 인자 `extendMonths`.
주면 `targetEnd` 를 무시하고 **트랜잭션 안에서** 앵커를 다시 잡는다:

```ts
const effectiveTarget =
  typeof extendMonths === "number"
    ? addMonths(
        new Date(resolveGrantAnchorMs(existingEnd?.getTime() ?? null, now)),
        extendMonths,
      )
    : targetEnd; // ← 미지정이면 기존 동작 그대로. 기존 호출부 전부 무변경.
```

앵커 = `max(기존 만료일, now)`. **왜 트랜잭션 안인가**: 호출부가 미리 계산해
넘기면 조회~부여 사이에 갱신이 끼어들 때 어긋난다. 그 창을 없앤다.
`resolveGrantAnchorMs` 는 `churnOutreach.ts` 에 있고 단위테스트가 붙어 있다 —
`index.ts` 가 그걸 **import** 하므로 문서·테스트·실제 부여가 같은 함수를 쓴다.

**(b) 전용 어드민 콜러블 `grantChurnInterviewPro({ email, months? })`**
답장은 이메일로 오므로 `founder_feedback` 문서가 없고, 기존 부여 진입점 3개
(`reviewFounderFeedback` / `markFounderInterviewed` / 텔레그램)는 전부 그 문서를
전제한다. 가짜 설문 문서를 만들게 하는 대신 전용 경로를 뒀다.

안전장치:

- `requireAdmin` — `ADMIN_UID` 단일 대조. **사장님 계정으로만** 호출된다.
- **결제 흔적(toss/paddle/portone)이 있으면 거부.** `founderGrant` 잔재로
  `isLivePaidSubscription` 가드가 우회되는 경로가 실재하므로 여기서 한 번 더 본다.
- `founders/{email}.churnInterviewProGrantedAt` 스탬프로 **멱등**. 같은 답장에 두 번
  주지 않는다.
- 응답에 이메일·uid 를 담지 않는다.
- 부여 reason 은 `churn_interview` — 회계·감사에서 이 캠페인을 식별한다.

**(c) 기존 파운더 설문 경로는 손대지 않았다.** 그쪽 문면은 의도적으로 "총
3개월까지"이고 두 캠페인의 약속이 다르다. `extendMonths` 미지정이면 동작이 한 톨도
바뀌지 않는다.

### 4-3. 검증

`v3/functions` 전체 타입체크(`tsc --noEmit -p tsconfig.json`) **에러 0**.
`npm run test:churn-outreach` **41/41 통과**. 기존 순수모듈 회귀도 통과
(grant-plan 12, marketing 47, beta-segments 14, admin-analytics 105).
그리고 dry-run 이 A·D 모두 **+92일**을 계산한다(6절 출력).

> ⚠️ **`grantChurnInterviewPro` 는 배포해야 쓸 수 있다.** 답장이 오기 전까지는
> 필요 없으므로 발송과 배포를 묶지 않는다. 배포 명령은 6-3 절.

---

## 5. 답장은 어디로 가고 누가 보는가

**받는 곳**: `Reply-To: team@marblo.app`(env 고정). 사장님 개인함이 아니다.

거기서 멈추면 보드에 안 남으므로 답장 1건당 아래를 **의무**로 한다.

| 단계 | 무엇을                                                                | 어디에                       | 누가        |
| ---- | --------------------------------------------------------------------- | ---------------------------- | ----------- |
| 1    | 답장 수신                                                             | `team@marblo.app`            | (자동)      |
| 2    | **이탈 사유 티켓 생성** — 원문 아닌 **요약**. 이메일·이름·회사명 제거 | 보드 `[리텐션] 이탈 사유 #N` | 오케        |
| 3    | 지급 승인                                                             | 티켓 activity                | 사장님      |
| 4    | 그랜트 부여 — `grantChurnInterviewPro({email})`                       | 콜러블                       | 사장님 계정 |
| 5    | 결과 기록 — `addedDays`, `proExpiresAt`                               | 같은 티켓 activity           | 오케        |
| 6    | 사유를 제품 티켓으로 승격                                             | 보드                         | 오케        |

- **"수신거부"라고만 온 답장은 즉시 처리한다** — `marketing_contacts` 의
  `unsubscribe.status` 를 `unsubscribed` 로 바꾸고 그 사람에게 다시 보내지 않는다.
  mailto 폴백을 쓰는 동안은 자동화가 없으므로 이게 사람의 책임이다.
- **2건이 다 모이면 사유를 한 장으로 묶는다** — 광고 판단의 입력은 개별 답장이
  아니라 패턴이어야 한다. 표본이 2라 "패턴"이라 부르기 민망하지만, 0보다는
  결정적으로 낫다.
- **PII 규칙**: 티켓·activity·PR 어디에도 이메일·uid·이름을 쓰지 않는다.

---

## 6. ★발송 명령 — 오케가 그대로 실행한다

> ★**에이전트는 이 명령을 실행하지 않았다.** `--send` 는 비가역 외부 행위다.

### 6-0. 사전 조건

| 항목                     | 상태                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `team@marblo.app` 인증   | ✅ 사장님 확인 (Resend verified sender)                                                   |
| `RESEND_API_KEY`         | ✅ 배포 함수 env 에 존재. 로컬은 셸 환경변수로 이미 잡혀 있다(dry-run 이 `set` 으로 확인) |
| `ADMIN_UID`              | ⚠️ 로컬 셸에는 없다 — 아래 명령이 배포 함수 env 에서 읽어 주입한다(**값 미출력**)         |
| `MARKETING_UNSUB_SECRET` | ❌ 프로덕션 미설정 → `mailto` 폴백 사용(2절 ⚠️)                                           |
| gcloud ADC               | ✅ `gcloud auth application-default print-access-token` 동작 확인                         |

`.env.marblo-2253d` 파일은 이 워크트리에 **없다**. 스크립트는 환경변수 → 파일 순으로
찾으므로 파일 없이도 동작한다.

### 6-1. dry-run (0통 발송 — 먼저 이걸로 대상을 눈으로 확인)

```bash
cd v3/functions
export ADMIN_UID="$(gcloud functions describe getCostSummary \
  --project=marblo-2253d --region=us-central1 --gen2 \
  --format='value(serviceConfig.environmentVariables.ADMIN_UID)')"
GCLOUD_PROJECT=marblo-2253d npm run outreach:churn -- --consent-basis=relationship
```

**실행 결과(2026-08-24, 그대로 붙임):**

```
=== 이탈 사유 청취 메일 dry-run(발송 0통) ===
project=marblo-2253d  env=.env.marblo-2253d
RESEND_API_KEY=set  ADMIN_UID=set  from=team@marblo.app  reply-to=team@marblo.app  unsubscribe=mailto 폴백(MARKETING_UNSUB_SECRET 미설정)
consent-basis=relationship  cooldown=365일  offer=3개월

[대상 산출] cost_logs 사용자 5명
  운영자 제외              : 1
  founders 문서 없음 제외  : 0
  후보                     : 4명
  ★발송 대상               : 2명
  제외 사유 분포           : {"marketing_consent_revoked":2,"still_active":2,"live_paid_subscriber":1}
  쿨다운 제외              : 0
  실효 연장 0일 제외       : 0

[발송 대상 상세] — uid 해시·마스킹 이메일만 (수신거부=mailto)
  2024e2ef  k***@gmail.com  locale=ko  segment=deep_churn  +92일 → 2026-11-29
  e0d54aa0  l***@naver.com  locale=ko  segment=light_trial  +92일 → 2027-02-15

[제외 상세]
  f624a23f  marketing_consent_revoked, still_active
  4dd697a8  marketing_consent_revoked, live_paid_subscriber, still_active
```

★확인할 것: **발송 대상 2명**, 해시가 `2024e2ef`(A)·`e0d54aa0`(D) 인지, 둘 다
`+92일` 인지. 다르면 **멈추고 보고**한다.

기본값(`--consent-basis` 생략)으로 돌리면 대상 0명이 나온다 — 그것도 정상이다
(2절). `--print-html` 을 붙이면 HTML 전문도 찍힌다. 미리보기 HTML 은
`v3/functions/.preview/churn-interview-{deep_churn,light_trial}.html` 에 저장된다.

### 6-2. 실발송 (★사장님 최종 GO 이후에만)

```bash
cd v3/functions
export ADMIN_UID="$(gcloud functions describe getCostSummary \
  --project=marblo-2253d --region=us-central1 --gen2 \
  --format='value(serviceConfig.environmentVariables.ADMIN_UID)')"
GCLOUD_PROJECT=marblo-2253d npm run outreach:churn -- \
  --consent-basis=relationship --send --confirm=SEND-CHURN-INTERVIEW-2026-08
```

- `--send` 만으로는 안 된다. `--confirm` 문구가 틀리면 즉시 중단한다(검증 완료).
- 성공한 건만 `founders/{docId}` 에 `churnInterviewEmailSentAt` 스탬프가 찍힌다 →
  **재실행해도 중복 발송되지 않는다**(쿨다운 365일). 실패 건은 스탬프가 없으므로
  그대로 재실행하면 재시도된다.
- 출력에 `✅ 2024e2ef 발송·스탬프 완료` 형태로 해시만 찍힌다.

**시한**: A 의 grant 가 **08-29 만료**다. 그 전에 나가는 게 좋다.

### 6-3. 답장이 온 뒤 — 그랜트 부여 (사장님 계정)

```bash
# 1) 콜러블 배포 (grantChurnInterviewPro 신규)
cd v3/functions
GCLOUD_PROJECT=marblo-2253d npx firebase deploy \
  --only functions:grantChurnInterviewPro --project marblo-2253d
```

```js
// 2) 사장님 계정으로 로그인한 클라이언트에서 호출
await firebase.functions().httpsCallable("grantChurnInterviewPro")({
  email: "<답장 보낸 분 이메일>", // months 생략 시 3
});
// → { ok, granted, alreadyGranted, proExpiresAt, addedDays, planType }
```

- `addedDays` 가 **90 이상**인지 확인한다. 아니면 멈추고 보고.
- 결제 흔적이 있으면 `failed-precondition` 으로 거부된다 — 정상 동작이다.
- 이미 부여된 사람은 `alreadyGranted: true` 로 조용히 통과한다(멱등).

---

## 7. 파생 발견 — 별도 티켓 필요 (이 티켓에서 고치지 않음)

### 7-1. P1 매출 누수 — 실결제자 재청구 영구 스킵

C 의 구독 문서에 과거 `founder_backfill`(07-17) 잔재로 `founderGrant: true` 가 남아
있다. `billing.ts` `selectDueForCharge` 첫 줄:

```ts
if (sub.founderGrant === true) return false;
```

**유효한 `portoneBillingKey` 와 monthly 주기가 있는데도 재청구 크론이 이 사람을
영구히 건너뛴다.** 08-07 첫 결제는 체크아웃 경로로 통과했지만 09-07 만료 이후
자동 갱신은 오지 않는다. 결과는 둘 다 사고다 — 무료 영구 사용(매출 누수) 또는
돈 낸 고객의 조용한 Pro 상실(신뢰 사고). `founderGrant == true` 34건 중 결제
흔적을 함께 가진 문서를 세면 전수 규모가 즉시 나온다.

### 7-2. `hasPaymentEvidence` 가 portone 을 보지 않는다

`index.ts` 의 `hasPaymentEvidence` 는 toss/paddle 만 본다. portone 결제자는
"결제 흔적 없음"으로 판정되어 `isLivePaidSubscription` 보호를 **전혀 못 받는다**.
7-1 과 겹쳐 C 는 두 겹으로 위험한 상태다.

이번 캠페인은 스크립트와 콜러블 **각각에서 portone 을 별도로 본다**(넓게 잡아
안전쪽으로). 근본 수정은 billing 전반의 부여·보존 판정을 바꾸므로 범위를 넘는다.

### 7-3. `MARKETING_UNSUB_SECRET` 프로덕션 미설정

`unsubscribeMarketingEmail` 함수 env 에도 없다. 즉 `marketingEmailDelivery()` 가
항상 `null` → **기존 파운더 설문 오퍼 캠페인도 List-Unsubscribe 없이 나가고 있다.**
이번 캠페인은 `mailto` 폴백으로 우회했지만, 대량 발송을 재개하기 전에 이 시크릿을
설정하고 `unsubscribeMarketingEmail` 을 재배포해야 한다.

---

## 8. 이번 변경분

| 파일                                          | 내용                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/churnOutreach.ts`                        | 순수 로직. 적격 판정(`churnBlockReasons`+`ConsentBasis`) · 대상 선정(`selectChurnAudience`) · 그랜트 실효기간(`projectGrant`/`resolveGrantAnchorMs`) · 메일 문안. IO 0 |
| `src/churnOutreach.test.ts`                   | `node --test` **41케이스**                                                                                                                                             |
| `src/index.ts`                                | `upsertProSubscription` 이어붙이기 모드(선택 인자) + 콜러블 `grantChurnInterviewPro` + portone 결제 흔적 판정                                                          |
| `scripts/send-churn-interview-emails.ts`      | 발송 스크립트. **기본 dry-run**, `--send`+`--confirm` 이중 게이트, 마스킹 출력, 스탬프 멱등                                                                            |
| `package.json`                                | `test:churn-outreach`, `outreach:churn`                                                                                                                                |
| `docs/churn-interview-outreach-2026-08-24.md` | 이 문서                                                                                                                                                                |

**검증**: 전체 타입체크 에러 0 · churn-outreach 41/41 · 기존 회귀 178케이스 통과 ·
dry-run 반복 실행(누적 발송 0통) · 게이트 오작동 검증(잘못된 confirm → 중단 확인).
GUI 검증 없음(`AGENTS.md` 준수). CI 정지로 로컬 검증만.
