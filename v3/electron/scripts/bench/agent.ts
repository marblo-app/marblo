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
import { parseUsage } from "./usage";

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
        // ★사용량·청구액을 받기 위한 플래그. 모델 행동은 바꾸지 않고 **출력
        // 형식만** 바꾼다(패치는 stdout 이 아니라 git diff 로 걷으므로 무영향).
        // 이것이 스캐폴드 변경이므로 SCAFFOLD_ID 를 올렸다 — 안 올리면 옛
        // 라운드와 한 칸에 합산돼 시계열이 조용히 오염된다.
        "--output-format",
        "json",
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
        // ★사용량을 받기 위한 플래그(위 claude 와 같은 이유·같은 무영향).
        // codex 는 청구액을 안 주고 토큰만 준다 — 그 차이는 `usage.ts` 가
        // 정규화하고 리포트가 근거를 표시한다.
        "--json",
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="danger-full-access"',
        ...(model ? ["-c", `model="${model}"`] : []),
        ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      ],
    };
  }
  if (harness === "grok") {
    // 근거는 `electron/model-registry.ts` 의 grok 항목 주석에 적힌 실측 용법:
    // `grok -p ... -m grok-4.5`. ★effort 는 **일부러 무시**한다 — grok CLI 에는
    // reasoning-effort 축 자체가 없어서, 없는 플래그를 지어 붙이면 CLI 가 죽거나
    // (더 나쁘게) 조용히 무시돼 "effort=high 로 쟀다"는 거짓 라벨만 남는다.
    return {
      command: "grok",
      args: ["-p", prompt, ...(model ? ["-m", model] : [])],
    };
  }
  throw new Error(`harness ${harness} has no agent invocation`);
}

/**
 * ★프로바이더 실패 판정 — "측정이 성립하지 않은 런" 을 0점과 가르는 게이트.
 *
 * 왜 필요한가: Upstage 429(레이트리밋)로 codex 가 재시도 한도를 넘겨 죽으면, 그
 * 런에서 **모델은 답을 낸 적이 없다**. 그런데 종전 배선은 그 런을 그대로 채점해
 * `resolved=false`(=0점)로 적었다. 그건 **벤더 장애를 모델 실력으로 둔갑**시키는
 * 것이고, 이 하네스가 `assertIdsMatch` 로 이미 한 번 막아 둔 실패모드(조용한
 * 오채점)와 정확히 같은 종류다.
 *
 * ★판정 근거는 **codex 자신이 포기했다고 적은 줄** 하나뿐이다. 모델이 못 푼 것과
 * 헷갈릴 여지가 없어야 하므로, 우리가 로그를 해석해 추측하지 않는다.
 *
 * ★반대로 `unsupported call: apply_patch`(도구 표면 불일치)는 **여기서 잡지
 * 않는다.** 그건 모델이 답을 냈는데 하네스가 그 행동을 거절한 것이라 측정이
 * 성립하긴 했다(다만 하네스가 깎은 측정이다). 분모에서 빼면 점수를 유리하게
 * 만드는 조작이 된다 — 그래서 리포트에는 진단으로만 따로 센다.
 */
const PROVIDER_FAILURE_PATTERNS: readonly RegExp[] = [
  // codex: `ERROR: exceeded retry limit, last status: 429 Too Many Requests`
  /exceeded retry limit, last status:\s*(\d{3})/i,
];

export function providerFailure(tailLog: string): string | null {
  for (const re of PROVIDER_FAILURE_PATTERNS) {
    const m = re.exec(tailLog);
    if (m) return m[0].trim();
  }
  return null;
}

export function cliVersion(harness: BenchHarness): string | null {
  const bin =
    harness === "claude"
      ? "claude"
      : harness === "codex"
        ? "codex"
        : harness === "grok"
          ? "grok"
          : null;
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
  /**
   * OpenAI 호환 env-swap 벤더 배선(CODEX_HOME + 벤더 키). `vendor.ts` 가 만든
   * 것만 들어오고, 없으면 기본 경로 그대로다 — 즉 기존 라운드의 스폰은
   * 이 인자가 비어 있어 **한 글자도 달라지지 않는다**.
   */
  extraEnv: Record<string, string> = {},
): { exec: ExecResult; run: Omit<AgentRun, "patch" | "noOutput"> } {
  const started = Date.now();
  const r = exec(invocation.command, invocation.args, {
    cwd: repoDir,
    timeoutMs,
    // 에이전트가 우리 벤치 venv 를 건드리지 않게 PATH 는 그대로 두되,
    // 마블로 MCP 배선은 주입하지 않는다(§scaffold 경계).
    env: { ...process.env, ...extraEnv },
  });
  const durationMs = Date.now() - started;
  // ★사용량은 **자르기 전 전체 stdout** 에서 뽑는다. tailLog 는 40줄로 잘리는데,
  // codex 의 turn.completed 는 마지막 줄이 아닐 수 있어서 잘린 것에서 뽑으면
  // 조용히 null 이 된다(= 비용을 잃는다).
  const usage = parseUsage(harnessOf(invocation.command), r.stdout);
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
      usage,
    },
  };
}

/** 스폰한 바이너리명 → 사용량 파서 선택 키. */
function harnessOf(command: string): string {
  if (command === "claude") return "claude";
  if (command === "codex") return "codex";
  return command;
}
