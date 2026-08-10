/**
 * 티켓 x4EGDVAWLuy2sdPb9fEK — 부트 프리픽스 다이어트 플래그 정책.
 *
 * 여기서 고정하는 것 두 가지:
 *   · 롤백이 진짜로 **바이트 동등**한가. `MARBLO_PREFIX_DIET=off` 이면 스폰
 *     argv/env 가 다이어트 이전과 같아야 한다 — "플래그가 있다"와 "플래그가
 *     되돌린다"는 다른 주장이다.
 *   · `--settings` 머지. 이 옵션은 단일 값이라 두 번 넘기면 마지막만 남는다.
 *     다이어트 키를 별도 `--settings` 로 붙이면 텔레그램 플러그인 차단
 *     (pyp7odpPQ6emCWLmUrBz)이 조용히 풀린다. 그 회귀를 여기서 잡는다.
 */
import { describe, it, expect } from "vitest";
import {
  isDietableWorkerRole,
  prefixDietEnabled,
  shouldDisableWorkerAutoMemory,
  shouldDisableWorkerSkills,
  toolSurfaceEnv,
  workerClaudeSettings,
} from "../../electron/prefix-diet";

const TELEGRAM_OFF = {
  enabledPlugins: { "telegram@claude-plugins-official": false },
};

describe("prefixDietEnabled", () => {
  it("기본 ON", () => {
    expect(prefixDietEnabled({})).toBe(true);
  });

  it("off/0/false/no 로 끈다", () => {
    for (const v of ["off", "0", "false", "no", "OFF"]) {
      expect(prefixDietEnabled({ MARBLO_PREFIX_DIET: v })).toBe(false);
    }
  });
});

describe("isDietableWorkerRole", () => {
  it("오케스트레이터급은 제외 (판단 근거를 깎지 않는다)", () => {
    expect(isDietableWorkerRole("orchestrator")).toBe(false);
    expect(isDietableWorkerRole("team_leader")).toBe(false);
  });

  it("역할 미상은 제외 (fail-open)", () => {
    expect(isDietableWorkerRole(undefined)).toBe(false);
    expect(isDietableWorkerRole("")).toBe(false);
  });

  it("워커 역할은 대상", () => {
    expect(isDietableWorkerRole("backend")).toBe(true);
    expect(isDietableWorkerRole("Frontend")).toBe(true);
  });
});

describe("A2 — auto-memory", () => {
  it("워커는 기본으로 auto-memory 를 끈다", () => {
    expect(shouldDisableWorkerAutoMemory("backend", {})).toBe(true);
  });

  it("오케스트레이터는 건드리지 않는다", () => {
    expect(shouldDisableWorkerAutoMemory("orchestrator", {})).toBe(false);
  });

  it("MARBLO_WORKER_AUTOMEMORY=on 으로 노브만 되돌린다", () => {
    expect(
      shouldDisableWorkerAutoMemory("backend", {
        MARBLO_WORKER_AUTOMEMORY: "on",
      }),
    ).toBe(false);
  });

  it("전면 롤백 플래그로도 꺼진다", () => {
    expect(
      shouldDisableWorkerAutoMemory("backend", { MARBLO_PREFIX_DIET: "off" }),
    ).toBe(false);
  });
});

describe("A3 — 스킬 목록 (기본 OFF: 조용한 능력 손실 위험)", () => {
  it("명시적으로 켜기 전에는 적용하지 않는다", () => {
    expect(shouldDisableWorkerSkills("backend", {})).toBe(false);
  });

  it("MARBLO_WORKER_SKILLS=off 로 opt-in", () => {
    expect(
      shouldDisableWorkerSkills("backend", { MARBLO_WORKER_SKILLS: "off" }),
    ).toBe(true);
  });

  it("opt-in 해도 오케스트레이터는 제외", () => {
    expect(
      shouldDisableWorkerSkills("orchestrator", {
        MARBLO_WORKER_SKILLS: "off",
      }),
    ).toBe(false);
  });

  it("전면 롤백이 opt-in 을 이긴다", () => {
    expect(
      shouldDisableWorkerSkills("backend", {
        MARBLO_WORKER_SKILLS: "off",
        MARBLO_PREFIX_DIET: "off",
      }),
    ).toBe(false);
  });
});

describe("A1 — MCP env", () => {
  it("워커 역할을 MCP 서버로 전달한다", () => {
    expect(toolSurfaceEnv("backend", {})).toEqual({
      MARBLO_AGENT_ROLE: "backend",
    });
  });

  it("역할이 없으면 아무 키도 넣지 않는다 (종전 env 와 동등)", () => {
    expect(toolSurfaceEnv(undefined, {})).toEqual({});
  });

  it("전면 롤백이면 MCP 에 full 을 강제한다", () => {
    expect(toolSurfaceEnv("backend", { MARBLO_PREFIX_DIET: "off" })).toEqual({
      MARBLO_TOOL_SURFACE: "full",
      MARBLO_AGENT_ROLE: "backend",
    });
  });

  it("명시 override 는 그대로 전달된다", () => {
    expect(toolSurfaceEnv("backend", { MARBLO_TOOL_SURFACE: "full" })).toEqual({
      MARBLO_TOOL_SURFACE: "full",
      MARBLO_AGENT_ROLE: "backend",
    });
  });
});

describe("workerClaudeSettings — --settings 는 반드시 한 객체로 머지된다", () => {
  it("다이어트 키를 얹어도 텔레그램 차단이 살아있다", () => {
    const merged = workerClaudeSettings(TELEGRAM_OFF, "backend", {});
    expect(merged).toEqual({
      enabledPlugins: { "telegram@claude-plugins-official": false },
      autoMemoryEnabled: false,
    });
  });

  it("적용 대상이 아니면 base 를 그대로(참조까지) 돌려준다", () => {
    expect(workerClaudeSettings(TELEGRAM_OFF, "orchestrator", {})).toBe(
      TELEGRAM_OFF,
    );
    expect(
      workerClaudeSettings(TELEGRAM_OFF, "backend", {
        MARBLO_PREFIX_DIET: "off",
      }),
    ).toBe(TELEGRAM_OFF);
  });
});
