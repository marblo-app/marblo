/**
 * 에이전트 정지 의심(stall) 정책 — 순수 모듈. Electron/Firestore 의존 없음.
 *
 * 세 곳이 **같은 상수·같은 판정**을 읽는다:
 *   · 워치독(agent-watchdog.ts)            — "조용하다" 신호를 오케에게 올릴 때
 *   · dispatch(bridge-server.ts)            — 바운드 에이전트를 우회해도 되는지
 *   · 렌더러 정체 레인(src/lib/stuckLane.ts) — STALE(no-progress) 판정
 * 셋이 다른 숫자를 보면 보드는 정체라는데 오케는 못 듣고, 오케가 재배정하는데
 * dispatch 는 "live" 라며 되돌려보낸다 — 2026-08-22 배포 정지 건이 정확히 그
 * 조합이었다(80분 무활동 · 보드 working · dispatch_task "live activity evidence").
 *
 * ★설계 원칙(사장님 말씀 그대로): "일정시간 멈추면 워치독이 체크가 되서 일중인지
 *   죽은건지 판단이 되도록해서 **오케가 판단 후** 새로 스폰하거나". 이 모듈은
 *   **판정 재료**만 만든다. 죽일지 기다릴지는 맥락을 아는 쪽(오케/사람)이 정한다.
 *   여기 어떤 함수도 kill/respawn 을 결정하지 않는다.
 *
 * ★생존 ≠ 진행. 판정 축은 **보드 활동**(add_activity/상태전이가 찍는
 *   projection.lastActivityAt)이다. PTY 는 생존 증거일 뿐 진행 증거가 아니다 —
 *   스피너("esc to interrupt")를 그리는 CLI 는 툴 호출이 행(hang)해도 영원히
 *   바이트를 뱉고, 오늘(2026-08-22)도 어제(solar-pro4)도 프로세스는 살아 있었다.
 *   PTY 상태는 신호의 **설명**(busy/parked/awaiting-input/silent)으로만 붙여
 *   오케가 "열심히 일하는 중" 과 "서 있는 중" 을 구분할 수 있게 한다.
 */

// ── 무활동 임계 ─────────────────────────────────────────────────────────
//
// 왜 하나가 아니라 둘인가:
//   · 실측 보고 주기: 살아서 일하는 워커는 add_activity 를 2~11분 간격으로
//     남긴다(2026-07-18 실측, agent-watchdog.ts inProgressOrphanResetMs 주석).
//     역할 스킬도 "every meaningful step 을 add_activity" 로 요구한다.
//   · 오늘 비용: P0 프로덕션 배포가 80분 무활동. 배포 자체는 5~10분 일이다.
//     "30분쯤 조용하면 알려달라" 가 오케의 요구였다.
//   · 오판 비용: 버그 재현·대규모 리팩터·벤치 실행은 보고 없이 30분을 넘길 수
//     있다. 이 신호는 킬이 아니라 **알림**이지만, 알림도 잦으면 신뢰를 잃는다.
//   그래서 긴급(P4–P5)은 실측 최대 보고 간격(11분)의 약 2배인 20분, 일반(P1–P3)은
//   정체 레인이 이미 쓰던 30분보다 보수적인 45분으로 가른다. 같은 신호가 보드에도
//   오케에도 **같은 시각**에 뜨도록 정체 레인도 이 값을 쓴다.
//   값은 env 로 덮어쓸 수 있다(resolveStallPolicy) — 숫자 논쟁은 배포 없이 끝낸다.

