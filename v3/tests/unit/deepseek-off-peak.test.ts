/**
 * DeepSeek off-peak 시간대 판정·표기 회귀 가드.
 *
 * ★이 파일의 실질은 **경계**다. "지금 off-peak" 배지가 한 시간이라도 어긋나면
 * 화면이 없는 할인을 약속하게 되고, 그건 아무 표기도 없는 것보다 나쁘다. 그래서
 * 네 경계(01:00 / 04:00 / 06:00 / 10:00)를 정각·직전·직후로 전부 못박는다.
 *
 * 출처: https://api-docs.deepseek.com/quick_start/pricing (2026-08-21 확인)
 *   peak 01:00-04:00, 06:00-10:00 UTC / 그 외 off-peak(단가 절반)
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { getModel } from "../../electron/model-registry";
import { usage as koUsage } from "../../src/locales/ko/usage";
import { usage as enUsage } from "../../src/locales/en/usage";
import {
  DEEPSEEK_OFF_PEAK_MULTIPLIER,
  DEEPSEEK_PEAK_WINDOWS_UTC,
  KST_OFFSET_MINUTES,
  deepseekPeakWindowsLabel,
  isDeepSeekPeak,
} from "../../src/lib/deepseekOffPeak";

/** `at("03:59")` → 그날 03:59 UTC. 날짜는 판정에 안 쓰이므로 아무 날이나 고정. */
function at(hhmm: string): Date {
  return new Date(`2026-08-21T${hhmm}:00.000Z`);
}

