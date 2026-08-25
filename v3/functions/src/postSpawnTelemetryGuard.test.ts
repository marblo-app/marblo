// postSpawnTelemetryGuard 순수 로직 단위테스트 (ticket GCNpqvDYRrLhyLghPCF9).
// 실행:
//   npm run test:post-spawn-guard
//
// ★이 파일의 첫 테스트는 2026-08-25 BQ 실측을 그대로 넣어 RED 가 나는 것을
//   못박는다. 검사가 지금 상태를 통과하면 그 검사는 아무것도 지키지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_2026_08_25,
  auditPostSpawnTelemetry,
  type PostSpawnSnapshot,
} from "./postSpawnTelemetryGuard";

test("★지금 상태(2026-08-25 실측, 36자 clientId)에서 RED 가 난다 — 통과하면 검사가 아니다", () => {
  const report = auditPostSpawnTelemetry(LIVE_2026_08_25);
  assert.equal(report.status, "red");

  const byRule = (rule: string) => report.findings.find((f) => f.rule === rule);

  const stop = byRule("stop_ratio_low");
  assert.ok(stop, "스폰 대비 종료 비율을 못 잡았다");
  assert.equal(stop!.severity, "red");
  assert.equal(stop!.observed.spawnedEvents, 5840);
  assert.equal(stop!.observed.stoppedEvents, 1570);

  const living = byRule("living_unterminated");
  assert.ok(living, "하트비트는 있는데 종료가 없는 에이전트를 못 잡았다");
  assert.equal(living!.severity, "red");
  assert.equal(living!.observed.livingAgentsWithoutTerminal, 1518);

  const outcome = byRule("dispatch_without_outcome");
  assert.ok(outcome, "디스패치 후 결과가 0인 사람 수를 못 잡았다");
  assert.equal(outcome!.severity, "red");
  assert.equal(outcome!.observed.spawners, 17);
  assert.equal(outcome!.observed.outcomeUsers, 7);
  assert.equal(outcome!.observed.spawnersWithDispatchNoOutcome, 6);
});

test("건강한 스냅샷은 ok 이고 발견이 없다", () => {
  const healthy: PostSpawnSnapshot = {
    spawnedEvents: 100,
    stoppedEvents: 88,
    crashedEvents: 6,
    restartedEvents: 8,
    spawners: 12,
    outcomeUsers: 11,
    spawnersWithDispatchNoOutcome: 0,
    livingAgentsWithoutTerminal: 2,
    spawnedAgentIds: 90,
  };
  const report = auditPostSpawnTelemetry(healthy);
  assert.equal(report.status, "ok");
  assert.equal(report.findings.length, 0);
});

test("원천이 너무 작으면 침묵한다 — 0을 건강으로 접지 않는다", () => {
  const tiny: PostSpawnSnapshot = {
    spawnedEvents: 3,
    stoppedEvents: 0,
    crashedEvents: 0,
    restartedEvents: 0,
    spawners: 2,
    outcomeUsers: 0,
    spawnersWithDispatchNoOutcome: 1,
    livingAgentsWithoutTerminal: 2,
    spawnedAgentIds: 3,
  };
  const report = auditPostSpawnTelemetry(tiny);
  assert.equal(report.status, "ok");
  assert.ok(
    report.lines.some((line) => line.includes("판정할 근거가 없다")),
    "표본 부족을 건강으로 읽으면 안 된다"
  );
});