/** 이 우선순위 이상이면 '긴급' 임계를 쓴다. Task.priority 는 1~5, 5 가 최고. */
export const STALL_URGENT_PRIORITY_MIN = 4;
/** 긴급(P4–P5) 티켓: 보드 무활동 20분이면 신호. */
export const STALL_QUIET_URGENT_MS = 20 * 60_000;
/** 일반(P1–P3) 티켓: 보드 무활동 45분이면 신호. */
export const STALL_QUIET_NORMAL_MS = 45 * 60_000;
/**
 * 같은 티켓에 신호를 다시 올리기까지의 최소 간격. 한 번 올렸는데 오케가
 * "기다린다" 고 결정했을 수 있다 — 1분마다 다시 물으면 그 결정을 무시하는
 * 것이다. 30분 뒤에도 여전히 조용하면 한 번 더 올린다.
 */
export const STALL_SIGNAL_REPEAT_MS = 30 * 60_000;
/**
 * PTY 가 "방금까지 일하고 있었다" 로 볼 work-output 창. 스트리밍 응답·툴 로그가
 * 이 안에 있으면 busy. 값은 고정 상수로 둔다 — 신호의 설명용이지 판정이 아니다.
 */
export const STALL_PTY_BUSY_RECENT_MS = 2 * 60_000;

// ── W8 보강(2026-08-23, 티켓 O1OQKukSSCmMaJCoGHGP) — time-to-first-activity 축 ──
//
// 위 STALL_QUIET_* 는 "11분마다 보고하다 멈춘 에이전트" 를 재는 자다(실측 최대
// 보고 *간격* 의 2배). 스폰 후 **한 번도 보고한 적 없는** 에이전트를 같은 자로
// 재는 건 범주 오류다 — MiniMax-M3 사례(2026-08-23)가 정확히 이거다: activity
// 0건으로 멈췄는데 20분 임계 전이라 아무 신호도 안 올랐다.
//
// 살아서 일하는 워커의 *첫* 보고는 반복 보고 간격(2~11분)보다도 빨라야 정상이다
// — 반복 간격은 "다음 작업을 하는 동안"의 텀이고, 첫 보고 전엔 그런 텀이 없다.
// 사다리의 born-dead 단(agent-watchdog.ts firstActivityGraceMs)이 이미 3분을
// 쓰고 있지만 그 값은 respawn 이라는 무거운 행동을 잠그는 값이라 보수적으로
// 잡혔다. 이 신호는 **행동을 하나도 안 하므로**(신호만) 오판 비용이 훨씬 싸다 —
// 권고 범위(3~5분)의 상단인 5분을 택한다: 사다리가 3분에 이미 respawn 을
// 시도했을 가능성이 있으니, 신호가 5분에 뜨면 오케가 "사다리가 이미 손댔는지"
// 함께 확인할 여지가 생긴다. env 로 덮어쓸 수 있다.
export const STALL_FIRST_ACTIVITY_QUIET_MS = 5 * 60_000;

export type StallTier = "urgent" | "normal";

export interface StallPolicy {
  urgentPriorityMin: number;
  quietUrgentMs: number;
  quietNormalMs: number;
  repeatMs: number;
  /** W8 보강: 스폰(또는 재배정) 이후 첫 보드 활동이 이 안에 없으면 신호.
   * 우선순위로 가르지 않는다 — 스폰 오버헤드는 티켓 종류와 무관한 공통
   * 비용이라, 급한 일이든 아니든 "아예 시작을 못 했다" 는 똑같이 이르게 알
   * 가치가 있다. */
  firstActivityQuietMs: number;
}

export const DEFAULT_STALL_POLICY: StallPolicy = {
  urgentPriorityMin: STALL_URGENT_PRIORITY_MIN,
  quietUrgentMs: STALL_QUIET_URGENT_MS,
  quietNormalMs: STALL_QUIET_NORMAL_MS,
  repeatMs: STALL_SIGNAL_REPEAT_MS,
  firstActivityQuietMs: STALL_FIRST_ACTIVITY_QUIET_MS,
};

function intEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** env 덮어쓰기: MARBLO_STALL_QUIET_URGENT_MS / _NORMAL_MS / _REPEAT_MS /
 * _URGENT_PRIORITY_MIN / _FIRST_ACTIVITY_MS. */
