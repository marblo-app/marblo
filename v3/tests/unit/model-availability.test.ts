/**
 * 사용가능성 필터(`electron/model-availability.ts`) — 인증 안 된 하네스를
 * **선택 단계에서** 뺀다.
 *
 * 핵심 계약 네 가지:
 *   1. 게이트가 있는 하네스(claude/codex/grok)만 판정한다.
 *   2. 후보를 0 으로 만들지 않는다(전부 미인증 → 필터 미적용 + 사유 보고).
 *   3. 프로브는 캐시된다(dispatch 는 사람이 기다리는 경로).
 *   4. 프로브 실패는 "미인증" 이 아니라 "모름" 이다 → 통과.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  filterAvailableHarnesses,
  harnessAvailability,
  clearAvailabilityCache,
  type AuthProbe,
} from "../../electron/model-availability";

const ok = { installed: true, authenticated: true };
const notAuthed = {
  installed: true,
  authenticated: false,
  action: "grok login",
};
const notInstalled = {
  installed: false,
  authenticated: false,
  action: "npm install -g @openai/codex",
};

/** claude=OK, codex=OK, grok=인증깨짐 — 라이브에서 실제로 나온 모양. */
const probe: AuthProbe = async (model) =>
  model === "grok" ? notAuthed : { ...ok };

beforeEach(() => {
  clearAvailabilityCache();
});

describe("★미인증 하네스 제외", () => {
  it("인증이 깨진 하네스가 후보에서 빠지고 사유가 남는다", async () => {
    const r = await filterAvailableHarnesses(["claude", "gpt", "grok"], {
      probe,
    });
    expect(r.applied).toBe(true);
    expect(r.available).toEqual(["claude", "gpt"]);
    expect(r.excluded).toEqual([
      { harness: "grok", reason: "미인증", action: "grok login" },
    ]);
    expect(r.note).toContain("grok 제외(미인증)");
  });

  it("미설치도 같은 경로로 빠진다(사유만 다르다)", async () => {
    const r = await filterAvailableHarnesses(["claude", "gpt"], {
      probe: async (m) => (m === "codex" ? { ...notInstalled } : { ...ok }),
    });
    expect(r.available).toEqual(["claude"]);
    expect(r.excluded[0].reason).toBe("미설치");
    expect(r.excluded[0].action).toContain("npm install");
  });

  it("게이트가 없는 하네스는 건드리지 않는다(무회귀)", async () => {
    const calls: string[] = [];
    const r = await filterAvailableHarnesses(["antigravity", "gemini"], {
      probe: async (m) => {
        calls.push(m);
        return { ...ok };
      },
    });
    expect(r.applied).toBe(false);
    expect(r.available).toEqual(["antigravity", "gemini"]);
    expect(calls).toEqual([]); // 프로브 자체를 부르지 않는다
  });
});

describe("★후보를 0 으로 만들지 않는다", () => {
  it("전부 미인증이면 필터를 적용하지 않고 사유만 남긴다", async () => {
    const r = await filterAvailableHarnesses(["claude", "gpt"], {
      probe: async () => ({ ...notAuthed }),
    });
    expect(r.applied).toBe(false);
    expect(r.available).toEqual(["claude", "gpt"]); // 스폰을 막지 않는다
    expect(r.excluded).toHaveLength(2);
    expect(r.note).toContain("필터 미적용");
  });

  it("모두 인증됐으면 note 가 비어 있다(로그 소음 0)", async () => {
    const r = await filterAvailableHarnesses(["claude", "gpt"], {
      probe: async () => ({ ...ok }),
    });
    expect(r.applied).toBe(false);
    expect(r.note).toBe("");
    expect(r.excluded).toEqual([]);
  });
});

describe("★프로브 캐시", () => {
  it("TTL 안에서는 한 번만 프로브한다", async () => {
    const spy = vi.fn(async () => ({ ...ok }));
    for (let i = 0; i < 5; i++) {
      await harnessAvailability("claude", { probe: spy, nowMs: 1_000 });
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("TTL 이 지나면 다시 본다(로그인/로그아웃이 반영된다)", async () => {
    const spy = vi.fn(async () => ({ ...ok }));
    await harnessAvailability("claude", { probe: spy, nowMs: 0, ttlMs: 100 });
    await harnessAvailability("claude", { probe: spy, nowMs: 500, ttlMs: 100 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("★프로브 실패 = 모름 = 통과", () => {
  it("프로브가 던져도 후보가 빠지지 않는다", async () => {
    const r = await filterAvailableHarnesses(["claude", "gpt"], {
      probe: async () => {
        throw new Error("keychain unavailable");
      },
    });
    expect(r.applied).toBe(false);
    expect(r.available).toEqual(["claude", "gpt"]);
    expect(r.excluded).toEqual([]);
  });
});
