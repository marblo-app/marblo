/** Mission Replay's single boundary into the shared redaction primitive. */
import { redactAndVerify } from "../redact/redact";
import { filterBeatsForVisibility } from "./sensitivity";
import type {
  MissionReplay,
  RedactedReplay,
  RedactionRemoval,
  ReplayVisibilityLevel,
} from "../../types/missionReplay";
import type { RedactLevel, RedactFinding } from "../../types/redact";

export interface ReplayRedactionOptions {
  level: Exclude<ReplayVisibilityLevel, "L0">;
  includeCost?: boolean;
  publicRepos?: readonly string[];
  salt?: string;
  credit?: { enabled: boolean; handle?: string };
}

/** Completed missions are the only publication candidates by default. */
export function isReplayPublicationCandidate(
  replay: MissionReplay,
  includeIncomplete = false,
): boolean {
  return includeIncomplete || replay.completedAt !== null;
}

/**
 * 개요 → 발행 입력.
 *
 * `outline` 이 없는 Replay 객체(발행 이전 버전에서 만들어졌거나 저장된 페이로드
 * 를 되읽은 경우)도 여기서 조용히 빈 개요로 떨어진다 — 경계 함수가 옛 모양
 * 하나에 throw 하면 공유가 통째로 죽는다.
 */
function outlineInput(replay: MissionReplay): Record<string, unknown> {
  const outline = replay.outline;
  return {
    tasks: (outline?.tasks ?? []).map((item) => ({
      ref: item.ref,
      title: item.title,
      prNumber: item.prNumber,
      dependsOn: item.dependsOn,
      done: item.done,
    })),
    mergeOrder: outline?.mergeOrder ?? [],
    hasDependencies: outline?.hasDependencies ?? false,
    truncated: outline?.truncated ?? 0,
  };
}

function publicationInput(
  replay: MissionReplay,
  options: ReplayRedactionOptions,
): Record<string, unknown> {
  const { stats } = replay;
  // ★등급 게이트를 1차로 통과한 비트만 레닭션에 넣는다. private 비트(자유
  // 텍스트 진행 로그·감독자 노트 등)를 그대로 넣으면 2차 검증이 깨져
  // Card/GIF 생성이 전부 막힌다 — 발행 표면 밖 비트는 애초에 경계 밖으로
  // 나가지 않아야 한다(설계 §5.2 / filterBeatsForVisibility).
  const visibleBeats = filterBeatsForVisibility(replay.beats, options.level);
  const input: Record<string, unknown> = {
    goal: replay.goal,
    templateId: replay.templateId,
    launchedAt: replay.launchedAt.toISOString(),
    completedAt: replay.completedAt?.toISOString() ?? null,
    durationMs: stats.durationMs,
    stats: {
      tasks: stats.tasks,
      tasksDone: stats.tasksDone,
      agents: stats.agents,
      prs: stats.prs,
      filesChanged: stats.filesChanged,
      linesAdded: stats.linesAdded,
      linesDeleted: stats.linesDeleted,
      testsPassed: stats.testsPassed,
      riskFlags: stats.riskFlags,
      reportsScanned: stats.reportsScanned,
      retries: stats.retries,
      costTotal: stats.costTotal,
    },
    cast: replay.cast.map((member) => ({
      agentRef: member.agentRef,
      vendor: member.vendor,
      spawnedModel: member.spawnedModel,
      detectedModelId: member.detectedModelId,
      role: member.role,
      tasksCompleted: member.tasksCompleted,
      beats: member.beats,
    })),
    beats: visibleBeats.map((beat) => ({
      id: beat.id,
      ts: beat.ts.toISOString(),
      lane: beat.lane,
      source: beat.source,
      kind: beat.kind,
      taskId: beat.taskId,
      agentRef: beat.agentRef,
      actorRef: beat.actorRef,
      title: beat.title,
      detail: beat.detail,
      sensitivity: beat.sensitivity,
    })),
    // ★개요는 등급과 무관하게 나간다 — 담긴 것이 제목·PR **번호**·의존 ref 뿐이라
    // L1(과정만)에서도 공개 가능한 사실이다. 저장소 좌표를 담는 `prUrl` 은 아래
    // 에서 여전히 L1 drop / L2+ repoGate 로 따로 처리된다(번호와 URL 은 다른 축).
    outline: outlineInput(replay),
  };

  // L1 is deliberately process-only; L2 adds only the already-public PR surface.
  if (options.level !== "L1") input.prUrl = replay.prUrls;
  if (options.credit?.enabled) {
    input.credits = { mode: "credited", handle: options.credit.handle ?? "" };
  } else {
    input.credits = { mode: "anonymous" };
  }
  return input;
}

/**
 * 개요에서 통과시킬 키 전수.
 *
 * ★열거형이라 새 필드는 자동으로 안 나간다(§5.2 default-deny). `prUrl` 은 여기
 * 없다 — 개요가 싣는 것은 URL 이 아니라 정수 `prNumber` 다.
 */
const OUTLINE_SAFE_KEYS = new Set([
  "outline",
  "tasks",
  "ref",
  "title",
  "prNumber",
  "dependsOn",
  "done",
  "mergeOrder",
  "hasDependencies",
  "truncated",
]);

function removed(findings: RedactFinding[]): RedactionRemoval[] {
  return findings.map(({ path, rule, action }) => ({ path, rule, action }));
}

/**
 * Returns a fully serialized, independently verified RedactedReplay. Consumers
 * must accept this type, never MissionReplay, at an upload/export boundary.
 */
export function redactReplay(
  replay: MissionReplay,
  options: ReplayRedactionOptions,
): RedactedReplay {
  const level = options.level as RedactLevel;
  const result = redactAndVerify(publicationInput(replay, options), {
    level,
    includeCost: options.includeCost === true,
    publicRepos: options.publicRepos,
    salt: options.salt ?? replay.missionId,
    classifyOverride: (key, path) => {
      // 개요 하위 키만 — 경로로 스코프한다. 전역으로 열면 언젠가 다른 곳에
      // 생길 동명 필드(`ref`/`done`)까지 조용히 통과한다(default-deny 훼손).
      if (path === "outline" || path.startsWith("outline.")) {
        if (OUTLINE_SAFE_KEYS.has(key)) return "structuredSafe";
      }
      if (
        [
          "tasksDone",
          "agents",
          "prs",
          "filesChanged",
          "linesAdded",
          "linesDeleted",
          "testsPassed",
          "riskFlags",
          "reportsScanned",
          "retries",
          "agentRef",
          "spawnedModel",
          "detectedModelId",
          "tasksCompleted",
          "beats",
          "mode",
          "handle",
          "credits",
        ].includes(key)
      )
        return key === "agentRef" ? "agentId" : "structuredSafe";
      if (key === "prUrl") return "repoIdentifier";
      if (key === "actorRef") return "personId";
      if (key === "ts" || key === "launchedAt" || key === "completedAt")
        return "timestamp";
      return undefined;
    },
  });
  const serialized =
    result.serialized ?? JSON.stringify(result.payload ?? null, null, 2);
  return {
    level: options.level,
    payload: result.payload ?? null,
    serialized,
    removed: removed(result.findings),
    verified: result.ok,
  };
}
