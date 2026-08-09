import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MAX_SAMPLES_PER_BATCH,
  MAX_TEXT_CHARS,
  resolveCaptureGate,
  toTrainingRow,
  toTrainingRows,
} from "./trainingCapture";

const ADMIN = "admin-uid-123";
const OTHER = "someone-else-456";

function sample(overrides: Record<string, unknown> = {}) {
  return {
    sampleId: "session-1:turn-1",
    schemaVersion: 1,
    capturedAt: "2026-08-09T01:02:03.000Z",
    turnTimestamp: "2026-08-09T01:02:00.000Z",
    harness: "claude",
    source: "agent",
    messageRole: "user",
    turnKey: "turn-1",
    text: "fix the login bug",
    thinking: "",
    ...overrides,
  };
}

describe("resolveCaptureGate", () => {
  it("allows the admin with no stored flag (self-consent default ON)", () => {
    const gate = resolveCaptureGate(ADMIN, ADMIN, null);
    assert.equal(gate.eligible, true);
    assert.equal(gate.consent, true);
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "ok");
  });

  it("honours an explicit admin opt-out", () => {
    const gate = resolveCaptureGate(ADMIN, ADMIN, {
      privacyConsent: { trainingDataCapture: false },
    });
    assert.equal(gate.eligible, true);
    assert.equal(gate.consent, false);
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "no_consent");
  });

  it("refuses every other user, even one whose flag says true", () => {
    const gate = resolveCaptureGate(OTHER, ADMIN, {
      privacyConsent: { trainingDataCapture: true },
    });
    assert.equal(gate.eligible, false);
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "not_admin");
  });

  it("refuses when ADMIN_UID is unset — misconfiguration is not permission", () => {
    for (const admin of [undefined, null, "", "   "]) {
      const gate = resolveCaptureGate(ADMIN, admin, null);
      assert.equal(gate.allowed, false, `admin=${JSON.stringify(admin)}`);
      assert.equal(gate.reason, "server_unconfigured");
    }
  });

  it("refuses an unauthenticated / empty uid", () => {
    assert.equal(resolveCaptureGate(null, ADMIN, null).allowed, false);
    assert.equal(resolveCaptureGate("", ADMIN, null).allowed, false);
  });
});

describe("toTrainingRow", () => {
  const ingestedAt = "2026-08-09T02:00:00.000Z";

  it("stamps the account and preserves the raw text", () => {
    const row = toTrainingRow(sample(), ADMIN, ingestedAt);
    assert.ok(row);
    assert.equal(row.accountUserId, ADMIN);
    assert.equal(row.text, "fix the login bug");
    assert.equal(row.ingestedAt, ingestedAt);
  });

  it("drops a sample with no id", () => {
    assert.equal(
      toTrainingRow(sample({ sampleId: "" }), ADMIN, ingestedAt),
      null,
    );
  });

  it("drops a sample with no content at all", () => {
    const row = toTrainingRow(
      sample({ text: "", thinking: "", toolCalls: null, toolResults: null }),
      ADMIN,
      ingestedAt,
    );
    assert.equal(row, null);
  });

  it("keeps a tool-only turn (no text, but real trajectory signal)", () => {
    const row = toTrainingRow(
      sample({ text: "", toolCalls: '[{"name":"Read","input":"a.ts"}]' }),
      ADMIN,
      ingestedAt,
    );
    assert.ok(row);
    assert.equal(row.text, null);
    assert.ok(row.toolCalls);
  });

  it("caps oversized text server-side rather than trusting the client", () => {
    const row = toTrainingRow(
      sample({ text: "x".repeat(MAX_TEXT_CHARS + 5_000) }),
      ADMIN,
      ingestedAt,
    );
    assert.ok(row);
    assert.equal(row.text?.length, MAX_TEXT_CHARS);
  });

  it("nulls an unparseable timestamp instead of failing the whole batch", () => {
    const row = toTrainingRow(
      sample({ turnTimestamp: "not-a-date", capturedAt: "also-not" }),
      ADMIN,
      ingestedAt,
    );
    assert.ok(row);
    assert.equal(row.turnTimestamp, null);
    // capturedAt falls back to ingest time — a row always has one usable clock.
    assert.equal(row.capturedAt, ingestedAt);
  });

  it("rejects non-object samples", () => {
    for (const bad of [null, undefined, 42, "str", []]) {
      assert.equal(toTrainingRow(bad, ADMIN, ingestedAt), null);
    }
  });
});

describe("toTrainingRows", () => {
  const ingestedAt = "2026-08-09T02:00:00.000Z";

  it("counts skipped samples instead of silently shrinking the batch", () => {
    const { rows, skipped } = toTrainingRows(
      [sample(), sample({ sampleId: "" }), sample({ sampleId: "s:2" })],
      ADMIN,
      ingestedAt,
    );
    assert.equal(rows.length, 2);
    assert.equal(skipped, 1);
  });

  it("never maps more than the batch ceiling", () => {
    const many = Array.from({ length: MAX_SAMPLES_PER_BATCH + 10 }, (_, i) =>
      sample({ sampleId: `s:${i}` }),
    );
    const { rows } = toTrainingRows(many, ADMIN, ingestedAt);
    assert.equal(rows.length, MAX_SAMPLES_PER_BATCH);
  });

  it("returns empty for a non-array payload", () => {
    assert.deepEqual(toTrainingRows("nope", ADMIN, ingestedAt), {
      rows: [],
      skipped: 0,
    });
  });
});
