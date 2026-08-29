# 원장 열람 권한 세분화 설계

작성일: 2026-08-29
범위: 설계와 판정만. 구현, `firestore.rules` 변경, UI 변경 없음.

## 결론

원장 열람 때문에 새 역할을 늘리지 않는다. 기존 `owner · admin · member · viewer` 역할은 저장소 write, merge, 멤버 관리처럼 큰 책임 묶음을 계속 표현하고, 프로젝트탭 전체 원장 열람은 `memberRoles/{projectId}_{uid}` 문서의 좁은 권한 플래그로 분리한다.

권장 모델:

```ts
type ProjectRole = "owner" | "admin" | "member" | "viewer";

interface MemberRoleGrants {
  viewProjectLedger?: boolean;
}
```

효과 판정은 `canViewProjectLedger(role, grants) = role === "owner" || role === "admin" || grants.viewProjectLedger === true` 로 둔다. 이 판정은 프로젝트탭 원장 화면과 `projectAuditLog` read 확장에만 쓴다. `audit_logs`, `merge_history`, `ledger_checkpoints`, `telemetry_events` 의 `canReadLedgerDoc()` 등급은 조이지 않는다.

## 현황 표

줄번호는 이 워크트리 기준이다.

| 역할 | 원장 | 히스토리 | 워크트리 | 에이전트 | 보드 | 저장소 write |
| --- | --- | --- | --- | --- | --- | --- |
| owner | 프로젝트탭 원장 표시 가능. `ProjectTab` 이 `canViewAuditLog(currentRole)` 로 패널을 렌더하고, `canViewAuditLog` 는 `manage_members` 기반이라 owner/admin만 참이다. `projectAuditLog` read 도 `isAdminOrOwner` 다. 근거: `v3/src/components/project/ProjectTab.tsx:115-216`, `v3/src/lib/teamRoles.ts:31-55`, `v3/firestore.rules:698-700`. raw `audit_logs`/`merge_history` read 는 프로젝트 멤버 경계다. 근거: `v3/firestore.rules:89-97`, `v3/firestore.rules:644-645`, `v3/firestore.rules:723-724`. | 현재 프로젝트의 DONE 태스크 전체와 현재 프로젝트 `merge_history` 를 본다. role gate 없음. 근거: `v3/src/components/work-history/WorkHistoryTab.tsx:297-300`, `v3/src/lib/workHistoryFilter.ts:143-162`, `v3/src/components/work-history/WorkHistoryTab.tsx:393-410`. | 로컬 Electron main 이 열거한 워크트리를 본다. 역할별 read gate 없음. 머지 가능 판정은 owner/admin. 근거: `v3/src/stores/worktreeStore.ts:324-335`, `v3/src/components/tabs/WorktreeTab.tsx:695-715`, `v3/src/hooks/useMergePermission.ts:7-15`. | 현재 rules 기준으로 프로젝트 멤버면 agent read/create/update/delete 가능. 화면 구독도 `projectId` 단위다. 병렬 티켓은 여기서 기기 축을 추가 중이다. 근거: `v3/firestore.rules:348-358`, `v3/src/stores/agentStore.ts:93-115`. | tasks read/create/update/delete 는 프로젝트 멤버면 가능하고, REVIEW->DONE 만 owner/admin 이다. 근거: `v3/firestore.rules:334-345`. 보드 UI는 role gate 없이 구독, DnD 상태 변경, New Task 버튼을 제공한다. 근거: `v3/src/components/board/KanbanBoard.tsx:160-205`, `v3/src/components/board/KanbanBoard.tsx:528-534`. | App 경로 write 가능, 기본 브랜치 push/merge 가능. 근거: `v3/functions/src/githubApp.ts:222-249`, `v3/functions/src/githubApp.ts:373-375`, `v3/functions/src/githubApp.ts:768-770`. |
| admin | owner와 동일하게 프로젝트탭 원장 표시 가능, `projectAuditLog` read 가능. 단 billing/delete_project 는 owner 전용 역할표다. 근거: `v3/src/types/invitation.ts:25-37`. | owner와 동일하게 현재 프로젝트 전체 완료 히스토리를 본다. | owner와 동일하게 로컬 워크트리를 보며, merge 가능 판정은 true. | owner와 동일한 프로젝트 멤버 기반 agent 접근. | owner와 동일하게 REVIEW->DONE 가능. | App 경로 write 가능, 기본 브랜치 push/merge 가능. |
| member | 프로젝트탭 원장 패널은 안 보인다. `ROLE_PERMISSIONS.member` 에 `manage_members` 가 없고 `canViewAuditLog` 는 `canViewWorkload` 를 재사용한다. 근거: `v3/src/types/invitation.ts:35-37`, `v3/src/lib/teamRoles.ts:31-55`, `v3/src/components/project/ProjectTab.tsx:115-216`. 다만 raw `audit_logs`/`merge_history` 는 프로젝트 멤버라 read 가능하다. | 현재는 본인 것만이 아니라 현재 프로젝트 DONE 태스크 전체와 현재 프로젝트 `merge_history` 를 본다. 근거는 owner 행과 동일. | 로컬 워크트리 목록을 본다. 기본 브랜치 merge 판정은 false. 근거: `v3/src/hooks/useMergePermission.ts:45-49`, `v3/src/lib/teamRoles.ts:15-20`. | 현재 rules와 구독 기준으로 프로젝트 agent 문서를 본다. 병렬 티켓 `zr4eKx7OOuo6GsYSNbLo` 는 non-owner 에게 foreign/legacy machine agent 를 숨기는 방향으로 REVIEW 상태다. | Firestore rules 상 task write 대부분 가능하나 REVIEW->DONE 은 불가. 역할표상 `member` 는 `read/write` 만 있다. 근거: `v3/firestore.rules:334-345`, `v3/src/types/invitation.ts:35-37`. | App 경로 feature branch write 가능. 기본 브랜치 push/merge 불가. 근거: `v3/functions/src/githubApp.ts:222-249`, `v3/functions/src/githubApp.ts:768-770`. |
| viewer | 프로젝트탭 원장 패널은 안 보인다. `ROLE_PERMISSIONS.viewer` 는 `read` 뿐이다. 근거: `v3/src/types/invitation.ts:35-37`, `v3/src/lib/teamRoles.ts:31-55`. raw `audit_logs`/`merge_history` 는 프로젝트 멤버면 read 가능하다. | 현재는 본인 것만이 아니라 현재 프로젝트 DONE 태스크 전체와 현재 프로젝트 `merge_history` 를 본다. | 로컬 워크트리 목록을 본다. merge 판정은 false. | 현재 rules와 구독 기준으로 프로젝트 agent 문서를 본다. 병렬 기기 격리 티켓이 이 표시 범위를 좁히는 중이다. | 역할표상 read-only 이지만, rules 는 프로젝트 멤버이면 task create/update/delete 를 허용하고 REVIEW->DONE 만 막는다. 근거: `v3/src/types/invitation.ts:35-37`, `v3/firestore.rules:334-345`. | App 경로 write 요청은 role gate 에서 거부된다. 근거: `v3/functions/src/githubApp.ts:222-238`, `v3/functions/src/githubApp.ts:373-375`. |

