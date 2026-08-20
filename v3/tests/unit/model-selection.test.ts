/**
 * `model@effort` 파서 + 핀 해석 회귀 가드.
 *
 * 이 티켓이 고치는 결함의 테스트판: `dispatch_task(model="fable")` 이
 * `normalizeModel()` 에서 undefined 가 되어 **조용히 사라지던** 경로를 여기서
 * 못박는다. 그리고 §8.3 불변식 — 지정 모델이 미검증 CLI 여도 spawn 은 성공하고
 * opus 로 폴백한다 — 을 버전 주입으로 결정적으로 검증한다.
 *
 * §P1 벤더 숏핸드 회귀 가드: `dispatch_task(model="minimax")` 이
 * `resolveModelPin()` 에서 undefined 가 되어 antigravity/gpt 로 폴백하던
 * 결함을 `resolveVendorShorthand()` 로 못박는다.
 */
import { describe, it, expect } from "vitest";
import {
  parseModelSpec,
  resolveModelPin,
  findModelLoose,
  looseIndexCollisions,
  splitOrchestratorModelValue,
  orchestratorModelValue,
  claudeOrchestratorChoices,
  codexOrchestratorChoices,
  grokOrchestratorChoices,
  ORCHESTRATOR_SELECTOR_RETIRED,
  normalizeOrchestratorModelSetting,
  selectableEfforts,
  humanizeClaudeModelId,
  resolveVendorShorthand,
} from "../../electron/model-selection";
import { normalizeModel } from "../../electron/dispatch-scoring";
import { MODEL_REGISTRY, getModel } from "../../electron/model-registry";
import { FALLBACK_TOP_CLAUDE_MODEL } from "../../electron/agent-config";

/** 레지스트리가 claude-fable-5 에 요구하는 minCli(2.1.170) 위/아래 */
const CLI_OK = "2.1.220";
const CLI_OLD = "2.1.100";

describe("parseModelSpec — 프로바이더 토큰(기존 동작 보존)", () => {
  it("프로바이더만 말하면 구체 모델로 승격하지 않는다", () => {
    for (const [input, provider] of [
      ["claude", "claude"],
      ["codex", "gpt"],
      ["gpt", "gpt"],
      ["agy", "antigravity"],
      ["antigravity", "antigravity"],
    ] as const) {
      const spec = parseModelSpec(input);
      expect(spec, input).toBeDefined();
      expect(spec!.harness, input).toBe(provider);
      expect(spec!.modelId, input).toBeUndefined();
    }
  });

  it("빈 입력/미지 문자열은 undefined — 추측 스폰하지 않는다", () => {
    expect(parseModelSpec(undefined)).toBeUndefined();
    expect(parseModelSpec("")).toBeUndefined();
    expect(parseModelSpec("   ")).toBeUndefined();
    expect(parseModelSpec("존재하지않는모델")).toBeUndefined();
  });

  it("★회귀: normalizeModel 이 놓치던 구체 모델을 이제는 붙잡는다", () => {
    // 이것이 이 티켓의 결함 그 자체 — 아래 두 줄이 같이 서 있어야 의미가 있다.
    expect(normalizeModel("fable")).toBeUndefined();
    expect(parseModelSpec("fable")?.modelId).toBe("claude-fable-5");
  });
});

