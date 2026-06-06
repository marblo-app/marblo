# Worktree-per-task 격리 + 머지 칵핏 — 설계 스펙

- **상태**: 설계 승인 대기 (브레인스토밍 완료)
- **작성일**: 2026-06-05
- **TaskForce 티켓**: `4ac84c57-6941-4983-9780-746fb12ff22b`
- **관련**: `v3/docs/MISSIONS-SPEC.md` (오케스트레이터·dispatch·리뷰 워크플로우)

---

## 1. 배경 / 문제

현재 Marblo v3는 에이전트를 **프로젝트 폴더 하나(공유 워킹카피)를 `cwd`로** 실행하고, 격리는 PTY + Claude 세션 라벨로만 한다 (`electron/agent-manager.ts`의 `cwd` 기반 spawn, `git worktree`/`checkout -b` 코드 없음). 따라서 **같은 프로젝트에 에이전트 2개를 동시에 돌리면 서로의 파일을 밟을 수 있다.**

비교 대상(Conductor, Crystal, Claude Squad, vibe-kanban, Cursor 백그라운드 에이전트)은 예외 없이 **1 에이전트 = 1 git worktree = 1 브랜치**를 격리 프리미티브로 쓴다. Marblo만 공유 워킹카피라는 점이 구조적 약점이다.

동시에, 사용자가 원하는 것은 **여러 프로젝트의 워크트리와 머지 상태를 한 화면에서 보는** 크로스 프로젝트 포트폴리오 뷰다. 조사 결과 이 영역(멀티-repo × 리스트레벨 머지상태)은 경쟁 도구들이 대부분 비워둔 곳이다.

## 2. 목표 / 비목표

**목표 (v1)**

- 모든 에이전트를 자신의 git worktree에서 실행하여 동시성 충돌 제거.
- Board 태스크 ↔ 워크트리 ↔ 에이전트를 1:1로 묶어, 머지 readiness를 태스크 단위로 추적.
- 크로스 프로젝트 Worktree 탭(칵핏): 행마다 브랜치·ahead/behind·충돌 여부·diff stat·상태 pill·액션.
- Review 단계를 "작업 검토 + 머지 readiness 검토 + 머지 실행"으로 확장. 플러그형 오너.
- stale 워크트리 위생(이미 머지됨 / 무활동 / 정리 가능) 표시 + 일괄 cleanup.

**비목표 (v1 제외 → 후속)**

- GitHub PR/CI 상태 pill (v1.1, `gh`/octokit 인증 필요). Marblo는 이미 `Project.gitRemoteUrl` 보유 → 연결만 추가.
- 1 태스크 = N 워크트리 (모델 레이스: Claude/Codex/Antigravity 병렬 시도 후 베스트 머지). 데이터모델만 대비, UI/실행은 v2.
- 비코딩(오피스/PPT) 미션과의 연계.

## 3. 핵심 모델 (확정)

```
Board 태스크  ↔  워크트리  ↔  에이전트      (엄격 1:1)
   │              │             │
 status        branch        cwd = 워크트리 경로
 (Todo→IP→     marblo/<slug>-<taskId8>
  Review→Done)
```

- **모든 에이전트는 워크트리에서 실행** (전면 도입).
- **1 태스크 = 1 워크트리 = 1 에이전트** (엄격 1:1). 단, 데이터모델은 `Worktree.taskId`를 **nullable many-to-one**로 두어 향후 N(모델 레이스) 확장을 막지 않는다.
- **ad-hoc 에이전트(Board 태스크 없이 즉석 실행)는 즉석 태스크를 자동 생성**한다 → 불변식: _모든 워크트리는 태스크를 가진다_, _Board는 모든 작업의 인덱스다_. ad-hoc 태스크는 별도 레인/필터로 Board 잡음 최소화.

## 4. 워크트리 라이프사이클

| 단계 | Board status           | 워크트리 동작                                                          |
| ---- | ---------------------- | ---------------------------------------------------------------------- |
| 생성 | Todo → **In Progress** | `git worktree add` (에이전트 spawn 직전), 에이전트 cwd = 워크트리 경로 |
| 작업 | In Progress            | 에이전트가 워크트리 안에서 편집/커밋                                   |
| 검토 | **Review**             | diff + ahead/behind + 충돌 계산, 머지 오너가 검토                      |
| 머지 | Review → **Done**      | rebase onto base → squash → merge to default → worktree+branch 삭제    |
| 반려 | Review → In Progress   | 빌더 에이전트에 피드백 (`add_pending_instruction`/`check_feedback`)    |

