/**
 * Mission Replay — 집계 진입점 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §2.2 / §2.3 / §3.1.
 *
 * 완료된 미션 1건(`missions/{id}`) + 이미 구독 중인 주변 소스를 받아
 * `MissionReplay` 파생 뷰를 조립한다. **Firestore 에 아무것도 쓰지 않고, 새로
 * 계측하지도 않는다** — `computeShareStats` 와 같은 성격의 순수 집계다.
 *
 * ── 왜 미션 문서로 키잉하나 (설계 §2.1) ────────────────────────────────────
 * `ownerOrchestratorSessionId` 가 아니라 `missions/{missionId}` 다. 오케 PTY
 * 세션은 재시작되고(세션 id 가 바뀌어도 미션은 계속된다), 한 세션이 여러 미션을
 * 병렬로 돌리며, 미션 문서에만 `launchedAt`/`completedAt` 이라는 명확한 경계가 있다.
 *
 * I/O 없음. 시계도 주입받는다(`options.now`) — 테스트가 `generatedAt` 을 고정할 수
 * 있어야 골든 스냅샷(Phase 3~4)이 성립한다.
 */

import type { Mission } from "../../types/mission";
import type { Task } from "../../types/task";
import type {
  MissionReplay,
  ReplayBeat,
  ReplayCastMember,
  ReplaySource,
  ReplaySourceState,
  ReplayStats,
} from "../../types/missionReplay";
import type { ParsedCompletionReport } from "../completionReport";
import { parseCompletionReport } from "../completionReport";
import { computeShareStats, resolvePrUrl } from "../shareCard";
import {
  activitiesFor,
  buildReplayBeats,
  createReplayAliases,
  hasActivitySubscription,
  resolveAuditTaskId,
  selectMissionTasks,
  type MissionReplaySources,
} from "./beats";
import { buildMissionOutline } from "./missionOutline";

export type { MissionReplaySources, ReplayAuditLogRow } from "./beats";

/** 소스 키 전수 — `provenance.sources` 가 항상 6칸을 다 채우도록 강제한다. */
const ALL_SOURCES: readonly ReplaySource[] = [
  "mission.contextLog",
  "task",
  "task.activity",
  "audit_logs",
  "projectAuditLog",
  "merge_history",
];

export interface BuildMissionReplayOptions {
  /**
   * 소스별 **접근 결과**. 호출부(구독 계층)만 아는 사실이라 주입받는다.
   *
   * ★`denied` 를 안 주면 집계는 그 소스를 `empty` 로 본다 — "권한이 없어서
   * 못 읽었다"와 "읽었는데 0건이다"는 완전히 다른 사실이고, 화면에서 뭉개면
   * owner 는 그걸 기능 고장으로 읽는다(`lib/projectAuditView.ts` 가 같은 이유로
   * `denied` 와 `ready([])` 를 가른다). 특히 `projectAuditLog` 는 owner/admin
   * 전용이라(설계 C2) 일반 멤버 세션에서는 반드시 `denied` 를 넘겨야 한다.
   */
  sourceAccess?: Partial<Record<ReplaySource, ReplaySourceState>>;
  /** 집계 시각. 생략하면 현재 시각. */
  now?: Date;
  /**
   * 완료되지 않은 미션도 조립할 것인가. 기본 `false`(= 기존 계약 불변).
   *
   * ★"완료 미션만"은 **발행**의 규칙이지 로컬 미리보기의 규칙이 아니다. 진행 중인
   * 미션으로도 GIF 를 만들 수 있어야 사용자가 오늘 자기 미션을 고를 수 있고
   * (완료 미션이 0건인 프로젝트가 흔하다), 그렇다고 GIF 가 거짓말을 하지도
   * 않는다 — 결론 문구는 `completedAt`/`stats.tasksDone` 에서 파생되므로 진행
   * 중이면 진행 중이라고 그린다. 발행 경로는 여전히 막혀 있다
   * (`isReplayPublicationCandidate` 가 `completedAt !== null` 을 요구).
   */
  includeIncomplete?: boolean;
}

/**
 * Replay 대상인가 — `status === "completed"` 인 미션만(설계 §2.1).
 *
 * `abandoned` 는 Phase 1 리스트에 회색으로 노출하되 Replay 조립 대상이 아니다
 * ("실패도 콘텐츠"는 설계 Q1 미결 — 결정 전에 코드가 앞서 나가지 않는다).
 */
export function isReplayableMission(mission: Pick<Mission, "status">): boolean {
  return mission.status === "completed";
}

/**
 * 완료 미션 → `MissionReplay`. 완료 미션이 아니면 `null`.
 *
 * `null` 을 던지지 않고 돌려주는 이유: 호출부(리스트 뷰)는 진행 중 미션을 섞어
 * 순회하게 되는데, 그때 예외를 잡게 만들면 "완료가 아니다"라는 평범한 사실이
 * 에러 경로로 흘러 로그가 오염된다.
 */
