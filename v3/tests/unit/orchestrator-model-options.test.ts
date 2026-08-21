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
  grokOrchestratorChoices,
  normalizeOrchestratorModelSetting,
  ORCHESTRATOR_SELECTOR_RETIRED,
} from "../../electron/model-selection";
import { getModel } from "../../electron/model-registry";

describe("오케 모델 셀렉터 ↔ 레지스트리", () => {
  const options = ORCHESTRATOR_MODEL_OPTIONS as ReadonlyArray<{
    value: string;
    label: string;
    efforts: readonly string[];
  }>;
  const claudeVariants = options.filter((o) => o.value.startsWith("claude:"));
  const codexVariants = options.filter((o) => o.value.startsWith("codex:"));
  const grokVariants = options.filter((o) => o.value.startsWith("grok:"));

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
        option.value
      ).toBe(option.value);
    }
  });

  it("★antigravity 는 모델 접미 칸을 세우지 않는다 — 핀 축이 없다", () => {
    // 핀을 세워봐야 `normalizeOrchestratorModelSetting` 이 접미를 버려서 저장값엔
    // 남고 CLI 엔 안 붙는다. 그 상태를 UI 에서 애초에 만들지 않는다.
    expect(options.filter((o) => o.value.startsWith("antigravity:"))).toEqual(
      []
    );
  });

  it("★Grok 변형 목록이 레지스트리 파생 목록과 정확히 일치한다", () => {
    // grok 은 2026-08-20 에 접미 칸이 열렸다(티켓 6AsbulPe). 열 수 있었던 근거는
    // 배선이다: `orchestratorLaunchPin` 의 grok 분기(`nativeModel`)와 main.ts 오케
    // launch 의 `nativeModelOverride` 가 이미 살아 있었고, 막고 있던 것은
    // `normalizeOrchestratorModelSetting` 의 낡은 가드 하나였다. claude/codex 와
    // 같은 파생 대조를 받는다 — 미러가 벌어지면 여기서 깨진다.
    const expected = grokOrchestratorChoices().map((c) => ({
      value: c.value,
      label: c.label,
      efforts: c.efforts,
    }));
    expect(grokVariants).toEqual(expected);
    // 실측 근거: `grok models`(CLI 1.0.5) → grok-4.6(default) / grok-4.5.
    expect(grokVariants.map((o) => o.value)).toEqual([
      "grok:grok-4.6",
      "grok:grok-4.5",
    ]);
  });

  it("★grok 칸은 effort 둘째 드롭다운을 세우지 않는다 — argv 에 안 붙는다", () => {
    // docs.x.ai 는 grok-4.6 을 "Reasoning: Configurable" 로 적고 `grok --help` 에도
    // `--reasoning-effort` 가 있지만, `agent-config.buildCLICommand` 의 grok 분기가
    // 그 플래그를 argv 에 붙이지 않는다. 안 붙는 축을 셀렉터에 세우면 "골랐는데 안
    // 먹는" 칸이 된다 — grok 오케가 이미 겪은 실패모드(#638/#639)와 같은 모양.
    for (const o of grokVariants) expect(o.efforts, o.value).toEqual([]);
    expect(isOrchestratorModel("grok:grok-4.6@high")).toBe(false);
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
        Array.from({ length: idx.length }, (_, k) => idx[0] + k)
      );
      // 그룹의 머리는 접미 없는 기본칸 — 종전 위치 감각 유지.
      expect(options[idx[0]].value, harness).toBe(harness);
    }
  });

  it("완료기준: Opus5·Fable5·Sonnet5 를 고를 수 있다", () => {
    const values = options.map((o) => o.value);
    for (const id of ["claude-opus-5", "claude-fable-5", "claude-sonnet-5"]) {
      expect(values, id).toContain(`claude:${id}`);
    }
  });

  it("★오케 선택에서 내린 칸은 안 서고, 레지스트리엔 그대로 있다", () => {
    // 2026-08-20(티켓 6AsbulPe): `get_routing_effectiveness` 전체 스캔 491건 중
    // model@effort 해상도가 붙은 299건 기준으로 아래 넷은 **실사용 0건**이었다.
    // 그래서 오케 선택 경로에서만 내렸다 — 레지스트리 행은 그대로라 퀵레인·
    // dispatch_task 명시 지정·과거 티켓 단가 계산이 전부 무회귀다.
    // (종전 이 테스트는 opus-4.8 이 **있어야** 한다고 주장했다. 그 완료기준은
    //  "레지스트리 파생이 리터럴 표를 대체했나" 를 보던 것이고, 지금은 그 파생에
    //  퇴출 필터가 한 겹 얹혔다 — 아래 파생 대조 테스트가 그것까지 본다.)
    const values = options.map((o) => o.value);
    for (const id of Object.keys(ORCHESTRATOR_SELECTOR_RETIRED)) {
      expect(values, id).not.toContain(`claude:${id}`);
      expect(values, id).not.toContain(`codex:${id}`);
      // 레지스트리에는 살아 있다("숨김"이지 "삭제"가 아니다).
      expect(getModel(id), id).toBeDefined();
    }
    expect(Object.keys(ORCHESTRATOR_SELECTOR_RETIRED).sort()).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-opus-4-8",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
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
    // ★게이트 칸을 뺀 **나머지는 모델마다 다르다**. 종전엔 codex 칸이 전부
    // openai 행이라 네 칸으로 같았지만, DeepSeek 이 편입된 뒤로는 그 등식이
    // 사실이 아니다 — DeepSeek 공식 models.json 은 low/high/max 만 정의하고
    // medium 이 아예 없어서 셀렉터 칸이 low/high 다(누락이 아니라 벤더 사실).
    // 그래서 단언을 "게이트 칸이 없다 + 축이 살아 있다" 로 좁힌다. 목록 자체의
    // 정확성은 위 파생 대조 테스트가 이미 본다.
    for (const o of codexVariants) {
      expect(o.efforts, o.value).not.toContain("max");
      expect(o.efforts, o.value).not.toContain("ultra");
      expect(o.efforts.length, o.value).toBeGreaterThan(0);
    }
    for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.6-luna"]) {
      expect(
        options.find((o) => o.value === `codex:${id}`)?.efforts,
        id
      ).toEqual(["low", "medium", "high", "xhigh"]);
    }
    expect(isOrchestratorModel("codex:deepseek-v4-flash@max")).toBe(false);
    expect(isOrchestratorModel("codex:deepseek-v4-flash@medium")).toBe(false);
    expect(isOrchestratorModel("codex:deepseek-v4-flash@high")).toBe(true);
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
      "codex:gpt-5.5@high"
    );
    // 모델을 바꿀 때 effort 이월 — 새 모델이 지원하면 유지된다.
    expect(withOrchestratorEffort("codex:gpt-5.6-luna@high", "high")).toBe(
      "codex:gpt-5.6-luna@high"
    );
    // "CLI 기본"(빈 값) 선택 → 모델 축만.
    expect(withOrchestratorEffort("codex:gpt-5.5@high", "")).toBe(
      "codex:gpt-5.5"
    );
    // effort 축이 없는 모델로 갈아타면 effort 는 조용히 떨어진다.
    expect(withOrchestratorEffort("claude:claude-opus-5", "high")).toBe(
      "claude:claude-opus-5"
    );
    // 게이트 칸은 UI 에서도 만들어지지 않는다.
    expect(withOrchestratorEffort("codex:gpt-5.6-sol", "ultra")).toBe(
      "codex:gpt-5.6-sol"
    );
  });

  it("모든 선택지의 프로바이더가 아는 값이다", () => {
    for (const o of options) {
      expect([...ORCHESTRATOR_HARNESS_SETTINGS], o.value).toContain(
        orchestratorModelProvider(o.value)
      );
    }
  });

  it("★env-swap 벤더(GLM/MiniMax/Kimi/Solar)는 여전히 셀렉터에 없다 — 확정 결정", () => {
    // 오케 선택은 프로젝트별 영구 저장이라, 조건부 크레덴셜에 의존하는 벤더가
    // 칸으로 서면 키가 빠진 순간부터 매 재시작이 말없이 네이티브 백엔드로 샌다
    // (`model-selection.orchestratorSelectorEligible` 주석의 확정 결정).
    //
    // ★2026-08-21(7HthjBEf) 회귀 락: 그날 열린 것은 **DeepSeek 하나뿐**이다.
    // 이 넷은 잔액/소진을 런타임에 관측할 방법이 없어서(그 벤더들엔
    // `vendor-balance.BALANCE_PROBES` 항목이 없다) 예외의 전제를 못 만족한다.
    // 값·라벨 두 축을 다 본다 — 라벨이 벤더 표기로 바뀌었으므로 라벨로 새는
    // 경로가 새로 생겼다.
    const values = options.map((o) => o.value.toLowerCase());
    const labels = options.map((o) => o.label.toLowerCase());
    for (const vendorish of [
      "glm",
      "minimax",
      "kimi",
      "zai",
      "moonshot",
      "solar",
      "upstage",
    ]) {
      for (const v of values) expect(v, v).not.toContain(vendorish);
      for (const l of labels) expect(l, l).not.toContain(vendorish);
    }
  });

  it("★DeepSeek 만 열렸고, 벤더 표기 라벨을 달고 선다 — 7HthjBEf", () => {
    // 완료기준: 잔액이 있으면 드롭다운에 선다. 여기서는 **칸이 존재하는가**만
    // 본다(잔액 판정은 main 이 얹으므로 이 목록은 순수하게 남는다 —
    // `orchestrator-vendor-gate.test.ts` 가 그 판정을 따로 검증한다).
    const values = options.map((o) => o.value);
    expect(values).toContain("codex:deepseek-v4-flash");
    expect(values).toContain("codex:deepseek-v4-pro");
    // ★라벨의 머리가 "Codex" 면 사용자는 자기 OpenAI 구독으로 도는 줄 안다.
    // 확정 결정 주석이 필터를 걷을 때 **같이** 요구한 것이 이 벤더 표기다.
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      const option = options.find((o) => o.value === `codex:${id}`)!;
      expect(option.label).toBe(`DeepSeek (${id})`);
    }
    // 값 프리픽스는 여전히 하네스 축이다(어느 바이너리로 뜨나) — 여기가 갈리면
    // `orchestratorLaunchPin` 이 핀을 통째로 버려서 조용히 CLI 기본으로 뜬다.
    expect(orchestratorModelProvider("codex:deepseek-v4-flash")).toBe("codex");
  });

  it("★저장·env 로 들어온 DeepSeek 값이 정규화에서 살아남는다(두 문이 같은 술어)", () => {
    // 셀렉터만 열고 정규화를 안 열면 화면은 "Codex (CLI default)" 인데 argv 엔
    // 아무 핀도 안 붙는 상태가 된다 — `ORCHESTRATOR_SELECTOR_RETIRED` 주석이
    // 경고하는 그 어긋남의 거울상이다.
    expect(normalizeOrchestratorModelSetting("codex:deepseek-v4-flash")).toBe(
      "codex:deepseek-v4-flash"
    );
    expect(
      normalizeOrchestratorModelSetting("codex:deepseek-v4-pro@high")
    ).toBe("codex:deepseek-v4-pro@high");
    // 반대로 프로브 없는 env-swap 벤더 핀은 종전대로 접미가 잘려 강등된다.
    expect(normalizeOrchestratorModelSetting("codex:solar-pro4")).toBe("codex");
  });

  it("★새 하네스도 isOrchestratorModel 을 통과한다(셀렉터 값 = 유효값)", () => {
    expect(isOrchestratorModel("grok")).toBe(true);
    expect(isOrchestratorModel("antigravity")).toBe(true);
    // grok 은 모델 핀 축이 열렸다(위 파생 대조 테스트 참조).
    expect(isOrchestratorModel("grok:grok-4.6")).toBe(true);
    expect(isOrchestratorModel("grok:grok-4.5")).toBe(true);
    // 그래도 effort 축은 없다 — 접미 effort 는 여전히 인정하지 않는다.
    expect(isOrchestratorModel("grok@high")).toBe(false);
    // antigravity 는 레지스트리 행 자체가 없어 어떤 접미도 인정되지 않는다.
    expect(isOrchestratorModel("antigravity:agy-1")).toBe(false);
  });

  it("★맨몸 칸 4개가 전부 자기가 무엇으로 뜨는지 라벨에 적는다", () => {
    // 사장님 지적("맨 위 그냥 Claude 는 아래 Claude (Opus 5) 들과 뭐가 다른지
    // 모르겠다")의 회귀 가드. 제거가 아니라 **명확화**로 푼 이유는
    // `ORCHESTRATOR_HARNESS_OPTIONS` 주석에 있다(하네스 축·기본 우선순위·저장값
    // 연속성이 전부 이 칸에 걸려 있다). 네 칸 모두 같은 규칙을 받는다 —
    // 하나만 고치면 나머지 셋이 똑같이 모호한 채로 남는다.
    for (const o of ORCHESTRATOR_HARNESS_OPTIONS) {
      expect(o.label, o.value).toContain("(CLI default)");
    }
    // 구체 모델명을 적지 않는 것도 규칙이다 — claude/codex CLI 의 기본 모델은
    // 우리가 측정하지 않는 이동표적이라, 적는 순간 다음 주에 거짓말이 된다.
    expect(
      ORCHESTRATOR_HARNESS_OPTIONS.map((o) => o.label)
    ).toEqual([
      "Claude (CLI default)",
      "Codex (CLI default)",
      "Grok (CLI default)",
      "Antigravity (CLI default)",
    ]);
  });
});
