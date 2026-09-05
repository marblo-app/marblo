/**
 * ★변별력 진단기 — "왜 모델 간 차이가 안 벌어지는가" 를 수치로 답한다.
 *
 * 이 스크립트가 따로 있는 이유: `report.ts` 는 **무엇이 나왔나**(셀별 resolved)를
 * 찍는 물건이고, 여기는 **그 표가 모델을 가를 수 있는 표인가**를 찍는 물건이다.
 * 라운드2 에서 frontier 10셀이 전부 9~12/12 안에 몰렸을 때, resolved 표만 봐서는
 * "다들 비슷하다" 까지밖에 못 읽는다. 천장 때문인지·바닥 때문인지·노이즈 때문인지는
 * **문제별로 쪼개 봐야** 나오고, 그 답이 처방을 정한다.
 *
 * ★진단 없이 문제를 더 넣거나 기준을 바꾸는 것을 막으려고 이 스크립트를 먼저 짓고
 * 커밋한다. 처방의 근거가 코드로 남아야 다음 라운드에서 같은 판단을 재현할 수 있다.
 *
 * 쓰는 법:
 *   npm run bench:swe:diagnose                       # 전 스캐폴드
 *   npm run bench:swe:diagnose -- --scaffold=v3a     # 한 라운드만
 *   npm run bench:swe:diagnose -- --compare=v3a,v3b  # ★before/after 간격 비교
 *   npm run bench:swe:diagnose -- --out=docs/benchmark/diagnosis.md
 *
 * ★`--exclude=` 로 특정 모델을 빼고 볼 수 있다. 라운드2 의 solar-pro4(3/12)처럼
 * 한 칸만 동떨어진 이상치가 있으면 "폭이 넓다" 는 착시가 생기기 때문이다. 다만
 * 기본값은 **아무것도 빼지 않는다** — 빼는 것은 손으로 명시해야 하는 조작이다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BENCH_PRICES } from "./manifest";
import { listCostUsd } from "./usage";
import type { RunRecord } from "./types";

interface CellStat {
  model: string;
  effort: string;
  harness: string;
  scaffold: string;
  cliVersion: string;
  /** 채점된 런(에러 제외). */
  graded: number;
  resolved: number;
  errored: number;
  noOutput: number;
  /** 문제 → 풀었나. 변별력 계산의 원자료. */
  byInstance: Map<string, boolean>;
  /** 문제 → F2P 부분점수(0~1). 이분법이 버리는 신호. */
  partialByInstance: Map<string, number>;
  totalMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** 벤더가 적어 준 청구액 합(claude 만). 미계측이면 null 유지. */
  vendorCostUsd: number | null;
  listCostUsd: number | null;
  meteredRuns: number;
}

function loadRecords(file: string): RunRecord[] {
  if (!fs.existsSync(file)) throw new Error(`no results at ${file}`);
  const out: RunRecord[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const rec = JSON.parse(t) as RunRecord;
    if (rec.label !== "our-measured") continue;
    out.push(rec);
  }
  return out;
}

/** `gold`/`noop` 은 대조군이지 모델이 아니다 — 변별력 계산에서 뺀다. */
function isAgentCell(r: RunRecord): boolean {
  return r.harness !== "gold" && r.harness !== "noop";
}

