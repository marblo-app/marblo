import { bench, describe } from "vitest";

// Vitest 가 bench 를 지원 — 본 파일은 ptyMirrorStore 의 ingest 비용을
// node 환경에서 단독으로 측정한다. 실제 그리드 페인트 비용은 측정 못하지만
// 핵심 hot path (라인 분할 + ring buffer eviction) 의 헤드룸을 본다.

import { usePtyMirrorStore } from "../../src/stores/ptyMirrorStore";

const ANSI = "\x1b[31m";
const RESET = "\x1b[0m";
function line(i: number): string {
  return `${ANSI}[agent-${i % 50}] log line ${i} with some content${RESET}\n`;
}

describe("ptyMirrorStore.ingest throughput", () => {
  bench("ingest 1k lines into a single session", () => {
    usePtyMirrorStore.setState({ buffers: {}, attached: {} });
    const store = usePtyMirrorStore.getState();
    for (let i = 0; i < 1000; i++) {
      store.ingest("session-A", line(i));
    }
  });

  bench("ingest 10k lines spread across 50 sessions", () => {
    usePtyMirrorStore.setState({ buffers: {}, attached: {} });
    const store = usePtyMirrorStore.getState();
    for (let i = 0; i < 10000; i++) {
      store.ingest(`session-${i % 50}`, line(i));
    }
  });
});