export function resolveStallPolicy(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {}
): StallPolicy {
  const d = DEFAULT_STALL_POLICY;
  return {
    urgentPriorityMin: intEnv(
      env,
      "MARBLO_STALL_URGENT_PRIORITY_MIN",
      d.urgentPriorityMin
    ),
    quietUrgentMs: intEnv(env, "MARBLO_STALL_QUIET_URGENT_MS", d.quietUrgentMs),
    quietNormalMs: intEnv(env, "MARBLO_STALL_QUIET_NORMAL_MS", d.quietNormalMs),
    repeatMs: intEnv(env, "MARBLO_STALL_REPEAT_MS", d.repeatMs),
    firstActivityQuietMs: intEnv(
      env,
      "MARBLO_STALL_FIRST_ACTIVITY_MS",
      d.firstActivityQuietMs
    ),
  };
}

/** 우선순위 → 티어. priority 가 없거나 숫자가 아니면 일반으로 본다(보수 쪽). */
export function stallTier(
  priority: number | null | undefined,
  policy: StallPolicy = DEFAULT_STALL_POLICY
): StallTier {
  return typeof priority === "number" &&
    Number.isFinite(priority) &&
    priority >= policy.urgentPriorityMin
    ? "urgent"
    : "normal";
}

/** 우선순위 → 무활동 임계(ms). */
export function quietThresholdMs(
  priority: number | null | undefined,
  policy: StallPolicy = DEFAULT_STALL_POLICY
): number {
  return stallTier(priority, policy) === "urgent"
    ? policy.quietUrgentMs
    : policy.quietNormalMs;
}

export interface BoardQuietVerdict {
  quiet: boolean;
  /** 마지막 보드 활동 이후 경과(ms). 활동 기록이 없으면 기준 시각부터. */
  quietMs: number;
  thresholdMs: number;
  tier: StallTier;
}

/**
 * 보드 활동만으로 "조용하다" 를 판정한다. PTY 는 보지 않는다(위 헤더 참조).
 *
 * `lastBoardActivityMs` 가 null 이면(활동 기록이 아직 없는 갓 배정 티켓)
 * `activeSinceMs`(claimedAt 등)를 기준으로 센다 — 없으면 판정 불가 → quiet=false.
 * "기준이 없으니 조용하다" 로 기울지 않는다: 오판이 더 비싸다.
 */
export function evaluateBoardQuiet(input: {
  now: number;
  lastBoardActivityMs: number | null;
  activeSinceMs?: number | null;
  priority?: number | null;
  policy?: StallPolicy;
}): BoardQuietVerdict {
  const policy = input.policy ?? DEFAULT_STALL_POLICY;
  const tier = stallTier(input.priority, policy);
  const thresholdMs = quietThresholdMs(input.priority, policy);
  const base = input.lastBoardActivityMs ?? input.activeSinceMs ?? null;
  if (base === null || !Number.isFinite(base)) {
    return { quiet: false, quietMs: 0, thresholdMs, tier };
  }
  const quietMs = Math.max(0, input.now - base);
  return { quiet: quietMs >= thresholdMs, quietMs, thresholdMs, tier };
}

export interface FirstActivityQuietVerdict {
  quiet: boolean;
  /** 기준 시각(activeSinceMs) 이후 경과(ms). 이미 활동 기록이 있으면 0. */
  ageMs: number;
  thresholdMs: number;
}

/**
 * "스폰(또는 재배정) 이후 보드 활동이 단 한 건도 없다" 만 판정한다 —
 * evaluateBoardQuiet 과 달리 *재* 무활동(한동안 보고하다 멈춤)은 이 축이
 * 아니다. `lastBoardActivityMs` 가 non-null 이면(과거 어느 시점에라도 실활동이
 * 있었다면) 무조건 quiet=false — 그 티켓은 evaluateBoardQuiet 의 몫이다.
 *
 * ★워치독 프로세스가 티켓을 "언제 처음 관측했는지" 에 기대지 않는다(그건 앱
 * 재시작·늦은 관측 시점에 따라 달라지는 워치독 쪽 사정이지 티켓 쪽 사실이
 * 아니다). 대신 보드 자체의 사실 — 활동 기록이 아예 없다 — 로만 판정해서,
 * "이미 30분 전에 배정된 티켓을 워치독이 지금 막 보기 시작했다" 같은 경우를
 * "방금 스폰돼서 5분간 조용하다" 로 오판하지 않는다.
 */
