/**
 * 툴팁 한 칸에 들어갈 줄들을 만든다 — **순수 함수로 떼어 놓은 이유**가 있다.
 *
 * ★호버는 이 대시보드의 핵심 상호작용이고, 규율이 제일 자주 깨지는 자리다:
 *   값이 없는 계열을 0 으로 쓰거나, 아예 줄에서 빼 버리거나(그러면 "그날 그
 *   계열이 없었다"가 아니라 "그런 계열이 없다"로 읽힌다). 둘 다 거짓말이다.
 *
 * ★recharts 의 툴팁 payload 안에서 이걸 검사하려면 실제 호버 좌표가 필요한데,
 *   jsdom 에는 레이아웃이 없어 좌표가 불안정하다. 그래서 **규칙만 떼어내** 여기서
 *   직접 검사한다. 없는 증명을 있는 척하지 않기 위한 분리다.
 */
import { compareKey, deltaOf, type TooltipRow } from "./primitives";
import type { NamedSeries } from "./types";

/** recharts 가 툴팁으로 넘겨주는 항목 중 우리가 쓰는 것만. */
export type TooltipPayloadEntry = {
  readonly dataKey?: string | number;
  readonly value?: unknown;
};

/**
 * ★한 점이 아니라 **그 시점의 전 계열 단면**을 만든다.
 *
 * 보이는 계열은 그날 값이 없어도 줄이 남고(`—`), 끈 계열은 줄 자체가 없다.
 * 그게 "지금 화면에 있는 것" 과 "그날 있었던 것" 을 가르는 방법이다.
 */
export function renderTooltipRows(
  series: NamedSeries[],
  hidden: ReadonlySet<string>,
  entries: ReadonlyArray<TooltipPayloadEntry>
): TooltipRow[] {
  return series
    .filter((s) => !hidden.has(s.key))
    .map((s) => {
      const hit = entries.find((p) => p.dataKey === s.key);
      const v = typeof hit?.value === "number" ? hit.value : null;
      const prevRaw = entries.find(
        (p) => p.dataKey === compareKey(s.key)
      )?.value;
      const prev = typeof prevRaw === "number" ? prevRaw : null;
      return {
        key: s.key,
        label: s.label,
        slot: s.slot,
        tone: s.tone,
        value: v,
        compare: s.compare
          ? { label: s.compare.label, value: prev, delta: deltaOf(v, prev) }
          : undefined,
      };
    });
}
