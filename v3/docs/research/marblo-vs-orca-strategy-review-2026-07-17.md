# Marblo vs Orca 전략/아키텍처 리뷰

- 작성일: 2026-07-17
- 티켓: `S3b6jx868jWE8brQ3v6Z`
- 범위: 리포트온리. 코드 변경/배포 없음.
- 입력 확인: 지시된 `v3/docs/research/orca-worktree-ux-benchmark.md`는 현재 워크트리에 존재하지 않아, 공개 웹 자료와 로컬 Marblo 문서/구현을 기준으로 검토했다.
- 관련 UX 티켓 상태: `xAzT6XpgQK3Lo71PaSyE`, `zNfJdSKEfhVw9Tgelkzn`, `0wjjQ3U5fZjuCzDQIgmL` 모두 2026-07-17 기준 TODO.

## 결론

판단: **오케스트레이터 중심의 "control plane for AI-native teams" 포지션은 차별성의 방향으로는 맞지만, 현재 표현과 UX 우선순위만으로는 충분한 해자라고 보기 어렵다.**

Orca는 이미 "여러 CLI 에이전트 + 각자 worktree + 파일/터미널/브라우저/diff/review + GitHub/Linear + 모바일"을 빠른 제품 속도로 흡수하고 있다. 2026-07-17 기준 GitHub는 `stablyai/orca`를 20.8k stars, MIT, latest release `v1.4.144`로 표시하고, YC는 Orca를 "10 to 100 coding agents"를 돌리는 ADE로 소개한다. Orca 제품 페이지도 diff comment, PR/CI, GitHub/Linear, CLI automation, SSH worktrees, usage tracking을 전면에 둔다.

따라서 Marblo가 Orca UX의 깔끔함을 흡수하는 것만으로는 **"Orca + 얇은 오케 레이어" me-too 위험**이 크다. 진짜 wedge는 "에이전트를 보기 좋게 많이 띄우는 ADE"가 아니라, **팀이 에이전트 결과를 의사결정하고 통합하는 audit/control plane**을 소유하는 것이다.

추천 방향: **더 크게 가되, 첫 wedge는 더 좁게 잡는다.**

- 더 크게: 팀 control plane, provenance, safe-merge, 결정 로그, PR/CI/배포 이벤트 캡처.
- 더 좁게: "티켓 하나의 문제 -> 에이전트 실행 -> diff -> 리뷰 판단 -> merge 결과"를 하나의 감사 번들로 완성하는 REVIEW cockpit.

## 역할 A: CEO / 전략 리뷰

### Orca 대비 차별성

Orca의 강점은 실행 환경 UX다.

- 어떤 CLI 에이전트든 side-by-side로 실행.
- worktree isolation을 기본 작업 모델로 전면화.
- Ghostty급 터미널, splits, 파일 에디터, Chromium/design mode, SSH worktrees, 모바일 companion.
- diff line comment를 에이전트에게 되돌려 보내는 리뷰 루프.
- GitHub/Linear를 앱 안에 넣어 컨텍스트 스위칭을 줄임.

이 영역은 Marblo가 뒤따라가야 하지만, 여기만 따라가면 이길 수 없다. 특히 Orca도 README에서 "tracked in one place"를 말하고, 제품 페이지에서 native GitHub/Linear, inline diff comments, CLI automation을 강조한다. 즉 "워크트리 칵핏" 자체는 이미 commodity 방향이다.

Marblo의 차별성은 로컬 ADE polish가 아니라 다음 질문에 답하는 능력이어야 한다.

- 이 작업은 왜 생겼고 누가 승인했나?
- 어떤 에이전트가 어떤 근거로 어떤 결정을 했나?
- diff는 어떤 테스트/CI/리뷰 신호를 통과했나?
- 사람은 어떤 이유로 merge/hold/reject를 결정했나?
- merge 후 어떤 SHA/PR/deploy/revert 결과로 이어졌나?

이 질문들은 `v3/docs/CONTROL-PLANE.md`의 4기둥과 맞다: per-task provenance bundle, decision log, merge/deploy event capture, inline diff + PR/CI status.

### "Orca + 오케 레이어" 위험

위험은 실재한다. 이유는 세 가지다.

