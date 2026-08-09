import { BrowserWindow } from "electron";

// Send telemetry events to the renderer process for Firestore persistence
export function sendTelemetry(
  win: BrowserWindow | null,
  event: string,
  payload: Record<string, unknown>,
) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send("telemetry:event", { event, ...payload });
  } catch {
    // Silently fail
  }
}

/**
 * 스폰 이벤트의 라우팅 라벨 축(#890 F-1 · F-9).
 *
 * `taskId` 없이는 스폰 행이 어떤 결정의 결과인지 조인할 수 없고(감사 G1: 현재
 * 0%), `spawnedModel` 없이는 그 결정의 **액션 해상도**가 프로바이더까지밖에
 * 안 남는다(감사 C2: 7.6%). 둘 다 이미 존재하는 first-class 컬럼/메타 키라
 * 서버 스키마 변경이 없다.
 */
export interface AgentSpawnedContext {
  /** 이 스폰이 묶인 보드 태스크. 미바인딩 세션은 null. */
  taskId?: string | null;
  /** 실제로 넘긴 argv 를 되읽은 `model@effort`. 핀 없으면 undefined. */
  spawnedModel?: string;
}

/**
 * 에이전트 종료 시의 **실패 귀책 신호**(#890 F-7 · 감사 G11).
 *
 * "실패" 를 무산출/모델귀책/환경으로 가르려면 종료 시점의 세 가지가 필요하다:
 * 얼마나 뱉었나(`outputChars`), 무엇으로 끝났나(`exitCode`), 어느 태스크였나
 * (`taskId`). 전부 비식별 — PTY **바이트 수**만 세고 내용은 담지 않는다.
 */
export interface AgentStoppedContext {
  taskId?: string | null;
  model?: string | null;
  /** 이 에이전트가 살아 있는 동안 PTY 로 뱉은 총 문자 수(내용 아님). */
  outputChars?: number;
  /** 산출이 사실상 없었나 — 배너/프롬프트 수준 이하. F-7 의 NO_OUTPUT 후보. */
  noOutput?: boolean;
  /** 종료 분류(graceful/clean/no_output). 크래시 계열은 agentCrashed 가 쓴다. */
  errorCategory?: string;
}

/**
 * 메시지 길이를 구간으로 접는다 — 원문은 물론 정확한 글자 수도 남기지 않는다.
 * 퍼널이 알아야 할 건 "한 줄짜리였나, 붙여넣은 스펙이었나" 정도뿐이다.
 */
export function bucketMessageLength(length: number): string {
  // 터미널 직접 입력은 키스트로크로 쪼개져 들어와 길이를 알 수 없다. 그 경우를
  // 0 으로 적으면 "빈 메시지"라는 없는 사실이 되므로 unknown 으로 남긴다
  // (길이를 알려면 사용자 입력을 메인에서 버퍼링해야 하는데, 그건 더 나쁘다).
  if (!Number.isFinite(length) || length < 0) return "unknown";
  if (length === 0) return "0";
  if (length < 20) return "1-19";
  if (length < 100) return "20-99";
  if (length < 500) return "100-499";
  if (length < 2000) return "500-1999";
  return "2000+";
}

