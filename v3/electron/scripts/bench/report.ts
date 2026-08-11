/**
 * 결과 JSONL → 마크다운 표 **와** 앱이 읽는 구조화 데이터.
 *
 * ★이 생성기가 강제하는 정직성 규칙 (공개 벤치 방법론 PR#25 상속):
 *   1. `label !== "our-measured"` 인 행은 **거부**한다. 벤더 공개치가 실수로
 *      같은 파일에 섞여도 표에 오르지 못한다.
 *   2. 모든 표에 **n 을 인쇄**한다. n 없는 비율은 찍지 않는다.
 *   3. `scaffold` / `execEnv` 를 표 위에 명시한다 — 이 둘 없이는 점수가
 *      해석 불가하고, 특히 execEnv 가 공식 Docker 가 아님을 숨길 수 없게 한다.
 *   4. 에러로 채점 못 한 런은 **분모에서 빼지 않고** `error` 로 따로 센다.
 *      조용히 빼면 실패를 지운 표가 된다.
 *
 * ── ★출력이 둘인 이유(손 중복 금지) ─────────────────────────────────────
 * 종전엔 이 스크립트의 산출물이 마크다운 하나였고, 그래서 사용량 탭에 같은 숫자를
 * 띄우려면 사람이 표를 보고 옮겨 적어야 했다. 옮겨 적은 표는 **다음 측정에서
 * 갈라진다** — 문서는 갱신되는데 화면은 옛 숫자를 들고 남는다.
 *
 * 그래서 `--emit-ours=<path>` 를 붙였다. 같은 `summarize()` 결과에서 마크다운과
 * `electron/model-bench-ours-data.ts`(앱이 읽는 구조화 소스)를 **한 번에** 뽑는다.
 * 두 산출물이 갈라지려면 이 파일을 고쳐야 하고, 그건 리뷰에 걸린다.
 *
 * 캡션도 같은 이유로 상수다(`OUR_MEASURED_DISCLAIMERS`): 마크다운 헤더와 화면
 * 캡션이 **같은 문자열**이어야 "문서엔 한계가 적혀 있는데 화면엔 없다" 가 구조적으로
 * 불가능해진다. `tests/unit/model-bench-ours.test.ts` 가 그 일치를 못박는다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { RunRecord } from "./types";
import type {
  OurBenchCell,
  OurBenchHarness,
  OurBenchInstanceCell,
  OurBenchInstanceRow,
  OurBenchReport,
} from "../../model-bench-ours";

function loadRecords(file: string): RunRecord[] {
  if (!fs.existsSync(file)) throw new Error(`no results at ${file}`);
  const out: RunRecord[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const rec = JSON.parse(t) as RunRecord;
    // 규칙 1 — 라벨 게이트.
    if (rec.label !== "our-measured") continue;
    out.push(rec);
  }
  return out;
}

interface Cell {
  key: string;
  harness: string;
  model: string;
  effort: string;
  scaffold: string;
  execEnv: string;
  graderVersion: string;
  cliVersion: string;
  resolved: number;
  graded: number;
  errored: number;
  noOutput: number;
  totalMs: number;
}

function summarize(records: RunRecord[]): Cell[] {
  const cells = new Map<string, Cell>();
  for (const r of records) {
    const model = r.model ?? "(cli default)";
    const effort = r.effort ?? "-";
    // ★채점기 버전이 셀 키에 들어간다. 버전이 다른 런은 절대 합산되지 않는다.
    // 이 필드가 없는 옛 행(버그 있던 채점기)은 `v1(pre-fix)` 로 분리된다.
    const graderVersion = r.graderVersion ?? "v1(pre-fix)";
    const key = [
      r.harness,
      model,
      effort,
      r.scaffold,
      r.execEnv,
      graderVersion,
    ].join("|");
    let c = cells.get(key);
    if (!c) {
      c = {
        key,
        harness: r.harness,
        model,
        effort,
        scaffold: r.scaffold,
        execEnv: r.execEnv,
        graderVersion,
        cliVersion: r.cliVersion ?? "-",
        resolved: 0,
        graded: 0,
        errored: 0,
        noOutput: 0,
        totalMs: 0,
      };
      cells.set(key, c);
    }
    if (r.error || !r.grade) c.errored += 1;
    else {
      c.graded += 1;
      if (r.grade.resolved) c.resolved += 1;
    }
    if (r.agent?.noOutput) c.noOutput += 1;
    c.totalMs += r.agent?.durationMs ?? 0;
  }
  return [...cells.values()];
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

/**
 * ★리포트 헤더의 **한계 문구**. 마크다운과 앱 화면이 이 배열 하나를 공유한다.
 *
 * 화면에 같은 말을 다시 적지 않는 이유: 그렇게 하면 두 문구가 언젠가 갈라지고,
 * 갈라졌을 때 **약한 쪽(보통 화면)이 이긴다**. 문서엔 "공식 리더보드와 비교
 * 불가" 가 적혀 있는데 화면엔 100% 만 크게 떠 있는 상태가 정확히 그 사고다.
 * 그래서 문자열을 하나만 두고, 마크다운은 그대로 쓰고, 화면은 강조 표기만 떼서
 * 쓴다(`stripEmphasis`).
 */