1. Orca도 이미 orchestration 언어를 사용한다. YC 페이지는 "terminal-based agent orchestrator"라고 설명하고, 제품/README도 agent fleet과 automation CLI를 강조한다.
2. Marblo가 UX-1/2/3에서 주로 worktree switching, hygiene, diff viewer만 밀면 고객 눈에는 Orca와 같은 문제를 조금 다른 UI로 푸는 제품이 된다.
3. 오케스트레이터가 단순 decomposition/assignment에 머물면 모델 벤더, IDE, Orca류가 쉽게 흡수할 수 있다.

따라서 오케스트레이터는 "작업을 쪼개는 챗봇"이 아니라 **정책과 증거를 수집하고 REVIEW 결정을 준비하는 control-plane actor**가 되어야 한다.

### 진짜 wedge

가장 강한 wedge는 **REVIEW 단계의 재정의**다.

현재 많은 제품은 "여러 에이전트를 돌리고 결과를 비교/머지"에 초점을 둔다. Marblo는 REVIEW를 단순 컬럼이 아니라 다음을 가진 결재 지점으로 만들어야 한다.

- task spec과 acceptance criteria.
- agent activity/progress.
- changed files + diff stat + inline diff.
- test/CI 결과.
- 오케스트레이터의 risk summary.
- human decision: approve, request changes, reject, defer.
- merge SHA/PR/deploy 결과.

이 지점은 개인 개발자에게도 유용하지만, 팀/조직에서는 더 강하다. 팀은 "누가 어떤 근거로 AI 변경을 승인했나"를 필요로 하고, 이 감사 추적은 로컬 ADE의 예쁜 split pane보다 방어 가능하다.

### 더 크게 vs 더 좁게

판단: **비전은 더 크게, MVP는 더 좁게.**

- "더 크게"는 Marblo의 정체성이다. team control plane, safe-merge, provenance, decision log를 버리면 Orca와 정면 UX 경쟁이 된다.
- "더 좁게"는 시장 진입 전략이다. 모든 팀 control plane을 한 번에 만들지 말고, REVIEW cockpit 하나에서 "이 제품 없이는 AI agent 결과를 merge하기 불안하다"를 만들어야 한다.

메시지도 바꾸는 편이 좋다. "여러 AI 에이전트를 동시에 오케스트레이션"은 Orca와 겹친다. 더 강한 문장은 다음이다.

> Marblo turns parallel agent output into reviewable, auditable, safely mergeable team decisions.

## 역할 B: 엔지니어 / 아키텍처 리뷰

### 현재 UX 방향 평가

확정 방향은 대체로 건전하다.

- `activeWorktreeId` strangler 리팩터: 필요하다.
- 13기능탭 유지: 맞다. Orca식 IDE 전체 재구성보다 기존 Marblo 정보구조를 유지해야 control plane 정체성이 산다.
- 워크트리별 상태 `Map`: 필요하다.
- 버튼 트리거 파일트리 전환: UX-1로 적절하다.
- 위생: UX-2로 반드시 필요하다.
- diff 통합: UX-3의 핵심이며 전략적으로 중요하다.

단, 구현 순서는 조심해야 한다. 현재 코드에는 전역 `editorStore.rootPath`가 편집, 파일트리, 저장, 세션복원, 오케스트레이터/미션/에이전트 재연결까지 넓게 퍼져 있다. 이미 `WorktreeTab.openWorktree`와 `TaskCard` 버튼은 `setRootPath(worktree.path)`를 호출한다. 이 방식은 빠르지만, "현재 프로젝트 루트"와 "현재 코드뷰 루트"와 "현재 agent/task worktree"를 같은 상태로 취급한다.

### 전역 `rootPath`에서 워크트리별 상태로 갈 때의 함정

1. **저장 대상 오염**
   `editorStore.openFile/saveFile`은 `get().rootPath`를 사용한다. 사용자가 root를 바꾼 뒤 열려 있던 탭이 남아 있으면 다른 worktree에 저장될 수 있다. 현 CodeTab은 root 변경 시 `closeAllFiles()`를 호출하지만, 모든 진입점이 이를 지키는지 보장해야 한다.

