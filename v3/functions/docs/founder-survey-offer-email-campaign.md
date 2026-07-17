# 베타 유저 설문요청 이메일 캠페인 — 초안 검토 (사장님 승인용)

티켓: `AuSzaCwl4oAoegj0oqkN`
관련: PR#466(설문→연장 백엔드·인앱팝업), PR#467(미활성 팔로업)

> ★이 캠페인은 **새 설문을 만들지 않는다.** 이미 marblo-web 에 라이브인
> `/{locale}/beta-survey` (V2 7문항 성실설문, `submitFounderFeedback` 제출)
> 로 유도하는 **이메일**만 새로 붙인다. 연장 백엔드도 기존
> `submitFounderFeedback → reviewFounderFeedback` 경로를 재사용한다.

---

## 1. 발송 대상 세그먼트

콜러블 `previewFounderSurveyOffer` (관리자·기본 dry-run)가 `founders` 컬렉션을
스캔해 아래 기준으로 산출한다.

| 세그먼트                 | 조건                                                                                                                            | 이 캠페인                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **audience (발송 대상)** | 선정(`accessGrantedAt`) · 미반려 · **계정연결**(`proSubscriptionUid`) · **설문 미회신**(`feedbackSubmittedAt` 없음) · 쿨다운 밖 | ✅ 발송                                                                    |
| alreadySubmitted         | 이미 설문 회신                                                                                                                  | ❌ 제외                                                                    |
| noAccountNotSubmitted    | 선정·미회신이나 **계정 미연결**(미가입)                                                                                         | ❌ 제외 → 미활성 팔로업(`sendFounderFollowupEmails`, 티켓 WjGoowu…)이 담당 |
| cooledDown               | 최근 14일 내 이미 설문오퍼 발송                                                                                                 | ❌ 제외(중복 방지)                                                         |

즉 **"가입해서 앱을 쓰는데 아직 설문만 안 낸"** 활성 유저가 대상이다. 파운더
팔로업의 ④(미가입)과 audience 가 겹치지 않는다.

**대상자 수 리포트**는 dry-run 응답에 집계로 나온다(PII 원문 없음):
`counts.{scanned, selectedNotRejected, alreadySubmitted, audience, noAccountNotSubmitted, cooledDown}`,
`localeBreakdown`, `domainBreakdown`(도메인별 개수), `sampleMasked`(마스킹 표본 최대 10건).

> 실제 대상자 수는 프로덕션 `founders` 컬렉션에서 dry-run 을 1회 실행해야 나온다
> (배포 후 `previewFounderSurveyOffer({})` 호출). 코드 리뷰 단계에서는 미실행.

---

## 2. 이메일 본문 초안 (ko/en/ja) — 발신·답장 `team@marblo.app`

설문 링크 = `https://marblo.app/{수신자 locale}/beta-survey` (기존 폼, 새 URL 아님).
오퍼 = **성실 7문항 회신 → 운영자 검토(reviewFounderFeedback) 후 Pro 최대 3개월 무료.**

### 한국어 (기본)

- 제목: `마블로 베타 설문 — Pro 최대 3개월`
- 본문:
  > 5분이면 Pro 최대 3개월
  >
  > 마블로 베타를 사용해 주셔서 감사합니다. 준비되시면 7문항 성실 설문으로 사용 경험을 들려주세요.
  >
  > [설문 회신하기 →] https://marblo.app/ko/beta-survey
  >
  > 루브릭 검토를 통과한 응답에는 Pro 3개월을 무료로 드립니다. 제출만으로 자동 지급되지는 않으며, 현재 결제 중인 구독은 절대 영향받지 않습니다.

### English

- Subject: `Your Marblo beta survey — up to 3 months of Pro`
- Body:
  > Got 5 minutes? Earn up to 3 months of Pro
  >
  > Thanks for trying the Marblo beta. When you're ready, please share a thoughtful 7-question survey about your experience.
  >
  > [Answer the survey →] https://marblo.app/en/beta-survey
  >
  > Responses that pass rubric review earn 3 months of Pro free. Submitting alone isn't an automatic grant, and any active paid subscription you have is never affected.

### 日本語

- 件名: `Marblo ベータアンケート — Pro 最大3ヶ月`
- 本文:
  > 5分でPro最大3ヶ月
  >
  > Marblo ベータのお試しありがとうございます。よろしければ、7問の誠実なアンケートで体験をお聞かせください。
  >
  > [アンケートに回答する →] https://marblo.app/ja/beta-survey
  >
  > ルーブリック審査を通過した回答には Pro 3ヶ月無料を付与します。提出だけで自動付与されるわけではなく、現在お支払い中のサブスクリプションには影響しません。

푸터: `Marblo · team@marblo.app` (3개 로케일 공통).

---

## 3. 설문 회신 → Pro 3개월 연장 (기존 경로 재사용, 신규 없음)

1. 유저가 이메일 링크로 `/beta-survey` 접속 → 7문항 제출 → `submitFounderFeedback`.
2. 운영자가 `reviewFounderFeedback` 로 루브릭 채점 → 통과 시
   `grantFounderProTotalInternal(uid, 3개월, "founder_survey_rubric")`.
3. `upsertProSubscription` 이 **현역 유료 구독(`isLivePaidSubscription`)은 절대
   덮어쓰지 않는다** — 트랜잭션 내 판정으로 결제↔grant race 에서도 stomp 없음.
   (cf memory `founder_grant_stomps_paymentprovider`)

→ 이번 PR 은 이 경로를 **바꾸지 않는다.** 연결·가드 유지만 확인(테스트 포함).

---

## 4. 발송 메커니즘 (오발송 이중 게이트 + 쿨다운)

`previewFounderSurveyOffer` (관리자 onCall):

- **기본 dry-run** — 대상 산출·집계만, 발송 0.
- **실발송은 이중 게이트 동시 충족 시에만**:
  `confirmSend === true` **AND** env `FOUNDER_SURVEY_EMAIL_SEND_ENABLED === "true"`.
  → 사장님 승인 전까지 env 를 켜지 않으면 절대 발송되지 않는다.
- **쿨다운 14일** — `surveyOfferEmailSentAt` 기준 최근 발송자 제외.
  의도적 재캠페인은 `ignoreCooldown: true` 로만 해제.
- 발송 성공분만 `surveyOfferEmailSent(+At)` 스탬프(중복 방지 근거).

---

## 5. ★사장님 결정 항목

- [ ] **발송 GO/타이밍**: 언제 보낼지(1주 내). 승인 시 env `FOUNDER_SURVEY_EMAIL_SEND_ENABLED=true` flip.
- [ ] **본문 문면**: 위 초안 그대로? 제목/CTA/할인문구 수정 원하면 지정.
- [ ] **쿨다운 14일** 적정 여부(팔로업은 7일).
- [ ] **team@marblo.app** 이 Resend(ESP) verified sender 로 등록됐는지 확인
      (미등록 시 실발송 HTTP 실패 → 발송 스킵). ⚠️ 발송 전 필수.
- [ ] 대상자 수 = 배포 후 dry-run 1회로 실측(리뷰 단계 미실행).

**실발송·env flip 은 이 초안 승인 후에만.** 배포 시 `GCLOUD_PROJECT=marblo-2253d` 필수.
