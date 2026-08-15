/**
 * 온보딩 샘플 데모의 **대본과 재생 타이밍** (ticket ATLPpGxY).
 *
 * React·DOM·타이머에 의존하지 않는 순수 모듈이다 — 재생 엔진은 demoPlayer.ts,
 * 화면은 DemoMode.tsx. 이렇게 쪼갠 이유는 v3 vitest 가 environment:"node" 이고
 * jsdom·testing-library 가 없어서 컴포넌트 렌더 테스트가 불가능하기 때문이다.
 * 대본/타이밍/스케줄러는 여기와 demoPlayer.ts 에서 실측 검증하고, 컴포넌트는
 * 그 위의 얇은 셸로 남긴다.
 *
 * ★타이밍을 감으로 정하지 않는다.
 * 각 step 의 지연 = 고정비(STEP_BASE_MS) + 그 step 에서 **새로 노출되는 한국어
 * 텍스트 글자 수** × MS_PER_CHAR. MS_PER_CHAR 는 한글 읽기 속도 분당 550자
 * (= 109ms/자) 에서 나온다. 대사를 고치면 재생시간이 따라 움직이고,
 * watchDemo 라벨의 {seconds} 도 같은 계산에서 나오므로 라벨이 실측과
 * 어긋날 수 없다(그 불변식은 tests/unit/onboarding-demo-script.test.ts 가 강제).
 *
 * 무과금 불변식: 여기에는 하드코딩된 샘플 문자열과 산술만 있다. 네트워크·
 * electronAPI·CLI 스폰 없음.
 */
import { onboarding as koOnboarding } from "../../locales/ko/onboarding";

/** 데모가 쓰는 메시지 키 — onboarding 네임스페이스로 좁힌 것(MessageKey 의 부분집합). */
export type DemoMessageKey = keyof typeof koOnboarding;

export type AgentKind = "claude" | "codex";
export type Column = "todo" | "doing" | "done";
/**
 * 로그 한 줄의 화자.
 * - "command" — 사용자가 실제로 친 슬래시커맨드 자체(모노 칩).
 * - "prompt"  — 그 커맨드 **뒤에 이어 쓰는 요청 본문**. 같은 입력 한 줄이지만
 *   사람이 치는 순서대로 커맨드 다음 비트로 따로 등장시킨다("/tf-add 뒤에
 *   원하는 것을 그대로 쓰면 된다" 가 2막의 교육 목적이라, 한 버블에 뭉치면
 *   그 순서가 안 보인다).
 */
export type LogKind =
  | "user"
  | "command"
  | "prompt"
  | "hint"
  | "orch"
  | AgentKind;

export interface DemoLogLine {
  /** 이 줄이 처음 보이는 step. */
  atStep: number;
  kind: LogKind;
  key: DemoMessageKey;
}

export interface DemoTaskDef {
  id: string;
  titleKey: DemoMessageKey;
  roleKey: DemoMessageKey;
  agent: AgentKind;
  /** 보드에 '대기' 로 등장하는 step. */
  appearsAtStep: number;
  /** '진행 중' 으로 넘어가는 step. */
  startsAtStep: number;
  /** '완료' 로 넘어가는 step. */
  doneAtStep: number;
  /** 이전 막에서 넘어와 이미 완료된 카드(2막 보드에 그대로 남는다). */
  carriedOver?: boolean;
  /** 선행 티켓 id — 있으면 시작 전까지 '예약됨' 배지가 붙는다. */
  blockedBy?: string;
}

export interface DemoAct {
  id: "act1" | "act2";
  nameKey: DemoMessageKey;
  /** 보드 헤더에 뜨는 이번 막의 요청 이름. */
  requestKey: DemoMessageKey;
  log: DemoLogLine[];
  tasks: DemoTaskDef[];
  /** 마지막 step 인덱스. step 은 0..finalStep. */
  finalStep: number;
}

