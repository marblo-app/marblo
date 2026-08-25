// ═══════════════════════════════════════════════════════════════════════════
// postSpawnTelemetryGuard — "스폰은 있는데 종료·결과가 없다" 를 잡는 검사
// (ticket GCNpqvDYRrLhyLghPCF9 · 순수 로직, BQ/Firestore 무의존, node --test)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★왜 이 파일이 있나
//
// 2026-08-25 사장님 질문: "이용자들이 이후 사용한 데이터가 계측 누락된 건
// 아닌가?" — 재보니 맞다. 활성화 이전(설치·로그인)만 보다가 스폰 **이후** 를
// 안 봤다.
//
// 같은 축(events.userId = 36자 install clientId)에서:
//   agent:spawned 5,840  · agent:stopped 1,570  (종료가 스폰의 26.9%)
//   스폰한 사람 17명     · task_outcomes 있는 사람 7명
//   unique agentId 3,526 · 그중 하트비트는 있는데 종료·크래시·재시작이 0인
//                          에이전트 **1,518**
//
// 1,518 은 '아직 돌고 있다'가 아니라 **살아 있었는데 종료 이벤트가 안 남은**
// 세션이다. 하트비트는 세션 중에 10~30초마다 플러시되고, 종료는 앱 종료 순간에
// 렌더러 큐(10초 타이머)로만 나가서 프로세스가 먼저 죽는다
// (electron/telemetry.ts sendTelemetry, telemetryService.flushTelemetry).
//
// ★이 모듈은 판정만 한다. 쿼리도 시계도 없다. 호출부가 실측 한 줄을 넣으면
//   findings 가 나온다. 오늘 실측을 넣어서 ok 가 나오면 그 검사는 죽은 것이다.

export type PostSpawnSeverity = "ok" | "amber" | "red";

export type PostSpawnRuleKey =
  | "stop_ratio_low"
  | "living_unterminated"
  | "dispatch_without_outcome";

export type PostSpawnFinding = {
  rule: PostSpawnRuleKey;
  severity: PostSpawnSeverity;
  message: string;
  observed: Record<string, number>;
};

/**
 * 한 시점의 실측. ★사람 수는 퍼센트로 접지 않는다. 이벤트 단위만 비율이다.
 *
 * 모든 카운트는 **같은 축**이어야 한다: events/task_outcomes/agent_heartbeats
 * 의 `userId` = 36자 install clientId. cost_logs.userId(Firebase uid) 를
 * 여기 넣으면 축이 갈려 숫자가 거짓이다 — telemetryIdentityAxis.ts.
 */
export type PostSpawnSnapshot = {
  spawnedEvents: number;
  stoppedEvents: number;
  crashedEvents: number;
  restartedEvents: number;
  spawners: number;
  outcomeUsers: number;
  spawnersWithDispatchNoOutcome: number;
  livingAgentsWithoutTerminal: number;
  spawnedAgentIds: number;
};

export type PostSpawnThresholds = {
  /** 이 수 미만 스폰은 침묵. 0을 건강으로 읽지 않기 위해. */
  minSpawnedEvents: number;
  /** stopped/spawned 가 이 밑이면 red. */
  minStopRatio: number;
  /** 살아 있는데 종료가 없는 agentId 가 이 수 이상이고 비중이 크면 red. */
  minLivingUnterminated: number;
  maxLivingUnterminatedShare: number;
  /** 디스패치는 있는데 결과가 0인 사람 수. 사람 수 그대로 센다. */
  minDispatchWithoutOutcomePeople: number;
};

export const DEFAULT_POST_SPAWN_THRESHOLDS: PostSpawnThresholds = {
  minSpawnedEvents: 100,
  // 실측 근거: 2026-08-25 종료/스폰 = 1,570/5,840 = 0.269.
  // 앱 종료·크래시로 일부 유실은 자연스럽지만 0.5 밑이면 배선 유실이다.
  minStopRatio: 0.5,
  minLivingUnterminated: 100,
  // 실측 근거: 1,518 / 3,526 = 0.431. 15% 는 "종료가 스폰을 따라가지 못한다".
  maxLivingUnterminatedShare: 0.15,
  // 실측 근거: 스폰 17명 중 디스패치 후 결과 0인 사람 **6명**.
  minDispatchWithoutOutcomePeople: 3,
};

export type PostSpawnReport = {
  status: PostSpawnSeverity;
  findings: PostSpawnFinding[];
  lines: string[];
};

function worst(a: PostSpawnSeverity, b: PostSpawnSeverity): PostSpawnSeverity {
  if (a === "red" || b === "red") return "red";
  if (a === "amber" || b === "amber") return "amber";
  return "ok";
}

/**
 * 2026-08-25 BigQuery 실측 (john.kim ADC REST, marblo_telemetry, 리전 US).
 *
 * ★36자 install clientId 축만. 28자 Firebase uid 행(events 1,101 spawned)은
 *   다른 공간이라 빼지 않으면 분모가 커진다. 티켓이 인용한 6,934 vs 1,800 은
 *   축을 덜 가른 숫자이고, 같은 날 같은 표의 36자 축은 5,840 vs 1,570 이다.
 *   비율은 둘 다 ~27% 라 결론은 같다. 숫자가 갈리면 이 상수보다 원본 쿼리가
 *   옳다.
 */