추가 근거:

- 역할 enum 은 네 개뿐이다. `v3/functions/src/githubApp.ts:208`, `v3/src/types/invitation.ts:1`.
- owner 는 프로젝트 `ownerId` 에서 판정하고, 멤버 role 문서가 없으면 member 로 접는다. 근거: `v3/firestore.rules:37-58`, `v3/src/services/teamService.ts:386-402`, `v3/src/hooks/useTeam.ts:127-130`.
- `projectAuditLog` 와 `audit_logs` 는 접근등급이 달라 분리됐다. `audit_logs` 를 owner/admin 으로 조이면 `ActivityStreamPanel` 이 죽는다고 서비스와 룰 주석이 명시한다. 근거: `v3/src/services/projectAuditService.ts:1-37`, `v3/firestore.rules:677-700`, `v3/src/components/project/ProjectAuditPanel.tsx:59-71`.
- 우측 액티비티 스트림은 `audit_logs` 를 프로젝트 단위로 구독한다. 근거: `v3/src/services/activityStreamService.ts:1-12`, `v3/src/services/activityStreamService.ts:178-204`.

## 빈 칸

현재 모델은 "팀에 참여하고 보드/저장소 작업은 member 수준으로 하되, 프로젝트탭 전체 원장은 봐야 하는 사람"을 표현하지 못한다. 예를 들어 PM, 감사역, 외부 운영 리뷰어는 `member` 로 두면 원장 패널이 닫히고, `admin` 으로 올리면 merge, 멤버 관리, 프로젝트 관리 권한까지 같이 열린다.

