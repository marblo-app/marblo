/**
 * ②단계의 **BYOM 대안**(활성화 F4) 게이트.
 *
 * 이 테스트가 지키는 불변식은 셋이다:
 *
 *  1. **목록은 파생이다** — BYOM 대안 목록은 #632 의 벤더 카드(레지스트리 파생)를
 *     그대로 재사용하고, 시작하기 탭이 그리는 목록과 원소가 같다. 렌더러 어딘가에
 *     벤더 배열이 되살아나면 깨진다.
 *  2. **"오케를 태울 수 있나" 는 사실이지 취향이 아니다** — 판정은 오케 셀렉터가
 *     실제로 세우는 칸(`ORCHESTRATOR_MODEL_OPTIONS`, 레지스트리 미러)에서 나온다.
 *     양쪽 다 **실제 데이터**로 검사하므로, 메인 프로세스가 오케 후보를 넓히면 이
 *     테스트가 새 사실을 그대로 받아들인다(리터럴 기대값이 없다).
 *  3. **넘길 수 없는 단계를 넘겼다고 하지 않는다** — ③④단계가 전부 오케를 거치므로,
 *     워커 전용 벤더는 ②단계 통과에 기여하지 않는다. 이게 깨지면 사용자는 ②단계를
 *     통과한 뒤 ④단계(첫 티켓)에서 이유 없이 막힌다.
 *
 * BYOM 축이 비어 있을 때(=기존 사용자) 게이트가 **바이트 동일**하게 도는지도 함께
 * 못박는다 — 이 티켓은 새 길을 여는 것이지 기존 길을 바꾸는 것이 아니다.
 */
import { describe, it, expect } from "vitest";
import { quickLaneVendorCatalog } from "../../electron/model-selection";
import { HARNESS_NATIVE_VENDOR } from "../../electron/model-registry";
import {
  additionalVendorCards,
  vendorSetupCards,
  type CliRowLike,
  type VendorCatalogGroupLike,
  type VendorSetupCard,
} from "../../src/lib/vendorOnboarding";
import {
  byomGateContribution,
  byomHeadline,
  byomOptions,
  byomReadyCount,
  orchestratorBareHarnesses,
  orchestratorPinnedModelIds,
  type ByomOption,
} from "../../src/lib/byomOnboarding";
import { ORCHESTRATOR_MODEL_OPTIONS } from "../../src/stores/orchestratorStore";
import {
  authSatisfied,
  canAdvanceWizard,
  initialWizardStep,
  installSatisfied,
  type WizardGateState,
} from "../../src/lib/cliSetupGate";
import {
  EMPTY_PROGRESS,
  effectiveDone,
  isOnboardingComplete,
  resumeStep,
} from "../../src/lib/onboardingProgress";

/** `cliSetupStore.ROWS` / `ORCHESTRATOR_CLI_IDS` 의 사본(렌더러 store 를 안 끌어온다). */
const CLI_ROWS: CliRowLike[] = [
  { id: "cli-claude-code", model: "claude" },
  { id: "cli-codex", model: "codex" },
  { id: "cli-grok", model: "grok" },
  { id: "cli-antigravity", model: "antigravity" },
];
const ORCHESTRATOR_ROW_IDS = ["cli-claude-code", "cli-codex"];

/** 렌더러가 받는 모양으로 접은 실제 카탈로그(available/missing 은 main 이 얹는다). */
function catalogGroups(
  presentEnv: Record<string, string> = {}
): VendorCatalogGroupLike[] {
  return quickLaneVendorCatalog().map((g) => {
    const missingEnvKeys = g.requiredEnvKeys.filter((k) => !presentEnv[k]);
    return {
      vendor: g.vendor,
      label: g.label,
      harness: g.harness,
      command: g.command,
      requiredEnvKeys: [...g.requiredEnvKeys],
      missingEnvKeys,
      available: missingEnvKeys.length === 0,
      models: g.models.map((m) => ({ modelId: m.modelId })),
    };
  });
}

