/**
 * 오케 모델 셀렉터 ↔ 모델 레지스트리 **단일소스 게이트**.
 *
 * 셀렉터 목록은 `src/stores/orchestratorStore.ts` 에 리터럴로 있고, 모델 사실은
 * `electron/model-registry.ts` 에 있다. 둘을 import 로 묶지 않는 이유는 이 repo 가
 * `src/` ↔ `electron/` 사이에 cross-import 를 두지 않기 때문이다(경계 규약,
 * `src/lib/rootPathScope.ts` 참조). 그래서 미러로 두되 **어긋나면 여기서 깨지게**
 * 한다 — 테스트는 두 경계를 다 import 할 수 있다.
 *
 * 이 파일이 깨졌다면 고칠 곳은 이 테스트가 아니라 셀렉터 배열이다(또는 레지스트리).
 */
import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_HARNESS_DESC,
  ORCHESTRATOR_HARNESS_OPTIONS,
  ORCHESTRATOR_MODEL_OPTIONS,
  isOrchestratorModel,
  orchestratorEffortsFor,
  orchestratorModelBase,
  orchestratorModelEffort,
  orchestratorModelProvider,
  withOrchestratorEffort,
} from "../../src/stores/orchestratorStore";
import {
  ORCHESTRATOR_HARNESS_SETTINGS,
  claudeOrchestratorChoices,
  codexOrchestratorChoices,
  normalizeOrchestratorModelSetting,
} from "../../electron/model-selection";

