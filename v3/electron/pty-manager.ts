import * as pty from "node-pty";
import fs from "fs";
import os from "os";
import { detectDangerousCommand, type DangerMatch } from "./danger-command";
import { collectDescendants, readProcTree } from "./proc-tree";
import {
  ComposerTracker,
  type ComposerRefusal,
  type ComposerState,
  type ComposerVerdict,
} from "./composer-gate";

/**
 * A pseudo-terminal MASTER fd that node-pty opens at spawn but neither exposes
 * nor closes on teardown — the ORPHAN. See PtyManager's fd-leak notes and
 * captureOrphanMasterFds. Stored as an (fd, rdev) pair so teardown can verify
 * the fd still points to the exact same device before closing it (a bare fd
 * number could be recycled by the OS to something we must not close).
 */
interface OrphanFd {
  fd: number;
  rdev: number;
}

export interface PtySession {
  id: string;
  name: string;
  process: pty.IPty;
  shell: string;
  /**
   * Orphaned pty master fd(s) captured for this session at spawn, closed on
   * teardown (destroyProcess). Empty on non-macOS / when none were detected.
   */
  orphanFds?: OrphanFd[];
}

/** Emitted when a dangerous command is detected on a writeAndSubmit. */
export interface DangerEvent {
  /** PTY session id the write was targeting. */
  sessionId: string;
  /** The text that triggered detection. */
  text: string;
  /** What matched. */
  match: DangerMatch;
  /** Whether the write was blocked (not sent) by the active policy. */
  blocked: boolean;
}

// Output that only appears once an agent CLI has actually accepted a submit
// (started a turn). Used by writeAndSubmit to confirm the Enter keystroke
// registered. Kept harness-agnostic but tuned for Claude Code:
//   - "esc to interrupt" — Claude/Codex/agy busy footer
//   - spinner glyphs ✻✶✳✽✢ — Claude working animation
//   - "↓ N tokens" / "tokens)" — streaming token counter
// Deliberately does NOT include the idle footer (`⏵⏵ auto mode`, `? for
// shortcuts`) which is present even when nothing was submitted.
const SUBMIT_SIGNAL = /esc to interrupt|[✻✶✳✽✢]|↓\s*\d+\s*tokens|tokens\)/i;

/**
 * True when a PTY output chunk shows the CLI is actively working (busy footer /
 * spinner / streaming token counter), NOT the idle footer. Exported so callers
 * that need an "is the orchestrator mid-turn?" signal (e.g. the Telegram poller's
 * un-replied nudge, which waits for a busy→idle transition) can reuse the exact
 * same detection writeAndSubmit uses, instead of duplicating a fragile regex.
 */
export function isBusySignal(data: string): boolean {
  return SUBMIT_SIGNAL.test(data);
}

/**
 * 제출 확인 3분기 (티켓 igGI6QpXkEfrkkKN3rU0). #1157 의 ProbeOutcome 과 **같은
 * 규율**이다: 모르면 모른다고 하고, 판정 불가를 성공으로도 실패로도 뚝치지 않는다.
 *
 *   confirmed     — CR 직전에는 busy 신호가 없었고 CR 직후에 나타났다. 우리 CR 이
 *                   턴을 시작시켰다는 **양성** 증거.
 *   unconfirmed   — CR 을 예산껏 보냈는데 busy 신호가 끝내 안 나왔다. 메시지가
 *                   컴포저에 그대로 남아 있을 가능성이 높다.
 *   indeterminate — ★CR 을 보내기 **전부터** busy 신호가 흐르고 있었다. 그 신호가
 *                   우리 CR 의 반응인지 남의 턴의 스피너인지 구별할 방법이 없다.
 *
 * ★indeterminate 가 이 타입의 존재 이유다. 실측(tests/integration/
 *   answer-delivery-composer.cjs S3)에서, 턴 중인 에이전트에 답을 주입하면
 *   **제출이 0건인데도** 스피너가 SUBMIT_SIGNAL 에 걸려 첫 시도에 '성공' 판정이
 *   났다 — 754ms(정상 전달)와 752ms(완전 유실)가 반환값·소요시간·로그 어느 것으로도
 *   구별되지 않았다. 그 구간을 confirmed 라고 부르는 것이 유실을 은폐해 왔다.
 */
export type SubmitOutcome =
  | "confirmed"
  | "unconfirmed"
  | "indeterminate"
  /**
   * ★쓰지 않았다 (티켓 RtyOMpOArfI7a5JNSzsg). 위 셋은 "썼는데 제출됐나" 를 재는
   * 축이고, 이건 그 앞이다 — 컴포저가 오염돼 있어 **아예 쓰지 않기로** 했다.
   * `delivered=false` 로 돌아가므로 호출부(InstructionDeliveryQueue)가 재시도·
   * 보류를 판단하고, `refusal` 이 발신자에게 돌려줄 기계 판독 사유다.
   */
  | "refused";

