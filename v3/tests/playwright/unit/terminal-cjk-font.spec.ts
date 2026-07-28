import { test, expect } from "../helpers/fixtures";
import type { ConsoleMessage } from "@playwright/test";
import { TERMINAL_FONT_FAMILY } from "../../../src/lib/monoFont";

/**
 * Tier 1+2 회귀: 터미널 한글 자간 (#659 후속).
 *
 * #659 는 D2Coding 을 번들하고 rescaleOverlappingGlyphs 를 켰지만 한글 자간이
 * 그대로였다. 원인은 폰트 선택이 아니라 두 가지 배선 누락:
 *
 *   1. .ttf 가 `v3/public/` 에 커밋됐는데 vite.config 는 `root: "src"` →
 *      publicDir 이 `v3/src/public`. dist 로 복사되는 곳이 아니어서
 *      /fonts/... 요청이 SPA index.html(text/html)로 떨어졌다. 즉 D2Coding 은
 *      dev·패키지 어디서도 한 번도 로드된 적이 없다.
 *   2. xterm 5.5.0 은 CSS Font Loading API 를 전혀 모른다(번들에
 *      `document.fonts` 0건). 모든 폰트 파생 캐시(glyph atlas / DOM
 *      WidthCache→letter-spacing / CharSizeService 셀 박스)를 open() 시점에
 *      굳힌다. 웹폰트는 그때 아직 없으므로 폴백으로 구워진다.
 *
 * 이 spec 은 **프로덕션 경로**(MARBLO_FORCE_PROD=1 → 내장 http 정적 서버가
 * dist/ 를 서빙)로 앱을 띄우므로, 패키지 빌드에서의 폰트 서빙까지 함께 검증한다.
 */

const CJK_SPEC = '13px "Marblo D2Coding"';

