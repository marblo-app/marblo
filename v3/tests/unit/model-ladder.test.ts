// P3-1 난도→모델 에스컬레이션 사다리 — 데이터 자체의 규율을 못박는다.
//
// 이 파일이 지키는 것 4가지:
//   1. **날조 방지** — 사다리의 모든 칸이 레지스트리(CLI-verified)에 있는 구체
//      id 이고, 그 모델이 실제로 지원하는 effort 다.
//   2. **★순서 근거가 실단가** — "gpt=저가" 같은 감각이 아니라 등록된 단가로
//      순서가 설명된다. 특히 top 칸이 gpt-5.5 가 아니라 terra 인 이유.
//   3. **완결성** — 레지스트리에 행을 넣고 사다리를 잊으면(=라우팅이 절대 고르지
//      않는 유령 모델) 테스트가 깨진다.
//   4. **승인 게이트** — max/ultra 는 승인 레코드 없이 통과하지 못하고, 통과
//      실패는 "차단" 이 아니라 "강등" 이다.
import { describe, it, expect } from "vitest";
import {
  MODEL_LADDERS,
  LADDER_EXCLUSIONS,
  LADDER_TIERS,
  APPROVAL_GATED_EFFORTS,
  MAX_GATED_APPROVALS_PER_TASK,
  approvalBudgetSpent,
  blendedCostIndex,
  capabilityRank,
  cheapestByCapability,
  consumeApproval,
  costIndexForModel,
  entryRung,
  formatLadder,
  gateRung,
  highestUngatedRungAtOrBelow,
  ladderFor,
  nextRung,
  parseRung,
  readEscalationApprovals,
  rungIndex,
  rungLabel,
  rungNeedsApproval,
  usableApproval,
  type EscalationApprovalRecord,
  type LadderRung,
} from "../../electron/model-ladder";
import {
  MODEL_REGISTRY,
  getModel,
  isModelAlias,
  isKnownModelId,
} from "../../electron/model-registry";
import {
  effortFromDispatchArgs,
  stripEffortSuffix,
  usableApprovalLoose,
} from "../../electron/mcp-server/escalation-approval";

/** 사다리는 **하네스** 축으로 묶인다(축분리 USbdRV4k). */
const LADDER_HARNESSES = ["claude", "gpt", "grok"] as const;