`viewer` 에게 원장을 열고 싶은 경우도 비슷하다. `viewer` 는 저장소 write 를 주면 안 되지만 원장만 볼 수는 있어야 할 수 있다. 지금은 `viewer` 와 "원장 열람자"를 동시에 표현할 칸이 없다.

## 역할 추가 vs 권한 플래그

### 역할 추가

장점:

- 단일 `role` 문자열만 보면 되므로 UI와 rules 판정이 단순하다.
- 기존 초대/역할 UI의 사용자 모델과 맞다.

문제:

- 필요한 조합이 바로 폭발한다. `member + ledger`, `viewer + ledger`, 나중의 `member + workload`, `viewer + export` 같은 조합마다 새 역할이 필요하다.
- 저장소 권한과 감사 열람 권한이 한 축에 섞인다. `admin` 은 이미 write, merge, manage_members 를 의미한다. 여기에 `auditor` 를 추가하면 `auditor` 가 write 가능한지, merge 가능한지, 멤버 관리 가능한지를 매번 다시 정의해야 한다.
- 변경 표면이 넓다. 최소한 `ProjectRole`, `InvitationRole`, `ROLE_PERMISSIONS`, `githubApp` 의 write/merge 판정, `teamRoles`, `memberRoles` rules, TeamManagement 선택지와 테스트가 모두 바뀐다. 근거 위치: `v3/functions/src/githubApp.ts:208-249`, `v3/src/types/invitation.ts:1-37`, `v3/src/lib/teamRoles.ts:15-63`, `v3/firestore.rules:807-831`.

### 권한 플래그

장점:

- 역할은 기존의 큰 책임 묶음으로 유지된다. 저장소 write/merge/member 관리와 원장 열람을 분리할 수 있다.
- "member 인 PM" 과 "viewer 인 감사역" 을 새 역할 없이 표현한다.
- owner/admin 기존 동작은 계산식으로 그대로 이어받을 수 있다.

문제:

- 플래그가 흩어지면 판정이 추적 불가능해진다.
- Firestore rules, UI, 초대/관리 화면, 테스트가 같은 플래그 스키마를 공유하지 않으면 drift 가 생긴다.

### 판정

권한 플래그를 선택한다. 단, 플래그를 흩뿌리지 않고 `memberRoles/{projectId}_{uid}` 의 `grants.viewProjectLedger` 한 곳에만 둔다. 이 문서는 이미 프로젝트별 사용자 권한의 결정적 ID, 조회 경로, 관리 UI가 연결된 곳이다. 새 컬렉션을 만들면 rules get 비용과 동기화 축이 늘고, 역할을 늘리면 저장소 권한까지 재정의해야 한다.

구현 시에는 다음 원칙을 둔다.

- `role` 은 coarse role 이다: owner/admin/member/viewer.
- `grants` 는 role 을 보완하는 명시 grant 다.
- 첫 grant 는 `viewProjectLedger` 하나만 둔다. 추가 grant 는 별도 설계 없이는 금지한다.
- 판정 함수는 한 곳에 둔다: `canViewProjectLedger(role, grants)`.
- rules helper 도 같은 이름과 같은 의미로 둔다.
- 권한 변경 자체는 `projectAuditLog` 에 남긴다. 원장 열람 권한은 감사 대상이다.

## 히스토리와 원장의 경계

