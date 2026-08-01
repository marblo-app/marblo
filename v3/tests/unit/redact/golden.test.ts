/**
 * §5.6 test 5 — 골든 스냅샷: 대표 미션 1건 × 3등급.
 * 스냅샷이 바뀌면 리뷰 필수 — 비식별화 "완화"가 조용히 머지되는 것을 막는
 * 가드다. 스냅샷 갱신(-u)은 의도적 변경일 때만.
 */
import { describe, it, expect } from "vitest";
import { redact, redactAndVerify } from "../../../src/lib/redact/redact";
import type { RedactLevel } from "../../../src/types/redact";

const PUBLIC_REPO = "https://github.com/marblo-app/marblo";

/** 대표 미션 — 실측 형태를 본뜬 가짜 데이터(실명·실키 없음). */
const MISSION_FIXTURE = {
  goal: "Ship the replay redaction engine safely",
  template: "feature-dev",
  status: "DONE",
  startedAt: 1753924800000,
  endedAt: 1753939200000,
  costTotal: 12.34,
  actorName: "김파운더",
  repoUrl: PUBLIC_REPO,
  branch: "feature/redact-core",
  stats: { fileCount: 7, lineCount: 1450, stepCount: 5 },
  tasks: [
    {
      id: "aB3cD4eF5gH6iJ7kL8m9",
      title: "Implement redaction core #731",
      status: "REVIEW",
      agentId: "agent-uuid-1111",
      vendor: "claude",
      model: "claude-fable-5",
      durationMs: 5400000,
      startedAt: 1753926600000,
      scope: ["src/lib/redact/redact.ts", "src/types/redact.ts"],
      prUrl: `${PUBLIC_REPO}/pull/731`,
      summary: {
        problem: "Secrets could leak into shared replays",
        approach: "Two independent scan passes with default-deny",
        verification: "tsc and vitest green, corpus suite passes",
      },
    },
    {
      id: "zY9xW8vU7tS6rQ5pO4n3",
      title: "Review pass by second agent",
      status: "DONE",
      agentId: "agent-uuid-2222",
      vendor: "gpt",
      model: "gpt-5.5",
      durationMs: 1800000,
      startedAt: 1753930200000,
      scope: ["tests/unit/redact"],
      summary: {
        problem: "Cross-check for missed bypass vectors",
        approach: "Adversarial review of rule ordering",
        verification: "No additional bypass found",
      },
    },
  ],
};

const LEVELS: RedactLevel[] = ["L1", "L2", "L3"];

describe("golden snapshots — 1 mission × 3 levels", () => {
  for (const level of LEVELS) {
    it(`level ${level}`, () => {
      const result = redact(MISSION_FIXTURE, {
        level,
        publicRepos: [PUBLIC_REPO],
        baseTimeMs: 1753924800000,
      });
      expect({
        payload: result.payload,
        findings: result.findings,
      }).toMatchSnapshot();
    });

    it(`level ${level} passes the full publish pipeline (verify ok)`, () => {
      const guarded = redactAndVerify(MISSION_FIXTURE, {
        level,
        publicRepos: [PUBLIC_REPO],
        baseTimeMs: 1753924800000,
      });
      expect(guarded.verifyFindings).toEqual([]);
      expect(guarded.ok).toBe(true);
      expect(guarded.serialized).toBeDefined();
    });
  }
});