function collect(records: RunRecord[]): Map<string, CellStat> {
  const cells = new Map<string, CellStat>();
  for (const r of records) {
    if (!isAgentCell(r)) continue;
    const model = r.model ?? "(cli default)";
    const key = `${r.scaffold}|${r.harness}|${model}|${r.effort ?? "-"}`;
    let c = cells.get(key);
    if (!c) {
      c = {
        model,
        effort: r.effort ?? "-",
        harness: r.harness,
        scaffold: r.scaffold,
        cliVersion: r.cliVersion ?? "-",
        graded: 0,
        resolved: 0,
        errored: 0,
        noOutput: 0,
        byInstance: new Map(),
        partialByInstance: new Map(),
        totalMs: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        vendorCostUsd: null,
        listCostUsd: null,
        meteredRuns: 0,
      };
      cells.set(key, c);
    }
    if (r.error) {
      c.errored += 1;
    } else if (r.grade) {
      c.graded += 1;
      if (r.grade.resolved) c.resolved += 1;
      c.byInstance.set(r.instanceId, r.grade.resolved);
      // ★부분점수 = F2P 통과 비율. 단 P2P 가 깨졌으면(회귀를 냈으면) 0 으로 본다 —
      // 회귀를 낸 패치에 부분점수를 주면 "부수고 반쯤 고친" 쪽이 이긴다.
      const p2pOk = r.grade.p2pPassed === r.grade.p2pTotal;
      const frac =
        r.grade.f2pTotal > 0 ? r.grade.f2pPassed / r.grade.f2pTotal : 0;
      c.partialByInstance.set(r.instanceId, p2pOk ? frac : 0);
    }
    if (r.agent) {
      c.totalMs += r.agent.durationMs;
      if (r.agent.noOutput) c.noOutput += 1;
      const u = r.agent.usage;
      if (u) {
        c.meteredRuns += 1;
        c.totalInputTokens += u.totalInputTokens;
        c.totalOutputTokens += u.outputTokens;
        if (u.vendorCostUsd !== null) {
          c.vendorCostUsd = (c.vendorCostUsd ?? 0) + u.vendorCostUsd;
        }
        const lc = listCostUsd(u, BENCH_PRICES[model] ?? null);
        if (lc !== null) c.listCostUsd = (c.listCostUsd ?? 0) + lc;
      }
    }
  }
  return cells;
}

