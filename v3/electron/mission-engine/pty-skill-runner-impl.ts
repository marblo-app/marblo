import { isAllowedSkill } from "./types";
import type { OrchestratorRegistry, SkillResult, SkillRunner } from "./ports";

// PTY 기반 SkillRunner.
//
// 기존 skill-runner-impl 은 `claude --print` 로 headless 자식 프로세스를 spawn 해서
// 실행했다. 단점:
//   - 별도 빌링 정책 가능성 (Claude Code subscription vs API)
//   - 사용자가 화면에서 진행을 못 봄
//   - /ship 같이 confirm 이 필요한 스킬이 stdin 닫혀있어 hang
//
// 대안: missions 탭 하단의 mission orchestrator PTY 에 슬래시 명령을 주입.
//   - 사용자가 화면에서 LLM 출력을 실시간으로 봄
//   - confirm 같은 prompt 가 떠도 직접 입력 가능
//   - PTY session 자체가 인증된 Claude Code 인스턴스 → 추가 빌링 이슈 없음
//
// 완료 감지:
//   - readiness 패턴 (`? for shortcuts`, `Type your message`) 이 다시 보이면 LLM 이
//     응답을 마치고 입력 prompt 로 돌아왔다는 신호.
//   - 명령 직후 5초 grace (echo 가 같이 출력될 수 있음).
//   - readiness 패턴 hit 이후 1.5초 quiescence (추가 출력 없음) 면 종료로 본다.
//   - 전체 타임아웃 default 10분.

