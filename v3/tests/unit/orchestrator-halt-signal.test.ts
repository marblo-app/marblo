/**
 * 오케가 멈출 때 **사유가 실제로 나가는가** — 진짜 `OrchestratorManager` 로.
 *
 * 위 `orchestrator-halt.test.ts` 는 렌더러 쪽 순수 규칙을 본다. 이 파일은 그
 * 반대편, 즉 "main 이 사유를 만들어 내보내는가" 를 본다. 둘을 다 봐야 하는 이유는
 * 이 버그가 정확히 **그 사이**에서 났기 때문이다 — 사유는 main 안에 있었고
 * (console.error), 표시할 수 있는 화면도 있었는데, 둘을 잇는 페이로드가 없었다.
 *
 * PTY 는 가짜다(실 CLI 를 띄우지 않는다). 대신 실측 프레임과 같은 모양의 폴더
 * 신뢰 다이얼로그를 그대로 흘려 넣는다 — 이 테스트가 재는 것은 CLI 의 행동이
 * 아니라 **우리 배선**이다(실 CLI 종단 검증은 tests/live 가 이미 했다).
 *
 * 여기서 못박는 것:
 *   ① 첫 실행 다이얼로그로 멈추면 `("error", { reason: "firstRunDialog" })` 가
 *      상태 콜백으로 나간다. 예전엔 `("error")` 뿐이었다.
 *   ② ★F-6 — 그 시점이 **스폰 기준 60s** 다. 예전엔 홀드 시작 기준이라
 *      blind fallback(claude 10s)만큼 늦어 실측이 70.1s 였다.
 *   ③ ★사유 페이로드에 PTY 원문이 없다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verdictFor } from "../../electron/composer-gate";
import fs from "fs";
import os from "os";
import path from "path";
import {
  OrchestratorManager,
  type OrchestratorStatusDetail,
} from "../../electron/orchestrator-manager";

/** 실측(claude 2.1.238)과 같은 모양의 폴더 신뢰 다이얼로그 한 화면. */
const TRUST_DIALOG = [
  "╭──────────────────────────────────────────╮",
  "│ Do you trust the files in this folder?   │",
  "│                                          │",
  "│ ❯ 1. Yes, I trust this folder            │",
  "│   2. No, exit                            │",
  "│                                          │",
  "│ Enter to confirm · Esc to exit           │",
  "╰──────────────────────────────────────────╯",
].join("\n");

interface Harness {
  statuses: Array<{ status: string; detail?: OrchestratorStatusDetail }>;
  writes: string[];
  emit: (chunk: string) => void;
  manager: OrchestratorManager;
  rootPath: string;
}

function makeHarness(spawnErrno?: string): Harness {
  const statuses: Harness["statuses"] = [];
  const writes: string[] = [];
  let onData: ((chunk: string) => void) | null = null;

  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "mb-halt-"));

  const ptyManager = {
    create: () => {
      if (spawnErrno) {
        throw Object.assign(new Error("synthetic spawn failure"), {
          code: spawnErrno,
        });
      }
    },
    hasSession: () => true,
    kill: () => undefined,
    onDanger: () => undefined,
    onData: (_id: string, cb: (chunk: string) => void) => {
      onData = cb;
    },
    onExit: () => undefined,
    setBlockDangerousForSession: () => undefined,
    write: (_id: string, data: string) => {
      writes.push(data);
    },
    writeAndSubmit: (_id: string, text: string) => {
      writes.push(text);
    },
    // 티켓 RtyOMpOArfI7a5JNSzsg — 부트 프롬프트도 컴포저 판정을 거친다. 이 스텁은
    // 화면을 그리지 않으니 실제와 같은 답을 준다: indeterminate = 종전대로 쓴다.
    composerVerdict: () => verdictFor("indeterminate"),
  };

  const configGenerator = {
    getLaunchConfig: () => ({
      model: "claude",
      command: "claude",
      args: [] as string[],
      env: {} as Record<string, string>,
      mcpConfigPath: path.join(rootPath, "mcp.json"),
    }),
    cleanup: () => undefined,
    hasSavedSession: () => false,
  };

  const manager = new OrchestratorManager(
    ptyManager as never,
    configGenerator as never,
    (status, detail) => statuses.push({ status, detail }),
    "board",
  );

  return {
    statuses,
    writes,
    emit: (chunk: string) => onData?.(chunk),
    manager,
    rootPath,
  };
}

