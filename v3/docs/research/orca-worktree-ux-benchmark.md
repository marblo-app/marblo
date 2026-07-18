# Orca 워크트리 UX 벤치마킹 — 리서치 & 마블로 개선안

> 티켓 `AkezywnUzmo2PkbB8fTG` · 리포트온리(코드 변경 없음) · 2026-07-17
> 웹 리서치는 gstack `/browse` 스킬로 수행(전역 규칙: `mcp__claude-in-chrome__*` 미사용).
> 마블로 코드 진단은 v3 렌더러 직접 확인. 구현은 후속 티켓 분해 제안만.

---

## 0. TL;DR

- **'orca' = Orca (ADE)** — Stably AI(YC W22, 샌프란시스코, Lovecast Inc.)가 만든 MIT 오픈소스 데스크톱+모바일 앱. "Agent Development Environment". Claude Code/Codex/Gemini/Cursor CLI 등 **CLI 에이전트를 격리된 git worktree에서 병렬 실행**하는 것이 핵심. 마블로와 포지셔닝이 정면으로 겹친다. **식별 신뢰도: 확정(공식 사이트·GitHub 20.8k★·문서 교차확인).**
- **Orca가 "깔끔"한 이유 한 줄**: _탭이 worktree별로 소유된다._ worktree를 고르면 **파일트리·터미널·diff·브라우저 판(pane tree) 전체가 그 worktree 컨텍스트로 통째 전환**된다("Switching worktrees swaps the entire pane tree"). 즉 **컨텍스트를 "기능"이 아니라 "worktree(=태스크)"로 분할**한다.
- **마블로 현 상태 = 정반대 축으로 분할**: 최상위가 13개 **기능 탭**(Board/Code/Agents/Worktrees/…). worktree 하나를 작업하려면 파일은 Code 탭, 터미널은 Agents 탭, diff·git은 Worktrees 탭으로 **흩어져** 다녀야 한다. 게다가 파일트리 root를 바꾸는 셀렉터가 **4곳**(Worktrees 탭 / Code 탭 Root 드롭다운 / FileTree 헤더 스위처 / Board 태스크카드)에 있고 모두 **하나의 전역 `editorStore.rootPath`**를 몰래 덮어쓴다. 한 프로젝트에 워크트리 **119개**(측정치)가 평면 리스트로 쌓여 "너무 많고 지저분"하다.
- **★사장님 아이디어("티켓/워크트리 선택 → 좌측 파일트리+터미널+diff가 그 컨텍스트로 즉시 전환")는 정확히 Orca의 핵심 설계이며, 이미 상용 제품이 검증한 방향이다.** 마블로 백엔드(`worktree.*` IPC)에 필요한 primitive는 이미 다 있다. 막는 것은 **전역 단일 상태 모델**뿐 — 아키텍처 교체가 아니라 "worktree별 workspace 상태"로의 리팩터로 도달 가능.

---

## 1. Orca 식별 (근거 URL 포함)

| 항목       | 내용                                                                             | 근거                                                                                              |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 제품명     | **Orca** (자칭 "the ADE — Agent Development Environment")                        | onorca.dev, GitHub README                                                                         |
| 개발사     | **Stably AI** (법인 Lovecast Inc.), YC W22, 샌프란시스코                         | onorca.dev 푸터 "Backed by YCombinator / Built in San Francisco", 네이버/티스토리 소개글 교차확인 |
| 라이선스   | MIT 오픈소스                                                                     | github.com/stablyai/orca (LICENSE)                                                                |
| 플랫폼     | macOS/Windows/Linux 데스크톱 + iOS/Android 모바일 컴패니언                       | onorca.dev/Download                                                                               |
| 한 줄 정의 | "Run Claude Code, Codex, OpenCode, and more side by side in isolated worktrees." | onorca.dev 히어로                                                                                 |
| 인기도     | GitHub ★ 20.8k / fork 1.5k (2026-07-17 기준)                                     | github.com/stablyai/orca                                                                          |

**근거 URL**

