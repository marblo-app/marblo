import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  FOUNDER_BETA_MONTHS,
  FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
  FOUNDER_LEGACY_BETA_MONTHS,
  FOUNDER_PRO_MONTHS,
  addMonths,
  founderLadderSteps,
} from "./founderLadder";

// ─── 계단 값 ────────────────────────────────────────────────────────
// 값 자체를 못 박는다. 문구(웹 3개국어 + 메일 3개국어)가 이 숫자를 그대로
// 약속하므로, 여기를 조용히 바꾸면 코드와 문면이 갈라진다.

test("계단 값은 베타 3 · 설문 총 5 · 인터뷰 총 9", () => {
  assert.equal(FOUNDER_BETA_MONTHS, 3);
  assert.equal(FOUNDER_PRO_MONTHS, 5);
  assert.equal(FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS, 9);
});

test("★설문 보상이 베타와 같아지면 설문할 이유가 사라진다", () => {
  assert.ok(
    FOUNDER_PRO_MONTHS > FOUNDER_BETA_MONTHS,
    `설문 총 ${FOUNDER_PRO_MONTHS}개월이 베타 ${FOUNDER_BETA_MONTHS}개월보다 크지 않다 — ` +
      "설문을 제출할 이유가 0 이 된다(베타 1→3 이 깨뜨렸던 바로 그 불변식)",
  );
});

test("★인터뷰 보상이 설문과 붙으면 화상 인터뷰 유인이 사라진다", () => {
  assert.ok(
    FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS > FOUNDER_PRO_MONTHS,
    "인터뷰 총 개월이 설문 총 개월보다 크지 않다",
  );
});

test("★뒤 단계일수록 증분이 커진다 — 계단이 평평해지면 안 된다", () => {
  const steps = founderLadderSteps();
  assert.deepEqual(
    steps.map((s) => s.key),
    ["beta", "survey", "interview"],
  );
  assert.deepEqual(
    steps.map((s) => s.totalMonths),
    [3, 5, 9],
  );
  assert.deepEqual(
    steps.map((s) => s.incrementMonths),
    [3, 2, 4],
  );

  // 설문(+2) → 인터뷰(+4). 더 어려운 행동(30분 화상 인터뷰, 신원 노출, 일정
  // 조율)에 더 큰 보상이 붙어야 그 단계를 밟는다. 절대 증분과 상대 이득 양쪽에서
  // 성립해야 한다 — 인터뷰를 8(+3)로 두면 절대 증분은 커지지만 상대 이득이
  // 설문 단계보다 낮아져 계단이 여전히 평평하다.
  const survey = steps[1];
  const interview = steps[2];
  assert.ok(
    interview.incrementMonths > survey.incrementMonths,
    `인터뷰 증분(+${interview.incrementMonths})이 설문 증분(+${survey.incrementMonths})보다 크지 않다`,
  );
  const surveyGain =
    survey.incrementMonths / (survey.totalMonths - survey.incrementMonths);
  const interviewGain =
    interview.incrementMonths /
    (interview.totalMonths - interview.incrementMonths);
  assert.ok(
    interviewGain > surveyGain,
    `인터뷰 상대 이득(${interviewGain.toFixed(2)})이 설문(${surveyGain.toFixed(2)})보다 크지 않다`,
  );
});

// ─── legacy 재구성 값 ───────────────────────────────────────────────

test("★legacy 재구성 값은 정책 값과 분리되어 있다 — 소급은 승인 사안", () => {
  assert.equal(FOUNDER_LEGACY_BETA_MONTHS, 1);
  assert.notEqual(
    FOUNDER_LEGACY_BETA_MONTHS,
    FOUNDER_BETA_MONTHS,
    "legacy 재구성이 오늘의 정책 값을 따라가면 betaExpiresAt 없는 선정자 전원이 " +
      "승인 없이 소급 연장된다",
  );
});

// ─── 만료일 계산 ────────────────────────────────────────────────────

/** addMonths 는 로컬 시간 산술이므로, 검증도 로컬 Y-M-D 로 한다(TZ 무관). */
function ymd(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const DAY_MS = 24 * 60 * 60 * 1000;

test("만료일은 일수가 아니라 월경계로 더한다", () => {
  const start = new Date(2026, 6, 14); // 2026-07-14 (실측 코호트의 선정일)
  assert.equal(ymd(addMonths(start, FOUNDER_BETA_MONTHS)), "2026-10-14");
  assert.equal(ymd(addMonths(start, FOUNDER_PRO_MONTHS)), "2026-12-14");
  assert.equal(
    ymd(addMonths(start, FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS)),
    "2027-04-14"
  );
});

test("★D30 측정 시점에 베타 접근권이 넉넉히 살아 있다 — 이 티켓의 목적", () => {
  // 실측: 취소된 26건이 전부 2026-07-14 → 2026-08-14 = 31일. 구 정책의 만료는
  // D30 을 **하루** 넘긴다. 즉 D30 을 재려는 바로 그 시점이 만료 경계라서,
  // 나온 숫자는 제품 리텐션이 아니라 만료 신호다. "D30 이전에 끊긴다"가 아니라
  // "D30 에 여유가 없다"가 정확한 진단이고, 고쳐야 할 것도 그 여유다.
  const grantedAt = new Date(2026, 6, 14);
  const d30 = new Date(grantedAt.getTime() + 30 * DAY_MS);

  const legacyEnd = addMonths(grantedAt, FOUNDER_LEGACY_BETA_MONTHS);
  const legacyMarginDays = Math.round((legacyEnd.getTime() - d30.getTime()) / DAY_MS);
  assert.equal(
    legacyMarginDays,
    1,
    "구 정책(1개월)은 D30 을 하루 넘기고 끊겼다 — 회귀 방지용 기준선"
  );

  const newEnd = addMonths(grantedAt, FOUNDER_BETA_MONTHS);
  const newMarginDays = Math.round((newEnd.getTime() - d30.getTime()) / DAY_MS);
  assert.ok(
    newMarginDays >= 30,
    `새 베타는 D30 이후로 ${newMarginDays}일밖에 안 남는다 — ` +
      "'쓸 수 있는데 안 썼다'를 재려면 측정 시점에 여유가 있어야 한다"
  );
});

test("월경계 넘침으로 부여가 짧아지지는 않는다(1/31 계열)", () => {
  // setMonth 는 존재하지 않는 날짜를 다음 달로 넘긴다: 1/31 + 3개월 → 4/31 →
  // 5/1. 여기서 확인하는 건 특정 달력 날짜가 아니라 **약속보다 짧아지지 않는다**
  // 는 것 — 넘침은 항상 하루 뒤로 가지 앞으로 오지 않는다(billing.ts 와 동일 동작).
  const start = new Date(2026, 0, 31); // 2026-01-31
  const end = addMonths(start, FOUNDER_BETA_MONTHS);
  assert.equal(ymd(end), "2026-05-01");
  assert.ok(
    end >= new Date(2026, 3, 30),
    "3개월 부여가 4월 말보다 앞으로 당겨지면 약속보다 짧게 준 것이다"
  );
});