describe("사다리 데이터 규율", () => {
  it("모든 칸이 레지스트리의 구체 id 다(alias·미등록 id 금지)", () => {
    for (const harness of LADDER_HARNESSES) {
      for (const rung of ladderFor(harness)!.rungs) {
        expect(isKnownModelId(rung.model)).toBe(true);
        expect(isModelAlias(rung.model)).toBe(false);
        expect(getModel(rung.model)!.harness).toBe(harness);
        expect(getModel(rung.model)!.status).toBe("active");
      }
    }
  });

  it("모든 칸의 effort 가 그 모델이 실제 지원하는 값이다", () => {
    for (const harness of LADDER_HARNESSES) {
      for (const rung of ladderFor(harness)!.rungs) {
        const supported = getModel(rung.model)!.efforts;
        if (supported.length === 0) {
          // claude 계열 — effort 축이 없다.
          expect(rung.effort).toBeUndefined();
        } else {
          expect(supported).toContain(rung.effort);
        }
      }
    }
  });

  it("모든 칸에 존재 근거(why)가 적혀 있다", () => {
    for (const harness of LADDER_HARNESSES) {
      for (const rung of ladderFor(harness)!.rungs) {
        expect(rung.why.length).toBeGreaterThan(10);
      }
    }
  });

  it("칸 순서가 능력등급 비내림차순이다(상향 축 = 능력)", () => {
    for (const harness of LADDER_HARNESSES) {
      const ranks = ladderFor(harness)!.rungs.map(
        (r) => capabilityRank(r.model)!,
      );
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
      }
    }
  });

  it("같은 모델 안에서는 effort 가 낮은 칸부터 온다", () => {
    for (const harness of LADDER_HARNESSES) {
      const rungs = ladderFor(harness)!.rungs;
      for (let i = 1; i < rungs.length; i++) {
        if (rungs[i].model !== rungs[i - 1].model) continue;
        const efforts = getModel(rungs[i].model)!.efforts;
        expect(efforts.indexOf(rungs[i].effort!)).toBeGreaterThan(
          efforts.indexOf(rungs[i - 1].effort!),
        );
      }
    }
  });

  it("티어 진입 칸은 승인 게이트가 아니다(기본 동작이 승인 대기일 수 없다)", () => {
    for (const harness of LADDER_HARNESSES) {
      for (const tier of LADDER_TIERS) {
        expect(rungNeedsApproval(entryRung(harness, tier)!)).toBe(false);
      }
    }
  });

  it("진입 칸이 simple ≤ standard ≤ complex 순이다", () => {
    for (const harness of LADDER_HARNESSES) {
      const ladder = ladderFor(harness)!;
      const { entry } = ladder;
      expect(entry.simple).toBeLessThanOrEqual(entry.standard);
      expect(entry.standard).toBeLessThanOrEqual(entry.complex);
      // ★칸이 여럿인 사다리에서만 **엄격** 증가를 요구한다. grok 처럼 CLI-verified
      // 행이 하나뿐인 하네스는 세 티어가 같은 칸을 가리키는 것이 사실이다 — 거기서
      // 엄격 증가를 강요하면 없는 모델을 지어내야 한다(레지스트리 상단 규율).
      if (ladder.rungs.length > 1) {
        expect(entry.simple).toBeLessThan(entry.complex);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★순서의 근거가 실단가라는 것 — 티켓 완료기준 "gpt=저가 가정 없음"
// ─────────────────────────────────────────────────────────────────────────
describe("★실단가 기반 순서 (PR 근거)", () => {
  it("단가 지표는 등록된 실단가에서만 나온다", () => {
    // sonnet5 $3/$15 → 9, gpt-5.5 $5/$30 → 17.5.
    expect(costIndexForModel("claude-sonnet-5")).toBe(9);
    expect(costIndexForModel("gpt-5.5")).toBe(17.5);
    expect(blendedCostIndex({ inputPer1M: 2.5, outputPer1M: 15 })).toBe(8.75);
  });

  it("★'쉬운 건 gpt 가 싸다' 는 거짓 — simple 티어에서 sonnet5 가 gpt-5.5 의 절반이다", () => {
    // 사내 전제가 깨지는 지점(PR#596). 오늘 codex 에 실제로 서빙되는 모델은
    // ProviderLadder.inheritedModel = gpt-5.5 다.
    const gptLive = ladderFor("gpt")!.inheritedModel!;
    expect(gptLive).toBe("gpt-5.5");
    expect(costIndexForModel(gptLive)!).toBeCloseTo(
      costIndexForModel("claude-sonnet-5")! * 1.944,
      2,
    );
    expect(costIndexForModel(gptLive)!).toBeGreaterThan(
      costIndexForModel("claude-sonnet-5")!,
    );
  });

  it("★gpt top 칸이 gpt-5.5 가 아니라 terra 인 이유가 단가로 재현된다", () => {
    // 규칙: 같은 능력등급에서 실단가가 싼 모델이 그 칸을 차지한다.
    const tops = cheapestByCapability("gpt", "top").map((m) => m.id);
    expect(tops[0]).toBe("gpt-5.6-terra");
    expect(tops).toContain("gpt-5.5");
    expect(costIndexForModel("gpt-5.6-terra")!).toBeLessThan(
      costIndexForModel("gpt-5.5")!,
    );
    // 사다리의 standard 진입 칸이 실제로 그 모델이다.
    expect(entryRung("gpt", "standard")!.model).toBe("gpt-5.6-terra");
  });

  it("claude 진입칸은 sonnet5/opus5/fable5 그대로다 — env-swap 은 더 싸도 진입칸을 대체하지 않는다(점수가 결정, hyKsSYYM)", () => {
    // ★hyKsSYYM(사장님 A안) 이전엔 "실단가 최저" 가 진입칸과 같았다 — GLM/MiniMax/
    // Kimi 가 LADDER_EXCLUSIONS 에 있어 후보 자체가 아니었기 때문이다. 이제는
    // 편입돼 있고(제외 목록에 없음) 실단가도 더 싸다 — 그런데도 진입칸은 그대로
    // sonnet5/opus5/fable5 다. "강제 배치 말고 점수가 결정" 이라 진입칸 자체를
    // 옮기지 않고, env-swap 칸은 사다리에서 더 **낮은 인덱스**(가벼운 down 감점)에
    // 앉아 있다가 단가 우위로 런타임 점수 경쟁에서 이겨야 한다
    // (model-autoselect.test.ts 의 "★env-swap 자동선택 편입" 참고).
    const cheapestMid = cheapestByCapability("claude", "mid")[0];
    expect(cheapestMid.id).not.toBe("claude-sonnet-5");
    expect(cheapestMid.id in LADDER_EXCLUSIONS).toBe(false);
    const cheapestTop = cheapestByCapability("claude", "top")[0];
    expect(cheapestTop.id).not.toBe("claude-opus-5");
    expect(cheapestTop.id in LADDER_EXCLUSIONS).toBe(false);

    expect(entryRung("claude", "simple")!.model).toBe("claude-sonnet-5");
    expect(entryRung("claude", "standard")!.model).toBe("claude-opus-5");
    expect(entryRung("claude", "complex")!.model).toBe("claude-fable-5");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★gpt-5.6 3변종이 작업별로 변주된다 — 사장님 결정 항목
// ─────────────────────────────────────────────────────────────────────────
describe("★gpt-5.6 3변종 변주", () => {
  it("sol/terra/luna 세 변종이 모두 사다리에 있다", () => {
    const models = new Set(ladderFor("gpt")!.rungs.map((r) => r.model));
    expect(models.has("gpt-5.6-luna")).toBe(true);
    expect(models.has("gpt-5.6-terra")).toBe(true);
    expect(models.has("gpt-5.6-sol")).toBe(true);
  });

  it("난도별로 다른 변종이 진입한다: simple=luna, standard=terra, complex=sol", () => {
    expect(entryRung("gpt", "simple")!.model).toBe("gpt-5.6-luna");
    expect(entryRung("gpt", "standard")!.model).toBe("gpt-5.6-terra");
    expect(entryRung("gpt", "complex")!.model).toBe("gpt-5.6-sol");
  });

  it("luna 는 ultra 칸을 갖지 않는다(레지스트리 비대칭 반영)", () => {
    expect(getModel("gpt-5.6-luna")!.efforts).not.toContain("ultra");
    const lunaRungs = ladderFor("gpt")!.rungs.filter(
      (r) => r.model === "gpt-5.6-luna",
    );
    expect(lunaRungs.every((r) => r.effort !== "ultra")).toBe(true);
  });

  it("5.6 계열만 max/ultra 상단 2칸을 갖는다(사다리 최상단 = sol@ultra)", () => {
    const rungs = ladderFor("gpt")!.rungs;
    expect(rungLabel(rungs[rungs.length - 1])).toBe("gpt-5.6-sol@ultra");
    // 5.5 계열(classic)엔 max/ultra 가 아예 없다 — 그래서 사다리 상단도 5.6 뿐이다.
    expect(getModel("gpt-5.5")!.efforts).not.toContain("max");
  });
});

describe("완결성 — 레지스트리 행이 사다리에서 유령이 되지 않는다", () => {
  // ★하네스로 거르지 않는다. 종전엔 `entry.harness` 가 claude/gpt 가 아니면
  // `continue` 해서, **사다리가 없는 하네스의 행은 이 가드 자체를 통과할 수 없었다**
  // — grok-4.5 가 사다리에도 LADDER_EXCLUSIONS 에도 없이 살아 있었는데(=자동선택이
  // 절대 못 고르는 행) 완결성 테스트는 초록이었다. 필터를 걷으면 그런 행이 침묵할
  // 자리가 없어진다: 사다리를 만들거나, 이유를 적거나 둘 중 하나다.
  it("모든 활성 모델은 사다리에 있거나 제외 이유가 적혀 있다(하네스 불문)", () => {
    const inLadder = new Set(
      LADDER_HARNESSES.flatMap((p) => ladderFor(p)!.rungs.map((r) => r.model)),
    );
    for (const entry of MODEL_REGISTRY) {
      if (entry.status !== "active") continue;
      const covered = inLadder.has(entry.id) || entry.id in LADDER_EXCLUSIONS;
      expect(
        covered,
        `${entry.id}(harness=${entry.harness}) 가 사다리에도 LADDER_EXCLUSIONS 에도 없다 — 라우팅이 절대 고를 수 없는 유령 모델이 된다.`,
      ).toBe(true);
    }
  });

  it("제외 이유는 빈 문자열이 아니다(사유 없는 제외 금지)", () => {
    for (const [id, why] of Object.entries(LADDER_EXCLUSIONS)) {
      expect(isKnownModelId(id)).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it("gemini/antigravity/local 은 사다리를 만들지 않는다(CLI-verified 사실 부재)", () => {
    expect(ladderFor("gemini")).toBeUndefined();
    expect(ladderFor("antigravity")).toBeUndefined();
    expect(ladderFor("local")).toBeUndefined();
  });
});

describe("상향 이동 (nextRung)", () => {
  it("티어 경계를 넘어 계속 올라간다: simple 진입에서 3칸 = standard 진입", () => {
    let rung = entryRung("gpt", "simple")!;
    for (let i = 0; i < 3; i++) rung = nextRung("gpt", rung)!;
    expect(rungLabel(rung)).toBe(rungLabel(entryRung("gpt", "standard")!));
  });

  it("천장에서는 undefined(무한 상향 금지)", () => {
    const rungs = ladderFor("gpt")!.rungs;
    expect(nextRung("gpt", rungs[rungs.length - 1])).toBeUndefined();
  });

  it("사다리 밖 칸은 -1 / undefined 로 정직하게 답한다", () => {
    const alien: LadderRung = {
      model: "claude-opus-4-8",
      harness: "claude",
      why: "x",
    };
    expect(rungIndex("claude", alien)).toBe(-1);
    expect(nextRung("claude", alien)).toBeUndefined();
  });

  it("claude 상향: 진입칸에서 한 칸씩 올라가면 사다리 끝(fable5)에서 천장을 만난다", () => {
    // ★hyKsSYYM 이전엔 사다리에 3칸뿐이라 sonnet5→opus5→fable5 가 곧 "한 칸씩"
    // 이었다. 지금은 env-swap 칸이 sonnet5/opus5 뒤(더 높은 인덱스)에도 끼어
    // 있어(top 등급 4칸이 opus5 앞에 있다) `nextRung` 한 번은 다음 **인덱스**로
    // 갈 뿐 다음 **진입칸**으로 가지 않는다 — 그 계약은 안 바뀌었다(model-ladder.ts
    // nextRung 주석). 여기서는 "끝까지 오르면 fable5 에서 멈춘다" 만 확인한다.
    let rung = entryRung("claude", "simple")!;
    const path = [rung.model];
    for (let i = 0; i < 20; i++) {
      const next = nextRung("claude", rung);
      if (!next) break;
      rung = next;
      path.push(rung.model);
    }
    expect(rung.model).toBe("claude-fable-5");
    expect(nextRung("claude", rung)).toBeUndefined();
    expect(path[0]).toBe("claude-sonnet-5");
    expect(path).toContain("claude-opus-5");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★승인 게이트 — 티켓 완료기준 "max/ultra 는 승인 없이 자동으로 안 뜬다"
// ─────────────────────────────────────────────────────────────────────────
describe("★max/ultra 승인 게이트", () => {
  const solMax: LadderRung = ladderFor("gpt")!.rungs.find(
    (r) => rungLabel(r) === "gpt-5.6-sol@max",
  )!;
  const solUltra: LadderRung = ladderFor("gpt")!.rungs.find(
    (r) => rungLabel(r) === "gpt-5.6-sol@ultra",
  )!;

  const approvalFor = (
    rung: LadderRung,
    over: Partial<EscalationApprovalRecord> = {},
  ): EscalationApprovalRecord => ({
    questionId: "task-1#qabc",
    model: rung.model,
    effort: rung.effort!,
    decision: "approved",
    requestedBy: "agent-1",
    requestedAt: 1,
    decidedBy: "orchestrator-p",
    decidedFor: "사장님",
    decidedAt: 2,
    ...over,
  });

  it("게이트 대상은 max/ultra 뿐이다(xhigh 는 통과)", () => {
    expect([...APPROVAL_GATED_EFFORTS]).toEqual(["max", "ultra"]);
    const xhigh = ladderFor("gpt")!.rungs.find((r) => r.effort === "xhigh")!;
    expect(rungNeedsApproval(xhigh)).toBe(false);
    expect(rungNeedsApproval(solMax)).toBe(true);
    expect(rungNeedsApproval(solUltra)).toBe(true);
  });

  it("승인 없으면 통과하지 않고, 바로 아래 무게이트 칸으로 강등된다", () => {
    const out = gateRung(solMax, []);
    expect(out.allowed).toBe(false);
    if (out.allowed) throw new Error("unreachable");
    expect(out.reason).toBe("needs-approval");
    expect(rungLabel(out.rung!)).toBe("gpt-5.6-sol@xhigh");
    expect(out.message).toContain("강등");
  });

  it("승인 레코드가 있으면 그 칸으로 통과한다", () => {
    const out = gateRung(solMax, [approvalFor(solMax)]);
    expect(out.allowed).toBe(true);
    if (!out.allowed) throw new Error("unreachable");
    expect(rungLabel(out.rung)).toBe("gpt-5.6-sol@max");
    expect(out.approval?.decidedFor).toBe("사장님");
  });

  it("★승인은 정확히 같은 칸에만 쓰인다(max 승인이 ultra 를 열지 않는다)", () => {
    const out = gateRung(solUltra, [approvalFor(solMax)]);
    expect(out.allowed).toBe(false);
  });

  it("★소진된 승인은 재사용되지 않는다(1회용)", () => {
    const granted = [approvalFor(solMax)];
    expect(gateRung(solMax, granted).allowed).toBe(true);
    const spent = consumeApproval(granted, "task-1#qabc", 99);
    expect(spent[0].consumedAt).toBe(99);
    expect(usableApproval(spent, solMax)).toBeUndefined();
    expect(gateRung(solMax, spent).allowed).toBe(false);
  });

  it("거부 기록이 있으면 사유가 approval-denied 다", () => {
    const out = gateRung(solMax, [approvalFor(solMax, { decision: "denied" })]);
    expect(out.allowed).toBe(false);
    if (out.allowed) throw new Error("unreachable");
    expect(out.reason).toBe("approval-denied");
  });

  it("예산 소진(티켓당 1건) 뒤의 다른 칸 요청은 budget-exhausted 다", () => {
    const spent = [approvalFor(solMax, { consumedAt: 5 })];
    expect(approvalBudgetSpent(spent)).toBe(MAX_GATED_APPROVALS_PER_TASK);
    const out = gateRung(solUltra, spent);
    expect(out.allowed).toBe(false);
    if (out.allowed) throw new Error("unreachable");
    expect(out.reason).toBe("budget-exhausted");
  });

  it("거부는 예산을 태우지 않는다(사장님이 '안 됨' 이라 답해도 재요청 가능)", () => {
    expect(
      approvalBudgetSpent([approvalFor(solMax, { decision: "denied" })]),
    ).toBe(0);
  });

  it("무게이트 칸은 승인 레코드 없이 그냥 통과한다", () => {
    const out = gateRung(entryRung("gpt", "complex")!, []);
    expect(out.allowed).toBe(true);
  });

  it("highestUngatedRungAtOrBelow: 최상단에서 내려오면 sol@xhigh", () => {
    expect(rungLabel(highestUngatedRungAtOrBelow(solUltra)!)).toBe(
      "gpt-5.6-sol@xhigh",
    );
  });

  it("readEscalationApprovals: 쓰레기 값은 조용히 버리고 유효행만 남긴다", () => {
    const restored = readEscalationApprovals([
      null,
      { questionId: "q1" }, // model 없음
      { questionId: "q2", model: "gpt-5.6-sol", effort: "nonsense" },
      {
        questionId: "q3",
        model: "gpt-5.6-sol",
        effort: "max",
        decision: "approved",
        requestedBy: "a",
        requestedAt: 1,
      },
    ]);
    expect(restored).toHaveLength(1);
    expect(restored[0].questionId).toBe("q3");
    // 모르는 decision 은 pending 으로 떨어진다(승인으로 오인 금지).
    const unknown = readEscalationApprovals([
      {
        questionId: "q4",
        model: "gpt-5.6-sol",
        effort: "max",
        decision: "yes",
      },
    ]);
    expect(unknown[0].decision).toBe("pending");
  });
});

describe("parseRung — 동적 칸 지정 검증", () => {
  it("model@effort 를 칸으로 만든다", () => {
    const out = parseRung("gpt-5.6-terra@high");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(rungLabel(out.rung)).toBe("gpt-5.6-terra@high");
  });

  it("effort 축 없는 모델은 effort 없이 받는다", () => {
    const out = parseRung("claude-opus-5");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.rung.effort).toBeUndefined();
  });

  it("미등록 모델·미지원 effort·effort 누락을 각각 다른 이유로 거절한다", () => {
    expect(parseRung("gpt-9-mega@ultra")).toMatchObject({ ok: false });
    expect(parseRung("gpt-5.6-luna@ultra")).toMatchObject({ ok: false });
    expect(parseRung("gpt-5.5")).toMatchObject({ ok: false });
    expect(parseRung("gpt-5.6-sol@bogus")).toMatchObject({ ok: false });
    expect(parseRung("  ")).toMatchObject({ ok: false });
  });

  it("alias 는 구체 id 로 정규화된다", () => {
    const out = parseRung("opus");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.rung.model).toBe("claude-opus-5");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// dispatch 인자 해석 — 게이트가 두 표기를 모두 봐야 한다(PR#601 계약)
// ─────────────────────────────────────────────────────────────────────────
describe("dispatch 인자에서 effort 추출", () => {
  it("model 의 '@effort' 가 effort 인자보다 우선한다(#601 계약)", () => {
    expect(effortFromDispatchArgs("gpt-5.6-sol@max", "low")).toBe("max");
    expect(effortFromDispatchArgs("gpt-5.6-sol", "MAX")).toBe("max");
    expect(effortFromDispatchArgs("gpt-5.6-sol", undefined)).toBeUndefined();
    expect(effortFromDispatchArgs(undefined, "ultra")).toBe("ultra");
  });

  it("suffix 를 떼어낸 모델만 남긴다", () => {
    expect(stripEffortSuffix("gpt-5.6-sol@ultra")).toBe("gpt-5.6-sol");
    expect(stripEffortSuffix("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(stripEffortSuffix(undefined)).toBeUndefined();
  });

  it("느슨한 표기도 승인과 매칭된다 — 단, 해석 불가면 막는 쪽으로 떨어진다", () => {
    const approved = [
      {
        questionId: "q1",
        model: "gpt-5.6-sol",
        effort: "max",
        decision: "approved" as const,
        requestedBy: "a",
        requestedAt: 1,
      },
    ];
    expect(usableApprovalLoose(approved, "GPT 5.6 SOL", "max")).toBeTruthy();
    expect(
      usableApprovalLoose(approved, "gpt-5.6-sol@max", "max"),
    ).toBeTruthy();
    // 다른 모델·다른 effort·별칭(해석 불가)은 통과하지 않는다.
    expect(
      usableApprovalLoose(approved, "gpt-5.6-terra", "max"),
    ).toBeUndefined();
    expect(
      usableApprovalLoose(approved, "gpt-5.6-sol", "ultra"),
    ).toBeUndefined();
    expect(usableApprovalLoose(approved, "sol", "max")).toBeUndefined();
    expect(usableApprovalLoose(approved, undefined, "max")).toBeUndefined();
  });
});

describe("formatLadder — 사람이 읽는 표", () => {
  it("진입 티어·승인필요·단가지표를 함께 보여준다", () => {
    const out = formatLadder("gpt");
    expect(out).toContain("gpt-5.6-luna@low");
    expect(out).toContain("← simple 진입");
    expect(out).toContain("★승인필요");
    expect(out).toContain("모델 핀: 예(--model/-c model)");
    // 기존 학습 폴백 모델도 표기한다.
    expect(out).toContain("gpt-5.5");
  });

  it("사다리 없는 프로바이더도 정직하게 답한다", () => {
    expect(formatLadder("gemini")).toContain("사다리 없음");
  });
});