- **브랜치 네이밍**: `marblo/<slug>-<taskId8>` (slug = 태스크 제목 케밥, taskId 앞 8자).
- **base ref**: `origin/<default-branch>`에서 fresh. 원격이 없으면 로컬 default 브랜치 HEAD.
- **물리 위치**: `~/.marblo/worktrees/<projectId>/<taskId>/` — **메인 워킹카피 밖**에 두어 파일워처/에디터/`git status` 오염을 피한다.
- **세션 resume**: 1 태스크 = 1 워크트리라 태스크 생애 동안 cwd가 안정적이므로 Claude 세션 resume(cwd 기반)이 자연 동작한다. 부작용은 "한 프로젝트가 태스크 수만큼 세션 디렉토리를 가짐"인데, 이는 작업 단위와 일치하고 머지 후 정리되면 함께 사라진다.
- **stale 감지**: 브랜치가 이미 base에 머지됨 / N일 무활동 / (v1.1) PR closed → 행에 ⚠️ + 일괄 cleanup 제공.

## 5. 머지 상태 데이터 (각 행)

각 워크트리 행이 표시/계산하는 값:

| 필드                                   | 산출 방법                                       |
| -------------------------------------- | ----------------------------------------------- |
| `branch`, `base`                       | `git rev-parse`, worktree 메타                  |
| `ahead` / `behind`                     | `git rev-list --left-right --count base...HEAD` |
| `dirty` (uncommitted)                  | `git status --porcelain`                        |
| `mergeable` vs `conflict`              | `git merge-tree`(드라이런) base vs HEAD         |
| `diffStat` (+/−)                       | `git diff --shortstat base...HEAD`              |
| `lastActivity`                         | 마지막 커밋/에이전트 활동 시각                  |
| `agentStatus`, `taskStatus`, `project` | 기존 스토어                                     |
| (v1.1) `pr`, `ci`                      | GitHub API                                      |

상태 pill: 🟢 머지가능 · 🟡 뒤처짐(rebase 필요) · 🔴 충돌 · ⚪ 작업중 · ⚠️ stale.

## 6. Review 단계 = 머지 오너가 있는 단계

리뷰 오너는 **플러그형**: `{ 사람 | 오케스트레이터 | 할당 에이전트 }`.

```
In Progress ─submit_for_review─▶ Review ─merge─▶ Done(cleanup)
 (빌더 에이전트)                   │ owner = {사람|오케스트레이터|할당에이전트}
                                  │  ① diff 리뷰 (/review·/code-review)
                                  │  ② readiness 체크 (ahead/behind·충돌)
                                  │  ③ 뒤처지면 rebase / 충돌이면 resolve(agent)
                                  │  ④ 통과→squash-merge  /  반려→In Progress 킥백
```

- **v1 기본 오너 = 휴먼 게이트 + 위임 가능**: 최종 "머지" 클릭은 사람. 단 diff 리뷰·충돌 해결·rebase는 오케스트레이터나 할당 에이전트에 위임 가능. **"green이면 자동 머지" 토글은 옵트인**.
- **머지 실행 주체**:
  - 클린 경로 → Marblo가 git 직접 실행 (`rebase onto base → squash → merge to default → worktree/branch 삭제`). 빠르고 결정적.
  - 충돌 경로 → 워크트리에 **에이전트 spawn**해 충돌 해결 (Conductor `/resolve-merge-conflicts` 방식).
- 반려 루프: 기존 `add_pending_instruction` / `check_feedback` / `submit_for_review` 재사용.

## 7. UI

### 7.1 Worktree 탭 (크로스 프로젝트 칵핏)

```
┌─ Worktrees ──────────────────── [All projects ▾] [●Mergeable] [Status ▾] ┐
│ ▸ marblo (3)                                                              │
│   로그인 버그 수정     Claude     marblo/login-fix   +42/-8   🟢 머지가능   │
│        ▲3 ▼0  충돌없음            [Rebase][Merge][Open][✕]                │
│   대시보드 리팩터      Codex      marblo/dash        +120/-30 🟡 뒤처짐    │
│        ▲5 ▼12 rebase필요         [Rebase][Merge][Open][✕]                │
│   (ad-hoc) 탐색       Claude     marblo/adhoc-7a    +0/-0    ⚪ 작업중    │
│ ▸ shop-api (1)                                                            │
│   결제 엔드포인트      Antigrav   marblo/pay         +88/-2   🔴 충돌      │
│        ▲2 ▼4  2 conflicts        [Resolve(agent)][Open][✕]              │
└───────────────────────────────────────────────────────────────────────────┘
```