`merge_history` 는 원장이다. 이것을 "내 히스토리" 요구에 맞춰 같이 조이면 팀이 "무엇이 머지됐나"를 보는 원장 기능이 죽는다. 현재 타입도 `merge_history` 를 "completed worktree audit trail" 로 정의하고, 행에는 `projectId`, `taskId`, `repoRoot`, `branch`, `baseRef`, `headSha`, `mergedAt` 이 있다. 근거: `v3/src/types/mergeHistory.ts:1-23`.

따라서 질문을 둘로 나눈다.

- 프로젝트 원장: "이 프로젝트에서 무엇이 일어났고 무엇이 머지됐나." 소스는 `projectAuditLog`, `audit_logs`, `merge_history` 다. 열람자는 owner/admin 또는 `grants.viewProjectLedger` 사용자다.
- 개인 히스토리: "내가 실행한 워크트리 결과가 무엇인가." 소스는 task/result attribution 이고, `merge_history` 는 이미 개인 범위로 선택된 task 에 merge commit/diff 링크를 붙이는 보조 증거로만 쓴다.

"내 워크트리 결과"의 정의:

1. 계정 축: 실행 주체가 현재 사용자여야 한다. 새 durable 필드로 `tasks.executionOwnerUid` 또는 별도 결과 문서의 `ownerUid` 를 남긴다.
2. 기기 축: 워크트리/PTY처럼 실제 로컬 리소스를 여는 동작은 local `machineId` 와 일치해야 한다. 병렬 티켓 `zr4eKx7OOuo6GsYSNbLo` 의 판정과 맞춘다.
3. 식별 축: worktree id 는 `<projectId>/<taskId>` 규약을 쓴다. 기존 ledger code 가 이 규약을 경로에서 파생한다. 근거: `v3/electron/mcp-server/ledger.ts:80-140`, `v3/electron/mcp-server/tools.ts:2554-2578`.
4. legacy: 위 attribution 이 없는 과거 행은 "legacy shared history" 또는 "attribution unknown" 으로 표시하고, 원장 권한 없는 사용자에게는 개인 행으로 확정하지 않는다.

이 정의에 따르면 `WorkHistoryTab` 의 현재 프로젝트 전체 DONE 목록은 개인 히스토리가 아니다. 현재 구현은 `tasks` 를 현재 프로젝트 단위로 구독하고, `filterDoneTasks` 로 DONE 전체를 고른 뒤, 현재 프로젝트 `merge_history` 를 붙인다. 근거: `v3/src/components/work-history/WorkHistoryTab.tsx:297-300`, `v3/src/lib/workHistoryFilter.ts:143-162`, `v3/src/components/work-history/WorkHistoryTab.tsx:393-410`, `v3/src/components/work-history/WorkHistoryTab.tsx:591-605`.

## canReadLedgerDoc 유지

`canReadLedgerDoc()` 은 그대로 둔다. 이유:

- `audit_logs`, `merge_history`, `ledger_checkpoints`, `telemetry_events` 의 공통 read gate 다. 근거: `v3/firestore.rules:68-97`, `v3/firestore.rules:644-645`, `v3/firestore.rules:670-672`, `v3/firestore.rules:723-724`, `v3/firestore.rules:735-737`.
- 우측 `ActivityStreamPanel` 은 `audit_logs` 를 그대로 구독한다. 이것을 owner/admin 으로 조이면 일반 멤버의 액티비티가 끊긴다. 근거: `v3/src/services/activityStreamService.ts:178-204`.
- `ProjectAuditPanel` 주석도 같은 회귀를 명시한다. 근거: `v3/src/components/project/ProjectAuditPanel.tsx:59-71`.

필요한 변경은 화면과 `projectAuditLog` 쪽의 열람 확장이다.

- 화면: `ProjectTab` 의 `showAudit` 를 `canViewProjectLedger(currentRole, grants)` 로 바꾼다.
- rules: `projectAuditLog` read 를 `isAdminOrOwner(projectId) || hasProjectGrant(projectId, uid, "viewProjectLedger")` 로 넓힌다.
- raw ledger: `canReadLedgerDoc()` 은 건드리지 않는다.

## 병렬 티켓과의 정합성

`zr4eKx7OOuo6GsYSNbLo` 와의 경계:

