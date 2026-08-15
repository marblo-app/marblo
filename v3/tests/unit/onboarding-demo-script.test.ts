/**
 * 온보딩 데모 대본·타이밍 계약 (ticket ATLPpGxY).
 *
 * 이 티켓의 발단: STEP_DELAYS 합계는 10.1초인데 두 진입점 라벨은 둘 다
 * "60초 데모" 였다(6배 괴리). 재발을 막는 유일한 방법은 라벨을 대본에서
 * 계산해 내고, 그 연결을 테스트로 못 박는 것이다.
 *
 * ★여기서 검증되는 것은 "계산이 맞다" 이지 "화면이 그렇게 보인다" 가 아니다.
 *   실제 재생 감각(읽히는가)은 눈으로 봐야 한다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEMO_ACTS,
  DEMO_ACT_COUNT,
  DEMO_TOTAL_MS,
  DEMO_TOTAL_SECONDS,
  KO_CHARS_PER_MINUTE,
  MS_PER_CHAR,
  STEP_BASE_MS,
  CARD_REVEAL_MS,
  STEP_MIN_MS,
  STEP_MAX_MS,
  REDUCED_MOTION_STEP_MS,
  actDurationMs,
  columnFor,
  delaysForAct,
  isScheduled,
  rawDelayFor,
  reducedMotionDelaysForAct,
  revealedCardsAt,
  revealedCharsAt,
  statusKeyFor,
} from "../../src/components/onboarding/demoScript";
import { onboarding as koOnboarding } from "../../src/locales/ko/onboarding";
import { onboarding as enOnboarding } from "../../src/locales/en/onboarding";

const srcPath = (rel: string) =>
  fileURLToPath(new URL(`../../src/${rel}`, import.meta.url));

describe("demo script — 재생시간이 라벨과 일치한다", () => {
  it("글자당 노출 시간은 한글 분당 550자에서 나온다", () => {
    // 400 → 450 → 550 (br88d6WP: 첫 화면 데모 스텝 ~15–20% 단축). 값 자체가
    // 아니라 "분당 자수에서 파생된다" 가 계약이므로 파생식도 같이 못 박는다.
    expect(KO_CHARS_PER_MINUTE).toBe(550);
    expect(MS_PER_CHAR).toBe(109);
    expect(MS_PER_CHAR).toBe(Math.round(60_000 / KO_CHARS_PER_MINUTE));
  });

  it("고정비는 글자수와 무관한 몫이라 읽기 속도보다 먼저 깎였다", () => {
    // 600 → 420 → 340. 고정비는 모든 step 에 똑같이 붙어서, 여길 깎으면 짧은
    // step 이 많이 줄고 대사가 긴 step 은 덜 다친다.
    expect(STEP_BASE_MS).toBe(340);
    // 그래도 시선 이동을 눈이 따라갈 만큼은 남아 있어야 한다.
    expect(STEP_BASE_MS).toBeGreaterThanOrEqual(300);
  });

  it("각 step 지연 = 고정비 + ko 글자수 × MS_PER_CHAR + 새 카드 × 400ms (clamp 적용)", () => {
    for (const act of DEMO_ACTS) {
      const delays = delaysForAct(act);
      expect(delays).toHaveLength(act.finalStep);
      delays.forEach((ms, step) => {
        const chars = revealedCharsAt(act, step);
        const cards = revealedCardsAt(act, step);
        const raw = STEP_BASE_MS + chars * MS_PER_CHAR + cards * CARD_REVEAL_MS;
        expect(rawDelayFor(act, step)).toBe(raw);
        const expected = Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, raw));
        expect(ms, `${act.id} step ${step} (${chars}자·카드${cards})`).toBe(
          expected,
        );
      });
    }
  });

  it("★상한 clamp 가 한 번도 걸리지 않는다 — 재생시간을 정하는 건 clamp 가 아니라 실측이다", () => {
    // 상한에 걸린 step 은 "글자수대로 계산됐다" 는 주장이 그 step 에서만 거짓이 된다.
    // 대사를 늘리고 싶으면 step 을 쪼개라(이 테스트가 그걸 강제한다).
    for (const act of DEMO_ACTS) {
      for (let step = 0; step < act.finalStep; step++) {
        expect(
          rawDelayFor(act, step),
          `${act.id} step ${step} 이 상한에 걸림 — 대사를 쪼갤 것`,
        ).toBeLessThanOrEqual(STEP_MAX_MS);
      }
    }
  });

  it("글자수는 실제 ko 문자열에서 세어진다 — 상수를 손으로 박은 게 아니다", () => {
    // act1 step 0 은 사용자 대사 한 줄만 뜬다. 그 줄의 실제 길이와 일치해야 한다.
    const act1 = DEMO_ACTS[0];
    expect(revealedCharsAt(act1, 0)).toBe(
      koOnboarding["onboarding.demo.a1.user"].length,
    );
    // act1 step 1 = 커맨드 칩만, step 2 = 힌트만 (일부러 쪼갠 두 beat).
    expect(revealedCharsAt(act1, 1)).toBe(
      koOnboarding["onboarding.demo.a1.cmd"].length,
    );
    expect(revealedCharsAt(act1, 2)).toBe(
      koOnboarding["onboarding.demo.a1.cmdHint"].length,
    );
    // 카드가 뜨는 step 만 카드 비용을 낸다.
    expect(revealedCardsAt(act1, 4)).toBe(3);
    expect(revealedCardsAt(act1, 5)).toBe(0);
  });

  it("★DEMO_TOTAL_SECONDS 는 두 막 지연 합계에서 파생된다(라벨 드리프트 불가)", () => {
    const recomputed = DEMO_ACTS.reduce(
      (sum, act) => sum + delaysForAct(act).reduce((a, b) => a + b, 0),
      0,
    );
    expect(DEMO_TOTAL_MS).toBe(recomputed);
    expect(DEMO_TOTAL_SECONDS).toBe(Math.ceil(recomputed / 1000));
    // 올림이므로 라벨이 실제보다 짧다고 말하는 일은 없다.
    expect(DEMO_TOTAL_SECONDS * 1000).toBeGreaterThanOrEqual(DEMO_TOTAL_MS);
  });

  it("★watchDemo 라벨 두 곳은 ko/en 모두 {seconds} 자리표시자를 쓴다(숫자 하드코딩 금지)", () => {
    const labelKeys = [
      "onboarding.startHere.watchDemo",
      "onboarding.login.watchDemo",
    ] as const;
    for (const key of labelKeys) {
      expect(koOnboarding[key], `ko ${key}`).toContain("{seconds}");
      expect(enOnboarding[key], `en ${key}`).toContain("{seconds}");
      // 예전 "60초" 하드코딩이 되살아나면 여기서 죽는다.
      expect(koOnboarding[key]).not.toMatch(/\d/);
      expect(enOnboarding[key]).not.toMatch(/\d/);
    }
  });

  it("★두 진입점이 실제로 {seconds} 를 채워 넣는다(안 채우면 화면에 '{seconds}초' 가 뜬다)", () => {
    // 라벨을 자리표시자로 바꾼 대가: 호출부가 vars 를 빠뜨리면 t() 는 조용히
    // "{seconds}" 를 그대로 렌더한다. 데모는 두 곳에서 열리므로 둘 다 검사한다.
    const callSites = [
      ["auth/LoginPage.tsx", "onboarding.login.watchDemo"],
      [
        "components/onboarding/StartHereTab.tsx",
        "onboarding.startHere.watchDemo",
      ],
    ] as const;
    for (const [rel, key] of callSites) {
      const source = readFileSync(srcPath(rel), "utf8");
      expect(
        source,
        `${rel} 이 DEMO_TOTAL_SECONDS 를 import 하지 않음`,
      ).toContain("DEMO_TOTAL_SECONDS");
      // t("...watchDemo", { seconds: DEMO_TOTAL_SECONDS }) 형태여야 한다.
      const call = new RegExp(
        `t\\(\\s*"${key.replace(/\./g, "\\.")}"\\s*,\\s*\\{\\s*seconds:\\s*DEMO_TOTAL_SECONDS`,
      );
      expect(call.test(source), `${rel} 의 ${key} 호출에 seconds 미전달`).toBe(
        true,
      );
    }
  });

  it("실제 재생시간은 사람이 읽을 수 있는 범위 안이다", () => {
    // 원래 10.1초는 "읽히기 전에 넘어간다" 는 사장님 피드백의 원인이었다.
    expect(DEMO_TOTAL_MS).toBeGreaterThan(40_000);
    // 66s 전후에서 ~15–20% 단축 후 상한은 60s 안팎. 72s 로 되돌아가면 다시
    // "조금만 빨라지면" 피드백 구간이다.
    expect(DEMO_TOTAL_MS).toBeLessThan(62_000);
    // 너무 짧아지면 다시 가독성 문제로 돌아간다(15% 단축의 하한 쪽).
    expect(DEMO_TOTAL_MS).toBeGreaterThan(48_000);
    for (const act of DEMO_ACTS) {
      expect(actDurationMs(act)).toBeGreaterThan(10_000);
    }
  });

  it("reduced-motion 압축 경로(150ms)는 유지된다", () => {
    expect(REDUCED_MOTION_STEP_MS).toBe(150);
    for (const act of DEMO_ACTS) {
      const delays = reducedMotionDelaysForAct(act);
      expect(delays).toHaveLength(act.finalStep);
      expect(new Set(delays)).toEqual(new Set([150]));
    }
  });
});

describe("demo script — 2막 구성", () => {
  it("막은 2개이고, 대사에 실제 슬래시커맨드가 그대로 노출된다", () => {
    expect(DEMO_ACT_COUNT).toBe(2);
    expect(koOnboarding["onboarding.demo.a1.cmd"]).toContain("/tf-start");
    expect(koOnboarding["onboarding.demo.a2.cmd"]).toContain("/tf-add");
    expect(enOnboarding["onboarding.demo.a1.cmd"]).toContain("/tf-start");
    expect(enOnboarding["onboarding.demo.a2.cmd"]).toContain("/tf-add");
  });

  it("★2막: /tf-add 가 먼저 뜨고, 프롬프트 본문이 그 다음 step 에 따라 붙는다", () => {
    // 사장님: "tf-add 다음에 프롬프트가 오는 형태로". 한 버블에 다시 뭉치면
    // 여기서 죽는다.
    const act2 = DEMO_ACTS[1];
    const cmd = act2.log.find((l) => l.kind === "command")!;
    const prompt = act2.log.find((l) => l.kind === "prompt")!;
    expect(cmd.key).toBe("onboarding.demo.a2.cmd");
    expect(prompt.key).toBe("onboarding.demo.a2.prompt");
    // 순서: 커맨드가 먼저, 프롬프트가 뒤. 같은 step 에 겹치면 한 버블과 다를 바 없다.
    expect(prompt.atStep).toBe(cmd.atStep + 1);

    for (const locale of [koOnboarding, enOnboarding]) {
      // 커맨드 비트는 슬래시커맨드 **하나만** — 인자가 다시 붙으면 실패.
      expect(locale["onboarding.demo.a2.cmd"].trim()).toBe("/tf-add");
      // 프롬프트 비트는 커맨드를 다시 반복하지 않는다.
      expect(locale["onboarding.demo.a2.prompt"]).not.toContain("/tf-add");
      expect(locale["onboarding.demo.a2.prompt"].trim().length).toBeGreaterThan(
        0,
      );
    }
  });

  it("1막의 /tf-start 는 쪼개지 않는다 — 뒤따르는 건 프롬프트가 아니라 파일 경로다", () => {
    // 일관성만 보고 여기까지 쪼개면 가르치는 것 없이 step 만 하나 는다(= 재생시간
    // 이 다시 길어진다). 판단 근거를 테스트로 남긴다.
    const act1 = DEMO_ACTS[0];
    expect(act1.log.some((l) => l.kind === "prompt")).toBe(false);
    expect(koOnboarding["onboarding.demo.a1.cmd"]).toBe("/tf-start PRD.md");
  });

  it("1막: PRD → 분해 → 배정 → 병렬 → 3티켓 완료", () => {
    const act1 = DEMO_ACTS[0];
    // 분해 전에는 보드가 비어 있다.
    expect(act1.tasks.every((t) => columnFor(t, 3) === null)).toBe(true);
    // 분해(step 4) 직후 전부 대기.
    expect(act1.tasks.map((t) => columnFor(t, 4))).toEqual([
      "todo",
      "todo",
      "todo",
    ]);
    // 배정(step 6) 직후 전부 병렬 진행 — 이게 이 데모의 핵심 장면이다.
    expect(act1.tasks.map((t) => columnFor(t, 6))).toEqual([
      "doing",
      "doing",
      "doing",
    ]);
    expect(statusKeyFor(act1, 6)).toBe("onboarding.demo.status.running");
    // 마지막 step 에서 전부 완료.
    expect(act1.tasks.map((t) => columnFor(t, act1.finalStep))).toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(statusKeyFor(act1, act1.finalStep)).toBe(
      "onboarding.demo.status.done",
    );
  });

  it("2막: 1막 티켓 3개가 완료 상태로 보드에 남고, 그 위에 새 티켓 2개가 얹힌다", () => {
    const act2 = DEMO_ACTS[1];
    const carried = act2.tasks.filter((t) => t.carriedOver);
    const fresh = act2.tasks.filter((t) => !t.carriedOver);
    expect(carried).toHaveLength(3);
    expect(fresh).toHaveLength(2);
    // 이월 카드는 step 0 부터 계속 완료.
    expect(carried.every((t) => columnFor(t, 0) === "done")).toBe(true);
    // 새 티켓은 /tf-add + 프롬프트를 다 친 뒤에야 등장한다(커맨드 1 · 프롬프트 2 ·
    // 힌트 3 → 오케가 받아 티켓을 얹는 게 4).
    expect(fresh.every((t) => columnFor(t, 3) === null)).toBe(true);
    expect(fresh.every((t) => columnFor(t, 4) === "todo")).toBe(true);
    // 이월 카드는 끝까지 완료로 남는다 — 보드가 리셋되지 않는다.
    expect(carried.every((t) => columnFor(t, act2.finalStep) === "done")).toBe(
      true,
    );
  });

  it("2막: 의존성이 걸린 티켓은 선행이 끝날 때까지 '예약됨' 이다", () => {
    const act2 = DEMO_ACTS[1];
    const api = act2.tasks.find((t) => t.id === "a2-api")!;
    const ui = act2.tasks.find((t) => t.id === "a2-ui")!;
    expect(ui.blockedBy).toBe(api.id);

    // 선행이 도는 동안 후행은 예약 상태로 대기.
    expect(columnFor(api, 6)).toBe("doing");
    expect(columnFor(ui, 6)).toBe("todo");
    expect(isScheduled(ui, 6)).toBe(true);

    // 선행이 끝난 뒤(step 7) 예약이 풀리고, step 8 에 후행이 시작된다.
    expect(columnFor(api, 7)).toBe("done");
    expect(columnFor(ui, 8)).toBe("doing");
    expect(isScheduled(ui, 8)).toBe(false);
    expect(columnFor(ui, act2.finalStep)).toBe("done");

    // 의존성 없는 티켓은 예약 배지가 붙지 않는다.
    expect(isScheduled(api, 0)).toBe(false);
  });

  it("모든 대사 키가 ko·en 양쪽에 실제 문자열로 존재한다", () => {
    for (const act of DEMO_ACTS) {
      const keys = [
        act.nameKey,
        act.requestKey,
        ...act.log.map((l) => l.key),
        ...act.tasks.flatMap((t) => [t.titleKey, t.roleKey]),
      ];
      for (const key of keys) {
        expect(koOnboarding[key], `ko ${key}`).toBeTruthy();
        expect(enOnboarding[key], `en ${key}`).toBeTruthy();
      }
    }
  });
});

describe("demo — 무과금 불변식 회귀 가드", () => {
  // 데모의 존재 이유 중 하나가 "로그인 전에, 과금 없이" 다. 스크립트가 어느 날
  // 실제 스폰이나 fetch 로 흘러가면 그 약속이 조용히 깨진다. 소스 스캔으로 막는다.
  const files = [
    "components/onboarding/demoScript.ts",
    "components/onboarding/demoPlayer.ts",
    "components/onboarding/DemoMode.tsx",
  ];
  const forbidden: Array<[string, RegExp]> = [
    ["fetch()", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /\bnew\s+WebSocket\b/],
    ["electronAPI (CLI 스폰·IPC)", /electronAPI/],
    ["ipcRenderer", /ipcRenderer/],
    ["firebase import", /from\s+["']firebase\//],
    ["원격 URL", /https?:\/\//],
  ];

  /**
   * 주석은 걷어내고 본문만 본다 — 이 파일들의 주석은 "electronAPI 접근 없음"
   * 처럼 금지어를 서술하기 때문에, 안 걷어내면 가드가 자기 문서에 걸려 넘어진다.
   * `//` 는 앞이 `:` 가 아닐 때만 주석으로 본다(문자열 안 "https://" 를 살리려고).
   */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const rel of files) {
    it(`${rel} 은 네트워크·electronAPI 를 건드리지 않는다`, () => {
      const source = stripComments(readFileSync(srcPath(rel), "utf8"));
      for (const [label, pattern] of forbidden) {
        expect(pattern.test(source), `${rel} 에서 ${label} 발견`).toBe(false);
      }
    });
  }

  it("계측 3종(demoStarted/demoCompleted/demoCtaClick)은 그대로 남아 있다", () => {
    const source = readFileSync(
      srcPath("components/onboarding/DemoMode.tsx"),
      "utf8",
    );
    expect(source).toContain("telemetry.demoStarted");
    expect(source).toContain("telemetry.demoCompleted");
    expect(source).toContain("telemetry.demoCtaClick");
    // 로그인 후 연결 마법사로 잇는 플래그 흐름도 유지.
    expect(source).toContain("DEMO_CONNECT_PENDING_KEY");
  });
});

