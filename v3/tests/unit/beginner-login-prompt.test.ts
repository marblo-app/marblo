/**
 * @vitest-environment jsdom
 *
 * 자동설치 **다음 칸** — "어떤 구독 가지고 계세요?" → CLI 별 로그인 유도
 * (티켓 LLHMclpKaIAJbsiHzGoG).
 *
 * ★고치는 실패모드: 콜드테스트에서 자동설치는 잘 끝나는데 그 뒤 로그인 유도가
 * 없었다. 이미 CLI 로그인이 된 기계(사장님)에서는 설치가 끝나는 순간 `ready` 가
 * 서서 흐름이 이어졌지만, 진짜 신규 유저는 오케 후보 **하나**(claude)의 로그인
 * 창 앞에서 멈췄다 — 그가 가진 것이 ChatGPT 구독이면 승인할 게 없다.
 *
 * 여기서 지키는 것은 넷이다:
 *  1. **이미 로그인된 CLI 는 큐에서 빠진다** — 다시 로그인시키지 않는다.
 *  2. **순서가 계약이다** — 고른 순서(= 선택지 순서)가 로그인 순서이자 기본 오케
 *     우선순위다.
 *  3. **한 번에 하나** — `nextLoginTarget` 이 대상 하나만 돌려준다.
 *  4. **기본 오케는 지금 도는 것 우선** — 인증된 것이 있으면 그것, 없으면 첫 번째.
 *
 * 화면 계약(모달이 이 판정들을 실제로 부르는가)은 beginner-one-click.test.ts 가
 * 본다 — 여기는 순수 규칙만.
 */
import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_CHOICES,
  defaultOrchestratorModel,
  initialSubscriptionPick,
  isSignedIn,
  needsInstall,
  nextLoginTarget,
  pendingLoginModels,
} from "../../src/lib/loginPrompt";
import type { CliProbeLike } from "../../src/lib/oneClickSetup";
import { ROWS } from "../../src/stores/cliSetupStore";

const probe = (installed: boolean, authenticated: boolean): CliProbeLike => ({
  installed,
  authenticated,
});

/** 신규 유저의 흔한 상태: 자동설치는 끝났고 아무것도 로그인 안 됨. */
const FRESH: Record<string, CliProbeLike> = {
  "cli-claude-code": probe(true, false),
  "cli-codex": probe(true, false),
  "cli-grok": probe(false, false),
  "cli-antigravity": probe(false, false),
};

describe("SUBSCRIPTION_CHOICES — 무엇을 물을 것인가", () => {
  it("Claude · Codex · Grok 셋만 묻는다", () => {
    expect([...SUBSCRIPTION_CHOICES]).toEqual(["claude", "codex", "grok"]);
  });

  it("★antigravity 는 묻지 않는다 — 구독이 아니라 구글 계정이고, 선택지는 적을수록 좋다", () => {
    expect(SUBSCRIPTION_CHOICES).not.toContain("antigravity");
  });

  it("순서가 오케 후보 우선순위와 같다 — 기본 오케가 여기서 정해지기 때문이다", () => {
    // #579 의 오케 후보는 claude → codex 순이다. 선택지 순서가 그와 어긋나면
    // 아무것도 인증되기 전의 기본값이 오케 후보가 아닌 CLI 가 될 수 있다.
    expect(SUBSCRIPTION_CHOICES.indexOf("claude")).toBeLessThan(
      SUBSCRIPTION_CHOICES.indexOf("codex"),
    );
    expect(SUBSCRIPTION_CHOICES.indexOf("codex")).toBeLessThan(
      SUBSCRIPTION_CHOICES.indexOf("grok"),
    );
  });
});

