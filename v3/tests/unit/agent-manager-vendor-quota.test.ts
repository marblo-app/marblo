/**
 * "벤더 쿼터 죽음" 판정 회귀 (티켓 zlJW7D3Kz8HzqXjXJCqE — #1500 의 나머지 절반).
 *
 * #1500 의 `sessionHasSuccessfulTurn` 은 "성공 턴이 있었나"만 말한다. 이
 * 파일은 **왜 없었나**를 좁힌다 — 재시도로 안 풀리는 비일시적 429(벤더
 * 쿼터/구독 소진)인지를, 같은 실사고 픽스처(`session-zero-turn-429.jsonl`,
 * `Y4wcieyXuaxHGBsV84gW`)로 고정한다.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  assistantLineIsNonTransientRateLimit,
  sessionShowsNonTransientRateLimit,
  readSessionRateLimitStatus,
} from "../../electron/agent-manager";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "fixtures",
  "session-zero-turn-429.jsonl",
);

function fixtureLines(): string[] {
  return fs.readFileSync(FIXTURE_PATH, "utf-8").split("\n");
}

describe("assistantLineIsNonTransientRateLimit — 개별 라인 판정(순수)", () => {
  it("비일시적 429 assistant 라인은 벤더 쿼터 죽음 신호다", () => {
    expect(
      assistantLineIsNonTransientRateLimit({
        type: "assistant",
        isApiErrorMessage: true,
        apiErrorStatus: 429,
        apiErrorIsTransient: false,
      }),
    ).toBe(true);
  });

  it("일시적(transient) 429 는 신호가 아니다 — 오탐 방지", () => {
    expect(
      assistantLineIsNonTransientRateLimit({
        type: "assistant",
        isApiErrorMessage: true,
        apiErrorStatus: 429,
        apiErrorIsTransient: true,
      }),
    ).toBe(false);
  });

  it("429 가 아닌 다른 상태코드는 신호가 아니다", () => {
    expect(
      assistantLineIsNonTransientRateLimit({
        type: "assistant",
        isApiErrorMessage: true,
        apiErrorStatus: 500,
        apiErrorIsTransient: false,
      }),
    ).toBe(false);
  });

  it("isApiErrorMessage 가 없으면(일반 assistant 턴) 신호가 아니다", () => {
    expect(
      assistantLineIsNonTransientRateLimit({
        type: "assistant",
        message: { model: "claude-sonnet-5" },
      }),
    ).toBe(false);
  });

  it("assistant 가 아닌 이벤트는 판정 대상이 아니다", () => {
    expect(
      assistantLineIsNonTransientRateLimit({
        type: "system",
        isApiErrorMessage: true,
        apiErrorStatus: 429,
        apiErrorIsTransient: false,
      }),
    ).toBe(false);
  });
});

describe("sessionShowsNonTransientRateLimit — 실사고 픽스처(Y4wcieyXuaxHGBsV84gW)", () => {
  it("★red→green: 사고 세션 전체가 비일시적 429 — 벤더 쿼터 죽음으로 판정한다", () => {
    const lines = fixtureLines();
    expect(sessionShowsNonTransientRateLimit(lines)).toBe(true);
  });

  it("뮤테이션 확인 — apiErrorIsTransient 를 true 로 뒤집으면 red 로 뒤집힌다", () => {
    const lines = fixtureLines();
    const mutated = lines.map((l) =>
      l.replace('"apiErrorIsTransient":false', '"apiErrorIsTransient":true'),
    );
    expect(sessionShowsNonTransientRateLimit(mutated)).toBe(false);
  });

  it("뮤테이션 확인 — apiErrorStatus 를 500 으로 바꾸면 red 로 뒤집힌다", () => {
    const lines = fixtureLines();
    const mutated = lines.map((l) =>
      l.replace('"apiErrorStatus":429', '"apiErrorStatus":500'),
    );
    expect(sessionShowsNonTransientRateLimit(mutated)).toBe(false);
  });

  it("정상 세션(에러 없음)은 신호가 없다", () => {
    const healthy = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-5" },
      }),
    ];
    expect(sessionShowsNonTransientRateLimit(healthy)).toBe(false);
  });

  it("빈 줄·파싱 불가 라인은 건너뛴다", () => {
    expect(sessionShowsNonTransientRateLimit(["", "   ", "{not json"])).toBe(
      false,
    );
  });
});

describe("readSessionRateLimitStatus — 파일 읽기 경로", () => {
  it("실제 사고 픽스처 파일을 읽으면 true(비일시적 429 확정)를 반환한다", () => {
    expect(readSessionRateLimitStatus(FIXTURE_PATH)).toBe(true);
  });

  it("파일이 없으면 null('모른다') — false('신호 없음')로 승격하지 않는다", () => {
    expect(
      readSessionRateLimitStatus(
        path.join(__dirname, "..", "fixtures", "no-such-session-file.jsonl"),
      ),
    ).toBeNull();
  });
});
