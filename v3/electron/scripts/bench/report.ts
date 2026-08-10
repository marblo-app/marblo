/**
 * 결과 JSONL → 마크다운 표.
 *
 * ★이 생성기가 강제하는 정직성 규칙 (공개 벤치 방법론 PR#25 상속):
 *   1. `label !== "our-measured"` 인 행은 **거부**한다. 벤더 공개치가 실수로
 *      같은 파일에 섞여도 표에 오르지 못한다.
 *   2. 모든 표에 **n 을 인쇄**한다. n 없는 비율은 찍지 않는다.
 *   3. `scaffold` / `execEnv` 를 표 위에 명시한다 — 이 둘 없이는 점수가
 *      해석 불가하고, 특히 execEnv 가 공식 Docker 가 아님을 숨길 수 없게 한다.
 *   4. 에러로 채점 못 한 런은 **분모에서 빼지 않고** `error` 로 따로 센다.
 *      조용히 빼면 실패를 지운 표가 된다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { RunRecord } from "./types";

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

function render(records: RunRecord[]): string {
  const cells = summarize(records);
  const instances = [...new Set(records.map((r) => r.instanceId))].sort();
  const dataset = records[0]?.dataset ?? "(unknown)";
  const lines: string[] = [];

  lines.push("# SWE-bench — Marblo 자체 실측 (our-measured)");
  lines.push("");
  lines.push(
    "> ★이 표의 숫자는 **우리가 우리 스폰 경로로 직접 잰 값**이다. " +
      "벤더 공개치(`electron/model-bench-reference.ts`)와 **같은 표에 놓지 않는다**.",
  );
  lines.push(
    "> ★실행환경이 공식 SWE-bench Docker 이미지가 아니므로 **공식 리더보드 수치와 비교할 수 없다.** " +
      "여기서 읽어도 되는 것은 *같은 execEnv·같은 scaffold 안에서의 상대 비교*뿐이다.",
  );
  lines.push("");
  lines.push(`- 데이터셋: \`${dataset}\``);
  lines.push(
    `- 인스턴스(고정 N=${instances.length}): ${instances.map((i) => `\`${i}\``).join(", ")}`,
  );
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
        `**${pct(c.resolved, c.graded)}** | ${c.noOutput} | ${c.errored} | ${avg} |`,
    );
  }
  lines.push("");
  for (const c of cells) {
    lines.push(
      `- \`${c.harness}\` scaffold=\`${c.scaffold}\` execEnv=\`${c.execEnv}\` ` +
        `grader=\`${c.graderVersion}\` cli=\`${c.cliVersion}\``,
    );
  }
  lines.push("");

  lines.push("## 인스턴스 × 하네스");
  lines.push("");
  const harnesses = [...new Set(records.map((r) => r.harness))];
  lines.push(`| instance | ${harnesses.join(" | ")} |`);
  lines.push(`| --- | ${harnesses.map(() => "---").join(" | ")} |`);
  for (const inst of instances) {
    const cols = harnesses.map((h) => {
      const rs = records.filter(
        (r) => r.instanceId === inst && r.harness === h,
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
            `${g.resolved ? "✅" : "❌"} (F2P ${g.f2pPassed}/${g.f2pTotal}, ` +
            `P2P ${g.p2pPassed}/${g.p2pTotal})${stale}`
          );
        })
        .join("<br>");
    });
    lines.push(`| \`${inst}\` | ${cols.join(" | ")} |`);
  }
  lines.push("");

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

  lines.push(
    `_생성: \`npm run bench:swe:report\` · ${new Date().toISOString()}_`,
  );
  return lines.join("\n");
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
  const md = render(loadRecords(input));
  const out = get("out");
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md + "\n");
    console.log(`report written to ${out}`);
  } else {
    console.log(md);
  }
}

main();
