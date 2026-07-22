# L2 원장 read 스코프 — 배포 전 라이브 3경로 검증 체크리스트

**티켓:** 9YhBiTFFeVB8zn7A8wdx
**대상:** `audit_logs` / `merge_history` / `telemetry_events` read 를 `isProjectMember()`
로 조이는 룰 배포 (`firestore.rules`)
**전제:** L1.6 update 규칙(`allow update: if request.resource.data == resource.data`)이
함께 배포됨. 현재 배포된 룰(07-18)은 `update:false` 라 스풀 고착 위험이 남아 있으므로
L2 배포 시 L1.6 도 함께 나가야 한다.

> ★★이 문서는 **배포 절차서가 아니라 배포 전 게이트**다. 아래 항목이 전부
> 초록이기 전에는 `firebase deploy --only firestore:rules` 를 실행하지 않는다.
> 룰 조이기로 이 프로젝트에서 이미 두 번 라이브가 죽었다(#406 전면
> permission-denied, #428 라이브 얼음). **테스트 통과 ≠ 라이브 인증 성공.**

---

## 0. 배포 순서 (순서 자체가 안전장치, 스펙 §9)

룰 파일은 원자적으로 배포된다 — 세 컬렉션이 동시에 조여진다. 따라서 아래 선행
코드 변경이 **라이브에 먼저 반영**돼 있어야 한다.

1. **[선행/프론트]** 코크핏 merge_history 크로스프로젝트 쿼리를 멤버 프로젝트로
   스코프 (아래 §2). — **이게 안 되면 룰 배포 즉시 코크핏이 죽는다.**
2. **[이 배포]** `firestore.rules` (L1.6 + L2) 배포.
3. **[배포 직후]** 아래 §3 라이브 3경로 왕복 검증.
4. 이상 발견 시 즉시 revert (이전 배포 룰로 롤백).

---

## 1. 배포될 변경의 요지

| 컬렉션             | 이전 read           | 이후 read                                            |
| ------------------ | ------------------- | ---------------------------------------------------- |
| `audit_logs`       | `isAuthenticated()` | 멤버(`isProjectMember`) + `projectId==""` 는 admin만 |
| `merge_history`    | `isAuthenticated()` | 동일 (`canReadLedgerDoc()`)                          |
| `telemetry_events` | `isAuthenticated()` | 동일 (`canReadLedgerDoc()`)                          |

- `create` / `update`(L1.6 멱등 재시도) / `delete` 는 **건드리지 않았다.**
- `projectId==""` 예외: 오버플로 tombstone·미해결 lifecycle 마커(ledger-spool.ts:577,837)
  는 특정 프로젝트에 귀속되지 않는다. 멤버 스코프로만 조이면 유실의 기록이 다시
  유실되므로, **플랫폼 admin 만** 읽게 열어 유실 가시성을 보존한다.

---

## 2. ★선행 필수 — merge_history 크로스프로젝트 쿼리 스코프 (프론트)

**문제:** `WorktreeTab.tsx`, `WorkHistoryTab.tsx` 가 `subscribeToMergeHistory` 를
`projectId` 없이(unscoped `orderBy('mergedAt')`) 구독한다. 멤버 스코프 룰 하에서
Firestore 는 **비멤버 문서를 포함할 수 있는 unscoped 쿼리를 통째 permission-denied
로 거부**한다(룰은 필터가 아니다). → 룰만 먼저 배포하면 코크핏 완료이력/워크트리
탭이 라이브에서 죽는다. 이 계약은 테스트로 못 박혀 있다(`merge_history — L2 read
스코프 > ★unscoped 크로스프로젝트 list 쿼리는 거부된다`).

**조치:** 이 티켓에서 `mergeHistoryService.subscribeToMergeHistory` 에 `projectIds`
옵션을 추가해 두었다(`where('projectId','in', [...])`, 최대 30, 기존 복합 인덱스
재사용). 프론트는 두 탭에서 **사용자가 속한 프로젝트 목록**을 넘겨 호출하도록
바꾼다.

- [ ] `WorktreeTab.tsx` — `subscribeToMergeHistory(cb, { projectIds: <내 프로젝트들>, maxResults })`
- [ ] `WorkHistoryTab.tsx` — 동일. (이미 클라 필터 `entry.projectId !== projectId`
      가 있으므로 단일 `projectId` 스코프로도 충분)
- [ ] 멤버 프로젝트가 30개 초과인 팀이 있는지 확인 — 있으면 페이지네이션/합집합
      전략 필요(현재는 앞 30개 절단 + 최신순 limit).
- [ ] 프론트 변경을 로컬 에뮬레이터(조인 룰)로 왕복 확인 후 라이브 반영.

> 프론트 컴포넌트 수정은 이 백엔드 티켓의 스코프 밖이다(별도 프론트 티켓 필요).
> 서비스 계층 훅(`projectIds`)까지는 이 PR 에 포함돼 있다.

---

## 3. ★라이브 3경로 R/W 왕복 (코드 테스트로 대체 불가, 스펙 §9/§12)

에뮬레이터는 렌더러 auth 만 흉내낸다. #406 은 **메인 프로세스**가, #428 은 **토큰
왕복**이 죽은 사고다 — 실제 라이브에서 세 프로세스가 각자의 인증 경로로 붙는지
직접 확인해야 한다. 사장님 복귀 후 함께 수행한다.

### 3-a. 렌더러 (실 사용자 auth)

- [ ] 로그인 후 **완료 이력(WorkHistory)** 탭 — merge_history 가 정상 로드되는가
      (permission-denied 콘솔 에러 없음).
- [ ] **Worktrees** 탭 — 크로스프로젝트 목록이 스코프 쿼리로 로드되는가.
- [ ] 감사 뷰(auditService, `where projectId==현재프로젝트`) — audit_logs 정상 로드.
- [ ] 브라우저 콘솔에 `permission-denied` / `Missing or insufficient permissions`
      가 하나도 없어야 한다.

### 3-b. MCP 서버 (에이전트 프로세스, custom-token auth)

- [ ] 에이전트를 스폰해 아무 MCP 툴(add_activity 등)을 호출 → audit_logs 에
      **create** 가 성공하는가 (read 조이기가 create 를 깨지 않았는지; create 규칙은
      안 건드렸지만 라이브 확인).
- [ ] `get_ledger_spool_status` 로 스풀이 비어가는가(park/고착 없이 배수되는가).
- [ ] `verifyLedgerRecord` 경로: 정상 projectId 레코드는 read 성공, `projectId==""`
      tombstone 은 read 거부→null(미상) 처리로 **고착 없이** 다음 레코드로 진행하는가.
      (tools.ts:916-919 설계 그대로 동작하는지 로그로 확인)

### 3-c. 메인 프로세스 (Electron main, merge_history writer)

- [ ] 실제 워크트리 머지를 한 건 수행 → main 이 merge_history 에 **create** 성공하는가
      (#406 이 정확히 main 인증 실패였다).
- [ ] 머지 직후 렌더러 완료 이력에 그 항목이 스코프 쿼리로 나타나는가.

### 3-d. admin 유실 가시성 (선택)

- [ ] 플랫폼 admin 클레임 계정으로 `projectId==""` tombstone 조회가 가능한가
      (일반 멤버로는 거부되는가). — 헬스뷰가 붙기 전이라면 콘솔/스크립트로 1건 확인.

---

## 4. 롤백 기준

아래 중 하나라도 관측되면 즉시 이전 배포 룰로 롤백:

- 렌더러/메인/MCP 어느 경로든 `permission-denied` 가 정상 동작 중 발생.
- 스풀이 특정 레코드에서 고착(get_ledger_spool_status 가 줄지 않음).
- 완료 이력/워크트리 탭이 빈 화면 또는 로딩 무한.

롤백은 코드 revert 가 아니라 **직전 배포 룰 재배포**로 한다(가장 빠르다).

---

## 5. 이 티켓에서 검증 완료된 것 (에뮬레이터, 라이브 아님)

- `npm run test:rules` — **106/106 통과** (새 룰).
- ★가드 실효성 — 새 read-스코프 테스트 9건이 **옛 룰에서 실패, 새 룰에서 통과**
  함을 확인(구멍을 실제로 막는지 증명). 옛 룰 실행 시 정확히 그 9건만 fail.
- 커버리지: (a) 타 테넌트 read 거부 (b) 정상 멤버 read 허용 (c) `projectId==""`
  tombstone = 멤버 거부 / admin 허용 (d) merge_history unscoped list 거부 +
  스코프 list 허용.
