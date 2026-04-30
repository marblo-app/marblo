# Terminal Iframe Isolation — PRD

## Status
**Rejected — 2026-04-30**: 구현 후 측정 결과 효과 없음. iframe 안에 PerformanceObserver 설치해서 직접 측정한 한글 INP `p50=184-200ms, avg=142-171ms` — 부모 마운트 시절 (`p50=144-160ms`)과 거의 동일하거나 약간 더 안 좋음. 가설 (`getBoundingClientRect`가 iframe 격리될 거라는 기대) 기각: iframe element의 viewport 좌표 계산은 부모 layout에 의존하므로, iframe 안 element의 `getBoundingClientRect`도 부모 layout flush를 강제. 격리 효과 없음.

## 학습
- xterm.js + 우리 React/Tailwind 트리에서 한글 IME ~150ms 지연은 **현재 환경의 fundamental baseline**.
- iframe 격리, monkey-patch (idle-skip / throttle / no-flush rect override / event delegation bypass), CSS contain — 모두 효과 없음 또는 회귀.
- 이 PRD는 결과 기록 목적으로 보존. 향후 동일 문제 발생 시 같은 길 가지 않도록.

## (이하 원본 — 참고용)

## Status (Original)
Draft → in progress 2026-04-30

## Problem

OrchestratorTerminal과 TerminalView에서 **한글(IME) 입력 시 inputDelay 100-200ms**. 영어 입력은 정상.

원인 분석 (xterm 번들 코드 확인):
- `CompositionHelper.updateCompositionElements()`가 style 6개 write 직후 `getBoundingClientRect()` 호출 → **강제 layout flush**
- 우리 React + Tailwind DOM 트리는 무거워서 flush 1회당 30-50ms 소요 (Mac mini 기준)
- 한글 IME 1글자당 composition 이벤트 3-4회 + onRender 콜백 추가 호출 → 누적 100-200ms

VS Code/Cursor 터미널은 같은 xterm.js를 쓰지만 React-free한 가벼운 DOM 트리라 같은 flush가 빠르게 끝남.

이번 세션에서 시도한 monkey-patch 모두 효과 없거나 회귀 (`v3/.claude/progress.md` 참고). 코드 레벨 패치로는 더 못 줄임.

## Solution

xterm을 **iframe 안으로 격리**. iframe은 자체 document를 가지므로 layout 작업이 iframe 내부 DOM(xterm 트리만)에 한정. 부모 React 트리의 invalidation 영향 없음.

기대 효과: layout flush 비용 30-50ms → **1-2ms** (iframe 트리는 매우 작음).

## Scope

### 신규 파일
- `v3/src/components/terminal/TerminalIframe.tsx` — 공용 wrapper
  - iframe 마운트
  - xterm 초기화 (`documentOverride: iframe.contentDocument`)
  - xterm CSS를 iframe head에 inject
  - PTY IPC 연결 (부모 window의 `electronAPI` 사용)

### 수정 파일
- `v3/src/components/orchestrator/OrchestratorTerminal.tsx` → TerminalIframe 사용 (props 그대로)
- `v3/src/components/terminal/TerminalView.tsx` → TerminalIframe 사용 (props 그대로)

### 영향 없음
- `electron/main.ts` (PTY/IPC)
- `electron/preload.ts` (electronAPI)
- 다른 컴포넌트 (TerminalPanel 등)
- props 인터페이스 (sessionId, panelHeight, isActive 그대로)

## 구현 노트

### iframe 셋업
```tsx
const iframe = document.createElement('iframe');
iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
// iframe.src 안 지정 → about:blank, 즉시 contentDocument 사용 가능
```

### xterm CSS 주입
Vite의 `?inline` suffix로 CSS를 string으로 import:
```ts
import xtermCss from '@xterm/xterm/css/xterm.css?inline';
// ...
const styleEl = doc.createElement('style');
styleEl.textContent = xtermCss;
doc.head.appendChild(styleEl);
```

### xterm 초기화
xterm 5.x는 `documentOverride` 옵션을 지원 (번들 코드에서 확인됨):
```ts
const terminal = new Terminal({
  documentOverride: iframe.contentDocument,
  cursorBlink: false,
  fontSize: 13,
  // ...
});
terminal.open(containerInIframe);
```

### Resize 처리
- 부모 컨테이너 ResizeObserver → fitAddon.fit() (50ms 디바운스 유지)
- `panelHeight`/`isActive` 변경 시 동일

### Focus 처리
- 사용자가 iframe 영역 클릭 시 자동 focus (iframe 내부 textarea로 들어감)
- `isActive`(TerminalView) 변경 시 iframe.contentWindow.focus() + textarea focus

### PTY IPC
- 부모 window의 `electronAPI`를 그대로 사용
- iframe에서 부모로 메시지 보낼 필요 없음 — 부모 React 컴포넌트가 IPC를 받아 iframe terminal에 write
- iframe의 xterm `onData` 콜백은 부모 클로저를 통해 `electronAPI.pty.write` 호출 (closure 정상 작동)

### 테마/배경색
- iframe body 배경을 xterm theme.background와 동일하게 set (이음새 없도록)
- 폰트는 macOS native (Menlo, Monaco)이라 iframe document에서도 자동 사용

## 위험 / Edge Cases

| 위험 | 완화 |
|---|---|
| `documentOverride`로 xterm 일부 기능 (e.g., addon WebGL) 작동 안할 수 있음 | WebGL은 이미 비활성화. FitAddon, WebLinksAddon만 사용 |
| iframe load 타이밍 (`about:blank` contentDocument 접근) | `iframe.contentDocument.readyState` 체크 + 'load' 이벤트 fallback |
| HMR 시 iframe 재생성 | useEffect cleanup에서 iframe 정상 dispose |
| StrictMode double-mount | 기존 `disposed` 플래그 패턴 그대로 |
| WebLinksAddon이 부모 window.open 호출 | iframe 안에서 호출되어도 동작 (Electron 환경) — 검증 필요 |

## 검증 기준

1. 콘솔에 `[TerminalIframe] xterm mounted in iframe` 로그
2. 한글 빠르게 10초 타이핑 → `[INP-5s]` p50 50ms 이하 (목표)
3. 영어 입력 영향 없음 ([INP-5s] 안 찍힘)
4. PTY 출력 정상 표시
5. orchestrator 시작/리사이즈/탭 전환 정상 동작
6. 한글 IME composition 시각 표시 정상 (커서 근처에 미리보기)

## Out of scope

- xterm 자체 fork/패치
- 네이티브 터미널 라이브러리 마이그레이션
- WebGL renderer 재활성화 (별도 검증 필요)
