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
  orchestratorModelProvider,
} from "../../src/stores/orchestratorStore";
import { claudeOrchestratorChoices } from "../../electron/model-selection";

describe("오케 모델 셀렉터 ↔ 레지스트리", () => {
  const options = ORCHESTRATOR_MODEL_OPTIONS as ReadonlyArray<{
    value: string;
    label: string;
  }>;
  const claudeVariants = options.filter((o) => o.value.startsWith("claude:"));

  it("★Claude 변형 목록이 레지스트리 파생 목록과 정확히 일치한다", () => {
    const expected = claudeOrchestratorChoices().map((c) => ({
      value: c.value,
      label: c.label,
    }));
    expect(claudeVariants).toEqual(expected);
  });

  it("프로바이더 기본 선택지(접미 없는 값)가 그대로 남아 있다 — 하위호환", () => {
    // 앱상태/env 에 저장된 기존 값이 이 두 개다. 사라지면 재시작 연속성이 깨진다.
    expect(options.map((o) => o.value)).toContain("claude");
    expect(options.map((o) => o.value)).toContain("codex");
  });

  it("기본값 'claude' 가 목록의 첫 칸(=드롭다운 기본 표시)이다", () => {
    expect(options[0].value).toBe("claude");
  });

  it("Codex 선택지는 목록 끝에 있어 Claude 변형과 섞이지 않는다", () => {
    expect(options[options.length - 1].value).toBe("codex");
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

  it("값이 중복되지 않는다(<option> key 충돌 방지)", () => {
    const values = options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("isOrchestratorModel 이 새 compound 값을 인정하고 쓰레기는 거른다", () => {
    expect(isOrchestratorModel("claude")).toBe(true);
    expect(isOrchestratorModel("claude:claude-fable-5")).toBe(true);
    expect(isOrchestratorModel("claude:claude-nonexistent")).toBe(false);
    expect(isOrchestratorModel("")).toBe(false);
    expect(isOrchestratorModel(undefined)).toBe(false);
  });

  it("orchestratorModelProvider 가 프로바이더만 떼어낸다", () => {
    expect(orchestratorModelProvider("claude")).toBe("claude");
    expect(orchestratorModelProvider("claude:claude-opus-5")).toBe("claude");
    expect(orchestratorModelProvider("codex")).toBe("codex");
  });

  it("모든 선택지의 프로바이더가 아는 값이다", () => {
    for (const o of options) {
      expect(["claude", "codex"], o.value).toContain(
        orchestratorModelProvider(o.value),
      );
    }
  });
});