export function evaluateFirstActivityQuiet(input: {
  now: number;
  lastBoardActivityMs: number | null;
  activeSinceMs?: number | null;
  policy?: StallPolicy;
}): FirstActivityQuietVerdict {
  const policy = input.policy ?? DEFAULT_STALL_POLICY;
  const thresholdMs = policy.firstActivityQuietMs;
  if (input.lastBoardActivityMs !== null) {
    return { quiet: false, ageMs: 0, thresholdMs };
  }
  const base = input.activeSinceMs ?? null;
  if (base === null || !Number.isFinite(base)) {
    return { quiet: false, ageMs: 0, thresholdMs };
  }
  const ageMs = Math.max(0, input.now - base);
  return { quiet: ageMs >= thresholdMs, ageMs, thresholdMs };
}

// ── W8 보강 — exit(사망) 신호 ────────────────────────────────────────────
//
// agent-manager.ts 는 PTY onExit 에서 이미 `status`(stopped|error) 와
// `lastExitCode` 를 확정한다 — "죽었는가" 는 이미 아는 사실이다. 그런데 종전
// quiet 판정은 보드 무활동 나이만 보고, 확정적으로 죽은 프로세스도 무활동
// 임계(20/45분)를 기다렸다. 죽음은 추론이 아니라 사실이다 — 알게 된 즉시
// 올린다(thresholdMs=0). repeatMs 재알림 리밋은 그대로 적용된다: 같은 사망을
// 매 sweep 마다 다시 올리지는 않는다.
export interface ExitQuietVerdict {
  quiet: true;
  /** 로컬에서 관측한 PTY exit code. 모르면 null. */
  exitCode: number | null;
  /** 프로세스가 종료된 것으로 확정된 시각(terminalSinceMs) 이후 경과(ms).
   * 그 시각을 모르면 마지막 보드 활동 시각을 대신 쓴다(있으면). */
  ageMs: number;
}

export function evaluateExitQuiet(input: {
  now: number;
  /** 이 프로세스에서 status 가 stopped/error 로 확정됐는가. */
  terminalLocal: boolean;
  terminalSinceMs?: number | null;
  lastBoardActivityMs: number | null;
  exitCode?: number | null;
}): ExitQuietVerdict | null {
  if (!input.terminalLocal) return null;
  const base = input.terminalSinceMs ?? input.lastBoardActivityMs ?? input.now;
  return {
    quiet: true,
    exitCode: input.exitCode ?? null,
    ageMs: Math.max(0, input.now - base),
  };
}

// ── PTY 상태 설명 ─────────────────────────────────────────────────────────

/**
 * 신호에 붙는 PTY 쪽 설명. 판정이 아니라 **오케가 판단할 재료**다.
 *   busy           — 최근(STALL_PTY_BUSY_RECENT_MS) work-output 이 있다. 스피너/
 *                    스트리밍/툴 로그. "일하는 것처럼 보임" — 툴 호출 행(hang)도
 *                    여기 들어가므로 확정은 아니다.
 *   awaiting-input — 사람 확인 다이얼로그([y/n] 등)에 서 있다. 누군가 답해야 한다.
 *   parked         — 하네스 입력 프롬프트에 서 있다(턴이 끝났는데 보고가 없음).
 *   silent         — 살아 있지만 work-output 도 없다(긴 추론일 수도, 행일 수도).
 *   dead           — stopped/error.
 *   missing        — 이 인스턴스 레지스트리에 없음(다른 호스트/인스턴스일 수 있음).
 */
