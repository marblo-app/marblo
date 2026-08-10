/**
 * 우리 스폰 경로 어댑터.
 *
 * ★정직한 경계 — 이 하네스는 제품의 스폰 경로를 **그대로** 타지 않는다.
 *
 * 제품(`electron/agent-config.ts` `buildCLICommand`)은 PTY 대화형 세션을 띄우고
 * 거기에 per-agent MCP 설정·역할 스킬 파일·마블로 보드 컨텍스트를 주입한다.
 * 벤치는 그 배선을 못 탄다 — MCP 서버도 보드 티켓도 벤치 인스턴스에는 존재하지
 * 않기 때문이다. 그래서 여기서는 **같은 바이너리·같은 권한 플래그·같은 모델/
 * effort 핀**을 headless 모드로 재현한다.
 *
 * 즉 이 벤치가 재는 것은 "마블로 오케 배선 포함 성능"이 아니라
 * **"우리가 고른 CLI 하네스 + 모델 핀의 단발(single-shot) 성능"** 이다.
 * 그 차이를 `SCAFFOLD_ID` 가 문자열로 들고 다닌다.
 *
 * 아래 인자 구성은 `buildCLICommand` 의 claude/gpt 분기를 미러링한 것이다.
 * ★제품 코드를 import 하지 않는 것은 의도다 — feasibility 문서 §4-G 가 벤치와
 * 제품 로직의 결합을 금지한다(벤치→라우팅 자기강화 루프 방어). 대신 제품이
 * 플래그를 바꾸면 여기도 바꿔야 한다는 뜻이므로, 바뀌면 리포트의 SCAFFOLD_ID 를
 * 올려서 이전 라운드와 섞이지 않게 한다.
 */
import { exec, type ExecResult } from "./env";
import type { AgentRun, BenchHarness, SweInstance } from "./types";

/** SWE-bench 관례의 단발 프롬프트. 힌트(hints_text)·gold 패치는 주지 않는다. */
export function buildPrompt(instance: SweInstance): string {
  return [
    `You are working in a checkout of the \`${instance.repo}\` repository.`,
    "",
    "Resolve the following issue by editing the source code in this repository.",
    "",
    "<issue>",
    instance.problem_statement.trim(),
    "</issue>",
    "",
    "Requirements:",
    "- Make the minimal source change that fixes the issue.",
    "- Do NOT modify, add, or delete any test files. Tests are graded separately",
    "  and any edits you make to them will be reverted before grading.",
    "- Do not commit; just leave the edits in the working tree.",
    "",
    "When you are done, stop.",
  ].join("\n");
}

export interface HarnessInvocation {
  command: string;
  args: string[];
}

/**
 * 하네스별 headless argv. `model`/`effort` 가 null 이면 붙이지 않는다 —
 * 제품과 같은 규율로, 핀이 없으면 CLI 기본값을 쓰고 그 사실을 기록한다
 * (없는 핀을 지어내지 않는다).
 */
export function buildInvocation(
  harness: BenchHarness,
  prompt: string,
  model: string | null,
  effort: string | null,
): HarnessInvocation {
  if (harness === "claude") {
    return {
      command: "claude",
      args: [
        "-p",
        prompt,
        "--dangerously-skip-permissions",
        ...(model ? ["--model", model] : []),
      ],
    };
  }
  if (harness === "codex") {
    return {
      command: "codex",
      args: [
        "exec",
        prompt,
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="danger-full-access"',
        ...(model ? ["-c", `model="${model}"`] : []),
        ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      ],
    };
  }
  throw new Error(`harness ${harness} has no agent invocation`);
}

export function cliVersion(harness: BenchHarness): string | null {
  const bin =
    harness === "claude" ? "claude" : harness === "codex" ? "codex" : null;
  if (!bin) return null;
  const r = exec(bin, ["--version"], { timeoutMs: 20_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * 에이전트를 1회 스폰한다. 패치 추출은 호출자가 한다 — 여기서는 실행 관측치만
 * 만든다(관심사 분리: 무산출 판정은 diff 를 본 쪽이 내려야 정확하다).
 */
export function runAgent(
  invocation: HarnessInvocation,
  repoDir: string,
  timeoutMs: number,
): { exec: ExecResult; run: Omit<AgentRun, "patch" | "noOutput"> } {
  const started = Date.now();
  const r = exec(invocation.command, invocation.args, {
    cwd: repoDir,
    timeoutMs,
    // 에이전트가 우리 벤치 venv 를 건드리지 않게 PATH 는 그대로 두되,
    // 마블로 MCP 배선은 주입하지 않는다(§scaffold 경계).
    env: { ...process.env },
  });
  const durationMs = Date.now() - started;
  return {
    exec: r,
    run: {
      command: invocation.command,
      args: invocation.args,
      exitCode: r.status,
      durationMs,
      timedOut: r.timedOut,
      tailLog: (r.stdout + r.stderr)
        .split("\n")
        .slice(-40)
        .join("\n")
        .slice(-4000),
    },
  };
}
