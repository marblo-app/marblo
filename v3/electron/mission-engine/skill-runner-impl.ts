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
    onProgress?: (chunk: string) => void;
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
      // throttle: 2초마다 또는 chunk가 500바이트 누적되면 onProgress 호출.
      let lastProgressAt = 0;
      let lastEmittedLen = 0;
      const PROGRESS_INTERVAL_MS = 2_000;
      const PROGRESS_MIN_DELTA = 500;
      const emitProgress = (force = false) => {
        if (!input.onProgress) return;
        const now = Date.now();
        const combinedLen = stdout.length + stderr.length;
        if (
          !force &&
          now - lastProgressAt < PROGRESS_INTERVAL_MS &&
          combinedLen - lastEmittedLen < PROGRESS_MIN_DELTA
        ) {
          return;
        }
        lastProgressAt = now;
        lastEmittedLen = combinedLen;
        // 최근 4000자 tail 만 (Firestore write cost + UI render 부담 완화).
        const tail =
          stderr.length > 0
            ? `${stdout}\n[stderr]\n${stderr}`.slice(-4000)
            : stdout.slice(-4000);
        try {
          input.onProgress(tail);
        } catch {
          /* best-effort */
        }
      };

      // --dangerously-skip-permissions: 헤드리스 `--print` 실행은 stdin 이
      // ignore 라 권한 프롬프트가 뜨면 응답할 수 없어 그대로 멈춘다. 스킬이
      // 파일 편집/bash/MCP tool 을 쓰면 자동승인이 없으면 동작 자체가 막힘.
      // 다른 워커(claude/codex/gemini/agy)와 동일하게 무인 자동 실행이 기본.
      const child = spawn(
        ccBinary,
        ["--print", "--dangerously-skip-permissions", prompt],
        {
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
        }
      );

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
        // stdout 우선, 비면 stderr 도 포함해서 항상 뭐라도 저장.
        // claude --print 가 tool-use 만 하고 final text 가 없으면 stdout 이 비기도 함.
        const stdoutTail = stdout.slice(-8000);
        const stderrTail = stderr.slice(-2000);
        const combinedOutput =
          stdoutTail.length > 0 && stderrTail.length > 0
            ? `${stdoutTail}\n\n--- stderr ---\n${stderrTail}`
            : stdoutTail.length > 0
            ? stdoutTail
            : stderrTail.length > 0
            ? `(stdout was empty)\n--- stderr ---\n${stderrTail}`
            : "(no output captured)";
        log(`runSkill ${input.skill} ${ok ? "ok" : "fail"}`, {
          missionId: input.missionId,
          durationMs,
          stdoutLen: stdout.length,
          stderrLen: stderr.length,
        });
        resolve({
          success: ok,
          output: combinedOutput,
          error: ok
            ? undefined
            : [errLine, stderrTail].filter(Boolean).join("\n") ||
              "non-zero exit",
          durationMs,
        });
      };

      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
        emitProgress();
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
        emitProgress();
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
