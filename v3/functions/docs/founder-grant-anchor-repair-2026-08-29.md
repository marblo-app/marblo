# 미소비 grant 의 앵커를 가입 시점으로 — R1·R2 수리 리포트

티켓 `0fOIIVHEiQAVG3j85vIB` · 2026-08-29 · ★**실데이터 변경 0. 드라이런까지다.**
선행 조사: `docs/founder-grant-gap-2026-08-29.md` (#1308) · 관련: #1304 · #1305

---

## 0. 한 줄

**미소비 grant 는 이제 언제 가입하든 3개월을 온전히 받는다.**
그리고 부여를 못 했을 때는 **반드시 흔적이 남는다** — 이번 결함이 3개월간 안 보인
이유가 정확히 "로그도 안 남겨서"였다.

★**함수 배포 전에는 아무것도 바뀌지 않는다**(5절).

---

## 1. 고친 결함

`materializeFounderProGrantForUid` 는 창이 닫혔으면

```ts
if (!windowEnd || windowEnd <= new Date()) {
  return { granted: false, uid, windowEnd, skippedReason: "window_expired" };
}
```

로 **구독도, founders 흔적도, 로그도 남기지 않고** 돌아섰다. 결과:

> 선정 → 안내 메일 → 가입까지 걸린 시간이 베타 창보다 길면 접근권이 증발한다. 소리 없이.

그리고 우리는 그 사실을 어떤 로그로도 몰랐다.

---

## 2. 수리 — R1: 미소비 grant 의 앵커는 선정 시점이 아니라 부여(가입) 시점

판정 본체는 순수 함수다: `src/founderGrantGap.ts`
`resolveFounderGrantWindowAtMaterialization()`.

| 상태 | 창 |
| --- | --- |
| **미소비** | `max(기존 창, 부여시각 + FOUNDER_BETA_MONTHS=3)` |
| **소비 · 창 열림** | 기존 창 그대로 (`existing_window`) |
| **소비 · 창 닫힘** | 부여하지 않는다 — 단 **흔적을 남기고** 스킵 |
| 반려(`status==="rejected"`) / `accessGrantedAt` 없음 | 대상 아님 |

근거는 #1304 가 베타를 1→3 으로 올린 근거와 같다. **D30 을 재는 시점에 접근권이
살아 있어야 리텐션을 잰다**는 명제는 창의 시작이 **실제 사용 시작**일 때만 성립한다.
한 번도 접속하지 않은 사람에게 흘러간 달력 시간을 소비로 치는 건 사실과 다르다.

### 2.1 ★왜 `max` 인가 — 단순 교체가 아니다

앵커 이동이 **누구의 만료일도 앞당기지 않는다**를 코드 모양으로 보장한다. 설문
보상(`FOUNDER_PRO_MONTHS=5`)으로 창이 3개월보다 길게 열린 사람이 뒤늦게 이 경로를
타도 기간이 깎이지 않는다. `upsertProSubscription` 의 `periodEnd = max(기존, target)`
과 같은 방향이다. 드라이런이 선정자 전수로 이 불변식을 검사한다(4절).

### 2.2 ★"미소비" 의 판정 기준 — 증거 OR 3종

티켓의 제약이 "**이미 소비된 grant 의 앵커를 옮기지 마라**"다. 그래서 증거가
**하나라도** 있으면 소비로 본다(`isGrantConsumed`):

1. `founders.proSubscriptionUid` — materialize 성공 시에만 찍히는 스탬프
2. `founders.proSubscriptionGrantedAt` — ①과 같은 순간 찍히는 짝
3. `subscriptions/{uid}` 가 무료 grant 문서 — ★**만료·해지 포함**

③이 필요한 이유: 스탬프 없이 구독만 있는 문서가 실재한다(2026-07 백필 경로).
③을 안 보면 **만료된 소비 grant 가 재앵커로 부활한다** — 티켓이 금지한 바로 그
동작이다. 그래서 materialize 는 판정 전에 `subscriptions/{uid}` 를 1회 읽는다
(가입·선정 순간에만 타는 경로라 비용 문제가 아니다).
오판 방향은 **항상 "옮기지 않음"** 쪽으로 떨어진다.

### 2.3 ★반려 게이트를 명시적으로 넣었다

`revokeFounderGrant` 는 `status="rejected"` 와 `betaExpiresAt=now`(즉시만료)로
**이중으로** 막는다. 재앵커는 "창이 닫혀도 부여한다"는 뜻이라 **만료가 더 이상
장벽이 아니다.** 그 한 겹이 사라지므로 `status==="rejected"` 게이트를 판정 함수
안에 명시했고 테스트로 못 박았다.

### 2.4 정상 선정에서 재앵커 로그가 뜨지 않게 — 앵커 기준 시각

판정은 `Date.now()` 가 아니라 **부여 시각**(`grantStartedAt`)을 받는다.
`markFounderSelectedInternal` 은 `betaExpiresAt = betaStartedAt + 3개월` 로 잡고
같은 `betaStartedAt` 을 `grantStartedAt` 으로 넘기므로 두 값이 **정확히 같아져**
`existing_window` 로 떨어진다. `Date.now()` 를 따로 읽으면 몇 밀리초 차이로 정상
선정마다 재앵커 로그가 쌓인다.

---

## 3. 수리 — R2: 조용한 스킵을 없앴다

> 관측 가능성이 수리의 절반이다. 다음 사고는 다른 이유로 같은 자리에서 조용히
> 실패할 것이다.

**스킵할 때마다**(`window_expired` · `not_selected` · `no_window` · `live_paid`):

- `console.warn("[materializeFounderProGrant] ★부여 스킵 — reason=… uid=… windowEnd=…")`
- `founders/{email}` 스탬프: `lastGrantSkippedReason` / `lastGrantSkippedAt` /
  `lastGrantSkippedUid` / `lastGrantSkippedWindowEnd`

★`live_paid`(현역 유료라 정상 스킵)도 남긴다 — 정상이라도 "왜 grant 가 안 붙었나"를
나중에 물었을 때 답이 있어야 한다.

**부여에 성공하면** 스킵 흔적을 `FieldValue.delete()` 로 지운다. 남겨 두면 운영자가
"아직 못 받았다"로 읽는다 — 스탬프는 **현재 상태**를 뜻해야 한다.

**재앵커했으면** 감사 흔적을 남긴다: `grantWindowReanchoredAt` /
`grantWindowReanchoredFrom` / `proSubscriptionWindowAnchor`, 그리고 `console.log`.
동시에 `founders.betaExpiresAt` 을 새 창으로 동기화한다 — 구독은 11-29 까지인데
founders 가 08-14 만료로 남아 있으면 어드민 목록과 `getMyFounderAccess` 가 서로
다른 사실을 말하고, 다음 호출이 옛 값을 다시 읽는다.

PII: 이메일(=founders doc id)은 로그에 찍지 않는다. uid 와 시각만 남긴다.

---

## 4. 실측 — 드라이런 (READ-ONLY · `--apply` 없음)

```
GCLOUD_PROJECT=marblo-2253d npm run dryrun:founder-grant-gap
```

⑥절이 배포본과 **같은 함수**를 태워 수리 전/후를 나란히 찍는다.

| | 수리 전 | 수리 후 |
| --- | --- | --- |
| 부여 0 (조용한 스킵) | **18명** | 0명 |
| 잔여만 (7~15일) | 12명 | 0명 |
| ★**3개월(92일) 전액** | **0명** | **30명** |

계정 없는 30명 전원이 `signup_reanchor` → `2026-11-29`(92일)를 받는다.
07-14 선정자(창 08-14 마감, 수리 전 **부여 0**)와 08-13 선정자(수리 전 15일)가
**같은 3개월**을 받는다.

불변식 검사(선정자 전수):

- ★만료일이 앞당겨지는 사람: **0명**
- ★이미 소비한(grant 보유) 사람의 앵커가 옮겨지는 건: **0명**

---

## 5. ★배포가 필요하다

이 수리는 **Cloud Functions 코드**다. `grantBetaProOnSignup`(auth onCreate)과
`markFounderSelected` 가 배포돼야 산다.

```
cd v3/functions && npm run deploy   # firebase deploy --only functions --project marblo-2253d
```

★**배포 전에 #1305 메일을 보내면 그 메일은 여전히 거짓이다.** 순서:
**배포 → 확인 → #1305 발송.**

---

## 6. R3~R5 — 무엇을 함께 하고 무엇을 미뤘나

이 티켓이 여는 것은 **#1305 발송**이다. 거기에 필요한 만큼만 한다.

| | 판단 | 근거 |
| --- | --- | --- |
| **R1** 가입 시점 앵커 | ★**했다** | 티켓의 본체. 이게 없으면 30명이 가입해도 0이다. |
| **R2** 스킵 관측 가능성 | ★**했다** | 티켓이 "반드시 지킬 것"으로 명시. R1 을 넣어도 따로 필요하다 — **조용히 실패한다가 이 사고의 본체**다. |
| **R3** 미부여 수렴 크론 | **미룬다** | 이 칸(`account_no_grant_window_open`)은 실측 **0**이고, R1 이 이 크론이 잡을 실패 부류를 **구조적으로 제거**한다. 새 스케줄 함수는 배포 표면을 넓히는데 #1305 발송에 필요하지 않다. ★그리고 R2 가 이제 눈을 만들어 줬다 — 이 칸이 다시 차면 `lastGrantSkippedReason` 으로 **보인다**. 크론은 그 신호가 뜬 뒤에 붙이는 게 맞다. |
| **R4** KPI 술어를 `founderGrant` 로 | **미룬다** | 계측 정확도 문제(34 vs 35)이지 부여 동작이 아니다. 메일 발송을 막지 않고, 지표 코드는 이 티켓 scope 밖이다. |
| **R5** 선정 시 미부여를 어드민에 노출 | **미룬다** | 어드민 **UI** 변경이라 backend scope 밖(`v3/src/components/` 수정 금지). ★단 백엔드 재료는 이 티켓이 이미 깔았다 — `lastGrantSkipped*` 스탬프와 `subscriptionGranted`/`windowAnchor` 를 UI 가 읽기만 하면 된다. |

---

## 7. 남은 판단 — #1305 와의 관계

#1308 문서 5절의 결론이 이 수리로 **자동 해소된다**:

> 계정 X 30명에게 `accessGrantedAt + 3개월` 앵커는 과소 부여다. 이 차이는 R1 을
> 넣으면 자동으로 해소된다 — 창을 미리 늘리지 않고 가입 시점에 3개월을 주면 되기
> 때문이다.

즉 #1305 의 `send-beta-retro-extend.ts` 가 계정 X 30명의 `betaExpiresAt` 을 미리
열어 두지 않아도, **가입하는 순간 3개월이 붙는다.** 미리 여는 것 자체는 해롭지
않다(`max` 라서 줄지 않는다). 다만 그 스크립트가 여는 창(`accessGrantedAt + 3개월`
→ 10-14 ~ 11-13)보다 재앵커 값(가입 시점 + 3개월)이 항상 크거나 같으므로,
**실제 부여는 재앵커 값을 따른다.**

★이 티켓은 실데이터를 바꾸지 않았다. 30명의 문서는 배포 후 그들이 **가입할 때**
바뀐다.