describe("parseModelSpec — 느슨한 표기", () => {
  const cases: Array<[string, string]> = [
    ["fable", "claude-fable-5"],
    ["fable5", "claude-fable-5"],
    ["claude-fable-5", "claude-fable-5"],
    ["opus", "claude-opus-5"],
    ["opus5", "claude-opus-5"],
    ["opus-5", "claude-opus-5"],
    ["Opus 5", "claude-opus-5"],
    ["OPUS5", "claude-opus-5"],
    ["opus4.8", "claude-opus-4-8"],
    ["opus-4-8", "claude-opus-4-8"],
    ["claude-opus-4-8", "claude-opus-4-8"],
    ["sonnet", "claude-sonnet-5"],
    ["sonnet5", "claude-sonnet-5"],
    ["haiku", "claude-haiku-4-5-20251001"],
    ["haiku4.5", "claude-haiku-4-5-20251001"],
    ["gpt-5.6-terra", "gpt-5.6-terra"],
    ["gpt5.6terra", "gpt-5.6-terra"],
    ["5.6-luna", "gpt-5.6-luna"],
    ["gpt-5.4-mini", "gpt-5.4-mini"],
    ["grok-4.5", "grok-4.5"],
  ];
  it.each(cases)("%s → %s", (input, expected) => {
    expect(parseModelSpec(input)?.modelId).toBe(expected);
  });

  it("구체 모델의 프로바이더는 레지스트리에서 파생된다", () => {
    expect(parseModelSpec("opus5")!.harness).toBe("claude");
    expect(parseModelSpec("gpt-5.6-terra")!.harness).toBe("gpt");
    expect(parseModelSpec("grok-4.5")!.harness).toBe("grok");
  });

  it("느슨한 인덱스에 충돌이 없다(모델 추가 시 이 테스트가 먼저 깨진다)", () => {
    expect(looseIndexCollisions()).toEqual([]);
  });

  it("레지스트리의 모든 id·alias 는 스스로를 찾을 수 있다", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(findModelLoose(entry.id)?.id, entry.id).toBe(entry.id);
      for (const alias of entry.aliases) {
        expect(findModelLoose(alias)?.id, alias).toBe(entry.id);
      }
    }
  });
});

describe("parseModelSpec — @effort", () => {
  it("지원하는 effort 는 그대로 붙는다", () => {
    const spec = parseModelSpec("gpt-5.6-terra@xhigh");
    expect(spec).toMatchObject({
      harness: "gpt",
      modelId: "gpt-5.6-terra",
      effort: "xhigh",
    });
  });

  it("그 모델이 지원하지 않는 effort 는 버리되 모델은 살린다", () => {
    // luna 는 ultra 가 없다(레지스트리 §1.2).
    expect(getModel("gpt-5.6-luna")!.efforts).not.toContain("ultra");
    const spec = parseModelSpec("gpt-5.6-luna@ultra");
    expect(spec!.modelId).toBe("gpt-5.6-luna");
    expect(spec!.effort).toBeUndefined();
    expect(spec!.droppedEffort).toBe("ultra");
  });

  it("claude 는 effort 축이 없으므로 effort 를 버린다(모델 지정은 유지)", () => {
    const spec = parseModelSpec("fable@high");
    expect(spec!.modelId).toBe("claude-fable-5");
    expect(spec!.effort).toBeUndefined();
    expect(spec!.droppedEffort).toBe("high");
  });

  it("잘못된 effort 표기가 모델 해석을 깨뜨리지 않는다", () => {
    expect(parseModelSpec("opus5@쓰레기")?.modelId).toBe("claude-opus-5");
  });
});