describe("멈춤 사유가 상태 콜백에 실려 나간다", () => {
  let h: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    h = makeHarness();
  });

  afterEach(() => {
    try {
      h.manager.stop();
    } catch {
      /* ignore */
    }
    vi.useRealTimers();
    fs.rmSync(h.rootPath, { recursive: true, force: true });
  });

  it("★첫 실행 다이얼로그로 멈추면 사유가 함께 나간다 — 스폰 기준 60s", async () => {
    await h.manager.launch("p1", h.rootPath, 4242, undefined, "new");
    // 다이얼로그가 뜬 채로 계속 남아 있다. 아무도 답하지 않는 상태 —
    // 실측 F-1 이 재현한 바로 그 화면이다.
    h.emit(TRUST_DIALOG);

    // 59s: 아직 참고 기다린다. (blind fallback 10s 에 홀드가 걸리고, 그 뒤로도
    // 매 1s 재시도가 돈다 — 그 사이 어느 순간에도 error 가 나오면 안 된다.)
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.statuses.filter((s) => s.status === "error")).toHaveLength(0);

    // 60s 를 넘기면 사유와 함께 error.
    await vi.advanceTimersByTimeAsync(2_000);
    const errors = h.statuses.filter((s) => s.status === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].detail?.reason).toBe("firstRunDialog");
  });

  it("★사유 페이로드에 PTY 원문이 없다", async () => {
    await h.manager.launch("p2", h.rootPath, 4242, undefined, "new");
    h.emit(TRUST_DIALOG);
    await vi.advanceTimersByTimeAsync(61_000);

    const errors = h.statuses.filter((s) => s.status === "error");
    expect(errors.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(errors[0].detail ?? {});
    // 화면에 있던 문자열이 한 조각도 실려 나가지 않는다.
    for (const fragment of ["trust", "Yes, I", "Enter to confirm", "╭"]) {
      expect(serialized).not.toContain(fragment);
    }
    // 실리는 것은 분류값과 (있으면) CLI id 뿐이다.
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(
      ["model", "reason"].filter((k) =>
        Object.prototype.hasOwnProperty.call(JSON.parse(serialized), k),
      ),
    );
  });

  it("PTY 생성 EACCES는 화면용 errno 분류를 상태와 함께 보낸다", async () => {
    h = makeHarness("EACCES");
    expect(() => h.manager.launch("p-eacces", h.rootPath, 4242)).toThrow(
      "synthetic spawn failure",
    );
    expect(h.statuses.find((s) => s.status === "error")?.detail).toEqual({
      reason: "spawnFailed",
      spawnErrno: "EACCES",
      model: "claude",
    });
  });

  it("허용되지 않은 errno는 원문 없이 중립 spawnFailed로 접는다", async () => {
    h = makeHarness("EIO");
    expect(() => h.manager.launch("p-eio", h.rootPath, 4242)).toThrow(
      "synthetic spawn failure",
    );
    expect(h.statuses.find((s) => s.status === "error")?.detail).toEqual({
      reason: "spawnFailed",
      model: "claude",
    });
  });

  it("다이얼로그가 떠 있는 동안 우리는 아무것도 타이핑하지 않는다", async () => {
    // 사유를 띄우는 변경이 게이트를 건드리지 않았음을 같이 못박는다 —
    // 이 축이 무너지면 PR #1070 이 고친 사고가 되살아난다.
    await h.manager.launch("p3", h.rootPath, 4242, undefined, "new");
    h.emit(TRUST_DIALOG);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.writes).toHaveLength(0);
  });
});