- 공식: https://www.onorca.dev
- GitHub: https://github.com/stablyai/orca
- 문서: https://www.onorca.dev/docs
- 핵심 문서(직접 인용): `/docs/model/worktrees`, `/docs/model/tabs-panes-splits`, `/docs/recipes/jump-worktrees`

> 날조 방지 노트: "Orca"는 동명 다수 존재(범고래, ORCA 양자화학 계산 SW/faccts.de, 수영복 브랜드 orca.com). 티켓의 "워크트리 기반 AI 개발도구"에 해당하는 것은 **Stably AI의 Orca ADE 하나로 확정**. 나머지는 무관.

지원 에이전트(문서 명시): Claude Code, Codex, Grok, Cursor, GitHub Copilot, OpenCode, Amp, Antigravity, Pi, oh-my-pi, Gemini, Goose, Cline, Continue, Droid, Kilocode, Kiro, Qwen 등 **25+ 프리셋 + "any CLI agent"**. → 마블로의 fleet(Claude+Codex+Antigravity)와 같은 "BYO agent/subscription" 철학.

---

## 2. Orca의 워크트리 UX 패턴 (문서 기반 분석)

### 2.1 데이터 모델 — "1 태스크 = 1 worktree" (`/docs/model/worktrees`)

- repo마다 **base ref**(보통 `origin/main`), worktree마다 **start-from ref**(분기 기준), 자기 **브랜치 + 디스크 사본 + 자기 에이전트 터미널**.
- worktree 삭제 = **디렉터리 + 브랜치 동시 제거**(확인 후).
- 라이프사이클이 명시적: **Create**(태스크명 + start-from 피커 + 선택적 Linear/GitHub 이슈 링크) → **Work**(에이전트 터미널·에디터·브라우저·터미널 pane 전부 이 worktree에 scope) → **Review**(start-from 대비 diff + 인라인 코멘트) → **Ship**(commit/push/PR/CI 대기 전부 인앱) → **Archive/Delete**(원클릭).
- **생성이 백그라운드**: Create 다이얼로그 제출 즉시 닫히고 `git fetch`/`worktree add`는 뒤에서. 사이드바에 progress row로 뜨고, 다른 worktree로 전환·취소·실패 시 Retry 가능.
- 외부에서 `git worktree add`로 만든 것은 **"New externally-created worktrees" inbox**로 감지 → import 하거나 hidden 유지. CLI로 `git worktree remove` 하면 다음 refresh에서 Orca가 자기 상태를 자동 정리.

### 2.2 사이드바 = 프로젝트 > worktree 그룹 (`/docs/model/worktrees` Sidebar layout)

- 최상위 = **프로젝트(1 repo 또는 관련 클러스터)**, 펼치면 **현재 작업 중인 worktree들**.
- 사이드바 자체 **필터 입력**(전역 검색과 별도)으로 리스트를 좁힘.
- **pin**으로 장기 작업을 상단 고정. **우클릭 → archive / sleep / delete**. Cmd/Shift-클릭 **멀티셀렉트** → 선택 전체에 액션.
- **status는 인라인**(초록=active, 노랑=needs input), **unread는 배지가 아니라 볼드**로 → 시각 노이즈 최소화.
- 멀티-repo 부모 폴더는 **project group**으로 묶고, 그룹 삭제 시 하위 repo 등록까지 한 번에 정리(체크박스).

### 2.3 탭/판(pane) 모델 — ★핵심 (`/docs/model/tabs-panes-splits`)

- **탭 하나 = 한 가지**(터미널/에디터 버퍼/브라우저/diff/PR). 탭은 tab group 안에 산다.
- 탭을 pane 가장자리로 **드래그해서 split**(오른쪽=좌우, 아래=상하). split은 중첩. 어떤 탭 타입이든 서로 split 가능(에이전트 터미널 + diff + 브라우저 동시).
- pane 경계는 **worktree별로 저장** — 창 리사이즈해도 안 흐트러짐.
- **결정적 문장(직접 인용):**
  > _"Each worktree owns its own tab layout. Switching worktrees swaps the entire pane tree — your browser tab, terminal, and diff reappear exactly as you left them."_
  > → **worktree 전환 = 그 worktree의 pane tree 전체 복원.** 다른 worktree의 탭은 아예 화면에 없음. "탭 과다"가 구조적으로 발생하지 않는다.