// ── 읽기 속도 상수 ────────────────────────────────────────────────────────
/**
 * 한글 읽기 속도 기준(분당 자).
 *
 * 이력: 400(보수 하한) → 450("조금만 빨라지면") → 550(첫 화면 데모 체감 속도,
 * ticket br88d6WP). 550 은 한글 묵독 400~600자/분 구간의 중간 위쪽이다. 대사가
 * 짧은 대화체라 되읽기가 없고, 전체 재생은 약 15~20% 단축(66s→~55s) 수준으로
 * 읽힐 여유를 남긴다. 600+ 로 올리면 다시 "읽히기 전에 넘어간다" 쪽으로 간다.
 */
export const KO_CHARS_PER_MINUTE = 550;
/** 글자당 노출 시간 = 60_000 / 550 ≈ 109ms. */
export const MS_PER_CHAR = Math.round(60_000 / KO_CHARS_PER_MINUTE);
/**
 * 텍스트와 무관한 고정비 — 카드 이동·시선 전환을 눈이 따라가는 시간.
 *
 * 600 → 420 → 340. 고정비는 대사 길이와 무관하게 **모든 step 에 똑같이** 붙으므로,
 * 깎으면 짧은 step 이 많이 줄고 대사가 긴 step 은 덜 다친다(= 긴 대사의 가독성을
 * 지키면서 리듬만 조인다). 340ms 는 새 요소로 시선이 옮겨가 고정되는 데 드는
 * 시간(대략 200~300ms)보다 아직 조금 넉넉하다.
 */
export const STEP_BASE_MS = 340;
/**
 * 새로 뜨는 티켓 카드 1장당 가산 시간. 카드 제목은 산문이 아니라 **훑는** 라벨이고
 * 여러 장이 컬럼에 나란히 뜨므로 순차 읽기 속도를 적용하지 않는다.
 */
export const CARD_REVEAL_MS = 400;
/** 텍스트가 거의 없는 step(카드 하나가 '완료' 로 넘어가는 순간 등)의 하한. */
export const STEP_MIN_MS = 900;
/**
 * 상한. ★이건 "긴 대사를 잘라내는 장치" 가 아니라 **대본 규율의 감시자**다.
 * 한 step 의 원시 계산값이 여기 걸린다는 건 그 step 에 말을 너무 많이 실었다는
 * 뜻이고, 그러면 재생시간이 실측이 아니라 clamp 로 정해진다(= 라벨이 거짓이 된다).
 * 그래서 "상한이 한 번도 걸리지 않는다" 를 유닛테스트가 강제한다 — 대사가 길어지면
 * clamp 로 뭉개지 말고 step 을 하나 더 쪼갤 것.
 */
export const STEP_MAX_MS = 6500;
/** prefers-reduced-motion 압축 경로: step 당 고정 지연. */
export const REDUCED_MOTION_STEP_MS = 150;

// ── 1막: PRD 를 쓰고 /tf-start 로 프로젝트를 연다 ─────────────────────────
const ACT1: DemoAct = {
  id: "act1",
  nameKey: "onboarding.demo.act1.name",
  requestKey: "onboarding.demo.act1.request",
  finalStep: 10,
  log: [
    { atStep: 0, kind: "user", key: "onboarding.demo.a1.user" },
    { atStep: 1, kind: "command", key: "onboarding.demo.a1.cmd" },
    // 힌트는 커맨드와 같은 step 에 얹지 않는다 — 커맨드 문자열을 눈으로 읽는 시간과
    // 설명을 읽는 시간이 한 step 에 겹치면 그 step 만 6초 넘게 부푼다.
    { atStep: 2, kind: "hint", key: "onboarding.demo.a1.cmdHint" },
    { atStep: 3, kind: "orch", key: "onboarding.demo.a1.readPrd" },
    { atStep: 4, kind: "orch", key: "onboarding.demo.a1.decompose" },
    { atStep: 5, kind: "orch", key: "onboarding.demo.a1.assign" },
    { atStep: 6, kind: "claude", key: "onboarding.demo.a1.claudeStart" },
    { atStep: 6, kind: "codex", key: "onboarding.demo.a1.codexStart" },
    { atStep: 7, kind: "orch", key: "onboarding.demo.a1.working" },
    { atStep: 10, kind: "orch", key: "onboarding.demo.a1.done" },
  ],
  tasks: [
    {
      id: "a1-fe",
      titleKey: "onboarding.demo.sub.frontend",
      roleKey: "onboarding.demo.role.frontend",
      agent: "claude",
      appearsAtStep: 4,
      startsAtStep: 6,
      doneAtStep: 8,
    },
    {
      id: "a1-be",
      titleKey: "onboarding.demo.sub.backend",
      roleKey: "onboarding.demo.role.backend",
      agent: "codex",
      appearsAtStep: 4,
      startsAtStep: 6,
      doneAtStep: 9,
    },
    {
      id: "a1-test",
      titleKey: "onboarding.demo.sub.test",
      roleKey: "onboarding.demo.role.test",
      agent: "claude",
      appearsAtStep: 4,
      startsAtStep: 6,
      doneAtStep: 10,
    },
  ],
};

