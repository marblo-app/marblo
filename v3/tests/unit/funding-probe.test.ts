/**
 * 인증됨 vs "인증은 됐는데 구독/크레딧이 없다"(티켓 sVdwTsiGq6qZVAmSkwZB).
 *
 * 이 파일이 지키는 것은 기능이 아니라 **오판 금지**다. 정상 구독 유저에게 "구독이
 * 없으세요" 를 띄우는 쪽이, 문제 있는 유저에게 아무것도 안 띄우는 쪽보다 훨씬
 * 나쁘다 — 전자는 돈 낸 사람을 문 앞에서 돌려세운다. 그래서 테스트의 무게가
 * "감지된다" 보다 "**함부로 감지하지 않는다**" 쪽에 실려 있다:
 *
 *  ① 한 턴이 실제로 돌면 무슨 말이 섞여 있든 통과다.
 *  ② 한도(rate limit) 문구는 구독 문구보다 **먼저** 이긴다 — 벤더가 유료 유저의
 *     한도 안내에 업그레이드 권유를 같은 문장으로 붙여 인쇄하기 때문이다.
 *  ③ 원인이 모호하면 `blocked`(중립 안내)이지 `unfunded`(구독 단정)가 아니다.
 *  ④ 프로브가 못 돌았으면 아무것도 주장하지 않는다.
 */
import { describe, it, expect } from "vitest";
import {
  PROBE_OK_TOKEN,
  PROBE_PROMPT,
  canProbeFunding,
  classifyFundingProbe,
  fundingProbeTarget,
  onboardingAuthState,
  probeArgs,
  shouldShowFundingGuide,
  type FundingProbeOutcome,
} from "../../src/lib/fundingProbe";
import type { CliProbeLike } from "../../src/lib/oneClickSetup";

const ROWS = [
  { id: "cli-claude-code", model: "claude" as const },
  { id: "cli-codex", model: "codex" as const },
  { id: "cli-grok", model: "grok" as const },
  { id: "cli-antigravity", model: "antigravity" as const },
];
const PRIORITY = ["cli-claude-code", "cli-codex"];

const authed = (over: Partial<CliProbeLike> = {}): CliProbeLike => ({
  installed: true,
  authenticated: true,
  ...over,
});

function classify(raw: string, exitCode: number | null = 1) {
  return classifyFundingProbe({ model: "claude", raw, exitCode });
}

describe("classifyFundingProbe — 통과가 기본값이다", () => {
  it("기대 토큰이 보이면 종료코드와 무관하게 ok", () => {
    // CLI 가 경고를 뱉고 0 이 아닌 코드로 끝나도, 모델 턴 자체는 돌았다.
    expect(classify(`warning: something\n${PROBE_OK_TOKEN}\n`, 3).verdict).toBe(
      "ok",
    );
  });

  it("★기대 토큰은 프롬프트에 통째로 들어 있지 않다 — 프롬프트 에코를 성공으로 오독하지 않기 위해", () => {
    // codex 의 --json 스트림은 사용자 턴을 그대로 되비춘다. 프롬프트에 완성된
    // 토큰이 박혀 있으면 실패한 실행에서도 토큰이 보여 "성공" 으로 오판한다.
    expect(PROBE_PROMPT).not.toContain(PROBE_OK_TOKEN);
    const echoOnly = JSON.stringify({
      item: { type: "user_message", text: PROBE_PROMPT },
    });
    expect(
      classifyFundingProbe({
        model: "codex",
        raw: `${echoOnly}\ncredit balance is too low`,
        exitCode: 1,
      }).verdict,
    ).toBe("unfunded");
  });

  it("종료코드 0 + 알 수 없는 출력이면 ok — 모르는 것이 사용자를 막는 이유가 되지 않는다", () => {
    expect(classify("Sure! Here you go.", 0).verdict).toBe("ok");
  });

  it("스폰 실패·타임아웃은 inconclusive(아무것도 주장하지 않는다)", () => {
    expect(
      classifyFundingProbe({
        model: "claude",
        raw: "",
        exitCode: null,
        spawnFailed: true,
      }).verdict,
    ).toBe("inconclusive");
    expect(
      classifyFundingProbe({
        model: "claude",
        raw: "thinking…",
        exitCode: null,
        timedOut: true,
      }).verdict,
    ).toBe("inconclusive");
  });

  it("출력이 비어 있으면 inconclusive — 실패인지 우리가 일찍 읽은 건지 모른다", () => {
    expect(classify("   \n", 1).verdict).toBe("inconclusive");
  });
});

describe("classifyFundingProbe — unfunded 는 벤더가 그 말을 했을 때만", () => {
  it.each([
    ["Claude 크레딧 소진", "Credit balance is too low. Please add credits."],
    [
      "OpenAI insufficient_quota",
      "Error: 429 insufficient_quota — You exceeded your current quota, please check your plan and billing details.",
    ],
    ["구독 필요", "This feature requires an active subscription."],
    ["결제수단 없음", "Payment required: add a payment method to continue."],
  ])("%s → unfunded", (_label, raw) => {
    expect(classify(raw).verdict).toBe("unfunded");
  });

  it("ANSI 가 섞여 있어도 문구를 찾는다(PTY 원문 그대로 들어온다)", () => {
    const esc = "\u001b";
    const ansi = `${esc}[31mError${esc}[0m: credit balance is too low`;
    expect(classify(ansi).verdict).toBe("unfunded");
  });

  it("detail 에 원문 꼬리를 남긴다 — 조용한 실패를 만들지 않는다", () => {
    const out = classify("Error: no active subscription for this account");
    expect(out.detail).toContain("no active subscription");
  });
});