### 2.4 컨텍스트 전환/점프 (`/docs/recipes/jump-worktrees`)

- **Cmd-J Jump 팔레트**: 태스크명 조각 타이핑 → Enter 점프, Shift-Enter split 오픈. (클릭용 Search 버튼도 동일 surface.)
- 사이드바 상태점으로 needs-input(노랑) 먼저 처리. **Restart chip**으로 종료된 에이전트 일괄 재개(랩탑 sleep 후 mass-resume).
- 벨(bell)로 "agent finished" 큐 소진 → 알림 클릭이 해당 worktree로 점프.

### 2.5 위생(hygiene) — "정리를 싸게"

- 문서가 직접 권고: **"Delete merged worktrees aggressively. Orca makes this cheap — one click, worktree and branch both gone."** merged worktree를 방치하면 팔레트가 느려진다고 명시.
- 리뷰 표면: **Annotate AI Diff** — diff 라인에 markdown 코멘트를 달아 batch로 에이전트에 돌려보냄. Design Mode(worktree별 Chromium)에서 UI 요소 클릭 → HTML/CSS/스크린샷을 프롬프트로 주입.

**요약 — Orca가 "깔끔"한 3대 원인**

1. **분할 축이 worktree(태스크)** — 기능이 아니라. 한 화면 = 한 worktree의 모든 facet.
2. **전환이 상태 복원** — worktree 고르면 pane tree 통째 swap, 나머지는 안 보임.
3. **정리가 1급 시민** — pin/archive/sleep/멀티삭제 + "merged 공격적 삭제" 문화 + 원클릭 worktree+브랜치 제거.

---

## 3. 마블로 현 워크트리 탭 UX 진단 (코드 근거)

### 3.1 셸 구조 — 최상위가 "기능 탭 스위처", split-pane workspace가 아님

- `v3/src/components/Layout.tsx:399-462` — 상단 `Header` → `UpdateBanner` → 가로 flex(`Sidebar` 좌 + 중앙 컬럼 + `ActivityStreamPanel` 우). 중앙 컬럼(`:426-456`)은 세로로 `TabBar` → 활성 탭 콘텐츠 → `OrchestratorPanel`(`:445`) → `AgentListPanel`(`:450-455`) 스택.
- **파일트리↔에디터↔diff의 리사이즈 3-pane split이 없다.** 전부 최상위 탭. 탭 레지스트리 `tabComponents`(`Layout.tsx:60-74`), 탭 목록 `TabBar.tsx:24-278` = **13개 탭**(guide/board/lanes/missions/code/agents/usage/flows/deploy/**worktrees**/history/harness/settings). 리사이즈 가능한 건 사이드바 폭과 바텀 `AgentListPanel` 높이뿐(hand-rolled mousemove, `Sidebar.tsx:41-62`, `AgentListPanel.tsx:93-127`).

### 3.2 "Worktrees" 탭 = 평면 리스트(탭 아님)

- `v3/src/components/tabs/WorktreeTab.tsx:366` — worktree를 **프로젝트별 그룹**(`groups` `:438-475`, 렌더 `:778-800`)으로 나열. 각 `WorktreeRow`(`:164`): taskId, agentId, branch, +ins/-del, 상태 pill, ahead/behind, 충돌수, 행 액션 `Rebase/Merge/Resolve/Open/Delete`(`RowActions :100-162`).
- 필터: 프로젝트/상태 드롭다운, "Mergeable", **"Exceptions only"**(`:389-391, 449-454`), "History" 토글, **"Cleanup stale"** 버튼(`:685-700`). → 위생 primitive는 **이미 일부 존재**.
- **그러나 "Open"이 곧 이탈**: `openWorktree`(`:494-505`)는 `editorStore.rootPath`를 worktree 경로로 세팅하고 `closeAllFiles()` 후 **DOM을 긁어 "Code" 버튼을 합성 클릭**한다:
  ```ts
  const codeTab = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Code"
  );
  codeTab?.click(); // WorktreeTab.tsx:501-505
  ```
  → 워크트리를 "열면" 다른 탭으로 **튕겨나가고**, 그 과정에서 이전 worktree의 열린 파일이 전부 닫힌다. in-place workspace가 없다.