- 그 티켓의 판정은 agent/worktree 의 기기 격리다. 완료 보고에 따르면 non-owner 에게 foreign/legacy machine agent 를 숨기고, owner 는 project-wide 플릿을 유지한다.
- 이번 설계는 원장 열람 grant 다. agent 기기 필터를 재구현하지 않는다.
- 개인 히스토리에서 로컬 워크트리/PTY를 여는 순간만 machineId 축을 참조한다.

`WE3s0pM7QOtZTsEhE96G` 와의 경계:

- 그 티켓은 프로젝트탭 원장 UI 정리다: 미션 섹션 제거, 전체 조회 페이지네이션, 워크체인 요약.
- 이번 설계는 해당 패널을 누가 볼 수 있는지의 판정만 바꾼다.
- 목록 병합, 페이지네이션, 워크체인 요약을 다시 제안하거나 중복 구현하지 않는다.

## 마이그레이션

무중단 원칙:

- owner/admin 은 flag 없이도 계속 `canViewProjectLedger === true` 다.
- 기존 `memberRoles` 문서에 `grants` 가 없으면 `{}` 로 접고, `viewProjectLedger` 는 false 다.
- owner 의 role 은 계속 `projects.ownerId` 에서 파생한다. owner 에게 별도 `memberRoles` backfill 을 요구하지 않는다.
- 기존 owner/admin 사용자가 어느 날 갑자기 원장을 못 보는 상태가 생기면 장애로 본다. 이를 막기 위해 UI와 rules 양쪽 테스트에 "owner/admin legacy doc without grants can view" 케이스를 넣는다.
- PM/감사역 부여는 점진적이다. 기존 member/viewer 가 자동으로 원장 열람자가 되지는 않는다. owner/admin 이 명시 grant 를 주는 순간부터 열린다.
- 구 클라이언트는 `memberRoles.grants` 를 모른다. 그래서 role 필드는 그대로 유지하고, 새 클라이언트만 grant UI를 노출한다.

## 다음 구현 티켓 분할안

1. 권한 모델 순수 함수와 타입
   - `InvitationRole` 주변에 `MemberRoleGrants` 타입 추가.
   - `canViewProjectLedger(role, grants)` 순수 함수 추가.
   - owner/admin legacy true, member/viewer default false, grant true 테스트.

2. Firestore rules 확장
   - `memberRoles` doc 의 `grants.viewProjectLedger` 스키마 검증.
   - `projectAuditLog` read 만 owner/admin 또는 grant 로 확장.
   - `canReadLedgerDoc()` 변경 금지 회귀 테스트.

3. 팀 관리 UI와 감사 기록
   - owner/admin 이 member/viewer 에게 `viewProjectLedger` 를 부여/회수하는 UI.
   - 권한 변경을 `projectAuditLog` 에 기록.
   - admin 이 어느 범위까지 grant 할 수 있는지는 구현 티켓에서 제품 최종 확인 필요. 기본 제안은 "이미 원장을 볼 수 있는 owner/admin 이 member/viewer 에게 위임 가능"이다.

4. ProjectTab 원장 게이트 적용
   - `showAudit` 를 새 판정으로 교체.
   - `ProjectAuditPanel` 의 permission-denied 부분 거부 처리는 유지.
   - WE3s0pM7QOtZTsEhE96G 의 원장 UI 변경과 충돌하지 않게 리베이스 후 최소 diff 로 적용.

5. 개인 히스토리 attribution
   - `WorkHistoryTab` 의 기본 범위를 개인 결과로 바꾸기 전에 durable owner attribution 을 먼저 만든다.
   - `tasks.executionOwnerUid` 또는 별도 result summary 문서 중 하나를 선택한다.
   - `merge_history` 는 개인 범위 필터의 원천으로 쓰지 않고, 선택된 task 의 merge evidence 로만 조인한다.
   - legacy unknown 행 표시 정책을 별도 테스트한다.

## 검증 계획

- `cd v3 && npx tsc --noEmit`
- rules 구현 티켓에서는 `npm run test:rules` 추가.
- GUI, Playwright, Electron 실행 금지.