2. **FileTree 선택/clipboard 오염**
   `fileTreeStore`는 `selectedPath`, `clipboardPath`를 전역으로 들고 있다. worktree root 전환 시 selected는 일부 경로에서 clear하지만 clipboard/cut 상태가 root를 넘어갈 수 있다. worktree별 `Map`이 필요한 대표 상태다.

3. **세션 복원 의미 혼선**
   `useSessionRestore`, `windowSession`, orchestrator resume path는 rootPath를 window/project identity로도 쓴다. code-view root를 worktree로 바꾸는 행위가 다음 앱 재시작의 project root처럼 저장되면, 사용자가 task worktree나 stale worktree로 앱을 복원할 수 있다.

4. **오케스트레이터/미션 cwd 혼선**
   `useOrchestratorAutoLaunch`, `useAgentReconnect`, mission orchestrator는 rootPath를 실행 cwd/프로젝트 루트로 사용한다. Code/FileTree를 worktree로 보는 것과 오케스트레이터 root를 바꾸는 것은 다른 의미여야 한다.

5. **IPC 보안/경계**
   `fs:*` IPC는 rootPath containment guard에 의존한다. rootPath를 자주 바꾸는 설계는 허용 범위 자체를 계속 바꾸므로, 현재 root가 어떤 타입인지 명시하지 않으면 사용자 의도와 다른 경계가 열릴 수 있다.

6. **main worktree와 task worktree 식별**
   `fileTreeView.ts`는 symlink/realpath 차이를 고려해 main worktree를 찾고, `isActiveTaskWorktree`로 stale/ad-hoc를 거른다. 이 로직을 `activeWorktreeId` 도입 후에도 단일 source로 유지해야 한다. 경로 문자열 비교가 여러 컴포넌트에 흩어지면 Windows/symlink 회귀가 난다.

### 권장 아키텍처

전역 상태를 다음처럼 분리하는 strangler가 적절하다.

- `projectRootPath`: 프로젝트/오케스트레이터/미션/세션복원 기준.
- `activeCodeRoot`: Code/FileTree가 보고 있는 루트. 프로젝트 main 또는 task worktree.
- `activeWorktreeId`: task worktree 선택의 안정 키. path가 아니라 `Worktree.id` 또는 `(projectId, taskId/path)` 기반.
- `workspaceStateByRoot`: 파일트리 expanded/selected/clipboard, openFiles, activeFilePath, showDiff 등 UI 상태.

첫 단계에서 모든 것을 새 모델로 옮길 필요는 없다. 다만 `setRootPath(worktree.path)` 직접 호출을 숨기고, `switchCodeRoot({ kind, worktreeId })` 같은 단일 액션으로 감싼 뒤 내부에서 기존 `rootPath`를 갱신하는 strangler가 좋다. 그러면 UX-1은 작게 끝내면서도 후속 UX-3 diff 통합이 같은 선택 모델을 재사용한다.

### UX-1/2/3 티켓 분해 평가

분해는 맞지만, 각 티켓의 완료 기준을 더 선명히 해야 한다.

#### UX-1: "이 워크트리 보기" 버튼

좋은 첫 티켓이다. 다만 완료 기준은 버튼 클릭 이상의 것이어야 한다.

- Board/TaskDetail/WorktreeTab의 모든 진입점이 같은 switch action을 사용.
- root 변경 시 openFiles/selected/clipboard 정책이 일관됨.
- Agents 탭 선택은 텍스트 버튼 클릭/DOM 탐색이 아니라 navigation store event로 처리.
- project root와 code root가 분리되지 않았다면, 적어도 session restore에 task worktree가 project root로 저장되지 않는 회귀 테스트 필요.

#### UX-2: 워크트리 탭 위생

적절하다. 다만 UI 필터만으로 끝나면 누적 119개 문제는 재발한다.

- ongoing/active 정의를 `isActiveTaskWorktree`와 일치시킨다.
- stale/merged/idle/ad-hoc의 정책을 main process list 결과와 UI에서 동일하게 사용한다.
- "아카이브"는 삭제와 다르다. 감사 trail을 남길지, 파일 시스템 cleanup만 할지 분리해야 한다.
- cleanup은 destructive에 가까우므로 dry-run/confirm/partial failure 표면화가 필요하다.

