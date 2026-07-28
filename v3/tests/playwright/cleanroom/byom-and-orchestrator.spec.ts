import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import * as path from "path";
import {
  doneSteps,
  launchCleanRoom,
  openWorkTab,
  passFirstRunModals,
  injectProject,
} from "./helpers/cleanroom";
import {
  MODEL_REGISTRY,
  HARNESS_NATIVE_VENDOR,
  vendorEnvSecretKeys,
  type ModelRegistryEntry,
} from "../../../electron/model-registry";
import { CODEX_ORCH_REQUIRED_MCP_TOOLS } from "../../../electron/mcp-server/tool-surface";

/**
 * 클린룸 2막 — **활성화 수정이 착지한 뒤** 새로 열린 두 경로를 같은 격리 환경에서
 * 확인한다.
 *
 *   B1 (#638) BYOM(벤더 키)만으로 워커 스폰이 통과하는가 — 그리고 키가 없으면
 *             Anthropic 계정이 있어도 막히는가(인증 축이 실제로 바뀌었는가)
 *   B2 (#639) grok 오케가 marblo MCP 를 **실제로 기동**하는가 — 못 하면 막히는가
 *
 * ── 왜 유닛테스트가 있는데 여기서 또 보나 ─────────────────────────────────
 * 두 판정은 전부 **메인 프로세스**에 있고, 입력은 코드가 아니라 **환경**이다:
 * `process.env` 의 벤더 키, PATH 위의 CLI, 키체인, 프로젝트 폴더 신뢰. 유닛테스트
 * (byom-spawn-gate 17건 / grok-mcp-config)는 같은 함수를 **다른 환경**에서 부르므로
 * "이 환경에서 실제로 어떤 답이 나오나" 는 답하지 못한다. 여기서는 클린룸이 만든
 * 진짜 환경 위에서 앱이 로드한 그 함수를 그대로 부른다(`cr.mainCall`).
 *
 * ── ★이 맥의 한계(F1, #633 부터 이어짐) ──────────────────────────────────
 * `harness-manager.getEnrichedPathForDetection()` 은 PATH 와 무관하게
 * `/opt/homebrew/bin` 등을 하드코딩으로 덧붙이고 claude 인증은 macOS 키체인까지
 * 본다 — 개발 맥에서는 "claude 미설치/미인증" 을 만들 수 없다. B1 은 그 한계를
 * **역이용**한다: Anthropic 계정이 멀쩡히 살아 있는 상태에서 벤더 키가 없다고
 * 스폰이 막히면, 그 판정은 Anthropic 계정 축이 아니라 벤더 축이라는 증거다.
 *
 * 실행: npm run test:e2e:pw -- tests/playwright/cleanroom
 * 전제: npm run build
 */

/** 레지스트리에서 파생 — 벤더 id/모델 id 리터럴을 테스트에 적지 않는다. */
function envSwapModels(): ModelRegistryEntry[] {
  return MODEL_REGISTRY.filter(
    (m) => m.provider !== HARNESS_NATIVE_VENDOR[m.harness],
  );
}

/** 서로 **다른 벤더**의 env-swap 모델 두 개(키 세트가 겹치지 않는 대조군용). */
function twoDistinctVendorModels(): [ModelRegistryEntry, ModelRegistryEntry] {
  const rows = envSwapModels();
  const first = rows[0];
  const second = rows.find((m) => m.provider !== first.provider);
  if (!first || !second) {
    throw new Error("env-swap 벤더가 2개 미만 — 대조군을 세울 수 없습니다");
  }
  return [first, second];
}

interface SpawnAuthGateResult {
  ok: boolean;
  model: string | null;
  installed: boolean;
  authenticated: boolean;
  action?: string;
  reason?: string;
  vendor?: string;
  missingEnvKeys?: string[];
}

interface GrokMcpProbeResult {
  ok: boolean;
  toolCount: number;
  reason: string;
  detail: string;
}

