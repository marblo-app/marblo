/**
 * ★폐루프 전진 플래그의 **전달 경로** (티켓 zyHtb4bjBSUWpzQ46avD).
 *
 * `isAdvanceSignalEnabled` 의 판정 자체는 `mission-advance-guards.test.ts` 가
 * 이미 전수 고정했다. 여기서 고정하는 것은 그 판정이 **읽을 값이 애초에 그
 * 프로세스에 도달하는가** 다 — 실측(2026-09-05)으로 도달하지 않고 있었고, 그게
 * #1414(폐루프)와 #1416(미션층)이 동시에 안 켜지던 이유다.
 *
 * 두 축을 나눠 본다:
 *   (A) 전달 — getMCPServerEnv 가 MISSION_ADVANCE_SIGNAL 을 **원문 그대로** 싣는다
 *   (B) 가시성 — 부팅 한 줄이 이 프로세스가 받은 값으로 ON/OFF 를 말한다
 *
 * ★(A) 는 뮤테이션으로 검증됐다: agent-config.ts 의 전달 한 줄을 지우면 아래
 * "★on 이 결과 env 에 그대로 실려 나온다" 가 실제로 빨개진다(PR 본문에 출력 첨부).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  AgentConfigGenerator,
  getMCPServerEnv,
} from "../../electron/agent-config";
import {
  ADVANCE_SIGNAL_ENV,
  formatAdvanceSignalBootLine,
  isAdvanceSignalEnabled,
} from "../../electron/mcp-server/advance-guards";
import { useVerifiedClaudeCli } from "../fixtures/verified-claude-cli";

useVerifiedClaudeCli();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-advance-env-"));

beforeEach(() => {
  // 머신에 남아 있는 값이 판정에 새어 들어오지 못하게 매 케이스가 명시한다.
  vi.stubEnv(ADVANCE_SIGNAL_ENV, undefined as unknown as string);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mcpEnv(): Record<string, string> {
  return getMCPServerEnv(TMP, "test-project", "ag-advance-env");
}

// ─────────────────────────────────────────────────────────────────────────
// (A) 전달 — allowlist 를 통과하는가
// ─────────────────────────────────────────────────────────────────────────

describe("★MCP env 조립 — MISSION_ADVANCE_SIGNAL 전달", () => {
  it("★on 이 결과 env 에 그대로 실려 나온다", () => {
    vi.stubEnv(ADVANCE_SIGNAL_ENV, "on");
    const env = mcpEnv();
    expect(env[ADVANCE_SIGNAL_ENV]).toBe("on");
    // 실제로 켜지는가 — MCP 서버가 이 env 를 process.env 로 받는다.
    expect(isAdvanceSignalEnabled(env)).toBe(true);
  });

  it("미설정이면 키 자체가 안 들어간다 — 기본값을 여기서 채우지 않는다", () => {
    const env = mcpEnv();
    expect(ADVANCE_SIGNAL_ENV in env).toBe(false);
    expect(isAdvanceSignalEnabled(env)).toBe(false);
  });

  it("★값을 가공하지 않는다 — 원문 그대로 싣고 판정은 MCP 쪽 한 곳에서만 한다", () => {
    // 트림·소문자화를 전달 경로가 미리 해버리면 판정이 두 곳으로 쪼개진다.
    for (const raw of [" ON ", "true", "1", "off", "", "on\n"]) {
      vi.stubEnv(ADVANCE_SIGNAL_ENV, raw);
      expect(mcpEnv()[ADVANCE_SIGNAL_ENV], JSON.stringify(raw)).toBe(raw);
    }
  });

  it("전달된 원문에 대한 최종 판정은 여전히 '정확히 on' 이다", () => {
    const verdict = (raw: string): boolean => {
      vi.stubEnv(ADVANCE_SIGNAL_ENV, raw);
      return isAdvanceSignalEnabled(mcpEnv());
    };
    expect(verdict("on")).toBe(true);
    expect(verdict(" ON ")).toBe(true);
    for (const raw of ["", " ", "true", "1", "yes", "onn", "off"]) {
      expect(verdict(raw), JSON.stringify(raw)).toBe(false);
    }
  });

  it("allowlist 는 여전히 닫혀 있다 — 옆 키가 딸려 나오지 않는다", () => {
    // process.env 를 통째로 넘기는 변경이 아니라는 것의 증거.
    vi.stubEnv(ADVANCE_SIGNAL_ENV, "on");
    vi.stubEnv("MISSION_ADVANCE_SIGNAL_EXTRA", "leak");
    vi.stubEnv("SOME_UNRELATED_SECRET", "leak");
    const env = mcpEnv();
    expect(env[ADVANCE_SIGNAL_ENV]).toBe("on");
    expect(env.MISSION_ADVANCE_SIGNAL_EXTRA).toBeUndefined();
    expect(env.SOME_UNRELATED_SECRET).toBeUndefined();
  });

  it("스폰 경로(getLaunchConfig)의 env 에도 같은 값이 실린다", () => {
    vi.stubEnv(ADVANCE_SIGNAL_ENV, "on");
    const launch = new AgentConfigGenerator().getLaunchConfig(
      { id: "ag-advance-env", model: "claude", role: "backend", command: "" },
      TMP,
    );
    expect(launch.env[ADVANCE_SIGNAL_ENV]).toBe("on");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (B) 가시성 — 켜졌는지 확인할 수단
// ─────────────────────────────────────────────────────────────────────────

describe("부팅 한 줄 — 켜졌는지 사람이 확인할 수 있다", () => {
  it("on 이면 ON 이라고 말한다", () => {
    const line = formatAdvanceSignalBootLine({ [ADVANCE_SIGNAL_ENV]: "on" });
    expect(line).toContain(ADVANCE_SIGNAL_ENV);
    expect(line).toContain("ON");
    expect(line).not.toContain("OFF");
  });

  it("미설정이면 OFF 라고 말하고 켜는 법을 함께 적는다", () => {
    const line = formatAdvanceSignalBootLine({});
    expect(line).toContain("(미설정)");
    expect(line).toContain("OFF");
    expect(line).toContain('"on"');
  });

  it("★오타는 원문을 그대로 보여준다 — 설정했는데 왜 꺼졌나의 유일한 답", () => {
    const line = formatAdvanceSignalBootLine({ [ADVANCE_SIGNAL_ENV]: "true" });
    expect(line).toContain('"true"');
    expect(line).toContain("OFF");
  });

  it("한 줄이다 — 배너 옆에 줄바꿈 없이 붙는다", () => {
    for (const env of [
      {},
      { [ADVANCE_SIGNAL_ENV]: "on" },
      { [ADVANCE_SIGNAL_ENV]: " ON " },
      { [ADVANCE_SIGNAL_ENV]: "1" },
    ]) {
      expect(formatAdvanceSignalBootLine(env)).not.toContain("\n");
    }
  });

  it("판정을 다시 하지 않는다 — isAdvanceSignalEnabled 와 항상 같은 편에 선다", () => {
    for (const raw of ["on", " ON ", "true", "1", "", "off", "onn"]) {
      const env = { [ADVANCE_SIGNAL_ENV]: raw };
      const enabled = isAdvanceSignalEnabled(env);
      const line = formatAdvanceSignalBootLine(env);
      expect(line.includes("→ ON"), JSON.stringify(raw)).toBe(enabled);
      expect(line.includes("→ OFF"), JSON.stringify(raw)).toBe(!enabled);
    }
  });
});
