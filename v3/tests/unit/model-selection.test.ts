/**
 * `model@effort` 파서 + 핀 해석 회귀 가드.
 *
 * 이 티켓이 고치는 결함의 테스트판: `dispatch_task(model="fable")` 이
 * `normalizeModel()` 에서 undefined 가 되어 **조용히 사라지던** 경로를 여기서
 * 못박는다. 그리고 §8.3 불변식 — 지정 모델이 미검증 CLI 여도 spawn 은 성공하고
 * opus 로 폴백한다 — 을 버전 주입으로 결정적으로 검증한다.
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
  selectableEfforts,
  humanizeClaudeModelId,
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
      expect(spec!.provider, input).toBe(provider);
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
  ];
  it.each(cases)("%s → %s", (input, expected) => {
    expect(parseModelSpec(input)?.modelId).toBe(expected);
  });

  it("구체 모델의 프로바이더는 레지스트리에서 파생된다", () => {
    expect(parseModelSpec("opus5")!.provider).toBe("claude");
    expect(parseModelSpec("gpt-5.6-terra")!.provider).toBe("gpt");
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
      provider: "gpt",
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
      provider: "claude",
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
      provider: "gpt",
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
    expect(pin).toMatchObject({ provider: "gpt", label: "gpt" });
    expect(pin!.codexModel).toBeUndefined();
    expect(pin!.claudeModel).toBeUndefined();
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

  it("기존 저장값(접미 없음)은 그대로 프로바이더로 읽힌다", () => {
    expect(splitOrchestratorModelValue("claude")).toEqual({
      provider: "claude",
    });
    expect(splitOrchestratorModelValue("codex")).toEqual({ provider: "codex" });
  });

  it("compound 는 프로바이더와 모델로 쪼개진다", () => {
    expect(splitOrchestratorModelValue("claude:claude-opus-4-8")).toEqual({
      provider: "claude",
      modelId: "claude-opus-4-8",
    });
  });

  it("★미지 모델 접미는 버리되 프로바이더는 살린다(spawn 안 깨짐)", () => {
    expect(splitOrchestratorModelValue("claude:claude-nonexistent-9")).toEqual({
      provider: "claude",
    });
  });

  it("Claude 변형 목록은 레지스트리 파생이고 최상위가 먼저 온다", () => {
    const choices = claudeOrchestratorChoices();
    const ids = choices.map((c) => c.modelId);
    expect(ids).toContain("claude-fable-5");
    expect(ids).toContain("claude-opus-5");
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("claude-sonnet-5");
    // frontier(fable5)가 맨 앞.
    expect(ids[0]).toBe("claude-fable-5");
    // 레지스트리의 active claude 모델 수와 일치 — 목록을 따로 만들지 않았다는 증거.
    expect(choices).toHaveLength(
      MODEL_REGISTRY.filter(
        (m) => m.provider === "claude" && m.status === "active",
      ).length,
    );
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
    expect(ids[0]).toBe("gpt-5.6-sol"); // frontier 가 맨 앞
    expect(choices).toHaveLength(
      MODEL_REGISTRY.filter(
        (m) => m.provider === "gpt" && m.status === "active",
      ).length,
    );
    // 값·라벨 포맷은 Claude 와 같은 규칙(프로바이더 프리픽스 + 레지스트리 id).
    expect(choices[0].value).toBe("codex:gpt-5.6-sol");
    expect(choices[0].label).toBe("Codex (gpt-5.6-sol)");
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
      provider: "codex",
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
  });

  it("★승인게이트 effort(max/ultra)는 저장값·env 로 들어와도 떨궈진다 — #602", () => {
    // 이 경로가 열려 있으면 한 번 고른 ultra 가 재시작마다 승인 없이 되살아난다.
    expect(splitOrchestratorModelValue("codex:gpt-5.6-sol@ultra")).toEqual({
      provider: "codex",
      modelId: "gpt-5.6-sol",
    });
    expect(splitOrchestratorModelValue("codex:gpt-5.6-sol@max")).toEqual({
      provider: "codex",
      modelId: "gpt-5.6-sol",
    });
  });

  it("이 모델이 지원하지 않는 effort 도 떨구되 모델 핀은 살린다", () => {
    // luna 는 ultra 자체가 없다(레지스트리 §1.2). 모델 선택은 살아남아야 한다.
    expect(splitOrchestratorModelValue("codex:gpt-5.6-luna@ultra")).toEqual({
      provider: "codex",
      modelId: "gpt-5.6-luna",
    });
    expect(splitOrchestratorModelValue("codex:gpt-5.5@쓰레기")).toEqual({
      provider: "codex",
      modelId: "gpt-5.5",
    });
  });

  it("★codex 변형 선택이 그대로 CLI 두 축의 핀으로 해석된다(launch 전달값)", () => {
    const { modelId, effort } = splitOrchestratorModelValue(
      "codex:gpt-5.6-terra@xhigh",
    );
    const pin = resolveModelPin(`${modelId}@${effort}`, CLI_OK);
    expect(pin!.provider).toBe("gpt");
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
