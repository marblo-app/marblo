// analyticsIdScheme 순수 로직 단위테스트 (analyticsPseudonym.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:analytics-id-scheme
//
// ★이 파일의 존재 이유(ticket dTpcKWwRw5DvEMKxpCZi): **2026-06-13 을 가로질러
// 두 스킴을 이어붙이는 변경을 빨갛게 만든다.** 이어붙이면 같은 사람이 그날
// 이탈한 것처럼 보인다 — 실측에서 실제로 그렇게 보였다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ID_SCHEME_SWITCH_DATE,
  canStitchIdScheme,
  classifyIdScheme,
  isSharedSentinel,
  resolveLinkConfidence,
} from "./analyticsIdScheme";

// 실데이터 모양만 본뜬 합성값 — 실제 설치 id 가 아니다.
const UUID36 = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UID28 = "Zx0testtesttesttesttesttest0"; // 영숫자 28자
const UID28_OTHER = "Yw9testtesttesttesttesttest9";

test("classifyIdScheme — 36자 소문자 UUID 는 uuid36 (06-13 이후)", () => {
  assert.equal(classifyIdScheme(UUID36), "uuid36");
  assert.equal(UUID36.length, 36);
});

test("classifyIdScheme — 영숫자 28자는 uid28 (06-13 이전 레거시)", () => {
  assert.equal(classifyIdScheme(UID28), "uid28");
  assert.equal(UID28.length, 28);
});

test("classifyIdScheme — 두 스킴은 서로의 정규식에 걸리지 않는다", () => {
  // BQ 실측에서 교차오염 0건이었다. 그 성질을 코드로 고정한다.
  assert.notEqual(classifyIdScheme(UUID36), "uid28");
  assert.notEqual(classifyIdScheme(UID28), "uuid36");
});

test("classifyIdScheme — 대문자 UUID 도 uuid36 (앱이 소문자 정규화 전 값)", () => {
  assert.equal(classifyIdScheme(UUID36.toUpperCase()), "uuid36");
});

test("classifyIdScheme — 공백은 trim 후 판정", () => {
  assert.equal(classifyIdScheme(`  ${UUID36}  `), "uuid36");
});

test("★classifyIdScheme — 공유 리터럴 'anon' 은 조인키가 아니다 → unknown", () => {
  // 스토리지를 못 쓰는 설치가 전부 같은 값을 쓴다. 조인키로 쓰면 전원이
  // 한 사람으로 뭉친다.
  assert.equal(classifyIdScheme("anon"), "unknown");
  assert.equal(classifyIdScheme("ANON"), "unknown");
});

test("classifyIdScheme — 빈 값/비문자열/이상한 길이는 unknown", () => {
  assert.equal(classifyIdScheme(""), "unknown");
  assert.equal(classifyIdScheme("   "), "unknown");
  assert.equal(classifyIdScheme(null), "unknown");
  assert.equal(classifyIdScheme(undefined), "unknown");
  assert.equal(classifyIdScheme(12345), "unknown");
  assert.equal(classifyIdScheme("short"), "unknown");
  assert.equal(classifyIdScheme("x".repeat(37)), "unknown");
  // 하이픈 자리가 틀린 36자
  assert.equal(
    classifyIdScheme("3f2504e04f8941d39a0c0305e82c3301aaaa"),
    "unknown"
  );
});

test("classifyIdScheme — 원시값을 되돌려주지 않는다(라벨만)", () => {
  const out: string = classifyIdScheme(UUID36);
  assert.ok(!out.includes(UUID36));
  assert.ok(["uid28", "uuid36", "unknown"].includes(out));
});

test("★canStitchIdScheme — 스킴이 다르면 접합 금지 (06-13 경계)", () => {
  // 이 한 줄이 이 티켓의 핵심이다. true 로 바뀌면 리텐션이 그날 끊긴다.
  assert.equal(canStitchIdScheme(UID28, UUID36), false);
  assert.equal(canStitchIdScheme(UUID36, UID28), false);
});

test("canStitchIdScheme — 같은 스킴끼리는 접합 후보로 허용", () => {
  assert.equal(canStitchIdScheme(UID28, UID28_OTHER), true);
  assert.equal(canStitchIdScheme(UUID36, UUID36), true);
});

test("canStitchIdScheme — unknown 이 끼면 언제나 false", () => {
  assert.equal(canStitchIdScheme("anon", UUID36), false);
  assert.equal(canStitchIdScheme(UUID36, "anon"), false);
  assert.equal(canStitchIdScheme(null, UUID36), false);
  assert.equal(canStitchIdScheme("", ""), false);
});

test("★resolveLinkConfidence — 못 붙은 것은 버리지 않고 unmapped 로 센다", () => {
  assert.equal(resolveLinkConfidence(true), "joined");
  assert.equal(resolveLinkConfidence(false), "unmapped");
});

test("ID_SCHEME_SWITCH_DATE — 경계일 상수가 실측값과 일치", () => {
  // BQ: 28자 마지막 2026-06-13, 36자 최초 2026-06-13.
  assert.equal(ID_SCHEME_SWITCH_DATE, "2026-06-13");
});

test("★isSharedSentinel — 'anon' 만 키 자격 박탈, 다른 미분류는 살린다", () => {
  // 'anon' 은 모든 설치가 공유하는 값 → 키로 쓰면 전원이 한 사람으로 뭉친다.
  assert.equal(isSharedSentinel("anon"), true);
  assert.equal(isSharedSentinel(" ANON "), true);
  // 14자 같은 미분류 모양은 실재하는 설치다 — 빼면 인원이 줄어 보인다.
  assert.equal(isSharedSentinel("abcdefghijklmn"), false);
  assert.equal(classifyIdScheme("abcdefghijklmn"), "unknown");
  assert.equal(isSharedSentinel(null), false);
});