### 3.3 근본 원인 — root 셀렉터 4곳이 전역 단일 `rootPath`를 덮어씀

- `editorStore`는 **전역 단일** `rootPath` + **전역 단일** `openFiles[]`/`activeFilePath` + 전역 `showDiff`(`editorStore.ts:20-24`). 워크트리 전환 = 이 하나를 mutate + `closeAllFiles` → **직전 worktree의 열린 파일 세트 파괴, worktree별 지속성 없음.**
- 이 하나의 전역을 **4개 UI가 각자 바꾼다**:
  1. Worktrees 탭 리스트 "Open"(`WorktreeTab.tsx:494-505`)
  2. Code 탭 "Root" 드롭다운(`CodeTab.tsx:57-77`)
  3. FileTree 헤더의 **자체 worktree 스위처** `WorktreeSwitch`(`FileTree.tsx:519-623`) + `WorktreeMenuButton`(`:634`)
  4. Board `TaskCard` 브랜치 pill / `TaskDetailModal`(`TaskCard.tsx:308-333`, `TaskDetailModal.tsx:840-877`)
- → 서로 **조용히 override**. "지금 내가 보는 게 어느 worktree냐"가 세 컨트롤에서 어긋난다.

### 3.4 터미널 — 에이전트/셸당 1탭, 3개 표면에 중복, worktree 그룹 없음

- `stores/terminalStore.ts` = 진실 소스 `sessions[]`. 에이전트당 `attachSession`(`:84-93`, `isAgent:true`), 유저 셸당 `createSession`(`:51-82`). **worktree/태스크 그룹핑 없음 — 세션이 그냥 누적.** spawn 시 3개 fan-in(`Layout.tsx:256-257`, `AgentsTab.tsx:124-129`, 재접속 훅)에서 자동 탭 부착 → **N 에이전트 ⇒ N 터미널 탭.**
- 같은 세션이 **3개 표면**에 렌더: 바텀 `AgentListPanel`(행), Agents 탭 `AgentFleetGrid`(셀, `:164-186`), 레거시 `terminal/TerminalTabs.tsx`(탭 스트립). 대량 중복 + worktree scope 0.
- `cwd`는 spawn 시 `rootPath` 기본값(`terminalStore.ts:56`)이라 **spawn 시점 root에 고정** — 이후 worktree 전환을 따라오지 않는다.

### 3.5 diff — 표면 4개 / 렌더러 2종

- `components/code/DiffViewer.tsx`(Monaco DiffEditor, Code 탭 `showDiff` 시 `CodeTab.tsx:103-108`)
- `components/board/DiffViewer.tsx`(hand-parse unified diff) → `TaskDetailModal.tsx:872`, `WorkHistoryTab.tsx:189`
- `WorktreeTab.tsx`의 `MergeHistoryRow`(`:286-360`) inline `<pre>` diff
- → Code 탭 / Board 모달 / Work History / Worktrees history **4곳, 렌더러 2종.** 리뷰 흐름이 파편화.

### 3.6 기타 마찰

- worktree `refresh()`가 **최소 5개 mount 지점**에서 각자 호출(WorktreeTab `:404`, CodeTab `:44`, TaskCard `:190`, TaskDetailModal `:341`, FileTree 경유) — 공유 구독 없이 중복 fetch.
- 사이드바 좌측 레일 자체가 **3-way 서브탭**(Files/Commands/Chat, `Sidebar.tsx:99-157`)이라 파일트리가 셋 중 하나로 경쟁.
- pop-out(별창)은 board/code/history만(`TabBar.tsx:288`), worktree/terminal은 불가.

### 3.7 정량 근거 — "너무 많다"는 체감이 아니라 사실

