// 사장님 광고→ACTIVATED 퍼널 조립 단위테스트 (ticket O5JPlh4FSiCsNpZ4E9VJ).
// `npm --prefix marblo-web test` (tsx --test) 로 돈다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVATED_CPA_TARGET_MAX_KRW,
  AD_FUNNEL_TARGETS,
  buildActivatedCpa,
  buildAdAcquisitionFunnel,
  meetsTarget,
  type ActivatedLadderDto,
} from "./adFunnel";

const DEFINITION = {
  id: "activated.v1",
  minTasksCompleted: 3,
  axis: "install" as const,
  axisLabel: "설치 축(익명 설치 ID)",
  axisNote: "★이 ACTIVATED 는 설치 축입니다.",
  label: "ACTIVATED = 설치 + 실제 프로젝트 + Agent 연결 + Task 3개 이상 완료",
  criteria: [
    {
      key: "installed",
      label: "설치",
      signal: "app:installed ∪ app:first_run",
    },
  ],
  derivationNote: "새 이벤트 없이 task:completed 에서 파생합니다.",
};

function ladder(units: Record<string, number>): ActivatedLadderDto {
  const keys = [
    "install",
    "login_success",
    "project_connected",
    "agent_spawned",
    "task_completed_1",
    "task_completed_min",
    "activated",
  ];
  return {
    definition: DEFINITION,
    steps: keys.map((key) => ({
      key,
      label: key,
      units: units[key] ?? 0,
      conversionFromPrev: null,
      exceedsPrev: false,
    })),
    activatedUnits: units.activated ?? 0,
    installUnits: units.install ?? 0,
    notes: [],
  };
}

const FULL = ladder({
  install: 40,
  login_success: 30,
  project_connected: 24,
  agent_spawned: 12,
  task_completed_1: 8,
  task_completed_min: 5,
  activated: 5,
});

const WEB = { visitors: 1000, downloads: 150 };

function row(result: ReturnType<typeof buildAdAcquisitionFunnel>, key: string) {
  const r = result.rows.find((x) => x.key === key);
  assert.ok(r, `${key} 행 없음`);
  return r;
}

// ── 퍼널 모양 ───────────────────────────────────────────────────────────────

test("사장님 퍼널 단계가 순서대로 다 있다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  assert.deepEqual(
    f.rows.map((r) => r.key),
    [
      "ad_impression",
      "ad_click",
      "landing_visit",
      "beta_signup",
      "install",
      "login_success",
      "project_connected",
      "agent_task",
      "tasks_min",
      "activated",
    ]
  );
});

test("★광고 노출·클릭은 0 이 아니라 미계측이다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  for (const key of ["ad_impression", "ad_click"]) {
    const r = row(f, key);
    assert.equal(r.reached, null, `${key} 가 0 으로 그려졌다`);
    assert.ok(r.unmeasured, `${key} 에 미계측 사유가 없다`);
    // ★무엇을 하면 채워지는지 적혀 있어야 한다.
    assert.match(r.unmeasured.whatWouldFixIt, /impressions|API/);
  }
});

test("★CTR 미계측이면 목표 달성 판정을 '미달' 로 찍지 않는다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  const click = row(f, "ad_click");
  assert.equal(click.target, AD_FUNNEL_TARGETS.adCtr);
  assert.equal(click.targetMet, null); // false 가 아니다
});

test("Landing → Beta 는 GA4 방문 대비 다운로드다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  const beta = row(f, "beta_signup");
  assert.equal(beta.reached, 150);
  assert.equal(beta.conversion?.rate, 0.15);
  assert.equal(beta.targetMet, true); // 10~20% 구간 하한 통과
});

test("Signup → Activated 는 직전 칸이 아니라 Beta 를 분모로 쓴다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  const act = row(f, "activated");
  assert.equal(act.conversionFromKey, "beta_signup");
  assert.equal(act.conversion?.denominator, 150);
  assert.equal(act.conversion?.numerator, 5);
  assert.equal(act.targetMet, false); // 5/150 = 3.3% < 30%
  assert.equal(act.crossSource, true);
});

test("Project → Tasks 는 Project 를 분모로 쓴다(사장님 표 정의)", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  const t = row(f, "tasks_min");
  assert.equal(t.conversionFromKey, "project_connected");
  assert.equal(t.conversion?.denominator, 24);
  assert.equal(t.stage, "3 Tasks 완료"); // 임계값은 서버 정의문에서 온다
});

// ── 빈 데이터 · 계측 공백 ────────────────────────────────────────────────────

test("★사다리 미배포: 앱 구간이 0 이 아니라 미계측이다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: null,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  for (const key of ["install", "project_connected", "activated"]) {
    const r = row(f, key);
    assert.equal(r.reached, null);
    assert.match(r.unmeasured?.reason ?? "", /미배포/);
    assert.match(r.unmeasured?.whatWouldFixIt ?? "", /배포/);
  }
  assert.equal(f.definition, null);
  assert.ok(f.notes.some((n) => n.includes("미계측")));
});

test("★GA4 미수신: 웹 구간이 0 이 아니라 미계측이다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: null,
    spendKrw: 0,
    rangeDays: 30,
  });
  assert.equal(row(f, "landing_visit").reached, null);
  assert.equal(row(f, "beta_signup").reached, null);
  // 그래도 앱 구간은 그린다 — 한쪽 공백이 다른 쪽을 지우면 안 된다.
  assert.equal(row(f, "install").reached, 40);
  // 분모가 없으니 Beta→설치 전환율은 계산하지 않는다.
  assert.equal(row(f, "install").conversion, null);
  assert.equal(row(f, "install").targetMet, null);
});

