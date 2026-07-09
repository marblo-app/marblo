# 에이전트 라이브 분할뷰 — 설계 문서

- **티켓**: `nGO7gewxROLt1lxCClUv`
- **대상 릴리스**: v3.0.4 (3.0.3 auth 핫픽스와 분리)
- **상태**: ★설계 단계 — 본 문서는 구현이 아니라 설계 산출물. 리뷰 후 별도 구현 티켓으로 분할.
- **작성**: frontend agent

---

## 0. 한 줄 요약

하단 에이전트 패널에서 **여러 에이전트의 라이브 터미널(풀 xterm)을 2/3/4 분할 그리드로 동시에 지켜보는** 뷰. 제품 핵심가치("에이전트가 동시에 일하는 걸 지켜본다")를 시각적으로 강화하고, 데모·썸네일에서 "3개 터미널에 코드가 동시에 쏟아지는" 장면을 연출한다.

**핵심 통찰**: 이 기능의 90%는 **이미 배선되어 있다**. `AgentListPanel` 은 PTY 세션마다 `TerminalView`(풀 xterm)를 **전부 동시에 마운트**해 두고, 그중 focused 하나만 `isActive`(visible)로 토글한다(나머지는 `visibility:hidden` 상태로 라이브 데이터를 계속 ingest). 즉 **N개의 살아있는 xterm 이 이미 백그라운드에서 돌고 있다.** 분할뷰는 "그중 K개를 동시에 visible 로 만들고 겹치기(absolute overlap) 대신 CSS grid 로 배치"하는 것이다. 신규 PTY 배선도, 신규 스트림 구독도 필요 없다.

---

## 1. 조사 결과 — 기존 빌딩블록 지도

### 1.1 두 개의 서로 다른 "터미널" 계층

| 계층                  | 컴포넌트       | 렌더링                                    | 데이터 소스                                  | 용도                                        |
| --------------------- | -------------- | ----------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| **경량 미러(프리뷰)** | `MiniTerminal` | `<pre>` + `stripAnsi` (ANSI 컬러 포기)    | `ptyMirrorStore` ring buffer (마지막 8–12줄) | Fleet **Grid 뷰** 셀 안의 라이브 프리뷰     |
| **풀 라이브 터미널**  | `TerminalView` | `@xterm/xterm` (DOM 렌더러, WebGL opt-in) | `window.electronAPI.pty.onData/replay`       | 하단 `AgentListPanel` FocusView 의 실터미널 |

두 계층을 혼동하면 안 된다. **분할뷰는 풀 라이브 터미널(`TerminalView`) 을 K개 동시에 그리는 것**이지, `MiniTerminal` 미러를 확대하는 게 아니다. (미러는 컬러가 없고 8줄만 보관 → 데모의 "코드 쏟아짐" 연출에 부적합.)

### 1.2 `AgentListPanel` — 재사용의 핵심 앵커

`v3/src/components/agents/list-panel/AgentListPanel.tsx`

- `rowsWithPty` (PTY 세션을 가진 모든 row)를 순회하며 **각 세션마다 `<TerminalView>` 를 하나씩, 전부 마운트**한다 (`AgentListPanel.tsx:421-430`).
- 모든 xterm 은 `absolute inset-0` 로 **겹쳐 쌓여** 있고, `isActive` 인 것만 `visibility:visible`. 나머지는 `visibility:hidden` 이지만 **여전히 라이브 데이터를 write** 한다 (`TerminalView` 의 `onData` 핸들러는 visibility 와 무관하게 `terminal.write`).
- 이 덕에 focus 전환이 즉각적이고 "이전과 똑같은 화면"이 유지된다(xterm 이 alt-screen/scrollback/cursor 를 메모리에 보존).

> **결론**: 분할뷰가 추가하는 것은 **새 xterm 인스턴스가 아니다.** 이미 마운트되어 라이브로 도는 인스턴스들의 **레이아웃(visible 개수 + 배치)** 을 바꾸는 것뿐. 마운트 비용은 이미 지불된 상태다.

### 1.3 `TerminalView` — 세션당 xterm 1개 원칙 (중요 제약)

