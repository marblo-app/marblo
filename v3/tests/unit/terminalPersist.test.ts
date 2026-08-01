import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage 만 있으면 동작. jsdom 없이 stub.
const storage: Record<string, string> = {};
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
  },
});

const {
  readPersistedTerminals,
  addPersistedTerminal,
  removePersistedTerminal,
  resolveRestoreCwd,
} = await import("../../src/lib/terminalPersist");

const LEGACY_KEY = (p: string) => `marblo:v3:terminals:${p}`;

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
});

describe("terminalPersist", () => {
  it("readPersistedTerminals returns [] for empty project", () => {
    expect(readPersistedTerminals("p1")).toEqual([]);
  });

  it("add then read returns the entry", () => {
    addPersistedTerminal("p1", { name: "Terminal 1", cwd: "/tmp" });
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "Terminal 1", cwd: "/tmp" },
    ]);
  });

  it("add dedups by name (same name → no duplicate push)", () => {
    addPersistedTerminal("p1", { name: "Terminal 1", cwd: "/tmp" });
    addPersistedTerminal("p1", { name: "Terminal 1", cwd: "/different" });
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "Terminal 1", cwd: "/tmp" },
    ]);
  });

  it("remove by name takes the entry out", () => {
    addPersistedTerminal("p1", { name: "Terminal 1" });
    addPersistedTerminal("p1", { name: "Terminal 2" });
    removePersistedTerminal("p1", "Terminal 1");
    expect(readPersistedTerminals("p1")).toEqual([{ name: "Terminal 2" }]);
  });

  it("projects are isolated by projectId in the storage key", () => {
    addPersistedTerminal("p1", { name: "T1" });
    addPersistedTerminal("p2", { name: "T2" });
    expect(readPersistedTerminals("p1")).toEqual([{ name: "T1" }]);
    expect(readPersistedTerminals("p2")).toEqual([{ name: "T2" }]);
  });

  it("malformed JSON is treated as empty (graceful)", () => {
    storage[LEGACY_KEY("p1")] = "not json {{";
    expect(readPersistedTerminals("p1")).toEqual([]);
  });

  it("empty projectId is a no-op (no write, no error)", () => {
    addPersistedTerminal("", { name: "ghost" });
    expect(readPersistedTerminals("")).toEqual([]);
    expect(Object.keys(storage)).toEqual([]);
  });
});

// ── 티켓 D8yiihCWgDMd3AU7xkEy — "터미널이 워크트리로만 열린다" ────────────────
// 진범: 사용자 터미널의 cwd 가 생성 시점 rootPath 로 영속화되고, name 기준
// dedup 때문에 그 최초 값이 영구히 이겼다. 워크트리를 한 번 본 뒤 터미널을
// 열면 이후 모든 재시작이 그 워크트리에서 뜬다.
describe("terminalPersist — 레거시 cwd 핀 마이그레이션", () => {
  it("v1 에 박힌 워크트리 cwd 는 읽을 때 벗겨진다 (탭은 유지)", () => {
    storage[LEGACY_KEY("p1")] = JSON.stringify([
      { name: "Terminal 1", cwd: "/Users/me/.marblo/worktrees/proj/task-abc" },
      { name: "Terminal 2", cwd: "/Users/me/repo" },
    ]);
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "Terminal 1" },
      { name: "Terminal 2" },
    ]);
  });

  it("마이그레이션은 name/command/args 를 보존한다", () => {
    storage[LEGACY_KEY("p1")] = JSON.stringify([
      { name: "logs", cwd: "/old/pin", command: "tail", args: ["-f", "x.log"] },
    ]);
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "logs", command: "tail", args: ["-f", "x.log"] },
    ]);
  });

  it("마이그레이션 후 v1 키를 다시 읽지 않는다 (멱등)", () => {
    storage[LEGACY_KEY("p1")] = JSON.stringify([
      { name: "Terminal 1", cwd: "/old/pin" },
    ]);
    readPersistedTerminals("p1"); // 1회차: 마이그레이션
    // v1 을 되살려도 v2 가 이미 있으므로 무시돼야 한다.
    storage[LEGACY_KEY("p1")] = JSON.stringify([
      { name: "Zombie", cwd: "/old/pin" },
    ]);
    expect(readPersistedTerminals("p1")).toEqual([{ name: "Terminal 1" }]);
  });

  it("명시적으로 준 cwd 는 v2 에서 그대로 핀으로 남는다", () => {
    addPersistedTerminal("p1", { name: "pinned", cwd: "/explicit" });
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "pinned", cwd: "/explicit" },
    ]);
  });
});

describe("resolveRestoreCwd — 죽은 cwd 로는 스폰하지 않는다", () => {
  const exists = (ok: boolean) => async () => ok;

  it("cwd 가 없으면 undefined (복구 시점의 현재 rootPath 를 따른다)", async () => {
    await expect(
      resolveRestoreCwd(undefined, exists(true)),
    ).resolves.toBeUndefined();
  });

  it("살아있는 핀은 그대로 존중한다", async () => {
    await expect(resolveRestoreCwd("/live", exists(true))).resolves.toBe(
      "/live",
    );
  });

  it("reap 된 워크트리 핀은 버린다 — 이게 rootPath 탈취 캐스케이드를 끊는다", async () => {
    await expect(
      resolveRestoreCwd("/dead/wt", exists(false)),
    ).resolves.toBeUndefined();
  });

  it("존재 확인 자체가 실패하면 핀을 버린다 (fail-safe)", async () => {
    const boom = async () => {
      throw new Error("ipc down");
    };
    await expect(resolveRestoreCwd("/whatever", boom)).resolves.toBeUndefined();
  });
});
