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
    classifyOverride: (key) => {
      if ([
        "tasksDone", "agents", "prs", "filesChanged", "linesAdded", "linesDeleted",
        "testsPassed", "riskFlags", "reportsScanned", "retries", "agentRef",
        "spawnedModel", "detectedModelId", "tasksCompleted", "beats", "mode", "handle",
        "credits",
      ].includes(key)) return key === "agentRef" ? "agentId" : "structuredSafe";
      if (key === "prUrl") return "repoIdentifier";
      if (key === "actorRef") return "personId";
      if (key === "ts" || key === "launchedAt" || key === "completedAt") return "timestamp";
      return undefined;
    },
  });
  const serialized = result.serialized ?? JSON.stringify(result.payload ?? null, null, 2);
  return {
    level: options.level,
    payload: result.payload ?? null,
    serialized,
    removed: removed(result.findings),
    verified: result.ok,
  };
}
