import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { isAllowedSkill } from "./types";
import type { SkillRunner, SkillResult } from "./ports";

// Mission engine 의 gstack step 어댑터.
// mcp-server/tools.ts 의 23번 run_skill 도구와 동일한 보안 락다운 (allowlist /
// shell-metachar / cwd 검증 / timeout / env 최소화) 을 main process 안에서 재현.
// mcp-server 의 코드를 그대로 옮기는 게 아니라 의존성 (db, MARBLO_*) 없는 부분만
// 추출해 별도 모듈로 둔다.

const SHELL_METACHARS = /[;&|`$<>\\\n\r]/;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min
const MAX_TIMEOUT_MS = 1_800_000; // 30 min

export interface SkillRunnerDeps {
  ccBinary?: string; // default: process.env.MARBLO_CC_BIN || "claude"
  projectRoot?: string; // default: process.env.MARBLO_PROJECT_ROOT || process.cwd()
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

export function createSkillRunner(deps: SkillRunnerDeps): SkillRunner {
  const ccBinary = deps.ccBinary ?? process.env.MARBLO_CC_BIN ?? "claude";
  const log =
    deps.logger ??
    ((m, meta) => console.log(`[MissionSkillRunner] ${m}`, meta ?? ""));

  async function runSkill(input: {
    missionId: string;
    skill: string;
    args?: string;
    timeoutMs?: number;
  }): Promise<SkillResult> {
    const startedAt = Date.now();

    if (!isAllowedSkill(input.skill)) {
      return {
        success: false,
        error: `skill not in allowlist: ${input.skill}`,
        durationMs: Date.now() - startedAt,
      };
    }
    if (input.args && SHELL_METACHARS.test(input.args)) {
      return {
        success: false,
        error: "args contains forbidden shell metacharacters (;&|`$<>\\n)",
        durationMs: Date.now() - startedAt,
      };
    }

    const cwd =
      deps.projectRoot ?? process.env.MARBLO_PROJECT_ROOT ?? process.cwd();
    if (!path.isAbsolute(cwd)) {
      return {
        success: false,
        error: `cwd must be absolute, got "${cwd}"`,
        durationMs: Date.now() - startedAt,
      };
    }
    try {
      const stat = fs.statSync(cwd);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `cwd "${cwd}" is not a directory`,
          durationMs: Date.now() - startedAt,
        };
      }
    } catch {
      return {
        success: false,
        error: `cwd "${cwd}" does not exist or is not accessible`,
        durationMs: Date.now() - startedAt,
      };
    }

    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 10_000),
      MAX_TIMEOUT_MS
    );
    const prompt = input.args ? `${input.skill} ${input.args}` : input.skill;

    return new Promise<SkillResult>((resolve) => {
      let resolved = false;
      let stdout = "";
      let stderr = "";

      const child = spawn(ccBinary, ["--print", prompt], {
        cwd,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          USER: process.env.USER ?? "",
          LANG: process.env.LANG ?? "en_US.UTF-8",
          MARBLO_PROJECT: process.env.MARBLO_PROJECT ?? "",
          MARBLO_MISSION_ID: input.missionId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* best-effort */
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* best-effort */
          }
        }, 5000);
        finish(false, `timeout after ${timeoutMs}ms`);
      }, timeoutMs);

      const finish = (ok: boolean, errLine?: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const outTail = stdout.slice(-8000);
        const errTail = stderr.slice(-2000);
        log(`runSkill ${input.skill} ${ok ? "ok" : "fail"}`, {
          missionId: input.missionId,
          durationMs,
        });
        resolve({
          success: ok,
          output: outTail,
          error: ok
            ? undefined
            : [errLine, errTail].filter(Boolean).join("\n") || "non-zero exit",
          durationMs,
        });
      };

      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      child.on("exit", (code, signal) => {
        finish(
          code === 0,
          code !== 0
            ? `exit code=${code} signal=${signal ?? "none"}`
            : undefined
        );
      });
      child.on("error", (err) => {
        finish(false, `spawn error: ${err.message}`);
      });
    });
  }

  return { runSkill };
}