export type PtyLiveness =
  | "busy"
  | "awaiting-input"
  | "parked"
  | "silent"
  | "dead"
  | "missing";

export function classifyPtyLiveness(input: {
  now: number;
  /** null ⇒ 이 프로세스에 없는 에이전트. */
  status: "idle" | "working" | "error" | "stopped" | null;
  lastWorkOutputMs?: number | null;
  promptIdleSinceMs?: number | null;
  inputWaitReason?: string | null;
}): PtyLiveness {
  if (input.status === null) return "missing";
  if (input.status === "stopped" || input.status === "error") return "dead";
  if (input.inputWaitReason) return "awaiting-input";
  if (input.promptIdleSinceMs !== null && input.promptIdleSinceMs !== undefined)
    return "parked";
  const work = input.lastWorkOutputMs;
  if (
    typeof work === "number" &&
    Number.isFinite(work) &&
    input.now - work <= STALL_PTY_BUSY_RECENT_MS
  ) {
    return "busy";
  }
  return "silent";
}

/** 오케에게 보여줄 한 줄 설명(한국어). 판정 단어를 쓰지 않는다 — 사실만. */
export function describePtyLiveness(
  kind: PtyLiveness,
  input: { now: number; lastWorkOutputMs?: number | null }
): string {
  const ago =
    typeof input.lastWorkOutputMs === "number" &&
    Number.isFinite(input.lastWorkOutputMs)
      ? Math.max(0, Math.round((input.now - input.lastWorkOutputMs) / 60_000))
      : null;
  switch (kind) {
    case "busy":
      return "PTY 는 출력 중(스피너/스트리밍) — 일하는 중이거나 툴 호출이 행 상태";
    case "awaiting-input":
      return "PTY 가 사람 확인 다이얼로그에 서 있음 — 누군가 답해야 진행됨";
    case "parked":
      return "PTY 가 입력 프롬프트에 서 있음 — 턴은 끝났는데 보고가 없음";
    case "silent":
      return `PTY 출력 없음${
        ago !== null ? ` (마지막 출력 ${ago}분 전)` : ""
      } — 긴 추론일 수도, 멈춘 것일 수도`;
    case "dead":
      return "PTY 종료(stopped/error)";
    case "missing":
      return "이 인스턴스에 없는 에이전트(다른 호스트/앱 인스턴스일 수 있음)";
  }
}

// ── 바운드 에이전트 stale 판정(dispatch 용) ─────────────────────────────

export interface BoundAgentEvidence {
  /** 스폰 후 첫 활동 유예 안인가(dispatch 의 기존 firstActivityGrace). */
  withinFirstActivityGrace: boolean;
  /** 보드에 이 에이전트 귀속 실활동(dispatch 베이스라인 제외)이 1건 이상인가. */
  hasBoardActivity: boolean;
  /** 그 활동의 마지막 시각(epoch ms). 모르면 null. */
  lastBoardActivityMs: number | null;
  priority?: number | null;
  now: number;
  policy?: StallPolicy;
}

export type BoundAgentVerdict =
  | { live: true; reason: string }
  | {
      live: false;
      reason: string;
      quietMs: number | null;
      thresholdMs: number;
    };

/**
 * dispatch_task 가 "이미 바운드된 에이전트로 되돌려보내도 되는가" 를 정한다.
 *
 * 종전 판정은 `hasBoardActivity` 하나였다 — 활동을 1건이라도 남긴 에이전트는
 * **영구히** live 였고, 그래서 80분 무활동 에이전트에게 재배정이 되돌아갔다.
 * 이제는 마지막 활동 시각이 임계(우선순위별, 워치독 신호와 같은 값)를 넘으면
 * live 가 아니다 — 워치독이 "조용하다" 고 올릴 바로 그 시점부터 재배정이 우회한다.
 *
 * 시각을 모르면(구 hook / 조회 실패) 종전대로 hasBoardActivity 를 믿는다 —
 * 증거 부족을 "죽었다" 로 기울이지 않는다.
 */
