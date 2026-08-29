# 선정 65 vs 접근권 34 — 원인 규명과 근본 수리

티켓 `cw6lqyiFtspyx3LONt8y` · 2026-08-29 · 드라이런 실측 기반 (실데이터 변경 0)

재현: `GCLOUD_PROJECT=marblo-2253d npm run dryrun:founder-grant-gap`
(★`--apply` 플래그가 없는 읽기 전용 스크립트다.)

---

## 0. 한 줄

**갭은 31이 아니라 30이고, 30명 전원이 "한 번도 가입하지 않은 사람"이다.**
grant 부여 로직이 샌 게 아니다 — 애초에 grant 를 붙일 uid 가 없었다.
그래서 **되살리기로 풀리는 문제가 아니다.** 진짜 결함은 다른 곳에 있다(3절).

---

## 1. 실측 — 사다리 재현

`founders` 65건 전수 + Identity Toolkit + `subscriptions` 조인.

| 항목                                                    | 수     |
| ------------------------------------------------------- | ------ |
| 선정 (`accessGrantedAt` 존재 · 미반려)                  | **65** |
| grant 문서 — `founderGrant === true` 기준               | **35** |
| grant 문서 — `paymentProvider === "founder_grant"` 기준 | **34** |
| 그중 현재 유효 (active · 미만료)                        | 9      |

★**"34" 는 술어 선택의 결과다.** 두 술어가 1 만큼 갈리는 이유는 결제 웹훅이
`subscriptions.paymentProvider` 를 덮어쓰기 때문이다(`index.ts` L1492·1724·2949·
3253 …). grant 를 받은 뒤 유료로 전환한 1명은 provider 가 `toss`/`paddle` 로
바뀌어 34 에서 빠지지만, **접근권이 없는 게 아니라 돈을 내고 쓰고 있다.**

→ 되살릴 대상을 세는 올바른 술어는 `founderGrant` 플래그이고, **실제 갭은 30**이다.

---

## 2. 원인 — 가설을 하나씩 데이터로 확인했다

진단 칸은 **상호배타**로 설계했다(합 = founders 전체 65). 겹치는 분류를 만들면
"대충 이런 이유들"이 되어 우선순위를 못 정한다.

| 진단                                              | 수     | 판정             |
| ------------------------------------------------- | ------ | ---------------- |
| `grant_present` — grant 문서 있음                 | 35     | 갭 아님          |
| **`no_account` — 계정 자체가 없다**               | **30** | ★**확인된 원인** |
| `paid_live` — 유료라 마커만 없음                  | 0      | 반증             |
| `signup_after_window` — 가입했으나 창이 닫혀 스킵 | 0      | 반증             |
| `account_no_grant_window_open` — 조용한 실패      | **0**  | 반증             |
| `account_no_grant_unknown_signup` — 미상          | **0**  | 미확인 잔여 없음 |
| `not_selected`                                    | 0      | —                |

**갭 30 = 계정 없음 30. 100%. 미확인 잔여 0명.**

티켓이 나열한 나머지 가설은 전부 0으로 반증됐다:

- ❌ "grant 부여 코드가 특정 시점 이후에만 있다" → `account_no_grant_window_open` 0
- ❌ "부여가 조용히 실패했다(권한·예외·룰)" → 같은 칸 0
- ❌ "이메일은 갔는데 링크를 안 눌렀다" → **부분 반증**. `founders.accessEmailSent`
  실측 **발송 O 30 / 실패 0 / 기록 없음 0**. 메일은 30명 전원에게 **나갔다.**
  안 나간 게 아니라, 나갔는데 30명 전원이 가입까지 오지 않았다.

### 2.1 선례와의 관계 — "grant 미부여 갭"은 이번엔 재발한 게 아니다

