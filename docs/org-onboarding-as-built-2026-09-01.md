# 조직 관리 플로우 — 2026-09-01 as-built

> 이 문서는 설계가 아니라 2026-09-01 현재 코드와 프로덕션 배포 상태를 대조한 동작 문서다. 설계의 배경·대안·로드맵은 [B2B 설계 문서](./org-analytics-b2b-design-2026-08-31.md), [웹 우선 온보딩 설계](./org-onboarding-web-first-design-2026-08-31.md), [팀 라벨 설계](./org-team-layer-design-2026-08-31.md)로 보낸다.

## 한 줄 판정

조직 생성·팀 라벨 결합·조직 초대 링크·초대 수락은 웹과 Cloud Functions에 배선되어 있고, 조직 컬렉션은 현재 0건이다. 조직 사용량 롤업(Phase 2)은 아직 없다.

## 1. 실제 화면과 라우트

Next.js의 실제 URL에는 로케일 접두사가 붙지만, 제품 경로는 아래처럼 읽는다.

| 제품 경로 | 실제 파일 | 현재 동작 |
| --- | --- | --- |
| `/org` | `marblo-web/src/app/[locale]/org/page.tsx` · `OrgLandingClient.tsx` | 로그인 후 `getOrganizations({})`를 호출한다. 마지막으로 본 조직이 유효하면 그곳으로, 비개인 조직이 하나면 `/org/<orgId>`, 여러 개면 조직 선택 화면, 없으면 `/org/me`로 이동한다. |
| `/org/new` | `marblo-web/src/app/[locale]/org/new/page.tsx` · `OrgIntakeViews.tsx` | 로그인한 사용자가 조직명 하나를 입력한다. 성공하면 조직 표시명과 `orgId`를 보여 주고 `/org/<orgId>`로 이어진다. |
| `/org/<orgId>` | `marblo-web/src/app/[locale]/org/[orgId]/page.tsx` · `OrgHomeClient.tsx` | 비개인 조직 홈이다. 조직 관리자에게 프로젝트 결합·팀 라벨·멤버 초대 폼을 보여 준다. URL의 `orgId` 자체는 권한 근거가 아니며 서버가 멤버십을 다시 판정한다. |
| `/org/me` | `marblo-web/src/app/[locale]/org/me/page.tsx` | 개인 조직 별칭이다. 개인 조직에는 팀 라벨과 조직 결합표를 그리지 않고 기존 팀 사용량 화면을 보여 준다. |
| `/join/<token>` | `marblo-web/src/app/[locale]/join/[token]/page.tsx` · `JoinViews.tsx` | 로그인 전에는 초대를 해석해 최소 정보와 로그인/가입 버튼을 보여 준다. 로그인 후 초대 이메일과 계정이 맞으면 소속 확인과 수락 버튼을 보여 준다. |

`/join/<token>`의 토큰은 조직 id나 문서 id가 아니라 256비트 난수 필드다. 로그인 전 응답에는 원문 이메일·조직 id·프로젝트 목록이 들어가지 않는다. 수락 완료 화면은 앱 다운로드를 먼저 보여 주고, 서버가 `orgId`를 준 경우에만 조직 홈 링크를 추가한다.

## 2. 배포된 콜러블 4개 계약

클라이언트 계약의 기준은 `marblo-web/src/lib/orgOnboarding.ts`다. 클라이언트 parser가 실제로 채택하는 필드와 서버 응답에 더 있는 필드를 구분해 적었다.

### `createOrganization({ displayName })`

- 입력: 로그인 필수. `{ displayName: string }`. 클라이언트는 공백만 먼저 막고, 서버가 팀 조직명 검증을 최종 수행한다.
- 성공: 서버는 `{ orgId, displayName, reused }`를 반환한다. 클라이언트는 `orgId`와 `displayName`이 온전할 때만 성공으로 접고 `/org/<orgId>`로 이동한다. 같은 사용자가 같은 정규화 이름으로 이미 만든 조직이면 `reused: true`로 기존 조직을 돌려준다.
- 실패: `unauthenticated`; `invalid-argument`인 `name_required_for_team_plan`/`empty`, `too_short`, `too_long`, `control_char`, `invisible_or_bidi`는 화면의 `name_required`/`too_short`/`too_long`/`invalid_chars`로 접힌다. 알 수 없는 실패는 `unavailable`로 표시하며 결제 실패로 말하지 않는다.
- 쓰기: `organizations`와 생성자 `org_members`를 한 트랜잭션으로 쓴다. 생성자 역할은 `org_owner`다.