- 측정(2026-07-17, 이 Mac): `git worktree list` **134개**, 그중 단일 프로젝트 `GFB8JnJrrX6AgahqmGB3`에 **119개**. prunable/detached 8개.
- 이 119개가 Worktrees 탭 하나에 프로젝트 그룹 평면 리스트로 전부 뜬다. pin/최근/archive-hide/sleep이 없어 **리스트가 무한 증가** → 스크롤 지옥.

**진단 한 줄**: 마블로는 IDE의 "기능 탭" 모델을 그대로 물려받아 **컨텍스트를 기능으로 쪼갰다.** worktree(=물리 에이전트 격리 작업공간)가 1급 조직 단위여야 하는데, 지금은 13개 탭 중 하나의 리스트로 격하돼 있고, 실제 파일/터미널/diff는 전역 단일 상태를 4곳이 다투며 흩뜨린다.

---

## 4. 배울 점 + 구체 개선 제안

### 4.1 배울 점(Orca → 마블로 매핑)

| Orca 패턴                           | 마블로 현재                              | 갭                              |
| ----------------------------------- | ---------------------------------------- | ------------------------------- |
| 분할 축 = worktree(태스크)          | 분할 축 = 기능(13탭)                     | **축 자체가 반대**              |
| worktree 전환 = pane tree 통째 swap | 전역 rootPath 1개를 4곳이 override       | worktree별 상태 부재            |
| 사이드바 pin/archive/sleep/멀티삭제 | 필터 + bulk cleanup-stale만              | per-worktree 정리·숨김 부재     |
| 상태 인라인(초록/노랑)·unread 볼드  | 상태 pill은 있으나 needs-input 신호 약함 | "지금 봐야 할 것" 우선순위 약함 |
| Cmd-J Jump 팔레트                   | 없음(탭 클릭 + 리스트 스크롤)            | 빠른 점프 부재                  |
| diff 인라인 코멘트 → 에이전트 회신  | diff 4표면, 회신 동선 없음               | 리뷰 루프 부재                  |

마블로가 이미 가진 강점(유지): `worktree.*` IPC 풀셋(list/status/remove/prune/cleanupStale/rebase/merge/showCommit/resolve, `preload.ts:236-286`), 자동머지/자율성 다이얼, merge-history 감사 트레일, 오케 중심 dispatch. → **primitive는 충분. UI 조직만 재편하면 됨.**

### 4.2 (a) 탭 정리 — 활성 컨텍스트 중심 + 자동정리

1. **Worktrees 탭에 pin/archive/sleep 도입** (per-worktree). 기본 뷰 = "활성 + pinned"만, merged/stale은 접힌 "정리됨" 섹션으로. 백엔드 `stale` 플래그·`cleanupStale`가 이미 있으니 **UI 상태(archived/pinned) 저장만 추가**(worktreeStore + 프로젝트 스코프 localStorage/Firestore).
2. **"Exceptions only"를 기본 on 후보로** — 자동머지된 clean worktree는 기본 숨김, 사람이 봐야 하는 충돌/stale만 노출(Orca "unread 볼드"와 같은 철학). 이미 `exceptionsOnly` 로직 존재(`WorktreeTab.tsx:389-391`), 디폴트만 뒤집으면 됨.
3. **merged 자동 아카이브**: merge 액션(`handleAction merge`)·자동머지 성공 시 해당 worktree를 리스트에서 자동으로 "정리됨"으로 이동(현재는 남아서 119개로 누적). merge-history로 이미 감사 가능하니 리스트에서 빼도 안전.
4. **root 셀렉터 4곳 → 1개로 수렴**: 4개가 각자 `rootPath`를 mutate하는 구조를 "활성 worktree" 단일 소스로 통일(4.3과 동일 리팩터). 사용자가 "지금 어느 worktree" 헷갈리는 근본 원인 제거.
5. **13개 기능 탭 다이어트(별건, 낮은 우선순위)**: dev-only(flows/deploy/missions)는 이미 플래그 게이트. Guide/Usage/Harness/History는 오버플로 메뉴로 접어 상시 노출 탭 수를 줄이는 것 검토.

### 4.3 (b) ★사장님 아이디어 평가 — "worktree 선택 → 좌측 파일트리(+터미널+diff)가 그 컨텍스트로 즉시 전환"

