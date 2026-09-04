# 조직·팀 권한 모델 감사 — 2026-09-02

티켓 `BKymXKydNJyFTSX9gMUP` (사장님 지시 더블체크).
감사 대상: #1330 · #1340 · #1343 · #1353 · #1355 · #1356 · #1360 · #1361 이 8/30~9/1 사이 착지시킨 조직·팀 축.

**이 문서는 감사 기록이다. 이 감사에서 권한 로직은 한 줄도 바꾸지 않았다.**
고쳐야 할 것은 §5 에 별도 티켓 후보로 적었다.

- 감사 기준 커밋: `d719b20b` (`git rev-list --count HEAD..origin/main` = 0)
- 실행 환경: Java 21(`/opt/homebrew/opt/openjdk@21`) + Node 22(nvm) + firebase-tools 15.23.0
- Firebase 프로젝트: `marblo-2253d`

---

## 0. 요약 — 네 축 판정

| 축              | 판정                                               | 한 줄 근거                                                                                                                                  |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 크로스테넌트 | **닫혔다**                                         | 조직 6컬렉션 rules 전면차단 + 콜러블이 요청 orgId 의 `org_members/{orgId}_{uid}` 를 서버가 직접 읽어 판정. 뮤테이션 M1 로 가드 실재 확인    |
| 2. 좌석 강제    | **열렸다 (부분)**                                  | 게이트가 _초대_ 초크포인트에만 있다. `projects.members` 직접 쓰기라는 두 번째 문이 초대·좌석·플랜 판정을 전혀 거치지 않는다 (프로브 D 실측) |
| 3. 초대 토큰    | **닫혔다 (취소 경로만 부재)**                      | 256비트 난수·7일 만료·수락 시 소비·원자 트랜잭션. 단 revoke 를 쓰는 코드가 없다                                                             |
| 4. 역할 승격    | 조직 축 **닫혔다** / 프로젝트 축 **열렸다 (부분)** | 조직 축은 승격 통로 없음. 프로젝트 축은 viewer 가 tasks 외 협업 컬렉션에 쓴다 (프로브 A 실측)                                               |

**배포 상태**

