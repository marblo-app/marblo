/**
 * 수락→다운로드 문맥 파서 — ★어떤 원문이 와도 던지지 않고, 이상하면 전부
 * null(배너 없음 = 개인 경로 기본 화면)로 접힌다는 규약을 고정한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTeamDownloadContext,
  TEAM_DOWNLOAD_CONTEXT_TTL_MS,
} from "./teamDownloadContext";

const NOW = Date.parse("2026-08-31T09:00:00.000Z");

function raw(orgDisplayName: unknown, savedAtMs: unknown): string {
  return JSON.stringify({ orgDisplayName, savedAtMs });
}

test("정상 문맥을 읽는다", () => {
  const ctx = parseTeamDownloadContext(raw("하이프마크", NOW - 1000), NOW);
  assert.equal(ctx?.orgDisplayName, "하이프마크");
});

test("TTL 이 지난 문맥은 배너를 그리지 않는다", () => {
  const stale = NOW - TEAM_DOWNLOAD_CONTEXT_TTL_MS - 1;
  assert.equal(parseTeamDownloadContext(raw("하이프마크", stale), NOW), null);
});

test("미래 시각·손상 JSON·타입 오염·과대 이름은 전부 null", () => {
  assert.equal(
    parseTeamDownloadContext(raw("하이프마크", NOW + 60_000), NOW),
    null
  );
  assert.equal(parseTeamDownloadContext("{not json", NOW), null);
  assert.equal(parseTeamDownloadContext(raw(42, NOW), NOW), null);
  assert.equal(parseTeamDownloadContext(raw("  ", NOW), NOW), null);
  assert.equal(parseTeamDownloadContext(raw("x".repeat(81), NOW), NOW), null);
  assert.equal(parseTeamDownloadContext(null, NOW), null);
  assert.equal(parseTeamDownloadContext(JSON.stringify([1]), NOW), null);
});