### `createOrgInvitation({ orgId, email, orgRole?, projects? })`

- 입력: 로그인 필수. `{ orgId: string, email: string, orgRole?: "org_admin" | "org_member", projects?: Array<{ projectId: string, role?: string }> }`. `projects`는 최대 20개이며, 웹 화면은 초대자가 owner/admin인 프로젝트의 id만 보내고 프로젝트 역할은 생략해 서버 기본값 `member`를 사용한다. 조직 `org_owner`는 초대로 부여하지 않는다.
- 성공: `{ ok: true, reused, joinPath, token, expiresAtMs, projects }`. `joinPath`는 `/join/<token>`이고 메일은 발송되지 않는다. 유효한 pending 초대가 있으면 같은 토큰을 재사용한다. 조직 초대 문서 하나와 선택된 기존 `invitations/{projectId}_{email}` 문서들을 함께 만든다.
- 실패: `unauthenticated`; `permission-denied`(조직 관리자가 아니거나 관리하지 않는 프로젝트 포함); `failed-precondition`(이미 조직 멤버, 팀 플랜 없음); `resource-exhausted`(좌석 한도); `invalid-argument`(조직 id·이메일·역할·프로젝트 입력 오류, 프로젝트 admin 초대는 owner만 가능). 웹은 각각 `permission`, `already_member`, `plan_required`, `seat_limit`, `invalid`, `unavailable`로 표시한다.
- 좌석 계산: 프로젝트 owner 1석 + 비 viewer 기존 멤버 + 만료 전 pending 비 viewer 초대다. viewer는 좌석을 소비하지 않는다. 기존 멤버를 소급 제거하지 않고 **새 초대 생성 시점만** 막는다.

### `resolveOrgInvitation({ token })`

- 입력: 로그인 없이도 호출 가능. `{ token: string }`. 형식이 256비트 base64url이 아니면 조회하지 않고 `state: "unusable"`을 반환한다.
- 성공 응답의 상태:

| 서버 상태 | 응답에 실리는 것 | 화면 |
| --- | --- | --- |
| `valid`, 로그인 전 | 조직 표시명·조직 역할·초대자 표시명·마스킹 이메일·만료 시각·프로젝트 수 | 조직 초대 랜딩, 로그인/가입 |
| `valid`, 초대 이메일로 로그인 | 위 정보 + `canAccept` + 아직 유효한 프로젝트 목록(`projectId`, 이름, 프로젝트 역할) | 소속 확인, 수락 |
| `expired` | 만료 시각 | 만료 안내 |
| `email_mismatch` | 이메일을 싣지 않은 상태값만 | 다른 계정 안내·계정 전환 |
| `already_accepted` | 본인이 수락한 경우에만 `orgId` | 이미 수락한 초대의 다음 단계 |
| `unusable` | 세부 사유 없음 | 사용할 수 없는 링크 안내 |

  취소·오타·위조·타인이 수락한 초대는 `unusable` 하나로 접는다. 다른 계정에 초대 이메일을 보여 주지 않는다. 로그인 계정의 이메일이 맞아도 미인증이면 `canAccept: false`이고 수락은 거부된다.
- 호출 실패: 네트워크·미배포 등 판정 불가는 `unavailable`로 표시한다. `not-found`를 곧바로 잘못된 링크로 말하지 않는다.

### `acceptOrgInvitation({ token })`