describe("오케 모델 셀렉터 ↔ 레지스트리", () => {
  const options = ORCHESTRATOR_MODEL_OPTIONS as ReadonlyArray<{
    value: string;
    label: string;
    efforts: readonly string[];
  }>;
  const claudeVariants = options.filter((o) => o.value.startsWith("claude:"));
  const codexVariants = options.filter((o) => o.value.startsWith("codex:"));

  it("★Claude 변형 목록이 레지스트리 파생 목록과 정확히 일치한다", () => {
    const expected = claudeOrchestratorChoices().map((c) => ({
      value: c.value,
      label: c.label,
      efforts: c.efforts,
    }));
    expect(claudeVariants).toEqual(expected);
  });

  it("★Codex 변형 목록이 레지스트리 파생 목록과 정확히 일치한다(effort 포함)", () => {
    const expected = codexOrchestratorChoices().map((c) => ({
      value: c.value,
      label: c.label,
      efforts: c.efforts,
    }));
    expect(codexVariants).toEqual(expected);
  });

  it("프로바이더 기본 선택지(접미 없는 값)가 그대로 남아 있다 — 하위호환", () => {
    // 앱상태/env 에 저장된 기존 값이 이 두 개다. 사라지면 재시작 연속성이 깨진다.
    expect(options.map((o) => o.value)).toContain("claude");
    expect(options.map((o) => o.value)).toContain("codex");
  });

  it("★하네스 칸이 ORCHESTRATOR_HARNESS_SETTINGS 와 원소·순서까지 같다", () => {
    // 이 티켓의 본체. 셀렉터가 세우는 "모델 접미 없는 칸" 집합은 메인 프로세스가
    // 실제로 받아주는 하네스 목록 그 자체여야 한다.
    //   - 목록에 있는데 칸이 없으면 → env 로만 닿는 기능(grok 이 그랬다)
    //   - 칸이 있는데 목록에 없으면 → 저장 직전 claude 로 강등("골랐는데 안 먹는")
    expect(ORCHESTRATOR_HARNESS_OPTIONS.map((o) => o.value)).toEqual([
      ...ORCHESTRATOR_HARNESS_SETTINGS,
    ]);
  });

  it("★모든 하네스 칸이 정규화를 그대로 통과한다(강등되는 칸이 없다)", () => {
    // 위 테스트가 목록 동일성을 보고, 이 테스트는 그 값이 **저장 경로에서 살아
    // 남는지**를 실제 함수로 확인한다 — 셀렉터가 만들 수 있는 값은 전부 라이브
    // 경로에서 자기 자신으로 정규화돼야 한다.
    for (const option of options) {
      expect(
        normalizeOrchestratorModelSetting(option.value),
        option.value,
      ).toBe(option.value);
    }
  });

  it("★grok/antigravity 는 모델 접미 칸을 세우지 않는다 — 핀 축이 없다", () => {
    // 핀을 세워봐야 `normalizeOrchestratorModelSetting` 이 접미를 버려서 저장값엔
    // 남고 CLI 엔 안 붙는다. 그 상태를 UI 에서 애초에 만들지 않는다.
    for (const harness of ["grok", "antigravity"]) {
      expect(
        options.filter((o) => o.value.startsWith(`${harness}:`)),
        harness,
      ).toEqual([]);
    }
  });

  it("설명 표는 목록을 가로막지 않는다(칸 없는 설명이 없다)", () => {
    // 설명이 빠진 하네스는 라벨만 뜨면 된다(칸은 서 있다). 반대로 어느 칸에도
    // 안 붙는 설명은 죽은 문구다.
    const values = new Set(ORCHESTRATOR_HARNESS_OPTIONS.map((o) => o.value));
    for (const key of Object.keys(ORCHESTRATOR_HARNESS_DESC)) {
      expect(values.has(key), key).toBe(true);
    }
  });

  it("기본값 'claude' 가 목록의 첫 칸(=드롭다운 기본 표시)이다", () => {
    expect(options[0].value).toBe("claude");
  });

  it("하네스 그룹은 통째로 온다 — 섞이지 않고, 각 그룹의 머리는 기본칸이다", () => {
    // 종전엔 claude/codex 두 그룹만 확인했지만, 규칙 자체는 하네스 수와 무관하다.
    // 그룹 순서는 `ORCHESTRATOR_HARNESS_SETTINGS` 를 따른다(위 동일성 테스트).
    for (const harness of ORCHESTRATOR_HARNESS_SETTINGS) {
      const idx = options
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => orchestratorModelProvider(o.value) === harness)
        .map(({ i }) => i);
      expect(idx.length, harness).toBeGreaterThan(0);
      // 연속 구간이다(중간에 다른 하네스가 끼지 않는다).
      expect(idx, harness).toEqual(
        Array.from({ length: idx.length }, (_, k) => idx[0] + k),
      );
      // 그룹의 머리는 접미 없는 기본칸 — 종전 위치 감각 유지.
      expect(options[idx[0]].value, harness).toBe(harness);
    }
  });

  it("완료기준: Opus5·Fable5·Opus4.8·Sonnet5 를 고를 수 있다", () => {
    const values = options.map((o) => o.value);
    for (const id of [
      "claude-opus-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
    ]) {
      expect(values, id).toContain(`claude:${id}`);
    }
  });

  it("★완료기준: Codex 변형(gpt-5.6 sol/terra/luna + gpt-5.5)을 고를 수 있다", () => {
    const values = options.map((o) => o.value);
    for (const id of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ]) {
      expect(values, id).toContain(`codex:${id}`);
    }
  });

  it("★모델명 날조 금지 — 'solar' 같은 표기는 어디에도 없다", () => {
    // 사장님 표기는 "gpt-5.6-solar" 였지만 실제 id 는 gpt-5.6-sol 이다
    // (models_cache 권위). 값에도 라벨에도 그 오표기가 새면 안 된다.
    for (const o of options) {
      expect(o.value.toLowerCase(), o.value).not.toContain("solar");
      expect(o.label.toLowerCase(), o.label).not.toContain("solar");
    }
  });

  it("값이 중복되지 않는다(<option> key 충돌 방지)", () => {
    const values = options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("isOrchestratorModel 이 새 compound 값을 인정하고 쓰레기는 거른다", () => {
    expect(isOrchestratorModel("claude")).toBe(true);
    expect(isOrchestratorModel("claude:claude-fable-5")).toBe(true);
    expect(isOrchestratorModel("codex")).toBe(true);
    expect(isOrchestratorModel("codex:gpt-5.6-sol")).toBe(true);
    expect(isOrchestratorModel("codex:gpt-5.6-sol@high")).toBe(true);
    expect(isOrchestratorModel("claude:claude-nonexistent")).toBe(false);
    expect(isOrchestratorModel("codex:gpt-nonexistent")).toBe(false);
    expect(isOrchestratorModel("")).toBe(false);
    expect(isOrchestratorModel(undefined)).toBe(false);
  });

  it("★승인게이트 effort(max/ultra)는 셀렉터가 인정하지 않는다 — #602", () => {
    expect(isOrchestratorModel("codex:gpt-5.6-sol@ultra")).toBe(false);
    expect(isOrchestratorModel("codex:gpt-5.6-sol@max")).toBe(false);
    for (const o of codexVariants) {
      expect(o.efforts, o.value).toEqual(["low", "medium", "high", "xhigh"]);
    }
  });

  it("effort 축이 없는 칸은 effort 를 인정하지 않는다(claude)", () => {
    expect(isOrchestratorModel("claude:claude-opus-5@high")).toBe(false);
    expect(orchestratorEffortsFor("claude:claude-opus-5")).toEqual([]);
    expect(orchestratorEffortsFor("claude")).toEqual([]);
  });

  it("orchestratorModelProvider 가 프로바이더만 떼어낸다(effort 접미도 무시)", () => {
    expect(orchestratorModelProvider("claude")).toBe("claude");
    expect(orchestratorModelProvider("claude:claude-opus-5")).toBe("claude");
    expect(orchestratorModelProvider("codex")).toBe("codex");
    expect(orchestratorModelProvider("codex:gpt-5.6-terra@high")).toBe("codex");
  });

  it("base/effort 분해가 왕복한다", () => {
    expect(orchestratorModelBase("codex:gpt-5.5@xhigh")).toBe("codex:gpt-5.5");
    expect(orchestratorModelEffort("codex:gpt-5.5@xhigh")).toBe("xhigh");
    expect(orchestratorModelBase("codex")).toBe("codex");
    expect(orchestratorModelEffort("codex")).toBe("");
  });

  it("withOrchestratorEffort 는 무효 조합을 애초에 만들지 않는다", () => {
    expect(withOrchestratorEffort("codex:gpt-5.5", "high")).toBe(
      "codex:gpt-5.5@high",
    );
    // 모델을 바꿀 때 effort 이월 — 새 모델이 지원하면 유지된다.
    expect(withOrchestratorEffort("codex:gpt-5.6-luna@high", "high")).toBe(
      "codex:gpt-5.6-luna@high",
    );
    // "CLI 기본"(빈 값) 선택 → 모델 축만.
    expect(withOrchestratorEffort("codex:gpt-5.5@high", "")).toBe(
      "codex:gpt-5.5",
    );
    // effort 축이 없는 모델로 갈아타면 effort 는 조용히 떨어진다.
    expect(withOrchestratorEffort("claude:claude-opus-5", "high")).toBe(
      "claude:claude-opus-5",
    );
    // 게이트 칸은 UI 에서도 만들어지지 않는다.
    expect(withOrchestratorEffort("codex:gpt-5.6-sol", "ultra")).toBe(
      "codex:gpt-5.6-sol",
    );
  });

  it("모든 선택지의 프로바이더가 아는 값이다", () => {
    for (const o of options) {
      expect([...ORCHESTRATOR_HARNESS_SETTINGS], o.value).toContain(
        orchestratorModelProvider(o.value),
      );
    }
  });

  it("★env-swap 벤더(GLM/MiniMax/Kimi)는 셀렉터에 없다 — 확정 결정", () => {
    // 오케 선택은 프로젝트별 영구 저장이라, 조건부 크레덴셜에 의존하는 벤더가
    // 칸으로 서면 키가 빠진 순간부터 매 재시작이 말없이 네이티브 백엔드로 샌다
    // (`model-selection.selectorEligible` 주석의 확정 결정).
    const values = options.map((o) => o.value.toLowerCase());
    for (const vendorish of ["glm", "minimax", "kimi", "zai", "moonshot"]) {
      for (const v of values) expect(v, v).not.toContain(vendorish);
    }
  });

  it("★새 하네스도 isOrchestratorModel 을 통과한다(셀렉터 값 = 유효값)", () => {
    expect(isOrchestratorModel("grok")).toBe(true);
    expect(isOrchestratorModel("antigravity")).toBe(true);
    // 핀 축이 없으므로 접미/effort 는 인정하지 않는다.
    expect(isOrchestratorModel("grok:grok-4.5")).toBe(false);
    expect(isOrchestratorModel("grok@high")).toBe(false);
  });
});