/** 값이 아니라 **키 이름**만 다루는 가짜 크레덴셜(스킬 §시크릿 출력 금지). */
const FAKE_VALUE = "cleanroom-fake-not-a-real-key";

function fakeEnvFor(model: ModelRegistryEntry): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of vendorEnvSecretKeys(model.id)) env[key] = FAKE_VALUE;
  return env;
}

/** PATH 에서 진짜 CLI 를 찾는다(없으면 null → 그 테스트는 skip). */
function whichReal(bin: string): string | null {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

test.describe("@cleanroom BYOM 스폰 게이트(#638)", () => {
  test("B1-a 벤더 키가 없으면 — Anthropic 계정이 살아 있어도 — 벤더 축으로 막힌다", async () => {
    const [glm] = twoDistinctVendorModels();
    const cr = await launchCleanRoom({ claude: "ready", codex: "missing" });
    try {
      // 이 환경에 Anthropic 계정 축이 실제로 살아 있는지부터 기록한다. 살아
      // 있어야 아래 "막힘" 이 벤더 축의 증거가 된다(살아있지 않으면 계정 축으로도
      // 막히므로 아무것도 증명하지 못한다 — 그 경우를 로그로 남긴다).
      const nativeGate = await cr.mainCall<SpawnAuthGateResult>(
        "harness-manager.js",
        "checkSpawnAuthGate",
        [glm.harness],
      );
      console.log(
        `[cleanroom][B1-a] 핀 없는 ${glm.harness} 게이트: ok=${nativeGate.ok} installed=${nativeGate.installed} authenticated=${nativeGate.authenticated} reason=${nativeGate.reason ?? "-"}`,
      );
      // 핀이 없으면 벤더 축은 아예 적용되지 않는다 — 머신 상태와 무관한 불변식.
      expect(nativeGate.reason).not.toBe("vendor-not-configured");

      const gate = await cr.mainCall<SpawnAuthGateResult>(
        "harness-manager.js",
        "checkSpawnAuthGate",
        [glm.harness, glm.id],
      );
      console.log(
        `[cleanroom][B1-a] ${glm.provider} 핀 게이트: ok=${gate.ok} reason=${gate.reason} vendor=${gate.vendor} missing=${(gate.missingEnvKeys ?? []).join(",")}`,
      );
      expect(gate.ok).toBe(false);
      expect(gate.reason).toBe("vendor-not-configured");
      expect(gate.vendor).toBe(glm.provider);
      // 안내에 실리는 것은 키 **이름**뿐이어야 한다(값 유출 금지).
      expect(gate.missingEnvKeys ?? []).toEqual(
        expect.arrayContaining(vendorEnvSecretKeys(glm.id)),
      );
      expect(gate.action ?? "").not.toContain(FAKE_VALUE);

      // ★그리고 이 판정은 렌더러가 보는 payload 까지 그대로 온다 — 진짜
      //   `agent:launch` IPC 를 부른다. 게이트에서 되돌아오므로 워크트리·PTY 같은
      //   부수효과는 하나도 일어나지 않는다.
      const launch = await cr.callRealIpc<{
        status: string;
        needsAuth?: { model: string; action: string; installed: boolean };
      }>("agent:launch", {
        agent: { name: "cleanroom-byom", model: glm.harness },
        cwd: cr.projectDir,
        projectId: "cleanroom-project",
        modelPin: glm.id,
      });
      console.log("[cleanroom][B1-a] agent:launch =", launch);
      expect(launch.status).toBe("blocked");
      // 사용자가 손봐야 하는 축은 CLI 로그인이 아니라 그 벤더의 키다.
      expect(launch.needsAuth?.model).toBe(glm.provider);
    } finally {
      await cr.close();
    }
  });

  test("B1-b 벤더 키만 서면 워커 스폰 게이트를 통과한다 — 같은 런의 다른 벤더는 여전히 막힌다", async () => {
    const [configured, unconfigured] = twoDistinctVendorModels();
    const cr = await launchCleanRoom({
      claude: "ready",
      codex: "missing",
      // 한 벤더의 키 세트만 세운다(값은 가짜 — 게이트는 존재만 본다).
      extraEnv: fakeEnvFor(configured),
    });
    try {
      const ok = await cr.mainCall<SpawnAuthGateResult>(
        "harness-manager.js",
        "checkSpawnAuthGate",
        [configured.harness, configured.id],
      );
      console.log(
        `[cleanroom][B1-b] ${configured.provider}(키 있음) 게이트: ok=${ok.ok} vendor=${ok.vendor} reason=${ok.reason ?? "-"}`,
      );
      expect(ok.ok).toBe(true);
      expect(ok.vendor).toBe(configured.provider);

      // ★대조군 — **같은 앱 인스턴스**에서 키가 없는 다른 벤더는 막힌다. 이
      //   한 쌍이 "통과가 벤더 키 때문" 임을 머신 상태와 무관하게 못박는다
      //   (둘 다 같은 Anthropic 계정·같은 claude 바이너리를 본다).
      const blocked = await cr.mainCall<SpawnAuthGateResult>(
        "harness-manager.js",
        "checkSpawnAuthGate",
        [unconfigured.harness, unconfigured.id],
      );
      console.log(
        `[cleanroom][B1-b] ${unconfigured.provider}(키 없음) 게이트: ok=${blocked.ok} reason=${blocked.reason}`,
      );
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("vendor-not-configured");
      expect(blocked.vendor).toBe(unconfigured.provider);

      // ※ 한계: 여기서 멈춘다 — 통과 뒤의 실제 PTY 스폰은 벤더 엔드포인트에
      //   가짜 키로 붙는 네트워크 호출이 되고, 이 하네스의 검증 대상도 아니다.
      //   "게이트 통과" 다음 구간(applyVendorEnv 조립)은 유닛테스트가 덮는다.
    } finally {
      await cr.close();
    }
  });

  test("B1-c 오케 선택은 env-swap 벤더를 받지 않는다(영구 저장 규율) — grok 은 받는다", async () => {
    const [glm] = twoDistinctVendorModels();
    const cr = await launchCleanRoom({ claude: "ready" });
    try {
      const normalize = (value: string) =>
        cr.mainCall<string>(
          "model-selection.js",
          "normalizeOrchestratorModelSetting",
          [value],
        );
      // env·손편집·옛 저장값으로 들어온 env-swap 핀은 프로바이더로 강등된다.
      expect(await normalize(`${glm.harness}:${glm.id}`)).toBe(glm.harness);
      // #638 (b) — grok 이 후보에 편입돼 더는 claude 로 조용히 강등되지 않는다.
      expect(await normalize("grok")).toBe("grok");
    } finally {
      await cr.close();
    }
  });

  test("B1-d(특성화·잔여장벽 F6) env-swap 벤더 키만 가진 유저는 ②단계를 여전히 못 넘긴다", async () => {
    const [vendor] = twoDistinctVendorModels();
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "missing",
      extraEnv: fakeEnvFor(vendor), // 이 벤더 키만 등록된 신규 유저
    });
    try {
      await passFirstRunModals(cr.page);
      await openWorkTab(cr.page, "시작하기");
      await cr.page.locator('button:has-text("인증")').first().click();
      await cr.page.waitForTimeout(1200);

      // ②단계 본문의 BYOM 섹션을 편다(신규 유저가 하는 그 클릭).
      await cr.page
        .locator('button:has-text("벤더 키로 시작하기")')
        .first()
        .click();
      await cr.page.waitForTimeout(1200);
      const body = await cr.page.locator("body").innerText();
      await cr.shot("B1d-byom-worker-only");

      const done = await doneSteps(cr.page);
      // ★현재 동작: env-swap 벤더는 **오케를 태울 수 없어서**(B1-c 의 그 규율)
      //   ②단계를 대신 만족시키지 못한다. 화면은 그 사실을 정직하게 적지만,
      //   활성화 관점에선 "GLM/Kimi 구독만 가진 유저는 여전히 ②에서 멈춘다" 는
      //   장벽 그대로다(F6). 오케 후보가 넓어지면 이 기대값을 뒤집어라.
      const workerOnlyNote = body.includes("작업 에이전트 전용");
      const canHostNote = body.includes("오케스트레이터까지 띄울 수 있습니다");
      console.log(
        `[cleanroom][B1-d] ${vendor.provider} 키만 등록: 워커전용안내=${workerOnlyNote} 오케가능안내=${canHostNote} 완료단계=${JSON.stringify(done)}`,
      );
      expect(workerOnlyNote).toBe(true);
      expect(canHostNote).toBe(false);
      expect(done).not.toContain("auth");
    } finally {
      await cr.close();
    }
  });
});