export const OUR_MEASURED_DISCLAIMERS: readonly string[] = [
  "★이 표의 숫자는 **우리가 우리 스폰 경로로 직접 잰 값**이다. " +
    "벤더 공개치(`electron/model-bench-reference.ts`)와 **같은 표에 놓지 않는다**.",
  "★실행환경이 공식 SWE-bench Docker 이미지가 아니므로 **공식 리더보드 수치와 비교할 수 없다.** " +
    "여기서 읽어도 되는 것은 *같은 execEnv·같은 scaffold 안에서의 상대 비교*뿐이다.",
];

function render(records: RunRecord[], generatedAt: string): string {
  const cells = summarize(records);
  const instances = [...new Set(records.map((r) => r.instanceId))].sort();
  const dataset = records[0]?.dataset ?? "(unknown)";
  const lines: string[] = [];

  lines.push("# SWE-bench — Marblo 자체 실측 (our-measured)");
  lines.push("");
  for (const d of OUR_MEASURED_DISCLAIMERS) lines.push(`> ${d}`);
  lines.push("");
  lines.push(`- 데이터셋: \`${dataset}\``);
  // ★"합집합" 이라고 적는 이유: 라운드가 둘 이상이면 이 목록은 **어느 한 라운드의
  // 고정 N 이 아니다**. 그냥 `고정 N=14` 라고 적으면 아무도 돌린 적 없는 14개짜리
  // 라운드가 있었던 것처럼 읽힌다. 라운드별 실제 N 은 바로 아래 줄에 적는다.
  lines.push(
    `- 인스턴스(전 라운드 합집합 N=${instances.length}): ${instances
      .map((i) => `\`${i}\``)
      .join(", ")}`,
  );
  for (const scaffold of [...new Set(records.map((r) => r.scaffold))]) {
    const n = new Set(
      records.filter((r) => r.scaffold === scaffold).map((r) => r.instanceId),
    ).size;
    lines.push(`  - 라운드 \`${scaffold}\` — 고정 N=${n}`);
  }
  lines.push(`- 총 런: ${records.length}`);
  lines.push("");

  lines.push("## 셀별 요약");
  lines.push("");
  lines.push(
    "| harness | model | effort | n(채점) | resolved | resolved% | 무산출 | 에러 | 평균 에이전트 시간 |",
  );
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const c of cells) {
    const runs = c.graded + c.errored;
    const avg =
      runs > 0 && c.totalMs > 0
        ? `${(c.totalMs / runs / 1000).toFixed(0)}s`
        : "-";
    lines.push(
      `| \`${c.harness}\` | ${c.model} | ${c.effort} | ${c.graded} | ${c.resolved} | ` +
        `**${pct(c.resolved, c.graded)}** | ${c.noOutput} | ${
          c.errored
        } | ${avg} |`,
    );
  }
  lines.push("");
  for (const c of cells) {
    lines.push(
      `- \`${c.harness}\` ${c.model} scaffold=\`${c.scaffold}\` execEnv=\`${c.execEnv}\` ` +
        `grader=\`${c.graderVersion}\` cli=\`${c.cliVersion}\``,
    );
  }
  lines.push("");

  // ─────────────────────────────────────────────────────────────────────
  // ★인스턴스 표를 **라운드(scaffold)별로 쪼개고 열을 모델까지 내린** 이유.
  //
  // 종전 표는 열이 하네스뿐이라 `claude` 3모델의 결과가 한 칸에 <br> 로 쌓였고,
  // 라운드가 둘이 되면 거기에 다른 라운드의 런까지 섞여 쌓인다. 그 표로는
  // "어떤 모델이 어떤 인스턴스에서 갈렸나" — 이 라운드를 연 **유일한 이유** —
  // 를 읽을 수 없다. 그래서 라운드로 먼저 나누고(섞임 방지), 열 키를
  // harness·model·effort 로 내린다(변별이 보이게).
  // ─────────────────────────────────────────────────────────────────────
  lines.push("## 인스턴스 × 셀 (라운드별)");
  lines.push("");
  const scaffolds = [...new Set(records.map((r) => r.scaffold))];
  for (const scaffold of scaffolds) {
    const inRound = records.filter((r) => r.scaffold === scaffold);
    const colKeys = [
      ...new Set(
        inRound.map((r) =>
          [r.harness, r.model ?? "(cli default)", r.effort ?? "-"].join("|"),
        ),
      ),
    ];
    const roundInstances = [
      ...new Set(inRound.map((r) => r.instanceId)),
    ].sort();
    lines.push(`### scaffold \`${scaffold}\``);
    lines.push("");
    const header = colKeys.map((k) => {
      const [h, m, e] = k.split("|");
      const model = m === "(cli default)" ? "" : `<br>${m}`;
      const eff = e === "-" ? "" : `<br>effort=${e}`;
      return `\`${h}\`${model}${eff}`;
    });
    lines.push(`| instance | ${header.join(" | ")} |`);
    lines.push(`| --- | ${colKeys.map(() => "---").join(" | ")} |`);
    for (const inst of roundInstances) {
      const cols = colKeys.map((k) => {
        const rs = inRound.filter(
          (r) =>
            r.instanceId === inst &&
            [r.harness, r.model ?? "(cli default)", r.effort ?? "-"].join(
              "|",
            ) === k,
        );
        if (rs.length === 0) return "–";
        return rs
          .map((r) => {
            // 옛 채점기로 돈 행은 눈으로도 구분되게 표시한다(합산은 이미 막혀 있다).
            const stale = r.graderVersion ? "" : " _[구채점기]_";
            if (r.error) return `⚠ error${stale}`;
            if (!r.grade) return `–${stale}`;
            const g = r.grade;
            return (
              `${g.resolved ? "✅" : "❌"} (F2P ${g.f2pPassed}/${
                g.f2pTotal
              }, ` + `P2P ${g.p2pPassed}/${g.p2pTotal})${stale}`
            );
          })
          .join("<br>");
      });
      lines.push(`| \`${inst}\` | ${cols.join(" | ")} |`);
    }
    lines.push("");
  }

  const errored = records.filter((r) => r.error);
  if (errored.length > 0) {
    lines.push("## 채점되지 못한 런 (분모에서 빼지 않음)");
    lines.push("");
    for (const r of errored) {
      lines.push(
        `- \`${r.instanceId}\` / \`${r.harness}\` — ${r.error?.split("\n")[0]}`,
      );
    }
    lines.push("");
  }

  // ★마크다운과 구조화 산출물이 **같은 시각**을 찍는다. 각자 now() 를 부르면
  // 두 산출물의 생성일이 미세하게 어긋나 "같은 실행에서 나왔나"를 못 본다.
  lines.push(`_생성: \`npm run bench:swe:report\` · ${generatedAt}_`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// 구조화 산출물 — 앱(사용량 탭)이 읽는 소스.
//
// ★마크다운과 **같은 `summarize()` 결과**에서 나온다. 두 산출물이 다른 계산을
// 하면 그 순간 문서와 화면이 갈라지므로, 여기서 하는 일은 이름 붙이기와 반올림뿐
// 이고 집계는 하나도 다시 하지 않는다.
// ─────────────────────────────────────────────────────────────────────────

/** 여러 셀에 걸친 환경 값. 하나면 그대로, 여럿이면 **숨기지 않고** 이어 붙인다. */
function joinDistinct(values: string[]): string {
  return [...new Set(values)].join(" · ");
}

function buildOurBench(
  records: RunRecord[],
  generatedAt: string,
): OurBenchReport {
  const cells = summarize(records);
  const instanceIds = [...new Set(records.map((r) => r.instanceId))].sort();

  const outCells: OurBenchCell[] = cells.map((c) => {
    const runs = c.graded + c.errored;
    return {
      harness: c.harness as OurBenchHarness,
      // 리포트 표는 빈 모델을 "(cli default)" 로 **표시**하지만, 데이터에는 그
      // 표시 문자열을 넣지 않는다 — 화면 문구는 로케일이 정할 몫이고, 여기서
      // 굳히면 영어 UI 에서도 한국어 표를 위한 문자열이 새어 나온다.
      model: c.model === "(cli default)" ? null : c.model,
      effort: c.effort === "-" ? null : c.effort,
      graded: c.graded,
      resolved: c.resolved,
      resolvedPct: c.graded === 0 ? null : (c.resolved / c.graded) * 100,
      noOutput: c.noOutput,
      errored: c.errored,
      avgAgentSeconds:
        runs > 0 && c.totalMs > 0 ? Math.round(c.totalMs / runs / 1000) : null,
      cliVersion: c.cliVersion === "-" ? null : c.cliVersion,
      scaffold: c.scaffold,
      execEnv: c.execEnv,
      graderVersion: c.graderVersion,
    };
  });

  const instances: OurBenchInstanceRow[] = instanceIds.map((instanceId) => {
    const cellsFor: OurBenchInstanceCell[] = records
      .filter((r) => r.instanceId === instanceId)
      .map((r) => ({
        harness: r.harness as OurBenchHarness,
        // ★에러(null)와 미해결(false)을 합치지 않는다. 합치면 "채점기가 못 돌았다"
        // 가 "모델이 못 풀었다" 로 둔갑한다.
        resolved: r.error || !r.grade ? null : r.grade.resolved,
        f2pPassed: r.grade?.f2pPassed ?? 0,
        f2pTotal: r.grade?.f2pTotal ?? 0,
        p2pPassed: r.grade?.p2pPassed ?? 0,
        p2pTotal: r.grade?.p2pTotal ?? 0,
      }));
    return { instanceId, cells: cellsFor };
  });

  return {
    meta: {
      label: "our-measured",
      dataset: records[0]?.dataset ?? "(unknown)",
      instances: instanceIds,
      totalRuns: records.length,
      scaffold: joinDistinct(cells.map((c) => c.scaffold)),
      execEnv: joinDistinct(cells.map((c) => c.execEnv)),
      graderVersion: joinDistinct(cells.map((c) => c.graderVersion)),
      generatedAt,
      reportPath: "v3/docs/benchmark/generated-report.md",
      disclaimers: [...OUR_MEASURED_DISCLAIMERS],
    },
    cells: outCells,
    instances,
  };
}

/**
 * TS 리터럴 직렬화. `JSON.stringify` 를 쓰지 않는 이유는 키 따옴표 하나다 —
 * 이 저장소는 prettier 기본 설정이라 불필요한 키 따옴표를 떼는데, 생성물이 매번
 * 그 차이만큼 diff 를 내면 "생성기를 다시 돌렸다" 와 "데이터가 바뀌었다" 를
 * 리뷰에서 구분할 수 없다. 그래서 처음부터 prettier 모양으로 뽑는다.
 */
function serialize(value: unknown, indent: string): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${inner}${serialize(v, inner)},`);
    return `[\n${items.join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const items = entries.map(
    ([k, v]) => `${inner}${k}: ${serialize(v, inner)},`,
  );
  return `{\n${items.join("\n")}\n${indent}}`;
}

function emitOursModule(report: OurBenchReport, out: string): void {
  const body = [
    "// ⚠ 생성물 — 손으로 고치지 않는다.",
    "// `npm run bench:swe:emit` (= scripts/bench/report.ts --emit-ours) 가 덮어쓴다.",
    "// 정본은 실행 머신의 `results/runs.jsonl` 이고, 이 파일은 그 파생이다.",
    "// 스키마·검증·주석은 형제 파일 `model-bench-ours.ts` 에 있다.",
    "",
    'import type { OurBenchReport } from "./model-bench-ours";',
    "",
    `export const OUR_BENCH_DATA: OurBenchReport = ${serialize(report, "")};`,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  console.log(`our-bench module written to ${out}`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const root =
    get("root") ||
    process.env.MARBLO_BENCH_ROOT ||
    path.join(os.homedir(), ".marblo", "swe-bench");
  const input = get("in") || path.join(root, "results", "runs.jsonl");
  const records = loadRecords(input);
  // ★`--generated-at` 은 **백필 전용**이다. 이미 발간된 리포트(그 md 안에 생성
  // 시각이 박혀 있다)를 구조화 산출물로 다시 뽑을 때, 새 시각을 찍으면 "이 숫자를
  // 오늘 쟀다" 는 거짓이 된다. 평소엔 주지 않는다 — 그러면 지금 시각이 박힌다.
  const generatedAt = get("generated-at") || new Date().toISOString();
  const md = render(records, generatedAt);
  const out = get("out");
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md + "\n");
    console.log(`report written to ${out}`);
  } else if (!get("emit-ours")) {
    console.log(md);
  }

  // 같은 레코드에서 앱이 읽는 구조화 소스도 뽑는다(문서와 화면이 갈라질 수 없게).
  const emitOurs = get("emit-ours");
  if (emitOurs) emitOursModule(buildOurBench(records, generatedAt), emitOurs);
}

main();