export function buildMissionReplay(
  sources: MissionReplaySources,
  options: BuildMissionReplayOptions = {},
): MissionReplay | null {
  const { mission } = sources;
  if (!isReplayableMission(mission) && options.includeIncomplete !== true) {
    return null;
  }

  const missionTasks = selectMissionTasks(mission, sources.tasks);
  const aliases = createReplayAliases(sources);
  const beats = buildReplayBeats(sources, aliases);
  const reports = collectCompletionReports(missionTasks, sources);

  return {
    replayVersion: 1,
    missionId: mission.id,
    projectId: mission.projectId,
    goal: mission.goal,
    templateId: mission.templateId,
    launchedAt: mission.launchedAt,
    completedAt: mission.completedAt ?? null,
    stats: computeReplayStats(mission, missionTasks, reports, sources),
    cast: buildCast(missionTasks, beats, aliases, sources),
    beats,
    prUrls: collectPrUrls(missionTasks, reports),
    outline: buildMissionOutline(missionTasks, {
      prUrlByTaskId: Object.fromEntries(
        missionTasks.map((task) => [
          task.id,
          resolvePrUrl(task, reports[task.id] ?? null),
        ]),
      ),
    }),
    provenance: {
      sources: resolveProvenance(sources, options.sourceAccess),
      generatedAt: options.now ?? new Date(),
    },
  };
}

// ── 완료보고 ────────────────────────────────────────────────────

/**
 * taskId → 파싱된 완료보고.
 *
 * ★**activity 를 읽은 태스크만** 키를 만든다(값이 `null` 이어도 키는 만든다).
 * `computeShareStats` 가 "보고가 없더라(값 null)"와 "아직 안 읽었다(키 부재)"를
 * 키 존재 여부로 가르기 때문이다 — 리스너 상한 때문에 일부 태스크의 activity 만
 * 구독한 상황에서 heuristic 축(testsPassed/riskFlags)의 분모가 틀리면, 12/207 이
 * 12/12 처럼 읽힌다.
 *
 * 한 태스크에 완료보고가 여러 건이면 **가장 나중 것**을 쓴다(재제출한 보고가
 * 최신 사실이다).
 */
function collectCompletionReports(
  tasks: readonly Task[],
  sources: MissionReplaySources,
): Record<string, ParsedCompletionReport | null> {
  const reports: Record<string, ParsedCompletionReport | null> = {};
  for (const task of tasks) {
    // 안 읽은 태스크는 키를 만들지 않는다 — 그래야 분모(reportsScanned)가 맞는다.
    if (!hasActivitySubscription(sources.activitiesByTaskId, task.id)) continue;
    const activities = activitiesFor(sources.activitiesByTaskId, task.id);
    let latest: ParsedCompletionReport | null = null;
    let latestTs = -Infinity;
    for (const activity of activities) {
      const parsed = parseCompletionReport(activity.message);
      if (!parsed) continue;
      const ts =
        activity.createdAt instanceof Date
          ? activity.createdAt.getTime()
          : -Infinity;
      if (ts >= latestTs) {
        latest = parsed;
        latestTs = ts;
      }
    }
    reports[task.id] = latest;
  }
  return reports;
}

function collectPrUrls(
  tasks: readonly Task[],
  reports: Record<string, ParsedCompletionReport | null>,
): string[] {
  const urls = new Set<string>();
  for (const task of tasks) {
    const url = resolvePrUrl(task, reports[task.id] ?? null);
    if (url) urls.add(url);
  }
  return [...urls].sort();
}

// ── 통계 ────────────────────────────────────────────────────────

function computeReplayStats(
  mission: Mission,
  tasks: readonly Task[],
  reports: Record<string, ParsedCompletionReport | null>,
  sources: MissionReplaySources,
): ReplayStats {
  const doneTasks = tasks.filter((task) => task.status === "DONE");
  // testsPassed/riskFlags 는 완료보고 키워드 heuristic 이라 근사값이다.
  // 같은 함수를 쓰는 이유는 정확도가 아니라 **일관성** 이다 — 완료이력 탭의
  // 공유카드와 Replay 가 같은 미션에서 다른 수치를 말하면 둘 다 못 믿게 된다.
  const shareStats = computeShareStats(doneTasks, reports);

  const missionTaskIds = new Set(tasks.map((task) => task.id));
  let filesChanged = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  for (const entry of sources.mergeHistory ?? []) {
    if (!entry.taskId || !missionTaskIds.has(entry.taskId)) continue;
    filesChanged += entry.filesChanged ?? 0;
    linesAdded += entry.linesAdded ?? 0;
    linesDeleted += entry.linesDeleted ?? 0;
  }

  let retries = 0;
  let costTotal: number | null = null;
  const agentIds = new Set<string>();
  for (const task of tasks) {
    retries += task.retriesCount ?? 0;
    if (typeof task.costTotal === "number" && Number.isFinite(task.costTotal)) {
      costTotal = (costTotal ?? 0) + task.costTotal;
    }
    if (task.claimedBy) agentIds.add(task.claimedBy);
  }

  return {
    tasks: tasks.length,
    tasksDone: doneTasks.length,
    agents: agentIds.size,
    prs: shareStats.prs,
    filesChanged,
    linesAdded,
    linesDeleted,
    testsPassed: shareStats.testsPassed,
    riskFlags: shareStats.riskFlags,
    reportsScanned: shareStats.reportsScanned,
    retries,
    durationMs: computeDurationMs(mission),
    costTotal,
  };
}