- 입력: 로그인 필수. `{ token: string }`.
- 성공: `{ ok: true, orgId, noop, granted, skipped }`. 최초 수락은 `noop: false`이며 `org_members`를 만들고, 선택된 프로젝트마다 `memberRoles`·`projects.members`를 갱신하고 프로젝트 초대 상태를 `accepted`로 바꾼 뒤 조직 초대도 `accepted`로 바꾼다. 본인이 이미 수락한 초대를 다시 누르면 `noop: true`로 성공한다.
- 실패: `unauthenticated`; `failed-precondition`(형식 밖/사용 불가, 본인 확인된 만료, 미인증 이메일); `permission-denied`(다른 계정). 화면에는 만료·다른 계정·사용 불가를 각각 구분해 표시한다. 조직 초대의 조직이 사라지거나 프로젝트 초대가 이미 만료·취소된 경우 프로젝트 grant는 `skipped`에 남고, 조직 수락 자체는 계획에 따라 처리된다.
- 원자성: 조직 멤버십·프로젝트 역할·프로젝트 members·초대 상태 전이는 단일 Firestore 트랜잭션이다. 하나라도 실패하면 반쪽 수락을 남기지 않는다. admin 프로젝트 역할은 owner가 만든 초대일 때만 grant하며, 기존 프로젝트 멤버의 역할은 덮어쓰지 않는다.

`marblo-web/src/lib/orgOnboarding.ts`의 `parseCreateOrganizationData`는 서버의 `reused`를 화면 계약에 포함하지 않고 `orgId`·`displayName`만 읽는다. 파일 상단의 서버 미배선 주석은 #1360 이전 설명으로 남아 있지만, 현재 source와 아래 실측 함수 목록에서는 `createOrganization`이 배포되어 있다.

## 3. 게이트가 어느 층에 있는가

| 축 | 실제 게이트 | 무엇을 판단하나 | 하지 못하는 것 |
| --- | --- | --- | --- |
| 요금제 × 보드 쓰기 | `v3/firestore.rules`의 `canWriteTasks(projectId)` | tasks create/update/delete에서 비오너 멤버에게 오너의 팀 협업 entitlement와 viewer 아닌 역할을 요구한다. 오너 본인의 쓰기는 free에서도 보존한다. | 좌석 수를 세지 못한다. rules에는 컬렉션 집계가 없다. |
| 요금제 × 프로젝트 초대 생성 | `v3/firestore.rules`의 `match /invitations/{invitationId}` create | admin/owner, owner가 가진 팀 협업 플랜, pending 상태, 역할·admin 초대 owner-only를 확인한다. | 좌석 수를 세지 못한다. |
| 좌석 수 × 프로젝트 초대 | `createOrgInvitation` 내부의 `countProjectSeatsInUse` + `checkTeamSeatForInvite` | 오너·비 viewer 멤버·유효 pending 초대를 집계해 includedSeats와 비교한다. `team=1`, `team_plus=5`, `enterprise=∞`; viewer는 비소비다. | rules가 대신할 수 없다. 이미 존재하는 멤버를 소급 제거하지도 않는다. |
| 보드 접근 사유 | `getBoardAccess({ projectId })` | `{ role, access, readOnlyReason: "role" | "plan" | null }`을 반환해 viewer와 플랜 잠금을 구분한다. | 좌석 집계의 대체가 아니다. |

핵심은 **요금제 축은 `firestore.rules`(`canWriteTasks`·`invitations create`)에 있고, 좌석의 ‘수’는 콜러블(`checkTeamSeatForInvite`)에만 있다. rules는 집계를 못 하므로 좌석을 셀 수 없다.** 좌석 문제를 rules에 추가하거나 플랜 문제를 좌석 함수에만 추가하면 실제 경계가 어긋난다.

## 4. 순서 제약

**콜러블 이관 → 그 릴리스가 사용자에게 도달 → 그 다음 rules를 조인다.**

**`invitations` create를 rules에서 먼저 막으면 구버전 앱 사용자의 초대가 통째로 죽는다. 현재 사용자에게 나간 최신 릴리스는 `v3.0.35`이고, `v3.0.36`은 Draft이며 `v3.0.37`·`v3.0.38`은 현재 공개 릴리스 목록에 없다. 따라서 앱이 아직 직접 `invitations`를 쓰는 구간에 rules 플랜 게이트를 선행하면, 새 콜러블을 모르는 구버전 클라이언트가 초대를 만들 수 없게 된다.**