| 대상                                                               | 판정           | 근거                                                   |
| ------------------------------------------------------------------ | -------------- | ------------------------------------------------------ |
| `v3/firestore.rules`                                               | **배포됨**     | 배포본 원문을 받아 로컬 파일과 diff → 완전 동일 (§4.1) |
| `orgOnboarding`·`orgUsage`·`createOrganization` 등 조직 콜러블 7종 | **배포됨**     | 전부 `ACTIVE` (§4.2)                                   |
| `createProjectInvitation` (#1356)                                  | **배포 안 됨** | 전 리전·gen1·gen2 전수 조회에서 부재 (§4.2, 발견 F1)   |

**긴급정지 조건(지금 누구나 남의 데이터를 읽거나 쓸 수 있는 구멍) — 해당 없음.**
발견 F1~F4 는 전부 _이미 그 프로젝트의 멤버이거나 관리자여야_ 성립한다.
크로스테넌트 대조군(외부인의 타 프로젝트 읽기·쓰기)은 실측에서 전부 거부됐다.

---

## 1. 축 1 — 크로스테넌트: **닫혔다**

### 1.1 rules 층 — 조직 6컬렉션 전면차단

`v3/firestore.rules:1301-1326` 에서 `organizations` · `org_members` ·
`org_project_bindings` · `org_teams` · `org_name_history` · `org_invitations`
가 전부 `allow read, write: if false` 다. 클라이언트 표면이 0 이므로
"조직 A 구성원이 조직 B 문서를 룰로 읽는다"는 경로 자체가 없다.

`org_invitations` 까지 read 를 닫은 것이 특히 맞다 — 문서에 `/join/<토큰>` 의
난수 토큰이 실려 있어 읽기가 열리는 순간 초대 링크가 룰 표면으로 샌다.

### 1.2 콜러블 층 — 서버가 스스로 판정

Admin SDK 는 룰을 우회하므로 콜러블이 직접 판정해야 한다. 전부 **요청받은
orgId 에 대한 자기 멤버십 문서**를 읽는다 — 클라가 보낸 역할·uid 를 믿지 않는다.

| 콜러블                | 판정 지점                                                                                                                                                         | 판정 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `getOrganizations`    | `index.ts:17989-17993` 은 `where("uid","==",uid)` 로 내 멤버십만 조회. 상세는 `index.ts:18106` 의 `memberships.find(m => m.orgId === requestedOrgId)` 통과 시에만 | 닫힘 |
| `getOrgUsageSummary`  | `index.ts:18634-18645` — `org_members/{orgId}_{uid}` 를 읽어 `isOrgAdminRole` 아니면 숫자 필드가 아예 없는 `restricted` 봉투 반환                                 | 닫힘 |
| `bindProjectToOrg`    | `index.ts:18262-18286` — 조직 역할 + 프로젝트 역할 둘 다 서버가 읽어 `canBindProjectToOrg` 로 판정                                                                | 닫힘 |
| `createOrgInvitation` | `index.ts:19063-19069` — 요청 orgId 의 자기 멤버십으로 `requesterOrgRole` 산출                                                                                    | 닫힘 |
| `createOrganization`  | `index.ts:18464` — `orgId` 는 **서버가 생성**한다(`collection(...).doc()` 자동 id). 클라가 orgId 를 고를 수 없으므로 기존 조직에 자기를 심는 경로가 없다          | 닫힘 |

과거 미션 축에서 두 번 났던 구멍(#1113 read / #1117 write)의 재발은 **없다**.
그 구멍은 "테넌트 키를 안 보고 컬렉션을 열었다"는 모양인데, 조직 축은 컬렉션을
아예 열지 않았고 콜러블은 매 요청 테넌트 키를 다시 읽는다.

또한 남의 **개인** 조직(`personal_<uid>`)도 존재 비노출 쪽으로 접힌다
(`index.ts:18108-18112`).

### 1.3 뮤테이션 검증

`org_members` 의 `allow read, write: if false` 를 `if isAuthenticated()` 로
바꾸자 **5개 테스트가 뒤집혔다**(자기 문서 읽기·비멤버 읽기·플랫폼 admin 읽기·
list 열거·write 전면 차단). 초록이 이 가드의 실재를 증명한다.

---

## 2. 축 2 — 좌석 강제: **열렸다 (부분)**

### 2.1 게이트가 실제로 있는 곳

#1353 은 두 층에 게이트를 놨고, 둘 다 실재한다:

- **rules 플랜 축**: `invitations` create 가 `ownerHasTeamCollab(...)` 를 요구
  (`firestore.rules:928`). 화면을 거치지 않는 직접 Firestore 쓰기도 이 문을 지난다.
  뮤테이션 M2(이 조건 제거) → 1개 테스트 뒤집힘. **가드 실재 확인.**
- **rules 쓰기 축**: 비오너 멤버의 `/tasks` write 가 `canWriteTasks`
  (`firestore.rules:479-484`)로 플랜에 묶인다. 뮤테이션 M3 → 4개 뒤집힘.
- **콜러블 좌석 수 축**: `checkTeamSeatForInvite`(`orgOnboarding.ts:404-427`) +
  `countProjectSeatsInUse`(`index.ts:21665-21691`). 좌석 _수_ 집계는 룰에서
  불가능하므로 서버가 맡는 것이 맞다.

### 2.2 ★우회 경로 — `projects.members` 직접 쓰기

**게이트가 초크포인트에 앉아 있지 않다.** 좌석·플랜 판정은 전부 _초대 문서
생성_ 지점에 걸려 있는데, **멤버십에는 초대를 거치지 않는 두 번째 문이 있다.**

`firestore.rules:286-288` 의 `projectAdminWritableFields()` 에 `members` 가
들어 있다. 즉 프로젝트 owner/admin 은 `projects.members` 에 임의 uid 를
`arrayUnion` 할 수 있고, 이 경로는 `invitations` 를 만들지 않으므로
`ownerHasTeamCollab` 도 `checkTeamSeatForInvite` 도 **한 번도 평가되지 않는다.**

에뮬레이터 실측(프로브 D, 6/6):

| 케이스                                                          | 결과                        |
| --------------------------------------------------------------- | --------------------------- |
| D1 team 플랜(포함 1석, 이미 3명) 오너가 초대 없이 낯선 uid 추가 | **성공** ← 좌석 한도 우회   |
| D2 admin 이 초대 없이 추가                                      | **성공**                    |
| D3 무료 플랜 오너가 초대 없이 추가                              | **성공** ← 플랜 게이트 우회 |
| D4 (대조군) 일반 member 가 추가 시도                            | 거부 ✓                      |
| D5 (대조군) 외부인이 타 프로젝트 members 변경                   | 거부 ✓                      |
| D6 그렇게 추가된 사람이 프로젝트 문서 읽기                      | 성공 (역할 문서 없이 멤버)  |

D4·D5 가 거부되므로 **테넌트 경계는 유지된다.** 깨진 것은 좌석·과금 강제이지
테넌트 격리가 아니다. 다만 D6 이 보여주듯 이 경로로 들어온 사람은 `memberRoles`
문서가 없어 `getMemberRole` 기본값 `member` 로 접히므로, #1299 가 닫은
"역할 문서 없는 멤버" 를 **초대 밖 경로가 다시 만들 수 있다.**

### 2.3 앱 내부 경로 · MCP

- 앱(Electron 렌더러): `teamService.createInvitation`(`src/services/teamService.ts:188-215`)
  은 더 이상 클라 직접 쓰기를 하지 않고 콜러블만 부른다 — 설계대로다.
  **단 그 콜러블이 프로덕션에 없다**(§4.2 · F1).
- `projectService.addMember`(`src/services/projectService.ts:207-216`)가 §2.2 의
  그 경로다. 앱 내 유일한 호출부는 `agentAuthService.ts:137-145`(자기가 소유한
  프로젝트에 자기를 넣는 자가 복구)와 `teamService.ts:333`(초대 수락 self-join)
  으로, 둘 다 우회 목적이 아니다 — 그러나 룰이 허용하는 표면은 그보다 넓다.
- MCP 서버: `electron/mcp-server/` 에서 `invitations`·`memberRoles`·
  `projects.members` 를 쓰는 코드는 **없다**(유일한 `arrayUnion` 은
  `tools.ts:1690` 의 `taskIds` 로 멤버십과 무관). MCP 우회 경로 없음.

---

## 3. 축 3 — 초대 토큰: **닫혔다** (취소 경로만 부재)

| 항목        | 판정 | 근거                                                                                                                                                                                                                                                                |
| ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 생성        | 닫힘 | `randomBytes(32)` = 256비트 base64url 43자 (`orgOnboarding.ts:139-146`). 전수 추측 불가. 토큰은 문서 id 가 아니라 **필드**이고 문서 id 는 `{orgId}_{email}` 이라 URL 에 이메일·조직이 안 실린다                                                                     |
| 형식 검증   | 닫힘 | `isPlausibleOrgInviteToken`(`orgOnboarding.ts:153-155`)이 형식 밖 입력을 **조회 없이** `unusable` 로 접는다 — 무효 사유를 입력 모양으로도 구분해 주지 않는다                                                                                                        |
| 수명        | 닫힘 | TTL 7일(`ORG_INVITE_TTL_MS`). 만료 판정은 읽기 시점마다 fail-closed — `expiresAtMs === null`(손상)도 만료 취급(`orgOnboarding.ts:474-477`)                                                                                                                          |
| 재사용      | 닫힘 | 수락 시 `status: "accepted"` + `acceptedByUid` 기록(`index.ts:19836-19840`). 이후 **타인에게는 `unusable`**, 본인 재클릭만 noop 성공(`orgOnboarding.ts:466-470`)                                                                                                    |
| 원자성      | 닫힘 | 수락 전체가 `db.runTransaction` 단일 트랜잭션(`index.ts:19646-19845`). 조직 멤버 문서 + 프로젝트별 `memberRoles` + `projects.members` + 프로젝트 초대 status + 조직 초대 status 가 전부 아니면 전무. 계획(`planOrgInviteAccept`)이 ok 가 아니면 쓰기가 한 줄도 없다 |
| 동시 수락   | 닫힘 | 토큰 조회가 트랜잭션 **안**(`txn.get(orgInvitationByTokenQuery(token))`)에서 일어나 대상 문서가 잠긴다. 경합한 두 번째 시도는 재시도 후 `status==="accepted"` 를 다시 읽어, 같은 사람이면 noop·다른 사람이면 `unusable` 로 떨어진다                                 |
| 존재 비노출 | 닫힘 | 오타·취소·타인 수락분이 전부 `unusable` 하나로 접히고, 만료·이미수락은 **이메일 일치가 확인될 때만** 갈라 보여준다                                                                                                                                                  |

### 3.1 ★발견 — 취소(revoke) 경로가 없다

`OrgInvitationStatus` 에 `"revoked"` 가 있고 `resolveOrgInviteView` 가 그것을
`unusable` 로 읽지만(`orgOnboarding.ts:213` · `464`), **그 값을 쓰는 코드가
저장소 어디에도 없다.** 조직 초대를 취소하는 콜러블이 없고, `org_invitations`
는 rules 로 클라 write 가 막혀 있으므로 취소할 방법이 아예 없다.

토큰 회전으로 대체할 수도 없다 — 유효한 pending 초대가 있으면
`planOrgInviteCreate` 가 `action: "reuse"` 를 내려 **토큰을 그대로 둔다**
(`orgOnboarding.ts:295-302`). 재초대해도 기존 링크가 살아 있다.

결과: 잘못 보낸 초대 링크(슬랙 오발송 등)를 7일 만료 전에 회수할 수단이 없다.
프로젝트 축 초대는 취소가 있다(`firestore.rules:952-953` delete +
`teamService.cancelInvitation`) — 조직 축만 빠졌다.

---

## 4. 배포 상태 — 머지는 배포가 아니다

배포는 **실행하지 않았다.** 아래는 전부 읽기 전용 조회다.

### 4.1 `firestore.rules` — **배포됨** (원문 대조로 확정)

```
GET firebaserules.googleapis.com/v1/projects/marblo-2253d/releases
  → cloud.firestore | ruleset 0ed42b7b-ecc1-4c09-87e7-e8de69143da0
    updateTime 2026-09-01T03:07:52Z
GET .../rulesets/0ed42b7b-...
  → files[0] name=firestore.rules, 60750 bytes
diff <배포본> v3/firestore.rules  → 차이 없음 (양쪽 1373줄)
```

추측이 아니라 **배포본 원문을 받아 로컬 파일과 바이트 단위로 대조**했다.
#1353(`1f97c18b`)의 머지 시각이 `2026-09-01T03:04:23Z` 이고 룰 배포가
`03:07:52Z` 이므로, 머지 약 3분 뒤 배포된 것이다. #1353 의 플랜 게이트·좌석
게이트는 프로덕션에 살아 있다.

### 4.2 Cloud Functions — 1개 미배포

소스 `functions/src/index.ts` 의 `export const` 128개 vs 프로덕션 127개.
전 리전(`locations/-`) · gen1(v1 API) · gen2(v2 API) 전수 조회 결과 리전은
`us-central1` 단일이고, **차집합은 정확히 하나**다.

| 함수                          | 배포 시각(UTC)       | 상태                |
| ----------------------------- | -------------------- | ------------------- |
| `bindProjectToOrg`            | 2026-08-31T09:00:41Z | ACTIVE              |
| `getOrganizations`            | 2026-08-31T09:00:47Z | ACTIVE              |
| `acceptOrgInvitation`         | 2026-08-31T09:00:58Z | ACTIVE              |
| `resolveOrgInvitation`        | 2026-08-31T09:01:01Z | ACTIVE              |
| `createOrgInvitation`         | 2026-09-01T05:01:36Z | ACTIVE              |
| `createOrganization`          | 2026-09-01T07:16:19Z | ACTIVE              |
| `getOrgUsageSummary`          | 2026-09-01T08:40:55Z | ACTIVE              |
| `getTeamUsageSummary`         | 2026-09-01T08:41:10Z | ACTIVE              |
| **`createProjectInvitation`** | —                    | **프로덕션에 없음** |

`orgOnboarding` · `orgUsage` · `createOrganization` 는 전부 배포돼 있다.

---

## 5. 발견 — 4건 (별도 티켓 후보)

### F1 [높음] `createProjectInvitation`(#1356)이 머지 후 배포되지 않았다

- **사실**: 소스에는 있고(`index.ts:19358`) 프로덕션에는 없다(§4.2).
  머지 `d5ca0323` = 2026-09-01T15:04 KST. 마지막 functions 배포 =
  2026-09-01T08:41Z(17:41 KST). 머지가 배포보다 **먼저**인데 빠졌다 —
  `--only functions:<이름>` 형태의 선택 배포였던 것으로 보인다
  (`getOrgUsageSummary`/`getTeamUsageSummary`만 08:40~08:41 에 갱신됨).
- **영향 (a)**: `teamService.createInvitation`(`src/services/teamService.ts:206-213`)
  이 이 콜러블만 부르고 클라 직접 쓰기는 #1356 에서 제거됐다. 따라서
  **앱에서 팀원 초대가 프로덕션에서 동작하지 않는다**(콜러블 not-found).
- **영향 (b)**: #1356 이 닫으려던 "프로젝트 축 좌석 강제"가 프로덕션에 없다.
- **조치**: `firebase deploy --only functions:createProjectInvitation`.
  ★실행은 사장님 승인 사항이라 이 감사에서는 하지 않았다.
- **★심사 기간 주의**: 이건 판매·로그인 화면이 아니라 앱 내부 협업 기능이지만,
  "초대가 안 된다" 는 심사 중 눈에 띌 수 있는 기능 결손이다.

### F2 [중간] 좌석·플랜 게이트가 초크포인트를 하나만 지킨다

- **사실**: §2.2. `members` 가 `projectAdminWritableFields()` 라
  owner/admin 의 `projects.members` 직접 쓰기가 초대·좌석·플랜 판정을
  전혀 거치지 않는다. 프로브 D 로 실측(무료 플랜·좌석 초과 둘 다 성공).
- **영향**: 좌석 한도와 팀 요금제 결속이 과금 관점에서 강제되지 않는다.
  또 이 경로로 들어온 멤버는 `memberRoles` 문서가 없어 기본값 `member` 로
  접히므로 #1299 가 닫은 "역할 문서 없는 멤버" 가 초대 밖에서 다시 생긴다.
- **판단**: 테넌트 격리는 깨지지 않았다(D4·D5 대조군 거부). 보안 사고가 아니라
  **과금 강제와 역할 규약의 구멍**이다.
- **조치 후보**: `members` 를 클라 write allowlist 에서 빼고 멤버십 변경을
  전부 콜러블로 이관(초대 수락 self-join 은 이미 `isInvitedSelfJoin` 분기로
  분리돼 있어 영향 없음). 규모가 있으니 별도 티켓이 맞다.

### F3 [중간] viewer 쓰기 누수 — #1297 은 `/tasks` 에서만 닫혔다

- **사실**: 프로브 A 실측. viewer(`memberRoles.role = "viewer"`)가 다음에 전부
  쓰기 성공: `chatMessages` · `taskComments` · `flows` · `agents` ·
  `botDefinitions` · `pendingInstructions` · `activities`.
  대조군 `/tasks` 는 정상 거부(#1297 이 닫은 문은 살아 있다).
- **원인**: 플랜·역할 게이트 `canWriteTasks`(`firestore.rules:479-484`)가
  `/tasks` 블록에만 걸려 있다. 나머지 프로젝트 귀속 컬렉션은 전부 평문
  `isProjectMember` 다(`firestore.rules:506` · `522` · `537` · `551` · `583` ·
  `598` · `609`).
- **정본과의 어긋남**: `ROLE_PERMISSIONS.viewer = ["read"]`
  (`v3/src/types/invitation.ts:58`). 룰이 역할표보다 넓다 — #1297 이 고쳤던
  것과 **같은 모양의 드리프트**가 다른 표면에 남아 있다.
- **★가장 날카로운 것**: `pendingInstructions` 는 에이전트 PTY 에 문자열을
  주입하는 큐다(`firestore.rules:541-568`). "읽기 전용"으로 초대한 사람이
  남의 기기에서 도는 에이전트에 지시를 넣을 수 있다.
- **부수 확인**: 같은 이유로 #1353 의 플랜 게이트도 이 컬렉션들에는 미적용이다
  — 프로브 B 실측에서 무료 오너 프로젝트의 멤버가 `chatMessages` ·
  `taskComments` · `pendingInstructions` 에 쓰기 성공했다(대조군 `/tasks` 거부).

### F4 [낮음] 조직 초대에 취소 경로가 없다

§3.1 참조. 상태값은 있는데 쓰는 코드가 없다. 재초대로도 토큰이 회전하지 않는다.

---

## 6. 테스트 — 실행 결과와 커버리지 공백

### 6.1 `npm run test:rules` — **실행됨, 361/361 통과**

정적 독해로 대체하지 않았다. 전부 에뮬레이터 실측이다.

```
firebase emulators:exec --only firestore "vitest run --config vitest.rules.config.mjs"
  Test Files  1 passed (1)
       Tests  361 passed (361)
    Duration  31.55s
```

티켓이 언급한 전제조건은 이 Mac 에서 이렇게 충족했다: 시스템 기본 java 는 1.8
(에뮬레이터 요구 미달)이라 `JAVA_HOME=/opt/homebrew/opt/openjdk@21` 을 주고,
firebase-tools 가 설치된 nvm Node 22 를 PATH 앞에 뒀다.

### 6.2 뮤테이션 검증 — 초록이 가드의 존재 증명인가

판정한 가드를 하나씩 지우고 테스트가 뒤집히는지 확인했다. **3/3 뒤집혔다.**

| 뮤테이션                                                    | 결과                      |
| ----------------------------------------------------------- | ------------------------- |
| M1 `org_members` 를 `if false` → `if isAuthenticated()`     | **5 failed** / 356 passed |
| M2 `invitations` create 에서 `ownerHasTeamCollab(...)` 제거 | **1 failed** / 360 passed |
| M3 `canWriteTasks` 에서 viewer 검사 제거                    | **4 failed** / 357 passed |

세 가드 모두 실재하고 테스트가 실제로 지키고 있다.
뮤테이션 후 `firestore.rules` 는 원상복구했고 `git diff` 가 비어 있음을 확인했다.

### 6.3 ★커버리지 공백 — 그 자체가 발견이다

`firestore.rules.test.ts`(5580줄, 361케이스)가 **덮지 않는** 구간:

1. **viewer 게이트가 `/tasks` 밖으로 확장되는지**를 아무 테스트도 보지 않는다.
   viewer describe(`firestore.rules.test.ts:1486` 이하)는 전부 `tasks` 케이스다.
   → F3 이 회귀 테스트 없이 열려 있었던 이유다.
2. **플랜 게이트가 `/tasks`·`invitations` 밖에 적용되는지** 케이스가 없다
   (`firestore.rules.test.ts:1677` 이하 describe 도 tasks·invitations 뿐).
3. **`projects.members` 직접 쓰기로 멤버를 추가하는 경로**에 대한 케이스가 없다.
   `admin: name 과 members 를 쓸 수 있다`(:930)는 **허용**을 고정할 뿐,
   그 경로가 좌석·플랜을 우회한다는 사실은 아무도 보지 않는다. → F2.
4. 조직 축 커버리지는 `firestore.rules.test.ts:4869-5017` 의 전면차단 6케이스가
   전부다. 이건 rules 표면이 0 이라 **적절하다** — 조직 축 권한 판정의 본체는
   콜러블에 있고, 그쪽은 `orgOnboarding.test.ts`·`orgStructure.test.ts`·
   `orgUsage.test.ts` 의 순수 판정 단위테스트가 맡는다. 다만 **콜러블 IO 층
   (트랜잭션·쿼리 결속)을 도는 통합 테스트는 없다** — 동시 수락 원자성은
   이 감사에서도 코드 독해로만 판정했고 실행으로 확인하지 못했다.

이 감사에서 F2·F3 을 잡은 프로브는 임시 파일로 돌리고 삭제했다(커밋하지 않음).
위 1~3 을 고정하는 회귀 테스트는 F2·F3 수정 티켓에 함께 넣는 것이 맞다.

---

## 7. 이 감사가 하지 않은 것

- 배포를 실행하지 않았다(F1 은 보고만 한다 — 실행은 사장님 승인 사항).
- 권한 로직을 고치지 않았다. 뮤테이션은 전부 원상복구했고 `git diff` 로 확인했다.
- `assertAxisPurity()` / `canSeeTeamBreakdown` 게이트를 건드리거나 우회하지 않았다.
- 불변 원장(`update: false`) 규칙을 건드리지 않았다.
- `npm install` 을 하지 않았고 `v3/functions` 에 devDependency 를 추가하지 않았다.
- GUI/Playwright/Electron 을 실행하지 않았고, 심사 계정으로 로그인하지 않았다.
- 로그인·결제 진입 화면과 판매상태를 바꾸지 않았다.
- 비밀값 원문(토큰·service account·OAuth key·.env 값)을 이 문서에 적지 않았다.
  존재 여부 확인이 필요한 곳은 마스킹해 처리했다.
- 개별 이메일 주소를 적지 않았다.
- `gcloud auth`(사용자 계정)는 재인증이 필요해 쓰지 못했고, 배포 상태 조회는
  application-default 자격증명으로 읽기 전용 API 만 호출했다.
