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
  ORCHESTRATOR_MODEL_OPTIONS,
  isOrchestratorModel,
  orchestratorEffortsFor,
  orchestratorModelBase,
  orchestratorModelEffort,
  orchestratorModelProvider,
  withOrchestratorEffort,
} from "../../src/stores/orchestratorStore";
import {
  claudeOrchestratorChoices,
  codexOrchestratorChoices,
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

  it("기본값 'claude' 가 목록의 첫 칸(=드롭다운 기본 표시)이다", () => {
    expect(options[0].value).toBe("claude");
  });

  it("Codex 그룹은 Claude 그룹 뒤에 통째로 온다(두 벤더가 섞이지 않는다)", () => {
    const firstCodex = options.findIndex(
      (o) => orchestratorModelProvider(o.value) === "codex",
    );
    const lastClaude = options.reduce(
      (acc, o, i) =>
        orchestratorModelProvider(o.value) === "claude" ? i : acc,
      -1,
    );
    expect(firstCodex).toBeGreaterThan(lastClaude);
    // 프로바이더 기본칸("codex")이 그 그룹의 머리다 — 종전 위치 감각 유지.
    expect(options[firstCodex].value).toBe("codex");
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
      expect(["claude", "codex"], o.value).toContain(
        orchestratorModelProvider(o.value),
      );
    }
  });
});
