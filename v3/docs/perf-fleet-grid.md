# Fleet 그리드 — 성능 베이스라인

## 목표

Agents 탭의 새 그리드 뷰가 다중 에이전트 시나리오(10/30/50 셀)에서 다음을
유지해야 한다.

| 시나리오    | fps (그리드 페인트)    | 메모리 스파이크 |
| ----------- | ---------------------- | --------------- |
| 10 에이전트 | 60fps 유지             | < 20 MB         |
| 30 에이전트 | 60fps 유지 (≥ 50 보장) | < 35 MB         |
| 50 에이전트 | ≥ 30fps                | < 50 MB         |

세 임계치 중 하나라도 미달이면 해당 시나리오에 대해 병목/대응안을 기록한다.

## 측정 방법

### 1. 더미 PTY 스트림 발생기 (수동 측정용)

Marblo 앱 dev 모드에서 DevTools Console 에 아래 스니펫을 붙여 N개의 더미
세션에 라이브 출력을 흘린다. 본 코드는 운영 코드에 포함되지 않는다.

```js
// devtools snippet — fleet grid stress test
(() => {
  const { usePtyMirrorStore } = await import('/src/stores/ptyMirrorStore.ts');
  const { useAgentSessionMap } = await import('/src/stores/agentSessionMap.ts');
  const N = 50; // 변경: 10 / 30 / 50
  const ANSI = '\x1b[32m';
  const RESET = '\x1b[0m';
  const ids = Array.from({ length: N }, (_, i) => `bench-${i}`);
  ids.forEach((id, i) => {
    useAgentSessionMap.getState().set(`fake-agent-${i}`, id);
    usePtyMirrorStore.getState().attach(id);
  });
  const tick = () => {
    const i = Math.floor(Math.random() * N);
    const id = ids[i];
    usePtyMirrorStore.getState().ingest(id, `${ANSI}log ${Date.now()} from ${id}${RESET}\n`);
  };
  const handle = setInterval(tick, 16); // ~60 ticks/s
  console.log(`Stress: ${N} sessions, ~60 Hz. clearInterval(${handle}) to stop.`);
  window.__fleetBenchStop = () => clearInterval(handle);
})();
```

Chrome DevTools → **Performance** 탭에서 5초 캡처 후:

- **Frames** 트랙의 평균 fps 확인 (60 / 50 / 30 임계치 비교)
- **Memory** 트랙의 JS heap delta 확인 (스파이크 < 50MB)
- **Main** 트랙에서 `react render` 노드의 self time 분포 확인 (셀 단위 셀렉터
  분리가 제대로 동작했다면 50셀 중 평균 1셀만 commit 됨)

### 2. ingest hot path 마이크로 벤치

PTY 스트림이 store 에 도착하는 hot path 만 단독 측정:

```bash
cd v3
npx vitest bench tests/unit/ptyMirrorStore.bench.ts
```

측정된 베이스라인 (Apple Silicon, Node 22, vitest 4.1):

| 시나리오                | hz    | mean    | p99     | per-line |
| ----------------------- | ----- | ------- | ------- | -------- |
| 1k 라인 / 단일 세션     | 2,651 | 0.38 ms | 0.45 ms | ~380 ns  |
| 10k 라인 / 50 세션 분산 | 79    | 12.6 ms | 12.9 ms | ~1.3 μs  |

해석: 50 세션이 동시에 10k 줄을 쏟아도 한 batch ingest 가 16ms 프레임 예산
안에 들어옴 (12.6ms). debounce flush 가 50ms 이므로 실제 commit 빈도는
20Hz — 페인트 예산은 더 여유 있음.

회귀 감지: 위 수치 대비 2× 이상 느려지면 PR 에 코멘트.

## 설계가 임계치를 노리는 이유

| 설계 결정                                 | 임계치 기여                              |
| ----------------------------------------- | ---------------------------------------- |
| `MiniTerminal` 셀별 selector              | 한 셀만 변경 시 다른 셀 commit 차단      |
| `React.memo` 모든 셀 컴포넌트             | props 동일 시 reconciliation 자체 건너뜀 |
| Ring buffer 8–12줄 (전체 보관 X)          | 메모리 셀당 < 5KB                        |
| `pre` + 텍스트만 (xterm 풀 인스턴스 X)    | 페인트 비용 90% 절감 (xterm WebGL 대비)  |
| 50ms debounce flush (`onData` 멀티캐스트) | 60Hz 스트림을 ~20Hz commit 으로 축소     |
| zustand selector 단위 구독                | useStore 전체 구독 회피                  |

## 측정 후 기록 양식

벤치 실행자가 아래 표를 채워서 PR description 또는 본 문서 끝에 추가한다.

```
| 시나리오 | 측정 fps | 메모리 Δ | 합격? | 코멘트 |
| -------- | -------- | -------- | ----- | ------ |
| 10 cells |          |          |       |        |
| 30 cells |          |          |       |        |
| 50 cells |          |          |       |        |
```

불합격 시:

1. Chrome Performance 캡처를 `docs/assets/fleet-bench-YYYYMMDD/` 에 저장
2. 본 문서 하단의 "기록" 섹션에 병목 노드(가장 무거운 task)와 대응안 추가
3. T10 티켓에 `update_task_status BLOCKED` 로 표시하고 후속 티켓 생성

## 기록

(첫 측정 후 채울 것)