/**
 * 소요 시간.
 *
 * 완료 미션이라 `completedAt` 이 있는 게 정상이지만, 옛 문서나 중간에 죽은
 * 경로에서 비어 있을 수 있어 `lastActivityAt` 으로 떨어진다. 음수(시계 역전)는
 * 0 으로 접는다 — "-3분 걸림"은 어떤 화면에서도 말이 안 된다.
 */
function computeDurationMs(mission: Mission): number {
  const start = mission.launchedAt?.getTime?.();
  const endSource = mission.completedAt ?? mission.lastActivityAt;
  const end = endSource?.getTime?.();
  if (typeof start !== "number" || typeof end !== "number") return 0;
  return Math.max(0, end - start);
}

// ── 캐스트 ──────────────────────────────────────────────────────

/**
 * 에이전트별 기여. 순서는 별칭 순서(= 미션 내 최초 등장 순)와 같다.
 *
 * `vendor`/`spawnedModel`/`detectedModelId` 는 서로 다른 축이다: 벤더는 하네스
 * 계열, spawnedModel 은 "무엇으로 띄웠나"(argv 되읽기), detectedModelId 는
 * "무엇이 실제로 과금됐나"(관측). 관측이 요청보다 강한 증거라 UI 는 뒤쪽을
 * 우선 쓰되, 셋 다 남겨야 폴백이 가능하다(`types/agent.ts` 주석).
 */
function buildCast(
  tasks: readonly Task[],
  beats: readonly ReplayBeat[],
  aliases: ReturnType<typeof createReplayAliases>,
  sources: MissionReplaySources,
): ReplayCastMember[] {
  const agentById = new Map(
    (sources.agents ?? []).map((agent) => [agent.id, agent]),
  );
  const beatCounts = new Map<string, number>();
  for (const beat of beats) {
    if (!beat.agentRef) continue;
    beatCounts.set(beat.agentRef, (beatCounts.get(beat.agentRef) ?? 0) + 1);
  }

  return aliases.agentIds.map((agentId) => {
    const agentRef = aliases.agentRef(agentId) ?? agentId;
    const agent = agentById.get(agentId);
    const claimed = tasks.filter((task) => task.claimedBy === agentId);
    return {
      agentRef,
      vendor: agent?.model ?? "unknown",
      spawnedModel: agent?.spawnedModel ?? null,
      detectedModelId: agent?.detectedModelId ?? null,
      // 에이전트 문서가 없으면(정리됐거나 다른 머신) 태스크의 역할로 떨어진다.
      role: agent?.role ?? claimed[0]?.role ?? "unknown",
      tasksCompleted: claimed.filter((task) => task.status === "DONE").length,
      beats: beatCounts.get(agentRef) ?? 0,
    };
  });
}

// ── 프로버넌스 ──────────────────────────────────────────────────

/**
 * 소스별 읽기 결과 6칸을 전부 채운다.
 *
 * 우선순위: 호출부가 명시한 접근 결과(`denied`/`ok`) → 실제로 데이터가 있으면
 * `ok` → 아니면 `empty`. 호출부가 `ok` 라고 했는데 0건이면 `empty` 로 내린다 —
 * 여기서 말하는 것은 "권한"이 아니라 "이 미션에 그 소스의 기록이 있었나"이고,
 * 빈 레인을 `ok` 로 표기하면 UI 가 빈 레인을 그리게 된다(설계 R4: 빈 레인을
 * 그리지 않는다).
 */
function resolveProvenance(
  sources: MissionReplaySources,
  access: Partial<Record<ReplaySource, ReplaySourceState>> | undefined,
): Record<ReplaySource, ReplaySourceState> {
  const missionTasks = selectMissionTasks(sources.mission, sources.tasks);
  const missionTaskIds = new Set(missionTasks.map((task) => task.id));

  const hasData: Record<ReplaySource, boolean> = {
    "mission.contextLog": (sources.mission.contextLog ?? []).length > 0,
    task: missionTasks.length > 0,
    "task.activity": missionTasks.some(
      (task) => activitiesFor(sources.activitiesByTaskId, task.id).length > 0,
    ),
    audit_logs: (sources.auditLogs ?? []).some((row) => {
      const taskId = resolveAuditTaskId(row);
      return !!taskId && missionTaskIds.has(taskId);
    }),
    projectAuditLog: (sources.projectAuditEvents ?? []).some(
      (event) => !!event.taskId && missionTaskIds.has(event.taskId),
    ),
    merge_history: (sources.mergeHistory ?? []).some(
      (entry) => !!entry.taskId && missionTaskIds.has(entry.taskId),
    ),
  };

  const result = {} as Record<ReplaySource, ReplaySourceState>;
  for (const source of ALL_SOURCES) {
    if (access?.[source] === "denied") {
      result[source] = "denied";
      continue;
    }
    result[source] = hasData[source] ? "ok" : "empty";
  }
  return result;
}