test("★분모 0: 전환율은 0% 가 아니라 null 이고 목표 판정도 null", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: ladder({}),
    web: { visitors: 0, downloads: 0 },
    spendKrw: 0,
    rangeDays: 30,
  });
  const beta = row(f, "beta_signup");
  assert.equal(beta.reached, 0); // 실측 0 은 0 으로 그린다(데이터다)
  assert.equal(beta.conversion?.rate, null); // 분모 0 → 판단 불가
  assert.equal(beta.targetMet, null);
  assert.equal(row(f, "activated").targetMet, null);
});

test("★분자가 분모보다 크면 깎지 않고 플래그를 세운다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: { visitors: 1000, downloads: 10 },
    spendKrw: 0,
    rangeDays: 30,
  });
  const inst = row(f, "install");
  assert.equal(inst.reached, 40);
  assert.equal(inst.conversion?.exceedsDenominator, true);
  assert.equal(inst.crossSource, true);
});

test("meetsTarget: 구간 목표는 하한만으로 판정한다(상한 초과는 미달이 아니다)", () => {
  assert.equal(meetsTarget(0.25, AD_FUNNEL_TARGETS.landingToBeta), true);
  assert.equal(meetsTarget(0.05, AD_FUNNEL_TARGETS.landingToBeta), false);
  assert.equal(meetsTarget(null, AD_FUNNEL_TARGETS.landingToBeta), null);
  assert.equal(meetsTarget(0.5, null), null);
});

// ── CPA ─────────────────────────────────────────────────────────────────────

test("★비용 미입력이면 CPA 는 0원이 아니라 '미입력' 이다", () => {
  const c = buildActivatedCpa({ spendKrw: 0, activated: 5, rangeDays: 30 });
  assert.equal(c.kind, "unavailable");
  assert.match(c.kind === "unavailable" ? c.reason : "", /비용 미입력/);
});

test("★원장을 못 읽으면 0원이 아니라 사유를 준다", () => {
  const c = buildActivatedCpa({ spendKrw: null, activated: 5, rangeDays: 30 });
  assert.equal(c.kind, "unavailable");
  assert.match(c.kind === "unavailable" ? c.reason : "", /읽지 못/);
});

test("★ACTIVATED 0 이면 CPA 를 ∞ 로 그리지 않는다", () => {
  const c = buildActivatedCpa({
    spendKrw: 100000,
    activated: 0,
    rangeDays: 30,
  });
  assert.equal(c.kind, "unavailable");
  assert.match(c.kind === "unavailable" ? c.reason : "", /분모/);
});

test("비용이 있으면 CPA 를 계산하고 목표(₩5만 이하)와 비교한다", () => {
  const ok = buildActivatedCpa({
    spendKrw: 100000,
    activated: 5,
    rangeDays: 30,
  });
  assert.equal(ok.kind, "ok");
  if (ok.kind !== "ok") return;
  assert.equal(ok.cpaKrw, 20000);
  assert.equal(ok.targetMaxKrw, ACTIVATED_CPA_TARGET_MAX_KRW);
  assert.equal(ok.targetMet, true);
  // ★기간 축이 다르다는 사실을 반드시 같이 준다.
  assert.match(ok.periodMismatchNote ?? "", /전기간/);

  const over = buildActivatedCpa({
    spendKrw: 1000000,
    activated: 5,
    rangeDays: 30,
  });
  assert.equal(over.kind === "ok" && over.targetMet, false);
});

test("퍼널 note 에 축 문구와 파생 근거가 실린다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  assert.ok(f.notes.some((n) => n.includes("설치 축")));
  assert.ok(f.notes.some((n) => n.includes("새 이벤트 없이")));
  assert.ok(f.notes.some((n) => n.includes("ACTIVATED")));
});

// ── ★교차 확인 소스 ─────────────────────────────────────────────────────────

const PROFILE = {
  sourceKey: "install_profile" as const,
  sourceLabel: "설치 프로필(analytics_install_profile) — 일별 롤업 기반",
  installUnits: 659,
  agentUnits: 18,
  taskMinUnits: 5,
  activatedUnits: 5,
  projectConditionInferred: true,
  note: "★'실제 프로젝트' 조건은 스폰으로 대신 읽었습니다(추론).",
};

test("교차 확인 소스가 오면 결과에 그대로 실린다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: { ...FULL, profile: PROFILE },
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  assert.equal(f.profile?.activatedUnits, 5);
  assert.equal(f.profile?.projectConditionInferred, true);
});

test("★교차 확인이 없으면 null 이다 — 0 으로 채우지 않는다", () => {
  const f = buildAdAcquisitionFunnel({
    ladder: FULL,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  assert.equal(f.profile, null);
  const g = buildAdAcquisitionFunnel({
    ladder: null,
    web: WEB,
    spendKrw: 0,
    rangeDays: 30,
  });
  assert.equal(g.profile, null);
});

test("★CPA 분모는 퍼널이 그리는 events 축 ACTIVATED 다(소스를 몰래 바꾸지 않는다)", () => {
  // 교차 확인 값이 더 커도 CPA 분모를 조용히 그쪽으로 바꾸면, 화면에 그린 숫자와
  // 계산에 쓴 숫자가 달라진다. 그건 화면이 두 이야기를 하는 것이다.
  const f = buildAdAcquisitionFunnel({
    ladder: { ...FULL, profile: { ...PROFILE, activatedUnits: 50 } },
    web: WEB,
    spendKrw: 100000,
    rangeDays: 30,
  });
  assert.equal(f.cpa.kind, "ok");
  if (f.cpa.kind !== "ok") return;
  assert.equal(f.cpa.activatedUnits, 5); // FULL.activated = 5, 50 이 아니다
});