test.describe("터미널 한글 폰트 (회귀 #659 후속)", () => {
  test("@unit 번들 D2Coding 이 프로덕션 정적 서버에서 폰트로 서빙된다", async ({
    marblo,
  }) => {
    // 렌더러 origin 기준 fetch — 패키지 빌드가 실제로 쓰는 경로 그대로.
    const res = await marblo.page.evaluate(async () => {
      const r = await fetch("/fonts/d2coding/D2Coding-Regular.ttf");
      const buf = await r.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 4));
      return {
        status: r.status,
        contentType: r.headers.get("content-type") ?? "",
        bytes: buf.byteLength,
        // TrueType magic: 0x00010000 (또는 'true'). 회귀 때는 여기가
        // "<!do"(index.html) 였다.
        magic: Array.from(head)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      };
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("font");
    expect(res.bytes).toBeGreaterThan(1_000_000);
    expect(res.magic).toBe("00010000");
  });

  test("@unit document.fonts.check 가 한글 face 로드를 확인한다", async ({
    marblo,
  }) => {
    // 앱이 실제로 이 face 를 쓸 수 있어야 나머지가 의미 있다.
    await marblo.page.evaluate(
      (spec) => document.fonts.load(spec, "가"),
      CJK_SPEC,
    );
    const loaded = await marblo.page.evaluate(
      (spec) => document.fonts.check(spec, "가"),
      CJK_SPEC,
    );
    expect(loaded, `document.fonts.check(${CJK_SPEC}) 가 true 여야 함`).toBe(
      true,
    );
  });

  test("@unit 로드된 D2Coding 이 한글을 폴백과 다르게 그린다", async ({
    marblo,
  }) => {
    // face 가 "로드됨"으로 보고되지만 실제 글리프는 폴백인 경우를 배제.
    const m = await marblo.page.evaluate(async (spec) => {
      await document.fonts.load(spec, "가나다라");
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = spec;
      const d2 = ctx.measureText("가나다라").width;
      ctx.font = spec.replace('"Marblo D2Coding"', "monospace");
      const fallback = ctx.measureText("가나다라").width;
      ctx.font = spec;
      const han = ctx.measureText("가").width;
      const ascii = ctx.measureText("0").width;
      return { d2, fallback, han, ascii };
    }, CJK_SPEC);

    expect(m.d2).toBeGreaterThan(0);
    expect(m.d2).not.toBeCloseTo(m.fallback, 1);
    // D2Coding 은 고정폭 CJK — 한글 1자 = ASCII 2칸. 이게 어긋나면 xterm 이
    // 2칸에 배치한 글리프가 삐져나와 그게 곧 "자간" 증상이 된다.
    expect(m.han / m.ascii).toBeCloseTo(2, 1);
  });

  test("@mocked 오케스트레이터 터미널이 폰트 로드 후 캐시를 재빌드한다", async ({
    marblo,
  }) => {
    // bindTerminalCjkFont 가 실제 앱에서 돌았다는 직접 증거.
    const rebuilds: string[] = [];
    const onConsole = (msg: ConsoleMessage) => {
      const t = msg.text();
      if (t.includes("CJK glyph caches rebuilt")) rebuilds.push(t);
    };
    marblo.page.on("console", onConsole);

    await marblo.openMockOrchestrator();
    const term = await marblo.terminal("orchestrator");
    await term.waitReady();

    await expect
      .poll(() => rebuilds.length, {
        message: "OrchestratorTerminal 이 CJK 캐시를 재빌드해야 함",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    marblo.page.off("console", onConsole);
    expect(rebuilds[0]).toContain("OrchestratorTerminal");
  });

  test("@mocked 재빌드 후 xterm 셀 폭이 한글 2칸과 일치한다", async ({
    marblo,
  }) => {
    await marblo.openMockOrchestrator();
    const term = await marblo.terminal("orchestrator");
    await term.waitReady();

    // 재빌드가 끝나 셀 메트릭이 안정될 시간.
    await term.waitMs(1500);

    // 렌더러 중립: 캔버스/WebGL 은 .xterm-rows 를 만들지 않고 폰트를 canvas
    // ctx.font 로만 쓴다. 그래서 DOM 에서 스택을 읽지 않고, 터미널이 실제로
    // 생성될 때 넘긴 그 상수(TERMINAL_FONT_FAMILY)로 잰다.
    // .xterm-rows 가 있으면(=DOM 렌더러) letter-spacing 까지 함께 본다.
    const geom = await marblo.page.evaluate(
      ({ stack, spec }) => {
        if (!document.querySelector(".xterm")) return null;
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = `13px ${stack}`;
        const cellW = ctx.measureText("0").width;
        ctx.font = spec;
        const hanW = ctx.measureText("가").width;
        const rows = document.querySelector(
          ".xterm-rows",
        ) as HTMLElement | null;
        return {
          cellW,
          hanW,
          letterSpacing: rows ? getComputedStyle(rows).letterSpacing : null,
        };
      },
      { stack: TERMINAL_FONT_FAMILY, spec: CJK_SPEC },
    );

    expect(geom, ".xterm 컨테이너가 렌더되어야 함").not.toBeNull();
    expect(geom!.cellW).toBeGreaterThan(0);

    // ★핵심 단언: 한글 advance 가 정확히 2 셀이어야 자간이 0 이 된다.
    //   2 보다 크면 글리프가 겹치고, 작으면 그 차이가 그대로 글자 사이 빈틈
    //   으로 보인다(= 이 티켓의 증상). 폴백 CJK face 로 구워지면 11.24/7.83
    //   = 1.44, D2Coding 이 스택 뒤에 있으면 13.00/7.83 = 1.66 으로 어긋난다.
    const ratio = geom!.hanW / geom!.cellW;
    expect(
      ratio,
      `한글 advance/셀폭 = ${ratio.toFixed(4)} (정확히 2.0 이어야 자간 0)`,
    ).toBeCloseTo(2, 3);

    // DOM 렌더러일 때만: letter-spacing 이 빈값/NaN 이면 WidthCache 가 깨진 상태.
    if (geom!.letterSpacing !== null) {
      expect(geom!.letterSpacing).toMatch(/^-?\d+(\.\d+)?px$|^normal$/);
    }
  });
});