`v3/src/components/terminal/TerminalView.tsx`

재사용 관점에서 반드시 알아야 할 두 가지 파괴적 부작용:

1. **`pty.removeListeners(sessionId)`** — cleanup(unmount) 시 호출되며 **해당 채널의 모든 listener 를 제거**한다 (`TerminalView.tsx:496`). 같은 세션을 보는 `MiniTerminal`/다른 xterm 의 listener 까지 날아간다. (이 위험은 `ptyMirrorStore.ts:10-16` 주석에도 명시.)
2. **`terminal.onResize → pty.resize(sessionId, cols, rows)`** — 각 xterm 이 자기 크기로 PTY 를 리사이즈한다 (`TerminalView.tsx:397-400`). 같은 세션에 크기가 다른 xterm 이 2개 붙으면 **SIGWINCH 를 서로 덮어써 TUI(Ink) 레이아웃이 깨진다.**

> **결론**: **한 PTY 세션에는 라이브 xterm 이 딱 하나여야 한다.** 분할뷰의 K개 셀은 반드시 **서로 다른 K개 세션**이어야 한다(같은 세션을 두 셀에 넣는 UX 는 금지). 이는 제약이 아니라 오히려 자연스러운 설계 — 분할뷰의 목적 자체가 "여러 에이전트를 동시에"이다.

### 1.4 `isActive` 의미 분리 필요 (핵심 확장 포인트)

현재 `TerminalView` 의 `isActive` 는 **두 책임을 겸한다**:

- (a) `visibility` 토글 → **레이아웃/페인트 대상 여부**
- (b) 활성화 시 `fitAddon.fit()` + `terminal.focus()` (`TerminalView.tsx:508-530`)

분할 모드에서는 K개가 동시에 visible → K개가 fit 되어야 하지만, **키보드 포커스(`.focus()`, stdin 라우팅)는 1개만** 가져야 한다. 그래서 `isActive` 를 **두 prop 으로 분리**한다:

```ts
interface TerminalViewProps {
  sessionId: string;
  isVisible: boolean; // 레이아웃에 참여 + fit() 대상 (분할시 K개 true)
  isFocused: boolean; // .focus() + 키보드 하이라이트 (항상 최대 1개 true)
  onLeftWhenEmpty?: () => void;
}
```

기존 단일 FocusView 호출부는 `isVisible = isFocused = (focusedRow.ptySessionId === r.ptySessionId)` 로 그대로 동작(하위 호환).

### 1.5 관련 스토어

| 스토어            | 역할                                                                   | 분할뷰에서                                                    |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `agentFocusStore` | `focusedAgentId: string \| null` — 하단 패널이 보여줄 단일 row 의 SSOT | 확장: 분할 슬롯 상태 추가 or 별도 `splitViewStore` 신설(§3.4) |
| `agentSessionMap` | `agentId → ptySessionId` (localStorage 영속)                           | 재사용 그대로                                                 |
| `terminalStore`   | `sessions[]` (isAgent 플래그)                                          | 재사용 그대로                                                 |
| `ptyMirrorStore`  | 경량 미러 ring buffer                                                  | 분할뷰는 미사용(풀 xterm 직접)                                |

### 1.6 detach(새 창 분리) 현황

`DetachedLayout.tsx` + `?detached=<view>` 쿼리 + main 의 `createDetachedWindow`.

- 현재 detach 는 **탭 단위**(board/code/history)만 지원하며, **에이전트 리스트 패널/오케 PTY 를 의도적으로 제외**한다(`DetachedLayout.tsx:20-26` — 중복 오케 PTY spawn 방지).
- 즉 "단일 에이전트 터미널을 새 창으로 분리"는 **아직 없다.** 분할뷰의 detach 연계는 **신규 작업**이며, 본 설계에서는 **후속(비필수)** 으로 둔다(§4.4). PR #271/#275(history detach), #199(board/code detach)의 `createDetachedWindow` 인프라를 재사용하되, 터미널 세션 핸드오프는 세션당 xterm 1개 원칙(§1.3) 때문에 "원본 창에서 해당 셀을 비우고 새 창으로 이관"하는 방식이어야 한다(같은 세션이 두 창에 동시에 살면 removeListeners/resize 충돌).

