/**
 * 번들 실측 — 차트 라이브러리가 고객 브라우저로 실제로 보내는 양.
 *
 * 이력: EaWvAqtmijseOgGBTdHw(bakeoff)에서 visx·recharts 를 나란히 재던 스크립트다.
 * 사장님이 recharts 를 고르셨고 visx 는 지웠으므로 **recharts 만 남겼다.**
 * 그래도 이 스크립트를 남기는 이유: 사장님이 +110.3 KB 를 아시고 고르신 것이라,
 * 나중에 그 숫자가 **얼마나 더 자랐는지**를 언제든 다시 잴 수 있어야 한다.
 * (visx 쪽 실측치는 docs/CHART-BAKEOFF-2026-08-24.md 에 그대로 남아 있다.)
 *
 * ★방법: 차트 컴포넌트를 **각각** 하나의 엔트리로 esbuild 번들한다.
 *   react / react-dom 은 external 로 뺀다 — 앱이 어차피 갖고 있는 것이라
 *   여기서 재고 싶은 것은 **차트 때문에 늘어난 몫**뿐이다.
 *   minify + gzip 은 실제 배포 조건과 같게 맞춘다.
 *
 * ★같이 뽑는 것: 번들 안에 들어온 node_modules 패키지 상위 목록. recharts 가
 *   상태관리 런타임을 끌고 오는지를 **주장이 아니라 metafile 로** 보여준다.
 *
 * 실행: `npx tsx scripts/measure-chart-bundle.tsx`
 */
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import path from "node:path";

const ROOT = process.cwd();
const EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "react-dom/client", "react-dom/server"];

type Case = { name: string; importPath: string; symbol: string };

const CASES: Case[] = [
  {
    name: "baseline (ChartFrame만)",
    importPath: "src/components/charts/ChartFrame",
    symbol: "ChartFrame",
  },
  {
    name: "TimeSeriesChart",
    importPath: "src/components/charts/TimeSeriesChart",
    symbol: "TimeSeriesChart",
  },
  {
    name: "MultiSeriesChart",
    importPath: "src/components/charts/MultiSeriesChart",
    symbol: "MultiSeriesChart",
  },
];

/** 번들 입력들을 node_modules 패키지 단위로 접어 크기 순으로 준다. */
function packagesOf(metafile: Record<string, { inputs: Record<string, { bytesInOutput: number }> }>) {
  const out = Object.values(metafile)[0];
  const acc = new Map<string, number>();
  for (const [file, info] of Object.entries(out.inputs)) {
    const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    const key = m ? m[1] : "(우리 코드)";
    acc.set(key, (acc.get(key) ?? 0) + info.bytesInOutput);
  }
  return [...acc.entries()].sort((a, b) => b[1] - a[1]);
}

async function measure(c: Case) {
  const r = await build({
    stdin: {
      contents: `export { ${c.symbol} } from ${JSON.stringify(path.join(ROOT, c.importPath))};`,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    target: ["es2020"],
    jsx: "automatic",
    external: EXTERNAL,
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
    write: false,
    logLevel: "silent",
  });
  const code = r.outputFiles[0].contents;
  // 파싱 비용 측정용으로만 CJS 사본을 하나 더 굽는다(vm.Script 가 ESM 을 못 씹는다).
  const cjs = await build({
    stdin: {
      contents: `export { ${c.symbol} } from ${JSON.stringify(path.join(ROOT, c.importPath))};`,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "cjs",
    target: ["es2020"],
    jsx: "automatic",
    external: EXTERNAL,
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
    logLevel: "silent",
  });
  const text = cjs.outputFiles[0].text;
  return {
    name: c.name,
    raw: code.byteLength,
    gzip: gzipSync(Buffer.from(code), { level: 9 }).byteLength,
    packages: packagesOf(r.metafile.outputs as never),
    // ★파싱/컴파일 비용. 브라우저도 내려받은 JS 를 이만큼 씹어야 첫 그림이 뜬다.
    //   (V8 이라 엔진이 같다. 기기 성능은 다르니 상대비로 읽어라.)
    compileMs: compileCost(text),
  };
}

/** 같은 코드를 N 번 새로 컴파일해 중앙값을 낸다(캐시를 못 타게 주석으로 흔든다). */
function compileCost(text: string, runs = 7): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const src = `/*${i}*/` + text;
    const t0 = performance.now();
    new vm.Script(src, { filename: `probe-${i}.js` });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function main() {
  const results = [];
  for (const c of CASES) results.push(await measure(c));

  const base = results[0];
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

  console.log("\n번들 실측 (esbuild · minify · gzip -9 · react/react-dom external)\n");
  console.log("케이스                        raw          gzip     기준선대비gzip    파싱/컴파일");
  for (const r of results) {
    const delta = r.gzip - base.gzip;
    console.log(
      `${r.name.padEnd(26)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(11)} ` +
        `${(r === base ? "—" : `+${kb(delta)}`).padStart(14)} ${`${r.compileMs.toFixed(1)}ms`.padStart(13)}`
    );
  }

  // 네트워크 환산 — 차트가 늘린 gzip 바이트가 도착하는 데 걸리는 시간.
  const THROUGHPUT = [
    { label: "Lighthouse Slow 4G (1.6 Mbps)", bps: 1.6e6 },
    { label: "보통 LTE (10 Mbps)", bps: 10e6 },
    { label: "사무실 유선 (50 Mbps)", bps: 50e6 },
  ];
  const worst = results.slice(1).reduce((a, b) => (b.gzip > a.gzip ? b : a));
  const diff = worst.gzip - base.gzip;
  console.log(`\n★차트 때문에 더 내려받는 양(${worst.name} 기준): ${kb(diff)} (gzip)`);
  for (const t of THROUGHPUT) {
    console.log(`  ${t.label.padEnd(30)} ≈ ${(((diff * 8) / t.bps) * 1000).toFixed(0).padStart(4)} ms`);
  }
  console.log(
    "  ★이 시간 동안 사용자가 빈 칸을 보지 않도록 ChartFrame 이 스켈레톤을 세운다."
  );

  for (const r of results.slice(1)) {
    console.log(`\n[${r.name}] 번들에 들어온 패키지 (raw bytes, 상위 10)`);
    for (const [pkg, bytes] of r.packages.slice(0, 10)) {
      console.log(`  ${pkg.padEnd(28)} ${kb(bytes).padStart(9)}`);
    }
  }

  const rc = worst;
  const stateRuntime = rc.packages.filter(([p]) =>
    ["@reduxjs/toolkit", "react-redux", "immer", "reselect", "use-sync-external-store"].includes(p)
  );
  const total = stateRuntime.reduce((a, [, b]) => a + b, 0);
  console.log(
    `\n★recharts 번들 안의 상태관리 런타임: ${stateRuntime.map(([p]) => p).join(", ") || "(없음)"}` +
      `\n  합계 ${kb(total)} (raw) — 차트 하나 그리자고 들어온 것이다.\n`
  );

  console.log(
    JSON.stringify(
      results.map((r) => ({
        case: r.name,
        rawBytes: r.raw,
        gzipBytes: r.gzip,
        deltaGzipBytes: r.gzip - base.gzip,
        compileMs: Number(r.compileMs.toFixed(2)),
      })),
      null,
      2
    )
  );
}

main();
