# Marblo - Progress

## Completed

### MCP 익명 폴백 제거 — fail-closed 정합 + bridge 자가 재인증 (2026-07-19, PR #499, 티켓 etTRzsjq)
[P0·보안] MCP 서버가 custom-token 인증 실패 시 signInAnonymously 로 조용히 진행 → fail-closed firestore.rules 아래서 전 Firestore 도구가 PERMISSION_DENIED 로만 보이는 무증상 마비 (2026-07-19 실측: 브릿지 경로만 동작, 복구는 앱 재시작뿐). 익명 세션도 missions CRUD/users read/audit_logs 등 접근 가능해 보안상으로도 나빴음(실측).
- mcp-server/firebase.ts: 익명 폴백 완전 제거, 인증 상태 머신 + `ensureAuthenticated()` 게이트. 미인증 시 bridge `POST /agent-custom-token`(신설)으로 신선한 토큰 받아 자가 재인증(single-flight+10s 쿨다운) — **앱 재시작 없는 복구 경로**. 실패 시 "룰/멤버십 문제가 아니라 MCP 인증 문제" 명시 에러. opt-in: `MARBLO_MCP_ALLOW_UNAUTHENTICATED=1`(테스트용)
- firebase-auth-sync.ts: 거부 시 ok:false 정직 반환(예전엔 ok:true 라 renderer 오인 — 티켓 7qohuvyF 뿌리), env 토큰은 검증 성공 시에만 설정. `issueFreshAgentCustomToken()` — mission app 실사용자 세션에서만 발급(익명 409), 발급 시 env 갱신으로 이후 spawn 에이전트도 신선한 토큰 상속
- mission-engine/firebase-app.ts(제3의 동일 패턴): 무효 토큰 코드면 env 정리 후 missions 전용 익명 베이스라인 유지(룰 한시완화 의존), 네트워크 에러는 재시도 루프
- 검증: typecheck·eslint·신규 유닛 15건 통과, dist-mcp 스모크(핸드셰이크 173ms 무회귀, 무토큰 호출 시 명시 에러). 라이브 E2E 는 앱 재시작 필요 — 승인 대기. UI 가시화는 티켓 7qohuvyFNHRJFQP5SubV 소관
**신규 파일:** v3/tests/unit/{mcp-auth-gate,firebase-auth-sync}.test.ts
**수정 파일:** v3/electron/mcp-server/{firebase,tools,cli-fallback}.ts, v3/electron/{firebase-auth-sync,bridge-server}.ts, v3/electron/mission-engine/firebase-app.ts, v3/tests/unit/mcp-task-agent-id.test.ts