/** 이항 표준오차. n 이 작을 때 "차이가 노이즈 안인가" 를 보는 최소 도구. */
function stderrPct(k: number, n: number): number {
  if (n === 0) return 0;
  const p = k / n;
  return 100 * Math.sqrt((p * (1 - p)) / n);
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

/** 한 라운드(스캐폴드)의 변별력 진단. */
function diagnoseRound(
  scaffold: string,
  cells: CellStat[],
  lines: string[],
): void {
  lines.push(`\n## 라운드 \`${scaffold}\``);
  const nInst = new Set<string>();
  for (const c of cells) for (const i of c.byInstance.keys()) nInst.add(i);
  lines.push(
    `\n- 셀(모델) ${cells.length}개 · 문제 ${nInst.size}개 · 총 채점런 ${cells.reduce((a, c) => a + c.graded, 0)}개`,
  );

  // ── 1. 점수 분포 — 천장인가 바닥인가 ──
  lines.push(`\n### 1. 점수 분포 (천장·바닥 판정)\n`);
  lines.push(
    `| model | effort | n | resolved | resolved% | ±SE | 부분점수평균 | 무산출 | 에러 |`,
  );
  lines.push(`| --- | --- | --: | --: | --: | --: | --: | --: | --: |`);
  const sorted = [...cells].sort((a, b) => b.resolved - a.resolved);
  for (const c of sorted) {
    const pct = c.graded ? (100 * c.resolved) / c.graded : 0;
    const partials = [...c.partialByInstance.values()];
    const pAvg = partials.length
      ? partials.reduce((a, b) => a + b, 0) / partials.length
      : 0;
    lines.push(
      `| \`${c.model}\` | ${c.effort} | ${c.graded} | ${c.resolved} | **${fmt(pct)}%** | ${fmt(stderrPct(c.resolved, c.graded))}pt | ${fmt(100 * pAvg)}% | ${c.noOutput} | ${c.errored} |`,
    );
  }
  const scores = sorted.map((c) => c.resolved);
  if (scores.length > 1) {
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    const n = sorted[0].graded || 1;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sd = Math.sqrt(
      scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length,
    );
    lines.push(
      `\n- ★점수 폭: **${lo}~${hi} / ${n}** (${fmt((100 * lo) / n)}%~${fmt((100 * hi) / n)}%) · 표준편차 **${fmt(sd, 2)}문제**`,
    );
    lines.push(
      `- 셀 하나의 95%CI 반폭(중앙값 근처): 약 **±${fmt(1.96 * stderrPct(Math.round(mean), n))}pt** — ` +
        `★이 값이 위 점수 폭(${fmt((100 * (hi - lo)) / n)}pt)보다 크면 **모델 간 차이가 재실행 노이즈 안에 들어간다**`,
    );
  }

  // ── 2. 문제별 정답률 — 죽은 문제 세기 ──
  lines.push(`\n### 2. 문제별 정답률 (★유효 문제수)\n`);
  lines.push(`| instance | 푼 모델 / 전체 | 판정 |`);
  lines.push(`| --- | --: | --- |`);
  let ceiling = 0;
  let floor = 0;
  let disc = 0;
  for (const inst of [...nInst].sort()) {
    const vals = cells
      .map((c) => c.byInstance.get(inst))
      .filter((v): v is boolean => v !== undefined);
    if (vals.length === 0) continue;
    const ok = vals.filter(Boolean).length;
    let verdict: string;
    if (ok === vals.length) {
      verdict = "★천장 — 전원 정답, 정보 0";
      ceiling += 1;
    } else if (ok === 0) {
      verdict = "★바닥 — 전원 오답, 정보 0";
      floor += 1;
    } else {
      verdict = "변별";
      disc += 1;
    }
    lines.push(`| \`${inst}\` | ${ok} / ${vals.length} | ${verdict} |`);
  }
  const total = ceiling + floor + disc;
  lines.push(
    `\n- 천장 **${ceiling}** / 바닥 **${floor}** / 변별 **${disc}** (총 ${total})`,
  );
  lines.push(
    `- ★**유효 문제수 = ${disc}** — 나머지 ${ceiling + floor}개는 토큰을 태우고 정보를 0 준다.`,
  );
  // ★이 수치는 **셀 수에 의존한다.** 모델이 많을수록 어느 한 문제에서 의견이
  // 갈릴 기회가 많아지므로 유효 문제수가 커 보인다. 그래서 라운드가 다른 두
  // 유효 문제수를 **모델 구성이 다르면 직접 비교하면 안 된다** — before/after
  // 비교(§compareRounds)가 양쪽 공통 모델만 쓰는 이유가 이것이다.
  lines.push(
    `- ⚠️ 이 값은 셀 수(${cells.length}개)에 의존한다 — 모델이 많을수록 커 보인다. ` +
      `라운드 간 비교는 **같은 모델 집합**으로만 할 것.`,
  );

  // ── 3. 모델들이 같은 문제를 맞고 틀리는가 ──
  const pairs: number[] = [];
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const a = cells[i];
      const b = cells[j];
      const shared = [...a.byInstance.keys()].filter((k) =>
        b.byInstance.has(k),
      );
      if (shared.length === 0) continue;
      const agree = shared.filter(
        (k) => a.byInstance.get(k) === b.byInstance.get(k),
      ).length;
      pairs.push(agree / shared.length);
    }
  }
  if (pairs.length) {
    const mean = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    lines.push(`\n### 3. 모델 간 일치도\n`);
    lines.push(
      `- 쌍별 일치도 평균 **${fmt(100 * mean)}%** (최소 ${fmt(100 * Math.min(...pairs))}%, 최대 ${fmt(100 * Math.max(...pairs))}%)`,
    );
    lines.push(
      `- 100% 에 가까울수록 **모델들이 같은 문제를 맞고 같은 문제를 틀린다** = 이 문제셋은 모델을 가르지 못한다`,
    );
  }

  // ── 4. 비용·시간 축 ──
  lines.push(`\n### 4. 비용·시간 축\n`);
  lines.push(
    `| model | 계측런 | 평균시간 | 입력토큰 | 출력토큰 | 정가환산$ | 벤더청구$ | 해결1건당 정가$ |`,
  );
  lines.push(`| --- | --: | --: | --: | --: | --: | --: | --: |`);
  for (const c of sorted) {
    const avgS = c.graded ? c.totalMs / c.graded / 1000 : 0;
    const perResolved =
      c.listCostUsd !== null && c.resolved > 0
        ? `$${fmt(c.listCostUsd / c.resolved, 2)}`
        : "-";
    // ★계측 이전 라운드는 토큰이 0 이 아니라 **모른다**. 0 으로 찍으면
    // "공짜로 풀었다" 로 읽히고, 그게 곧 비용 비교표의 근거가 된다.
    const inTok = c.meteredRuns
      ? c.totalInputTokens.toLocaleString()
      : "미계측";
    const outTok = c.meteredRuns
      ? c.totalOutputTokens.toLocaleString()
      : "미계측";
    lines.push(
      `| \`${c.model}\` | ${c.meteredRuns} | ${fmt(avgS, 0)}s | ${inTok} | ${outTok} | ${c.listCostUsd !== null ? "$" + fmt(c.listCostUsd, 2) : "미계측"} | ${c.vendorCostUsd !== null ? "$" + fmt(c.vendorCostUsd, 2) : "미제공"} | ${perResolved} |`,
    );
  }
  lines.push(
    `\n> ★**정가환산$** 은 양쪽 벤더에 같은 공식(입력·출력 × 단가, 캐시할인 미반영)을 적용한 값이라 **상대 비교용**이고, 절대액은 과대평가다.`,
  );
  lines.push(
    `> ★**벤더청구$** 는 claude 만 제공한다(codex 는 안 준다). 한쪽만 가진 자이므로 **벤더 간 비교에 쓰지 않는다.**`,
  );
  lines.push(
    `> ★단가가 모델마다 다르면 비용축의 우열이 실력이 아니라 가격표에서 나온다. 표를 읽기 전에 \`BENCH_PRICES\` 를 볼 것.`,
  );
}