export function evaluateBoundAgent(e: BoundAgentEvidence): BoundAgentVerdict {
  const policy = e.policy ?? DEFAULT_STALL_POLICY;
  const thresholdMs = quietThresholdMs(e.priority, policy);
  if (e.withinFirstActivityGrace) {
    return { live: true, reason: "within first-activity grace" };
  }
  if (!e.hasBoardActivity) {
    return {
      live: false,
      reason: "no board activity beyond the dispatch baseline",
      quietMs: null,
      thresholdMs,
    };
  }
  if (
    e.lastBoardActivityMs === null ||
    !Number.isFinite(e.lastBoardActivityMs)
  ) {
    return { live: true, reason: "board activity present (age unknown)" };
  }
  const quietMs = Math.max(0, e.now - e.lastBoardActivityMs);
  if (quietMs >= thresholdMs) {
    return {
      live: false,
      reason:
        `bound agent's last board activity was ${Math.round(
          quietMs / 60_000
        )}m ago ` +
        `(stall threshold ${Math.round(
          thresholdMs / 60_000
        )}m for this priority)`,
      quietMs,
      thresholdMs,
    };
  }
  return {
    live: true,
    reason: `board activity ${Math.round(
      quietMs / 60_000
    )}m ago (< ${Math.round(thresholdMs / 60_000)}m)`,
  };
}

// ── 워치독 W3 가드 보조 ─────────────────────────────────────────────────

/**
 * "티켓의 기록된 담당이 아닌 다른 살아있는 에이전트가 이 태스크에 묶여 있는가".
 * 워치독이 중복 스폰을 막는 stand-down 가드(hasLiveWorkerForTask)의 술어.
 *
 * ★예외 하나를 더 둔다: `currentTaskId === null && lastTaskId === taskId` 인
 * 에이전트는 **이 태스크에서 이미 풀려난** 에이전트다(완료 보고로 markTurnComplete
 * 됐거나, dispatch 우회로 바인딩이 해제됐거나). 그 에이전트가 태스크 워크트리에
 * 아직 앉아 있다는 이유로 "live worker 가 있다" 고 보면, 후임 에이전트가 멈춰도
 * 워치독이 영원히 stand-down 한다. 풀려난 선임은 후임의 복구를 막지 못한다.
 */
export function isOtherLiveWorkerForTask(
  agent: {
    id: string;
    status: "idle" | "working" | "error" | "stopped";
    currentTaskId: string | null;
    lastTaskId?: string | null;
    cwd?: string | null;
  },
  ticket: { taskId: string; agentId: string | null }
): boolean {
  if (agent.id === ticket.agentId) return false;
  if (agent.status === "stopped" || agent.status === "error") return false;
  if (agent.currentTaskId && agent.currentTaskId === ticket.taskId) return true;
  if (agent.currentTaskId === null && agent.lastTaskId === ticket.taskId) {
    return false; // released from this task — not its live worker any more
  }
  return !!agent.cwd && agent.cwd.includes(ticket.taskId);
}

// ── 신호 페이로드(공유 타입) ──────────────────────────────────────────────

/**
 * 워치독이 올리는 "조용하다" 신호. AgentInstance.stallSignal 에도 같은 모양으로
 * 붙어 get_agents/cleanup_agents 가 보여준다. 모델을 반드시 싣는다 — 모델별
 * 완주 실패율을 쌓으려면 정지 건에 모델이 남아야 한다(지금은 아예 안 남는다).
 */