export const LIVE_2026_08_25: PostSpawnSnapshot = {
  spawnedEvents: 5840,
  stoppedEvents: 1570,
  crashedEvents: 879,
  restartedEvents: 993,
  spawners: 17,
  outcomeUsers: 7,
  spawnersWithDispatchNoOutcome: 6,
  livingAgentsWithoutTerminal: 1518,
  spawnedAgentIds: 3526,
};

export function auditPostSpawnTelemetry(
  snapshot: PostSpawnSnapshot,
  thresholds: PostSpawnThresholds = DEFAULT_POST_SPAWN_THRESHOLDS
): PostSpawnReport {
  const findings: PostSpawnFinding[] = [];

  if (snapshot.spawnedEvents < thresholds.minSpawnedEvents) {
    return {
      status: "ok",
      findings: [],
      lines: [
        `★스폰 이벤트 ${snapshot.spawnedEvents}건은 임계 ` +
          `${thresholds.minSpawnedEvents} 미만이라 판정할 근거가 없다. ` +
          "'이상 없음' 이 아니다.",
      ],
    };
  }

  const stopRatio =
    snapshot.spawnedEvents > 0
      ? snapshot.stoppedEvents / snapshot.spawnedEvents
      : 0;
  if (stopRatio < thresholds.minStopRatio) {
    findings.push({
      rule: "stop_ratio_low",
      severity: "red",
      message:
        `agent:stopped ${snapshot.stoppedEvents}건 / agent:spawned ` +
        `${snapshot.spawnedEvents}건 = ${(stopRatio * 100).toFixed(1)}%. ` +
        "앱 종료·크래시로 일부 유실은 자연스럽지만 이 비율은 종료 배선이 " +
        "샌다는 뜻이다. crashed/restarted 로 설명되는 몫과 하트비트만 남은 " +
        "에이전트를 같이 봐라.",
      observed: {
        spawnedEvents: snapshot.spawnedEvents,
        stoppedEvents: snapshot.stoppedEvents,
        crashedEvents: snapshot.crashedEvents,
        restartedEvents: snapshot.restartedEvents,
        stopRatioPct: Number((stopRatio * 100).toFixed(1)),
      },
    });
  }

  const livingShare =
    snapshot.spawnedAgentIds > 0
      ? snapshot.livingAgentsWithoutTerminal / snapshot.spawnedAgentIds
      : 0;
  if (
    snapshot.livingAgentsWithoutTerminal >= thresholds.minLivingUnterminated &&
    livingShare >= thresholds.maxLivingUnterminatedShare
  ) {
    findings.push({
      rule: "living_unterminated",
      severity: "red",
      message:
        `스폰된 agentId ${snapshot.spawnedAgentIds}개 중 ` +
        `${snapshot.livingAgentsWithoutTerminal}개는 하트비트가 있는데 ` +
        "stopped/crashed/restarted 가 0 이다. 안 돈 게 아니라 종료가 안 " +
        "남았다 — 종료 이벤트를 '아직 실행 중'으로 읽지 마라.",
      observed: {
        spawnedAgentIds: snapshot.spawnedAgentIds,
        livingAgentsWithoutTerminal: snapshot.livingAgentsWithoutTerminal,
        livingSharePct: Number((livingShare * 100).toFixed(1)),
      },
    });
  }

  if (
    snapshot.spawnersWithDispatchNoOutcome >=
    thresholds.minDispatchWithoutOutcomePeople
  ) {
    findings.push({
      rule: "dispatch_without_outcome",
      severity: "red",
      message:
        `스폰한 사람 ${snapshot.spawners}명 중 결과가 남은 사람은 ` +
        `${snapshot.outcomeUsers}명이다. 그중 디스패치는 있는데 ` +
        `task_outcomes 가 0인 사람이 ${snapshot.spawnersWithDispatchNoOutcome}명` +
        "이다. 퍼센트로 접지 마라. 이 숫자는 '안 했다'와 '했는데 안 남았다'를 " +
        "아직 한 칸에 둔다 — 사람별로 디스패치·하트비트·크래시를 갈라 읽어라.",
      observed: {
        spawners: snapshot.spawners,
        outcomeUsers: snapshot.outcomeUsers,
        spawnersWithDispatchNoOutcome: snapshot.spawnersWithDispatchNoOutcome,
      },
    });
  }

  const status = findings.reduce<PostSpawnSeverity>(
    (acc, f) => worst(acc, f.severity),
    "ok"
  );
  const lines =
    findings.length > 0
      ? findings.map((f) => `[${f.severity.toUpperCase()}] ${f.message}`)
      : [
          `스폰 ${snapshot.spawnedEvents} · 종료 ${snapshot.stoppedEvents} — ` +
            "커버리지 이상 없음.",
        ];

  return { status, findings, lines };
}