describe("resolveModelPin — 정책 적용", () => {
  it("claude 구체 지정 → --model 에 넣을 구체 id", () => {
    const pin = resolveModelPin("opus5", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      claudeModel: "claude-opus-5",
      label: "claude-opus-5",
    });
    expect(pin!.fallback).toBeUndefined();
  });

  it("fable5 는 자격 CLI 에서 그대로 핀된다", () => {
    expect(resolveModelPin("fable", CLI_OK)!.claudeModel).toBe(
      "claude-fable-5",
    );
  });

  it("★미자격 CLI 면 opus 로 폴백하고 핀은 여전히 유효하다(spawn 안 깨짐)", () => {
    const pin = resolveModelPin("fable5", CLI_OLD);
    expect(pin!.claudeModel).toBe(FALLBACK_TOP_CLAUDE_MODEL);
    expect(pin!.fallback?.reason).toBe("fable5_version_guard");
    expect(pin!.fallback?.requested).toBe("claude-fable-5");
  });

  it("★CLI 버전을 못 읽어도(빈 문자열) 폴백일 뿐 예외가 아니다", () => {
    const pin = resolveModelPin("opus5", "");
    expect(pin!.claudeModel).toBe(FALLBACK_TOP_CLAUDE_MODEL);
    expect(pin!.fallback).toBeDefined();
  });

  it("codex 구체 지정 → model + effort, label 은 model@effort", () => {
    const pin = resolveModelPin("gpt-5.6-terra@max", CLI_OK);
    expect(pin).toMatchObject({
      harness: "gpt",
      codexModel: "gpt-5.6-terra",
      codexEffort: "max",
      label: "gpt-5.6-terra@max",
    });
    expect(pin!.claudeModel).toBeUndefined();
  });

  it("effort 없는 codex 지정은 CLI 기본 effort 를 건드리지 않는다", () => {
    const pin = resolveModelPin("gpt-5.6-luna", CLI_OK);
    expect(pin!.codexModel).toBe("gpt-5.6-luna");
    expect(pin!.codexEffort).toBeUndefined();
    expect(pin!.label).toBe("gpt-5.6-luna");
  });

  it("프로바이더만 지정하면 모델 핀이 생기지 않는다(티어 정책 그대로)", () => {
    const pin = resolveModelPin("codex", CLI_OK);
    expect(pin).toMatchObject({ harness: "gpt", label: "gpt" });
    expect(pin!.codexModel).toBeUndefined();
    expect(pin!.claudeModel).toBeUndefined();
  });

  it("grok 구체 지정 → native model pin", () => {
    const pin = resolveModelPin("grok-4.5", CLI_OK);
    expect(pin).toMatchObject({
      harness: "grok",
      nativeModel: "grok-4.5",
      label: "grok-4.5",
    });
    expect(pin!.claudeModel).toBeUndefined();
    expect(pin!.codexModel).toBeUndefined();
  });

  it("미지 입력은 undefined — 호출자가 기존 스코어링으로 폴백한다", () => {
    expect(resolveModelPin("전혀아닌것", CLI_OK)).toBeUndefined();
  });
});