describe("StartHereTab demo exposure contract", () => {
  it("완료 상태에서도 완료 배너 안에 명시적인 데모 CTA가 남아 있다", () => {
    const source = readFileSync(
      srcPath("components/onboarding/StartHereTab.tsx"),
      "utf8",
    );
    const completeBranch = source.match(/\{complete && \([\s\S]*?\n        \)\}/);

    expect(completeBranch?.[0]).toContain(
      'data-testid="start-here-complete-watch-demo"',
    );
    expect(completeBranch?.[0]).toContain("onClick={openDemo}");
    expect(completeBranch?.[0]).toContain("onboarding.startHere.watchDemo");
    expect(completeBranch?.[0]).toContain("DEMO_TOTAL_SECONDS");
  });

  it("ValuePreview와 DemoMode 진입점은 온보딩 완료 분기 밖에 있다", () => {
    const source = readFileSync(
      srcPath("components/onboarding/StartHereTab.tsx"),
      "utf8",
    );
    const valuePreviewIndex = source.indexOf("<ValuePreview");
    const incompleteBranchIndex = source.indexOf("{!complete && (");
    const completeBranchIndex = source.indexOf("{complete && (");
    const demoModeIndex = source.indexOf("{showDemo && (");

    expect(valuePreviewIndex).toBeGreaterThan(-1);
    expect(incompleteBranchIndex).toBeGreaterThan(valuePreviewIndex);
    expect(completeBranchIndex).toBeGreaterThan(valuePreviewIndex);
    expect(demoModeIndex).toBeGreaterThan(completeBranchIndex);
    expect(source).toContain("<ValuePreview onWatchDemo={openDemo} />");
    expect(source).toContain("<DemoMode");
  });

  it("첫 화면 데모 CTA 는 대화→티켓 체험임을 문구·testid 로 분명히 한다", () => {
    // 정적 값-미리보기 텍스트에 "데모 보기"가 묻히던 회귀를 막는다(br88d6WP).
    expect(koOnboarding["onboarding.startHere.value.playInteractive"]).toBe(
      "데모로 티켓 생성해보기",
    );
    expect(koOnboarding["onboarding.startHere.watchDemo"]).toMatch(
      /대화→티켓/,
    );
    expect(enOnboarding["onboarding.startHere.value.playInteractive"]).toMatch(
      /ticket/i,
    );
    expect(enOnboarding["onboarding.startHere.watchDemo"]).toMatch(
      /chat.*ticket|ticket.*chat/i,
    );

    const source = readFileSync(
      srcPath("components/onboarding/StartHereTab.tsx"),
      "utf8",
    );
    expect(source).toContain('data-testid="start-here-demo-cta"');
    expect(source).toContain('data-testid="start-here-header-demo-cta"');
    expect(source).toContain("onboarding.startHere.value.playInteractive");
  });
});
