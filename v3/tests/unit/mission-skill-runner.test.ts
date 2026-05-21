import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSkillRunner } from "../../electron/mission-engine/skill-runner-impl";

// scenario 8 의 보안 락다운 — subprocess 가 실제로 돌기 전에 거부되는지를 검증.
// shell metachars / non-allowlisted skill / 절대경로 아닌 cwd / 존재 안 하는 cwd
// 4 가지 모두 spawn 호출 전에 단락되어 success=false 를 빠르게 돌려준다.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-skill-runner-"));

describe("SkillRunner — input validation (scenario 8 보안)", () => {
  const runner = createSkillRunner({
    // 실제 claude 바이너리가 없어도 거부 단계에서 미리 끝나도록 — 절대 spawn 안 됨
    ccBinary: "/nonexistent/claude",
    projectRoot: tmpDir,
  });

  it("allowlist 외 skill 은 즉시 거부", async () => {
    const r = await runner.runSkill({
      missionId: "m1",
      skill: "/spawn-agent" as never,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/allowlist/);
  });

  it("shell 메타문자 포함 args 거부 (semicolon)", async () => {
    const r = await runner.runSkill({
      missionId: "m1",
      skill: "/review",
      args: "; rm -rf /",
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/metachar/);
  });

  it("shell 메타문자 거부 (backtick)", async () => {
    const r = await runner.runSkill({
      missionId: "m1",
      skill: "/qa",
      args: "`whoami`",
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/metachar/);
  });

  it("shell 메타문자 거부 (pipe / redirect)", async () => {
    for (const args of ["a | b", "a > b", "a < b", "a & b"]) {
      const r = await runner.runSkill({
        missionId: "m1",
        skill: "/review",
        args,
      });
      expect(r.success, `args=${args}`).toBe(false);
      expect(r.error, `args=${args}`).toMatch(/metachar/);
    }
  });

  it("절대 경로 아닌 projectRoot 거부", async () => {
    const r2 = createSkillRunner({
      ccBinary: "/nonexistent/claude",
      projectRoot: "./relative",
    });
    const out = await r2.runSkill({
      missionId: "m1",
      skill: "/review",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/absolute/);
  });

  it("존재 안 하는 cwd 거부", async () => {
    const r2 = createSkillRunner({
      ccBinary: "/nonexistent/claude",
      projectRoot: "/nonexistent/marblo-skill-runner-test-dir-xyz",
    });
    const out = await r2.runSkill({
      missionId: "m1",
      skill: "/review",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/does not exist|not a directory/);
  });

  it("정상 args (영숫자/공백) 는 validation 통과 (spawn 단계에서만 실패)", async () => {
    // ccBinary 가 존재하지 않으므로 spawn error 가 났을 것 — validation 은 통과한
    // 시그널: error 가 metachar / allowlist / cwd 류가 아니어야 한다.
    const r = await runner.runSkill({
      missionId: "m1",
      skill: "/review",
      args: "main.ts components/",
    });
    expect(r.success).toBe(false);
    expect(r.error).not.toMatch(/metachar|allowlist|absolute|does not exist/);
  }, 15000);
});