export const mainTelemetry = {
  agentSpawned(
    win: BrowserWindow | null,
    agentId: string,
    name: string,
    model: string,
    role: string,
    projectId?: string,
    promptHash?: string,
    promptLength?: number,
    context?: AgentSpawnedContext,
  ) {
    sendTelemetry(win, "agent:spawned", {
      agentId,
      name,
      model,
      role,
      projectId,
      promptHash,
      promptLength,
      // ★F-1/F-9 — 액션 해상도의 스폰측 절반. 값이 없으면 키를 싣지 않는다
      // (서버는 undefined 를 null 로 적재하므로 기존 행과 호환).
      taskId: context?.taskId ?? undefined,
      metadata: context?.spawnedModel
        ? { spawnedModel: context.spawnedModel }
        : undefined,
    });
  },

  agentStopped(
    win: BrowserWindow | null,
    agentId: string,
    exitCode?: number,
    context?: AgentStoppedContext,
  ) {
    sendTelemetry(win, "agent:stopped", {
      agentId,
      exitCode,
      taskId: context?.taskId ?? undefined,
      model: context?.model ?? undefined,
      errorCategory: context?.errorCategory,
      // 산출 신호는 metadata JSON 으로 — events 에 전용 컬럼이 없고, 숫자/불리언
      // 이라 스크럽 denylist(#887 R8)에 걸릴 것이 없다.
      metadata:
        context?.outputChars !== undefined || context?.noOutput !== undefined
          ? {
              ...(context?.outputChars !== undefined
                ? { outputChars: context.outputChars }
                : {}),
              ...(context?.noOutput !== undefined
                ? { noOutput: context.noOutput }
                : {}),
            }
          : undefined,
    });
  },

  // `taskId` is the agent's currentTaskId at crash/restart time. Without it
  // these events were observable only per-agent: BigQuery held 820 crashes and
  // 987 restarts with taskId attached to exactly 0 of them, so "this model
  // kept dying on this task" — one of the strongest quality signals we have —
  // could never be joined back to the task it was about
  // (docs/research/routing-slm-data-collection.md §3.3). Same stamp the cost
  // tracker uses, which already achieves a 98.6% join rate. Null for agents
  // not bound to a board task (one-off / orchestrator sessions).
  // errorCategory/errorMessage fill the churn-analysis §5-4 gap: every
  // agent:crashed row in BigQuery had these NULL, so "왜 죽었나(인증? CLI 경로?
  // spawn env?)" was unanswerable — the exact question behind the 22→6 첫스폰
  // 붕괴. The manager already computes the coarse classification (fast-fail =
  // 바이너리 부재/설정 오류 vs runtime crash = 재시작 예산 소진); we now ship it.
  // Both columns already exist first-class in the events schema, and the
  // renderer telemetry choke point scrubs the (short) message for paths/emails.
  agentCrashed(
    win: BrowserWindow | null,
    agentId: string,
    exitCode: number,
    taskId?: string | null,
    model?: string | null,
    dispatchReason?: string | null,
    errorCategory?: string,
    errorMessage?: string,
  ) {
    sendTelemetry(win, "agent:crashed", {
      agentId,
      exitCode,
      taskId,
      model,
      dispatchReason,
      outcome: "crashed",
      errorCategory,
      errorMessage,
    });
  },

  agentRestarted(
    win: BrowserWindow | null,
    agentId: string,
    attempt: number,
    taskId?: string | null,
    model?: string | null,
    dispatchReason?: string | null,
    // ★재시도 **사유**(#890 F-5 의 신호 절반). 종전엔 "몇 번째 재시도" 만 남아
    // 재시도가 설정 문제(fast_fail_config)인지 런타임 크래시인지 구분이 안 됐다.
    // 어휘는 agentCrashed 와 동일하게 유지 — 두 신호가 조인 가능해야 한다.
    errorCategory?: string,
    exitCode?: number,
  ) {
    sendTelemetry(win, "agent:restarted", {
      agentId,
      attempt,
      taskId,
      model,
      dispatchReason,
      outcome: "crashed",
      errorCategory,
      exitCode,
    });
  },

  agentSpawnFailed(
    win: BrowserWindow | null,
    payload: AgentLifecycleOutcomePayload,
  ) {
    sendTelemetry(win, "agent:spawn_failed", {
      agentId: payload.agentId,
      taskId: payload.taskId,
      model: payload.model,
      role: payload.role,
      dispatchReason: payload.dispatchReason,
      outcome: "spawn_failed",
      success: false,
      errorCategory: payload.errorCategory,
      errorMessage: payload.errorMessage,
      metadata: payload.metadata,
    });
  },

  agentWentStale(
    win: BrowserWindow | null,
    payload: AgentLifecycleOutcomePayload,
  ) {
    sendTelemetry(win, "agent:went_stale", {
      agentId: payload.agentId,
      taskId: payload.taskId,
      model: payload.model,
      role: payload.role,
      dispatchReason: payload.dispatchReason,
      outcome: "stale",
      success: false,
      errorCategory: payload.errorCategory,
      errorMessage: payload.errorMessage,
      metadata: payload.metadata,
    });
  },

  tokenUsage(
    win: BrowserWindow | null,
    agentId: string,
    model: string,
    tokensInput: number,
    tokensOutput: number,
    cost: number,
    projectId?: string,
  ) {
    sendTelemetry(win, "token:usage", {
      agentId,
      model,
      tokensInput,
      tokensOutput,
      cost,
      projectId,
    });
  },

  /**
   * The cost tracker met a model id it cannot price — neither the pricing
   * table nor the model registry (alias- and case-folded lookups included)
   * had a row. Those tokens are billed at $0, so this event is the only
   * signal that spend is going UNDER-reported for that model.
   *
   * Emitted on the first sighting per model id and then at each order of
   * magnitude (1, 10, 100 …) so a long-running miss shows its scale without
   * flooding — the 15s poller would otherwise emit one per tick per agent.
   *
   * The fix is always a verified row in electron/model-registry.ts. Never a
   * guessed rate: a fabricated number is what this whole path exists to stop.
   *
   * ★`count`/`firstSeen` ride in `metadata`, not as top-level fields. The
   * BigQuery writer (functions/src/index.ts buildMetadata) maps a fixed set of
   * first-class columns and passes `metadata` through as JSON — any other
   * top-level key is dropped silently. `model` IS a first-class column, so it
   * stays up top and stays GROUP BY-able.
   */
  pricingUnmatched(
    win: BrowserWindow | null,
    model: string,
    count: number,
    firstSeen: boolean,
  ) {
    sendTelemetry(win, "cost:pricing_unmatched", {
      model,
      metadata: { count, firstSeen },
    });
  },

  // ── 온보딩 스톨 계측 (티켓 9dXgBdkGn1LyJokShh1g) ───────────────────────
  //
  // 온램프 스파이크 #883/#885 의 공통 결론: 무료→유료 투자를 결정하기 전에
  // "구독/크레딧/인증이 없어 **최초에 멈추는** 유저" 가 몇 명인지부터 세야 하는데,
  // 그 순간의 이벤트가 BigQuery 에 **0건**이라 문제 크기를 알 수 없었다. 아래 두
  // 이벤트가 main 쪽 스톨(사전 게이트 차단 / 스폰 후 로그인화면 확정)을 채운다.
  //
  // 새 파이프라인은 없다 — 렌더러의 단일 choke point(logTelemetry: 비식별 scrub +
  // firstParty 게이트)를 지나 기존 `logTelemetryBatch` → BigQuery `events` 로 간다.
  // 서버는 event 문자열을 화이트리스트 없이 적재하므로 서버 변경도 없다.
  // 페이로드는 비식별: 모델/사유 코드/개수만, 경로·키·원문 출력은 절대 싣지 않는다.

  /**
   * 사전 스폰 게이트(`checkSpawnAuthGate`)가 스폰을 거절했다 = 사용자가 첫 작업을
   * **실행 전에** 막힌 순간. reason 어휘는 게이트 그대로:
   * not-installed / not-authenticated / vendor-not-configured.
   */
  spawnBlocked(
    win: BrowserWindow | null,
    payload: {
      surface: string;
      model: string;
      reason: string;
      installed: boolean;
      vendor?: string;
      missingEnvKeyCount?: number;
    },
  ) {
    sendTelemetry(win, "onboarding:spawn_blocked", {
      model: payload.model,
      success: false,
      outcome: "blocked",
      errorCategory: payload.reason,
      metadata: {
        surface: payload.surface,
        installed: payload.installed,
        ...(payload.vendor ? { vendor: payload.vendor } : {}),
        ...(payload.missingEnvKeyCount !== undefined
          ? { missingEnvKeyCount: payload.missingEnvKeyCount }
          : {}),
      },
    });
  },

  /**
   * 스폰은 됐는데 CLI 가 **로그인 화면에서** 멈췄다(백스톱 확정). reason 은
   * LoginBackstopFireReason(no-probe / probe-unauthenticated / grace-expired).
   *
   * ★이 판정은 철회될 수 있다(readiness 도달 = 오탐). 그래서 짝 이벤트
   * `onboarding:agent_auth_resolved` 를 반드시 함께 읽어야 한다 — 철회분을 빼지
   * 않고 세면 인증 팝업 오탐 saga 가 스톨 수치를 부풀린다.
   */
  agentNeedsAuth(
    win: BrowserWindow | null,
    agentId: string,
    model: string,
    reason: string,
  ) {
    sendTelemetry(win, "onboarding:agent_needs_auth", {
      agentId,
      model,
      success: false,
      outcome: "blocked",
      errorCategory: reason,
    });
  },

  /** 위 판정의 **철회**(오탐 확정). 스톨 집계의 분자에서 빼는 데 쓴다. */
  agentAuthResolved(win: BrowserWindow | null, agentId: string, model: string) {
    sendTelemetry(win, "onboarding:agent_auth_resolved", {
      agentId,
      model,
      success: true,
    });
  },

  /**
   * 사용자가 오케스트레이터 PTY 에 지시를 **제출**했다 — 활성화 퍼널의 "첫 대화"
   * 칸(티켓 ygoWP1VJ). 퍼널 감사에서 이 구간만 이벤트가 아예 없어, 폴더까지
   * 연결하고 말을 안 걸어본 유저와 말은 걸었는데 티켓이 안 나온 유저를 구분할
   * 수 없었다.
   *
   * ★여기서는 **제출될 때마다** 보낸다. 설치당 1회로 접는 건 렌더러가 한다
   * (telemetryService.firstConversationObserved) — one-shot 마커가 localStorage 라
   * 렌더러에만 있기 때문이다. 반대로 "어느 PTY 가 오케인가"는 메인만 아니까 감지는
   * 여기서 한다. 각자 아는 쪽이 자기 몫을 맡는 분업이다.
   *
   * ★비식별: 입력 **내용은 절대 싣지 않는다**. 정확한 글자 수도 짧은 문장에서는
   * 지문이 될 수 있어 구간으로 접는다 — 남는 건 "어느 표면에서, 대략 어느 분량으로
   * 말을 걸었나" 뿐이다.
   */
  orchestratorMessage(
    win: BrowserWindow | null,
    surface: string,
    length: number,
  ) {
    sendTelemetry(win, "onboarding:first_conversation", {
      metadata: { surface, lengthBucket: bucketMessageLength(length) },
    });
  },

  // ── ★멀티에이전트 동시실행/성공 (티켓 pWSnJeQN) ─────────────────────────
  //
  // 사장님 최중요 KPI 는 "10분 안에 첫 multi-agent 성공 경험" 인데, 그 성공을
  // 구성하는 **동시실행** 자체가 계측에 없었다(BigQuery grep 0건). 아래 둘이
  // 그 공백을 채운다. 둘 다 개수만 싣는 비식별 이벤트이고, 기존 렌더러 choke
  // point(logTelemetry: scrub + firstParty 게이트) → logTelemetryBatch →
  // BigQuery `events` 로 간다 — 새 파이프라인도 서버 변경도 없다.
  //
  // ★설치당 1회로 접는 일은 **여기서 하지 않는다**. one-shot 마커(localStorage)
  // 는 렌더러에만 있고, 어느 PTY 가 살아 있는지는 메인만 안다 — first_conversation
  // 과 같은 분업이다. 메인은 사실을 매번 보내고, 렌더러가 접는다.

  /**
   * 동시에 살아 있는 에이전트가 2대 이상으로 **늘어난** 순간.
   * `concurrent` = 그 순간의 live 수, `working` = 그중 턴이 열린 수(참고치).
   */
  multiAgentActive(
    win: BrowserWindow | null,
    concurrent: number,
    working: number,
  ) {
    sendTelemetry(win, "onboarding:multi_agent_active", {
      success: true,
      metadata: { concurrent, working },
    });
  },

  /**
   * 동시 2대+ 상태에서 **성과가 났다** — 이 이벤트의 메인측 트리거는 머지다
   * (`recordMergeHistory`). 티켓 완료 쪽 트리거는 렌더러가 보드 구독에서 관측한다
   * (오케는 MCP 로 Firestore 를 직접 write 해 렌더러 taskService 를 우회하므로,
   * 보드 관측만이 모든 작성 경로를 한 번씩 잡는다 — #895 first_ticket 과 동일 근거).
   */
  multiAgentSuccess(
    win: BrowserWindow | null,
    payload: {
      trigger: "merge" | "task_completed";
      concurrent: number;
      working: number;
      taskId?: string | null;
      projectId?: string;
    },
  ) {
    sendTelemetry(win, "onboarding:multi_agent_success", {
      success: true,
      taskId: payload.taskId ?? undefined,
      projectId: payload.projectId,
      metadata: {
        trigger: payload.trigger,
        concurrent: payload.concurrent,
        working: payload.working,
      },
    });
  },

  heartbeat(
    win: BrowserWindow | null,
    agentId: string,
    projectId: string,
    status: string,
    tokensAccumulated: number,
    costAccumulated: number,
  ) {
    sendTelemetry(win, "agent:heartbeat", {
      agentId,
      projectId,
      status,
      tokensInput: tokensAccumulated,
      cost: costAccumulated,
    });
  },

  // ── 스폰/모델 할당 v2 (SPAWN-MODEL-ALLOCATION-V2 §8.4) ──────────

  /** modelTierForComplexity 가 complex 티어의 claude 모델을 결정한 시점. */
  modelTierResolved(
    win: BrowserWindow | null,
    model: string,
    complexity: string,
    resolvedClaudeModel: string,
    agentId?: string,
  ) {
    sendTelemetry(win, "model:tier_resolved", {
      model,
      complexity,
      resolvedClaudeModel,
      agentId,
    });
  },

  /** 버전가드 미달 / 미지 모델 / 런타임 강등 등으로 최상위 모델이 폴백된 시점. */
  topModelFallback(
    win: BrowserWindow | null,
    reason: string,
    requested: string,
    installed: string,
    fallbackTo: string,
    agentId?: string,
    taskId?: string,
  ) {
    sendTelemetry(win, "model:top_fallback", {
      reason,
      requested,
      installed,
      fallbackTo,
      agentId,
      taskId,
    });
  },

  /** complex 작업에 모델 믹스(cross-check/split-role)가 발동된 시점(§4). */
  modelMixDispatched(
    win: BrowserWindow | null,
    mode: string,
    taskId: string | null,
  ) {
    sendTelemetry(win, "model:mix_dispatched", { mode, taskId });
  },

  /** complex 작업의 단계분할이 디스패치된 시점(§5). */
  complexStagesDispatched(
    win: BrowserWindow | null,
    stageCount: number,
    perStageComplexity: string[],
    taskId: string | null,
  ) {
    sendTelemetry(win, "model:complex_stages_dispatched", {
      stageCount,
      perStageComplexity,
      taskId,
    });
  },

  // ── 디스패치 결정 스냅샷 (DISPATCH-DECISION-TELEMETRY) ────────
  //
  // "어떤 모델을 어떤 태스크(complexity/tags/role)에 왜(점수/사유) 배치했고
  // → reuse/restart/spawn 중 무엇이었나" 를 BigQuery 에서 결과(cost_logs /
  // 결과 events)와 join 분석할 수 있게 1건의 스냅샷을 남긴다. dispatchSingle 의
  // 각 종착 분기(reuse/restart/spawn) 직후 호출된다.
  //
  // 게이트·PII: 이 이벤트도 다른 모든 이벤트와 동일하게 렌더러의 logTelemetry
  // choke point(firstPartyTelemetryDefaultEnabled opt-in 게이트 + scrub PII)를
  // 통과한 뒤에야 외부로 나간다 — 동의 OFF 면 외부송신 0. 페이로드는 비식별:
  // 프롬프트 원문·파일경로·키를 절대 싣지 않는다(id/모델명/점수/사유 문자열만).
  // ── 머지 결과 스냅샷 (MERGE-OUTCOME-TELEMETRY, ticket cZBlOnkg) ─────
  //
  // 태스크가 squash-merge 로 base 에 착륙한 시점의 결과 라벨. audit 웨지
  // (merge_history)와 동일한 단일 캡처 지점(recordMergeHistory)에서 파생특징을
  // 한 번 계산해 이 이벤트로 ML 싱크(BigQuery events)에도 흘린다 — 중복 캡처
  // 없음. taskId 로 task_outcomes / cost_logs 와 join → "이 모델·역할·복잡도의
  // 태스크가 결국 머지됐나, diff 규모는 얼마였나" 라벨을 완성한다.
  //
  // 게이트·PII: 다른 이벤트와 동일하게 렌더러 logTelemetry choke point(opt-in
  // 게이트 + scrub)를 통과해야 외부로 나간다. 페이로드는 비식별 — 원문 diff/
  // 코드/파일경로 없이 개수·라인±·경로파생 카테고리만 싣는다.
  taskMerged(win: BrowserWindow | null, payload: TaskMergedPayload) {
    // taskId 는 ML join key — 없으면(ad-hoc 워크트리 머지) 학습가치 0 이라 skip.
    if (!payload.taskId) return;
    const linesAdded = payload.linesAdded ?? 0;
    const linesDeleted = payload.linesDeleted ?? 0;
    sendTelemetry(win, "task:merged", {
      taskId: payload.taskId,
      projectId: payload.projectId,
      success: true,
      // events 테이블에 이미 존재하는 first-class ML 컬럼으로 적재.
      filesChanged: payload.filesChanged,
      linesChanged: linesAdded + linesDeleted,
      // 경로파생 coarse 카테고리(docs/test/config/code/mixed) — bug-fix vs
      // feature 는 커밋 의미가 필요해 의도적으로 수집 안 함.
      taskType: payload.changeType,
      // 머지 고유 파생필드는 metadata(JSON)로 접는다(dispatch:decision 패턴).
      metadata: {
        mergeMode: payload.mode,
        linesAdded,
        linesDeleted,
        changeType: payload.changeType,
      },
    });
  },

  dispatchDecision(
    win: BrowserWindow | null,
    payload: DispatchDecisionPayload,
  ) {
    sendTelemetry(win, "dispatch:decision", {
      agentId: payload.agentId,
      taskId: payload.taskId,
      role: payload.role,
      // selectedModel → 표준 `model` 컬럼으로도 적재(GROUP BY model 용이).
      model: payload.selectedModel,
      // dispatch-decision 고유 필드들 — functions 가 metadata(JSON) 로 접는다.
      reuseVsSpawn: payload.reuseVsSpawn,
      selectedModel: payload.selectedModel,
      complexity: payload.complexity,
      tags: payload.tags,
      eligibleModels: payload.eligibleModels,
      explicitModel: payload.explicitModel,
      decisionReason: payload.decisionReason,
      modelSelectionMode: payload.modelSelectionMode,
      perModelScores: payload.perModelScores,
      agentScore: payload.agentScore,
      // ★P2-3 — 실제 스폰된 model@effort. 후속 지식그래프가 이 축으로 학습한다.
      spawnedModel: payload.spawnedModel,
      modelFallbackReason: payload.modelFallbackReason,
      // ★#890 F-1~F-4 라우팅 라벨. 서버 화이트리스트
      // (functions DISPATCH_DECISION_META_KEYS)에 같은 이름으로 등재돼야
      // metadata JSON 까지 살아 간다 — 빠지면 조용히 사라진다.
      spawnedModelSource: payload.spawnedModelSource,
      plannedModelKey: payload.plannedModelKey,
      candidateKeys: payload.candidateKeys,
      candidateCostIndex: payload.candidateCostIndex,
      decisionState: payload.decisionState,
      decisionComponents: payload.decisionComponents,
    });
  },
};