#### UX-3: diff 코드에디터 통합 + 인라인 코멘트

전략적으로 가장 중요하다. 단, 바로 inline comment writeback까지 가면 범위가 크다.

권장 순서:

1. 목업/레이아웃: diff가 Code 탭/TaskDetail/REVIEW 중 어디의 primary surface인지 결정.
2. read-only diff 통합: 현재 `board:worktreeDiff`와 `worktree.showCommit`을 하나의 diff source 모델로 정리.
3. review comments 데이터 모델: line comment가 task activity인지 decision log인지 명확히.
4. agent feedback loop: comments batch를 `add_activity`/pending instruction으로 되돌리는 정책.

UX-3은 Marblo의 차별점과 직접 연결된다. 단순 diff viewer가 아니라 "이 diff에 대해 누가 무엇을 결정했는가"를 남겨야 Orca와 달라진다.

## 강화 전략 / 후속 티켓 제안

1. **REVIEW cockpit Lite**
   - 목표: task detail에서 problem/approach/activity/worktree diff/test/decision을 한 화면에 모은 read-only REVIEW surface.
   - 성공 기준: REVIEW 티켓 하나를 앱 밖 PR 없이도 "검토 가능한 단위"로 판단할 수 있음.

2. **Decision Log v1**
   - 목표: approve/reject/request-change/defer를 구조화 이벤트로 남김.
   - 성공 기준: activity 문자열 파싱이 아니라 typed decision event로 provenance bundle에 표시.

3. **Code Root State Strangler**
   - 목표: `rootPath` 직접 변경 진입점을 `switchCodeRoot`로 수렴.
   - 성공 기준: project root와 code root 의미 분리, root별 openFiles/selection/clipboard 보존 정책 확정.

4. **Worktree Hygiene Policy**
   - 목표: active/stale/archived/deleted 상태 정의와 cleanup UX 확정.
   - 성공 기준: 119개 누적 worktree가 기본 Worktree 탭/파일트리 스위처에서 보이지 않고, 필요한 감사/복구 경로는 남음.

5. **Diff Comment -> Agent Feedback Loop**
   - 목표: diff line comments를 batch로 에이전트에게 돌려보내고, 그 결정/응답을 task timeline에 남김.
   - 성공 기준: comment가 단순 UI 메모가 아니라 수정 루프와 결정 로그의 일부가 됨.

6. **Merge/PR/CI Event Capture**
   - 목표: PR URL, CI status, merge SHA, deploy/revert 결과를 task provenance에 연결.
   - 성공 기준: `gh`/GitHub 웹에서 벌어진 결과가 Marblo timeline에 구멍 없이 표시.

## 최종 판단

Marblo가 이길 수 있는 길은 Orca의 worktree/ADE UX를 어느 정도 흡수하되, 제품의 중심을 거기에 두지 않는 것이다. Orca는 "agent workbench"로 강하다. Marblo는 **agent workbench 위에서 팀이 결정을 내리고, 안전하게 merge하고, 나중에 감사할 수 있는 control plane**이 되어야 한다.

따라서 이번 worktree UX 방향은 맞다. 다만 성공 기준은 "Orca처럼 깔끔하게 worktree를 여닫는다"가 아니라, **worktree가 task provenance와 REVIEW decision으로 자연스럽게 연결된다**여야 한다.

## 확인 출처

- Orca GitHub: https://github.com/stablyai/orca
- Orca README raw: https://raw.githubusercontent.com/stablyai/orca/main/README.md
- Orca product site: https://www.onorca.dev/
- Y Combinator Stably AI (Orca): https://www.ycombinator.com/companies/stably-ai-orca
- Marblo local docs: `v3/docs/CONTROL-PLANE.md`, `v3/docs/WORKTREE-SPEC.md`, `v3/docs/V3-OVERVIEW.md`
- Marblo local implementation: `v3/src/stores/editorStore.ts`, `v3/src/stores/worktreeStore.ts`, `v3/src/components/tabs/CodeTab.tsx`, `v3/src/components/tabs/WorktreeTab.tsx`, `v3/src/components/sidebar/FileTree.tsx`, `v3/src/lib/fileTreeView.ts`
