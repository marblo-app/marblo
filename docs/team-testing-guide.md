# 팀 기능 수동 테스트 가이드 (2계정 초대·협업)

작성 2026-08-01 · 티켓 `1V6tMtUUnWHrF1Nh8iSz` · **private repo 전용**

두 계정(A=존킴, B=datagadapida)을 team 플랜으로 그랜트하고, 초대→수락→멤버편입→팀채팅→공유보드를
사람이 직접 밟는 체크리스트다. 각 단계에 **무엇을 확인하는지**를 적었다.

> ★먼저 [§2 시작 전 반드시 읽을 것](#2-시작-전-반드시-읽을-것--막히는-지점-4곳)을 보고 시작해라.
> 초대 **수락** 경로는 현재 코드/배포 룰에서 UI 로 완주할 수 없다. 우회 절차가 §4 Step 3 에 있다.

---

## 1. 그랜트 결과 (2026-08-01 적용 완료)

### 1.1 무엇을 왜 바꿨나

앱의 팀 기능 게이트는 `subscriptions/{uid}.planType` 하나로 결정된다(실측 경로는 §6).
`team` 세트에만 `team_members` 가 들어 있어서(`v3/src/lib/planLimits.ts:112`), planType 이 `pro` 인 동안은
Settings → 팀 탭이 PlanGate 업그레이드 화면으로 막힌다. 그래서 **planType 만** `pro` → `team` 으로 올렸다.

| 계정             | uid                            | 변경                                                                |
| ---------------- | ------------------------------ | ------------------------------------------------------------------- |
| A = 존킴         | `RSALO1rljtWBSZ70MoBiaeFORxr1` | `planType: pro → team`                                              |
| B = datagadapida | `03BR5dm7SqgXS7uxNyorxbHTrV72` | `planType: pro → team`, `currentPeriodEnd: 2026-08-03 → 2026-11-01` |

- 두 계정 모두 Firebase Auth 에 이미 존재하고 2026-08-01 09:32/09:33 에 로그인한 기록이 있다.
  (즉 "미로그인이라 그랜트 못 함" 케이스가 아니었다.)
- B 의 기존 `currentPeriodEnd` 가 **2026-08-03** 이라 이틀 뒤 `scheduledExpireBetaGrants`(매일 04:15 KST)
  에 `status: canceled` 로 내려갈 예정이었다. 테스트 도중 free 로 떨어지는 걸 막으려고 2026-11-01 로 연장했다.
- `status` / `paymentProvider` / `founderGrant` / `founderGrantReason` 은 **건드리지 않았다.**
  기존 founder_grant 정체성 그대로다(갱신 크론은 `paymentProvider=="toss"` 만 대상이라 과금 영향 없음).
- **다른 uid 는 하나도 변경하지 않았다.** 실결제·과금 변경 없음.

### 1.2 검증 결과

라이브 Firestore 값을 **실제 앱 판정 코드**(`v3/src/lib/entitlement.ts` + `v3/src/lib/planLimits.ts`)에
그대로 통과시켜 확인:

```
PASS johnkim:      resolvedPlan=team canUse(team_members)=true hasTeamCollab=true
PASS datagadapida: resolvedPlan=team canUse(team_members)=true hasTeamCollab=true
```

`subscriptionStore` 는 실시간 리스너(`subscribeToDocument`)라 **앱 재시작 없이** 반영된다.
다만 "Settings → 팀 탭에 초대 폼이 실제로 뜨는가"의 육안 확인은 사장님 계정으로 로그인해야 하므로
아래 Step 1 에서 확인한다(이 문서 작성 시점엔 미확인).

### 1.3 롤백 (원상복구)

변경 직전 두 문서의 **원본 전체**다. 되돌릴 때 이 값 그대로 쓰면 된다.

```json
{
  "johnkim": {
    "uid": "RSALO1rljtWBSZ70MoBiaeFORxr1",
    "updateTime_before": "2026-07-14T09:59:55.716978Z",
    "fields": {
      "userId": "RSALO1rljtWBSZ70MoBiaeFORxr1",
      "planType": "pro",
      "status": "active",
      "paymentProvider": "founder_grant",
      "founderGrant": true,
      "founderGrantReason": "beta_selected",
      "founderGrantStartedAt": "2026-07-14T09:59:52.532Z",
      "currentPeriodStart": "2026-03-25T00:00:00Z",
      "currentPeriodEnd": "2027-03-25T00:00:00Z",
      "createdAt": "2026-03-25T00:00:00Z",
      "updatedAt": "2026-07-14T09:59:55.706Z"
    }
  },
  "datagadapida": {
    "uid": "03BR5dm7SqgXS7uxNyorxbHTrV72",
    "updateTime_before": "2026-07-17T06:17:28.589454Z",
    "fields": {
      "userId": "03BR5dm7SqgXS7uxNyorxbHTrV72",
      "planType": "pro",
      "status": "active",
      "paymentProvider": "founder_grant",
      "founderGrant": true,
      "founderGrantReason": "founder_backfill",
      "founderGrantStartedAt": "2026-07-17T06:17:28.576Z",
      "currentPeriodStart": "2026-07-17T06:17:28.576Z",
      "currentPeriodEnd": "2026-08-03T00:33:08.094Z",
      "updatedAt": "2026-07-17T06:17:28.576Z"
    }
  }
}
```

롤백 명령은 §7 부록 A 의 `grant.py` 에 `--rollback` 으로 들어 있다.

### 1.4 이 그랜트가 저절로 풀리는 두 경우

1. `currentPeriodEnd` 경과 → `scheduledExpireBetaGrants`(매일 04:15 KST)가 `status: canceled` 로 내림
   → 앱 플랜이 free 로 떨어진다. (A=2027-03-25, B=2026-11-01)
2. 어드민이 이 이메일로 파운더 선정/재선정(`markFounderSelected`)을 다시 돌리면
   `upsertProSubscription` 이 `planType: "pro"` 로 **덮어쓴다** → 팀 탭이 다시 잠긴다.
   그 경우 §7 부록 A 를 다시 실행하면 된다.
   (정기 결제 리컨사일 `reconcileTossPending/PaddlePending` 은 toss/paddle 만 보므로 이 문서와 무관.)

---

## 2. 시작 전 반드시 읽을 것 — 막히는 지점 4곳

코드와 **배포된** Firestore 룰(2026-07-22 릴리즈, repo `v3/firestore.rules` 와 바이트 동일)을 실측해서
찾은 결함이다. 전부 이 티켓 범위 밖이라 **고치지 않았다.** 테스트 중 "버그다" 하고 놀라지 않도록 먼저 적는다.

| #      | 증상                                                             | 진짜 원인                                                                                                                              | 이 가이드의 대응                   |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **B1** | B 화면 어디에도 "초대를 수락" UI 가 없다                         | `InvitationBanner.tsx` 가 **어느 화면에도 마운트되어 있지 않다** (import 하는 곳 0곳)                                                  | Step 3 에서 관리자 스크립트로 우회 |
| **B2** | (UI 가 있었어도) B 가 수락을 누르면 permission-denied            | 배포 룰의 `projects` update 조건이 `isProjectMember` — **아직 멤버가 아닌 사람이 자기를 members 에 넣는 걸 룰이 막는다**               | Step 3 에서 관리자 스크립트로 우회 |
| **B3** | 협업 프레즌스(누가 접속 중인지)가 안 보인다                      | `presence/{projectId}/users/{uid}` 에 **룰 match 자체가 없어 기본 거부** + `PresenceIndicator` 도 미마운트. 프로덕션 presence 문서 0건 | Step 6 에서 대체 관측으로 확인     |
| **B4** | 새 채팅이 와도 사이드바 CHAT 탭 **미읽음 배지 숫자가 안 오른다** | `chatStore.incrementUnread` 를 **호출하는 코드가 0곳** (배지 렌더 코드만 있음)                                                         | Step 5 에서 토스트로 확인          |

즉 **초대 발행(A) → 채팅/보드 협업**은 실제로 테스트 가능하고,
**수락(B)** 만 UI 로 완주가 안 돼서 관리자 한 줄로 대신 밟는다.

---

## 3. 사전 준비

### 3.1 두 계정을 한 대에서 동시에 띄우기

두 계정이 **동시에 접속**해 있어야 채팅 왕복·토스트를 실시간으로 볼 수 있다.
앱에 single-instance 락이 없고(`requestSingleInstanceLock` 미사용) Electron 이 `--user-data-dir` 을 받으므로,
같은 맥에서 프로필을 갈라 두 번째 인스턴스를 띄울 수 있다.

```bash
# 창 1 (계정 A) — 평소처럼 Finder/Dock 에서 Marblo 실행

# 창 2 (계정 B) — 별도 프로필로 두 번째 인스턴스
/Applications/Marblo.app/Contents/MacOS/Marblo --user-data-dir=/tmp/marblo-profile-b
```

- 창 2 는 로그인 상태가 비어 있으므로 **B(datagadapida@gmail.com) 로 Google 로그인**한다.
- 맥이 두 대면 그냥 각각 로그인해도 된다(권장). 위 방법은 한 대일 때의 대안.
- **확인**: 두 창이 각각 다른 계정으로 로그인돼 있고, 우상단 프로필/설정의 이메일이 서로 다르다.

### 3.2 테스트용 프로젝트 하나 정하기

초대·협업은 **프로젝트 단위**다. 둘이 같은 프로젝트를 공유해야 채팅·보드가 보인다.

- 현재 A 는 프로젝트 16개를 갖고 있고 **전부 members 가 자기 1명뿐**이다. B 는 프로젝트가 0개다.
- 실제 작업 리포를 흔들지 않으려면 **테스트 전용 프로젝트를 새로 하나 만드는 걸 권장**한다
  (A 창에서 프로젝트 추가 → 아무 빈 폴더 지정).
- 정했으면 **projectId** 를 확보해 둔다. 뒤 단계에서 계속 쓴다.
  §7 부록 B 스니펫을 붙여 넣어 실행하면 `projectId | 이름 | 멤버수` 목록이 나온다.
- **확인**: A 창 좌상단 프로젝트 셀렉터에 그 프로젝트가 선택돼 있다.

---

## 4. 단계별 체크리스트

### Step 1 — A: 플랜이 TEAM 으로 열렸는지 (그랜트 육안 검증)

1. A 창에서 **Settings(설정)** 진입.
2. 제목 옆 플랜 배지를 본다.
3. 탭 목록에서 **팀** 탭 클릭.

**무엇을 확인**

- [ ] 배지가 **`TEAM`** (보라색)으로 표시된다. `PRO`(파랑)/`FREE`(회색)면 그랜트가 안 먹은 것.
- [ ] 팀 탭이 자물쇠 아이콘 + "업그레이드가 필요합니다" 화면이 **아니다**.
- [ ] **"멤버 초대"** 폼(이메일 입력칸 + 역할 셀렉트 + 초대 버튼)이 보인다.
- [ ] 아래에 "멤버 (1)" 목록이 있고 A 본인이 `Owner` 배지로 보인다.

> 배지가 아직 PRO 면: 앱을 재시작하지 말고 몇 초 기다려 본다(실시간 리스너).
> 그래도 안 바뀌면 로그아웃/로그인. 그것도 안 되면 그랜트가 풀린 것 → §1.4 참고.
> "프로젝트를 먼저 선택하세요"가 뜨면 프로젝트 미선택 상태다(§3.2).

### Step 2 — A: B 를 초대 발행

1. 팀 탭 **멤버 초대** 폼에 `datagadapida@gmail.com` 입력.
2. 역할은 **Member** 로 둔다(Admin/Viewer 도 테스트 가능하나 기본 경로부터).
3. **초대** 버튼 클릭.

**무엇을 확인**

- [ ] 에러 배너(빨강)가 뜨지 않는다.
- [ ] **"대기 중인 초대 (1)"** 섹션이 새로 나타나고 그 안에 `datagadapida@gmail.com` + `Member` 배지 + 생성일이 보인다.
- [ ] 입력칸이 비워졌다.
- [ ] (선택) 같은 이메일로 한 번 더 초대 → **"이미 초대된 사용자입니다"** 류 에러가 뜬다(중복 방지 동작).

> 여기까지가 룰상 정상 동작한다. `invitations` create 는 프로젝트 owner/admin 에게 허용돼 있다.

### Step 3 — B: 초대 수락 (★현재는 관리자 우회 필요)

**먼저 UI 를 확인한다** (결함 B1 재확인용, 30초):

- [ ] B 창 어디에도 "○○님이 △△ 프로젝트에 초대했습니다 / 수락 · 거절" 배너가 **뜨지 않는다.**
      → 예상된 결과다(B1: `InvitationBanner` 미마운트). 배너가 보인다면 그건 좋은 뉴스이니 눌러보고,
      permission-denied 가 나면 그게 B2 다.

**우회 — 관리자 권한으로 수락 처리** (§7 부록 A 의 `accept.py`):

```bash
python3 accept.py --project <projectId> --uid 03BR5dm7SqgXS7uxNyorxbHTrV72
```

이 스크립트가 하는 일은 앱의 `teamService.acceptInvitation` 과 **같다**
(초대 문서 `status: pending → accepted`, `projects/{id}.members` 에 B 의 uid 추가).
차이는 Admin 자격이라 룰(B2)에 막히지 않는다는 것뿐이다.

**무엇을 확인**

- [ ] 스크립트가 `invitation → accepted`, `members: [A, B]` 를 출력한다.
- [ ] **A 창** 팀 탭에서 "대기 중인 초대" 섹션이 사라진다.
- [ ] **B 창**에서 프로젝트 셀렉터를 열면 그 프로젝트가 **새로 보인다**
      (`projects` 목록 쿼리가 `members array-contains 내 uid` 라서 편입 즉시 등장).

### Step 4 — 멤버 목록에 B 가 들어왔는지

A 창 → Settings → 팀.

**무엇을 확인**

- [ ] 헤더가 **"멤버 (2)"** 로 바뀌었다.
- [ ] A 행: 이름/이메일 + `Owner` 배지 + "(나)" 표기.
- [ ] B 행: `Member` 역할 셀렉트가 보이고, A 는 그 역할을 바꿀 수 있다(Owner 로는 못 바꿈 — 룰이 막음).
- [ ] B 행에 **제거** 버튼이 있다(누르진 말고 존재만 확인 — 누르면 되돌리려면 Step 3 재실행).

> ⚠️ **알려진 표시 문제**: B 행의 **이름·이메일이 빈칸**으로 보이고 아바타가 `?` 로 뜰 수 있다.
> B 의 `users/{uid}` 문서에 `email`/`displayName` 필드가 없기 때문이다. 그리고 현재 앱 코드는
> 로그인 시 그 필드를 **쓰지 않는다**(users 컬렉션에 쓰는 곳은 privacy/marketing 동의와 heartbeat 뿐).
> 기능 결함이 아니라 표시 결함이고, 신경 쓰이면 §7 부록 C 한 줄로 채울 수 있다.

### Step 5 — 팀 채팅 왕복

두 창 모두 **같은 프로젝트를 선택**한 상태여야 한다(채팅은 `projectId` 스코프).

1. A 창: 좌측 사이드바 → **CHAT** 탭 → 메시지 입력 후 전송.
2. B 창을 본다.
3. 반대 방향으로도(B → A) 한 번.

**무엇을 확인**

- [ ] B 창 상단 가운데에 **토스트**가 뜬다: 보낸 사람 이름 + 메시지 요약 (약 3.6초 후 사라짐, 마우스 올리면 유지).
- [ ] B 창 사이드바 **CHAT** 탭을 열면 A 의 메시지가 목록에 있다(실시간, 새로고침 불필요).
- [ ] 자기가 보낸 메시지에는 자기 창에 토스트가 뜨지 **않는다**(본인 발신 필터).
- [ ] 반대 방향(B → A)도 동일하게 동작한다.
- [ ] ⚠️ **CHAT 탭 옆 빨간 미읽음 숫자 배지는 안 뜬다** — 결함 B4(`incrementUnread` 호출부 없음).
      토스트가 뜨면 전달 자체는 정상이다. 배지 미표시는 별도 티켓감.

### Step 6 — 프레즌스 (현재 관측 불가 + 대체 확인)

- [ ] B3 대로 **협업 프레즌스 UI 는 존재하지 않는다**(`PresenceIndicator` 미마운트, presence 룰 부재).
      "누가 지금 이 프로젝트에 접속 중" 표시를 찾지 말 것 — 없는 게 정상이다.
- **대체 관측** (실제로 동작하는 하트비트):
  - [ ] 보드에서 에이전트가 **claim 한 태스크 카드**에 소유자 온라인 표시가 뜬다
        (`users/{uid}.lastHeartbeatAt` 기반, `usePresence` → `TaskCard`).
  - [ ] 두 창을 모두 켠 채 몇 분 두면 두 계정의 `users/{uid}.lastHeartbeatAt` 이 갱신된다
        (§7 부록 B 스니펫으로 조회 가능).

### Step 7 — 공유 보드 / 협업

1. A 창: 그 프로젝트 보드에서 태스크 하나 생성.
2. B 창: 같은 프로젝트 보드를 연다.

**무엇을 확인**

- [ ] B 화면 보드에 A 가 만든 태스크가 **실시간으로** 나타난다.
- [ ] B 가 태스크 상태를 옮기면(TODO → IN_PROGRESS) A 화면에도 반영된다
      (`tasks` 룰: 프로젝트 멤버면 read/write 허용).
- [ ] B 가 태스크에 코멘트를 달면 A 에게 보인다(`taskComments`, 멤버 스코프).
- [ ] **크로스테넌트 확인(중요)**: B 창의 프로젝트 셀렉터에 **A 의 다른 15개 프로젝트는 안 보인다.**
      공유한 그 하나만 보여야 한다.

### Step 8 — 역할 권한 (선택)

1. A 창 팀 탭에서 B 의 역할을 **Viewer** 로 변경.
2. B 창을 새로고침(또는 프로젝트 재선택).

**무엇을 확인**

- [ ] B 는 여전히 보드를 **읽을** 수 있다.
- [ ] 앱 UI 상 쓰기 액션이 막히는지 확인한다.
      ⚠️ 단 **Firestore 룰은 `tasks` write 를 "프로젝트 멤버"까지만 검사하고 role 은 안 본다** —
      즉 Viewer 강등은 현재 UI 레벨 게이팅이고 서버 강제가 아니다. 룰로 막히길 기대하지 말 것.
- [ ] 확인 후 역할을 **Member** 로 되돌린다.

---

## 5. 테스트 후 정리

원상복구가 필요하면 아래 순서로:

1. **멤버 해제**: A 창 팀 탭 → B 행 **제거**. (또는 §7 부록 A `accept.py --undo`)
2. **남은 초대 정리**: 팀 탭 "대기 중인 초대"에서 취소.
3. **채팅 메시지**: `chatMessages` 는 룰상 클라이언트 삭제 불가(`allow delete: if false`). 남겨도 무방.
4. **테스트 프로젝트**: A 가 owner 이므로 앱에서 삭제 가능.
5. **플랜 그랜트**: 팀 기능을 계속 쓸 거면 그대로 둔다. 되돌리려면 §7 부록 A `grant.py --rollback`.
6. **두 번째 프로필**: `rm -rf /tmp/marblo-profile-b` (로그인 세션이 들어 있으니 정리 권장).

---

## 6. 부록 0 — 이 문서가 근거로 삼은 실측 경로

| 무엇        | 어디                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| 플랜 SoT    | `subscriptions/{uid}.planType` (문서 id = uid). `tier` 라는 필드는 없다                               |
| 플랜 판정   | `v3/src/lib/entitlement.ts` `resolveEntitledPlan(status, planType, currentPeriodEnd)`                 |
| 기능 세트   | `v3/src/lib/planLimits.ts` `PLAN_FEATURES` — `team` 에만 `team_members` 포함 (112행)                  |
| 게이트      | `v3/src/components/settings/SettingsPage.tsx:139` `<PlanGate feature="team_members">`                 |
| 실시간 반영 | `v3/src/stores/subscriptionStore.ts` `subscribeToSubscription` (앱 재시작 불필요)                     |
| 초대/수락   | `v3/src/services/teamService.ts` `createInvitation` / `acceptInvitation` → `projectService.addMember` |
| 멤버십      | `projects/{id}.members: string[]`                                                                     |
| 채팅        | `chatMessages` (projectId 스코프), 토스트 = `v3/src/components/chat/ChatToastHost.tsx`                |
| 배포 룰     | 릴리즈 `2026-07-22T09:03:36Z` — repo `v3/firestore.rules` 와 **바이트 동일** (REST 로 원본 대조함)    |

### #680(협업 E2E)이 커버한 경로 ↔ 이 수동 가이드 대응

`v3/tests/integration/team-collaboration.test.ts` + `v3/tests/playwright/cleanroom/team-collaboration.spec.ts`

| #680 자동 테스트                                      | 여기 대응 | 자동 테스트가 못 잡는 것                              |
| ----------------------------------------------------- | --------- | ----------------------------------------------------- |
| `createInvitation` → `getMyInvitations` 로 조회됨     | Step 2    | —                                                     |
| `acceptInvitation` → `project.members` 에 초대자 추가 | Step 3    | ★**실 룰(B2)** — 테스트는 인메모리 백엔드라 룰 미적용 |
| owner 채팅이 invitee 리스너에 도달                    | Step 5    | 토스트 UI, 미읽음 배지(B4)                            |
| presence 에 상대가 보이고 보드가 projectId 스코프     | Step 6·7  | ★**presence 룰 부재(B3)** — 실 배포선 거부됨          |
| cleanroom: 2인 members 프로젝트의 공유 보드 렌더      | Step 7    | 실제 2계정 인증·크로스테넌트 격리                     |

즉 **#680 이 초록인데도 실사용이 막히는 지점이 B1·B2·B3** 다 — 전부 "룰/마운트" 레이어라
서비스 함수 단위 테스트로는 안 잡힌다.

---

## 7. 부록 — 관리자 스크립트

전부 **ADC = john.kim@hypemarc.com** 으로 marblo-2253d 에 REST 호출한다.
(`gcloud`/`bq` CLI 는 이 맥에서 temu 서비스계정으로 붙어 403 이 난다 — 쓰지 말 것.)

공통 헬퍼를 먼저 `fsrest.py` 로 저장한다.

```python
# fsrest.py — ADC(authorized_user) 로 Firestore REST 호출. 시크릿은 출력하지 않는다.
import json, os, urllib.error, urllib.parse, urllib.request

ADC = os.path.expanduser("~/.config/gcloud/application_default_credentials.json")
PROJECT = "marblo-2253d"
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
_tok = {}

def token():
    if "t" in _tok: return _tok["t"]
    d = json.load(open(ADC))
    body = urllib.parse.urlencode({
        "client_id": d["client_id"], "client_secret": d["client_secret"],
        "refresh_token": d["refresh_token"], "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(
            "https://oauth2.googleapis.com/token", data=body)) as r:
        _tok["t"] = json.load(r)["access_token"]
    return _tok["t"]

def api(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("x-goog-user-project", PROJECT)
    if data: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"__error__": e.code, "__body__": e.read().decode()[:600]}

def unwrap(v):
    if not isinstance(v, dict): return v
    for k in ("stringValue","integerValue","booleanValue","timestampValue","nullValue"):
        if k in v: return v[k]
    if "arrayValue" in v: return [unwrap(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: unwrap(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return v

def fields(doc):
    return {k: unwrap(v) for k, v in (doc or {}).get("fields", {}).items()}
```

### 부록 A — 그랜트 / 롤백 (`grant.py`)

```python
# python3 grant.py            → team 그랜트 (재실행 안전)
# python3 grant.py --rollback → 2026-08-01 이전 상태로 복구
import sys, fsrest as f

NOW = "2026-08-01T01:00:00Z"
JK, DG = "RSALO1rljtWBSZ70MoBiaeFORxr1", "03BR5dm7SqgXS7uxNyorxbHTrV72"
rollback = "--rollback" in sys.argv

plan = [
    (JK, {"planType": {"stringValue": "pro" if rollback else "team"},
          "updatedAt": {"timestampValue": "2026-07-14T09:59:55.706Z" if rollback else NOW}}),
    (DG, {"planType": {"stringValue": "pro" if rollback else "team"},
          "updatedAt": {"timestampValue": "2026-07-17T06:17:28.576Z" if rollback else NOW},
          "currentPeriodEnd": {"timestampValue":
              "2026-08-03T00:33:08.094Z" if rollback else "2026-11-01T00:00:00Z"}}),
]
for uid, fl in plan:
    mask = "&".join("updateMask.fieldPaths=" + k for k in fl)
    res = f.api("PATCH", f"{f.FS}/subscriptions/{uid}?{mask}&currentDocument.exists=true",
                {"fields": fl})
    print(uid[:8], "ERR" if "__error__" in res else "OK", res.get("__body__", res.get("updateTime")))
```

### 부록 A-2 — 초대 수락 대행 (`accept.py`)

```python
# python3 accept.py --project <projectId> --uid 03BR5dm7SqgXS7uxNyorxbHTrV72
# python3 accept.py --project <projectId> --uid ... --undo   (멤버에서 제거)
import sys, fsrest as f

args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
pid, uid, undo = args["--project"], args["--uid"], "--undo" in sys.argv

# 1) projects/{pid}.members 갱신
doc = f.api("GET", f"{f.FS}/projects/{pid}")
if "__error__" in doc: sys.exit(f"project read failed: {doc}")
members = f.fields(doc).get("members", [])
members = [m for m in members if m != uid] if undo else sorted(set(members + [uid]))
res = f.api("PATCH", f"{f.FS}/projects/{pid}?updateMask.fieldPaths=members",
            {"fields": {"members": {"arrayValue":
                {"values": [{"stringValue": m} for m in members]}}}})
print("members ->", members, "ERR" if "__error__" in res else "OK")

# 2) 해당 초대 문서를 accepted 로 (앱 acceptInvitation 과 동일한 상태 전이)
if not undo:
    q = {"structuredQuery": {"from": [{"collectionId": "invitations"}],
         "where": {"compositeFilter": {"op": "AND", "filters": [
            {"fieldFilter": {"field": {"fieldPath": "projectId"}, "op": "EQUAL",
                             "value": {"stringValue": pid}}},
            {"fieldFilter": {"field": {"fieldPath": "status"}, "op": "EQUAL",
                             "value": {"stringValue": "pending"}}}]}}}}
    rows = f.api("POST", f"{f.FS}:runQuery", q)
    if isinstance(rows, dict): sys.exit(f"invitation query failed: {rows}")
    for row in rows:
        d = row.get("document")
        if not d: continue
        r = f.api("PATCH", d["name"] + "?updateMask.fieldPaths=status",
                  {"fields": {"status": {"stringValue": "accepted"}}})
        print("invitation", d["name"].split("/")[-1], "-> accepted",
              "ERR" if "__error__" in r else "OK")
```

### 부록 B — 조회 스니펫 (프로젝트 목록 / 구독 상태 / 하트비트)

```python
import json, fsrest as f
JK, DG = "RSALO1rljtWBSZ70MoBiaeFORxr1", "03BR5dm7SqgXS7uxNyorxbHTrV72"

for name, uid in [("A(존킴)", JK), ("B(datagadapida)", DG)]:
    sub = f.fields(f.api("GET", f"{f.FS}/subscriptions/{uid}"))
    usr = f.fields(f.api("GET", f"{f.FS}/users/{uid}"))
    print(name, "plan=", sub.get("planType"), sub.get("status"),
          "until", sub.get("currentPeriodEnd"), "| heartbeat=", usr.get("lastHeartbeatAt"))
    q = {"structuredQuery": {"from": [{"collectionId": "projects"}], "limit": 50,
         "where": {"fieldFilter": {"field": {"fieldPath": "members"},
                   "op": "ARRAY_CONTAINS", "value": {"stringValue": uid}}}}}
    for row in f.api("POST", f"{f.FS}:runQuery", q):
        d = row.get("document")
        if d:
            fl = f.fields(d)
            print("   ", d["name"].split("/")[-1], "|", fl.get("name"),
                  "| members:", len(fl.get("members") or []))
```

### 부록 C — B 의 표시 이름 채우기 (선택, Step 4 의 빈칸 해소)

```python
import fsrest as f
DG = "03BR5dm7SqgXS7uxNyorxbHTrV72"
fl = {"email": {"stringValue": "datagadapida@gmail.com"},
      "displayName": {"stringValue": "Datagadapida"}}
mask = "&".join("updateMask.fieldPaths=" + k for k in fl)
print(f.api("PATCH", f"{f.FS}/users/{DG}?{mask}", {"fields": fl}))
```

**롤백**: 원래 `users/03BR5dm7...` 에는 `privacyConsent` 만 있었다.
되돌리려면 같은 방식으로 `email`/`displayName` 를 지우면 된다
(`updateMask` 만 지정하고 `fields` 를 비워 PATCH → 해당 필드 삭제).

> 기본값은 **적용하지 않음**이다. 이 문서 작성 시점에 프로덕션에 쓰지 않았다 —
> 티켓 범위를 두 계정의 `subscriptions` 문서로 한정했기 때문.

---

## 8. 후속 티켓 후보 (이 가이드가 발견한 것)

1. **`InvitationBanner` 미마운트** — 초대받은 사용자에게 수락 UI 가 없다. Layout/WorkspaceShell 상단에 마운트 필요. (B1)
2. **초대 수락이 룰에 막힘** — `projects` update 가 `isProjectMember` 라 신규 멤버 자가 추가 불가.
   수락을 Cloud Function(callable)으로 옮기거나, `invitations` 의 pending 초대를 근거로 자가 추가를 허용하는 룰이 필요. (B2)
3. **협업 presence 전부 dead** — 룰 match 없음 + `PresenceIndicator` 미마운트 + 프로덕션 문서 0건. 구현하거나 코드 삭제. (B3)
4. **채팅 미읽음 배지 dead** — `incrementUnread` 호출부 없음. 배지 UI 만 남아 있다. (B4)
5. **`users/{uid}.email`/`displayName` 를 아무도 안 쓴다** — 로그인 시 upsert 하지 않아 멤버 목록이 빈칸으로 뜬다.
6. **Viewer 역할이 서버 강제가 아님** — `tasks` 룰은 멤버 여부만 본다. 역할 기반 쓰기 제한은 UI 게이팅뿐.