/** 제출 1건의 관측 결과. 판정 단어가 아니라 관측 사실을 담는다. */
export interface SubmitObservation {
  sessionId: string;
  outcome: SubmitOutcome;
  /** 실제로 보낸 CR 개수. */
  attempts: number;
  /** ★CR 을 처음 보내기 직전 SUBMIT_VERIFY_MS 안에 이미 busy 신호가 있었는가. */
  streamHotBeforeCr: boolean;
  /** 주입한 본문의 길이. 본문 자체는 싣지 않는다(비밀 유출 방지). */
  textLength: number;
  /** 오케/사람에게 보여줄 한 줄 근거(한국어). */
  reason: string;
  /** 쓰기 직전에 읽은 컴포저 상태(티켓 RtyOMpOArfI7a5JNSzsg). */
  composer?: ComposerState;
  /** `outcome === "refused"` 일 때의 기계 판독 사유. */
  refusal?: ComposerRefusal;
}

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();
  private writeAndSubmitQueues: Map<string, Promise<boolean>> = new Map();
  /** Per-session "a new turn was submitted" listeners — see onSubmit(). */
  private submitListeners: Map<string, Array<() => void>> = new Map();
  /**
   * 세션별 마지막 busy 신호(SUBMIT_SIGNAL) 관측 시각. submitWithRetry 가 CR 을
   * 보내기 **직전**에 "이 스트림이 이미 뜨거운가" 를 묻는 데 쓴다 — 이미 뜨겁다면
   * CR 직후에 보이는 신호는 우리 것이 아닐 수 있다(SubmitOutcome 참조).
   * create() 에서 세션 수명 동안 붙는 리스너가 갱신한다.
   */
  private lastBusySignalAt: Map<string, number> = new Map();
  /** 제출 관측 구독자 — onSubmitOutcome(). */
  private submitOutcomeListeners: Array<(o: SubmitObservation) => void> = [];
  /**
   * ★주입 직전 컴포저 판정기(티켓 RtyOMpOArfI7a5JNSzsg). 세션의 출력(화면)과
   * 입력(사람이 친 키·우리가 붙여넣은 본문)을 둘 다 먹고, "지금 써도 되는가" 에
   * 답한다. 오염돼 있으면 `writeAndSubmit` 이 **쓰지 않고** false 로 돌아간다 —
   * 지우지도, 남의 초안을 대신 제출하지도 않는다.
   */
  private composer = new ComposerTracker();

  // --- PTY master-fd leak guard ---
  // node-pty (1.1.0) opens TWO /dev/ptmx master devices per spawn on macOS: the
  // one it tracks (`proc.fd`, wrapped by its read stream) and a SECOND it never
  // exposes on the JS API (opened via `new tty.ReadStream(term.fd)` in
  // unixTerminal.js). `.kill()` only signals the child and closes nothing;
  // `.destroy()` closes the read stream's tracked fd — but NEITHER closes that
  // second, orphaned master. So both `.kill()` and `.destroy()` leak exactly one
  // /dev/ptmx per teardown (empirically confirmed via lsof; see ticket
  // o1ozhfJtWVZemBPjQzZ2). Leaked masters accumulate against macOS
  // `kern.tty.ptmx_max` (default 511); once exhausted, openpty() returns ENXIO
  // and EVERY subsequent agent/terminal spawn dies with a cryptic
  // "posix_spawnp failed". The fix: capture that orphan fd at spawn
  // (captureOrphanMasterFds) and `fs.closeSync()` it on every teardown path
  // (destroyProcess → releaseOrphanMasterFds), in addition to `.destroy()`ing
  // the tracked fd and sweeping dead-but-mapped sessions.
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly REAP_INTERVAL_MS = 60_000;

  // --- Dangerous-command safety guard (MVP-P0-1) ---
  // Every writeAndSubmit is screened by detectDangerousCommand. Matches are
  // logged and broadcast to listeners. By default nothing is blocked (warn-only)
  // to preserve existing behavior; an operator can flip blocking on for the
  // non-isolated paths (e.g. the orchestrator, which drives the main checkout).
  private dangerListeners: Array<(e: DangerEvent) => void> = [];
  private blockDangerous = false;
  // Per-session block opt-in (P3-3). The global `blockDangerous` flag would
  // block EVERY writeAndSubmit — including worker dispatch instructions that
  // merely MENTION a dangerous command in their task text — which is a
  // regression for the worktree-isolated workers the danger module deliberately
  // leaves in warn-only mode. Instead the non-isolated orchestrator PTY opts its
  // own session into blocking (see setBlockDangerousForSession), so high-severity
  // commands aimed at the main checkout are actually dropped, not just logged.
  private blockDangerousSessions: Set<string> = new Set();

  /**
   * Subscribe to dangerous-command detections. Returns an unsubscribe fn.
   * Multiple subscribers are supported (orchestrator + future UI/IPC).
   */
  onDanger(listener: (e: DangerEvent) => void): () => void {
    this.dangerListeners.push(listener);
    return () => {
      this.dangerListeners = this.dangerListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Policy flag: when true, a detected high-severity command is BLOCKED
   * (the write is dropped, never reaching the PTY). Medium-severity is always
   * warn-only. Defaults to false (warn-only for everything).
   */
  setBlockDangerous(block: boolean): void {
    this.blockDangerous = block;
  }

  /**
   * Per-session variant of the block policy (P3-3). When enabled for a session
   * id, a detected high-severity command targeting THAT session is BLOCKED even
   * while the global policy stays warn-only. Used by the orchestrator (which
   * drives the non-isolated main checkout) to enforce blocking on just its own
   * PTY without affecting worktree-isolated workers. Cleared automatically on
   * session teardown (kill / stale-replace); safe to call before the session
   * exists (the id is matched at write time).
   */
  setBlockDangerousForSession(sessionId: string, block: boolean): void {
    if (block) {
      this.blockDangerousSessions.add(sessionId);
    } else {
      this.blockDangerousSessions.delete(sessionId);
    }
  }

  private emitDanger(e: DangerEvent): void {
    for (const l of this.dangerListeners) {
      try {
        l(e);
      } catch (err) {
        console.error(
          `[PtyManager] danger listener threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  create(
    id: string,
    name: string,
    command?: string,
    args?: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): PtySession {
    const shell =
      command ||
      (os.platform() === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/zsh");
    const shellArgs = args || [];
    const spawnCwd = cwd || os.homedir();

    // cwd guard: a pty spawned into a DELETED directory does not throw. The
    // native fork succeeds, then the shell fails its own chdir and exits 1
    // within ~6ms — no exception, no error dialog, just a terminal that never
    // appears. Worse, OrchestratorManager reads that exit as a crash and
    // re-launches into the same dead path on a 2s/4s/8s backoff before giving
    // up silently. The path goes stale routinely now that "이 워크트리 보기"
    // points windows at `~/.marblo/worktrees/**` trees that later get removed
    // (#476/#489), so validate BEFORE spawning and fail loudly instead. Checked
    // ahead of the stale-session teardown below so a doomed create() can never
    // take down a healthy PTY that already holds this id.
    let cwdStat: fs.Stats | undefined;
    try {
      cwdStat = fs.statSync(spawnCwd);
    } catch {
      /* missing / unreadable — reported below */
    }
    if (!cwdStat?.isDirectory()) {
      const reason = cwdStat ? "is not a directory" : "does not exist";
      const e: NodeJS.ErrnoException = new Error(
        `PTY working directory ${reason}: "${spawnCwd}". The shell would exit immediately with no error. If this was a git worktree it has likely been removed — reopen the project on its main checkout.`,
      );
      e.code = cwdStat ? "ENOTDIR" : "ENOENT";
      e.path = spawnCwd;
      console.error(
        `[PtyManager] Refusing to spawn "${shell}" for session "${id}" — cwd ${reason}: "${spawnCwd}"`,
      );
      throw e;
    }

    // fd-leak guard: PTY ids are deterministic and reused verbatim on
    // restart/relaunch/reuse. If a LIVE session still occupies this id (a
    // caller that skipped kill(), or an old process racing the new spawn),
    // release its master fd BEFORE we overwrite the map slot — otherwise the
    // old node-pty is dereferenced with its fd still open and leaks until quit.
    // Also frees a slot in the pty pool before we allocate a new one.
    const stale = this.sessions.get(id);
    if (stale) {
      console.warn(
        `[PtyManager] create() reusing live id "${id}" — destroying stale PTY first (fd-leak guard)`,
      );
      // Take down the stale child's whole process SUBTREE, not just the direct
      // child. destroyProcess() only .destroy()s node-pty — which SIGHUPs the
      // direct child and releases the master fd — but never reaches DETACHED
      // grandchildren (Codex's out-of-group marblo MCP `dist-mcp/index.js`, the
      // bun-wrapped Telegram poller). Without a group/subtree signal those
      // reparent to launchd and pile up as orphans (MCP -32000 / getUpdates 409),
      // exactly the leak kill() already guards against. A caller re-create()ing a
      // live deterministic id (e.g. `agent-<id>`) without an intervening kill()
      // hits this path, so mirror kill(): subtree-signal first, then release fd.
      this.killProcessTree(stale.process.pid);
      this.destroyProcess(stale.process, stale.orphanFds);
      this.sessions.delete(id);
    }

    // Snapshot our open pty-master fds BEFORE spawning so we can attribute the
    // orphan fd node-pty is about to leak (see captureOrphanMasterFds). Taken
    // immediately before pty.spawn (a synchronous native call) so nothing else
    // can open an fd in between — the diff is exact.
    const beforeFds = this.snapshotCharDevFds();

    let proc: pty.IPty;
    try {
      proc = pty.spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: spawnCwd,
        env: env || (process.env as Record<string, string>),
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const msg = err instanceof Error ? err.message : String(err);
      // macOS caps live pty masters at kern.tty.ptmx_max (default 511). When
      // exhausted, openpty() returns ENXIO and node-pty surfaces it as the
      // opaque "posix_spawnp failed". This is almost always our own leaked
      // masters — sweep dead sessions now so a retry can succeed, and throw a
      // cause the caller/log can actually act on instead of a spawn riddle.
      if (
        code === "ENXIO" ||
        /ENXIO|posix_spawnp failed|openpty|out of pty|Device not configured/i.test(
          msg,
        )
      ) {
        console.error(
          `[PtyManager] PTY pool exhausted spawning "${shell}" (${
            code || "spawn error"
          }) — running reaper to reclaim leaked fds`,
        );
        this.reap();
        const e: NodeJS.ErrnoException = new Error(
          `PTY exhausted: the OS pseudo-terminal pool is full (likely leaked terminal sessions). Reclaimed dead sessions — retry. Original: ${msg}`,
        );
        e.code = code || "ENXIO";
        throw e;
      }
      console.error(
        `[PtyManager] Failed to spawn shell="${shell}" cwd="${spawnCwd}":`,
        err,
      );
      throw err;
    }

    const session: PtySession = {
      id,
      name,
      process: proc,
      shell,
      // Capture the orphan master fd node-pty just leaked (macOS only) so every
      // teardown path can reclaim it. Runs synchronously right after spawn while
      // the orphan is freshly open and unambiguously attributable to this call.
      orphanFds: this.captureOrphanMasterFds(beforeFds, proc),
    };
    this.sessions.set(id, session);
    // 세션 수명 동안 busy 신호 시계를 굴린다. 부작용은 Map 하나 갱신뿐이고,
    // submitWithRetry 가 CR 직전 베이스라인("이미 뜨거운 스트림인가")을 여기서
    // 읽는다 — 별도 대기창을 두지 않으므로 제출 지연이 0이다.
    this.lastBusySignalAt.delete(id);
    this.composer.forget(id);
    proc.onData((chunk: string) => {
      if (SUBMIT_SIGNAL.test(chunk)) this.lastBusySignalAt.set(id, Date.now());
      // 컴포저 판정의 출력측 증거. 같은 리스너에 얹어 청크당 순회를 늘리지 않는다.
      this.composer.observe(id, chunk);
    });
    return session;
  }

  /**
   * 제출 관측 구독. writeAndSubmit 1건이 끝날 때마다 3분기 판정이 흐른다.
   * ★반환값(boolean)은 바꾸지 않는다 — 이 훅은 **관측**이지 동작이 아니다.
   * 미제출 종결의 카운터/텔레메트리 노출은 티켓 s7NGFa8Ln82adxEggWBj 소관.
   */
  onSubmitOutcome(listener: (o: SubmitObservation) => void): () => void {
    this.submitOutcomeListeners.push(listener);
    return () => {
      this.submitOutcomeListeners = this.submitOutcomeListeners.filter(
        (l) => l !== listener,
      );
    };
  }

  /**
   * 지금 이 세션에 써도 되는가 (티켓 RtyOMpOArfI7a5JNSzsg).
   *
   * `writeAndSubmit` 이 내부적으로 이미 보지만, 호출부가 **쓰기 전에** 사유를
   * 알아야 하는 경우가 있다 — `InstructionDeliveryQueue` 는 이 판정으로 "시도
   * 예산을 태우지 않고 보류" 를 고른다(안 쓴 것은 실패한 시도가 아니다).
   */
  composerVerdict(id: string): ComposerVerdict {
    return this.composer.verdict(id);
  }

  /** 판정 단어만. */
  composerState(id: string): ComposerState {
    return this.composer.state(id);
  }

  /**
   * 컴포저가 **막힘 → 풀림** 으로 바뀌는 순간. 재시도 정책의 심장이다 —
   * 초안 작성자가 자기 손으로 제출하거나 다이얼로그를 닫으면 그때 알려 주므로,
   * 보류된 전달이 폴링 없이 되살아난다.
   */
  onComposerFree(listener: (sessionId: string) => void): () => void {
    return this.composer.onFree(listener);
  }

  /** 쓰지 않기로 한 사실을 관측 채널로 내보낸다. 조용한 거절은 없다. */
  private emitRefusal(
    id: string,
    text: string,
    gate: ComposerVerdict,
  ): void {
    this.emitSubmitOutcome({
      sessionId: id,
      outcome: "refused",
      attempts: 0,
      streamHotBeforeCr: false,
      textLength: text.length,
      composer: gate.state,
      refusal: gate.refusal ?? undefined,
      reason: gate.reason,
    });
  }

  private emitSubmitOutcome(o: SubmitObservation): void {
    if (o.outcome !== "confirmed") {
      console.warn(
        `[PtyManager] submit ${o.outcome} for ${o.sessionId} (attempts=${o.attempts}, len=${o.textLength}) — ${o.reason}`,
      );
    }
    for (const l of this.submitOutcomeListeners) {
      try {
        l(o);
      } catch (err) {
        console.error(
          `[PtyManager] onSubmitOutcome listener threw for ${o.sessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Subscribe to "a new turn was submitted on this session".
   *
   * Turn boundaries are anchored on INPUT, not output. Output tells you the
   * terminal is painting — a finished CLI sitting at its prompt repaints its
   * spinner and status line forever, which is precisely why output-derived
   * `working` never released (see agent-status-reconcile.ts). Input that ends
   * in a submit is the one unambiguous "new work starts now" signal, and it is
   * the same signal whether it came from dispatch, a nudge, a Telegram forward,
   * or a human typing into the terminal tab — so AgentManager gets a correct
   * turn start without every caller having to remember to announce one.
   */
  onSubmit(id: string, callback: () => void): void {
    const list = this.submitListeners.get(id) ?? [];
    list.push(callback);
    this.submitListeners.set(id, list);
  }

  private emitSubmit(id: string): void {
    const list = this.submitListeners.get(id);
    if (!list) return;
    for (const cb of list) {
      try {
        cb();
      } catch (err) {
        console.error(
          `[PtyManager] onSubmit listener threw for ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.write(data);
      // ★컴포저 판정의 입력측 증거. 사람이 터미널 탭에 친 키가 전부 이 경로로
      // 지나가므로, "쳤는데 아직 엔터를 안 눌렀다"(=초안이 물려 있다)를 화면을
      // 못 읽는 하네스에서도 안다.
      this.composer.noteInput(id, data);
      // Raw keystroke path (human typing in the terminal tab). Only a CR/LF
      // means the composed line was actually submitted — bare characters,
      // arrow keys and the like are still mid-composition, not a new turn.
      if (data.includes("\r") || data.includes("\n")) this.emitSubmit(id);
    }
  }

  /**
   * Write text and submit it as a discrete Enter keystroke.
   *
   * Writing `text + '\r'` in one chunk gets paste-buffered by Ink-based
   * CLIs (Claude Code, Gemini, Codex): the trailing CR gets folded into
   * the message body instead of submitting it.
   *
   * Two strategies:
   *   - `bracketedPaste: true` (default) — wrap text in ESC[200~ / ESC[201~
   *     paste markers so the TUI knows the text is a paste (no execution
   *     mid-text), then send `\r` after a delay so it registers as a
   *     separate keystroke that submits. Required for Gemini, which has
   *     a longer paste-buffer flush than Claude/Codex — without paste
   *     markers, the 150ms delay isn't enough and the CR gets buffered
   *     into the multi-line input. Most modern TUIs (Ink, Bubble Tea,
   *     ratatui) honor bracketed paste.
   *   - `bracketedPaste: false` — for CLIs that echo the escape bytes
   *     literally instead of interpreting them. Used for `custom` model
   *     agents where we can't assume terminal support.
   */
  writeAndSubmit(
    id: string,
    text: string,
    delayMs = 150,
    bracketedPaste = true,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve(false);

    // Safety guard: screen the payload for dangerous commands before it reaches
    // the PTY. Warn always; block high-severity only when policy is enabled.
    const match = detectDangerousCommand(text);
    if (match.matched) {
      const blocked =
        match.severity === "high" &&
        (this.blockDangerous || this.blockDangerousSessions.has(id));
      console.warn(
        `[PtyManager] dangerous command detected (${match.severity}: ${
          match.pattern
        }) for ${id}${blocked ? " — BLOCKED" : ""}`,
      );
      this.emitDanger({ sessionId: id, text, match, blocked });
      if (blocked) return Promise.resolve(false);
    }

    // ★주입 직전 컴포저 판정 (티켓 RtyOMpOArfI7a5JNSzsg). 오염돼 있으면 쓰지
    // 않는다 — 초안 뒤에 이어붙으면 한 덩어리로 제출돼 원문이 영영 도착하지 않고
    // ([y/n] 앞이면 첫 글자가 선택으로 소비되고), 그 사실은 반환값에도 로그에도
    // 안 남는다(#1160 S2·S5 실측).
    //
    // 큐가 비어 있을 때만 여기서 본다. 큐가 있으면 지금 화면은 앞 메시지가 쓰이기
    // **전**이라 지금 판정이 뒤 메시지의 처지를 말해 주지 않는다 — 그 경우는 아래
    // performWriteAndSubmit 이 자기 차례에 다시 본다. 여기서 먼저 걸러 두는 이유는
    // 오직 하나, 쓰지도 않을 턴을 emitSubmit 으로 선언하지 않기 위해서다.
    if (!this.writeAndSubmitQueues.has(id)) {
      const gate = this.composer.verdict(id);
      if (!gate.writable) {
        this.emitRefusal(id, text, gate);
        return Promise.resolve(false);
      }
    }

    // Every accepted writeAndSubmit IS a submitted turn (dispatch / reuse /
    // nudge / Telegram forward / pending instruction). Announce it SYNCHRONOUSLY
    // here rather than at flush time: submits queue behind one another, and a
    // turn that is announced only when its bytes reach the PTY leaves a window
    // where the agent still looks finished — so trailing repaint from the
    // PREVIOUS turn could be mistaken for this one, or the promotion arrives
    // late. Accepting the instruction is the moment the turn begins. Blocked
    // payloads returned above, so they never get here.
    this.emitSubmit(id);

    const previous = this.writeAndSubmitQueues.get(id) ?? Promise.resolve(true);
    const next = previous
      .catch(() => {
        // Keep later writes moving even if an earlier queued submit failed.
        return false;
      })
      .then(() =>
        this.performWriteAndSubmit(id, session, text, delayMs, bracketedPaste),
      );

    const guarded = next
      .catch((err: unknown) => {
        console.error(
          `[PtyManager] writeAndSubmit failed for ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return false;
      })
      .finally(() => {
        if (this.writeAndSubmitQueues.get(id) === guarded) {
          this.writeAndSubmitQueues.delete(id);
        }
      });
    this.writeAndSubmitQueues.set(id, guarded);
    return guarded;
  }

  private async performWriteAndSubmit(
    id: string,
    session: PtySession,
    text: string,
    delayMs: number,
    bracketedPaste: boolean,
  ): Promise<boolean> {
    if (this.sessions.get(id) !== session) return false;

    // ★자기 차례가 온 지금 다시 본다. 큐에서 기다리는 동안 앞 메시지가 컴포저에
    // 남았을 수도, 사람이 타이핑을 시작했을 수도, 다이얼로그가 떴을 수도 있다.
    const gate = this.composer.verdict(id);
    if (!gate.writable) {
      this.emitRefusal(id, text, gate);
      return false;
    }

    if (bracketedPaste) {
      session.process.write(`\x1b[200~${text}\x1b[201~`);
    } else {
      session.process.write(text);
    }
    // 우리가 넣은 본문도 입력측 증거다 — CR 이 끝내 안 먹히면 이 텍스트가 그대로
    // 컴포저에 남고, 그때 다음 주입을 막는 것이 바로 이 표시다.
    this.composer.noteInput(id, text);

    // The trailing CR must register as a DISCRETE submit keystroke. A single
    // fixed gap is a timing race: under load (busy Electron main loop, many
    // agents streaming PTY output) the CR can get folded into the paste
    // buffer as a newline, leaving the message sitting in the composer
    // unsubmitted — the user then has to press Enter manually. So instead of
    // trusting one gap, send the CR, watch the PTY for a submit signal, and
    // resend the CR if the agent didn't react.
    await this.sleep(delayMs);

    // ★CR 을 보내기 **직전**의 베이스라인. 이 스트림이 이미 busy 신호를 뱉고
    // 있었다면, CR 직후에 보이는 신호는 우리 CR 의 반응이 아닐 수 있다 —
    // 그 구간을 '확인됨' 으로 부르면 유실이 은폐된다(SubmitOutcome 참조).
    const hotAt = this.lastBusySignalAt.get(id);
    const streamHotBeforeCr =
      typeof hotAt === "number" &&
      Date.now() - hotAt <= PtyManager.SUBMIT_VERIFY_MS;

    const res = await this.submitWithRetry(
      id,
      session,
      0,
      // 신호를 신뢰할 수 없으면 조기 종료하지 않는다: CR 예산을 끝까지 쓴다.
      // 이미 제출됐거나 빈 컴포저에 떨어지는 CR 은 우리가 모는 TUI 에서 no-op
      // 이므로(아래 submitWithRetry 주석) 더 보내는 쪽이 안전하다 — 실제로
      // 첫 CR 이 paste 버퍼에 접혀 들어간 경우 이 추가 CR 이 유일한 구제책이다.
      !streamHotBeforeCr,
    );

    const outcome: SubmitOutcome = streamHotBeforeCr
      ? "indeterminate"
      : res.sawSignal
        ? "confirmed"
        : "unconfirmed";
    this.emitSubmitOutcome({
      sessionId: id,
      outcome,
      attempts: res.attempts,
      streamHotBeforeCr,
      textLength: text.length,
      reason: streamHotBeforeCr
        ? `CR 직전 ${PtyManager.SUBMIT_VERIFY_MS}ms 안에 이미 busy 신호가 흐르고 ` +
          `있었다 — CR 이후의 신호를 우리 제출의 반응으로 귀속시킬 수 없다. ` +
          `CR 을 ${res.attempts}회 보냈으나 제출 여부는 미확인(전달됐을 수도, ` +
          `컴포저에 남았을 수도 있다)`
        : res.sawSignal
          ? `CR 직전에는 조용했고 ${res.attempts}회째 CR 직후 busy 신호가 ` +
            `나타났다 — 우리 CR 이 턴을 시작시켰다`
          : `CR 을 ${res.attempts}회 보냈으나 busy 신호가 끝내 없었다 — ` +
            `메시지가 컴포저에 미제출로 남아 있을 가능성이 높다`,
    });
    return res.delivered;
  }

  // Max number of CR (Enter) keystrokes to send before giving up.
  private static readonly SUBMIT_MAX_ATTEMPTS = 3;
  // How long to watch PTY output for a submit signal after each CR.
  private static readonly SUBMIT_VERIFY_MS = 600;

  /**
   * Send a CR to the session, then verify the agent actually started a turn.
   * Resends (up to SUBMIT_MAX_ATTEMPTS) if no submit signal is observed.
   * A redundant CR landing on an already-submitted/empty composer is a
   * no-op for the TUIs we drive, so over-sending is safe.
   *
   * `trustSignal` — false 면 CR 직후에 본 busy 신호를 **제출의 증거로 인정하지
   * 않는다**(스트림이 이미 뜨거웠다는 뜻). 관측은 그대로 기록하되 조기 종료를
   * 막아 CR 예산을 끝까지 쓴다. 종전 동작은 trustSignal=true 와 동일하다.
   */
  private submitWithRetry(
    id: string,
    session: PtySession,
    attempt: number,
    trustSignal: boolean,
    sawSignalSoFar = false,
  ): Promise<{ delivered: boolean; attempts: number; sawSignal: boolean }> {
    if (this.sessions.get(id) !== session) {
      return Promise.resolve({
        delivered: false,
        attempts: attempt,
        sawSignal: sawSignalSoFar,
      });
    }

    return new Promise((resolve) => {
      let reacted = false;
      const disposable = session.process.onData((chunk: string) => {
        if (SUBMIT_SIGNAL.test(chunk)) reacted = true;
      });

      session.process.write("\r");
      // CR = 제출 시도. 입력측 표시를 지운다(composer-gate 헤더의 "★CR 을 쓰면
      // 입력측 표시를 지운다" 참조 — 이후의 진실은 화면이 말한다).
      this.composer.noteInput(id, "\r");
      const attempts = attempt + 1;

      setTimeout(() => {
        disposable.dispose();
        const sawSignal = sawSignalSoFar || reacted;
        if (reacted && trustSignal) {
          if (attempt > 0) {
            console.log(
              `[PtyManager] submit confirmed for ${id} after ${attempt} retr${
                attempt === 1 ? "y" : "ies"
              }`,
            );
          }
          resolve({ delivered: true, attempts, sawSignal });
          return;
        }
        if (this.sessions.get(id) !== session) {
          resolve({ delivered: false, attempts, sawSignal });
          return;
        }
        if (attempts < PtyManager.SUBMIT_MAX_ATTEMPTS) {
          if (trustSignal) {
            console.warn(
              `[PtyManager] Enter not registered for ${id} (attempt ${attempts}/${PtyManager.SUBMIT_MAX_ATTEMPTS}) — resending CR`,
            );
          }
          void this.submitWithRetry(
            id,
            session,
            attempts,
            trustSignal,
            sawSignal,
          ).then(resolve);
        } else {
          if (trustSignal) {
            console.error(
              `[PtyManager] Enter still not registered for ${id} after ${PtyManager.SUBMIT_MAX_ATTEMPTS} attempts — message may be sitting unsubmitted in the composer`,
            );
          }
          // The text payload was already written to the PTY. Reporting false
          // here would make at-least-once callers redeliver the same text into
          // the composer, creating duplicate inbound messages. Treat this as a
          // write delivery and let TelegramPoller's unanswered-reply nudge flag
          // a stuck orchestrator turn if no send_telegram_message follows.
          // ★이 트레이드오프는 그대로 유지한다 — 다만 이제 조용하지 않다:
          // 위 emitSubmitOutcome 이 unconfirmed/indeterminate 를 밖으로 알린다.
          resolve({ delivered: true, attempts, sawSignal });
        }
      }, PtyManager.SUBMIT_VERIFY_MS);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.resize(cols, rows);
    }
  }

  // Grace before SIGKILL-sweeping a killed PTY's process group. Sized to the
  // Telegram channel poller's own ~2s self-shutdown budget (server.ts force-
  // exits 2s after SIGTERM) so a clean graceful exit — which releases the
  // getUpdates long-poll slot — wins the race before we force-kill any
  // straggler in the group.
  private static readonly TREE_KILL_ESCALATE_MS = 2500;

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      // Take down the whole PTY SUBTREE (child + grandchildren), not just the
      // single child pid that node-pty's own .kill() signals. See
      // killProcessTree — this is what stops an orchestrator's Telegram poller
      // from orphaning across a stop/restart and 409-blocking the next one.
      this.killProcessTree(session.process.pid);
      // Release the MASTER FDs. node-pty's own .kill() ONLY sends a signal — it
      // never closes any fd — so we call .destroy() (via destroyProcess), which
      // closes the read stream (proc.fd) and, in destroyProcess, closes the
      // orphan master fd too. destroy() also SIGHUPs the direct child once the
      // socket closes, so the child signal is covered.
      this.destroyProcess(session.process, session.orphanFds);
      this.sessions.delete(id);
      this.blockDangerousSessions.delete(id);
      this.submitListeners.delete(id);
      this.lastBusySignalAt.delete(id);
      this.composer.forget(id);
    }
  }

  /**
   * Release a node-pty's OS resources — critically the pseudo-terminal MASTER
   * fd. node-pty 1.1.0's `.kill()` only signals the child; `.destroy()` is the
   * sole method that closes the read stream (freeing the fd) and disposes the
   * write stream. The `IPty` public type doesn't declare `destroy()` (it lives
   * on the concrete UnixTerminal), so we reach it through a guarded cast and
   * fall back to `.kill()` if it's ever absent. Idempotent and error-swallowing:
   * destroying an already-dead/closed pty is a harmless no-op.
   */
  private destroyProcess(proc: pty.IPty, orphanFds?: OrphanFd[]): void {
    try {
      const destroy = (proc as unknown as { destroy?: () => void }).destroy;
      if (typeof destroy === "function") {
        destroy.call(proc);
      } else {
        proc.kill();
      }
    } catch {
      // Already dead / socket already closed — fd release is idempotent.
    }
    // node-pty's `.destroy()` closes the master fd it TRACKS (`proc.fd`, wrapped
    // by its read stream) but NOT the SECOND /dev/ptmx master it opens at spawn
    // and never exposes (the "orphan" — see captureOrphanMasterFds). That orphan
    // is what actually leaks against macOS `kern.tty.ptmx_max` on every teardown
    // (verified: .kill() and .destroy() both leave exactly 1 orphan per session).
    // Close it here, on every teardown path. Outside the try above and self-
    // guarded so a destroy() throw can't skip it and a double teardown is a no-op.
    this.releaseOrphanMasterFds(orphanFds);
  }

  // On macOS a device number packs major in the high 8 bits: major = rdev >> 24.
  // Bit ops in JS coerce to int32; a pty master's rdev (major 15 → ~2.5e8) fits,
  // but use integer division to stay safe if the packing ever widens.
  private static deviceMajor(rdev: number): number {
    return Math.floor(rdev / 0x1000000) & 0xff;
  }

  /**
   * Snapshot this process's currently-open CHARACTER-device fds as an fd→rdev
   * map. Cheap: one readdir of /dev/fd plus an fstat per fd. Used to diff the
   * open-fd set across a pty.spawn so the newly-appearing pty master(s) can be
   * attributed to a specific session. macOS-only — the orphan-fd leak is a macOS
   * /dev/ptmx behavior, and gating here makes the whole mechanism a no-op on
   * other platforms (returns an empty map, so nothing is ever captured/closed).
   */
  private snapshotCharDevFds(): Map<number, number> {
    const snap = new Map<number, number>();
    if (process.platform !== "darwin") return snap;
    let names: string[];
    try {
      names = fs.readdirSync("/dev/fd");
    } catch {
      return snap;
    }
    for (const name of names) {
      const fd = Number(name);
      if (!Number.isInteger(fd)) continue;
      try {
        const st = fs.fstatSync(fd);
        if (st.isCharacterDevice()) snap.set(fd, st.rdev);
      } catch {
        // fd closed between readdir and fstat (e.g. /dev/fd's own dir handle).
      }
    }
    return snap;
  }

  /**
   * Identify the orphaned pty MASTER fd(s) a spawn just leaked: character-device
   * fds that (a) share `proc.fd`'s device MAJOR (so we never touch an unrelated
   * char device like /dev/null), and (b) are NEW relative to `before` — absent,
   * or present but with a DIFFERENT rdev (an fd number the OS recycled into a
   * fresh pty device across the spawn). `proc.fd` itself is excluded: node-pty
   * tracks and closes it via `.destroy()`. Comparing the (fd, rdev) pair rather
   * than the bare fd number is what makes recycled fd numbers attributable.
   *
   * The major is read from `proc.fd` at capture time (self-calibrating — no
   * hardcoded device number), so it survives node-pty patch bumps. `fd` and
   * `destroy` are not on node-pty's public `IPty` type (they live on the
   * concrete UnixTerminal), so both are reached through guarded casts.
   */
  private captureOrphanMasterFds(
    before: Map<number, number>,
    proc: pty.IPty,
  ): OrphanFd[] {
    if (process.platform !== "darwin") return [];
    const procFd = (proc as unknown as { fd?: number }).fd;
    if (typeof procFd !== "number" || !Number.isInteger(procFd)) return [];
    let masterMajor: number;
    try {
      masterMajor = PtyManager.deviceMajor(fs.fstatSync(procFd).rdev);
    } catch {
      return [];
    }
    const orphans: OrphanFd[] = [];
    for (const [fd, rdev] of this.snapshotCharDevFds()) {
      if (fd === procFd) continue;
      if (PtyManager.deviceMajor(rdev) !== masterMajor) continue;
      if (before.get(fd) === rdev) continue; // unchanged device → pre-existing
      orphans.push({ fd, rdev });
    }
    return orphans;
  }

  /**
   * Close the orphan master fd(s) captured for a session, reclaiming the
   * /dev/ptmx slot node-pty leaks per teardown. Self-guarding and idempotent:
   * each fd is re-fstat'd and closed ONLY while it is still the exact same
   * character device (rdev match) captured at spawn — so an fd number the OS has
   * since recycled is never wrongly closed — and the list is emptied after, so a
   * second teardown (kill() then a late onExit, or the reaper) is a harmless
   * no-op. Errors (EBADF on an already-closed fd) are swallowed.
   */
  private releaseOrphanMasterFds(orphanFds?: OrphanFd[]): void {
    if (!orphanFds || orphanFds.length === 0) return;
    for (const { fd, rdev } of orphanFds) {
      try {
        const st = fs.fstatSync(fd);
        if (st.isCharacterDevice() && st.rdev === rdev) {
          fs.closeSync(fd);
        }
      } catch {
        // EBADF (already closed) or fd recycled into a non-matching device —
        // nothing of ours to reclaim.
      }
    }
    orphanFds.length = 0;
  }

  /**
   * Terminate the ENTIRE process group of a PTY child — the child plus every
   * descendant it spawned — instead of the lone child pid.
   *
   * Why: node-pty spawns each PTY via forkpty(), which setsid()s the child into
   * a fresh session, making it its own process-GROUP leader (pgid === pid).
   * Every process the child then spawns (an agent/orchestrator's MCP servers,
   * e.g. the Telegram channel poller `bun server.ts`) inherits that group.
   * node-pty's own `.kill()` runs `process.kill(pid, 'SIGHUP')` — a single
   * POSITIVE pid — so it signals only the child; reaping the grandchildren is
   * left to the kernel's fragile "controlling-process exit → SIGHUP the
   * foreground process group" propagation. When that misses (the poller sits
   * behind the `bun run` wrapper chain), the poller lives on as an orphan and
   * keeps holding Telegram's single-consumer getUpdates slot, so the next
   * orchestrator's poller gets 409 Conflict and inbound silently dies.
   * Signalling the GROUP (a NEGATIVE pid) takes the whole subtree down
   * deterministically with the orchestrator.
   *
   * Group kill alone is NOT enough (ticket cgzUJYRv): Codex spawns its marblo
   * MCP server (`dist-mcp/index.js`) DETACHED into its OWN process group, so a
   * `kill(-pgid)` scoped to the PTY child's group never reaches it — it survives
   * teardown, reparents to launchd (ppid=1), and piles up as an orphan. So we
   * ALSO walk the ppid subtree (captured here, while the CLI is still alive and
   * the detached grandchild is still a ppid-descendant) and signal each pid
   * DIRECTLY by its positive pid. In-group pids get signalled twice — harmless
   * (idempotent, ESRCH-safe); the point is the out-of-group ones.
   *
   * Scope (critical): pgid === pid means `-pid` targets ONLY this PTY's own
   * subtree. The Electron main process and every OTHER agent/orchestrator PTY
   * live in different process groups (each its own setsid session), so they are
   * untouched. The positive-pid signals are likewise confined to descendants of
   * THIS pty child. The `pid > 1` / integer guard is load-bearing: `process.kill(-0)`
   * would signal the CALLER's entire group (Electron + all agents) and `-1`
   * would broadcast system-wide — never allow either.
   */
  private killProcessTree(pid: number | undefined): void {
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return;

    // Snapshot the ppid subtree NOW, before any signal — once the CLI dies its
    // detached MCP grandchild reparents to launchd and is no longer reachable by
    // walking down from `pid`. win32 has no process groups / ps -Ao; skip there.
    const descendants =
      process.platform === "win32"
        ? []
        : collectDescendants(readProcTree(), pid).filter(
            (d) => Number.isInteger(d) && d > 1,
          );

    // Graceful first: SIGTERM the group so the Telegram poller runs its own
    // shutdown (release the getUpdates long-poll, remove its pidfile) — this is
    // what keeps the handoff window short enough for the new poller to self-heal.
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // ESRCH (group already gone) / EPERM — nothing left to signal.
    }
    for (const d of descendants) {
      try {
        process.kill(d, "SIGTERM");
      } catch {
        // Already gone / not ours — nothing to signal.
      }
    }

    // Escalate: SIGKILL anything still alive in the group AND any straggling
    // descendant (e.g. Codex's detached dist-mcp) after the poller's graceful-
    // exit budget. Same scoping; unref so a pending sweep never keeps the event
    // loop (or app shutdown) alive.
    const sweep = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Group already reaped — expected on the happy path.
      }
      for (const d of descendants) {
        try {
          process.kill(d, "SIGKILL");
        } catch {
          // Descendant already reaped — expected on the happy path.
        }
      }
    }, PtyManager.TREE_KILL_ESCALATE_MS);
    sweep.unref?.();
  }

  listSessions(): { id: string; name: string }[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  /**
   * True when a live PTY session still occupies this id.
   *
   * Callers that decide "can I reuse the running process instead of respawning
   * it?" cannot trust a cached status alone: onExit evicts the session here
   * before the owner's status listener necessarily runs, so a session can read
   * "running" while its PTY is already gone. Check this before handing a
   * ptySessionId back as reusable.
   */
  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * This session's PTY child pid, or null when there is no such session.
   *
   * Exposed for the watchdog's ACTIVE PROBE (티켓 DQYoyas3ESx33zXJOCOa): the
   * probe asks the OS whether the pid still exists (`process.kill(pid, 0)`) and
   * how much CPU it has burned, instead of typing anything into the terminal.
   *
   * ★Why the probe reads a pid instead of writing a keystroke: writeAndSubmit
   * below sends the text and then fires CR up to three times **without first
   * checking what is already sitting in the CLI's input buffer**. So a
   * "harmless empty Enter" does not exist — it can submit a half-typed draft or
   * resolve a [y/n] dialog the user never answered. A pid read is the same
   * question ("are you alive?") asked of the kernel instead of the agent, and
   * it cannot perturb the session at all. See agent-stall-policy.ts for the
   * full rejection rationale of the keystroke-probe design.
   */
  getPid(id: string): number | null {
    const pid = this.sessions.get(id)?.process.pid;
    return typeof pid === "number" && Number.isInteger(pid) ? pid : null;
  }

  onData(id: string, callback: (data: string) => void): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.onData(callback);
    }
  }

  onExit(id: string, callback: (exitCode: number) => void): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.onExit(({ exitCode }) => {
        // PTY ids are deterministic (`agent-<id>`) and reused verbatim on
        // restart, so a killed OLD process can fire its onExit AFTER a fresh
        // session has already claimed the same id. Evict the map entry only
        // when THIS exact session still occupies the id — comparing by id
        // string alone would delete the replacement, orphaning its live
        // process and silently dropping every subsequent write()/writeAndSubmit().
        if (this.sessions.get(id) === session) {
          this.sessions.delete(id);
          this.submitListeners.delete(id);
          this.lastBusySignalAt.delete(id);
          this.composer.forget(id);
        }
        // The child is gone. node-pty MAY release the master fd via its own
        // exit→socket-destroy timeout, but that path is best-effort on macOS
        // ("sometimes the socket never gets closed"). Force it: destroy() this
        // exact (possibly-stale) session so its master fds can't outlive the
        // child. Safe even when the id was already reclaimed by a new session —
        // we destroy the captured OLD `session` object, never the replacement.
        this.destroyProcess(session.process, session.orphanFds);
        callback(exitCode);
      });
    }
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }

  /**
   * Start a periodic sweep that destroys sessions whose child process has died
   * but whose map entry (and thus master fd) lingered — e.g. an onExit that
   * never fired because the read stream stayed paused. Belt-and-suspenders on
   * top of the explicit destroy() in kill()/onExit(); idempotent, so calling it
   * once at app startup is enough. The interval is unref'd so it never keeps the
   * event loop (or app shutdown) alive.
   */
  startReaper(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(
      () => this.reap(),
      PtyManager.REAP_INTERVAL_MS,
    );
    this.reaperTimer.unref?.();
  }

  stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  /**
   * Sweep sessions whose child pid is confirmed dead (process.kill(pid, 0)
   * throws ESRCH) and release their leaked master fd. Conservative: only ESRCH
   * (definitely gone) triggers a destroy — EPERM or a pid the OS has since
   * recycled reads as "alive" and is left untouched, so we never wrongfully
   * destroy a live session. Also invoked synchronously when create() hits an
   * exhausted pty pool, to reclaim slots before failing.
   */
  private reap(): void {
    for (const [id, session] of this.sessions) {
      const pid = session.process.pid;
      if (typeof pid !== "number" || !Number.isInteger(pid)) continue;
      let dead = false;
      try {
        process.kill(pid, 0); // probe only — throws ESRCH if the pid is gone
      } catch (err) {
        dead = (err as NodeJS.ErrnoException)?.code === "ESRCH";
      }
      if (dead) {
        console.warn(
          `[PtyManager] reaper: session "${id}" child pid ${pid} is dead — releasing leaked PTY fd`,
        );
        this.destroyProcess(session.process, session.orphanFds);
        this.sessions.delete(id);
        this.composer.forget(id);
      }
    }
  }
}
