/**
 * 벤더 축 **커버리지 게이트** — "벤더를 추가할 때 사람이 세 군데를 기억해야 한다"
 * 는 상태를 끝내는 테스트.
 *
 * ── 왜 이 파일이 생겼나 (티켓 zGlnSwXk) ──────────────────────────────────
 * DeepSeek 은 `electron/model-registry.ts` 에 활성 모델 2행으로 정상 등록됐고
 * (`ModelFactSheet` 은 레지스트리 파생이라 이미 뜨고 있었다), 그런데 사용량 탭에서는
 * **색이 중립 회색**이고 **과금축이 "미상"** 이었다. 원인은 버그가 아니라 누락이다:
 *
 *   · `src/lib/usageBreakdown.ts` 의 `VENDOR_SLOT_ORDER` (색 슬롯 배정)
 *   · `src/lib/vendorBilling.ts` 의 `VENDOR_BILLING`   (과금축)
 *
 * 둘 다 손으로 관리하는 표이고, 둘 다 **없으면 폴백으로 조용히 떨어진다**. 조용히
 * 떨어지는 폴백은 화면을 깨뜨리지 않기 때문에 아무도 모른 채 배포된다 — 이 프로젝트가
 * Solar 때 배운 그 실패 모양이다.
 *
 * 그래서 규율을 사람 기억에서 테스트로 옮긴다: **레지스트리에 활성 행이 있는 벤더는
 * 두 표에 반드시 있어야 한다.** 다음에 벤더를 추가하는 사람은 세 군데를 기억할 필요
 * 없이, 여기가 빨간불이 되면 어디를 채워야 하는지 실패 메시지로 듣는다.
 */
import { describe, it, expect } from "vitest";
import { MODEL_REGISTRY, VENDOR_IDS } from "../../electron/model-registry";
import {
  VENDOR_SLOT_ORDER,
  VENDOR_COLOR_SLOT_COUNT,
  NEUTRAL_VENDOR_COLOR,
  vendorColor,
} from "../../src/lib/usageBreakdown";
import { VENDOR_BILLING, billingFor } from "../../src/lib/vendorBilling";

/**
 * 카테고리 색을 받지 **않아야** 하는 벤더. "벤더 미상" 은 브랜드가 아니라 빈칸이라
 * 중립 회색으로 떨어지는 것이 의도다(usageBreakdown 주석). 과금축 표에는 있어야
 * 한다 — 거기서 빠지면 폴백과 구분이 안 된다.
 */
const NEUTRAL_VENDORS = ["local", "custom"] as const;

/** 레지스트리에 **활성 모델 행**이 있는 벤더들 = 화면에 실제로 뜰 수 있는 벤더들. */
function vendorsWithActiveRows(): string[] {
  const seen = new Set<string>();
  for (const m of MODEL_REGISTRY) {
    if (m.status !== "active") continue;
    seen.add(m.provider);
  }
  return [...seen].sort();
}