export interface StallSignal {
  taskId: string;
  tier: StallTier;
  /**
   * W8 보강: 어느 축이 이 신호를 올렸는가.
   *   board-quiet     — 종전 W8. 한동안 보고하다 멈춤(무활동 나이 ≥ 20/45분).
   *   first-activity  — 스폰 이후 첫 활동이 아예 없음(무활동 나이 ≥ 5분).
   *   exit            — 프로세스가 로컬에서 종료(stopped/error)로 확정됨. 즉시.
   * 죽음(exit)과 침묵(board-quiet/first-activity)이 같은 문구로 오면 오케가
   * 구분할 수 없다 — 이 필드 + exitCode 가 그 구분이다.
   */
  axis: "board-quiet" | "first-activity" | "exit";
  quietMs: number;
  thresholdMs: number;
  /** 이 티켓의 마지막 실제 보드 활동 이후 경과(ms) — 축과 무관하게 항상 채운다.
   * exit 축에서도 "죽기 전에 얼마나 조용했었는지" 를 함께 실어야 오케가
   * "막 보고하고 바로 죽음" 과 "한참 조용하다 죽음" 을 가를 수 있다. */
  boardIdleMs: number;
  /** 로컬에서 관측한 PTY exit code. axis 가 "exit" 가 아니면 null. */
  exitCode: number | null;
  pty: PtyLiveness;
  /** 구체 모델(model@effort) 또는 벤더. 모르면 null. */
  model: string | null;
  raisedAtMs: number;
  /** 같은 조용함 구간에서 몇 번째 신호인가(1부터). */
  repeat: number;
}

// ── 판단 보류 — 모델 실적(n) 기반 임계 단축은 안 한다 ──────────────────────
//
// 요청(④): MiniMax-M3 는 이 보드 실적 n=1 이었는데 검증된 모델과 같은 20분을
// 기다렸다 — 실적을 임계에 반영할지 판단하라는 요청.
//
// 결론: **반영하지 않는다.**
//   1. 이 모듈(그리고 워치독)은 프로세스 로컬 메모리다. "실적 n" 을 여기서
//      세면 앱을 재시작할 때마다 모든 모델이 n=0 으로 리셋된다 — 매 부팅마다
//      "검증된" claude-fable-5 조차 첫 실행에서 짧은 임계로 오탐을 낸다. 이는
//      정확히 이 티켓이 지키라는 불변식("오탐이 미탐보다 나쁘다")을 정면으로
//      어긴다.
//   2. 진짜 실적(모델별 완주/정지 이력)은 이미 텔레메트리에 쌓인다
//      (`agent:quiet_signal` 이 매 신호에 구체 모델을 싣는다, 위 주석). 그
//      데이터는 프로세스를 넘어 영속하고, "이 모델이 실제로 얼마나 자주
//      멈추는지" 를 세션 하나의 기억보다 훨씬 정확히 answer 한다. 근시안적
//      로컬 카운터로 텔레메트리 집계를 흉내 내는 대신, 라우팅/임계 반영은
//      그 집계가 쌓인 뒤 별도로 하는 게 맞다(agent-stall-signal-2026-08-22.md
///     §6 "라우팅 반영은 이 데이터가 쌓인 뒤의 일" 과 같은 결론).
//   3. 대안이 이미 있다: 후속 티켓(DQYoyas3ESx33zXJOCOa, 능동 프로브)이 이
//      파일을 이어받는다 — "안 써본 모델이라 불안하다" 는 걱정은 임계를
//      더 짧게 잡아 *기다리는* 것보다 능동적으로 *찔러보는* 쪽이 훨씬 빠르고
//      정확하게 푼다. 그 티켓에 넘긴다.
//
// 만약 나중에 실적 기반 임계가 정말 필요해지면: 로컬 카운터가 아니라
// 텔레메트리 집계(또는 Firestore 에 영속된 모델별 완주 통계)를 StallPolicy 에
// 주입하는 형태로 하고, 부팅 직후엔 "모른다"(→ 보수적 기본 임계)로 시작해야
// 한다 — "모른다" 를 "위험하다" 로 기울이면 이 파일 헤더의 설계 원칙과
// 충돌한다.