describe("DeepSeek off-peak", () => {
  it("★peak 구간 안은 peak 이다", () => {
    for (const t of ["01:00", "02:30", "03:59", "06:00", "08:00", "09:59"]) {
      expect(isDeepSeekPeak(at(t)), t).toBe(true);
    }
  });

  it("★구간 밖은 전부 off-peak 다 — 하루 17시간이 여기 속한다", () => {
    for (const t of [
      "00:00",
      "00:59",
      "04:00", // ★끝은 반열림이라 정각이 off-peak 다
      "05:00",
      "05:59",
      "10:00", // ★같은 규칙
      "12:00",
      "18:00",
      "23:59",
    ]) {
      expect(isDeepSeekPeak(at(t)), t).toBe(false);
    }
  });

  it("★판정은 기기 타임존과 무관하다 — 같은 순간은 어디서든 같은 답", () => {
    // 같은 절대시각을 서로 다른 오프셋 표기로 준다. getUTC* 만 쓰므로 전부 같아야
    // 한다 — 로컬시간으로 접었다면 여기서 갈라진다.
    const instant = "2026-08-21T02:30:00.000Z";
    expect(isDeepSeekPeak(new Date(instant))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-08-21T11:30:00+09:00"))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-08-20T22:30:00-04:00"))).toBe(true);
  });

  it("★UTC·KST 표기가 둘 다 나오고, KST 는 UTC 에서 파생된다", () => {
    expect(deepseekPeakWindowsLabel(0)).toBe("01:00-04:00, 06:00-10:00");
    // 티켓이 요구한 한국시간 환산값 그대로.
    expect(deepseekPeakWindowsLabel(KST_OFFSET_MINUTES)).toBe(
      "10:00-13:00, 15:00-19:00",
    );
    expect(KST_OFFSET_MINUTES).toBe(540);
  });

  it("★표시 단가는 여전히 **peak 정가**다 — off-peak 는 단가를 바꾸지 않는다", () => {
    // 과소보고 방지 정책의 회귀 락. off-peak 안내가 들어왔다고 표의 숫자를 절반
    // 으로 내리면, 하루 7시간 동안 화면이 실제보다 싸게 말하게 된다. 안내는
    // **보조 설명**이지 단가의 대체값이 아니다.
    expect(getModel("deepseek-v4-flash")!.pricing).toMatchObject({
      inputPer1M: 0.44,
      outputPer1M: 1.32,
    });
    expect(getModel("deepseek-v4-pro")!.pricing).toMatchObject({
      inputPer1M: 1.32,
      outputPer1M: 3.96,
    });
    // 그리고 off-peak 는 그 절반이라는 사실만 따로 들고 있다(화면 문구가 쓴다).
    expect(1.32 * DEEPSEEK_OFF_PEAK_MULTIPLIER).toBeCloseTo(0.66, 10);
    expect(3.96 * DEEPSEEK_OFF_PEAK_MULTIPLIER).toBeCloseTo(1.98, 10);
  });

  it("★안내 한 줄이 **DeepSeek 행이 보일 때만** 그려진다 — 다른 벤더로 안 샌다", () => {
    // 렌더 테스트 하네스가 없으므로 소스 계약으로 못박는다(이 레포의 기존
    // 패턴 — `onboarding-demo-script.test.ts` 와 같은 방식). 이 가드가 빠지면
    // 안내가 표 전체의 각주가 되어 "내 모델도 시간대 할인이 있나" 로 읽힌다.
    const src = readFileSync(
      new URL("../../src/components/usage/ModelFactSheet.tsx", import.meta.url),
      "utf8",
    );
    const guard = src.slice(
      src.indexOf("<DeepSeekOffPeakNote") - 400,
      src.indexOf("<DeepSeekOffPeakNote"),
    );
    expect(guard).toContain('vendor === "deepseek"');
    expect(guard).toContain("visibleGroups.some");
  });

  it("★ko 문구는 UTC·KST 를 둘 다 채우고 자리표시자를 남기지 않는다", () => {
    // 한국어 화면에서는 두 표기를 다 요구한다: UTC 를 지우면 벤더 고시와 대조가
    // 안 되고, UTC 만 적으면 볼 때마다 +9 를 암산해야 한다. 자리표시자 이름이
    // 어긋나 `{kst}` 가 화면에 그대로 뜨는 사고도 여기서 막는다
    // (`i18n.format` 은 안 채워진 자리를 조용히 남긴다).
    const utc = deepseekPeakWindowsLabel(0);
    const kst = deepseekPeakWindowsLabel(KST_OFFSET_MINUTES);
    const raw = koUsage["usage.factSheet.deepseekOffPeak"];
    expect(raw).toContain("{utc}");
    expect(raw).toContain("{kst}");
    const filled = raw.replace("{utc}", utc).replace("{kst}", kst);
    expect(filled).not.toMatch(/[{}]/);
    expect(filled).toContain("01:00-04:00, 06:00-10:00");
    expect(filled).toContain("10:00-13:00, 15:00-19:00");
    expect(filled).toMatch(/UTC/);
    expect(filled).toMatch(/KST/);
    // 딥시크 전용 문구라는 것이 문장 안에 있어야 한다 — 다른 벤더 행 밑에
    // 잘못 붙어도 최소한 대상이 누구인지는 화면이 말한다.
    expect(filled).toMatch(/DeepSeek/);
  });

  it("★en 문구는 **UTC 만** 적는다 — KST 표기가 없다", () => {
    // 사장님 지시: 영문 버전은 UTC 기준. 영어 독자는 KST 에 살지 않아 남의
    // 지역시계가 한 줄 더 붙는 셈이고, UTC 는 벤더가 고시한 축 그대로다.
    // ★이건 **표시** 축소지 계산 삭제가 아니다 — 판정은 아래 UTC 축 테스트가,
    // KST 파생은 위 `deepseekPeakWindowsLabel` 테스트가 계속 지킨다.
    const utc = deepseekPeakWindowsLabel(0);
    const raw = enUsage["usage.factSheet.deepseekOffPeak"];
    expect(raw).toContain("{utc}");
    expect(raw).not.toContain("{kst}");
    // 컴포넌트는 두 로케일에 같은 vars 를 넘긴다(`kst` 포함). en 템플릿이 그
    // 자리를 안 쓸 뿐이고, 안 쓰인 변수는 화면에 아무 흔적도 남기지 않는다.
    const filled = raw.replace("{utc}", utc).replace("{kst}", kst0());
    expect(filled).not.toMatch(/[{}]/);
    expect(filled).toContain("01:00-04:00, 06:00-10:00");
    expect(filled).toMatch(/UTC/);
    expect(filled).not.toMatch(/KST/);
    // KST 시각이 글자로도 새어 들어오지 않았는지(문구를 손으로 적다 생기는 사고).
    expect(filled).not.toContain("10:00-13:00");
    expect(filled).not.toContain("15:00-19:00");
    expect(filled).toMatch(/DeepSeek/);
  });

  it("★표기가 갈려도 ko/en 이 뜻하는 구간은 **같은 UTC 구간** 하나다", () => {
    // 로케일마다 문장이 다르면 "영문판은 다른 시간대를 말하는 것 아니냐" 가
    // 열린다. 두 문구가 채우는 UTC 자리가 같은 문자열이고, 그 문자열이 판정에
    // 쓰이는 `DEEPSEEK_PEAK_WINDOWS_UTC` 에서 파생된 것임을 여기서 못박는다.
    const utc = deepseekPeakWindowsLabel(0);
    const koFilled = koUsage["usage.factSheet.deepseekOffPeak"]
      .replace("{utc}", utc)
      .replace("{kst}", deepseekPeakWindowsLabel(KST_OFFSET_MINUTES));
    const enFilled = enUsage["usage.factSheet.deepseekOffPeak"].replace(
      "{utc}",
      utc,
    );
    // 두 화면이 말하는 UTC 구간 문자열이 같다.
    expect(koFilled).toContain(`${utc} UTC`);
    expect(enFilled).toContain(`${utc} UTC`);
    // 그리고 그 문자열은 판정 축과 같은 소스에서 나온다 — 한쪽만 고쳐질 수 없다.
    expect(utc).toBe(
      DEEPSEEK_PEAK_WINDOWS_UTC.map(
        (w) =>
          `${String(Math.floor(w.startMinute / 60)).padStart(2, "0")}:00-` +
          `${String(Math.floor(w.endMinute / 60)).padStart(2, "0")}:00`,
      ).join(", "),
    );
    // ko 만 KST 를 덧붙인다 — en 에는 그 표기가 없다.
    expect(koFilled).toMatch(/KST/);
    expect(enFilled).not.toMatch(/KST/);
  });

  it("실시간 배지 두 문구가 양 로케일에 다 있다", () => {
    for (const table of [koUsage, enUsage]) {
      expect(table["usage.factSheet.deepseekNowOffPeak"]).toBeTruthy();
      expect(table["usage.factSheet.deepseekNowPeak"]).toBeTruthy();
    }
  });

  it("★구간 정의가 벤더 고시(합 7시간)와 같다", () => {
    const total = DEEPSEEK_PEAK_WINDOWS_UTC.reduce(
      (sum, w) => sum + (w.endMinute - w.startMinute),
      0,
    );
    expect(total).toBe(7 * 60);
    expect(DEEPSEEK_OFF_PEAK_MULTIPLIER).toBe(0.5);
  });
});

/** en 테스트용: 컴포넌트가 실제로 넘기는 `kst` 값. 표시엔 안 쓰이지만 넘어온다. */
function kst0(): string {
  return deepseekPeakWindowsLabel(KST_OFFSET_MINUTES);
}