describe("오케 셀렉터 compound 값", () => {
  it("프로바이더만이면 기존 값과 바이트 동일(하위호환)", () => {
    expect(orchestratorModelValue("claude")).toBe("claude");
    expect(orchestratorModelValue("codex")).toBe("codex");
  });

  it("모델 핀이 붙으면 provider:modelId", () => {
    expect(orchestratorModelValue("claude", "claude-fable-5")).toBe(
      "claude:claude-fable-5",
    );
  });

  it("기존 저장값(접미 없음)은 그대로 하네스로 읽힌다", () => {
    expect(splitOrchestratorModelValue("claude")).toEqual({
      harness: "claude",
    });
    expect(splitOrchestratorModelValue("codex")).toEqual({
      harness: "codex",
    });
  });

  it("compound 는 하네스와 모델로 쪼개진다", () => {
    expect(splitOrchestratorModelValue("claude:claude-opus-4-8")).toEqual({
      harness: "claude",
      modelId: "claude-opus-4-8",
    });
  });

  it("★미지 모델 접미는 버리되 하네스는 살린다(spawn 안 깨짐)", () => {
    expect(splitOrchestratorModelValue("claude:claude-nonexistent-9")).toEqual({
      harness: "claude",
    });
  });

  it("Claude 변형 목록은 레지스트리 파생이고 최상위가 먼저 온다", () => {
    const choices = claudeOrchestratorChoices();
    const ids = choices.map((c) => c.modelId);
    expect(ids).toContain("claude-fable-5");
    expect(ids).toContain("claude-opus-5");
    expect(ids).toContain("claude-sonnet-5");
    // ★opus-4.8 / haiku-4.5 는 2026-08-20 에 오케 선택에서 내려갔다
    // (`ORCHESTRATOR_SELECTOR_RETIRED` — 효과집계 299건 중 실사용 0건).
    // 레지스트리 행은 살아 있고 퀵레인·명시 지정으로는 그대로 닿는다.
    expect(ids).not.toContain("claude-opus-4-8");
    expect(ids).not.toContain("claude-haiku-4-5-20251001");
    // frontier(fable5)가 맨 앞.
    expect(ids[0]).toBe("claude-fable-5");
    // 레지스트리의 active claude **네이티브 벤더** 행 수와 일치 — 목록을 따로
    // 만들지 않았다는 증거. ★env-swap 벤더 행(GLM 등)은 셀렉터에서 제외된다
    // (사유는 model-selection 의 `selectorEligible` 주석: 영구 저장되는 기본값에
    // 조건부 크레덴셜을 얹지 않는다). 그 행들은 dispatch 명시 지정으로 닿는다.
    expect(choices).toHaveLength(
      MODEL_REGISTRY.filter(
        (m) =>
          m.harness === "claude" &&
          m.status === "active" &&
          m.provider === "anthropic" &&
          !(m.id in ORCHESTRATOR_SELECTOR_RETIRED),
      ).length,
    );
    expect(choices.every((c) => c.vendor === "anthropic")).toBe(true);
  });

  // ── Codex 변형(이 티켓) ──────────────────────────────────────────────
  it("★Codex 변형 목록도 레지스트리 파생이고 최상위가 먼저 온다", () => {
    const choices = codexOrchestratorChoices();
    const ids = choices.map((c) => c.modelId);
    // ★완료기준: sol/terra/luna + 5.5. 이름은 레지스트리 실명 그대로다
    // ("gpt-5.6-solar" 같은 표기는 존재하지 않는다).
    expect(ids).toContain("gpt-5.6-sol");
    expect(ids).toContain("gpt-5.6-terra");
    expect(ids).toContain("gpt-5.6-luna");
    expect(ids).toContain("gpt-5.5");
    // ★5.4 계열은 2026-08-20 에 오케 선택에서 내려갔다(실사용 0건).
    expect(ids).not.toContain("gpt-5.4");
    expect(ids).not.toContain("gpt-5.4-mini");
    expect(ids[0]).toBe("gpt-5.6-sol"); // frontier 가 맨 앞
    expect(choices).toHaveLength(
      MODEL_REGISTRY.filter(
        (m) =>
          m.harness === "gpt" &&
          m.provider === "openai" &&
          m.status === "active" &&
          !(m.id in ORCHESTRATOR_SELECTOR_RETIRED),
      ).length,
    );
    // 값·라벨 포맷은 Claude 와 같은 규칙(프로바이더 프리픽스 + 레지스트리 id).
    expect(choices[0].value).toBe("codex:gpt-5.6-sol");
    expect(choices[0].label).toBe("Codex (gpt-5.6-sol)");
  });

  it("★Grok 변형 목록도 같은 파생 경로다(신형이 맨 앞)", () => {
    const choices = grokOrchestratorChoices();
    expect(choices.map((c) => c.modelId)).toEqual(["grok-4.6", "grok-4.5"]);
    expect(choices[0].value).toBe("grok:grok-4.6");
    expect(choices[0].label).toBe("Grok (grok-4.6)");
    expect(choices.every((c) => c.vendor === "xai")).toBe(true);
    // effort 축은 없다 — `buildCLICommand` 의 grok 분기가 그 플래그를 안 붙인다.
    expect(choices.every((c) => c.efforts.length === 0)).toBe(true);
  });

  // ── 오케 선택에서 내린 칸(2026-08-20, 티켓 6AsbulPe) ────────────────────
  describe("ORCHESTRATOR_SELECTOR_RETIRED — 숨기기와 지우기는 다르다", () => {
    it("내린 모델은 셀렉터에 안 서지만 레지스트리엔 그대로 살아 있다", () => {
      const selectorIds = new Set([
        ...claudeOrchestratorChoices().map((c) => c.modelId),
        ...codexOrchestratorChoices().map((c) => c.modelId),
        ...grokOrchestratorChoices().map((c) => c.modelId),
      ]);
      for (const id of Object.keys(ORCHESTRATOR_SELECTOR_RETIRED)) {
        expect(selectorIds.has(id), `${id} 가 아직 셀렉터에 있다`).toBe(false);
        // ★이 줄이 "드롭다운에서 내린다 ≠ 레지스트리에서 지운다" 를 못박는다.
        // 지워버리면 그 모델로 돌았던 과거 티켓의 단가가 미매칭이 되고
        // 집계 해석이 깨진다(효과집계 리포트의 모델미상 154건이 그 위험이다).
        expect(getModel(id), `${id} 가 레지스트리에서 사라졌다`).toBeDefined();
        expect(getModel(id)!.status).toBe("active");
      }
    });

    it("내린 모델의 옛 저장값은 하네스 기본으로 강등된다(화면 = argv)", () => {
      // 셀렉터만 막고 정규화를 안 막으면 UI 는 "Claude (CLI default)" 를 표시하는데
      // 메인은 `--model claude-opus-4-8` 로 뜨는 갈림이 생긴다.
      expect(
        normalizeOrchestratorModelSetting("claude:claude-opus-4-8")
      ).toBe("claude");
      expect(
        normalizeOrchestratorModelSetting(
          "claude:claude-haiku-4-5-20251001"
        )
      ).toBe("claude");
      expect(normalizeOrchestratorModelSetting("codex:gpt-5.4")).toBe("codex");
      expect(normalizeOrchestratorModelSetting("codex:gpt-5.4-mini@high")).toBe(
        "codex"
      );
    });

    it("★사유 없는 퇴출은 없다 — 표의 모든 값이 실질 문자열이다", () => {
      // LADDER_EXCLUSIONS 와 같은 규율. 이유 없이 사라진 칸은 다음 사람이
      // 복원해야 할지 판단할 수 없다.
      for (const [id, why] of Object.entries(ORCHESTRATOR_SELECTOR_RETIRED)) {
        expect(why.trim().length, id).toBeGreaterThan(20);
      }
    });

    it("내린 모델도 명시 핀 경로(dispatch_task)로는 그대로 닿는다", () => {
      // 오케 선택은 프로젝트별 영구 저장이라 수명이 무한이고, 명시 지정은 티켓
      // 1건 수명이다. 수명이 다르니 대우도 다르다 — 이 경로는 안 막는다.
      const pin = resolveModelPin("claude-opus-4-8");
      expect(pin?.claudeModel).toBe("claude-opus-4-8");
      expect(resolveModelPin("gpt-5.4-mini")?.codexModel).toBe("gpt-5.4-mini");
    });
  });

  it("★셀렉터 effort 는 승인게이트 칸(max/ultra)을 뺀 것이다 — #602", () => {
    for (const choice of codexOrchestratorChoices()) {
      expect(choice.efforts, choice.value).not.toContain("max");
      expect(choice.efforts, choice.value).not.toContain("ultra");
      // 무게이트 칸은 그대로 남는다(축이 통째로 사라지면 안 된다).
      expect(choice.efforts, choice.value).toContain("high");
      expect(choice.efforts, choice.value).toContain("xhigh");
    }
    // sol 은 레지스트리상 max/ultra 를 지원한다 — 즉 위 단언은 "원래 없어서"가
    // 아니라 "게이트로 뺐기 때문"이다.
    expect(getModel("gpt-5.6-sol")!.efforts).toContain("ultra");
    expect(selectableEfforts(getModel("gpt-5.6-sol")!)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("claude 칸엔 effort 축이 없다(둘째 드롭다운을 그리지 않는 근거)", () => {
    for (const choice of claudeOrchestratorChoices()) {
      expect(choice.efforts, choice.value).toEqual([]);
    }
  });

  it("effort 는 모델 핀 위에만 얹힌다", () => {
    expect(orchestratorModelValue("codex", "gpt-5.6-terra", "high")).toBe(
      "codex:gpt-5.6-terra@high",
    );
    expect(orchestratorModelValue("codex", "gpt-5.6-terra")).toBe(
      "codex:gpt-5.6-terra",
    );
    // 모델 없이 effort 만 → 프로바이더만(어느 모델의 effort 인지 검증 불가).
    expect(orchestratorModelValue("codex", undefined, "high")).toBe("codex");
  });

  it("model@effort compound 가 세 조각으로 쪼개진다", () => {
    expect(splitOrchestratorModelValue("codex:gpt-5.6-terra@high")).toEqual({
      harness: "codex",
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
  });

  it("★승인게이트 effort(max/ultra)는 저장값·env 로 들어와도 떨궈진다 — #602", () => {
    // 이 경로가 열려 있으면 한 번 고른 ultra 가 재시작마다 승인 없이 되살아난다.
    expect(splitOrchestratorModelValue("codex:gpt-5.6-sol@ultra")).toEqual({
      harness: "codex",
      modelId: "gpt-5.6-sol",
    });
    expect(splitOrchestratorModelValue("codex:gpt-5.6-sol@max")).toEqual({
      harness: "codex",
      modelId: "gpt-5.6-sol",
    });
  });

  it("이 모델이 지원하지 않는 effort 도 떨구되 모델 핀은 살린다", () => {
    // luna 는 ultra 자체가 없다(레지스트리 §1.2). 모델 선택은 살아남아야 한다.
    expect(splitOrchestratorModelValue("codex:gpt-5.6-luna@ultra")).toEqual({
      harness: "codex",
      modelId: "gpt-5.6-luna",
    });
    expect(splitOrchestratorModelValue("codex:gpt-5.5@쓰레기")).toEqual({
      harness: "codex",
      modelId: "gpt-5.5",
    });
  });

  it("★codex 변형 선택이 그대로 CLI 두 축의 핀으로 해석된다(launch 전달값)", () => {
    const { modelId, effort } = splitOrchestratorModelValue(
      "codex:gpt-5.6-terra@xhigh",
    );
    const pin = resolveModelPin(`${modelId}@${effort}`, CLI_OK);
    expect(pin!.harness).toBe("gpt");
    expect(pin!.codexModel).toBe("gpt-5.6-terra");
    expect(pin!.codexEffort).toBe("xhigh");
    expect(pin!.label).toBe("gpt-5.6-terra@xhigh");
    // claude 축은 건드리지 않는다.
    expect(pin!.claudeModel).toBeUndefined();
  });

  it("라벨은 id 에서 기계적으로 만든다", () => {
    expect(humanizeClaudeModelId("claude-opus-4-8")).toBe("Opus 4.8");
    expect(humanizeClaudeModelId("claude-fable-5")).toBe("Fable 5");
    expect(humanizeClaudeModelId("claude-haiku-4-5-20251001")).toBe(
      "Haiku 4.5",
    );
  });
});

describe("§P1 벤더 숏핸드 해석 (minimax / glm / kimi / solar)", () => {
  it('resolveModelPin("minimax") === MiniMax-M3 (최신 flagship, M2.7 아님)', () => {
    const pin = resolveModelPin("minimax", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "minimax",
      claudeModel: "MiniMax-M3",
      label: "MiniMax-M3",
    });
    expect(pin?.claudeModel).not.toBe("MiniMax-M2.7");
  });

  it("MiniMax(대소문자 혼합) → MiniMax-M3", () => {
    const pin = resolveModelPin("MiniMax", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "minimax",
      claudeModel: "MiniMax-M3",
    });
  });

  it("MINIMAX(대문자) → MiniMax-M3", () => {
    const pin = resolveModelPin("MINIMAX", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "minimax",
      claudeModel: "MiniMax-M3",
    });
  });

  it("glm → glm-5.2 (GLM flagship)", () => {
    const pin = resolveModelPin("glm", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "zai",
      claudeModel: "glm-5.2",
      label: "glm-5.2",
    });
  });

  it("zai → glm-5.2 (GLM brand name)", () => {
    const pin = resolveModelPin("zai", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "zai",
      claudeModel: "glm-5.2",
    });
  });

  it("kimi → k3 (Kimi flagship)", () => {
    const pin = resolveModelPin("kimi", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "moonshot",
      claudeModel: "k3",
      label: "k3",
    });
  });

  it("moonshot → k3 (Kimi brand name)", () => {
    const pin = resolveModelPin("moonshot", CLI_OK);
    expect(pin).toMatchObject({
      harness: "claude",
      vendor: "moonshot",
      claudeModel: "k3",
    });
  });

  it("solar / upstage → solar-pro4 (OpenAI 호환 env-swap)", () => {
    for (const input of ["solar", "upstage", "solar-pro"]) {
      const pin = resolveModelPin(input, CLI_OK);
      expect(pin).toMatchObject({
        harness: "gpt",
        vendor: "upstage",
        codexModel: "solar-pro4",
        label: "solar-pro4",
      });
    }
  });

  it("★회귀: 벤더 숏핸드는 loose index 에 없다 (숏핸드 전용 경로)", () => {
    expect(findModelLoose("minimax")).toBeUndefined();
    expect(findModelLoose("glm")).toBeUndefined();
    expect(findModelLoose("kimi")).toBeUndefined();
    expect(findModelLoose("zai")).toBeUndefined();
    expect(findModelLoose("moonshot")).toBeUndefined();
    expect(findModelLoose("solar")).toBeUndefined();
    expect(findModelLoose("upstage")).toBeUndefined();
  });

  it("★회귀: normalizeModel 은 벤더 숏핸드를 삼키지 않는다 (harness 축 유지)", () => {
    // MODEL_ALIASES 에 없어 undefined — 벤더를 harness 로 접으면 축 분리 붕괴
    expect(normalizeModel("minimax")).toBeUndefined();
    expect(normalizeModel("glm")).toBeUndefined();
    expect(normalizeModel("kimi")).toBeUndefined();
    expect(normalizeModel("solar")).toBeUndefined();
    // 고치기 전: resolveModelPin("minimax") 도 undefined → antigravity/gpt 폴백
    // 고친 후: resolveVendorShorthand → MiniMax-M3 핀 성공
    expect(resolveModelPin("minimax", CLI_OK)?.claudeModel).toBe("MiniMax-M3");
  });

  it("parseModelSpec 로 직접 벤더 숏핸드 파싱", () => {
    const spec = parseModelSpec("minimax");
    expect(spec).toMatchObject({
      harness: "claude",
      vendor: "minimax",
      modelId: "MiniMax-M3",
    });
  });

  it("★회귀: 구체 id 는 숏핸드와 무관하게 그대로 핀된다", () => {
    // 구체 id 는 findModelLoose 가 먼저 잡음 — M2.7 / M3 둘 다 보존
    expect(resolveVendorShorthand("MiniMax-M2.7")).toBeUndefined();
    expect(resolveVendorShorthand("MiniMax-M3")).toBeUndefined();
    expect(resolveVendorShorthand("glm-5.2")).toBeUndefined();
    expect(resolveVendorShorthand("solar-pro4")).toBeUndefined();
    expect(parseModelSpec("MiniMax-M2.7")?.modelId).toBe("MiniMax-M2.7");
    expect(parseModelSpec("MiniMax-M3")?.modelId).toBe("MiniMax-M3");
    expect(parseModelSpec("minimax-m3")?.modelId).toBe("MiniMax-M3");
    expect(parseModelSpec("minimax-m2.7")?.modelId).toBe("MiniMax-M2.7");
    expect(resolveModelPin("MiniMax-M2.7", CLI_OK)?.claudeModel).toBe(
      "MiniMax-M2.7",
    );
    expect(resolveModelPin("glm-5.2", CLI_OK)?.claudeModel).toBe("glm-5.2");
    expect(resolveModelPin("k3", CLI_OK)?.claudeModel).toBe("k3");
    expect(resolveModelPin("solar-pro4", CLI_OK)?.codexModel).toBe(
      "solar-pro4",
    );
  });

  it("resolveVendorShorthand 직접: 벤더 → flagship 행", () => {
    expect(resolveVendorShorthand("minimax")?.id).toBe("MiniMax-M3");
    expect(resolveVendorShorthand("glm")?.id).toBe("glm-5.2");
    expect(resolveVendorShorthand("zai")?.id).toBe("glm-5.2");
    expect(resolveVendorShorthand("kimi")?.id).toBe("k3");
    expect(resolveVendorShorthand("moonshot")?.id).toBe("k3");
    expect(resolveVendorShorthand("solar")?.id).toBe("solar-pro4");
    expect(resolveVendorShorthand("upstage")?.id).toBe("solar-pro4");
  });

  it("존재하지 않는 벤더는 undefined", () => {
    expect(resolveModelPin("nonexistent", CLI_OK)).toBeUndefined();
    expect(resolveVendorShorthand("nonexistent")).toBeUndefined();
  });

  it("looseIndexCollisions 는 벤더 숏핸드와 충돌하지 않는다", () => {
    const collisions = looseIndexCollisions();
    expect(collisions).toEqual([]);
  });
});
