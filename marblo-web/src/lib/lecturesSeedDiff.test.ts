import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDocDiff,
  deepEqual,
  MANAGED_EXCLUDE,
  renderDocDiff,
} from "./lecturesSeedDiff";
import { lectures, type LectureData } from "@/data/lectures";

const seed = lectures[0];

/** computeDocDiff 가 만들 payload 를 Firestore set(merge:true) 처럼 적용한다. */
function applyDiff(
  remote: Record<string, unknown> | undefined,
  lecture: LectureData
): Record<string, unknown> {
  const diff = computeDocDiff(lecture, remote);
  const next = { ...(remote ?? {}) };
  for (const f of diff.diffs) next[f.field] = f.after;
  next.updatedAt = "server-timestamp";
  if (!diff.exists) next.createdAt = "server-timestamp";
  return next;
}

/**
 * slug 은 문서 ID 라 문서 본문에는 들어가지 않는다.
 *
 * LectureData 는 interface 라 암묵적 index signature 가 없어서
 * `as Record<string, unknown>` 캐스팅이 TS2352 로 막힌다. 그 타입은 결제
 * 페이지에 나가는 데이터의 계약이라 테스트 편의로 느슨하게 만들지 않는다.
 * entries → fromEntries 로 되돌리면 캐스팅 없이 같은 값을 얻는다.
 */
function seedFields(lecture: LectureData): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(structuredClone(lecture)).filter(([key]) => key !== "slug")
  );
}

function remoteFromSeed(lecture: LectureData): Record<string, unknown> {
  return seedFields(lecture);
}

test("시드와 동일한 문서는 변경 필드가 0개다", () => {
  const diff = computeDocDiff(seed, remoteFromSeed(seed));
  assert.equal(diff.diffs.length, 0);
  assert.equal(diff.exists, true);
});

test("멱등: 한 번 적용한 뒤 다시 계산하면 변경 필드가 0개다", () => {
  // 문서가 아예 없는 상태에서 시작 → 전 필드 기록 → 재계산하면 차이가 없어야 한다.
  const afterFirst = applyDiff(undefined, seed);
  const second = computeDocDiff(seed, afterFirst);
  assert.equal(second.diffs.length, 0, "2회차에 또 쓰면 멱등이 아니다");

  const afterSecond = applyDiff(afterFirst, seed);
  const third = computeDocDiff(seed, afterSecond);
  assert.equal(third.diffs.length, 0, "3회차도 변경이 없어야 한다");
});

test("createdAt / updatedAt 은 비교 대상이 아니다", () => {
  const remote = remoteFromSeed(seed);
  remote.createdAt = "옛날";
  remote.updatedAt = "옛날";
  const diff = computeDocDiff(seed, remote);
  assert.equal(diff.diffs.length, 0);
  for (const f of MANAGED_EXCLUDE) {
    assert.ok(!diff.extraInRemote.includes(f));
  }
});

test("문자열 필드가 다르면 changed 로, 없으면 added 로 잡는다", () => {
  const remote = remoteFromSeed(seed);
  remote.courseStartDate_ko = "2020년 1월 1일";
  delete remote.enrollmentFailurePolicy_ja;

  const diff = computeDocDiff(seed, remote);
  const byField = new Map(diff.diffs.map((d) => [d.field, d]));

  assert.equal(byField.get("courseStartDate_ko")?.kind, "changed");
  assert.equal(byField.get("courseStartDate_ko")?.before, "2020년 1월 1일");
  assert.equal(
    byField.get("courseStartDate_ko")?.after,
    seed.courseStartDate_ko
  );
  assert.equal(byField.get("enrollmentFailurePolicy_ja")?.kind, "added");
  assert.equal(diff.diffs.length, 2);
});

test("커리큘럼(modules) 의 깊은 변경과 순서 변경을 잡는다", () => {
  const remote = remoteFromSeed(seed);
  const mods = remote.modules as LectureData["modules"];

  // 중첩된 강의 제목 한 글자만 바꿔도 잡혀야 한다.
  const deep = structuredClone(mods);
  deep[0].sections[0].title = `${deep[0].sections[0].title} (구버전)`;
  remote.modules = deep;
  assert.equal(
    computeDocDiff(seed, remote).diffs.some((d) => d.field === "modules"),
    true,
    "중첩 필드 변경을 놓쳤다"
  );

  // 순서만 뒤집어도 잡혀야 한다 — 커리큘럼은 순서가 의미다.
  const reordered = structuredClone(mods).reverse();
  remote.modules = reordered;
  assert.equal(
    computeDocDiff(seed, remote).diffs.some((d) => d.field === "modules"),
    true,
    "배열 순서 변경을 놓쳤다"
  );
});

test("문서가 없으면 전 필드를 added 로 보고한다", () => {
  const diff = computeDocDiff(seed, undefined);
  assert.equal(diff.exists, false);
  assert.equal(diff.diffs.length, Object.keys(seedFields(seed)).length);
  assert.ok(diff.diffs.every((d) => d.kind === "added"));
});

test("Firestore 에만 있는 필드는 삭제 대상이 아니라 참고로만 보고한다", () => {
  const remote = remoteFromSeed(seed);
  remote.legacyField = "옛날에 쓰던 값";
  const diff = computeDocDiff(seed, remote);
  assert.deepEqual(diff.extraInRemote, ["legacyField"]);
  assert.equal(
    diff.diffs.length,
    0,
    "merge:true 시드는 모르는 필드를 건드리면 안 된다"
  );
});

test("deepEqual 은 길이·순서·타입을 구분한다", () => {
  assert.equal(deepEqual([1, 2], [1, 2]), true);
  assert.equal(deepEqual([1, 2], [2, 1]), false);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: "1" }), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual(null, undefined), false);
});

test("차이 리포트는 before/after 를 함께 보여준다", () => {
  const remote = remoteFromSeed(seed);
  remote.courseAccessPeriod_ko = "구매일로부터 30일";
  const out = renderDocDiff(computeDocDiff(seed, remote));
  assert.match(out, /courseAccessPeriod_ko \[변경\]/);
  assert.match(out, /before: 구매일로부터 30일/);
  assert.match(out, /after : 구매일로부터 1년/);
});