describe("pendingLoginModels — 실제로 로그인 터미널을 띄울 CLI", () => {
  it("고른 순서 그대로 돌려준다", () => {
    expect(pendingLoginModels(ROWS, ["claude", "codex"], FRESH)).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("★이미 로그인된 것은 빠진다 — 자동감지해 건너뛴다는 요구가 이 한 줄이다", () => {
    const results = { ...FRESH, "cli-codex": probe(true, true) };
    expect(pendingLoginModels(ROWS, ["claude", "codex"], results)).toEqual([
      "claude",
    ]);
  });

  it("★사장님 케이스 — 전부 로그인돼 있으면 띄울 터미널이 하나도 없다", () => {
    const results: Record<string, CliProbeLike> = {
      "cli-claude-code": probe(true, true),
      "cli-codex": probe(true, true),
      "cli-grok": probe(true, true),
      "cli-antigravity": probe(false, false),
    };
    expect(
      pendingLoginModels(ROWS, ["claude", "codex", "grok"], results),
    ).toEqual([]);
  });

  it("안 깔린 CLI 는 남는다 — 설치는 로그인 직전에 하면 된다(그록)", () => {
    // "구독은 있는데 CLI 가 없다" 는 건너뛸 이유가 아니다. 설치까지 태우는 것은
    // `cliSetupActions.installAndLogin` 의 몫이다.
    expect(pendingLoginModels(ROWS, ["grok"], FRESH)).toEqual(["grok"]);
    expect(needsInstall(ROWS, FRESH, "grok")).toBe(true);
  });

  it("같은 CLI 를 두 번 고르면 한 번만 띄운다", () => {
    expect(pendingLoginModels(ROWS, ["claude", "claude"], FRESH)).toEqual([
      "claude",
    ]);
  });

  it("아직 프로브 결과가 없으면 '안 깔렸다' 로 단정하지 않는다", () => {
    // "아직 모른다" 가 "설치해라" 가 되면 느린 프로브 한 번이 멀쩡한 CLI 위로
    // 셸 인스톨러를 다시 돌린다(pendingInstallRows 와 같은 규칙).
    expect(needsInstall(ROWS, {}, "claude")).toBe(false);
    expect(isSignedIn(ROWS, {}, "claude")).toBe(false);
  });
});

describe("nextLoginTarget — 한 번에 하나", () => {
  it("동시에 셋을 띄우지 않는다 — 첫 대상 하나만", () => {
    // 셋을 한꺼번에 띄우면 브라우저 승인 탭이 셋 열리고, 어느 터미널이 무엇을
    // 기다리는지 알 수 없다.
    expect(nextLoginTarget(ROWS, ["claude", "codex", "grok"], FRESH)).toBe(
      "claude",
    );
  });

  it("앞의 것이 인증되면 다음이 올라온다 — 큐가 저절로 굴러간다", () => {
    const after = { ...FRESH, "cli-claude-code": probe(true, true) };
    expect(nextLoginTarget(ROWS, ["claude", "codex"], after)).toBe("codex");
  });

  it("사용자가 건너뛴 것은 인증 안 됐어도 큐에서 빠진다", () => {
    expect(nextLoginTarget(ROWS, ["claude", "codex"], FRESH, ["claude"])).toBe(
      "codex",
    );
  });

  it("전부 끝났으면 null — 이 값이 흐름의 종료 신호다", () => {
    expect(nextLoginTarget(ROWS, ["claude"], FRESH, ["claude"])).toBeNull();
    expect(nextLoginTarget(ROWS, [], FRESH)).toBeNull();
  });
});

describe("defaultOrchestratorModel — '선택한 것(또는 첫 번째)'", () => {
  it("아무것도 인증 전이면 첫 번째로 고른 것", () => {
    expect(defaultOrchestratorModel(ROWS, ["codex", "grok"], FRESH)).toBe(
      "codex",
    );
  });

  it("★이미 인증된 것이 있으면 그게 먼저다 — 지금 당장 돌 수 있는 유일한 칸", () => {
    // 아직 로그인 중인 것을 기본값으로 박아 두면 첫 스폰이 곧장 인증 벽에
    // 부딪힌다(#932 의 needs_auth 가 그 숫자다).
    const results = { ...FRESH, "cli-codex": probe(true, true) };
    expect(defaultOrchestratorModel(ROWS, ["claude", "codex"], results)).toBe(
      "codex",
    );
  });

  it("둘 다 인증됐으면 고른 순서를 따른다", () => {
    const results = {
      ...FRESH,
      "cli-claude-code": probe(true, true),
      "cli-codex": probe(true, true),
    };
    expect(defaultOrchestratorModel(ROWS, ["claude", "codex"], results)).toBe(
      "claude",
    );
  });

  it("고른 게 없으면 아무것도 바꾸지 않는다", () => {
    expect(defaultOrchestratorModel(ROWS, [], FRESH)).toBeNull();
  });

  it("돌려주는 값은 그대로 오케 하네스 값이다", () => {
    // `orchestratorModel.set` 이 받는 값이라 렌더러가 문자열을 새로 만들지
    // 않는다 — 온보딩 전용 어휘가 생기면 설정 화면과 갈린다.
    for (const model of SUBSCRIPTION_CHOICES) {
      expect(ROWS.some((r) => r.model === model)).toBe(true);
    }
  });
});

describe("initialSubscriptionPick — 질문 화면의 기본 체크", () => {
  it("이미 로그인된 것만 미리 체크한다 — 가진 게 증명된 것", () => {
    const results = { ...FRESH, "cli-grok": probe(true, true) };
    expect(initialSubscriptionPick(ROWS, results)).toEqual(["grok"]);
  });

  it("★안 가진 구독을 기본 체크로 밀지 않는다 — 없는 계정의 로그인 창이 뜬다", () => {
    expect(initialSubscriptionPick(ROWS, FRESH)).toEqual([]);
  });
});