**결론: 타당하다. Orca가 검증한 정확한 방향이고, 마블로 아키텍처에서 점진 도입 가능하다. "새 앱"이 아니라 "전역 상태 → worktree별 상태" 리팩터.**

**현 아키텍처에서 왜 가능한가 (막는 것은 딱 하나)**

- 이미 있는 것: worktree 목록·상태·git 액션 IPC 풀셋(`worktree.*`), 파일트리(`FileTree`, root 파라미터화만 하면 됨), Monaco 에디터/DiffViewer, 터미널 세션 스토어, 에이전트↔PTY 매핑.
- **막는 것 = 전역 단일 상태**: `editorStore.rootPath`/`openFiles` 1개, `terminalStore.sessions` 평면 배열(worktree 키 없음). 이 둘을 **worktree별로 키잉**하면 "전환 = 복원"이 성립한다.

**구현 방향 (개념 설계, 코드 아님)**

1. **`activeWorktreeId` 단일 소스 신설**(worktreeStore 또는 새 `workspaceStore`). 4개 root 셀렉터·"Open"·오케 dispatch·Board 태스크 클릭이 전부 이 하나만 세팅. `rootPath`는 `activeWorktreeId`에서 파생(4곳이 직접 mutate 금지).
2. **worktree별 workspace 상태**: `Map<worktreeId, { openFiles, activeFile, terminalSessionIds, paneLayout, showDiff }>`. 전환 시 현재 상태 저장 → 대상 상태 복원(Orca "swaps the entire pane tree"의 최소 구현). 초기엔 openFiles + activeFile만 복원해도 체감 큼.
3. **터미널을 worktree로 그룹핑**: `terminalStore.sessions`에 `worktreeId` 태그 추가(spawn cwd로 이미 유추 가능). 좌측/바텀 터미널은 activeWorktree 소속만 표시. 3중 표면(list/grid/legacy)은 "활성 worktree 필터" 공유로 정리.
4. **워크스페이스 레이아웃(1단계 최소안)**: 별도 신규 탭 "Workspace"(또는 Code 탭 확장) = 좌 FileTree(activeWorktree root) + 중앙 에디터/터미널 + 우 diff(같은 worktree의 uncommitted/base 대비). 최상위는 여전히 탭이되, **worktree 선택이 이 한 화면의 좌·중·우를 동시에 갈아끼움.** Orca식 자유 split(드래그 분할)은 2단계.
5. **진입점 통일**: 오케가 태스크 dispatch → 물리 에이전트 spawn 시 그 worktree를 `activeWorktreeId`로. Board에서 티켓 클릭·Worktrees 리스트 "Open"·(신설) Cmd-J Jump 팔레트 → 전부 같은 setter. `openWorktree`의 DOM-클릭 해킹(`WorktreeTab.tsx:501-505`) 제거.

**마블로다움을 지키는 포인트(Orca와의 차별화)**

- 마블로는 **오케 중심**(control plane for AI-native teams). Orca는 사람이 worktree를 손으로 만든다. 마블로에선 **오케의 dispatch/spawn이 worktree를 만들고 activeWorktree를 몰아주는** 흐름이 1급이어야 한다(사장님 아이디어 + 오케 주도의 결합). "티켓 선택 = 그 티켓의 worktree workspace로 진입"이 자연스러운 지점.
- Board 티켓 ↔ worktree ↔ workspace를 **taskId로 일관 연결**(이미 `inferTaskId`로 path→taskId 유추 존재, `worktreeStore.ts:83`). 티켓 카드에서 바로 workspace 진입 → 오케 커뮤니케이션과 물리 작업공간이 한 줄로 이어진다.

**리스크/주의**

- worktree별 openFiles 보존은 메모리 증가 가능 → LRU로 비활성 worktree 상태 idle 언로드(파일 내용은 버리고 경로/레이아웃만 유지 후 재오픈).
- 전역 mutate 지점이 흩어져 있어(4곳) 리팩터 시 **회귀 위험**. `activeWorktreeId` 도입을 먼저 하고 각 셀렉터를 하나씩 이관(스트랭글러 패턴).
- 멀티윈도우: 창별 `currentProject` 등록이 이미 있음(`Layout.tsx:99-105`). activeWorktree도 창-로컬로 두면 창마다 다른 worktree 작업 가능(Orch 병렬성과 정합).