`index.ts` L5906~ 에 예전 관측이 그대로 남아 있다("~35 선정 vs 활성 11"). 그때의
처방이 `scripts/backfill-founder-pro-grants.mjs`(PR#468, 2026-07-17 라이브 실행)였고,
같은 주석이 결과를 기록해 뒀다 — **"③(계정 O·구독 미부여)은 전원 materialize 됨,
실측 ③=0"**.

이번 실측에서도 그 칸(`account_no_grant_window_open`)은 **여전히 0**이다.
→ ★**materialization 갭은 재발하지 않았다.** 이번 30은 그때의 "12 grant 미부여"가
아니라 그때의 **"12 계정 없음"과 같은 종류**다. 백필로 고칠 수 있는 문제가 아니다.

---

## 3. ★그래도 실재하는 구조적 결함 — 여기가 진짜다

계정이 없어서 grant 가 없는 것 자체는 설계상 불가피하다(uid 없이 `subscriptions/{uid}`
를 못 만든다). **결함은 그 사람이 나중에 가입했을 때 벌어진다.**

부여가 일어나는 순간은 딱 두 번뿐이다:

1. `markFounderSelectedInternal` — 선정 시점에 uid 가 있으면 즉시 부여.
   **uid 가 없으면 아무 일도 하지 않는다.**
2. `grantBetaProOnSignup` (auth `onCreate`) — 가입하는 순간 뒤늦게 부여.

그리고 **재시도·수렴 경로가 없다.** 만료 스윕(`scheduledExpireBetaGrants`)은 있는데
미부여 수렴 크론은 없다.

두 경로 모두 `materializeFounderProGrantForUid` 를 통과하고, 거기에 조용한 게이트가 있다:

```ts
const windowEnd = resolveFounderGrantWindowEnd(founder);
if (!windowEnd || windowEnd <= new Date()) {
  return { granted: false, uid, windowEnd, skippedReason: "window_expired" };
}
```

이 경로는 **구독을 만들지 않고, founders 문서에 흔적도 안 남기고, 로그조차 남기지
않는다.** 게다가 `betaExpiresAt` 이 없는 legacy 문서의 창은
`accessGrantedAt + FOUNDER_LEGACY_BETA_MONTHS(=1)` 로 재구성된다.

### 결함의 실체

> **선정 → 안내 메일 → 가입까지 걸린 시간이 베타 창보다 길면 접근권이 증발한다.
> 소리 없이.**

실측이 이걸 그대로 보여준다 — 30명의 창:

| 선정일             | 창 종료            | 인원   | 지금 가입하면          |
| ------------------ | ------------------ | ------ | ---------------------- |
| 2026-07-14 ~ 07-26 | 2026-08-14 ~ 08-26 | **18** | ★**부여 0** (창 닫힘)  |
| 2026-08-05 ~ 08-13 | 2026-09-05 ~ 09-13 | 12     | 부여됨 (단 잔여기간만) |

18명은 **오늘 다운로드하고 가입해도 Pro 가 안 붙는다.** 그리고 우리는 그 사실을
어떤 로그로도 모른다. 12명도 2주 뒤면 같은 상태가 된다.

★그래서 **창을 열지 않고 "가입하세요" 메일만 보내면 그 메일은 거짓이 된다.**
(#1305 가 `betaRetroExtend.ts` 머리주석에 이미 적어 둔 함정과 동일하다.)

---

## 4. ★근본 수리 제안 — 되살리기보다 이게 오래 남는다

우선순위 순. 전부 이 티켓 범위 밖(별도 티켓)이며, 여기서는 제안만 한다.

### R1. 미소비 grant 의 앵커를 **가입 시점**으로 (P0 · 결함 제거)

`materializeFounderProGrantForUid` 가 `windowEnd <= now` 로 스킵하는 대신,
**아직 한 번도 부여된 적 없는 선정자**(`founders.proSubscriptionUid` 없음)에게는
`now + FOUNDER_BETA_MONTHS` 로 부여한다.

근거: 베타 3개월의 목적은 "3개월간 써 보게 하는 것"이다(#1304: D30 을 재는 시점에
접근권이 살아 있어야 리텐션을 잰다). **한 번도 접속하지 않은 사람에게 흘러간
달력 시간을 소비로 치는 건 사실과 다르다.** 이미 부여받아 쓴 사람의 창은
그대로 둔다(소급 연장은 #1305 의 판단 사안이지 여기서 섞을 일이 아니다).

이것 하나로 "선정했는데 늦게 와서 못 쓰는" 부류가 **구조적으로 사라진다.**
백필은 과거를 청소할 뿐이고, 이건 미래를 막는다.

### R2. `window_expired` 스킵을 **관측 가능**하게 (P0 · 지금은 눈이 없다)

지금 이 스킵은 로그도 흔적도 없다. 최소한:

- `console.warn("[materializeFounderProGrant] window_expired", uid, windowEnd)`
- `founders/{email}` 에 `lastGrantSkippedReason` / `lastGrantSkippedAt` 스탬프

★R1 을 넣어도 R2 는 따로 필요하다. **"조용히 실패한다"가 이 사고의 본체**이고,
다음 사고는 다른 이유로 같은 자리에서 조용히 실패할 것이다.

### R3. 미부여 수렴 크론 (P1 · 두 순간을 놓쳐도 수렴하게)

`scheduledExpireBetaGrants` 와 대칭으로, 선정자 중 계정 O · grant 없음 · 창 열림인
사람을 매일 스윕해 부여한다. 7월 백필(PR#468)이 **수동으로 한 일**을 자동화하는 것이다.
멱등은 이미 `upsertProSubscription` 이 보장한다(기간을 줄이지 않음).
지금 이 칸은 0이지만, 0인 걸 **아무도 감시하지 않고 있다**는 게 문제다.

### R4. KPI 사다리의 술어를 `founderGrant` 플래그로 (P1 · 계측 정확도)

"접근권 부여 34"는 `paymentProvider` 문자열로 센 값이라 유료 전환자를 잃는다.
`founderGrant === true` 로 바꾸면 35 가 되고, 갭이 31 → 30 으로 정직해진다.
(`grantPlan.ts` / `releaseUpdateAnnouncement.ts` 는 이미 두 술어를 OR 로 본다 —
KPI만 좁다.)

### R5. 선정 시점의 미부여를 운영자에게 노출 (P2)

`markFounderSelectedInternal` 은 이미 `subscriptionGranted: false` 를 돌려주는데,
어드민 UI 가 이걸 눈에 띄게 쓰지 않는다. "선정했지만 아직 계정이 없어 부여 대기"
상태가 보이면 이 갭은 30까지 자라기 전에 보인다.

---

## 5. 되살리기 — ★별도 실행을 **권하지 않는다**

교집합 검증 결과(sha256 해시 비교, 두 드라이런 동시 실행):

|                              | 인원 | 교집합 | 차집합 |
| ---------------------------- | ---- | ------ | ------ |
| 이 티켓의 `open_window` 대상 | 30   | **30** | **0**  |
| #1305 의 "되살아남 · 계정 X" | 30   | **30** | **0**  |

★**완전히 같은 30명이다.**

#1305(`scripts/send-beta-retro-extend.ts`)는 이미 머지됐고, 이 30명에 대해
`founders.betaExpiresAt` 을 열고 계정 X 전용 문면으로 메일을 보내도록 되어 있다.
여기서 새 마커(`grant_backfill_selected_gap_2026_08`)로 또 돌리면:

- 같은 사람에게 마커가 둘 박혀 **코호트 분리가 오히려 망가진다** (마커의 존재 이유가 무너짐)
- `founders.betaExpiresAt` 을 두 스크립트가 서로 다른 값으로 덮어쓴다
  (#1305 = `accessGrantedAt + 3개월` → 10-14 ~ 11-13 / 이 티켓 = `now + 3개월` → 11-29)

**권고: 이 티켓에서 별도 백필을 실행하지 않는다. #1305 의 실행본이 이 30명을 처리한다.**

다만 앵커에 대한 판단은 남긴다 — **`now + 3개월` 이 더 옳다.** 이 30명은 접근권을
단 하루도 소비하지 않았고, `accessGrantedAt` 앵커는 소비하지 않은 기간을 소비한
것으로 친다. #1305 의 앵커는 "쓰다가 끊긴 26명"에 맞춘 값이라 계정 X 30명에게는
과소 부여다. 이 차이는 R1 을 넣으면 **자동으로 해소된다** — 창을 미리 늘리지 않고
가입 시점에 3개월을 주면 되기 때문이다.

→ **결론: 되살리기 대신 R1 을 넣는 것이 이 30명에게도 더 정확하고, 다음 선정자에게도 유효하다.**

### 그래도 실행해야 한다면 (승인 시)

- 마커: `subscriptions.founderGrantReason == "grant_backfill_selected_gap_2026_08"`
- 멱등 스탬프: `founders.selectedGapBackfillAppliedAt`
- 2차 게이트: `--apply --confirm=APPLY-GRANT-BACKFILL-SELECTED-GAP-2026-08`
- 회수: 마커로 조회 → `status="canceled"`, `currentPeriodEnd=now`
  (`markFounderRejected` 의 grant 회수 경로와 같은 모양)
- 보호 규칙은 `planGrantBackfill` 이 `upsertProSubscription` 을 그대로 복제한다:
  현역 유료 미덮어쓰기 · 기간 축소 없음 · `paymentProvider` 보존 · 강등 금지
- 부여 플랜은 `team` (`TEAM_GRANT_REASONS` 에 마커 등록 완료). 등록하지 않으면
  이 코호트만 `pro` 로 부여돼 협업 기능이 안 열린다.

---

## 6. 안내 메일 — 후속 티켓 제안

이 티켓에서 만들지 않았다(지시대로).

**#1305 인프라는 재사용 가능하다.** `betaRetroExtend.ts` 는 이미 코호트를
`account` / `no_account` 로 가르고 문면·수신동의 근거를 분리해 두었으며,
이 30명은 그 `no_account` 문면의 **정확한 대상**이다.

다만 ★**처지가 다르다는 지적은 유효하고, #1305 의 no_account 문면으로도 아직 부족하다.**

- #1305 no_account 문면의 전제: "베타 창이 3개월로 바뀌었다" — 여전히 _연장_ 서사다.
- 이 30명의 실제 상태: **선정 안내 메일을 받았고(30/30 발송 확인), 그런데 한 번도
  안 왔다.** 이들에게 필요한 건 "기간이 늘었다"가 아니라 **"왜 안 왔는가"에 답하는
  문면**이다 — 다운로드 장벽, 첫 5분의 가치, 설치 없이 볼 수 있는 것.

→ 후속 티켓 제안: **"한 번도 안 온 선정자 30명 — 재유입 문면 A/B"**.
`betaRetroExtend.ts` 의 발송·동의·멱등 인프라를 재사용하되 `no_account` 문면을
이 코호트용으로 다시 쓴다. 수신동의 근거는 #1305 판단(`granted_only` — 가입 이력이
없어 거래관계가 없다)을 그대로 승계한다.

★그리고 그 메일은 **R1 이 들어간 뒤에** 보내야 한다. 18명은 지금 가입해도 부여가
0이므로, 그 전에 보내면 메일이 거짓이 된다.