describe("classifyFundingProbe — ★한도(rate limit)가 구독 문구를 이긴다", () => {
  it("한도 안내에 업그레이드 권유가 붙어 있어도 unfunded 로 보지 않는다", () => {
    // 실제 벤더 문구의 모양: 유료 유저가 한도에 걸리면 업그레이드 권유가 같은
    // 문장에 붙는다. 여기서 unfunded 로 떨어지면 돈 낸 사용자를 막게 된다.
    const raw =
      "You've hit your usage limit. Your limit resets at 5pm — upgrade to Max for a higher limit, or purchase credits.";
    const out = classify(raw);
    expect(out.verdict).toBe("blocked");
    expect(out.blockedReason).toBe("rate_limit");
  });

  it("rate limit 단독도 중립(blocked)이다", () => {
    expect(classify("Error: rate limit exceeded").blockedReason).toBe(
      "rate_limit",
    );
  });
});

describe("classifyFundingProbe — 재인증·원인불명은 중립", () => {
  it("다시 로그인하라고 하면 blocked/auth (구독 문제가 아니다)", () => {
    const out = classify(
      "You are not logged in. Please run /login to continue",
    );
    expect(out.verdict).toBe("blocked");
    expect(out.blockedReason).toBe("auth");
  });

  it("실패는 확실한데 문구를 못 알아보면 blocked/unknown", () => {
    const out = classify("Error: ENOENT spawn something weird", 127);
    expect(out.verdict).toBe("blocked");
    expect(out.blockedReason).toBe("unknown");
  });

  it("세 자리 숫자(401/402)만으로는 아무 판정도 하지 않는다", () => {
    // 토큰 수·소요 시간·버전 문자열 어디에나 부분일치하는 값이라 마커에서 뺐다.
    expect(classify("done in 402ms · 1401 tokens", 0).verdict).toBe("ok");
  });
});

describe("probeArgs / fundingProbeTarget — 모르는 CLI 는 건드리지 않는다", () => {
  it("오케 후보만 프로브를 지원한다", () => {
    expect(canProbeFunding("claude")).toBe(true);
    expect(canProbeFunding("codex")).toBe(true);
    // 헤드리스 계약을 실측 못 한 CLI 에 추측한 플래그를 던지면 프로브가 실패로
    // 떨어져 정상 유저에게 경고를 띄우게 된다.
    expect(canProbeFunding("grok")).toBe(false);
    expect(canProbeFunding("antigravity")).toBe(false);
    expect(probeArgs("grok")).toBeNull();
  });

  it("인증된 오케 후보를 우선 고른다", () => {
    const results: Record<string, CliProbeLike> = {
      "cli-codex": authed(),
      "cli-claude-code": authed(),
    };
    expect(fundingProbeTarget(ROWS, results, PRIORITY)?.model).toBe("claude");
  });

  it("미인증·미설치 행은 대상이 아니다", () => {
    const results: Record<string, CliProbeLike> = {
      "cli-claude-code": { installed: true, authenticated: false },
      "cli-codex": { installed: false, authenticated: false },
    };
    expect(fundingProbeTarget(ROWS, results, PRIORITY)).toBeNull();
  });

  it("인증된 것이 grok 뿐이면 프로브를 돌리지 않는다(대상 없음)", () => {
    expect(
      fundingProbeTarget(ROWS, { "cli-grok": authed() }, PRIORITY),
    ).toBeNull();
  });
});

describe("onboardingAuthState — 인증됨과 '인증됐지만 구독없음' 의 분리", () => {
  const outcome = (
    over: Partial<FundingProbeOutcome>,
  ): FundingProbeOutcome => ({
    verdict: "ok",
    model: "claude",
    detail: "",
    ...over,
  });

  it("ready 가 아니면 프로브 결과와 무관하게 unauthenticated", () => {
    expect(
      onboardingAuthState({
        ready: false,
        funding: { checking: false, outcome: outcome({ verdict: "unfunded" }) },
      }),
    ).toBe("unauthenticated");
  });

  it("판정이 없으면(아직 안 돌렸다) authenticated — 기본값은 통과다", () => {
    expect(
      onboardingAuthState({
        ready: true,
        funding: { checking: false, outcome: null },
      }),
    ).toBe("authenticated");
  });

  it("unfunded / blocked 가 각자의 상태로 갈라진다", () => {
    expect(
      onboardingAuthState({
        ready: true,
        funding: { checking: false, outcome: outcome({ verdict: "unfunded" }) },
      }),
    ).toBe("authedButUnfunded");
    expect(
      onboardingAuthState({
        ready: true,
        funding: {
          checking: false,
          outcome: outcome({ verdict: "blocked", blockedReason: "unknown" }),
        },
      }),
    ).toBe("authedButBlocked");
  });

  it("ok 는 그냥 authenticated 다 — 정상 유저에게 모달이 뜨지 않는다", () => {
    const state = onboardingAuthState({
      ready: true,
      funding: { checking: false, outcome: outcome({ verdict: "ok" }) },
    });
    expect(state).toBe("authenticated");
    expect(shouldShowFundingGuide({ state, dismissed: false })).toBe(false);
  });
});

describe("shouldShowFundingGuide", () => {
  it("두 문제 상태에서만 뜨고, 닫으면 다시 안 뜬다", () => {
    expect(
      shouldShowFundingGuide({ state: "authedButUnfunded", dismissed: false }),
    ).toBe(true);
    expect(
      shouldShowFundingGuide({ state: "authedButBlocked", dismissed: false }),
    ).toBe(true);
    expect(
      shouldShowFundingGuide({ state: "authedButUnfunded", dismissed: true }),
    ).toBe(false);
    expect(
      shouldShowFundingGuide({ state: "unauthenticated", dismissed: false }),
    ).toBe(false);
  });
});
