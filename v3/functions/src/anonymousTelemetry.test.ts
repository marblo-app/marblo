import test from "node:test";
import assert from "node:assert/strict";

import {
  ANONYMOUS_TELEMETRY_EVENTS,
  anonymousTelemetryReceiptDocId,
  filterAlreadyLoggedAnonymousEvents,
  parseAnonymousTelemetryBatch,
} from "./anonymousTelemetry";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_EVENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-26T00:00:00.000Z";

test("익명 허용목록 이벤트만 통과하고 목록 밖 이벤트는 거부된다", () => {
  for (const event of ANONYMOUS_TELEMETRY_EVENTS) {
    const parsed = parseAnonymousTelemetryBatch(
      {
        events: [
          {
            event,
            clientId: CLIENT_ID,
            clientEventId: EVENT_ID,
          },
        ],
      },
      NOW
    );
    assert.equal(parsed.ok, true, `${event} should be anonymous-allowed`);
  }

  const rejected = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "agent:spawned",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
        },
      ],
    },
    NOW
  );
  assert.deepEqual(rejected, { ok: false, reason: "event_not_allowed" });
});

test("익명 이벤트는 계정 식별자와 원시 작업 조인키를 싣지 못한다", () => {
  const metadataUid = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "auth:login_failed",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
          metadata: { method: "google", uid: "account_uid" },
        },
      ],
    },
    NOW
  );
  assert.deepEqual(metadataUid, {
    ok: false,
    reason: "metadata_account_identifier",
  });

  const topLevelUserId = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "app:first_run",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
          userId: "account_uid",
        },
      ],
    },
    NOW
  );
  assert.deepEqual(topLevelUserId, {
    ok: false,
    reason: "forbidden_top_level_field",
  });

  const projectJoinKey = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "onboarding:demo_started",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
          projectId: "project_123",
          metadata: { surface: "auth_screen" },
        },
      ],
    },
    NOW
  );
  assert.deepEqual(projectJoinKey, {
    ok: false,
    reason: "forbidden_top_level_field",
  });
});

test("익명 metadata 는 이벤트별 좁은 스키마만 허용한다", () => {
  const parsed = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "onboarding:demo_started",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
          metadata: { surface: "auth_screen" },
        },
      ],
    },
    NOW
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.rows[0]?.metadata, { surface: "auth_screen" });
  }

  const rejected = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "onboarding:demo_started",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
          metadata: { surface: "auth_screen", arbitrary: "nope" },
        },
      ],
    },
    NOW
  );
  assert.deepEqual(rejected, {
    ok: false,
    reason: "metadata_key_not_allowed",
  });
});

test("익명 전송 영수증이 있으면 로그인 후 같은 clientEventId 는 다시 적재하지 않는다", () => {
  const receiptId = anonymousTelemetryReceiptDocId(CLIENT_ID, EVENT_ID);
  const split = filterAlreadyLoggedAnonymousEvents(
    [
      {
        event: "app:first_run",
        clientId: CLIENT_ID,
        clientEventId: EVENT_ID,
      },
      {
        event: "auth:login_success",
        clientId: CLIENT_ID,
        clientEventId: OTHER_EVENT_ID,
      },
    ],
    new Set([receiptId])
  );

  assert.equal(split.skipped, 1);
  assert.deepEqual(split.fresh, [
    {
      event: "auth:login_success",
      clientId: CLIENT_ID,
      clientEventId: OTHER_EVENT_ID,
    },
  ]);
});

test("같은 익명 배치 안의 clientEventId 중복은 거부된다", () => {
  const rejected = parseAnonymousTelemetryBatch(
    {
      events: [
        {
          event: "app:first_run",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
        },
        {
          event: "auth:login_attempt",
          clientId: CLIENT_ID,
          clientEventId: EVENT_ID,
          metadata: { method: "google" },
        },
      ],
    },
    NOW
  );
  assert.deepEqual(rejected, {
    ok: false,
    reason: "duplicate_client_event_id",
  });
});