### 워크트리 조회 성능 — ensureFresh 20~26s 블로킹 제거 (2026-07-18, 티켓 yJgz7s03)
사장님 라이브 증상 "워크트리보기 버튼 누르려니 티켓 화면이 느려짐"의 근본수정. 프로파일링 실측(재현 18.8s/670개, PR#489 실측 20~26s와 일치)으로 병목 특정: 열거(`git worktree list`)는 0.17s뿐이고, **워크트리 1개당 git spawn 7회 × 670개 = 4,686회를 무제한 Promise.all 로 동시 실행**하는 프로세스 폭주가 원인 (비경합 시 명령당 18ms → 경합 시 1~5s).
- `worktree:listLight` IPC 신설(열거만): ensureFresh(카드/모달 경로)가 이걸 타서 **18.8s → 0.17s**. HEAD 미변경 워크트리는 기존 status 보존 병합, HEAD 이동 시 낡은 status 폐기(오표시 방지). PR#489 정확성(세션 중 생성 워크트리 버튼 노출) 유지 — TTL 60s 그대로.
- full refresh(WorktreeTab): 동시성 16 제한 + ahead=0(merged) 워크트리의 diff/merge-tree 생략 → **18.8s → 13.5s**, spawn 3,906회, 동시 프로세스 658→16 (시스템 전체 끌어내림 제거).
- 남은 근본원인: short-traiding-ai 에 stale 워크트리 645개 등록(merged 391) — 물리 삭제는 파괴적이라 사장님 승인 대기 (12s 하한은 이 데이터 정리 없인 못 내림).
**수정 파일:** v3/electron/{worktree-ipc,worktree-manager,preload}.ts, v3/src/stores/worktreeStore.ts, v3/src/types/worktree.ts, v3/src/vite-env.d.ts, v3/tests/unit/{worktreeStore,worktree-manager}.test.ts

### marketing_contacts SoT — Firestore 운영 SoT + BigQuery 분석 미러 (2026-07-18)
이메일 마케팅 데이터 기반 구현 (티켓 kKgzB91jskKwAgxT5Ukp, 감사 qFEzBLhBCpGIBnJJg9Xg 후속).
- Firestore `marketing_contacts/{sha256(email)}`: 암호화 이메일(AES-256-GCM)·수신동의(emailMarketingConsent, legalBasis 구분)·unsubscribe·구독/파운더 미러·segments·lifecycleStage. consent_events 감사로그. push_tokens 는 스키마만.
- ★사장님 정정(2026-07-18): waitlist 41명은 consent=**pending**(발송 제외)으로 적재 — 폼 체크박스가 활동/인용 동의라 마케팅 수신동의 아님(COMPLIANCE-AUDIT D2). granted 는 explicit_opt_in 재동의 후에만. 백필 직후 emailable 0 이 정상.
- write 훅 4개(auth onCreate 실가입만·waitlist·founders·subscriptions) + 어드민 백필(backfillMarketingContacts, dryRun 기본). ★Auth 4,954 중 custom-token 에이전트 제외(실가입 ~34).
- one-click unsubscribe(RFC 8058, HMAC stateless 토큰) + 마케팅 발송 게이트(sendFounderFollowupEmails·previewFounderSurveyOffer 에 skippedNoConsent) + List-Unsubscribe 헤더/푸터.
- BQ 미러: marblo_marketing.contacts_daily(일1회 04:45 KST, snapshot_date 파티션) + contacts_latest 뷰. BQ 엔 평문/암호문 이메일 미적재.
- 신규 env: MARKETING_EMAIL_ENC_KEY, MARKETING_UNSUB_SECRET (이름만, 값 비커밋).
**신규 파일:** v3/functions/src/marketingContacts.ts, v3/functions/src/marketingContacts.test.ts, v3/docs/MARKETING_CONTACTS.md
**수정 파일:** v3/functions/src/index.ts, v3/functions/package.json, v3/firestore.rules

### 워크트리 UX 미표시 근본수정 — 스토어 1회성 스냅샷 → ensureFresh (2026-07-18, PR #489, 티켓 ZHCW4yX6)
"이 워크트리 보기" 버튼(#476)이 재빌드 후에도 안 보이던 P0. 라이브 CDP 실측으로 근본원인 확정: TaskCard 모듈 레벨 `didRequestWorktrees` 플래그 때문에 worktreeStore.refresh() 가 부팅 시 1회만 실행 → 세션 중 생성된 워크트리는 스토어에 없음 → findTaskWorktree null → 버튼 조용히 미렌더 (열린 태스크 63개 전원 매칭 실패 실측). 수정: TTL 60s `ensureFresh` + refresh in-flight 공유(1회 실측 20~26s/681 워크트리), 카드/모달 오픈 시 재조회, 매칭 실패 시 "연결된 워크트리 없음·다시 찾기" 폴백 UI. 워크트리 정리(#475)는 정상 동작 확인: git 등록 681개 → 루트 셀렉터 노출 59개. short-traiding-ai 저장소에 stale 워크트리 645개 등록 — 물리 삭제는 별도 결정 필요.
**수정 파일:** v3/src/stores/worktreeStore.ts, v3/src/components/board/TaskCard.tsx, v3/src/components/board/TaskDetailModal.tsx, v3/src/locales/{ko,en}/board.ts, v3/tests/unit/{taskWorktree,worktreeStore}.test.ts

### v4.12 — WebGL renderer 재활성화 + CSS containment (실제 latency fix) (2026-04-30)
사용자 Performance profile Bottom-up 분석 결과:

| 항목 | Self time | 비중 |
|---|---|---|
| Paint | 24.1ms | 11.8% |
| Layout | 20.5ms | 10.0% |
| Match case (CSS selector) | 16.3ms | - |
| Commit | 13.6ms | 6.7% |
| Pre-paint | 13.6ms | 6.7% |
| Recalculate style | 13.3ms | 6.5% |
| Layerize | 13.2ms | 6.4% |
| **합계 (rendering pipeline)** | **~115ms** | - |
| pointerover (Total) | 38.2ms | 18.6% |
| **showCursorOverlay (우리 코드)** | **2.8ms** | **1.4%** |

**진단:** 우리 IME 패치는 무관 (2.8ms). 진짜 비용은 **브라우저 렌더링 파이프라인** — xterm DOM renderer가 cell 업데이트 → 무거운 React/Tailwind 트리 전체에 layout/style/paint cascade → ~115ms.

**v4.12 수정 — 두 가지 동시 적용:**

1. **WebGL renderer 재활성화 (`TerminalView`/`OrchestratorTerminal`).** xterm WebGL addon → grid를 GPU에서 렌더 → DOM layout/paint 거의 0. 358c623에서 disable했지만 IME 패치 검증된 지금은 안전.
```typescript
const webglAddon = new WebglAddon();
webglAddon.onContextLoss(() => webglAddon.dispose());
terminal.loadAddon(webglAddon);
```

2. **CSS containment 두 wrapper에 추가.**
```css
contain: layout style paint;
```
xterm 영역 변경이 부모 React/Tailwind 트리 invalidation 안 일으킴. 8a5be31에서 시도했지만 다른 변경과 묶여서 revert됨; 단독 시도.

**예상 효과:**
- WebGL: Layout/Paint/Style ~80ms 감소 가능
- Containment: cascade 차단으로 추가 감소
- 합쳐서 avgInputDelay 150ms → 50ms 미만 가능성

**Risk:**
- WebGL: 358c623에서 DOM이 IME에 더 좋다 가정했지만 그건 다른 context. 그래도 visual artifact 가능성 있음.
- contain:strict는 예전에 회귀 — `layout style paint` (less aggressive) 사용.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/components/terminal/TerminalView.tsx`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`

### 한글 IME 패치 v4.11 — strip 완전 제거 (Performance bottleneck 발견) (2026-04-30)
사용자 Performance profile에서 결정적 단서: textarea (compose strip 적용된 element)가 **slow source로 잡힘**. HTML inspector 출력:
```
<textarea class="xterm-helper-textarea" style="pointer-events: auto; inset: auto auto 2px 4px; width: 62.6145px; height: 15px; ... transition: opacity 120ms ease-out;">
```

**진단:** Strip이 매 compositionstart마다 inline style 20+ 개 설정 + transition 적용. textarea는 OS IME가 native rendering하는 element라 우리 inline style이 OS-level paint와 상호작용하면서 expensive 함. 추가로 helpers container 100% 확장도 layout invalidation surface 키움.

**v4.11 변경 — Strip 완전 제거:**

1. **textarea 모든 inline styling 제거.** xterm 기본 hidden 상태 (opacity:0, z-index:-5) 유지. 사용자가 textarea를 보지 않음.
2. **helpers container 100% 확장 revert.** v4.1에서 했던 width/height 100% 제거. xterm 기본 (top:0, content-sized) 복귀. Layout invalidation surface 축소.
3. **`triggerFadeOut` no-op 처리.** Strip 없으니 fade할 게 없음. Function은 유지 (call site 호환).
4. **Cursor 위치 overlay (compositionView)는 유지.** 매 compositionupdate마다 cursor 위치에 char 표시. 사용자가 보는 visual feedback은 overlay 단독.

**효과:**
- 매 keystroke의 textarea style recalc + paint 비용 제거
- Helper container의 큰 layout invalidation surface 제거
- 사용자 visual은 overlay로 충분 (cursor 위치에서 zero-latency)
- 기존 ime-composing 클래스로 cursor 숨김 + onWriteParsed 동기화는 유지

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.10 — strip opaque bg + cursor CSS 강화 (2026-04-30)
v4.9 결과: 사용자 비디오 분석 (`화면 기록 2026-04-30 오후 4.00.19.mov`, ffmpeg로 101프레임 추출):
- ❌ 좌하단 strip이 transparent라서 Claude Code의 "bypass permissions on" 텍스트랑 시각적으로 겹침. 사용자가 "한장소에서 겹쳤다가 생성"으로 인지.
- ❌ Composition 중 cursor block이 prompt에 여전히 보임. v4.9의 `visibility: hidden` CSS가 xterm DOM renderer의 cell-background-based cursor styling을 충분히 override 못 함.

**v4.10 수정 1 — Cursor 숨김 강화:**

xterm DOM renderer는 cursor를 별도 element가 아니라 cell의 `background-color = foreground` 인버전으로 표현. `visibility: hidden`만으론 부족 → 모든 styling property override:

```css
.xterm.ime-composing .xterm-cursor,
.xterm.ime-composing .xterm-cursor-block,
.xterm.ime-composing .xterm-cursor-bar,
.xterm.ime-composing .xterm-cursor-underline,
.xterm.ime-composing .xterm-cursor-outline {
  background-color: transparent !important;
  background: transparent !important;
  color: inherit !important;
  text-shadow: none !important;
  box-shadow: none !important;
  outline: none !important;
  border: none !important;
}
.xterm.ime-composing .xterm-cursor-blink { animation: none !important; }
```

**v4.10 수정 2 — Strip background opaque:**

Strip background를 `transparent` → terminal background color (`opts.theme.background` or `#1e1e2e`). bypass permissions 텍스트 같은 underlying content를 가림 → 시각적 겹침 사라짐.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.9 — xterm cursor 숨김 + z-index 1000 (2026-04-30)
v4.8 결과: ✅ overlay 매 jamo마다 갱신됨. ❌ 사용자 보고: "커서 오버랩이 아직도 있어". xterm cursor가 overlay 뒤로 보임. z-index 100이 충분하지 않거나 stacking context 차이.

**v4.9 수정:**

1. **CSS 주입으로 cursor 숨김.** `<style>` 태그 1회 주입, terminal element에 `ime-composing` 클래스 토글:
```css
.xterm.ime-composing .xterm-cursor { visibility: hidden !important; }
.xterm.ime-composing .xterm-cursor-blink { animation: none !important; }
```

2. **Class 라이프사이클:**
   - `compositionstart` → 클래스 추가
   - `onWriteParsed`에서 grid 업데이트 시 → 클래스 제거 (단, `_isComposing === false`일 때만 — fast typing 중엔 유지)
   - `fadeFallbackTimer` (400ms) → 동일 로직으로 제거

3. **Overlay z-index 100 → 1000.** Stacking context 충돌 회피 강화.

**시각적 효과:**
- Composition 중: xterm cursor 안 보임, overlay만 cursor 위치에 char 표시
- Grid 업데이트 시: 클래스 제거되며 xterm cursor 자연스럽게 advanced 위치에 등장 (xterm이 buffer.x 이미 advance했음)
- 결과: char 등장 + cursor advance가 동시에 일어나는 정상 터미널 타이핑 흐름

**Race condition fix:** fast typing 시 한 echo 도착 후에도 국 composition 진행 중이면 클래스 유지 (`!_isComposing` 체크).

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.8 — composition 중 실시간 overlay 갱신 (2026-04-30)
v4.7 결과: ✅ overlay 작동, ✅ "그전보다는 좋아짐". ❌ 두 이슈:
1. **마지막 글자가 다음 키 누를 때까지 grid에 안 보임.** v4.7은 compositionend 시점에만 overlay 표시 → IME가 음절 commit하기 전엔 cursor에 char 안 보임. macOS Hangul IME는 syllable이 "완성"되어도 다음 키(스페이스/다른 글자) 없이는 commit 안 함.
2. **Cursor가 overlay 뒤로 살짝 보임.** z-index 6이 부족.

**v4.8 수정:**

1. **compositionupdate에서 overlay 갱신.** ev.data (현재 composition 문자열, "ㅎ" → "하" → "한")로 매번 overlay 업데이트. 사용자가 cursor 위치에서 char 빌드업 진행을 실시간으로 봄. compositionend 기다리지 않음.

```typescript
helper.compositionupdate = function(ev) {
  // ... position tracking ...
  if (ev.data) {
    showCursorOverlay(ev.data);  // 매 jamo마다 cursor에 즉시 갱신
  }
};
```

2. **z-index 6 → 100.** xterm cursor decoration의 z-index와 충돌 회피.

**효과:** 사용자가 ㅎ 누르는 순간 cursor 위치에 ㅎ 등장. ㅏ 누르면 즉시 하로 갱신. ㄴ 누르면 한. **PTY 왕복 없이 모든 in-progress char가 cursor에 zero-latency 표시.** 마지막 음절도 (commit 전) cursor 위치에 visible 유지.

**라이프사이클:**
- compositionstart → overlay/strip 둘 다 visible 준비
- compositionupdate → overlay에 ev.data 갱신 (cursor 위치)
- compositionend → overlay에 committed char 표시 (showCursorOverlay 다시 호출, redundant이지만 safe)
- onWriteParsed (PTY echo grid 도착) → overlay + strip 동시 fade

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.7 — cursor 위치 overlay (real-time 체감) (2026-04-30)
v4.6 결과: ✅ strip 좌하단은 OK. ❌ "스트리밍 채팅창에 스트리밍 되는게 여전히 크게 느려, 실시간성이 안나옴". 원인: PTY 왕복 + main thread contention (~150ms). Strip은 좌하단이라 사용자 시선이 cursor 위치에 있을 때 strip 못 봄.

**v4.7 컨셉:** xterm의 unused `_compositionView`를 cursor 위치 overlay로 재활용. compositionend 시 cursor 위치에 committed char를 즉시 DOM overlay로 표시. xterm grid는 건드리지 않음 (local echo 충돌 회피). Grid 업데이트 시 (onWriteParsed) overlay fade.

**구현:**
```typescript
const showCursorOverlay = (input) => {
  const buffer = helper._bufferService.buffer;
  const cell = helper._renderService.dimensions.css.cell;
  const cursorX = Math.min(buffer.x, ...);
  const view = helper._compositionView;  // 재활용
  view.textContent = input;
  view.style.left = cursorX * cell.width + 'px';
  view.style.top = buffer.y * cell.height + 'px';
  view.style.color = fg;
  view.style.background = bg;  // terminal background로 cursor 가림
  view.style.zIndex = '6';
  view.style.transition = 'opacity 100ms ease-out';
  view.style.opacity = '1';
  view.classList.add('active');
};

helper.compositionend = function() {
  // ... finalize, PTY 전송 ...
  showCursorOverlay(input);  // 즉시 cursor 위치에 DOM overlay
};

terminal.onWriteParsed(() => {
  if (pendingFade) {
    triggerFadeOut();    // strip fade
    hideCursorOverlay(); // overlay fade (둘 다 grid 업데이트 시점에)
  }
});
```

**시각적 효과:** 사용자가 한글 음절 완성 순간 → cursor 위치에 char가 즉시 등장 (DOM overlay). 동시에 strip도 visible. ~150ms 후 grid에 char 도착 → overlay와 strip 동시에 fade. **사용자 시선 위치(cursor)에 char가 zero-latency로 보임.**

**Grid 충돌 없음:** Local echo (v4.4)는 xterm.write 호출로 grid 자체에 char 써서 Claude Code redraw랑 충돌. v4.7는 overlay만 (grid 안 건드림) → Claude Code redraw 자연스럽게 grid 처리.

**Risk:** Claude Code가 prompt redraw 시 cursor 이동시키면 overlay 위치와 grid 위치 어긋날 가능성. Overlay 표시 시간 ~150ms 짧고 fade out 100ms라 큰 위치 차이 없으면 자연스러움. 위치 어긋남 크면 회수 필요.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.6 — onWriteParsed 동기화 fade-out (2026-04-30)
v4.5 결과: ✅ visual bug 사라짐. ❌ "타이밍에 맞춰 스트리밍 안 되고 멈췄다 생성". 측정: avgInputDelay 122-154ms, MAIN-BUSY 100ms drift (main thread 100ms 막힘, 50ms threshold라 LONGTASK엔 안 잡힘).

**진단:** v4.5 fade-out이 130ms 고정 timer라서 PTY echo 도착 시점 (50-200ms 가변)과 동기화 안 됨. 결과:
- compositionend → strip fade 시작
- 130ms 후 strip 사라짐
- 추가 50-100ms 후 grid에 char 등장
- → "blank gap" 이 멈춤 느낌의 정체

**v4.6 수정:** xterm의 `onWriteParsed` 이벤트로 grid 업데이트 시점 잡아서 fade를 동기화.

```typescript
let pendingFade = false;
let fadeFallbackTimer: number | null = null;

terminal.onWriteParsed(() => {
  if (pendingFade) {
    pendingFade = false;
    if (fadeFallbackTimer !== null) clearTimeout(fadeFallbackTimer);
    triggerFadeOut();  // 130ms transition
  }
});

helper.compositionend = function() {
  // ... sync finalize, PTY 전송 ...
  pendingFade = true;
  fadeFallbackTimer = window.setTimeout(() => triggerFadeOut(), 400);
};
```

**작동 원리:**
- compositionend → strip 그대로 visible 유지 (`pendingFade = true`)
- PTY echo가 grid에 도착 → xterm parse → `onWriteParsed` fire → strip fade 시작
- → strip 사라지는 시점 = grid에 char 등장 시점. 시각적 gap 없음.
- Fallback timer (400ms): shell이 느리거나 echo 없을 때 strip이 hanging 안 되게.

**Race fix:** `compositionstart`에서 pending fade/fallback timer + `pendingFade` flag 모두 cancel (다음 composition 즉시 visible).

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.5 — local echo 제거 + fade-out streaming (2026-04-30)
v4.4 결과: ✅ 폰트/크기 OK, ✅ streaming 체감 좋음. ❌ "조금 앞으로 갔다가 다시 채워지는 느낌" + 기존 텍스트 안 지워지는 듯한 visual 버그.

**진단:** Local echo (`terminal.write(input)` at compositionend)가 Claude Code 같은 TUI 앱과 충돌. Claude Code는 매 input마다 prompt area를 redraw — 우리 local echo가 grid에 char 쓰고 cursor 전진, 그 후 Claude Code의 redraw가 cursor reposition + line clear + prompt 재출력. 결과: char가 잠깐 보였다가 살짝 다른 위치로 이동하는 느낌, 또는 중복된 흔적.

**v4.5 변경:**
1. **Local echo 제거.** `terminal.write(input)` 한 줄 삭제. PTY 전송만 함. Claude Code의 redraw가 grid를 자연스럽게 처리.
2. **Strip fade-out 애니메이션.** compositionstart 시 `transition: opacity 120ms ease-out` 적용. compositionend 시 `opacity: 0` 설정 → CSS가 부드럽게 fade. 130ms 후 모든 inline style reset (xterm `_syncTextArea` 인계).
3. **Fade timer race fix.** fast typing 시 fade-out timer가 다음 composition 스타일을 덮어쓰는 race 방지 — `compositionstart`에서 pending timer cancel.

**Streaming 체감 유지 방식:** Strip이 in-progress char를 실시간 표시 (OS IME native rendering) + compositionend 시 즉시 사라지지 않고 fade-out → PTY echo가 grid에 도착하는 시점과 균질하게 시각적 transition. Local echo의 grid 충돌 없이도 "char가 흘러가는" 느낌 유지.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.4 — local echo (streaming) + visual 축소 (2026-04-30)
v4.3 결과: ✅ functional bug fix됨 (텍스트 정상 입력). ❌ 폰트 너무 큼 (bypass permission UI 침범), ❌ latency 여전. 사용자 요청: terminal 폰트와 동일하게, 더 아래로, **PTY 왕복 기다리지 않고 한글자 만들어지는 속도에 맞춰 streaming**.

**v4.4 수정 1 — Visual 축소:**
- 폰트 크기: terminal 동일 (1.3× 제거)
- Strip 높이: 1× cell (1.5× 제거)
- 위치: bottom 2px, left 4px (corner 가깝게)
- Width: 8 cells (14 → 8)
- padding 0 (텍스트 자연스럽게 연결)

**v4.4 수정 2 — Local echo (streaming):**
사용자 요구의 "한글자 만들어지는 속도에 맞춰 스트리밍" 구현. compositionend 시 PTY 왕복 기다리지 않고 xterm grid에 즉시 렌더:

```typescript
if (input.length > 0) {
  terminal.write(input);                              // 즉시 grid 렌더 (local echo)
  this._coreService.triggerDataEvent(input, true);    // PTY 전송
}
```

**작동 원리:** compositionend 시 xterm.write로 char를 cursor 위치에 즉시 렌더. PTY round-trip (50-200ms) 기다리지 않음. 사용자 체감: 음절 완성 순간 grid에 등장. shell이 echo를 보내면 그 echo의 render가 우리 local echo 위에 덮어쓰지만, 같은 위치/같은 문자라 시각적으로 seamless.

**Risk:** Claude Code (또는 shell)가 echo 시 다른 ANSI sequence (cursor 이동, line clear 등)를 보내면 우리 local echo가 잠깐 보였다 사라지거나 위치 어긋남. 사용자 실측으로 확인 필요. 문제 있으면 `terminal.write(input)` 한 줄만 제거하면 v4.3로 복귀.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.3 — 동기 compositionend + visual 정리 (2026-04-30)
v4.2 결과: strip에 한글자만 표시는 해결됐으나 **functional bug**: "지금 작성된 컨텐츠의 연결이 안되고 이상하게 입력됨". 사용자는 visual 변경도 요청 — 검은 배경 제거, 폰트 크게, padding 더.

**진단 (functional bug):** v4.2의 compositionstart에서 textarea.value 클리어한 게 원인. xterm 원본 compositionend는 setTimeout(0) 비동기 패턴 사용 (waitForPropagation). 빠른 타이핑 시:
1. compositionend (음절1) → finalize setTimeout 큐잉 (start/end position 캡처)
2. 사용자 다음 키 입력 → compositionstart (음절2) 큐잉
3. 만약 compositionend 핸들러 실행 중 키 입력이 큐에 들어오면, compositionstart가 finalize setTimeout 보다 먼저 처리됨
4. compositionstart의 textarea clear → textarea.value = ''
5. finalize setTimeout fire → textarea.value 읽음 → 이미 비워졌거나 새 음절로 교체됨 → **잘못된 데이터 또는 빈 데이터 PTY로 전송**

**v4.3 수정:**
- **compositionend를 완전히 동기화** — original `compositionend`/`_finalizeComposition` 호출 안 함. setTimeout 패턴 제거. Chromium은 compositionend 시점에 textarea.value 업데이트 완료되므로 sync read 안전.
- compositionstart의 textarea clear 제거. compositionend에서 sync clear.
- `_coreService.triggerDataEvent`을 직접 호출 (helper의 private field).

**Visual 변경 (사용자 요청):**
- 검은 배경 제거 (`background: transparent`)
- 폰트 크기 1.3× (13px → 17px)
- 높이 1.5× cell (여유 padding)
- 위치 6px/6px (살짝 corner에서 띄움)
- borderRadius/boxShadow 제거 (배경 없으니 불필요)

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.2 — textarea 누적 fix + 위치 미세조정 (2026-04-30)
v4.1 결과: 좌하단 strip 보이고 latency 개선 (avgInputDelay 138-271ms → 88-162ms, p95 spike 800-2896ms → 192-344ms). 사용자 보고: ✅ "끊기는 느낌 나아짐", "속도 개선됨", "시각적 분산효과로 체감 latency 줄어듦". ❌ 두 가지 이슈:

1. **strip에 텍스트 누적** — "한" + "국" 타이핑 시 strip이 "한국" 표시 (이전 syllable 안 사라짐). 지운 텍스트도 남음.
2. **위치 overlap** — Claude Code의 bypass permission UI와 strip이 겹침.

**진단 1:** xterm은 textarea.value를 blur나 Ctrl+C/Enter 칠 때만 비움 (Terminal.ts:292, 1067). 그 사이엔 누적. textarea 숨겨져 있을 땐 무관했지만 우리가 visible하게 만들어서 누적이 보임.

**수정 1:** patch의 `compositionstart` 시작 부분에 `textarea.value = ''` 추가. compositionstart는 browser가 새 char 추가하기 전에 fire되므로 clear 안전. `compositionend`에서 clear는 fast typing race condition 위험 (다음 compositionstart가 finalize setTimeout 전에 fire될 수 있음).

**수정 2:** strip 위치 `bottom: 8px → 2px, left: 8px → 4px` — 좌하단 corner에 더 가깝게.

**최종 INP (v4.2 측정 후 업데이트 예정):** 사용자 실측 필요.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v4.1 — helpers container fix + key event 차단 (2026-04-30)
v4 결과: 좌하단 compose strip 안 보임 + 체감 더 부드러움 + "끊기는" 느낌 남음.

**진단 1 (compose strip 안 보임):** `.xterm-helpers` 컨테이너가 `position: absolute; top: 0`만 있고 width/height 정의 안 됨 → content-sized로 작은 영역이 됨. textarea의 `bottom: 8px; left: 8px`는 이 작은 컨테이너 기준이라 의도한 좌하단 위치가 아님.

**수정:** patch에서 `_helperContainer` width/height를 100%, left/right를 0으로 inline style 추가. `pointer-events: none`으로 컨테이너는 click-through, textarea만 `pointer-events: auto`로 focus 받게 함.

**진단 2 ("끊기는" latency):** Korean composition 시 keydown(229) + input event도 React root까지 bubble → React synthetic event system이 fiber tree walk → 누적 overhead.

**수정:** `TerminalView`/`OrchestratorTerminal`의 wrapper에서 `stopPropagation` 하던 이벤트 목록에 `keydown`, `keyup`, `input` 추가. xterm 핸들러는 textarea에 직접 바인딩되어 먼저 실행되므로 안전. Marblo의 hotkey 핸들러는 document 레벨이라 영향 없음.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`, `v3/src/components/terminal/TerminalView.tsx`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`

### 한글 IME 패치 v4 — textarea를 터미널 하단-왼쪽 compose strip으로 (2026-04-30)
v3 결과: textarea가 cursor 위치에 visible 상태로 있어서 **기존 터미널 cursor/텍스트와 시각적으로 겹침**. 사용자 보고: "커서가 텍스트를 가리는 것 같다".

**v4 컨셉:** Cursor (VSCode-fork 에디터) 제품의 chat input이 한글 in-progress를 채팅창 하단-왼쪽 별도 영역에 표시하는 패턴 차용. composition 중에만 textarea를 터미널 하단-왼쪽 고정 위치로 이동.

**구현 변경 (compositionstart):**
- `left: 8px`, `bottom: 8px`, `top/right: auto` → 터미널 하단-왼쪽 8px 인셋
- `width: cellW × 12` (한글 ~6자 여유), `height: cellH`
- `background: rgba(15, 15, 25, 0.92)`, `border-radius: 3px`, `box-shadow` → distinct compose strip 모양
- `padding: 0 6px`, `box-sizing: content-box` → 텍스트가 strip edge에 안 닿게
- `z-index: 50` → 터미널 grid 위에 표시
- color, font-family, font-size는 terminal 매칭

**작동:** 한글 타이핑 시 textarea가 좌하단 compose strip에 visible. OS IME가 그 안에 in-progress 글자 직접 렌더링. composition 끝나면 모든 inline style 제거 → CSS default (opacity 0)로 복귀. PTY echo로 완성된 글자가 cursor 위치에 등장.

**v3와 차이:** textarea 위치만 cursor → 좌하단 고정으로 변경. 폰트/색 매칭, OS IME native 렌더링은 동일.

**검증:** typecheck 통과.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts`

### 한글 IME 패치 v3 — textarea visible 방식 (Cursor 패턴 차용) (2026-04-30)
v2에서도 "한자리에서 멈춰서 작성되다가 넘어가는" 체감 답답함 남음. 원인: composition view가 heavy React/Tailwind 트리 안에 있고, compositionend → PTY 왕복 → xterm grid render 동안 main thread 경합.

**v3 컨셉:** xterm의 hidden textarea를 composition 중에만 visible하게 만들어서 OS IME의 native in-textarea 렌더링이 그대로 visual feedback이 됨. xterm의 composition view는 사용 안 함. Cursor의 채팅창이 빠른 이유 (OS가 직접 그림 → React/DOM 트리 우회)와 구조적으로 동일.

**구현 (`v3/src/lib/xtermIMEPatch.ts`):**
- `updateCompositionElements`: hard no-op (onRender에서도 안 돔)
- `compositionstart`: textarea에 inline style 적용 — opacity 1, z-index 5, terminal 폰트/색 매칭, caret 투명, width = cellW × 4 (CJK 2글자 여유)
- `compositionupdate`: position tracking만 (textarea value는 OS IME가 직접 씀)
- `compositionend`: textarea inline style 제거 → CSS default로 복귀 (opacity 0, width 0). 다음 `_syncTextArea` render 때 정상 위치로 reset. 그 다음 원래 compositionend (`_finalizeComposition`) 호출

**v2와 트레이드오프:**
- v2: xterm composition view 사용 → DOM mutation 매 keystroke (cell-dim positioning) → 작지만 React 트리 안에서 발생
- v3: textarea OS-native rendering → 우리 React 트리에 zero mutation → 이론상 더 빠름. 폰트 미스매치 시 visual flicker 위험.

**검증:** typecheck 통과. 사용자 실측 필요 — 한글 타이핑 중 (1) textarea 안 visible 렌더링이 보이는지, (2) "stuck→written" 답답함 줄었는지, (3) 폰트/위치 flicker 있는지.

**수정 파일:** `v3/src/lib/xtermIMEPatch.ts` (메서드 4개 모두 교체)

### 한글 IME 패치 v2 — visual feedback 복구 + layout flush 제거 (2026-04-30)
v1 (composition view 렌더링 제거) 결과: 시각적 stuck 느낌은 사라졌으나 **타이핑 중 in-progress char가 아예 안 보여서** "stuck → 갑자기 등장" UX regression. INP variability도 증가 (worst avgInputDelay 271ms로 상승).

**원인:** xterm의 textarea는 `opacity: 0` + `z-index: -5`. OS IME가 textarea에 char를 직접 쓰지만 사용자는 못 봄. xterm이 자체 `_compositionView`로 visual feedback 제공하던 걸 v1이 비활성화함.

**v2 수정 (`v3/src/lib/xtermIMEPatch.ts`):** `updateCompositionElements`를 layout-free 버전으로 **완전 교체** (no-op이 아니라 cell-dimension 기반 positioning으로 재구현):
- composition view에 textContent 쓰고 `.active` 붙임 → user가 ㅎ→하→한 진행 봄
- position은 `renderService.dimensions.css.cell` (이미 캐시됨) 사용 → no rect read
- textarea size는 `text.length × cellW × 2` (CJK 폭) 추정 → no rect read
- `setTimeout(0)` recursion 제거 → 1번만 update per event

**1dd0aa9와 차이:** 1dd0aa9는 view의 `getBoundingClientRect`만 synthetic value로 override (메서드 자체는 그대로 호출). 그 결과 200ms regression. v2는 `updateCompositionElements` 메서드 전체를 cell-dim 기반으로 교체 — rect 호출 자체가 코드 path에 없음. throttle/idle-skip 같은 추가 복잡도 없음.

**검증:** typecheck 통과. 사용자 실측 필요 — visual feedback 돌아왔는지 + INP 개선 여부.

**신규 파일:** `v3/src/lib/xtermIMEPatch.ts`
**수정 파일:** `v3/src/components/terminal/TerminalView.tsx`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`

### Phase 0 PRD v1.1 — Sprint A 코드베이스 검증 반영 (2026-04-29)
v3 코드베이스 사전 점검 결과를 PRD에 반영. 기존 부분 추상화 발견(`flow-engine/types.ts:LLMProvider`, `flow-engine/llm-provider.ts:createLLMProvider`, `pty-manager.ts:PtyManager`, `fs-manager.ts:FsManager`, `mcp-server/`)으로 Sprint A 작업량 3-4일 → 2-3일 단축. 두 LLM 클라이언트(`orchestrator/llm-client.ts` ↔ `flow-engine/llm-provider.ts`) 통합은 Sprint A 범위 외로 명시. 선결 조건(현재 INP/터미널 perf 수정 commit 정리, MM TerminalView 정리, `feat/adapter-foundation` 브랜치) 명문화.

**진행 결정:** 현재 진행 중인 INP/터미널 perf 수정 작업(13개 modified files)을 먼저 commit 정리 + main 머지 후, 별도 브랜치에서 Sprint A 착수.

**수정 파일:** `docs/03_marblo_phase0_foundation_prd.md` (v1.0 → v1.1)

### Phase 0 PRD 작성 — 6월 런칭 + Enterprise In-place 토대 (2026-04-29)
Core PRD v1.0의 Week 1-4 모노레포 빅뱅 마이그레이션 계획을 솔로 capacity + 6월 hard deadline에 맞춰 **in-place 점진적 준비**로 재설계. Phase 0(2026-05) must-do는 3개 Sprint로 한정.

**전략 결정:**
- 모노레포 마이그레이션, Gateway Agent, Control Plane, OPA, PII Scanner, Helm 등 Enterprise 본 기능은 첫 PoC 계약 이후로 **명시적 deferred**
- 5월에는 v3 in-place에서 인터페이스/훅/이벤트 토대만 추출 (총 6-9일 작업)
- Sprint A: Adapter 인터페이스 (LLM/MCP/FS/Terminal) — 3-4일
- Sprint B: PolicyHook 포인트 + NoOpPolicyHook — 1-2일
- Sprint C: 이벤트 스키마 + 로컬 JSONL 로깅 — 2-3일
- 6월 런칭은 Week 5-6 베타·결제·라이선스로 일정 그대로

**신규 파일:** `docs/03_marblo_phase0_foundation_prd.md`

### React event delegation 우회 + CSS containment (2026-04-29)
사용자 핵심 단서: **VS Code와 Cursor 터미널은 같은 Mac mini에서 정상**. 둘 다 xterm.js + Electron인데 우리만 느림 → 하드웨어/Electron/xterm 자체 baseline 아님. **Marblo 고유 코드의 회귀**.

**가설:** 우리만 갖고 있는 것 = Firebase 리스너, React + Zustand 다중 store, **React 17+ root 이벤트 위임**, Tailwind. 이 중 가장 의심스러운 것은 React event delegation. 매 keystroke마다 xterm의 hidden textarea 이벤트가 React root container까지 bubble되어 synthetic event system이 fiber tree를 walk함. event당 비용은 작지만 빠른 타이핑 시 inputDelay로 누적.

**수정:**
1. `OrchestratorTerminal` / `TerminalView` wrapper에 keyboard·composition 이벤트 `stopPropagation()` 핸들러 추가. xterm 자체 listener는 textarea에 직접 bind되어 있어 정상 동작 (bubble 단계에서 wrapper 도달 후 차단).
2. wrapper element에 `contain: strict` 추가. 터미널 layout/paint 영역을 격리해서 부모 트리(Sidebar, Header 등)의 invalidation 영향 차단.

**수정 파일:** `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### PTY data setImmediate batching 롤백 — INP 회귀 제거 (2026-04-29)
사용자 보고: "처음 최적화했을 때(WebGL + scrollToBottom)보다 지금이 더 느려졌다", 일반 native 터미널은 정상 → 우리 코드의 회귀.

**원인:** main.ts의 `setupPtyForwarding`에 추가한 same-tick `setImmediate` coalescing이 매 PTY chunk마다 1 Node tick의 latency를 추가하고, 같은 tick에 모인 chunk들을 join하면서 xterm refresh 1회당 처리량 증가 → 다음 keystroke의 inputDelay 상승.

**수정:** setImmediate batching 완전 제거. PTY chunk 즉시 `mainWindow.webContents.send` 직접 송신으로 복귀. (이전 시도들의 교훈 주석 남김)

**수정 파일:** `v3/electron/main.ts`

### Terminal iframe 격리 시도 후 롤백 — 효과 없음 확정 (2026-04-30)
한글 IME 100-200ms inputDelay 해결을 위해 xterm을 iframe 안으로 격리 시도. iframe 안에 PerformanceObserver 설치해서 직접 측정한 결과:

| 측정 위치 | p50 | avgInputDelay |
|---|---|---|
| 부모 직접 마운트 (이전) | 144-160ms | 130-160ms |
| **iframe 격리 (시도)** | **184-200ms** | **142-171ms** |

iframe 약간 더 느림 → 격리 효과 없음 확정. 이유: iframe element의 `getBoundingClientRect`는 viewport 좌표 반환을 위해 부모 layout flush까지 강제. iframe 안 element도 동일. 즉 layout 격리 자체가 안 됨.

**롤백:** OrchestratorTerminal.tsx, TerminalView.tsx를 50c45c2 시점으로 복구. TerminalIframe.tsx 삭제. PRD는 결과 기록 위해 보존 (향후 동일 시도 방지).

**최종 결론:** 이번 세션에서 한글 IME inputDelay ~150ms는 xterm.js + Marblo의 React/Tailwind 트리에서 fundamental baseline. monkey-patch, iframe 격리, contain CSS, event delegation bypass 모두 효과 없음. 영어 입력은 정상 작동.

### Canvas2D 렌더러 시도 후 WebGL 복귀 (2026-04-29)
WebGL → Canvas2D 전환했으나 INP inputDelay 80-260ms로 동일. **렌더러 선택이 병목이 아님**을 확정. Canvas는 사용자 체감상 약간 더 느림. WebGL로 복귀.

**결론:** 남은 100-200ms inputDelay는 xterm.js + Electron의 Mac mini 환경 baseline. 우리가 코드로 잘라낼 수 있는 영역 종료. 누적 9단계 최적화로 264ms → 150-200ms 개선 달성. 추가 절감하려면 Electron 의존성 자체를 떠나거나 더 빠른 하드웨어 필요.

**수정:** `OrchestratorTerminal`·`TerminalView`의 `CanvasAddon` → `WebglAddon` 복귀 (canvas-addon은 dependency로 남기되 미사용).

**수정 파일:** `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### cursorBlink off — RAF queue 압력 감소 (2026-04-29)
PTY IPC 60Hz throttle 시도(미적용 후 롤백 — per-frame xterm refresh 비용 증가로 presentation latency 악화 → INP 더 나빠짐). 진단 데이터 재해석: `LONGTASK` 부재 + `inputDelay` 100-300ms 패턴은 50ms 미만 task가 다수 누적되는 시나리오. 그 중 하나로 cursorBlink의 500ms 주기 RAF refresh 제거.

**수정:** OrchestratorTerminal과 TerminalView의 `cursorBlink: true → false`. cursor는 stationary로 표시. 입력 시 cursor 위치는 정상 갱신.

**수정 파일:** `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### INP 진단 도구 강화 (2026-04-29)
"멈췄다 한꺼번에 써지는" 타이핑 패턴은 main thread가 200-300ms 블록되는 long task 문제. 정확한 원인 추적용 PerformanceObserver 강화.

1. **`[LONGTASK]` 옵저버 강화**: `entry.attribution`을 함께 출력 — 어느 script/container가 멈춤을 일으켰는지 판별 가능.
2. **`[INP-SLOW]` 옵저버 신규**: Event Timing API(`type: 'event', durationThreshold: 100`)로 keydown/keyup/input의 INP를 input delay / processing / presentation 3구간으로 분해 출력. inputDelay가 크면 키 이벤트 도달 전 다른 task가 main thread 점유, processing이 크면 xterm 내부 또는 우리 핸들러 문제, presentation이 크면 핸들러 후 paint까지 다른 task 끼어듦.

**수정 파일:** `v3/src/App.tsx`

### xterm 패키지 마이그레이션 — WebGL 호환성 확보 (2026-04-29)
WebGL addon이 `Cannot read properties of undefined (reading 'createElement')` 에러로 silent fallback DOM 모드로 동작 중이던 문제 수정.

**원인:** `xterm@5.3.0`(구 패키지명) ↔ `@xterm/addon-webgl@0.19.0`(신 패키지, @xterm/xterm@6 가정) 간 internal API 불일치.

**수정:**
- `xterm` → `@xterm/xterm@^5.5.0` (신 namespace, v5 라인) 마이그레이션
- `@xterm/addon-webgl` 0.19 → 0.18 (peer @xterm/xterm@^5.0.0)
- import 경로: `xterm` → `@xterm/xterm`, `xterm/css/xterm.css` → `@xterm/xterm/css/xterm.css`
- 구 `xterm` 패키지 제거

**수정 파일:** `v3/package.json`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### Orchestrator 터미널 INP 추가 최적화 — store 구독 granular + PTY IPC 배치 (2026-04-29)
INP 264ms 스파이크 추가 개선. 출력 burst 시 IPC 이벤트 폭주 + Zustand 전체 store 구독으로 인한 React 재렌더링이 paint 블록의 주범.

1. **OrchestratorPanel granular Zustand selectors**: `const { ... } = useOrchestratorStore()` (전체 구독) → 슬라이스별 `useOrchestratorStore((s) => s.X)` 7개. 임의 store 변경 시마다 발생하던 재렌더링 차단.
2. **Main 프로세스 PTY 데이터 IPC 배치 (setImmediate)**: 기존 청크당 1회 `mainWindow.webContents.send` → 같은 Node.js tick 내 청크를 `pendingPtyData` Map에 모아 setImmediate 한 번에 합쳐 송신. Claude Code 출력 burst 시 IPC 이벤트 100+개/초 → 1-2개/tick으로 축소. renderer main thread 점유 감소 → keystroke paint 지연 완화.

**수정 파일:** `v3/src/components/orchestrator/OrchestratorPanel.tsx`, `v3/electron/main.ts`

### Orchestrator 터미널 타이핑 딜레이 추가 최적화 — IPC 단방향 + replay 즉시 라이브 + fit 디바운스 (2026-04-29)
WebGL + scrollToBottom 제거에 이어 잔여 레이턴시 제거.

1. **pty:write IPC 단방향화**: `ipcRenderer.invoke` → `ipcRenderer.send`, `ipcMain.handle` → `ipcMain.on`. 키 입력당 Promise round-trip(약 1-3ms) 제거. preload는 호환성 위해 `Promise.resolve()` 즉시 반환.
2. **pty:replay 1.5초 버퍼 윈도우 제거**: 기존 코드는 replay 후 1500ms 동안 신규 PTY 데이터를 buffer에만 쌓고 라이브 송신을 차단 → 패널 expand 직후 1.5초간 입력 echo가 보이지 않음. 이제 replay 호출 즉시 `ptyBuffers.delete()`로 라이브 모드 전환. `replayTimers` Map 삭제. StrictMode 보호는 renderer의 `disposed` 플래그로 충분.
3. **panelHeight fit() 디바운스 (50ms)**: 패널 높이 드래그 중 매 프레임마다 `fitAddon.fit()`이 호출되어 PTY를 재리사이즈하던 문제 해결. setTimeout 50ms 디바운스로 드래그 종료 후 1회만 fit.

**수정 파일:** `v3/electron/preload.ts`, `v3/electron/main.ts`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`

### dev 모드 remote-debugging-port 동적 할당 (2026-04-29)
재시작 시 `bind() failed: Address already in use (48)` 에러 제거. 9222 하드코딩 → 0(OS 자동 할당)으로 변경. 이전 Electron 프로세스가 macOS TIME_WAIT로 포트를 잡고 있어도 충돌 없음.

**수정 파일:** `v3/electron/main.ts`

### Orchestrator/Terminal 타이핑 딜레이 개선 — WebGL 렌더러 + scrollToBottom 제거 (2026-04-29)
xterm.js DOM 렌더러로 인한 타이핑 지연 해결. Claude Code 출력 burst 시에도 입력 echo가 즉각 표시되도록 개선.

1. **WebGL 렌더러 도입**: `@xterm/addon-webgl@^0.19.0` 추가, OrchestratorTerminal·TerminalView에서 `terminal.open()` 직후 loadAddon. WebGL 미지원 환경은 try/catch로 DOM fallback. `onContextLoss` 핸들러로 GPU context 손실 대비.
2. **핫패스 scrollToBottom 제거**: PTY 데이터 청크마다 호출하던 `scrollToBottom()` 삭제. xterm은 viewport가 bottom일 때 자동 스크롤하므로 명시 호출이 redundant + layout thrashing 유발했음.
3. **userScrolledUp 추적/onScroll 리스너 제거**: 자동 스크롤 동작과 중복되는 피드백 루프 제거.
4. 리사이즈/탭 활성화/패널 높이 변경 시의 scrollToBottom은 의도적 anti-jump 용도라 유지.

**수정 파일:** `v3/package.json`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### BigQuery 텔레메트리 ML 준비도 Phase 1 (2026-04-19)
ML 기반 자동화(모델 선택, 프로세스 최적화, 비용 예측, 이상 탐지)를 위한 데이터 파이프라인 기반 구축.

1. **BigQuery 스키마 확장**: events에 10개 ML 컬럼 추가, cost_logs에 4개 컬럼 추가, 신규 3개 테이블(agent_heartbeats, task_outcomes, flow_executions) 생성
2. **Cloud Functions 확장**: logTaskOutcome, logHeartbeat, logFlowExecution 3개 함수 추가 + 기존 함수에 신규 컬럼 처리 반영
3. **미연결 이벤트 브릿지**: Flow(started/nodeExecuted/completed), Session(started/ended), token:usage 텔레메트리 연결
4. **Task outcome 집계**: DONE 전환 시 task_outcomes 테이블에 자동 기록
5. **Agent heartbeat**: 30초 주기 heartbeat 전송 → agent_heartbeats 테이블 (hang/무한루프 감지용)

**신규 파일:** `.claude/progress.md`, `docs/bigquery-ml-readiness.md`
**수정 파일:** `v3/functions/src/index.ts`, `v3/src/services/telemetryService.ts`, `v3/src/hooks/useFlowExecution.ts`, `v3/src/App.tsx`, `v3/electron/telemetry.ts`, `v3/electron/main.ts`, `v3/electron/agent-manager.ts`, `v3/src/hooks/useCostWriter.ts`, `v3/src/services/taskService.ts`, `v3/src/vite-env.d.ts`

### BigQuery 텔레메트리 ML 준비도 감사 문서 (2026-04-19)
현재 파이프라인 분석, 4가지 ML 목표별 갭 분석, 스키마 확장안, 4단계 로드맵 문서 작성.

**신규 파일:** `docs/bigquery-ml-readiness.md`

## In Progress
- Phase 2: 데이터 축적 + 기초 분석 (BigQuery ML 대시보드, baseline 수립)

## Remaining / TODO
- Phase 3: ML 모델 학습 + 추론 (모델 추천기, 비용 예측기, 이상 탐지)
- Phase 4: 프로세스 자동화 통합 (추천→자동 배정, 피드백 루프)
- ~~Cloud Functions 배포~~ (2026-04-19 완료, 20개 함수 전체 배포 성공)

## Issues / Tech Debt
- `task_outcomes.taskType`이 아직 null로 기록됨 — 태스크 메타데이터에 taskType 필드 추가 필요
- `task_outcomes.model`이 null — 에이전트 컨텍스트에서 모델 정보를 task 완료 시점에 전달하는 로직 필요
- heartbeat의 `tokensAccumulated`/`costAccumulated`가 0으로 고정 — CostTracker의 누적값을 연동해야 정확한 값 전달 가능