/** task:merged 이벤트 페이로드. 비식별 — 개수·라인±·경로파생 카테고리만. */
export interface TaskMergedPayload {
  /** ML join key. null 이면 emit skip(ad-hoc 워크트리 머지). */
  taskId: string | null;
  projectId: string;
  mode: "manual" | "auto";
  /** 변경 파일 수(numstat). git show 실패 시 undefined. */
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  /** 경로파생 coarse 카테고리(docs/test/config/code/mixed/unknown). */
  changeType?: string;
}

/** dispatch:decision 이벤트 페이로드. 비식별 — id/모델명/점수/사유만. */
export interface DispatchDecisionPayload {
  taskId: string | null;
  agentId?: string;
  role: string;
  complexity: string;
  tags: string[];
  /** 점수 경쟁에 들어간 후보 모델들(spawn 경로에서만 의미, 그 외 []). */
  eligibleModels: string[];
  selectedModel: string;
  /** scoreModelsDetailed 의 per-model 분해(spawn 경로에서만, 그 외 []). */
  perModelScores: unknown[];
  /** 선택 방식(top-score / round-robin / tie-band) — spawn 경로에서만. */
  modelSelectionMode?: string;
  /** 사람이 읽을 결정 사유(예: reuse 후보 reason 또는 spawn 사유). */
  decisionReason: string;
  reuseVsSpawn: "reuse" | "restart" | "spawn";
  /** 사용자/오케가 모델을 명시했는지(명시 시 점수경쟁 우회). */
  explicitModel: boolean;
  /**
   * ★P2-3 — **실제로 스폰된** 구체 모델·effort(`claude-opus-5`,
   * `gpt-5.6-terra@max`). `selectedModel` 이 프로바이더(claude/gpt)까지만 말하는
   * 반면 이 필드는 CLI 에 실제로 넘어간 argv 를 되읽은 값이다.
   *
   * 왜 따로 있나: 요청과 실제는 갈릴 수 있다(버전가드 폴백, 런타임 강등, 티어
   * 정책). 비용대비효과를 학습하는 라우팅 지식그래프(티켓 8wBiVzwI)가 이 값을
   * 소비하므로, 요청값을 사실로 착각하면 잘못된 (모델 × 결과) 사전확률로 수렴한다.
   *
   * undefined = 모델을 핀하지 않은 launch(CLI 기본 모델). 그 경우 "무엇이 떴는지"
   * 를 우리가 알 수 없으므로 지어내지 않고 비운다.
   */
  spawnedModel?: string;
  /** 지정 모델이 버전가드에 걸려 폴백했을 때의 사유 코드(폴백 없으면 undefined).
   * 이게 채워져 있으면 spawnedModel 은 요청한 모델이 아니라 폴백된 모델이다. */
  modelFallbackReason?: string;
  /** reuse/restart 경로에서 선택된 기존 에이전트의 매칭 점수. */
  agentScore?: number;