실제 오늘의 순서는 앱 초대 호출부를 `createProjectInvitation`으로 옮긴 코드(#1356)와 조직 웹 초대 흐름(#1355)을 먼저 머지하고, 도달 가능한 함수·rules를 배포한 뒤, rules의 플랜 게이트를 배포한 것이다. 단, `createProjectInvitation`은 현재 Cloud Functions 목록에는 없어 **코드만 있는 상태**이므로 앱 배포 도달 여부를 별도 확인하기 전에는 완료된 서버 경로로 취급하지 않는다.

## 5. 배포 상태

### Cloud Functions 실측

2026-09-01에 `v3/.firebaserc`의 프로젝트 `marblo-2253d`를 대상으로 아래 읽기 전용 조회를 실행했다.

```text
nvm use 20
firebase functions:list --project marblo-2253d
```

이 조회에서 조직 플로우와 직접 관련되어 실제 목록에 나온 함수는 다음과 같다. 모두 `v1 / callable / us-central1 / nodejs20`이다.

| 상태 | 함수 | 근거 |
| --- | --- | --- |
| 배포됨 | `createOrganization` | 함수 목록 + `v3/functions/src/index.ts:18442` |
| 배포됨 | `createOrgInvitation` | 함수 목록 + `v3/functions/src/index.ts:18645` |
| 배포됨 | `resolveOrgInvitation` | 함수 목록 + `v3/functions/src/index.ts:19162` |
| 배포됨 | `acceptOrgInvitation` | 함수 목록 + `v3/functions/src/index.ts:19264` |
| 배포됨 | `getOrganizations` | 함수 목록 + `v3/functions/src/index.ts:17968` |
| 배포됨 | `bindProjectToOrg` | 함수 목록 + `v3/functions/src/index.ts:18187` |
| 배포됨 | `getBoardAccess` | 함수 목록 + `v3/functions/src/index.ts:21341` |
| 배포됨 | `logTaskOutcome` | 함수 목록 + `v3/functions/src/index.ts:8993` |
| 코드만 | `createProjectInvitation` | 소스 export는 `v3/functions/src/index.ts:18993`에 있으나 `firebase functions:list` 결과에 없음 |
| 미구현 | `getOrgUsageSummary` | 설계 문서에만 있고 함수 export·호출 배선이 없음. 현재 조직 홈은 관리자에게도 `unwired`를 그린다. |

rules의 사업성 P0 플랜 게이트는 03:07Z 배포, `createOrgInvitation` 좌석 강제와 `getBoardAccess`는 05:01Z 배포로 기록되어 있다. `createOrganization`과 `logTaskOutcome`은 위 함수 목록에서 현재 배포를 재확인했다. 웹 화면은 #1355의 `marblo-web` 머지·배포 범위이며, 소스 라우트는 이 문서 1절의 파일에 있다.

조직 데이터의 현재 개수도 문서 원문을 출력하지 않고 Firestore `runQuery`에서 문서 수만 읽어 재확인했다: `organizations=0`, `org_members=0`, `org_teams=0`, `org_project_bindings=0`, `org_invitations=0`. 실제 컬렉션 이름은 설계 문서의 느슨한 `org_projects`가 아니라 `org_project_bindings`다.

### 릴리스 확인

GitHub 릴리스 조회에서 `v3.0.35`는 `Latest=true, Draft=false`, `v3.0.36`은 `Draft=true`였다. `v3.0.37`·`v3.0.38`은 공개 릴리스 레코드가 조회되지 않았다. 따라서 이 문서에서는 둘을 사용자에게 나간 버전이나 배포 완료 버전으로 세지 않는다.

## 6. 하이프마크 시연 절차

아래 절차는 실제 데이터를 만들지 않고, 사장님이 승인한 계정으로 웹에서 밟을 때의 정상 화면 기준이다. 조직 생성·초대는 쓰기 작업이므로 운영 데이터에서 실행할 때는 시연 계정과 수신 이메일을 확인한다.

1. 팀 결제를 완료한 관리자 계정으로 `/org/new`에 들어가 `하이프마크`를 입력하고 `조직 만들기`를 누른다. 정상은 초록 체크와 `하이프마크 이(가) 준비됐습니다`, `조직 홈으로` 버튼이다. 버튼을 누르면 `/org/<orgId>`로 간다.
2. 조직 홈에서 `프로젝트 결합하기`를 열고 관리 가능한 프로젝트를 고른다. 팀 선택에서 `＋ 새 팀 만들기`를 고르고 `데이터팀`을 입력한 뒤 `결합`한다. 정상은 `프로젝트가 결합되었습니다.`라는 초록 알림, `팀 라벨` 목록의 `데이터팀`, `결합된 프로젝트` 행의 팀 값이다. 프로젝트가 없으면 `결합할 수 있는 프로젝트가 없습니다`가 뜨며, 그것은 결합 성공이 아니다.
3. `멤버 초대하기`에서 datagadapida의 가입 이메일을 입력하고 조직 역할 `멤버`를 고른다. 프로젝트도 함께 붙일 때만 관리 가능한 프로젝트를 체크한다. 정상은 `초대 링크가 준비되었습니다`, `/join/<token>` 절대 주소, `링크 복사` 버튼과 만료일이다. 자동 메일은 오지 않는다. 프로젝트 초대까지 두 사람에게 줄 경우 오너 1석을 포함해 플랜 좌석이 충분해야 하며, 그렇지 않으면 좌석 한도 화면이 정상적인 거부다. 같은 방식으로 melocream의 가입 이메일에도 별도 링크를 만든다.
4. 각 수신자가 받은 링크를 `/join/<token>`에서 연다. 로그아웃 상태의 정상 화면은 `하이프마크 팀 초대`, 조직·역할 정보, `로그인하고 수락`/`계정 만들기`다. 초대받은 이메일로 로그인하면 `소속을 확인해 주세요`, `조직: 하이프마크`, 역할 `멤버`, `수락하고 참여`가 뜬다. 조직 초대만 보낸 경우 팀 행은 현재 계약상 `(팀 없음)`이 정상이다. 프로젝트를 함께 초대했다면 유효한 프로젝트 이름이 추가된다.
5. `수락하고 참여`를 누른다. 정상은 초록 체크와 `하이프마크 소속이 확정됐습니다`, `앱 다운로드`다. 첫 수락은 `noop: false`, 같은 링크를 다시 눌렀을 때는 `이미 수락한 초대입니다` 흐름(`noop: true`)이다. 조직 관리자로 다시 조직 홈을 열면 `데이터팀` 라벨과 결합 프로젝트가 보인다. 수락한 일반 멤버의 조직 사용량·결합 프로젝트는 현재 `restricted` 정책에 따라 관리자용으로 보이지 않는다.

이 시연은 Phase 2 대시보드를 시연하는 절차가 아니다. 현재 조직 인스턴스는 0건이고, 조직 사용량 롤업은 `미구현`이므로 숫자나 조직 총계를 기대하면 안 된다.

## 근거 좌표

- 웹 계약: `marblo-web/src/lib/orgOnboarding.ts:1-37, 257-395`
- 조직 라우트·착지: `marblo-web/src/app/[locale]/org/page.tsx:1-12`, `marblo-web/src/app/[locale]/org/OrgLandingClient.tsx:62-169`, `marblo-web/src/app/[locale]/org/orgContract.ts:167-237`
- 조직 생성 화면: `marblo-web/src/app/[locale]/org/new/page.tsx:34-137`, `marblo-web/src/app/[locale]/org/new/OrgIntakeViews.tsx:64-175`
- 조직 홈·팀 라벨·초대: `marblo-web/src/app/[locale]/org/OrgHomeClient.tsx:200-249, 252-479, 482-794`, `marblo-web/src/app/[locale]/org/OrgViews.tsx:141-264`
- 수락 화면: `marblo-web/src/app/[locale]/join/[token]/page.tsx:43-260`, `marblo-web/src/app/[locale]/join/[token]/JoinViews.tsx:114-268, 271-380`
- 서버 계약: `v3/functions/src/index.ts:18415-18535, 18630-18958, 19150-19453`; 순수 판정·좌석: `v3/functions/src/orgOnboarding.ts:248-490, 492-646`
- rules 게이트: `v3/firestore.rules:456-499, 895-954, 1316-1325`
- 팀 라벨 결합: `v3/functions/src/index.ts:18171-18412`
- 조직 인스턴스 컬렉션 상수: `v3/functions/src/orgStructure.ts:30-40`
- Phase 2 미배선 판정: `marblo-web/src/app/[locale]/org/orgContract.ts:250-273`, `docs/org-analytics-b2b-design-2026-08-31.md:152-165, 293-302`