describe("벤더 축 커버리지 — 활성 벤더는 두 표에 다 있어야 한다", () => {
  const active = vendorsWithActiveRows().filter(
    (v) => !NEUTRAL_VENDORS.includes(v as (typeof NEUTRAL_VENDORS)[number]),
  );

  it("표본이 비어 있지 않다(레지스트리를 못 읽으면 이 게이트가 무력해진다)", () => {
    expect(active.length).toBeGreaterThan(0);
  });

  it.each(active)(
    "%s 가 VENDOR_SLOT_ORDER 에 있다 — 없으면 사용량 탭에서 중립 회색으로 떨어진다",
    (vendor) => {
      expect(
        VENDOR_SLOT_ORDER as readonly string[],
        `${vendor} 를 src/lib/usageBreakdown.ts 의 VENDOR_SLOT_ORDER **맨 끝에** 추가하세요. ` +
          `중간에 끼우면 그 뒤 벤더들의 색이 전부 밀립니다.`,
      ).toContain(vendor);
      // 표에 이름만 있고 색이 모자라면 같은 증상이 난다 — 실제 색까지 확인한다.
      expect(vendorColor(vendor)).not.toBe(NEUTRAL_VENDOR_COLOR);
    },
  );

  it.each(active)(
    "%s 가 VENDOR_BILLING 에 있다 — 없으면 과금축이 '미상' 으로 떨어진다",
    (vendor) => {
      // ★여기서 축이 `unknown` **인지**는 보지 않는다. 표에 명시적으로
      // `{ axis: "unknown" }` 을 적은 것은 "확인했고 아직 모른다" 는 기록이고
      // (moonshot/upstage 가 그렇다), 표에서 아예 빠진 것은 "아무도 안 봤다" 다.
      // 화면엔 둘 다 "미상" 으로 보이지만 성격이 다르므로, 이 게이트가 잡아야 하는
      // 것은 **누락** 하나다.
      expect(
        Object.keys(VENDOR_BILLING),
        `${vendor} 를 src/lib/vendorBilling.ts 의 VENDOR_BILLING 에 추가하세요. ` +
          `축을 아직 확인 못 했으면 { axis: "unknown", quotaApi: null } 이 정직한 항목입니다.`,
      ).toContain(vendor);
    },
  );

  it("★색 슬롯이 배정 순서보다 짧지 않다(짧으면 뒤쪽 벤더가 undefined 색을 받는다)", () => {
    expect(VENDOR_COLOR_SLOT_COUNT).toBeGreaterThanOrEqual(
      VENDOR_SLOT_ORDER.length,
    );
  });

  it("모든 슬롯 벤더가 서로 다른 색을 받는다(중복 슬롯 방지)", () => {
    const colors = VENDOR_SLOT_ORDER.map((v) => vendorColor(v));
    expect(new Set(colors).size).toBe(VENDOR_SLOT_ORDER.length);
    expect(colors).not.toContain(NEUTRAL_VENDOR_COLOR);
  });

  it("슬롯 순서에 레지스트리에 없는 벤더가 섞여 있지 않다", () => {
    for (const vendor of VENDOR_SLOT_ORDER) {
      expect(VENDOR_IDS as readonly string[]).toContain(vendor);
    }
  });

  it("local/custom 은 카테고리 색을 받지 않는다(중립 회색이 의도다)", () => {
    for (const vendor of NEUTRAL_VENDORS) {
      expect(VENDOR_SLOT_ORDER as readonly string[]).not.toContain(vendor);
      expect(vendorColor(vendor)).toBe(NEUTRAL_VENDOR_COLOR);
      // 그래도 과금축 표에는 있어야 한다 — 폴백과 명시적 unknown 을 구분하기 위해.
      expect(Object.keys(VENDOR_BILLING)).toContain(vendor);
    }
  });
});

describe("이 티켓이 고친 그 구멍 — DeepSeek", () => {
  it("레지스트리에 활성 DeepSeek 행이 있다(전제)", () => {
    const rows = MODEL_REGISTRY.filter(
      (m) => m.provider === "deepseek" && m.status === "active",
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("색이 중립 회색이 아니다", () => {
    expect(vendorColor("deepseek")).not.toBe(NEUTRAL_VENDOR_COLOR);
  });

  it("과금축이 선불 충전이고, 유일하게 잔액 조회 API 가 배선돼 있다", () => {
    const fact = billingFor("deepseek");
    expect(fact.axis).toBe("prepaid");
    expect(fact.quotaApi).toBe("deepseek-user-balance");
  });

  it("★기존 벤더의 색이 한 칸도 밀리지 않았다(과거 화면과의 대조 보호)", () => {
    // 이 값들은 DeepSeek 편입 **이전**의 배정이다. 신규 벤더는 끝에만 붙으므로
    // 여기 8개는 영원히 그대로여야 한다.
    expect(vendorColor("anthropic")).toBe("#3987e5");
    expect(vendorColor("openai")).toBe("#d95926");
    expect(vendorColor("zai")).toBe("#199e70");
    expect(vendorColor("minimax")).toBe("#c98500");
    expect(vendorColor("xai")).toBe("#d55181");
    expect(vendorColor("google")).toBe("#008300");
    expect(vendorColor("moonshot")).toBe("#9085e9");
    expect(vendorColor("upstage")).toBe("#0e8f99");
  });
});
