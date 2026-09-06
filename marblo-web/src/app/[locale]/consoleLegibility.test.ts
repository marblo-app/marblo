/**
 * ★`/org` · `/admin` 콘솔 화면이 **프로젝터에서 읽힌다**(감사 #1495 P1-2).
 *
 * 감사가 1920×1080 에서 실측한 것: 이 두 화면의 지배적 본문이 11px 이고, 그
 * 색이 `text-zinc-500`(zinc-950 바탕에서 **4.12:1**) 이었다. 발표는 프로젝터다.
 *
 * ★왜 zinc-400 하나로 접히나 — 계산이지 취향이 아니다. zinc-950(#09090b) 바탕
 *   WCAG 대비:
 *
 *     zinc-300 #d4d4d8 = 13.46:1  통과
 *     zinc-400 #a1a1aa =  7.76:1  통과   ← 흐린 단계의 하한
 *     zinc-500 #71717a =  4.12:1  ★AA(4.5:1) 미달
 *     zinc-600 #52525b =  2.57:1  ★심한 미달
 *
 *   400 과 500 사이 단계가 램프에 없다. 그래서 "흐린 글씨" 는 400 이 끝이고,
 *   그보다 더 낮추고 싶으면 **색이 아니라 크기·굵기·위치**로 낮춘다.
 *
 * ★이 테스트는 렌더가 아니라 **소스를 읽는다.** 이유: 회귀가 들어오는 경로가
 *   렌더가 아니라 편집이다. 누가 새 카드를 붙이며 `text-zinc-500` 을 한 줄
 *   더 쓰는 순간 잡아야지, 그 카드가 어떤 상태에서 렌더되는지를 기다릴 수 없다.
 *
 * ★밝은 배경은 이 규칙의 대상이 아니다. 콘솔은 다크 고정이고(#1495 §0),
 *   밝은 칩(`bg-zinc-100`)은 전부 `text-zinc-900`·`text-white` 와 짝이다 —
 *   아래 스캔이 그 짝을 실제로 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/[locale]/org", "src/app/[locale]/admin"];

/** zinc-950 바탕에서 AA 미달인 잉크 + 프로젝터에서 안 읽히는 크기. */
const BANNED: Array<{ token: string; why: string }> = [
  { token: "text-zinc-500", why: "4.12:1 — AA 미달. text-zinc-400 을 써라" },
  { token: "text-zinc-600", why: "2.57:1 — 심한 미달. text-zinc-400 을 써라" },
  { token: "text-zinc-700", why: "2.0:1 — 사실상 안 보인다" },
  {
    token: "placeholder-zinc-500",
    why: "입력 힌트가 4.12:1 — placeholder-zinc-400",
  },
  { token: "text-[9px]", why: "프로젝터에서 안 읽힌다. 하한은 11px" },
  { token: "text-[10px]", why: "프로젝터에서 안 읽힌다. 하한은 11px" },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p));
    } else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
}

const FILES = ROOTS.flatMap(sourceFiles);

test("★스캔 대상이 실제로 있다 — 경로가 바뀌면 이 가드가 조용히 0건이 된다", () => {
  assert.ok(
    FILES.length >= 10,
    `콘솔 소스가 ${FILES.length}개뿐이다 — ROOTS 경로를 확인해라`,
  );
});

for (const { token, why } of BANNED) {
  test(`★콘솔에 ${token} 이 없다 — ${why}`, () => {
    const hits: string[] = [];
    for (const f of FILES) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(token)) hits.push(`${f}:${i + 1}`);
        });
    }
    assert.deepEqual(
      hits,
      [],
      `${hits.length}곳에서 ${token} 을 쓴다 (${why}):\n  ${hits
        .slice(0, 20)
        .join("\n  ")}`,
    );
  });
}

test("★밝은 배경 칩은 어두운 잉크와 짝이다 — 대비 규칙을 뒤집지 않았는지", () => {
  const bad: string[] = [];
  const lightBg = /bg-(white|zinc-(50|100|200)|gray-(50|100|200))\b/;
  for (const f of FILES) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!lightBg.test(line)) return;
        // 밝은 바탕 줄에 흐린 잉크가 같이 있으면 대비가 뒤집힌다.
        if (/text-zinc-(300|400|500|600)\b/.test(line)) {
          bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
  }
  assert.deepEqual(bad, [], `밝은 바탕에 흐린 잉크:\n  ${bad.join("\n  ")}`);
});