  // ── ★라우팅 라벨 계측(#890 §7 F-1~F-4) ────────────────────────────────
  //
  // 전부 nullable/optional 이고 전부 `metadata` JSON 으로 접힌다 — BigQuery
  // 마이그레이션 0(functions `buildMetadata` 화이트리스트에 등재만 하면 된다).
  // 값은 숫자·enum·모델 id 뿐이라 스크럽 denylist(#887 R8) 대상이 없다:
  // 프롬프트·경로·사용자 문자열은 여기에 **들어오지 않는다**.

  /**
   * ★F-1 — `spawnedModel` 의 **근거**. 종전엔 값만 있고 출처가 없어서, 값이
   * 비면 "핀 안 한 스폰" 인지 "관측 실패" 인지 구분할 수 없었다.
   *   · `argv`     — 우리가 CLI 에 넘긴 인자를 되읽은 값(가장 강함)
   *   · `observed` — 과금 세션이 기록한 모델 id(reuse/restart 경로)
   * 값이 없으면 이 필드도 없다 — 지어내지 않는다는 규율은 그대로다.
   */
  spawnedModelSource?: "argv" | "observed";

  /**
   * ★F-1 — **라우터가 고른 칸**(`model@effort`). `spawnedModel`(실제로 뜬 칸)과
   * 다른 축이다: 이쪽은 **액션**(학습이 배우려는 그 결정)이고 저쪽은 **실현**이다.
   * 둘이 갈리는 경우(버전가드 폴백·런타임 강등)가 실제로 있으므로 한 필드로
   * 뭉개면 라벨이 오염된다. 모델을 핀하지 않는 하네스에선 effort 칸만 담긴다.
   */
  plannedModelKey?: string;