/** ★before/after — 같은 모델 집합의 간격이 실제로 벌어졌는가. */
function compareRounds(
  before: string,
  after: string,
  all: Map<string, CellStat>,
  lines: string[],
): void {
  const pick = (s: string): CellStat[] =>
    [...all.values()].filter((c) => c.scaffold.includes(s));
  const A = pick(before);
  const B = pick(after);
  if (!A.length || !B.length) {
    lines.push(
      `\n> ★비교 불가 — \`${before}\`(${A.length}셀) 또는 \`${after}\`(${B.length}셀) 에 데이터가 없다.`,
    );
    return;
  }
  // 양쪽에 다 있는 모델만 비교한다. 한쪽에만 있는 모델을 섞으면 간격 변화가
  // 문제셋 때문인지 모델 구성 때문인지 갈리지 않는다.
  const shared = A.map((c) => c.model).filter((m) =>
    B.some((c) => c.model === m),
  );
  lines.push(`\n## ★before/after — 모델 간 간격이 벌어졌는가\n`);
  lines.push(
    `- before \`${before}\` · after \`${after}\` · 양쪽 공통 모델 ${shared.length}개: ${shared.map((m) => `\`${m}\``).join(", ")}`,
  );
  if (shared.length < 2) {
    lines.push(`\n> ★공통 모델이 2개 미만이라 간격을 말할 수 없다.`);
    return;
  }
  lines.push(`\n| model | before resolved% | after resolved% |`);
  lines.push(`| --- | --: | --: |`);
  const pctOf = (cs: CellStat[], m: string): number => {
    const c = cs.find((x) => x.model === m);
    return c && c.graded ? (100 * c.resolved) / c.graded : NaN;
  };
  for (const m of shared) {
    lines.push(`| \`${m}\` | ${fmt(pctOf(A, m))}% | ${fmt(pctOf(B, m))}% |`);
  }
  const spread = (cs: CellStat[]): number => {
    const v = shared.map((m) => pctOf(cs, m)).filter((x) => !Number.isNaN(x));
    return Math.max(...v) - Math.min(...v);
  };
  const effInst = (cs: CellStat[]): number => {
    const insts = new Set<string>();
    for (const c of cs) for (const i of c.byInstance.keys()) insts.add(i);
    let d = 0;
    for (const i of insts) {
      const vals = shared
        .map((m) => cs.find((x) => x.model === m)?.byInstance.get(i))
        .filter((v): v is boolean => v !== undefined);
      if (vals.length && vals.some(Boolean) && !vals.every(Boolean)) d += 1;
    }
    return d;
  };
  const sa = spread(A);
  const sb = spread(B);
  lines.push(
    `\n- **모델 간 폭(최고−최저)**: before **${fmt(sa)}pt** → after **${fmt(sb)}pt** (${sb > sa ? `+${fmt(sb - sa)}pt 벌어짐` : sb < sa ? `${fmt(sb - sa)}pt 좁아짐` : "변화 없음"})`,
  );
  lines.push(
    `- **유효(변별) 문제수**: before **${effInst(A)}** → after **${effInst(B)}**`,
  );

  // ★pt 폭만 보면 안 되는 이유: 폭은 N 에 민감하다. N=12 면 문제 1개가 8.3pt,
  // N=20 이면 5.0pt 다. 그래서 문제를 늘리면 **같은 실력차라도 pt 폭이 줄어든다.**
  // 노이즈로 나눈 값(폭 ÷ 셀 SE)이 N 에 걸리지 않는 비교자다. 이걸 안 보면
  // "문제를 늘렸더니 폭이 좁아졌다 = 실패" 라는 잘못된 결론이 나온다.
  const medianSE = (cs: CellStat[]): number => {
    const ses = shared
      .map((m) => cs.find((x) => x.model === m))
      .filter((c): c is CellStat => !!c && c.graded > 0)
      .map((c) => stderrPct(c.resolved, c.graded))
      .sort((x, y) => x - y);
    if (!ses.length) return 0;
    return ses[Math.floor(ses.length / 2)];
  };
  const sea = medianSE(A);
  const seb = medianSE(B);
  const ratio = (s: number, e: number): string =>
    e > 0 ? `${fmt(s / e, 2)}σ` : "n/a(SE=0)";
  lines.push(
    `- ★**노이즈 대비 폭(폭 ÷ 셀 중앙 SE)**: before **${ratio(sa, sea)}** → after **${ratio(sb, seb)}**`,
  );
  lines.push(
    `  - 중앙 SE: before ${fmt(sea)}pt · after ${fmt(seb)}pt. ` +
      `★pt 폭은 N 에 민감하다(N=12 면 문제 1개=8.3pt, N=20 이면 5.0pt) — ` +
      `문제를 늘리면 같은 실력차라도 pt 폭이 줄어든다. 이 σ 값이 N 에 걸리지 않는 비교자다.`,
  );
  lines.push(
    `\n> ★간격이 안 벌어졌으면 그대로 적는다. 이 벤치가 파는 유일한 것은 정직성이고, 성공한 척하는 순간 그게 사라진다.`,
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (n: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : undefined;
  };
  const root =
    process.env.MARBLO_BENCH_ROOT ||
    path.join(os.homedir(), ".marblo", "swe-bench");
  const file = get("in") || path.join(root, "results", "runs.jsonl");
  const exclude = (get("exclude") || "").split(",").filter(Boolean);
  const only = get("scaffold");

  const records = loadRecords(file);
  const cells = collect(records);
  if (exclude.length) {
    for (const [k, c] of [...cells]) {
      if (exclude.includes(c.model)) cells.delete(k);
    }
  }

  const lines: string[] = [];
  lines.push(`# SWE 벤치 변별력 진단 (\`our-measured\`)`);
  lines.push(
    `\n> 이 문서는 **자동 생성**된다(\`npm run bench:swe:diagnose\`). 손으로 고치지 말 것.`,
  );
  lines.push(
    `\n- 원장: \`${file}\` · 총 \`our-measured\` 행 ${records.length}개`,
  );
  if (exclude.length) {
    lines.push(`- ★제외한 모델(손으로 명시함): ${exclude.join(", ")}`);
  }

  const scaffolds = [...new Set([...cells.values()].map((c) => c.scaffold))]
    .filter((s) => !only || s.includes(only))
    .sort();
  for (const s of scaffolds) {
    diagnoseRound(
      s,
      [...cells.values()].filter((c) => c.scaffold === s),
      lines,
    );
  }

  const cmp = get("compare");
  if (cmp) {
    const [b, a] = cmp.split(",");
    compareRounds(b, a, cells, lines);
  }

  const text = lines.join("\n") + "\n";
  const out = get("out");
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`[diagnose] wrote ${out}`);
  } else {
    console.log(text);
  }
}

main();