// ── 2막: 그다음부터는 /tf-add 뒤에 프롬프트를 이어 쓴다 ────────────────────
// 1막 티켓 3개는 '완료' 상태로 보드에 남는다 — "돌아가던 보드 위에 얹힌다" 가
// 이 막의 요점이라, 새 보드를 그리면 메시지가 죽는다.
const carried = (t: DemoTaskDef): DemoTaskDef => ({
  ...t,
  appearsAtStep: 0,
  startsAtStep: 0,
  doneAtStep: 0,
  carriedOver: true,
});

const ACT2: DemoAct = {
  id: "act2",
  nameKey: "onboarding.demo.act2.name",
  requestKey: "onboarding.demo.act2.request",
  finalStep: 9,
  log: [
    { atStep: 0, kind: "user", key: "onboarding.demo.a2.user" },
    // ★커맨드와 프롬프트는 한 입력 줄이지만 **두 비트로 나눠** 등장시킨다.
    // 사람이 실제로 치는 순서이고, "그다음부터는 /tf-add 뒤에 원하는 것을 그대로
    // 쓰면 된다" 는 이 막의 교육 목적이 한 버블에 뭉치면 보이지 않는다.
    // (1막의 `/tf-start PRD.md` 는 쪼개지 않는다 — 뒤에 오는 게 자유서술 프롬프트가
    //  아니라 고정된 파일 경로라, 나눠 봐야 가르치는 것 없이 step 만 하나 는다.)
    { atStep: 1, kind: "command", key: "onboarding.demo.a2.cmd" },
    { atStep: 2, kind: "prompt", key: "onboarding.demo.a2.prompt" },
    { atStep: 3, kind: "hint", key: "onboarding.demo.a2.cmdHint" },
    { atStep: 4, kind: "orch", key: "onboarding.demo.a2.ingest" },
    { atStep: 5, kind: "orch", key: "onboarding.demo.a2.dependency" },
    { atStep: 6, kind: "codex", key: "onboarding.demo.a2.codexStart" },
    { atStep: 7, kind: "orch", key: "onboarding.demo.a2.unblocked" },
    { atStep: 8, kind: "claude", key: "onboarding.demo.a2.claudeStart" },
    { atStep: 9, kind: "orch", key: "onboarding.demo.a2.done" },
  ],
  tasks: [
    ...ACT1.tasks.map(carried),
    {
      id: "a2-api",
      titleKey: "onboarding.demo.sub.subApi",
      roleKey: "onboarding.demo.role.backend",
      agent: "codex",
      appearsAtStep: 4,
      startsAtStep: 6,
      doneAtStep: 7,
    },
    {
      id: "a2-ui",
      titleKey: "onboarding.demo.sub.subUi",
      roleKey: "onboarding.demo.role.frontend",
      agent: "claude",
      appearsAtStep: 4,
      startsAtStep: 8,
      doneAtStep: 9,
      blockedBy: "a2-api",
    },
  ],
};

export const DEMO_ACTS: readonly DemoAct[] = [ACT1, ACT2];
export const DEMO_ACT_COUNT = DEMO_ACTS.length;

