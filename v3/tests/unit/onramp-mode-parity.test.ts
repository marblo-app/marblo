/**
 * ★심플·어드밴스드 온보딩 **파리티 가드** (ticket VzR1izqW6hzwF0YRfkgL).
 *
 * 사장님 지시의 핵심: "어느 모드도 반쯤 지어진 표면이 없게." 이 repo 에서 그
 * 드리프트는 **반복해서** 일어났다 — 같은 안내를 한 셸에만 달아 놓고, 다른 셸
 * 사용자만 조용히 막히는 형태다(자금 안내가 `CliSetupHost` 안에 있어 레거시
 * Layout 셸에서 안 뜬 것이 마지막 사례이고, 이 티켓이 그것을 고쳤다).
 *
 * 그래서 파리티를 **테스트로** 못박는다. 소스 스캔인 이유는 v3 vitest 가
 * environment:"node"(jsdom 없음)라 셸을 렌더할 수 없기 때문이고, 검증 대상이
 * "그 표면이 그 셸에 **마운트되어 있는가**" 라는 구조적 사실이라 스캔으로 충분하다.
 *
 * 표(설계 §3-A 인벤토리 축):
 *
 * | 표면              | 심플(BeginnerShell)        | 어드밴스드(WorkspaceShell) | 레거시(Layout)     |
 * | ----------------- | -------------------------- | -------------------------- | ------------------ |
 * | 설치·인증         | BeginnerConnectStep        | StartHereTab/CliSetupHost  | CliSetupGate       |
 * | 캔드 데모         | BeginnerConnectStep        | StartHereTab               | (로그인 화면)      |
 * | **L0 룰 분해**    | BeginnerConnectStep        | StartHereTab               | —                  |
 * | **M1 실행차단**   | OnrampGateHost(beginner)   | GlobalOverlays(workspace)  | GlobalOverlays     |
 * | **M2 자금안내**   | FundingGuideHost           | GlobalOverlays             | GlobalOverlays     |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)),
    "utf8",
  );

const BEGINNER_SHELL = "components/beginner/BeginnerShell.tsx";
const BEGINNER_CONNECT = "components/beginner/BeginnerConnectStep.tsx";
const START_HERE = "components/onboarding/StartHereTab.tsx";
const GLOBAL_OVERLAYS = "components/GlobalOverlays.tsx";
const CLI_SETUP_HOST = "components/onboarding/CliSetupHost.tsx";
const WORKSPACE_SHELL = "components/workspace/WorkspaceShell.tsx";
const LAYOUT = "components/Layout.tsx";

describe("온보딩 파리티 — L0 분해 카드는 양쪽 모드에 있다", () => {
  it("심플: 비기너 연결 게이트가 카드를 마운트한다", () => {
    const source = src(BEGINNER_CONNECT);
    expect(source).toContain("OnrampDecomposeCard");
    expect(source).toContain('surface="beginner_connect"');
  });

  it("★심플 콜드스타트: L0 티켓 생성 체험이 연결 CTA보다 먼저 선다", () => {
    const source = src(BEGINNER_CONNECT);
    const demoIndex = source.indexOf('data-testid="beginner-firstscreen-demo"');
    const connectIndex = source.indexOf(
      'data-testid="beginner-oneclick-cta-card"',
    );
    expect(demoIndex).toBeGreaterThan(-1);
    expect(connectIndex).toBeGreaterThan(-1);
    expect(demoIndex).toBeLessThan(connectIndex);
  });

  it("어드밴스드: 시작하기 탭이 같은 카드를 마운트한다", () => {
    const source = src(START_HERE);
    expect(source).toContain("OnrampDecomposeCard");
    expect(source).toContain('surface="start_here_tab"');
  });

  it("★프리뷰(시연)에서는 심플 쪽 카드가 그려지지 않는다 — 실제 티켓을 만들기 때문", () => {
    // 프리뷰의 계약은 "실제 상태 미변경" 이다. 이 카드는 진짜 Firestore write 를
    // 하므로 그 계약과 정면으로 충돌한다.
    const source = src(BEGINNER_CONNECT);
    expect(source).toMatch(
      /!setup\.preview\s*&&[\s\S]{0,400}OnrampDecomposeCard/,
    );
  });
});

describe("온보딩 파리티 — M1(실행 차단) 안내는 모든 셸에 있다", () => {
  it("심플: 비기너 셸이 OnrampGateHost 를 든다", () => {
    const source = src(BEGINNER_SHELL);
    expect(source).toContain("OnrampGateHost");
    expect(source).toContain('variant="beginner"');
  });

  it("어드밴스드·레거시: GlobalOverlays 가 든다(두 셸 모두 이걸 마운트한다)", () => {
    const overlays = src(GLOBAL_OVERLAYS);
    expect(overlays).toContain("OnrampGateHost");
    expect(overlays).toContain('variant="workspace"');
    expect(src(WORKSPACE_SHELL)).toContain("GlobalOverlays");
    expect(src(LAYOUT)).toContain("GlobalOverlays");
  });

  it("★원클릭 모달과 배타다 — 겹치면 Esc 가 어느 쪽을 닫는지 알 수 없다", () => {
    // ★배타의 근거가 규칙 하나로 옮겨졌다(티켓 E3ywX1ftbVr5f1TrFsgp):
    //   `!showOneClick` 인라인 → `shouldRenderOnboardingGuides`.
    // 데모 재생도 같은 이유로 배타여야 하는데 인라인 가드는 그걸 빠뜨리고
    // 있었다(데모 대본 위에 "계정을 연결하세요" 가 덮였다). 규칙 자체의 표는
    // beginnerMode.test.ts 가 덮고, 여기서는 셸이 **그 규칙에 물려 있는지**만 본다.
    const source = src(BEGINNER_SHELL);
    expect(source).toMatch(/guidesAllowed && \(?\s*<OnrampGateHost/);
    expect(source).toMatch(
      /const guidesAllowed = shouldRenderOnboardingGuides\(\{[\s\S]{0,200}oneClickOpen: showOneClick,[\s\S]{0,200}demoPlaying: showDemo,/,
    );
  });
});

describe("온보딩 파리티 — M2(자금 안내)의 호스트 갭이 닫혔다", () => {
  it("GlobalOverlays 가 FundingGuideHost 를 든다(레거시 셸도 받는다)", () => {
    expect(src(GLOBAL_OVERLAYS)).toContain("FundingGuideHost");
  });

  it("★CliSetupHost 는 더 이상 마운트하지 않는다 — 두 벌이면 모달이 두 개 뜬다", () => {
    // WorkspaceShell 은 GlobalOverlays 와 CliSetupHost 를 **둘 다** 마운트한다.
    // 승격만 하고 원본을 안 지우면 같은 모달이 겹쳐 뜨고 계측도 두 배가 된다.
    // (주석의 언급은 허용한다 — 왜 옮겼는지가 그 파일에 남아 있어야 한다.)
    const source = src(CLI_SETUP_HOST);
    expect(source).not.toContain("<FundingGuideHost");
    expect(source).not.toMatch(/^import .*FundingGuideHost/m);
  });

  it("심플 셸은 자기 사본을 그대로 든다(GlobalOverlays 를 안 쓰는 셸이다)", () => {
    const source = src(BEGINNER_SHELL);
    expect(source).toContain("<FundingGuideHost");
    // 마운트 여부만 본다 — 주석의 언급(왜 사본이 필요한지)은 오히려 있어야 한다.
    expect(source).not.toContain("<GlobalOverlays");
    expect(source).not.toMatch(/^import .*GlobalOverlays/m);
  });
});

describe("온보딩 파리티 — 차단이 조용히 지나가는 경로가 없다", () => {
  // 설계 §4-G: `needsAuth` 를 해석하는 화면이 넷인데 비기너 셸은 그중 없었다.
  // 이제 그 넷 + 자동기동이 전부 공용 리포터를 지난다 — 세션 상한이 한 벌로
  // 유지되는 것도 이 규율 덕분이다.
  const CALL_SITES = [
    "components/tabs/AgentsTab.tsx",
    "components/lanes/LanesTab.tsx",
    "components/orchestrator/OrchestratorPanel.tsx",
    "hooks/useAgentReconnect.ts",
    "hooks/useOrchestratorAutoLaunch.ts",
  ];

  for (const rel of CALL_SITES) {
    it(`${rel} 의 needsAuth 처리가 온램프 축으로도 보고한다`, () => {
      const source = src(rel);
      expect(source).toContain("reportOnrampExecBlocked");
      // needsAuth 분기 수만큼 보고가 있어야 한다 — 하나만 배선하고 나머지를
      // 잊으면 그 경로만 조용해진다.
      const branches = (source.match(/result\?\.needsAuth/g) ?? []).length;
      const reports = (source.match(/reportOnrampExecBlocked\(/g) ?? []).length;
      expect(reports).toBeGreaterThanOrEqual(branches);
    });
  }

  it("리포터는 판정을 순수 모듈에 위임한다(규칙 사본을 만들지 않는다)", () => {
    const source = src("services/onrampBlockSignal.ts");
    expect(source).toContain("planOnrampBlockUi");
    // 계측은 억제된 차단에도 나간다 — "몇 번 말 걸 기회를 버렸나" 가 튜닝 근거다.
    expect(source).toMatch(/telemetry\.onrampExecBlocked[\s\S]{0,200}shown/);
  });
});

describe("온보딩 파리티 — 계측 축", () => {
  it("두 온램프 이벤트가 텔레메트리 타입에 등록돼 있다", () => {
    const source = src("services/telemetryService.ts");
    expect(source).toContain('"onramp:decompose_used"');
    expect(source).toContain('"onramp:exec_blocked"');
  });

  it("★유저 문장은 계측에 실리지 않는다 — 자유 텍스트 금지 규율", () => {
    // funding 프로브가 원문 detail 을 안 싣는 것과 같은 이유다. 판정에 필요한
    // 것은 규칙 코드와 개수뿐이다.
    const card = src("components/onboarding/OnrampDecomposeCard.tsx");
    expect(card).toContain("telemetry.onrampDecomposeUsed");
    // 호출 **인자만** 떼어 본다(그 뒤 코드까지 훑으면 무관한 변수명에 걸린다).
    const calls = [...card.matchAll(/onrampDecomposeUsed\(\{([\s\S]*?)\}\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    // 식별자 단위로 본다 — `drafts.length`(개수)는 괜찮고 `draft`(원문 상태)는
    // 안 된다. 그 차이가 정확히 "센 것" 과 "실은 것" 의 경계다.
    for (const [, args] of calls) {
      for (const forbidden of ["draft", "text", "input", "title"]) {
        expect(
          new RegExp(`\\b${forbidden}\\b`).test(args),
          `계측 인자에 ${forbidden} 이 실렸다`,
        ).toBe(false);
      }
    }
  });
});
