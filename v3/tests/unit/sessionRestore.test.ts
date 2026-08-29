import { describe, it, expect } from "vitest";
import { resolveRestoreSource } from "../../src/lib/sessionRestore";

describe("resolveRestoreSource", () => {
  it("per-window state wins for a primary window (reconnect after wake)", () => {
    const out = resolveRestoreSource({
      perWindow: { rootPath: "/a", projectId: "pA" },
      isNewWindow: false,
      global: { lastRootPath: "/b", lastProjectId: "pB" },
    });
    expect(out).toEqual({ rootPath: "/a", projectId: "pA" });
  });

  it("per-window state wins for a NEW window too — wake reload must reconnect", () => {
    const out = resolveRestoreSource({
      perWindow: { rootPath: "/work/repo", projectId: "p1" },
      isNewWindow: true,
      global: {},
    });
    expect(out).toEqual({ rootPath: "/work/repo", projectId: "p1" });
  });

  it("fresh new window with no saved state → folder picker (no restore)", () => {
    const out = resolveRestoreSource({
      perWindow: {},
      isNewWindow: true,
      global: { lastRootPath: "/b", lastProjectId: "pB" },
    });
    expect(out).toEqual({});
  });

  it("primary window cold start falls back to global app-state", () => {
    const out = resolveRestoreSource({
      perWindow: {},
      isNewWindow: false,
      global: { lastRootPath: "/b", lastProjectId: "pB" },
    });
    expect(out).toEqual({ rootPath: "/b", projectId: "pB" });
  });

  it("primary window with no per-window and no global → nothing to restore", () => {
    const out = resolveRestoreSource({
      perWindow: {},
      isNewWindow: false,
      global: {},
    });
    expect(out).toEqual({});
  });

  it("per-window projectId hint overrides global when only global has a path", () => {
    // rootPath only in global, but window already knows its project id.
    const out = resolveRestoreSource({
      perWindow: { projectId: "pWin" },
      isNewWindow: false,
      global: { lastRootPath: "/b", lastProjectId: "pGlobal" },
    });
    expect(out).toEqual({ rootPath: "/b", projectId: "pWin" });
  });

  it("per-window rootPath without projectId is fine (resolved by folder later)", () => {
    const out = resolveRestoreSource({
      perWindow: { rootPath: "/only/path" },
      isNewWindow: false,
      global: { lastProjectId: "pB" },
    });
    expect(out).toEqual({ rootPath: "/only/path", projectId: undefined });
  });

  it("ignores a per-window restore record owned by another uid", () => {
    const out = resolveRestoreSource({
      perWindow: { uid: "A", rootPath: "/a", projectId: "pA" },
      isNewWindow: false,
      global: { uid: "B", lastRootPath: "/b", lastProjectId: "pB" },
      currentUid: "B",
    });
    expect(out).toEqual({ rootPath: "/b", projectId: "pB" });
  });

  it("does not fall back to another uid's global restore slot", () => {
    const out = resolveRestoreSource({
      perWindow: {},
      isNewWindow: false,
      global: { uid: "A", lastRootPath: "/a", lastProjectId: "pA" },
      currentUid: "B",
    });
    expect(out).toEqual({});
  });
});