  /**
   * ★F-1 — **비선택 후보까지** `model@effort` 해상도로. 후보 전개(§3-E)로 1
   * dispatch → N 훈련행을 만들려면 "무엇과 겨뤄 이겼나" 가 같은 해상도여야 한다.
   * 종전 `eligibleModels` 는 프로바이더까지만 말한다.
   */
  candidateKeys?: string[];

  /**
   * ★F-4 — **결정 시점 단가 스냅샷**(modelKey → blended $/1M). 단가는 바뀐다.
   * 6개월 뒤 레지스트리로 재구성하면 그건 당시 결정의 근거가 아닌 값이다.
   */
  candidateCostIndex?: Record<string, number>;

  /**
   * ★F-2 — **결정 시점 상태 스냅샷**. baseline 이 바로 이 값들로 점수를 매기는데
   * BQ 에는 하나도 안 남아서, 오프라인 리플레이가 baseline 을 재현조차 못 했다.
   */
  decisionState?: {
    /** 선택된 하네스 계정의 쿼터 소진율(0-100). */
    budgetUsedPercent?: number | null;
    /** 주간 토큰 중 이 하네스 몫(0-1). 롤업 없으면 null. */
    weeklyTokenShare?: number | null;
    /** 결정 시점 활성(working) 에이전트 수. */
    activeAgentCount?: number;
    /** 그중 같은 role 의 수. */
    roleAgentCount?: number;
    /** 실제로 겨룬 후보 수. */
    candidateSetSize?: number;
  };

  /**
   * ★F-3 — **결정 근거의 구조화**. 종전엔 `decisionReason` 문자열에만 있어서
   * 분석이 정규식 파싱에 의존했다(취약). 선택된 칸의 8성분 + 모드/결정자만
   * 담는다 — 후보 전체 점수는 `perModelScores`(비교축 전용, §2-D) 쪽이다.
   */
  decisionComponents?: {
    mode?: string;
    decidedBy?: string;
    entryModelKey?: string;
    movedFromEntry?: boolean;
    coldStart?: boolean;
    fit?: number;
    cost?: number;
    bench?: number;
    capability?: number;
    kg?: number;
    diversity?: number;
    usage?: number;
    weeklyLimit?: number;
    observations?: number;
    totalObservations?: number;
    total?: number;
  };
}

export interface AgentLifecycleOutcomePayload {
  taskId?: string | null;
  agentId?: string | null;
  model?: string | null;
  role?: string | null;
  dispatchReason?: string | null;
  errorCategory?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}
