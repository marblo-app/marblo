/**
 * @vitest-environment jsdom
 *
 * ★`orchestrator:statusChanged` 에 **보드 렌더러 구독자가 있다**.
 *
 * 이 한 줄이 F-4 의 본체다. 실측 당시 그 채널의 구독자는 0 이었다 — main 은
 * 성실히 상태를 쏘고 있었는데 듣는 쪽이 없었다. 그래서 여기서 보는 것은 "핸들러가
 * 잘 도나" 가 아니라 **"애초에 구독을 하나"** 이고, 구독이 사라지면 이 파일이
 * 깨진다.
 *
 * 구독 지점은 `useOrchestratorAutoLaunch` 다 — 마블로 셸(Layout)과 비기너 셸
 * (useAppLifecycle)의 공통 조상이라 한 곳으로 두 모드가 덮인다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { useOrchestratorStatusSync } from "../../src/hooks/useOrchestratorStatusSync";
import { useOrchestratorStore } from "../../src/stores/orchestratorStore";

let listeners: Array<(data: unknown) => void>;
let disposed: number;

beforeEach(() => {
  listeners = [];
  disposed = 0;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    orchestratorSession: {
      onStatusChange: (cb: (data: unknown) => void) => {
        listeners.push(cb);
        return () => {
          disposed += 1;
          listeners = listeners.filter((l) => l !== cb);
        };
      },
    },
  };
  useOrchestratorStore.setState({ status: "running", halt: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("보드 렌더러가 statusChanged 를 구독한다", () => {
  it("★구독자가 0 이 아니다", () => {
    renderHook(() => useOrchestratorStatusSync());
    expect(listeners).toHaveLength(1);
  });

  it("언마운트하면 자기 리스너만 뗀다", () => {
    const { unmount } = renderHook(() => useOrchestratorStatusSync());
    unmount();
    expect(disposed).toBe(1);
    expect(listeners).toHaveLength(0);
  });

  it("★사유가 실린 error 를 받으면 상태와 사유가 같이 선다", () => {
    renderHook(() => useOrchestratorStatusSync());
    act(() => {
      listeners[0]({ status: "error", reason: "needsAuth", model: "codex" });
    });
    const s = useOrchestratorStore.getState();
    expect(s.status).toBe("error");
    expect(s.halt).toEqual({ kind: "needsAuth", model: "codex" });
  });

  it("자동 재시작이 성공하면 사유가 걷힌다 — 살아난 오케에 빨간 배너를 남기지 않는다", () => {
    renderHook(() => useOrchestratorStatusSync());
    act(() => {
      listeners[0]({ status: "error", reason: "crashLoop" });
    });
    expect(useOrchestratorStore.getState().halt).not.toBeNull();
    act(() => {
      listeners[0]({ status: "running" });
    });
    const s = useOrchestratorStore.getState();
    expect(s.status).toBe("running");
    expect(s.halt).toBeNull();
  });

  it("모르는 상태값은 무시한다 — 회색 점 + 빈 라벨을 만들지 않는다", () => {
    renderHook(() => useOrchestratorStatusSync());
    act(() => {
      listeners[0]({ status: "banana" });
    });
    expect(useOrchestratorStore.getState().status).toBe("running");
  });
});

describe("★구독 지점이 두 셸의 공통 조상에 있다", () => {
  // 훅이 잘 도는 것과, 그 훅이 실제로 **불리는** 것은 다른 사실이다. 구독 호출을
  // 지워도 위 테스트는 전부 통과한다 — 그래서 배선 자체를 여기서 못박는다.
  const root = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("useOrchestratorAutoLaunch 가 구독을 건다", () => {
    expect(read("src/hooks/useOrchestratorAutoLaunch.ts")).toContain(
      "useOrchestratorStatusSync()",
    );
  });

  it("마블로 셸과 비기너 셸이 둘 다 그 훅을 탄다", () => {
    // F-5: 비기너는 별도 런치 경로가 없다. 그 사실이 이 배선의 전제이므로,
    // 전제가 깨지면(비기너가 자기 경로를 갖게 되면) 여기서 알게 된다.
    expect(read("src/components/Layout.tsx")).toContain(
      "useOrchestratorAutoLaunch()",
    );
    expect(read("src/hooks/useAppLifecycle.ts")).toContain(
      "useOrchestratorAutoLaunch()",
    );
  });
});
