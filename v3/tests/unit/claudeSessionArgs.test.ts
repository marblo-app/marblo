import { describe, it, expect } from "vitest";
import { claudeSessionArgs } from "../../electron/agent-config";

const NEW = "11111111-2222-3333-4444-555555555555";

describe("claudeSessionArgs", () => {
  describe("pinFreshSession = true (agent path — deterministic attribution)", () => {
    it("fresh launch (undefined): pins a new session via --session-id and returns it", () => {
      const { args, sessionId } = claudeSessionArgs(undefined, NEW, true);
      expect(args).toEqual(["--session-id", NEW]);
      expect(sessionId).toBe(NEW);
    });

    it("'new' sentinel: same as undefined — force-fresh pinned session", () => {
      const { args, sessionId } = claudeSessionArgs("new", NEW, true);
      expect(args).toEqual(["--session-id", NEW]);
      expect(sessionId).toBe(NEW);
    });
  });

  describe("pinFreshSession = false (orchestrator/legacy — preserve old behavior)", () => {
    it("fresh launch (undefined): emits NO session flag and leaves id unpinned", () => {
      const { args, sessionId } = claudeSessionArgs(undefined, NEW, false);
      expect(args).toEqual([]);
      expect(sessionId).toBeUndefined();
    });

    it("'new' sentinel: emits NO session flag", () => {
      const { args, sessionId } = claudeSessionArgs("new", NEW, false);
      expect(args).toEqual([]);
      expect(sessionId).toBeUndefined();
    });
  });

  describe("resume — independent of pinFreshSession", () => {
    it("concrete UUID: emits --resume and the known id is that UUID (no --session-id)", () => {
      const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      for (const pin of [true, false]) {
        const { args, sessionId } = claudeSessionArgs(uuid, NEW, pin);
        expect(args).toEqual(["--resume", uuid]);
        expect(sessionId).toBe(uuid);
        expect(args).not.toContain("--session-id");
      }
    });

    it("'latest' (unresolved): emits no session flag, id unpinned for fallback detection", () => {
      for (const pin of [true, false]) {
        const { args, sessionId } = claudeSessionArgs("latest", NEW, pin);
        expect(args).toEqual([]);
        expect(sessionId).toBeUndefined();
      }
    });
  });

  it("never emits both --resume and --session-id", () => {
    for (const resume of [undefined, "new", "latest", "concrete-uuid"]) {
      for (const pin of [true, false]) {
        const { args } = claudeSessionArgs(resume, NEW, pin);
        expect(args.includes("--resume") && args.includes("--session-id")).toBe(
          false,
        );
      }
    }
  });
});