---

## 2. 재사용 vs 신규 — 요약표

| 대상                                             | 판정                    | 비고                                                                                                                                                |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalView` (풀 xterm)                        | **확장**                | `isActive` → `isVisible`/`isFocused` 분리(§1.4). 그 외 스크롤 팔로우/IME/클립보드/settle-batch 로직 전부 그대로.                                    |
| `AgentListPanel`                                 | **확장**                | 터미널 레이어를 "absolute overlap" 과 "CSS grid" 두 모드로 스위치. 리스트/포커스/스폰 로직 재사용.                                                  |
| `FocusView` 헤더                                 | **부분 재사용**         | 셀 헤더의 vendor monogram·status pill·rename 은 `types.ts` 의 `VENDOR_VISUALS`/`STATUS_PILL` 재사용. 분할 셀용 경량 헤더는 신규(`SplitCellHeader`). |
| `agentSessionMap`/`terminalStore`                | **그대로**              | 변경 없음.                                                                                                                                          |
| `agentFocusStore`                                | **확장 or 신규 스토어** | 분할 슬롯/모드 상태(§3.4).                                                                                                                          |
| 분할 레이아웃 컨테이너                           | **신규**                | `AgentSplitGrid`(터미널 레이어를 grid 로 배치 + 셀 크롬).                                                                                           |
| 모드 토글(단일↔2↔3↔4)                            | **신규**                | 패널 헤더의 세그먼트 컨트롤.                                                                                                                        |
| `MiniTerminal`/`AgentFleetGrid`/`ptyMirrorStore` | **미사용**              | 별개 계층(Grid 프리뷰 뷰). 분할뷰와 공존.                                                                                                           |
| detach 인프라(`createDetachedWindow`)            | **후속 재사용**         | §4.4, 비필수.                                                                                                                                       |

---

## 3. 분할 레이아웃 & 라이브 배선 설계

### 3.1 레이아웃 모드

패널 헤더에 세그먼트 컨트롤: **`▢ 1` · `◫ 2` · `◫ 3` · `⊞ 4`** (단일/2/3/4 분할).

| 모드     | 그리드                                                 | 비고              |
| -------- | ------------------------------------------------------ | ----------------- |
| 1 (단일) | 기존 FocusView 동작 그대로                             | 기본값, 하위 호환 |
| 2        | `grid-cols-2`, 1행                                     | 좌우 분할         |
| 3        | `grid-cols-2` (1개는 세로 span) 또는 `grid-cols-3` 1행 | 반응형(§3.3)      |
| 4        | `grid-cols-2 grid-rows-2`                              | 2×2               |

- 배치는 **CSS grid** (`display:grid`, `grid-template-columns/rows`). 각 셀은 `min-height` 로 xterm 이 열릴 최소 높이(≈120px) 보장.
- 패널 자체가 이미 **드래그 리사이즈**(180–800px, `AgentListPanel.tsx:14-19`)되므로, 4분할이 답답하면 사용자가 패널을 키운다. 분할 모드일 때 `MAX_HEIGHT` 상향(예: 800→1000) 검토.

### 3.2 슬롯 채우기(어떤 세션이 어느 셀에)

- **슬롯 모델**: `slots: (rowId | null)[]` 길이 = 분할 수. `null` 은 빈 슬롯.
- **자동 채움**: 분할 모드 진입 시 현재 focused row 를 슬롯 0에, 나머지는 `rowsWithPty` 에서 status=running 우선순위로 앞에서 채운다.
- **수동 지정**: 각 셀 헤더의 드롭다운(또는 셀 빈 상태의 "+ 에이전트 선택")으로 세션 교체. 상단 Fleet 그리드/리스트에서 셀로 **드래그 드롭**은 매력적이지만 후속(P4).
- **중복 금지**: 같은 세션을 두 슬롯에 넣지 못하게 가드(§1.3). 드롭다운에서 이미 배치된 세션은 disabled.

### 3.3 반응형

- 패널 폭이 좁아지면(예: `< 720px`) 4분할 → 2×2 유지가 답답 → **2열로 강등**하거나 가로 스크롤. `AgentFleetGrid` 의 `ResizeObserver` + `matchMedia("(max-width: 640px)")` 패턴 재사용.
- 최소 셀 폭 보장(≈280px). 셀이 그보다 좁아지면 분할 수를 자동 한 단계 낮춘다(3→2, 4→2).
- 각 셀 리사이즈 시 해당 `TerminalView` 의 `ResizeObserver`(이미 존재, `TerminalView.tsx:430-434`)가 `fit()` 재호출 → cols/rows 재계산 → `pty.resize`. **셀별로 독립 SIGWINCH** 가 자연스럽게 흐른다.

### 3.4 상태 스토어

`splitViewStore`(신규, 또는 `agentFocusStore` 확장):

```ts
interface SplitViewState {
  mode: 1 | 2 | 3 | 4; // 분할 수 (localStorage 영속)
  slots: (string | null)[]; // rowId per cell
  focusedSlot: number; // 키보드 포커스/stdin 라우팅 대상 (1개)
  setMode(n): void; // 슬롯 배열 리사이즈 + 자동 채움
  assignSlot(i, rowId): void; // 중복 가드 포함
  setFocusedSlot(i): void;
}
```

- `mode` 는 localStorage 영속(`agentsViewMode` 패턴, `AgentDashboard.tsx:14-25` 재사용).
- 단일 모드(mode=1)는 기존 `agentFocusStore.focusedAgentId` 로 위임 → 하위 호환.

### 3.5 라이브 터미널 배선 — PTY 구독 재사용

핵심: **분할뷰는 새 PTY 구독을 만들지 않는다.**

- `AgentListPanel` 이 이미 `rowsWithPty` 전부에 `TerminalView` 를 마운트 → 각 xterm 이 `pty.onData(sessionId, …)` 를 이미 구독 중.
- main 프로세스의 pty-manager 는 `ipcRenderer.on` 다중 구독을 허용하므로(코드 주석 `ptyMirrorStore.ts:9-12` 및 `TerminalView` 공존 확인), 분할로 여러 xterm 이 **동시에 visible** 이 되어도 **각자 다른 세션**을 보는 한 fan-out 충돌 없음.
- 분할 셀에서 하는 일은 **visibility 를 켜고 grid 에 배치**하는 것뿐 → 브라우저가 그제서야 페인트 시작. 데이터는 이미 흐르고 있었다.

### 3.6 main-side 라우팅 — 왜 "한 창 안 분할"은 안전하고 "창 분리"는 신규인가

main 프로세스는 세션마다 **소유 창이 정확히 하나**다: `ptyOwners: Map<sessionId, webContents.id>` (`electron/main.ts:594`). `setupPtyForwarding` 이 라이브 출력을 `sendToOwner(ptyOwners.get(sid), …)` 로 **그 한 창에만** 보낸다(`main.ts:2829-2866`). launch/attach/restart 경로마다 `ptyOwners.set(...)` 로 소유자를 요청 창으로 재지정한다.

- **한 창(=현재 메인 렌더러) 안에서의 분할은 안전.** K개 셀이 모두 같은 렌더러에 있고 **서로 다른 K개 세션**을 본다 → 각 세션의 owner 는 그대로 이 창. `pty:data:${sid}` 가 전부 이 창으로 도착하고, `pty.onData` 는 `ipcRenderer.on` 이라 가산적. 소유권 경합·fan-out 충돌 없음. → **v3.0.4 범위는 전부 여기에 해당.**
- **창 분리(detach)는 신규 작업.** 다른 창이 그 세션을 열면 `ptyOwners.set` 이 소유권을 훔쳐 **원본 창의 라이브 출력이 끊긴다.** 진짜 멀티윈도우 공유는 `ptyOwners` 를 `Set<webContents.id>` 로 확장(멀티 구독)하거나 **소유권 이관** 방식이 필요 → §4.4.
- **같은 세션을 두 셀에 넣는 것도 금지**: 같은 렌더러라 둘 다 데이터는 받지만, 한 셀 unmount 시 preload 의 `removeAllListeners(pty:data:${id})`(`preload.ts:99-102`)가 **다른 셀 구독까지 제거**한다. `ptyMirrorStore.ts:8-16` 이 이 위험을 명시하고 우회한다. → 슬롯 중복 가드로 원천 차단(§3.2).

> 요약: **분할뷰(한 창·서로 다른 세션)는 배선 변경 0.** main-side 변경은 detach(§4.4)에서만 필요하고, 그건 후속.

---

## 4. UX 설계

### 4.1 셀 크롬(chrome)

각 분할 셀 상단에 얇은 헤더(`SplitCellHeader`):

- **①②③④ 슬롯 뱃지** (데모에서 "몇 번 에이전트인지" 즉시 식별)
- vendor **monogram + stripe color** (`VENDOR_VISUALS` 재사용 — 🟣claude/🟢gpt/🔵gemini/🟠antigravity)
- **에이전트 이름** (truncate)
- **status pill** (running/idle/error, `STATUS_PILL` 재사용) + `AttentionBadge`(입력 대기/에러/restart) 재사용
- 우측 액션: **⤢ 확대(이 셀만 단일 모드로)**, **⇱ 세션 교체(드롭다운)**, (후속) **⧉ detach**

### 4.2 빈 상태

- 슬롯이 `null` 이거나 라이브 세션 부족 시: 점선 카드 + "+ 에이전트 선택" 드롭다운, 또는 "에이전트를 스폰하세요" CTA(`AgentSetupGuide`/`EmptyState` 톤 재사용).
- 활성 에이전트가 분할 수보다 적으면 남는 슬롯은 빈 상태로 두고, 새 에이전트 spawn 시 자동으로 다음 빈 슬롯에 채운다.

### 4.3 셀 클릭/포커스 동작

- **셀 클릭/터미널 클릭** → 해당 슬롯을 `focusedSlot` 으로 승격(키보드 stdin 이 그 셀로). 시각적으로 focused 셀에 링(`ring-[#cba6f7]`, 기존 패턴).
- **⤢ 확대** → mode=1 로 전환하고 그 세션을 focused. (분할↔단일 왕복이 데모에서 "하나를 크게 봤다가 다시 전체로"를 연출.)
- **키보드**: `Cmd/Ctrl+1..4` 로 focusedSlot 점프, `←/→` 는 셀 간 이동(단, xterm 내부에선 `.xterm` 가드로 CLI 로 위임 — `FocusView.tsx:98` 패턴 재사용).

### 4.4 detach 연계 (후속, 비필수)

- 셀 헤더의 **⧉** → 그 세션을 **새 창으로 이관**. `createDetachedWindow` 인프라(`main.ts:1964-1985`, `window:popOutTab` 패턴) 재사용하되, **원본 창에서 그 셀을 비우고**(unmount → removeListeners) 새 창의 단일 `TerminalView` 가 인계받는다(세션당 xterm 1개 원칙, §1.3).
- **net-new 이유(§3.6)**: 현재 `DetachedLayout` 은 PTY/에이전트 패널을 **의도적으로 제외**(`DetachedLayout.tsx:20-26`)하고, `windowSession.ts:32-38` 은 detached 창을 영속에서 제외한다. 그리고 새 창이 세션을 열면 `ptyOwners.set` 이 **원본의 라이브를 훔친다.** 따라서 "터미널을 담은 detach 창"은 (a) `ptyOwners` 를 `Set<webContents.id>` 멀티 구독으로 확장하거나 (b) 명시적 소유권 이관(원본은 완전히 비움) 중 하나를 구현해야 한다.
- v3.0.4 범위에서는 **제외**. 별도 티켓(O9s9g4NA 연계 검토).

### 4.5 배치 위치 — 어디에 두나

**결정: 하단 `AgentListPanel` 안에 "레이아웃 모드"로 통합** (신규 탭/패널 신설 X).

근거:

- 살아있는 xterm 들이 이미 그 패널에 마운트되어 있다 → 재마운트 0, 상태 보존.
- 사용자 멘탈 모델: "하단이 에이전트 터미널 자리"가 이미 확립.
- 신규 위치(에이전트 탭 그리드/신규 탭)는 새 xterm 마운트가 필요 → 세션당 xterm 1개 원칙 위반 위험(같은 세션이 하단+탭에 동시에).

> 상단 **에이전트 탭의 Grid 뷰**(`AgentFleetGrid` + `MiniTerminal`)는 "전체 조망(미러)", 하단 **분할뷰**는 "선택한 소수를 풀 라이브로 정독" — 역할이 겹치지 않고 상호보완.

---

## 5. 단계별 구현 플랜 (작은 PR 분할)

| PR              | 범위                                                                                 | 산출물                                                       | 리스크                                           |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| **PR-1**        | `TerminalView` `isActive` → `isVisible`/`isFocused` 분리                             | prop 시그니처 변경 + 기존 단일 호출부 하위호환. 동작 변화 0. | 낮음 — 순수 리팩터, 기존 테스트로 회귀 검증      |
| **PR-2**        | `splitViewStore` 신설 + 패널 헤더 모드 세그먼트 컨트롤(1/2/3/4). mode=1 은 기존 동작 | 스토어 + localStorage 영속 + 토글 UI                         | 낮음                                             |
| **PR-3**        | `AgentSplitGrid` — 터미널 레이어를 grid 배치, K개 `isVisible`, focusedSlot 1개       | 레이아웃 컨테이너 + 반응형(ResizeObserver)                   | **중** — 다중 fit()/resize 타이밍, 셀 min-height |
| **PR-4**        | `SplitCellHeader`(뱃지/이름/status/확대/교체) + 빈 상태 + 슬롯 드롭다운(중복 가드)   | 셀 크롬 + 세션 지정 UX                                       | 낮음                                             |
| **PR-5**        | 키보드(`Cmd+1..4`, 셀 간 nav) + 접근성(roving tabindex, aria)                        | a11y 마감                                                    | 낮음                                             |
| **PR-6 (후속)** | detach 연계, 드래그드롭 슬롯 배치                                                    | 비필수, 별도 릴리스                                          | 중                                               |

**퍼포먼스 게이트**: PR-3 머지 전 `docs/perf-fleet-grid.md` 의 측정 프로토콜을 **풀 xterm 4분할 버전으로 확장**해 실측(§6). 4분할 라이브에서 60fps·메모리 스파이크 기준 통과 확인.

### 리스크 정리

- **성능(중)**: 풀 xterm 은 `MiniTerminal`(<pre>)보다 페인트 비용이 높다. 다만 (a) 분할 수를 2/3/4로 상한, (b) 숨김 셀은 이미 write 만 하고 페인트 안 함(status quo), (c) settle-window batching(28ms/80ms, `TerminalView.tsx:235-236`)과 scrollback 500 캡이 이미 적용. 마진 비용 = "visible K개의 페인트 + fit". K≤4 에서 관리 가능하다는 가설 → PR-3에서 실측.
- **세션당 xterm 1개 원칙 위반(중)**: 같은 세션을 두 셀/두 창에 넣으면 `removeListeners`/`resize` 충돌. 슬롯 중복 가드 + detach 이관 방식으로 방어(§3.2, §4.4).
- **fit() 경쟁(낮음)**: 여러 셀이 동시에 fit → 각자 `ResizeObserver` 로 독립 처리되므로 실제 경쟁 없음. rAF 스로틀(`TerminalView.tsx:402-421`) 이미 존재.
- **의존성**: 신규 npm 의존성 **없음**(xterm/addon 이미 사용 중).
- **포크 확산 주의(낮음)**: `OrchestratorTerminal.tsx` 는 `TerminalView` 와 거의 동일한 풀 xterm 병렬 구현(fit/replay/nudge 중복). PR-1 의 `isVisible`/`isFocused` 리팩터를 계기로 **세 번째 포크를 만들지 말 것** — 공통 로직을 `TerminalView` 로 수렴시키거나 최소한 분할뷰는 `TerminalView` 만 사용.

---

## 6. 데모/썸네일 관점

- **가능한가**: **예.** 풀 라이브 xterm 3분할은 각 셀이 실제 CLI(Claude/Codex/Gemini)의 컬러 출력을 그대로 렌더 → "3개 터미널에 코드가 동시에 쏟아지는" 장면이 정확히 연출된다. (미러 `<pre>` 로는 컬러가 없어 불가 → 분할뷰가 풀 xterm 인 이유이기도.)
- **연출 팁**:
  - 3분할(2:claude / 3:codex 색 대비)로 vendor stripe color 가 프레임에서 즉시 구분.
  - ①②③ 뱃지가 "여러 에이전트가 병렬로 일한다"는 메시지를 자막 없이 전달.
  - `⤢ 확대`로 하나를 키웠다가 다시 3분할로 — "지켜보다가 개입"하는 control-plane 서사(메모: `marblo_product_positioning`)와 정합.
- **썸네일**: 3분할 상태에서 각 셀이 서로 다른 색으로 활발히 출력 중인 프레임 1장 = "AI-native 팀을 지켜보는 control plane" 를 한 장으로 요약.

---

## 7. 핵심 결정 (요약)

1. **위치**: 하단 `AgentListPanel` 안의 "레이아웃 모드"로 통합 — 이미 마운트된 라이브 xterm 재사용, 재마운트 0. (신규 탭 X)
2. **풀 xterm 그리드** — `MiniTerminal` 미러 확대가 아니라 `TerminalView`(풀 라이브) K개 배치. 데모의 컬러 코드 연출 위해 필수.
3. **세션당 라이브 xterm 1개 원칙** — 분할 셀은 반드시 서로 다른 세션. `removeListeners`/`resize` 파괴적 부작용 때문.
4. **`isActive` → `isVisible`/`isFocused` 분리** — 다중 visible(fit) + 단일 keyboard focus.
5. **작은 PR 6개로 분할**, PR-3(레이아웃) 전 4분할 풀 xterm 성능 실측 게이트. 신규 의존성 없음. detach·드래그드롭은 후속.

---

## 부록 A — 참조 파일 (조사 근거)

| 파일                                    | 라인             | 근거                                                       |
| --------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `agents/list-panel/AgentListPanel.tsx`  | 393-459          | 모든 PTY 세션의 TerminalView 동시 마운트 + visibility 토글 |
| `terminal/TerminalView.tsx`             | 397-400, 496     | `pty.resize`/`removeListeners` 파괴적 부작용               |
| `terminal/TerminalView.tsx`             | 235-269, 508-530 | settle-batch, `isActive` 이중 책임(fit+focus)              |
| `agents/MiniTerminal.tsx`               | 전체             | `<pre>` 경량 미러(풀 xterm 아님)                           |
| `stores/ptyMirrorStore.ts`              | 9-16, 165-185    | 다중 구독 허용 + removeListeners 파괴성 명시               |
| `agents/AgentFleetGrid.tsx`             | 전체             | Grid 뷰(미러) — 분할뷰와 별개 계층                         |
| `stores/agentFocusStore.ts`             | 전체             | focused row SSOT                                           |
| `electron/main.ts`                      | 594, 2829-2866   | `ptyOwners` 세션당 단일 소유 창 + `sendToOwner` 라우팅     |
| `electron/preload.ts`                   | 89-102           | `pty.onData`(가산 구독) / `removeListeners`(채널 전체)     |
| `components/DetachedLayout.tsx`         | 20-26            | detach 는 탭 단위, 에이전트 패널 제외                      |
| `electron/windowSession.ts`             | 32-38            | detached 창을 영속 대상에서 제외                           |
| `orchestrator/OrchestratorTerminal.tsx` | 전체             | `TerminalView` 와 거의 동일한 풀 xterm 포크(수렴 대상)     |
| `docs/perf-fleet-grid.md`               | 전체             | 성능 측정 프로토콜(분할 xterm 버전으로 확장)               |
