// telemetryIdentityAxis 단위테스트 (ticket GCNpqvDYRrLhyLghPCF9).
// 실행: npm run test:telemetry-identity-axis
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COST_LOGS_REQUIRES_AUTH,
  USERID_COLUMN_RENAME,
  canJoinUserId,
  personAxisOf,
} from "./telemetryIdentityAxis";

test("events/task_outcomes/heartbeats 는 설치 clientId 축이고 서로 조인된다", () => {
  assert.equal(personAxisOf("events"), "install_client_id");
  assert.equal(personAxisOf("task_outcomes"), "install_client_id");
  assert.equal(personAxisOf("agent_heartbeats"), "install_client_id");
  assert.equal(canJoinUserId("events", "task_outcomes"), true);
  assert.equal(canJoinUserId("events", "agent_heartbeats"), true);
});

test("cost_logs.userId 는 Firebase uid 라 events 와 조인하면 안 된다", () => {
  assert.equal(personAxisOf("cost_logs"), "firebase_uid");
  assert.equal(canJoinUserId("events", "cost_logs"), false);
  assert.equal(canJoinUserId("task_outcomes", "cost_logs"), false);
  assert.equal(canJoinUserId("agent_heartbeats", "cost_logs"), false);
});

test("컬럼 개명 안은 userId 라는 같은 이름을 축별로 가른다", () => {
  assert.equal(USERID_COLUMN_RENAME.events.proposed, "installClientId");
  assert.equal(USERID_COLUMN_RENAME.task_outcomes.proposed, "installClientId");
  assert.equal(
    USERID_COLUMN_RENAME.agent_heartbeats.proposed,
    "installClientId"
  );
  assert.equal(USERID_COLUMN_RENAME.cost_logs.proposed, "firebaseUid");
});

test("미인증 사용자 비용은 cost_logs 에 안 쌓인다", () => {
  assert.equal(COST_LOGS_REQUIRES_AUTH, true);
});
