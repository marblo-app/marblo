import { test } from "node:test";
import assert from "node:assert/strict";
import {
  progressDocId,
  isCompleted,
  resumeSeconds,
  COMPLETE_RATIO,
  type LectureProgress,
} from "./lectureProgress";

test("progressDocId composes and sanitizes unsafe chars", () => {
  assert.equal(progressDocId("u1", "slug", "abc"), "u1__slug__abc");
  // '/' 및 기타 문자는 '_' 로 치환 (Firestore 문서 ID 안전)
  assert.equal(progressDocId("u/1", "s g", "a.b"), "u_1__s_g__a_b");
});

test("isCompleted uses the completion ratio", () => {
  assert.equal(isCompleted(96, 100), true);
  assert.equal(isCompleted(95, 100), true); // 정확히 임계값
  assert.equal(isCompleted(94, 100), false);
  // 길이 미상/0 은 완료로 보지 않음
  assert.equal(isCompleted(50, 0), false);
  assert.equal(isCompleted(10, -1), false);
  assert.ok(COMPLETE_RATIO > 0 && COMPLETE_RATIO <= 1);
});

test("resumeSeconds returns rewound position, 0 when done/near-end", () => {
  assert.equal(resumeSeconds(null), 0);
  const mid: LectureProgress = {
    userId: "u",
    lectureSlug: "s",
    youtubeId: "y",
    positionSeconds: 120,
    durationSeconds: 600,
    completed: false,
  };
  assert.equal(resumeSeconds(mid), 117); // 3초 되감기
  // 완료 플래그면 처음부터
  assert.equal(resumeSeconds({ ...mid, completed: true }), 0);
  // 완료 플래그 없어도 거의 끝까지 봤으면 처음부터
  assert.equal(resumeSeconds({ ...mid, positionSeconds: 595 }), 0);
  // 되감기가 음수로 가지 않음
  assert.equal(resumeSeconds({ ...mid, positionSeconds: 1 }), 0);
});