const SHELL_METACHARS = /[;&|`$<>\\\n\r]/;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min
const MAX_TIMEOUT_MS = 1_800_000; // 30 min
const POST_COMMAND_GRACE_MS = 5_000;
const QUIESCENCE_MS = 1_500;
// 명령 주입 전 오케스트레이터가 idle prompt(readiness) 에 도달했는지 대기하는 한도.
// 갓 launch 된 오케스트레이터는 MCP 로드 + 초기 프롬프트 처리에 수십 초 걸릴 수
// 있어 넉넉히. 이 대기가 없으면 부팅 중 PTY 에 슬래시 명령을 흘려 유실 → 명령이
// 실행되지 않았는데 idle footer 가 readiness 로 매칭되어 거짓 success → 미션이 한
// 곳에서 멈추고 idle 잔해가 step.output 으로 흘러 티켓을 오염시킨다.
const READY_WAIT_TIMEOUT_MS = 90_000;
// readiness 를 본 뒤 이 시간만큼 추가 출력이 없으면 "idle 안정" 으로 판단.
// warm 세션(이미 한 번 명령을 받은 PTY)용 짧은 quiet.
const IDLE_QUIET_WARM_MS = 700;
// 갓 launch 된 세션용 긴 quiet. OrchestratorManager 가 readiness 후 ~1.5초 뒤
// 초기 프롬프트("You are the Marblo Orchestrator Agent...")를 주입하므로, 그보다
// 짧게 기다리면 초기 프롬프트 주입 전에 ready 로 판단해 스킬 명령이 초기 프롬프트와
// 충돌한다. 1.5초 + 초기 프롬프트 응답 처리까지 덮도록 넉넉히 잡아, fresh 세션에선
// 초기 프롬프트 round-trip 이 끝나고 idle 로 안정된 뒤에야 주입한다.
const IDLE_QUIET_FRESH_MS = 3_000;
// chainPrelude ack 대기 한도.
const CHAIN_ACK_TIMEOUT_MS = 8_000;
// Claude Code 1.x / 2.x 의 idle prompt 신호.
// 응답 마치고 입력창으로 돌아왔을 때 footer 또는 placeholder 가 다시 보인다.
// 매칭은 ANSI strip 한 버퍼에서 수행.
const READINESS_PATTERNS: RegExp[] = [
  /\? for shortcuts/, // claude 1.x footer
  /Type your message/i, // 1.x / 2.x placeholder
  /bypass permissions on/i, // claude 2.x footer (--dangerously-skip-permissions)
  /shift\+tab to cycle/i, // claude 2.x footer mode hint
];

// 출력 끝부분에 사용자 답을 기다리는 듯한 질문 패턴이 보이면 mission 을 멈추고
// 알림 카드 띄움. heuristic 이라 false positive 있을 수 있지만, 알림 = pause 가
// 자동 진행보다 안전.
const USER_INPUT_PATTERNS: RegExp[] = [
  /\((y|yes)\s*\/\s*(n|no)\)/i,
  /\[(y|yes)\s*\/\s*(n|no)\]/i,
  /\bcontinue\?/i,
  /\bproceed\?/i,
  /\b(should|shall) (i|we) (continue|proceed|create|push|deploy|run|do)\b/i,
  /would you like (me )?to (proceed|continue|create)/i,
  /press (enter|y) to continue/i,
  /press y(es)? to (confirm|continue|proceed)/i,
  /confirm\?/i,
  /are you sure\?/i,
];

function detectUserInputRequest(text: string): string | undefined {
  // 마지막 500자만 확인 — 질문은 보통 응답의 맨 끝에 위치.
  const tail = text.slice(-500);
  for (const p of USER_INPUT_PATTERNS) {
    const m = tail.match(p);
    if (m) {
      // 매칭된 줄 전체를 컨텍스트로 반환.
      const lineStart = tail.lastIndexOf("\n", m.index ?? 0) + 1;
      const lineEnd = tail.indexOf("\n", (m.index ?? 0) + m[0].length);
      const line = tail
        .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
        .trim();
      return line || m[0];
    }
  }
  return undefined;
}

// ANSI escape (terminal control sequences) 제거 — step.output 으로 저장할 때
// 사람이 읽기 좋은 형태로.
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /\[[0-9;?]*[ -/]*[@-~]|\][^]*/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

function applyCarriageReturnLineDiscipline(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const lastRedraw = line.lastIndexOf("\r");
      return lastRedraw === -1 ? line : line.slice(lastRedraw + 1);
    })
    .join("\n");
}

function cleanCapturedPtyOutput(text: string): string {
  return cleanClaudeNoise(stripAnsi(applyCarriageReturnLineDiscipline(text)));
}

// claude TUI 가 매 프레임 redraw 하는 input box + footer + spinner 노이즈 제거.
// step.output 으로 저장될 때 사용자가 봤을 때 의미있는 LLM 응답만 남기기 위함.
// 너무 공격적으로 자르면 LLM 응답까지 날아갈 수 있으니, 안전한 패턴만 매칭.
const SPINNER_GLYPHS = "✢⏺·✶✻✽✦❀✺✳⠁-⣿";
const SPINNER_PREFIX_GLYPHS = "✢⏺✶✻✽✦❀✺✳⠁-⣿";
const SPINNER_GLYPH_REGEX = new RegExp(`[${SPINNER_GLYPHS}]`, "gu");
const SPINNER_ONLY_LINE_REGEX = new RegExp(`^\\s*[${SPINNER_GLYPHS}]+\\s*$`, "u");
const SPINNER_PREFIX_FRAGMENT_REGEX = new RegExp(
  `^\\s*[${SPINNER_PREFIX_GLYPHS}]+\\s*[\\p{L}\\p{N}_./:-]{0,18}[….]?\\s*$`,
  "u"
);
const SPINNER_FOLLOWER_FRAGMENT_REGEX = /^\s*[\p{L}\p{N}]{1,4}[….]?\s*$/u;
const SPINNER_STATUS_WORD_REGEX =
  /^\s*(?:Gitifying|Thinking|Baking|Sprouting|Crunching|Working|Loading|Running|Reading|Writing|Editing|Searching|Analyzing|Investigating|Summarizing|Processing)[….]*\s*$/i;

const NOISE_LINE_PATTERNS: RegExp[] = [
  // claude 2.x footer — 화살표/box 문자 prefix 가 다양해서(⏵▶▸→❯ 또는 무접두)
  // 줄 어디에 있든 "bypass permissions on" 이 보이면 노이즈로 본다.
  /bypass permissions on/i,
  /shift\s*\+?\s*tab to cycle/i,
  /\besc(ape)? to interrupt\b/i,
  // 스피너/진행 라인 — "✶ Sprouting… (4s · ↓129 tokens · thinking with xhigh effort)",
  // "Baked for 4s", "✻ Thinking…" 등. token/effort/elapsed 마커가 강한 신호.
  /thinking with \S+ effort/i,
  /·\s*[↑↓]?\s*[\d.]+[km]?\s*tokens?/i, // "· ↓129 tokens", "· 1.2k tokens"
  // NOTE: bare /\d+ tokens/ 패턴은 제거 — 위 스피너 패턴과 중복이고 "50 tokens 예산"
  // 같은 정상 LLM 줄을 통째로 삭제하던 과매칭 위험이 있었다.
  /\(\s*\d+s\s*·/i, // "(4s · ..." elapsed+token 헤더
  // 스피너 글리프(브라유/✶✻… )로 시작하는 진행 라인만. ·*• 마크다운 불릿은
  // 제외 — "* Updated X" / "• Removing Y" 같은 정상 불릿 결론을 오삭제하지 않도록.
  /^\s*[✢⠁-⣿✶✻✽✦❀✺⏺]+\s*\w+(?:ing|ed)\b/i, // "✶ Sprouting", "❀ Baked"
  /\bBaked for\b/i,
  // 모바일 앱 / remote-control 안내 (claude 2.x tip).
  /Control this session from the Claude mobile app/i,
  /claude\.com\/download/i,
  /\/remote-control\b/i,
  /^\s*⎿\s*Tip:/i,
  /^\s*─{6,}\s*$/, // 분리선
  /^\s*>\s*$/, // 빈 input prompt
  /^\s*\?\s*for shortcuts\s*$/i,
  /^\s*Type your message/i,
];

function isMostlySpinnerGlyphLine(line: string): boolean {
  const compact = line.trim();
  if (compact === "") return false;
  const glyphCount = compact.match(SPINNER_GLYPH_REGEX)?.length ?? 0;
  if (glyphCount === 0) return false;
  const nonGlyph = compact
    .replace(SPINNER_GLYPH_REGEX, "")
    .replace(/\s+/g, "");
  return glyphCount >= nonGlyph.length;
}

function isSpinnerNoiseLine(line: string): boolean {
  return (
    SPINNER_ONLY_LINE_REGEX.test(line) ||
    SPINNER_PREFIX_FRAGMENT_REGEX.test(line) ||
    SPINNER_STATUS_WORD_REGEX.test(line) ||
    isMostlySpinnerGlyphLine(line)
  );
}

function cleanClaudeNoise(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  let spinnerNoiseRun = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, ""); // trailing whitespace
    const isSpinnerNoise = isSpinnerNoiseLine(line);
    const isSpinnerFollowerFragment =
      spinnerNoiseRun > 0 && SPINNER_FOLLOWER_FRAGMENT_REGEX.test(line);
    if (
      isSpinnerNoise ||
      isSpinnerFollowerFragment ||
      NOISE_LINE_PATTERNS.some((p) => p.test(line))
    ) {
      spinnerNoiseRun =
        isSpinnerNoise || isSpinnerFollowerFragment ? spinnerNoiseRun + 1 : 0;
      continue;
    }
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun > 1) continue; // 연속 빈 줄은 1줄로 축소
      spinnerNoiseRun = 0;
      out.push("");
      continue;
    }
    blankRun = 0;
    spinnerNoiseRun = 0;
    out.push(line);
  }
  // 연속 중복 라인 축소 (claude UI 가 같은 라인을 여러 번 redraw 한 잔재).
  const deduped: string[] = [];
  for (const l of out) {
    if (deduped.length > 0 && deduped[deduped.length - 1] === l && l !== "") {
      continue;
    }
    deduped.push(l);
  }
  return deduped.join("\n").trim();
}

export interface PtyManagerLike {
  onData(id: string, cb: (data: string) => void): void;
  writeAndSubmit(id: string, message: string): void;
}

export interface PtySkillRunnerDeps {
  orchestrators: OrchestratorRegistry;
  ptyManager: PtyManagerLike;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

interface ActiveRun {
  missionId: string;
  skill: string;
  startedAt: number;
  buffer: string;
  postCommandUntil: number;
  lastReadinessAt: number | null;
  lastDataAt: number;
  onProgress?: (chunk: string) => void;
  resolve: (r: SkillResult) => void;
  timeoutTimer: NodeJS.Timeout;
  quiescenceTimer: NodeJS.Timeout | null;
}

export function createPtySkillRunner(deps: PtySkillRunnerDeps): SkillRunner {
  const log =
    deps.logger ??
    ((m, meta) => console.log(`[PtySkillRunner] ${m}`, meta ?? ""));

  // mission orchestrator 의 ptySessionId 별로 단일 persistent data listener.
  // 새 ptySessionId 가 들어오면 처음 한 번만 attach. activeRun 이 set 되어있을 때만
  // 출력 라우팅.
  const attachedPtyIds = new Set<string>();
  // projectId 별 활성 skill 실행 — 같은 mission orchestrator 에 동시 명령 주입은
  // 금지. 같은 projectId 에서 두 mission 이 동시에 step 실행 시도 시 두 번째는 대기.
  const activeByPty = new Map<string, ActiveRun>();
  const waitQueueByPty = new Map<string, Array<() => void>>();
  // activeRun 과 무관하게 항상 갱신되는 최근 PTY 출력 + 마지막 데이터 시각.
  // 명령 주입 전에 오케스트레이터가 idle prompt 에 도달했는지(waitForIdle) 판단하는
  // 용도 — activeRun 의 buffer 는 run 이 set 된 뒤에만 채워지므로 별도 추적이 필요.
  const idleStateByPty = new Map<string, { buf: string; lastDataAt: number }>();
  // 이 PTY 에 명령을 한 번이라도 성공적으로 주입했는지. 첫 주입은 fresh quiet
  // (초기 프롬프트 round-trip 을 덮는 긴 idle), 이후는 warm quiet 으로 빠르게.
  const warmedPtyIds = new Set<string>();

  function recordIdle(ptyId: string, data: string): void {
    const st = idleStateByPty.get(ptyId) ?? { buf: "", lastDataAt: 0 };
    st.buf = (st.buf + data).slice(-4000);
    st.lastDataAt = Date.now();
    idleStateByPty.set(ptyId, st);
  }

  // 오케스트레이터가 입력 prompt(readiness 패턴) 에 도달하고 최근 출력이 멎을
  // (IDLE_QUIET_MS) 때까지 대기. timeout 시 false 를 반환하되 caller 는 그래도 진행
  // (best-effort) — 영원히 막지 않는다.
  function waitForIdle(
    ptyId: string,
    timeoutMs: number,
    quietMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise<boolean>((resolve) => {
      const check = () => {
        const st = idleStateByPty.get(ptyId);
        const cleaned = st ? stripAnsi(st.buf) : "";
        const ready = READINESS_PATTERNS.some((p) => p.test(cleaned));
        const quietFor = st
          ? Date.now() - st.lastDataAt
          : Number.POSITIVE_INFINITY;
        if (ready && quietFor >= quietMs) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(check, 150);
      };
      check();
    });
  }

  function emitProgress(run: ActiveRun, force = false): void {
    if (!run.onProgress) return;
    // 큰 버퍼 매번 cleanClaudeNoise 돌리는 cost 줄이려고 마지막 8KB 만 정리.
    const cleaned = cleanCapturedPtyOutput(run.buffer.slice(-8000));
    const tail = cleaned.slice(-4000);
    if (!force && tail.length === 0) return;
    try {
      run.onProgress(tail);
    } catch {
      /* best-effort */
    }
  }

  function finish(
    ptyId: string,
    run: ActiveRun,
    success: boolean,
    errLine?: string
  ): void {
    clearTimeout(run.timeoutTimer);
    if (run.quiescenceTimer) clearTimeout(run.quiescenceTimer);
    activeByPty.delete(ptyId);
    const durationMs = Date.now() - run.startedAt;
    // ANSI 제거 → claude TUI noise (footer/spinner/separator) 제거 → 마지막 8KB.
    const cleaned = cleanCapturedPtyOutput(run.buffer);
    const outTail = cleaned.slice(-8000);
    // success 케이스에서만 사용자 입력 패턴 감지 — fail/timeout 은 별도 알림.
    const userInputDetected = success
      ? detectUserInputRequest(outTail)
      : undefined;
    log(
      `runSkill ${run.skill} ${success ? "ok" : "fail"}${
        userInputDetected ? " [user-input-detected]" : ""
      }`,
      {
        missionId: run.missionId,
        durationMs,
        bufferLen: run.buffer.length,
      }
    );
    run.resolve({
      success,
      output:
        outTail.length > 0
          ? outTail
          : success
          ? "(no output captured)"
          : errLine ?? "non-zero",
      error: success ? undefined : errLine ?? "skill did not return cleanly",
      durationMs,
      userInputDetected,
    });
    // 대기 큐 진행
    const waiters = waitQueueByPty.get(ptyId);
    if (waiters && waiters.length > 0) {
      const next = waiters.shift()!;
      next();
    }
  }

  function attachListener(ptyId: string): void {
    if (attachedPtyIds.has(ptyId)) return;
    attachedPtyIds.add(ptyId);
    deps.ptyManager.onData(ptyId, (data: string) => {
      // activeRun 유무와 무관하게 idle 추적은 항상 갱신 (waitForIdle 용).
      recordIdle(ptyId, data);
      const run = activeByPty.get(ptyId);
      if (!run) return;
      const now = Date.now();
      run.lastDataAt = now;
      run.buffer += data;
      // buffer 가 너무 크면 앞부분 잘라내 메모리 보호 (output tail 만 의미 있음)
      if (run.buffer.length > 128 * 1024) {
        run.buffer = run.buffer.slice(-64 * 1024);
      }
      emitProgress(run);

      // 명령 직후 grace 안에는 readiness 매칭 skip.
      if (now < run.postCommandUntil) return;

      // 청크 경계로 패턴이 끊기는 경우를 잡기 위해 누적 버퍼 tail 에서도 매칭.
      // (마지막 4KB 만 보면 충분 — claude footer/placeholder 는 짧은 텍스트)
      const cleanedTail = stripAnsi(run.buffer.slice(-4000));
      const matched = READINESS_PATTERNS.some((p) => p.test(cleanedTail));
      if (!matched && !run.lastReadinessAt) return;
      if (matched) run.lastReadinessAt = now;

      // readiness 본 후 quiescence 동안 추가 데이터 없으면 완료.
      // 매 데이터마다 quiescence 타이머 재설정.
      if (run.quiescenceTimer) clearTimeout(run.quiescenceTimer);
      run.quiescenceTimer = setTimeout(() => {
        // 진짜로 silent 였는지 검증
        if (Date.now() - run.lastDataAt >= QUIESCENCE_MS - 50) {
          finish(ptyId, run, true);
        }
      }, QUIESCENCE_MS);
    });
  }

  // PTY 에 prompt 를 주입하고 quiescence 까지 대기하는 코어. runSkill /
  // runRawMessage 가 prompt 와 label 만 바꿔 같은 로직을 공유.
  async function runPrompt(input: {
    missionId: string;
    projectId: string;
    label: string; // 로그 / activeRun 식별용 (e.g. "/review" or "synthesis")
    prompt: string;
    timeoutMs?: number;
    onProgress?: (chunk: string) => void;
    chainPrelude?: string;
  }): Promise<SkillResult> {
    const startedAt = Date.now();

    const orchRef = await deps.orchestrators.ensureSession({
      missionId: input.missionId,
      projectId: input.projectId,
    });
    if (!orchRef.isAlive()) {
      return {
        success: false,
        error: "mission orchestrator not running",
        durationMs: Date.now() - startedAt,
      };
    }
    const ptyId = orchRef.ptySessionId;
    if (!ptyId) {
      return {
        success: false,
        error: "mission orchestrator has no ptySessionId yet",
        durationMs: Date.now() - startedAt,
      };
    }

    attachListener(ptyId);

    // 같은 PTY 에 이미 실행 중인 run 이 있으면 큐에서 대기
    if (activeByPty.has(ptyId)) {
      await new Promise<void>((resolve) => {
        const waiters = waitQueueByPty.get(ptyId) ?? [];
        waiters.push(resolve);
        waitQueueByPty.set(ptyId, waiters);
      });
    }

    // 명령 주입 전 오케스트레이터가 idle prompt 에 도달했는지 대기. 갓 launch 된
    // 세션은 MCP 로드 + 초기 프롬프트("You are the Marblo Orchestrator Agent...")
    // 처리 중이라, 여기서 기다리지 않고 슬래시 명령을 흘리면 부팅 출력에 섞여
    // 유실되고 → 명령이 실행되지 않은 채 idle footer 가 readiness 로 매칭되어
    // 거짓 success → 미션이 멈추고 idle 잔해가 step.output 을 오염시킨다. 이미
    // idle 이면 즉시 반환되므로 warm 세션엔 사실상 무비용.
    // 첫 주입은 fresh quiet(초기 프롬프트 round-trip 을 덮음), 이후는 warm.
    const firstInject = !warmedPtyIds.has(ptyId);
    const ready = await waitForIdle(
      ptyId,
      READY_WAIT_TIMEOUT_MS,
      firstInject ? IDLE_QUIET_FRESH_MS : IDLE_QUIET_WARM_MS
    );
    warmedPtyIds.add(ptyId);
    if (!ready) {
      log("orchestrator not idle before inject — proceeding best-effort", {
        missionId: input.missionId,
        label: input.label,
        ptyId,
      });
    }

    // chainPrelude — 메인 prompt 전에 컨텍스트 메시지 주입. claude 가 짧게 ack 한 후
    // (idle 로 복귀) 다음 prompt 로 진행.
    if (input.chainPrelude && input.chainPrelude.trim().length > 0) {
      try {
        deps.ptyManager.writeAndSubmit(ptyId, input.chainPrelude);
      } catch (e) {
        log("chainPrelude writeAndSubmit failed", { err: String(e) });
      }
      // ack 대기 — chainPrelude 주입 직후엔 곧장 readiness 가 남아있을 수 있어
      // 짧게 텀을 둔 뒤 idle 안정을 본다 (warm quiet).
      await new Promise<void>((r) => setTimeout(r, 400));
      await waitForIdle(ptyId, CHAIN_ACK_TIMEOUT_MS, IDLE_QUIET_WARM_MS);
    }

    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 10_000),
      MAX_TIMEOUT_MS
    );

    return new Promise<SkillResult>((resolve) => {
      const now = Date.now();
      const run: ActiveRun = {
        missionId: input.missionId,
        skill: input.label,
        startedAt: now,
        buffer: "",
        postCommandUntil: now + POST_COMMAND_GRACE_MS,
        lastReadinessAt: null,
        lastDataAt: now,
        onProgress: input.onProgress,
        resolve,
        timeoutTimer: setTimeout(() => {
          finish(ptyId, run, false, `timeout after ${timeoutMs}ms`);
        }, timeoutMs),
        quiescenceTimer: null,
      };
      activeByPty.set(ptyId, run);
      log("runPrompt start", {
        missionId: input.missionId,
        label: input.label,
        ptyId,
        hasChain: !!input.chainPrelude,
      });
      try {
        deps.ptyManager.writeAndSubmit(ptyId, input.prompt);
      } catch (e) {
        finish(
          ptyId,
          run,
          false,
          `writeAndSubmit failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    });
  }

  async function runSkill(input: {
    missionId: string;
    projectId: string;
    skill: string;
    args?: string;
    timeoutMs?: number;
    onProgress?: (chunk: string) => void;
    chainPrelude?: string;
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

    const prompt = input.args ? `${input.skill} ${input.args}` : input.skill;
    return runPrompt({
      missionId: input.missionId,
      projectId: input.projectId,
      label: input.skill,
      prompt,
      timeoutMs: input.timeoutMs,
      onProgress: input.onProgress,
      chainPrelude: input.chainPrelude,
    });
  }

  async function runRawMessage(input: {
    missionId: string;
    projectId: string;
    prompt: string;
    timeoutMs?: number;
    onProgress?: (chunk: string) => void;
  }): Promise<SkillResult> {
    return runPrompt({
      missionId: input.missionId,
      projectId: input.projectId,
      label: "(raw)",
      prompt: input.prompt,
      timeoutMs: input.timeoutMs,
      onProgress: input.onProgress,
    });
  }

  return { runSkill, runRawMessage };
}
