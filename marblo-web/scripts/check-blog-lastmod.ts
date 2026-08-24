#!/usr/bin/env tsx
/**
 * sitemap 의 blog `lastmod` 가 사실인지 검사한다.
 *
 * 왜 필요한가
 * ───────────
 * `src/app/sitemap.ts` 는 블로그 URL 의 lastmod 로 frontmatter 의
 * `updated ?? date` 를 낸다. 즉 **사람이 손으로 적는 값**이다. 본문을 고치고
 * `updated` 를 안 적으면 사이트맵이 거짓말을 한다.
 *
 * 구글은 신뢰할 수 없다고 판단한 lastmod 를 그냥 무시한다(사이트 전체 기준).
 * 그래서 틀린 날짜는 없느니만 못하다. 2026-08-21 실측에서 실제로 어긋나 있었다
 * — 예: managing-heterogeneous-agents 는 2026-08-10 에 본문이 늘었는데 lastmod
 * 는 2026-07-05 였다(36일 오차).
 *
 * 무엇을 비교하나
 * ───────────────
 * frontmatter 의 `updated ?? date` vs **본문이 마지막으로 바뀐 커밋의 날짜**.
 * "본문" 은 frontmatter 블록(--- ... ---) 뒤쪽 전체다. frontmatter 만 고친
 * 커밋(예: `updated:` 를 채워 넣는 이 검사기용 커밋)은 본문 변경으로 세지
 * 않는다 — 그렇지 않으면 날짜를 고칠 때마다 다시 어긋나는 무한루프가 된다.
 *
 * 쓰는 법
 * ───────
 *   npm run check:lastmod          # 보고 + 어긋나면 exit 1
 *   npm run check:lastmod -- --fix # frontmatter 의 `updated` 를 실측값으로 수정
 *
 * git 이 있는 곳에서만 의미가 있다. 그래서 빌드가 아니라 별도 스크립트다
 * (Docker 빌드 컨텍스트에는 .git 이 없을 수 있고, 파일 mtime 은 체크아웃
 * 시각이라 매 배포마다 "전부 방금 바뀜" 이 되어 오히려 더 나쁘다).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BLOG_ROOT = path.join(ROOT, "content", "blog");
/** 시차·커밋 타이밍을 감안한 허용 오차(일). */
const TOLERANCE_DAYS = 1;

const fix = process.argv.includes("--fix");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/** frontmatter 블록을 뺀 본문. 파싱 실패 시 원문 전체를 본문으로 본다. */
function bodyOf(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  return end === -1 ? raw : raw.slice(end + 4);
}

/** 특정 커밋 시점의 파일 내용. 그 커밋에 파일이 없으면 null. */
function fileAt(sha: string, relPath: string): string | null {
  try {
    // `sha:path` 는 저장소 루트 기준이다. 이 스크립트는 marblo-web/ 안에서
    // 돌기 때문에 반드시 cwd 기준인 `sha:./path` 형태를 써야 한다.
    return execFileSync("git", ["show", `${sha}:./${relPath}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

type Commit = { sha: string; date: string };

function commitsFor(relPath: string): Commit[] {
  const out = git([
    "log",
    "--format=%H|%ad",
    "--date=short",
    "--follow",
    "--",
    relPath,
  ]).trim();
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [sha, date] = line.split("|");
    return { sha, date };
  });
}

/** 본문이 마지막으로 실제로 바뀐 커밋 날짜(YYYY-MM-DD). 이력이 없으면 null. */
function lastBodyChange(relPath: string): string | null {
  const commits = commitsFor(relPath);
  for (const c of commits) {
    const current = fileAt(c.sha, relPath);
    if (current === null) continue;
    const parent = fileAt(`${c.sha}^`, relPath);
    // 부모에 없다 = 이 커밋에서 추가됨 → 본문 변경으로 센다.
    if (parent === null || bodyOf(parent) !== bodyOf(current)) return c.date;
  }
  return commits.length ? commits[commits.length - 1].date : null;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function readFrontmatterField(raw: string, field: string): string | null {
  const m = raw.match(
    new RegExp(`^${field}:\\s*"?([0-9]{4}-[0-9]{2}-[0-9]{2})"?\\s*$`, "m")
  );
  return m ? m[1] : null;
}

/** frontmatter 의 `updated` 를 set. 없으면 `date` 줄 바로 뒤에 넣는다. */
function writeUpdated(absPath: string, value: string): void {
  const raw = fs.readFileSync(absPath, "utf8");
  const next = readFrontmatterField(raw, "updated")
    ? raw.replace(/^updated:.*$/m, `updated: "${value}"`)
    : raw.replace(/^(date:.*)$/m, `$1\nupdated: "${value}"`);
  fs.writeFileSync(absPath, next);
}

type Row = {
  rel: string;
  declared: string;
  actual: string;
  drift: number;
};

const drifted: Row[] = [];
let checked = 0;

for (const locale of fs.readdirSync(BLOG_ROOT).sort()) {
  const dir = path.join(BLOG_ROOT, locale);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.mdx?$/.test(file)) continue;
    const abs = path.join(dir, file);
    const rel = path.relative(ROOT, abs);
    const raw = fs.readFileSync(abs, "utf8");
    const date = readFrontmatterField(raw, "date");
    const updated = readFrontmatterField(raw, "updated");
    if (!date) {
      console.error(`✗ ${rel}: frontmatter 에 유효한 date 가 없다`);
      process.exitCode = 1;
      continue;
    }
    checked += 1;
    const declared = updated ?? date;
    const actual = lastBodyChange(rel);
    if (!actual) continue; // 아직 커밋 안 된 새 글 — 검사 대상 아님
    const drift = daysBetween(actual, declared);
    if (Math.abs(drift) > TOLERANCE_DAYS) {
      drifted.push({ rel, declared, actual, drift });
      // 본문 변경일이 발행일보다 앞설 수는 없다. 그런 경우엔 date 를 건드려야
      // 하므로 자동 수정하지 않고 보고만 한다.
      if (fix && Date.parse(actual) >= Date.parse(date)) {
        writeUpdated(abs, actual);
      }
    }
  }
}

console.log(`검사한 글: ${checked}편 (허용 오차 ±${TOLERANCE_DAYS}일)`);
if (drifted.length === 0) {
  console.log("✓ sitemap lastmod 가 전부 본문 최종 수정일과 일치한다.");
  process.exit(process.exitCode ?? 0);
}

console.log(`\n✗ lastmod 가 사실과 다른 글 ${drifted.length}편:\n`);
for (const r of drifted) {
  console.log(
    `  ${r.rel}\n    sitemap lastmod: ${r.declared}  실제 본문 수정: ${
      r.actual
    }  (${r.drift > 0 ? "+" : ""}${r.drift}일)`
  );
}
if (fix) {
  console.log(
    "\n→ --fix 로 frontmatter `updated` 를 수정했다. 다시 실행해 확인할 것."
  );
  process.exit(0);
}
console.log(
  "\n고치려면: npm run check:lastmod -- --fix\n" +
    "(틀린 lastmod 는 없느니만 못하다 — 구글은 신뢰 못 할 lastmod 를 사이트 전체에서 무시한다)"
);
process.exit(1);