// ── 타이밍 계산 ───────────────────────────────────────────────────────────

/** 이 step 에서 새로 화면에 나타나는 대사(산문)의 한국어 글자 수. */
export function revealedCharsAt(act: DemoAct, step: number): number {
  let chars = 0;
  for (const line of act.log) {
    if (line.atStep === step) chars += koText(line.key).length;
  }
  return chars;
}

/** 이 step 에서 보드에 새로 나타나는 티켓 카드 수(이월 카드는 이미 본 것이라 제외). */
export function revealedCardsAt(act: DemoAct, step: number): number {
  return act.tasks.filter(
    (task) => !task.carriedOver && task.appearsAtStep === step,
  ).length;
}

function koText(key: DemoMessageKey): string {
  return koOnboarding[key];
}

/** clamp 전 원시 계산값 — "상한이 걸리지 않는다" 를 테스트가 검사할 수 있게 노출. */
export function rawDelayFor(act: DemoAct, step: number): number {
  return (
    STEP_BASE_MS +
    revealedCharsAt(act, step) * MS_PER_CHAR +
    revealedCardsAt(act, step) * CARD_REVEAL_MS
  );
}

/**
 * 한 막의 step 지연 배열. index i = step i 가 화면에 머무는 시간(ms).
 * 길이 = finalStep — 마지막 step 은 다음이 없으므로 지연이 없다.
 */
export function delaysForAct(act: DemoAct): number[] {
  const delays: number[] = [];
  for (let step = 0; step < act.finalStep; step++) {
    const raw = rawDelayFor(act, step);
    delays.push(Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, raw)));
  }
  return delays;
}

/** reduced-motion 압축 경로 — 지연을 고정값으로 눌러 재생을 즉시 끝낸다. */
export function reducedMotionDelaysForAct(act: DemoAct): number[] {
  return new Array(act.finalStep).fill(REDUCED_MOTION_STEP_MS);
}

export function actDurationMs(act: DemoAct): number {
  return delaysForAct(act).reduce((a, b) => a + b, 0);
}

/** 두 막을 끝까지 본 총 재생시간(ms). */
export const DEMO_TOTAL_MS = DEMO_ACTS.reduce(
  (sum, act) => sum + actDurationMs(act),
  0,
);

/**
 * watchDemo 라벨에 들어가는 초. 올림이라 "표시된 시간 안에 끝난다" 가 항상 참이다.
 * ★이 값은 라벨의 유일한 출처다 — 문자열에 숫자를 다시 박지 말 것.
 */
export const DEMO_TOTAL_SECONDS = Math.ceil(DEMO_TOTAL_MS / 1000);

// ── 보드 상태 파생 ────────────────────────────────────────────────────────

/** 에이전트 종류 판별 — 라벨·배지 색을 고르는 유일한 분기점. */
export function agentIsClaude(agent: AgentKind): boolean {
  return agent === "claude";
}

/** step 시점에 이 티켓이 놓이는 컬럼. 아직 등장 전이면 null. */
export function columnFor(task: DemoTaskDef, step: number): Column | null {
  if (step < task.appearsAtStep) return null;
  if (step >= task.doneAtStep) return "done";
  if (step >= task.startsAtStep) return "doing";
  return "todo";
}

/** 선행 티켓 때문에 아직 시작하지 못하고 예약된 상태인가. */
export function isScheduled(task: DemoTaskDef, step: number): boolean {
  return Boolean(task.blockedBy) && step < task.startsAtStep;
}

/** 보드 헤더 상태 배지. */
export function statusKeyFor(act: DemoAct, step: number): DemoMessageKey {
  if (step >= act.finalStep) return "onboarding.demo.status.done";
  const anyStarted = act.tasks.some(
    (task) => !task.carriedOver && step >= task.startsAtStep,
  );
  if (anyStarted) return "onboarding.demo.status.running";
  return step >= 1
    ? "onboarding.demo.status.analyzing"
    : "onboarding.demo.status.queued";
}