test.describe("@cleanroom grok 오케 marblo MCP 게이트(#639)", () => {
  test("B2-a grok 이 marblo MCP 를 못 붙이면 프로브가 실패한다(무력 오케 차단의 근거)", async () => {
    // PATH 위의 grok 은 클린룸의 가짜 스크립트뿐 — `mcp doctor` 를 흉내내지
    // 못하므로 프로브는 실패해야 한다. 이 방향이 살아 있어야 B2-b 의 통과가
    // "그냥 늘 ok" 가 아니라는 게 성립한다.
    const cr = await launchCleanRoom({ grok: "installed" });
    try {
      const probe = await cr.mainCall<GrokMcpProbeResult>(
        "agent-config.js",
        "probeGrokMarbloMcp",
        [cr.projectDir],
      );
      console.log("[cleanroom][B2-a] 가짜 grok 프로브:", probe);
      expect(probe.ok).toBe(false);
      expect(probe.toolCount).toBe(0);
      // 시크릿·경로 값이 UI 문구로 새지 않는지(로그/에러 문구는 사람이 본다).
      expect(probe.detail).not.toContain(FAKE_VALUE);
    } finally {
      await cr.close();
    }
  });

  test("B2-b 진짜 grok 이 있으면 marblo MCP 가 실제로 기동되고 오케 최소 툴 표면을 넘긴다", async () => {
    const grokBin = whichReal("grok");
    test.skip(
      !grokBin,
      "이 머신에 grok CLI 가 없습니다 — 실기동 프로브는 라이브 바이너리가 필요합니다",
    );
    // userData/HOME 격리는 유지하고, **바이너리 해석 경로만** 연다.
    const cr = await launchCleanRoom({
      extraPathDirs: [path.dirname(grokBin!)],
    });
    try {
      const started = Date.now();
      const probe = await cr.mainCall<GrokMcpProbeResult>(
        "agent-config.js",
        "probeGrokMarbloMcp",
        [cr.projectDir],
      );
      const ms = Date.now() - started;
      console.log(
        `[cleanroom][B2-b] 실기동 프로브: ok=${probe.ok} tools=${probe.toolCount} reason=${probe.reason || "-"} (${ms}ms) · 오케 최소 표면=${CODEX_ORCH_REQUIRED_MCP_TOOLS.length}`,
      );
      expect(probe.ok).toBe(true);
      // 개수는 서버 표면이 자라면 늘어난다 — 하한만 못박는다(실측 41).
      expect(probe.toolCount).toBeGreaterThanOrEqual(
        CODEX_ORCH_REQUIRED_MCP_TOOLS.length,
      );
    } finally {
      await cr.close();
    }
  });
});