- 프로젝트별 그룹, 행 = 태스크/워크트리. 필터(프로젝트·상태·mergeable).
- 행 액션 (v1): `Rebase from main · Squash-merge · Resolve(agent, 충돌 시) · Open(Code탭/터미널) · Delete/cleanup`. (PR 액션은 v1.1)
- 초기엔 `DEV_ONLY_TABS`(현 `flows`/`deploy` 패턴)로 가드 후 안정화되면 노출.

### 7.2 Board 통합 (가볍게)

Board 카드에 작은 **머지 pill + 브랜치 링크**만 얹는다. 무거운 머지/정리는 Worktree 탭에서.

### 7.3 Code 탭 = 워크트리 인식

편집이 워크트리에서 일어나므로 **Code 탭은 선택된 태스크의 워크트리를 가리킨다** (워크트리 셀렉터 추가). 알려진 UX 변경.

## 8. 아키텍처 / 플러밍 (재사용 ~70%)

**신규**

- `electron/worktree-manager.ts`: `create / list / remove / status(ahead-behind·conflict·diffstat) / merge / rebase` — git raw spawn (기존 `electron/fs-manager.ts`의 git 패턴 일치, `simple-git`은 미사용 유지).
- IPC 네임스페이스 `worktree:` (`electron/preload.ts` + `electron/main.ts` 핸들러). on-demand refresh + 에이전트 상태변경 이벤트 시 갱신.
- `src/components/tabs/WorktreeTab.tsx` + `TabBar.tsx`에 `TabId` 등록 + `Layout.tsx` 매핑.
- `src/stores/worktreeStore.ts`: 워크트리 목록/상태 캐시.

**기존 수정**

- `electron/agent-manager.ts`: spawn 훅 — 런치 전 워크트리 생성/attach, 에이전트 `cwd`를 워크트리 경로로.
- 태스크 생성 경로: ad-hoc 에이전트 spawn 시 즉석 태스크 자동 생성.
- 멀티프로젝트 스코핑(`src/stores/projectStore.ts`, `main.ts` 창→프로젝트 라우팅)·IPC·TabBar는 그대로 재사용.

**데이터 모델**

```ts
interface Worktree {
  id: string;
  taskId: string | null; // nullable many-to-one (N 확장 대비)
  projectId: string;
  agentId: string | null;
  branch: string;
  baseRef: string;
  path: string; // ~/.marblo/worktrees/<projectId>/<taskId>
  createdAt: Date;
  status: WorktreeStatus; // 계산 캐시: ahead/behind/dirty/mergeable/...
}
```

## 9. 에러 처리 / 엣지

- `git worktree add` 실패(경로 충돌·디스크): 태스크를 Blocked로, 사용자에 표면화.
- 머지 중 충돌: 직접 머지 중단 → Resolve(agent) 경로로 전환.
- 워크트리 경로 수동 삭제/오염: list 시 prune(`git worktree prune`) + 고아 표시.
- 원격 없음: base = 로컬 default HEAD, PR 액션 비활성.
- 앱 재시작: 워크트리는 디스크에 영속 → 부팅 시 `git worktree list`로 재수화.

## 10. 테스트

- **유닛**: `worktree-manager` git ops(생성/목록/삭제/ahead-behind/충돌감지/머지)를 temp git fixture로.
- **Playwright @unit**: Worktree 탭 렌더·pill·액션 회귀가드 (기존 `afd2819` 미션탭 smoke 패턴).
- **통합**: spawn → 워크트리 생성 → cwd 정확 → 머지 후 cleanup 전체 플로우.

## 11. 단계 (구현 분해는 writing-plans에서 확정)

1. `worktree-manager` + 유닛 테스트 (git ops).
2. agent-manager spawn 훅 + ad-hoc 자동 태스크 (cwd 격리 발효).
3. IPC `worktree:` + `worktreeStore`.
4. `WorktreeTab` UI (읽기 + 상태 pill) — DEV_ONLY 가드.
5. 머지 액션(클린 직접 / 충돌 agent) + Review 오너 통합.
6. Board pill + Code 탭 워크트리 인식.
7. stale 위생 + 일괄 cleanup.

**v1.1+**: GitHub PR/CI pill, 모델 레이스(1:N), 자동머지 정책 고도화.