---

## 5. 후속 티켓 분해 제안 (구현 티켓, 이 리서치엔 코드 없음)

우선순위 순. 각 티켓은 독립 배포 가능하도록 스트랭글러 순서로 배열.

1. **[FE] `activeWorktreeId` 단일 소스 신설 + 4개 root 셀렉터 수렴** — worktreeStore(또는 workspaceStore)에 activeWorktreeId. `rootPath`를 파생값으로. Worktrees "Open"/Code Root 드롭다운/FileTree 스위처/TaskCard가 이 setter만 호출. `openWorktree`의 DOM-클릭 해킹 제거. _(리팩터·회귀 리스크 중, 가치 최상 — 나머지의 토대)_
2. **[FE] worktree별 workspace 상태(openFiles/activeFile 복원)** — `Map<worktreeId, WorkspaceState>`. 전환 시 저장/복원. LRU idle 언로드. Orca "swaps pane tree"의 최소 구현.
3. **[FE] 통합 Workspace 뷰(좌 FileTree + 중 에디터/터미널 + 우 diff, activeWorktree scope)** — 신규 탭 또는 Code 탭 확장. diff 4표면을 이 한 곳으로 1차 통합(Monaco DiffViewer 재사용).
4. **[FE] 터미널 worktree 그룹핑** — `terminalStore.sessions`에 `worktreeId` 태그, 활성 worktree 필터 공유. 3중 표면 정리(중복 제거).
5. **[FE] Worktrees 위생: pin/archive/sleep + merged 자동 아카이브 + "Exceptions only" 기본 on** — 119개 누적 해소. 백엔드 `cleanupStale`/`stale` 재사용, UI 상태만 추가.
6. **[FE] Cmd-J Jump 팔레트** — worktree/파일/에이전트/커맨드 통합 점프(Orca 패턴). 오케 dispatch·Board 클릭과 같은 setter로 수렴.
7. **[FE, 낮음] diff 인라인 코멘트 → 에이전트 회신 루프** — Orca "Annotate AI Diff" 벤치. 마블로 오케/에이전트 메시징에 얹기.
8. **[FE, 낮음] 최상위 기능 탭 다이어트** — 비핵심 탭 오버플로 메뉴화.

---

## 부록 A. 인용 출처(웹)

- onorca.dev (히어로/기능/FAQ/비교표), 2026-07-17 조회
- github.com/stablyai/orca README, ★20.8k, 2026-07-17
- onorca.dev/docs/model/worktrees (데이터 모델·라이프사이클·사이드바·외부 worktree inbox)
- onorca.dev/docs/model/tabs-panes-splits ("Switching worktrees swaps the entire pane tree")
- onorca.dev/docs/recipes/jump-worktrees (Cmd-J·상태점·"delete merged aggressively")

## 부록 B. 인용 출처(마블로 코드, v3 렌더러)

- `components/Layout.tsx:60-74, 399-462` — 셸/탭 레지스트리
- `components/TabBar.tsx:24-278` — 13 기능 탭
- `components/tabs/WorktreeTab.tsx:366, 438-505, 571-614, 685-700` — 리스트·openWorktree 해킹·cleanupStale
- `components/sidebar/FileTree.tsx:519-623` — 자체 worktree 스위처
- `components/tabs/CodeTab.tsx:57-77, 103-108` — Root 드롭다운·diff
- `stores/editorStore.ts:20-24` — 전역 단일 rootPath/openFiles/showDiff
- `stores/terminalStore.ts:51-93` — 세션 누적(worktree 그룹 없음)
- `stores/worktreeStore.ts:83, 111-215` — inferTaskId·statusPill·git 액션
- `electron/preload.ts:236-286` — `worktree.*` IPC 풀셋(구현 primitive 확보됨)
- 정량: `git worktree list` 134개 / 단일 프로젝트 119개(2026-07-17 측정)