test.describe("@cleanroom 오케 차단이 화면에 뜨는가(d44PLFhR)", () => {
  /**
   * ★무음 차단 회귀.
   *
   * 라이브 증상: 사장님이 오케를 grok 으로 바꾸면 "그냥 안 됐다". 원인은 두 겹인데
   * 두 번째가 코드 결함이다 —
   *   ① grok 리프레시 토큰이 만료돼(RefreshTokenRejected) 인증 게이트가 **옳게**
   *      막았다.
   *   ② 그런데 렌더러 호출부가 `if (opensCliSetup) 위저드 else 패널배너` 라는
   *      배타 분기였고, 위저드의 재오픈 가드는 claude/codex 중 하나라도 준비되면
   *      스스로를 억제한다(`shouldOpenGateOnReopen`). claude 가 멀쩡한 사용자가
   *      grok 을 고르면 **위저드도 패널도 아무 말을 안 한다**.
   *
   * 그래서 이 테스트의 시나리오가 정확히 그 조합이다: claude=ready(위저드 억제
   * 조건) + grok 인증 차단 봉투. 유닛테스트는 순수 규칙만 보므로, "실제 앱 화면에
   * 배너 DOM 이 뜨는가" 는 여기서만 증명된다.
   */
  const GROK_AUTH_BLOCK = {
    model: "grok",
    action: "grok login",
    installed: true,
    reason: "not-authenticated",
  };

  test("C-a claude 가 준비된 사용자여도 grok 인증 차단이 패널 배너로 뜬다", async () => {
    const cr = await launchCleanRoom({
      claude: "ready", // ← 위저드가 스스로를 억제하는 조건
      grok: "installed", // 설치는 됐고 로그인만 없음
      orchestratorLaunchBlock: GROK_AUTH_BLOCK,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);

      const banner = cr.page.locator(
        '[data-testid="orchestrator-launch-block"]',
      );
      await expect(banner).toBeVisible({ timeout: 20_000 });

      const kind = await banner.getAttribute("data-block-kind");
      const text = (await banner.innerText()).replace(/\s+/g, " ");
      console.log(`[cleanroom][C-a] 차단 배너 kind=${kind} · 문구="${text}"`);

      expect(kind).toBe("auth");
      // main 이 준 조치 문구가 그대로 보여야 한다 — 사용자가 할 일이 그것이다.
      expect(text).toContain(GROK_AUTH_BLOCK.action);
      // 어느 CLI 가 막혔는지 이름이 화면에 있어야 한다.
      expect(text).toContain("grok");
      // ★MCP 문구가 새면 정반대 방향("폴더 신뢰")으로 안내한다.
      expect(text).not.toContain("신뢰");
      // 로그인으로 풀리는 차단이므로 원클릭 로그인 CTA 가 걸린다.
      await expect(
        cr.page.locator('[data-testid="orchestrator-block-login"]'),
      ).toBeVisible();
    } finally {
      await cr.close();
    }
  });

  test("C-b MCP 차단은 같은 배너를 쓰되 사유가 갈린다(#639 회귀 방지)", async () => {
    const cr = await launchCleanRoom({
      claude: "ready",
      grok: "installed",
      orchestratorLaunchBlock: {
        model: "grok",
        action:
          "grok 오케 차단 — marblo MCP 툴 0개. 프로젝트 폴더 신뢰를 확인하세요.",
        installed: true,
        reason: "mcp-unavailable",
      },
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);

      const banner = cr.page.locator(
        '[data-testid="orchestrator-launch-block"]',
      );
      await expect(banner).toBeVisible({ timeout: 20_000 });
      const kind = await banner.getAttribute("data-block-kind");
      const text = (await banner.innerText()).replace(/\s+/g, " ");
      console.log(`[cleanroom][C-b] 차단 배너 kind=${kind} · 문구="${text}"`);

      expect(kind).toBe("mcp");
      expect(text).toContain("신뢰");
      // 로그인으로 안 풀리는 차단이므로 로그인 CTA 를 걸지 않는다.
      // (문구엔 "로그인 문제가 아닙니다" 가 있으므로 버튼 자체로 판정한다.)
      await expect(
        cr.page.locator('[data-testid="orchestrator-block-login"]'),
      ).toHaveCount(0);
    } finally {
      await cr.close();
    }
  });
});