function realCards(presentEnv: Record<string, string> = {}): VendorSetupCard[] {
  return vendorSetupCards(catalogGroups(presentEnv), {
    cliRows: CLI_ROWS,
    orchestratorRowIds: ORCHESTRATOR_ROW_IDS,
    cliStates: {},
    vendorSecrets: null,
  });
}

const OPTION_VALUES = ORCHESTRATOR_MODEL_OPTIONS.map((o) => o.value);

/** 픽스처 한 칸(분류·상태만 다르게 두고 나머지는 의미 없는 값). */
function card(over: Partial<VendorSetupCard> = {}): VendorSetupCard {
  return {
    vendor: "v",
    label: "V",
    harness: "claude",
    command: "claude",
    kind: "envSwap",
    status: "ready",
    requiredEnvKeys: ["V_API_KEY"],
    missingEnvKeys: [],
    modelIds: ["v-1"],
    exampleModelId: "v-1",
    cliRowId: null,
    ...over,
  };
}

function option(over: Partial<ByomOption> = {}): ByomOption {
  return { ...card(), canHostOrchestrator: true, ...over };
}

describe("orchestratorPinnedModelIds / orchestratorBareHarnesses", () => {
  it("두 축을 갈라 읽는다 — 모델 핀과 '기본 모델로 띄우는' 칸", () => {
    const values = [
      "claude",
      "codex",
      "claude:claude-opus-5",
      "codex:gpt-5.6-terra@high",
    ];
    expect([...orchestratorPinnedModelIds(values)].sort()).toEqual([
      "claude-opus-5",
      "gpt-5.6-terra",
    ]);
    expect([...orchestratorBareHarnesses(values)].sort()).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("실제 셀렉터 칸 목록에서도 빈 집합이 아니다(파생이 살아 있다)", () => {
    expect(orchestratorPinnedModelIds(OPTION_VALUES).size).toBeGreaterThan(0);
  });
});

describe("byomOptions — 목록", () => {
  it("시작하기 탭이 그리는 목록과 원소가 같다(같은 규칙, 다른 화면)", () => {
    const cards = realCards();
    const shown = additionalVendorCards(cards).map((c) => c.vendor);
    const byom = byomOptions(cards, OPTION_VALUES).map((c) => c.vendor);
    expect(byom).toEqual(shown);
  });

  it("①②단계가 이미 다루는 오케 CLI 벤더는 대안 목록에 없다", () => {
    const options = byomOptions(realCards(), OPTION_VALUES);
    expect(options.some((o) => o.kind === "orchestratorCli")).toBe(false);
    expect(options.length).toBeGreaterThan(0); // 대안이 실제로 존재한다
  });

  it("시작하기 BYOM 목록에 Solar Pro가 포함되고 UPSTAGE_API_KEY 입력 대상으로 선다", () => {
    const solar = byomOptions(realCards(), OPTION_VALUES).find(
      (o) => o.vendor === "upstage"
    );
    expect(solar).toMatchObject({
      label: "Upstage Solar",
      kind: "envSwap",
      status: "needsKey",
      requiredEnvKeys: ["UPSTAGE_API_KEY"],
      missingEnvKeys: ["UPSTAGE_API_KEY"],
      modelIds: ["solar-pro4"],
      exampleModelId: "solar-pro4",
      canHostOrchestrator: false,
    });
  });

  it("모델 행이 없는 벤더는 카드가 서지 않는다", () => {
    const options = byomOptions(
      [card({ vendor: "empty", modelIds: [], exampleModelId: "" })],
      OPTION_VALUES
    );
    expect(options).toEqual([]);
  });

  it("canHostOrchestrator 는 셀렉터 칸 목록에서 파생된다(리터럴 아님)", () => {
    const pinned = [...orchestratorPinnedModelIds(OPTION_VALUES)];
    const [hosted] = byomOptions(
      [
        card({ vendor: "hosted", modelIds: [pinned[0]], kind: "nativeCli" }),
        card({ vendor: "worker", modelIds: ["not-in-any-selector"] }),
      ],
      OPTION_VALUES
    ).filter((o) => o.vendor === "hosted");
    expect(hosted.canHostOrchestrator).toBe(true);
    const worker = byomOptions(
      [card({ vendor: "worker", modelIds: ["not-in-any-selector"] })],
      OPTION_VALUES
    )[0];
    expect(worker.canHostOrchestrator).toBe(false);
  });

  it("★자체 CLI 벤더는 셀렉터가 그 CLI 칸을 세우는 순간 오케 후보가 된다", () => {
    // ★이 테스트가 예고했던 "electron 후속 티켓" 이 착지했다(F6): 셀렉터 미러에
    // 모델 접미 없는 칸 "grok" 이 생겼고, 이 화면은 **코드 수정 없이** 따라왔다.
    // 이제 단언 방향이 뒤집힌다 — 열린 것이 현재 사실이고, 닫힌 쪽이 가정이다.
    const grok = card({
      vendor: "xai",
      harness: "grok",
      command: "grok",
      kind: "nativeCli",
      status: "needsLogin",
      requiredEnvKeys: [],
      modelIds: ["grok-4.6", "grok-4.5"],
      exampleModelId: "grok-4.6",
      cliRowId: "cli-grok",
    });
    // 라이브 목록(=셀렉터가 실제로 세우는 칸)엔 grok 이 있다.
    expect(OPTION_VALUES).toContain("grok");
    const opened = byomOptions([grok], OPTION_VALUES)[0];
    expect(opened.canHostOrchestrator).toBe(true);
    expect(byomGateContribution([opened])).toEqual({
      installed: true, // 설치는 됐고
      ready: false, // 로그인이 남았다
    });
    // 반대 방향도 그대로 산다: 셀렉터가 그 칸을 안 세우면 후보가 아니다
    // (파생이지 리터럴이 아님을 증명하는 축).
    // ★grok 은 맨몸 칸 + 모델 핀 칸(grok:grok-4.6/4.5)을 함께 갖는다. 어느 하나만
    // 지우면 나머지가 여전히 후보 자격을 준다 — 그것도 파생이라는 증거다. 그래서
    // 이 방향을 증명하려면 grok 계열 칸을 **통째로** 내려야 한다.
    const closed = byomOptions(
      [grok],
      OPTION_VALUES.filter((v) => v !== "grok" && !v.startsWith("grok:"))
    )[0];
    expect(closed.canHostOrchestrator).toBe(false);
    // 맨몸 칸만 내리면? 모델 핀 칸이 남아 있으므로 여전히 오케 후보다.
    const pinnedOnly = byomOptions(
      [grok],
      OPTION_VALUES.filter((v) => v !== "grok")
    )[0];
    expect(pinnedOnly.canHostOrchestrator).toBe(true);
  });

  it("env-swap 벤더는 하네스 이름이 같다는 이유로 오케 후보가 되지 않는다", () => {
    // ★이 단언이 확정된 결정(오케 선택은 영구저장이라 env-swap 미편입)을 지킨다.
    // `claude` 칸의 주인은 Anthropic 계정이지, 그 바이너리를 빌려 쓰는 벤더가 아니다.
    const glmLike = card({ harness: "claude", command: "claude" });
    expect(
      byomOptions([glmLike], ["claude", "codex"])[0].canHostOrchestrator
    ).toBe(false);
  });

  it("★오늘의 라이브 사실: BYOM 만으로 ②단계를 넘을 수 있다 — 네이티브 CLI 벤더(grok) 경로", () => {
    // ★이 테스트는 종전엔 반대 사실("못 넘는다")의 트립와이어였다. 그때의 원인은
    //   오케 셀렉터가 claude/codex 두 칸만 세운다는 것이었고, 그 자리에서 스스로
    //   "이 단언이 깨지는 날 = BYOM 오케를 연 날" 이라고 적어 뒀다. F6 이 그날이다:
    //   셀렉터가 ORCHESTRATOR_HARNESS_SETTINGS 파생으로 grok/antigravity 칸을
    //   세우면서, 자체 CLI + 자기 로그인을 가진 벤더는 실제로 오케를 태운다.
    //   화면(ByomStartSection)의 workerOnly 문구는 리터럴이 아니라 이 파생을 따르는
    //   분기라 함께 자동으로 옳아진다 — 걷어낼 문구가 없다.
    // 모든 벤더 키가 등록되고 모든 CLI 가 로그인된 최상의 조건을 만든다.
    const cliStates = Object.fromEntries(
      CLI_ROWS.map((r) => [r.id, { installed: true, authenticated: true }])
    );
    const groups = catalogGroups();
    const allKeys = Object.fromEntries(
      groups.flatMap((g) => g.requiredEnvKeys.map((k) => [k, "x"]))
    );
    const cards = vendorSetupCards(catalogGroups(allKeys), {
      cliRows: CLI_ROWS,
      orchestratorRowIds: ORCHESTRATOR_ROW_IDS,
      cliStates,
      vendorSecrets: null,
    });
    const options = byomOptions(cards, OPTION_VALUES);
    expect(options.every((o) => o.status === "ready")).toBe(true);

    expect(byomGateContribution(options)).toEqual({
      installed: true,
      ready: true,
    });
    expect(byomHeadline(options)).toBe("ready");

    // ★단, 그 통과는 **오케를 태울 수 있는 벤더** 때문이지 "준비된 벤더가 있어서"
    // 가 아니다. env-swap 벤더(GLM/MiniMax/Kimi)만 준비된 상태는 여전히 ②단계를
    // 못 넘는다 — 그 규율(오케 선택은 영구저장이라 env-swap 미편입)이 이 티켓으로
    // 느슨해지지 않았음을 같은 데이터로 확인한다.
    const envSwapOnly = options.filter((o) => o.kind === "envSwap");
    expect(envSwapOnly.length).toBeGreaterThan(0);
    expect(envSwapOnly.every((o) => o.status === "ready")).toBe(true);
    expect(byomGateContribution(envSwapOnly)).toEqual({
      installed: false,
      ready: false,
    });
    expect(byomHeadline(envSwapOnly)).toBe("workerOnly");
  });

  it("★라이브 사실: 오케 후보로 서는 것은 하네스 네이티브 벤더뿐이다", () => {
    // `model-selection.selectorEligible` 의 규율(오케 선택은 프로젝트별로 영구
    // 저장되므로 조건부 크레덴셜을 기본값에 얹지 않는다)이 실제로 지켜지는지를
    // 화면 쪽에서 한 번 더 확인한다. 그 규율이 걷히면 여기가 먼저 알려준다.
    for (const o of byomOptions(realCards(), OPTION_VALUES)) {
      if (!o.canHostOrchestrator) continue;
      expect(o.vendor).toBe(HARNESS_NATIVE_VENDOR[o.harness]);
    }
  });
});

describe("byomGateContribution — 넘길 수 있는 단계만 넘긴다", () => {
  it("오케를 못 태우는 벤더는 준비돼 있어도 게이트에 기여하지 않는다", () => {
    const gate = byomGateContribution([
      option({ status: "ready", canHostOrchestrator: false }),
    ]);
    expect(gate).toEqual({ installed: false, ready: false });
  });

  it("오케 가능 env-swap 벤더의 키가 서면 ①②단계를 대신 만족시킨다", () => {
    expect(
      byomGateContribution([option({ kind: "envSwap", status: "ready" })])
    ).toEqual({ installed: true, ready: true });
  });

  it("키가 없으면 아무 단계도 만족시키지 않는다", () => {
    expect(
      byomGateContribution([option({ kind: "envSwap", status: "needsKey" })])
    ).toEqual({ installed: false, ready: false });
  });

  it("네이티브 CLI 벤더: 설치됐지만 미로그인이면 ①단계만 만족한다", () => {
    expect(
      byomGateContribution([
        option({ kind: "nativeCli", status: "needsLogin" }),
      ])
    ).toEqual({ installed: true, ready: false });
  });

  it("네이티브 CLI 벤더: 미설치·프로브 전에는 아무것도 만족하지 않는다", () => {
    for (const status of ["needsInstall", "unknown"] as const) {
      expect(
        byomGateContribution([option({ kind: "nativeCli", status })])
      ).toEqual({ installed: false, ready: false });
    }
  });

  it("여러 벤더 중 하나만 준비돼도 통과한다(.some 의미)", () => {
    expect(
      byomGateContribution([
        option({ status: "needsKey" }),
        option({ status: "ready" }),
      ]).ready
    ).toBe(true);
  });
});

describe("byomHeadline / byomReadyCount — 화면 문구 선택", () => {
  it("오케 가능 벤더가 준비되면 ready", () => {
    expect(byomHeadline([option({ status: "ready" })])).toBe("ready");
  });

  it("준비됐지만 워커 전용이면 workerOnly", () => {
    expect(
      byomHeadline([option({ status: "ready", canHostOrchestrator: false })])
    ).toBe("workerOnly");
  });

  it("아직 설정이 필요하면 setup, 붙일 벤더가 없으면 none", () => {
    expect(byomHeadline([option({ status: "needsKey" })])).toBe("setup");
    expect(byomHeadline([])).toBe("none");
  });

  it("readyCount 는 오케 가능 여부와 무관하게 '지금 쓸 수 있는' 수다", () => {
    expect(
      byomReadyCount([
        option({ status: "ready", canHostOrchestrator: false }),
        option({ status: "needsKey" }),
      ])
    ).toBe(1);
  });
});

describe("게이트 통합 — BYOM 축이 ①②단계를 연다", () => {
  const base: WizardGateState = {
    requiredInstalled: false,
    requiredReady: false,
    hasProject: false,
  };

  it("BYOM 축이 없으면 종전과 완전히 같다(무회귀)", () => {
    expect(initialWizardStep(base)).toBe("install");
    expect(canAdvanceWizard("install", base)).toBe(false);
    expect(canAdvanceWizard("auth", base)).toBe(false);
    expect(installSatisfied(base)).toBe(false);
    expect(authSatisfied(base)).toBe(false);
    // 종전 축만으로도 그대로 열린다.
    const claude = { ...base, requiredInstalled: true, requiredReady: true };
    expect(canAdvanceWizard("auth", claude)).toBe(true);
    expect(initialWizardStep(claude)).toBe("prd");
  });

  it("Claude/Codex 계정이 하나도 없어도 BYOM 준비만으로 ③단계로 간다", () => {
    const byom = { ...base, byomInstalled: true, byomReady: true };
    expect(canAdvanceWizard("install", byom)).toBe(true);
    expect(canAdvanceWizard("auth", byom)).toBe(true);
    expect(initialWizardStep(byom)).toBe("prd");
  });

  it("BYOM 이 설치까지만 됐으면 ②단계에서 멈춘다", () => {
    const byom = { ...base, byomInstalled: true, byomReady: false };
    expect(canAdvanceWizard("install", byom)).toBe(true);
    expect(canAdvanceWizard("auth", byom)).toBe(false);
    expect(initialWizardStep(byom)).toBe("auth");
  });

  it("진행 기록도 BYOM 을 완료로 읽는다(재진입 시 다시 묻지 않는다)", () => {
    const live: WizardGateState = {
      ...base,
      byomInstalled: true,
      byomReady: true,
      hasProject: true,
    };
    const done = effectiveDone(EMPTY_PROGRESS, live);
    expect([...done].sort()).toEqual(["auth", "install", "prd"]);
    expect(resumeStep(EMPTY_PROGRESS, live)).toBe("firstTicket");
    expect(isOnboardingComplete(EMPTY_PROGRESS, live)).toBe(false);
    expect(
      isOnboardingComplete({ ...EMPTY_PROGRESS, done: ["firstTicket"] }, live)
    ).toBe(true);
  });
});
