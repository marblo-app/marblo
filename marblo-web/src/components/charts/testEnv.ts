/**
 * jsdom 부트스트랩 — **테스트·계측 전용**이다. 제품 코드에서 import 하지 마라.
 *
 * ★왜 있나: recharts 는 **서버에서 아무것도 안 그린다.** 그래서 이 차트들의
 *   규율(결측을 안 잇는다 · 0 으로 안 떨어뜨린다 · 축을 안 넘긴다)은
 *   `renderToStaticMarkup` 으로는 한 줄도 검사할 수 없다. 실제로 마운트해서
 *   나온 DOM 을 봐야 한다.
 *
 * ★GUI 검증 금지에 걸리지 않는다 — jsdom 은 브라우저를 띄우는 게 아니라 DOM
 *   구현체다. Playwright·Electron 은 안 쓴다.
 *
 * ★한계를 숨기지 않는다: 여기엔 레이아웃도 페인트도 없다. 폭·높이·
 *   ResizeObserver 를 우리가 고정값으로 채워 넣어야 recharts 가 그린다.
 *   그래서 여기서 나온 **좌표는 이 고정 상자 기준**이지 실제 화면이 아니다.
 *   비율(선형성)은 검사할 수 있고, 절대 픽셀은 검사하면 안 된다.
 */
import { JSDOM } from "jsdom";
import { performance } from "node:perf_hooks";

export const BOX_W = 640;
export const BOX_H = 240;

export const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://local.test/",
});

const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.SVGElement = dom.window.SVGElement;
g.MouseEvent = dom.window.MouseEvent;
g.Event = dom.window.Event;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: (t: number) => void) =>
  dom.window.setTimeout(() => cb(performance.now()), 16);
g.cancelAnimationFrame = (id: number) => dom.window.clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

/** ResizeObserver — jsdom 에 없다. recharts 의 ResponsiveContainer 가 이걸 기다린다. */
class RO {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    const entry = {
      target: el,
      contentRect: {
        width: BOX_W,
        height: BOX_H,
        top: 0,
        left: 0,
        right: BOX_W,
        bottom: BOX_H,
        x: 0,
        y: 0,
      },
    } as unknown as ResizeObserverEntry;
    this.cb([entry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
g.ResizeObserver = RO;
(dom.window as unknown as Record<string, unknown>).ResizeObserver = RO;

// 레이아웃이 없어 폭이 항상 0 이다. 두 구현이 같은 폭을 받도록 고정한다.
for (const prop of ["clientWidth", "offsetWidth"] as const) {
  Object.defineProperty(dom.window.HTMLElement.prototype, prop, { get: () => BOX_W });
}
for (const prop of ["clientHeight", "offsetHeight"] as const) {
  Object.defineProperty(dom.window.HTMLElement.prototype, prop, { get: () => BOX_H });
}
dom.window.Element.prototype.getBoundingClientRect = function () {
  return {
    width: BOX_W,
    height: BOX_H,
    top: 0,
    left: 0,
    right: BOX_W,
    bottom: BOX_H,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
};

export const { document: doc } = dom.window;
