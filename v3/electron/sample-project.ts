import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { gitSpawnEnv } from "./git-path";

/**
 * sample-project — 첫 실행에 연결할 "진짜 파일이 있는" 미니 프로젝트를 만든다
 * (티켓 yk8ouW2pS6nGzH272rXy).
 *
 * ── 왜 (제로셋업) ────────────────────────────────────────────────────────────
 * 지금까지 신규 유저는 **폴더를 고르기 전까지 오케스트레이터를 볼 수 없었다**.
 * 오케 자동기동은 `currentProject.folderPath` 를 키로 하는데 첫 실행에는 그
 * 값이 없다. 그래서 "설치 → 로그인 → 폴더 선택" 세 관문을 다 넘어야 제품이
 * 처음 움직인다. 이 모듈은 마지막 관문을 없앤다.
 *
 * ── 왜 빈 폴더가 아닌가 ──────────────────────────────────────────────────────
 * 빈 폴더를 자동 연결하면 오케는 열리지만 첫 지시가 아무 결과도 못 낸다
 * ("README 읽고 가이드 써줘" → 읽을 README 가 없다). 그건 열린 화면일 뿐
 * 첫 성공이 아니다. 그래서 의존성 0 · 시크릿 0 · MIT 인 진짜 미니 프로젝트를
 * 시드한다 — `node --test` 만으로 돌아가므로 npm install 도 필요 없고,
 * `src/format.js` 는 **일부러 테스트가 없어** "테스트 추가" 지시에 명확한
 * 대상이 있다.
 *
 * ── 왜 런타임 생성인가(번들 아님) ────────────────────────────────────────────
 * 에셋을 앱에 번들하려면 electron-builder `extraResources` + `process.resourcesPath`
 * 해석이 필요하고, dev(asar 아님)와 패키지(asar 옆 Resources/)에서 경로가 갈린다.
 * 실제로 이 저장소는 그 경로 드리프트로 이미 여러 번 물렸다(dist-mcp / firebase-config).
 * 샘플은 수 KB 텍스트뿐이라 상수로 들고 런타임에 쓰는 편이 빌드 설정 변경 0,
 * dev/패키지 동작 동일, 테스트도 tmpdir 로 그대로 가능하다.
 *
 * ── 안전 ─────────────────────────────────────────────────────────────────────
 * - **절대 clobber 하지 않는다.** 대상 폴더가 이미 있고 비어 있지 않으면 한 바이트도
 *   쓰지 않고 그대로 재사용한다. 빈 폴더일 때만 그 안에 시드한다.
 * - 파일 쓰기는 `wx`(존재하면 실패) 플래그 — 경합으로 뒤늦게 생긴 파일도 덮지 않는다.
 * - git 실패는 fail-soft: 폴더는 여전히 연결 가능한 상태로 돌려준다(gitInitialized=false).
 *   Marblo 워크트리는 git 을 요구하므로 실패 사실은 결과에 그대로 싣는다.
 */

/** 시드 폴더 이름 — 사용자가 Finder 에서 알아볼 수 있게 제품명을 그대로 쓴다. */
export const SAMPLE_DIR_NAME = "Marblo Sample";

export type SampleLocale = "ko" | "en";

export interface SampleFile {
  /** 폴더 기준 상대 경로(POSIX 구분자). */
  path: string;
  content: string;
}

export interface EnsureSampleResult {
  ok: boolean;
  /** 연결 대상 절대 경로. ok=false 여도 무엇을 시도했는지 알 수 있게 채운다. */
  path: string;
  /** 이번 호출이 파일을 썼는가. */
  created: boolean;
  /** 이미 있던 폴더를 손대지 않고 재사용했는가. */
  reused: boolean;
  /** `.git` 이 있는가(이번에 만들었든, 원래 있었든). */
  gitInitialized: boolean;
  /** ok=false 일 때의 사유. 사용자 경로를 그대로 노출하지 않는 짧은 요약. */
  error?: string;
}

/**
 * 시드 위치를 정한다: `<Documents>/Marblo Sample`.
 *
 * Documents 를 못 얻는 환경(일부 Linux, 포터블 실행)에서는 홈 바로 아래로
 * 떨어뜨린다 — 존재하지 않는 부모에 mkdir -p 로 파고드는 것보다, 사용자가
 * 확실히 찾을 수 있는 위치가 낫다.
 */
export function resolveSampleProjectDir(opts: {
  documentsDir?: string | null;
  homeDir: string;
}): string {
  const base =
    typeof opts.documentsDir === "string" && opts.documentsDir.trim()
      ? opts.documentsDir
      : opts.homeDir;
  return path.join(base, SAMPLE_DIR_NAME);
}

/**
 * 폴더가 "이미 쓰이고 있는" 상태인지. `.DS_Store` 같은 OS 부산물만 있는 폴더는
 * 비어 있는 것으로 본다 — Finder 로 한 번 열어본 것이 시드를 막으면 안 된다.
 */
export function isEffectivelyEmpty(entries: string[]): boolean {
  const IGNORED = new Set([".DS_Store", "Thumbs.db", ".localized"]);
  return entries.every((e) => IGNORED.has(e));
}

const LICENSE = `MIT License

Copyright (c) Marblo Sample

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const README_KO = `# Marblo Sample — 할 일 목록

Marblo 가 첫 실행에서 만든 **연습용 미니 프로젝트**입니다.
설치할 패키지도, 계정도 없습니다 — Node.js 만 있으면 바로 돌아갑니다.

## 들어 있는 것

| 파일 | 하는 일 |
| --- | --- |
| \`src/todo.js\` | 할 일 목록 핵심 로직 — 추가 · 완료 · 삭제 · 통계 |
| \`src/format.js\` | 목록을 읽기 좋은 텍스트로 바꾸는 포매터 (**테스트 없음**) |
| \`src/demo.js\` | 위 둘을 엮어 한 번 출력해 보는 실행 예제 |
| \`test/todo.test.js\` | \`src/todo.js\` 테스트 (Node 내장 러너) |

## 실행

\`\`\`bash
node --test        # 테스트 실행 — npm install 불필요
node src/demo.js   # 데모 출력 보기
\`\`\`

## 오케스트레이터에게 시켜볼 것

- \`README 읽고 이 프로젝트 사용 가이드 써줘\`
- \`src/format.js 에 테스트 추가해줘\` — 여기만 테스트가 비어 있습니다
- \`이 프로젝트 구조를 설명해줘\`

## 내 저장소로 바꾸려면

사이드바의 **폴더 열기**로 언제든 실제 저장소를 연결할 수 있습니다.
이 샘플 폴더는 지워지지 않고 그대로 남습니다.

## 라이선스

MIT — \`LICENSE\` 참고. 시크릿이나 외부 의존성은 하나도 없습니다.
`;

const README_EN = `# Marblo Sample — To-do List

A small practice project Marblo created on first run.
Nothing to install and no account needed — Node.js alone runs it.

## What's inside

| File | What it does |
| --- | --- |
| \`src/todo.js\` | The to-do list itself — add, complete, remove, stats |
| \`src/format.js\` | Renders a list as readable text (**no tests yet**) |
| \`src/demo.js\` | Wires both together and prints one run |
| \`test/todo.test.js\` | Tests for \`src/todo.js\` (Node's built-in runner) |

## Run it

\`\`\`bash
node --test        # run the tests — no npm install
node src/demo.js   # see the demo output
\`\`\`

## Things to ask the orchestrator

- \`Read the README and write a usage guide\`
- \`Add tests for src/format.js\` — it's the one file without any
- \`Explain how this project is structured\`

## Switching to your own repo

Use **Open Folder** in the sidebar to connect a real repository at any time.
This sample folder is left untouched.

## License

MIT — see \`LICENSE\`. No secrets, no external dependencies.
`;

const PACKAGE_JSON = `{
  "name": "marblo-sample",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "description": "A dependency-free to-do list used as Marblo's first-run sample project.",
  "scripts": {
    "test": "node --test"
  }
}
`;

const GITIGNORE = `node_modules/
.DS_Store
*.log
`;

const TODO_JS = `/**
 * A tiny to-do list. No dependencies, no I/O — just the rules, so it is easy
 * to read, easy to test, and safe to change.
 */

/** Allowed priorities, lowest first. */
export const PRIORITIES = ["low", "normal", "high"];

export class TodoList {
  /** @param {Array<{id:number,title:string,priority:string,done:boolean}>} items */
  constructor(items = []) {
    this.items = items.map((item) => ({ ...item }));
    this.nextId =
      this.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  }

  /**
   * Add a to-do and return it. Titles are trimmed; a blank title is a bug in
   * the caller, so it throws rather than silently storing an unnameable row.
   */
  add(title, { priority = "normal" } = {}) {
    const clean = String(title ?? "").trim();
    if (!clean) throw new Error("a to-do needs a title");
    if (!PRIORITIES.includes(priority)) {
      throw new Error(\`unknown priority: \${priority}\`);
    }
    const item = { id: this.nextId++, title: clean, priority, done: false };
    this.items.push(item);
    return item;
  }

  /** @returns {object|undefined} */
  find(id) {
    return this.items.find((item) => item.id === id);
  }

  /** Mark one done. Returns false when there is no such id. */
  complete(id) {
    const item = this.find(id);
    if (!item || item.done) return false;
    item.done = true;
    return true;
  }

  /** Remove one. Returns false when there is no such id. */
  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    return this.items.length < before;
  }

  /** Everything still open, highest priority first. */
  pending() {
    return this.items
      .filter((item) => !item.done)
      .sort(
        (a, b) =>
          PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority),
      );
  }

  stats() {
    const done = this.items.filter((item) => item.done).length;
    const byPriority = {};
    for (const name of PRIORITIES) {
      byPriority[name] = this.items.filter(
        (item) => item.priority === name,
      ).length;
    }
    return {
      total: this.items.length,
      done,
      pending: this.items.length - done,
      byPriority,
    };
  }
}
`;

const FORMAT_JS = `/**
 * Turns a to-do list into text a human can read.
 *
 * NOTE: this file has no tests yet — a good first task to hand an agent.
 */

const MARKS = { low: ".", normal: "-", high: "!" };

/** One line per item: \`[x] ! #3 Ship the thing\`. */
export function formatTodoLine(item) {
  const box = item.done ? "[x]" : "[ ]";
  const mark = MARKS[item.priority] ?? "-";
  return \`\${box} \${mark} #\${item.id} \${item.title}\`;
}

/** The whole list, newest last. Empty lists say so instead of rendering "". */
export function formatList(items) {
  if (items.length === 0) return "(nothing to do)";
  return items.map(formatTodoLine).join("\\n");
}

/** A one-line tail: \`2/5 done - 3 left (high: 1)\`. */
export function formatSummary(stats) {
  const high = stats.byPriority.high ?? 0;
  const tail = high > 0 ? \` (high: \${high})\` : "";
  return \`\${stats.done}/\${stats.total} done - \${stats.pending} left\${tail}\`;
}
`;

const DEMO_JS = `import { TodoList } from "./todo.js";
import { formatList, formatSummary } from "./format.js";

const list = new TodoList();
list.add("Read the README", { priority: "high" });
list.add("Run the tests");
const chore = list.add("Water the plants", { priority: "low" });

list.complete(chore.id);

console.log(formatList(list.items));
console.log("");
console.log(formatSummary(list.stats()));
`;

const TODO_TEST_JS = `import test from "node:test";
import assert from "node:assert/strict";
import { TodoList } from "../src/todo.js";

test("add stores a trimmed, open item and hands back an id", () => {
  const list = new TodoList();
  const item = list.add("  buy milk  ");

  assert.equal(item.title, "buy milk");
  assert.equal(item.done, false);
  assert.equal(item.priority, "normal");
  assert.equal(list.find(item.id), item);
});

test("add rejects a blank title", () => {
  const list = new TodoList();
  assert.throws(() => list.add("   "), /needs a title/);
});

test("add rejects an unknown priority", () => {
  const list = new TodoList();
  assert.throws(() => list.add("x", { priority: "urgent" }), /unknown priority/);
});

test("complete is idempotent and reports whether it changed anything", () => {
  const list = new TodoList();
  const item = list.add("write tests");

  assert.equal(list.complete(item.id), true);
  assert.equal(list.complete(item.id), false, "already done");
  assert.equal(list.complete(999), false, "no such id");
});

test("remove drops the item and reports whether it existed", () => {
  const list = new TodoList();
  const item = list.add("temporary");

  assert.equal(list.remove(item.id), true);
  assert.equal(list.remove(item.id), false);
  assert.equal(list.items.length, 0);
});

test("pending hides done items and puts high priority first", () => {
  const list = new TodoList();
  list.add("low one", { priority: "low" });
  const mid = list.add("normal one");
  list.add("high one", { priority: "high" });
  list.complete(mid.id);

  assert.deepEqual(
    list.pending().map((item) => item.title),
    ["high one", "low one"],
  );
});

test("stats counts totals and priorities", () => {
  const list = new TodoList();
  list.add("a", { priority: "high" });
  const b = list.add("b");
  list.complete(b.id);

  assert.deepEqual(list.stats(), {
    total: 2,
    done: 1,
    pending: 1,
    byPriority: { low: 0, normal: 1, high: 1 },
  });
});

test("ids keep counting up from a restored list", () => {
  const list = new TodoList([
    { id: 7, title: "restored", priority: "normal", done: false },
  ]);

  assert.equal(list.add("next").id, 8);
});
`;

/** 시드할 파일 목록. README 만 로케일을 탄다 — 코드/주석은 영어 하나로 유지한다. */
export function sampleProjectFiles(locale: SampleLocale = "ko"): SampleFile[] {
  return [
    { path: "README.md", content: locale === "en" ? README_EN : README_KO },
    { path: "LICENSE", content: LICENSE },
    { path: "package.json", content: PACKAGE_JSON },
    { path: ".gitignore", content: GITIGNORE },
    { path: "src/todo.js", content: TODO_JS },
    { path: "src/format.js", content: FORMAT_JS },
    { path: "src/demo.js", content: DEMO_JS },
    { path: "test/todo.test.js", content: TODO_TEST_JS },
  ];
}

/** 테스트 주입용 git 실행기 — repo-clone.ts 와 같은 모양. */
export type SampleGitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ code: number; stderr: string }>;

const GIT_TIMEOUT_MS = 30_000;

const realGitRunner: SampleGitRunner = (args, { cwd }) =>
  new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stderr });
    };
    try {
      const proc = spawn("git", args, {
        cwd,
        env: {
          ...gitSpawnEnv(),
          // 로컬 init/commit 뿐이라 네트워크·인증이 없어야 정상이다. 그래도
          // 훅이나 오설정으로 프롬프트가 뜨면 영구 hang 이므로 즉시 실패시킨다.
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        stderr += "\ngit timed out";
        finish(1);
      }, GIT_TIMEOUT_MS);
      timer.unref?.();
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => finish(code ?? 1));
      proc.on("error", (err) => {
        stderr += String(err);
        finish(1);
      });
    } catch (err) {
      stderr += String(err);
      finish(1);
    }
  });

/**
 * `dir` 을 git 저장소로 만들고 첫 커밋을 남긴다.
 *
 * Marblo 는 태스크마다 git 워크트리를 뜨는데 `git worktree add` 는 커밋이 하나도
 * 없는 저장소에서 실패한다. 그래서 init 만으로는 부족하고 첫 커밋까지가 한 단위다.
 *
 * 커밋 아이덴티티는 **먼저 사용자 설정 그대로** 시도하고, 그게 없어서 실패할
 * 때만 Marblo 기본값으로 재시도한다 — 전역 설정이 있는 사용자의 저장소에
 * 우리 이름을 굳이 새기지 않기 위해서다.
 */
async function initGitRepo(
  dir: string,
  git: SampleGitRunner,
): Promise<{ ok: boolean; stderr: string }> {
  // 기본 브랜치를 main 으로 고정. `-b` 는 git 2.28+ 이므로 실패하면 평범한 init.
  let r = await git(["init", "-b", "main"], { cwd: dir });
  if (r.code !== 0) {
    r = await git(["init"], { cwd: dir });
    if (r.code !== 0) return { ok: false, stderr: r.stderr };
  }

  r = await git(["add", "-A"], { cwd: dir });
  if (r.code !== 0) return { ok: false, stderr: r.stderr };

  const commitArgs = [
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Initial commit",
  ];
  r = await git(commitArgs, { cwd: dir });
  if (r.code === 0) return { ok: true, stderr: "" };

  // 전역 user.name/user.email 이 없는 새 머신 — 여기서만 기본값을 얹는다.
  r = await git(
    [
      "-c",
      "user.name=Marblo",
      "-c",
      "user.email=sample@marblo.app",
      ...commitArgs,
    ],
    { cwd: dir },
  );
  return { ok: r.code === 0, stderr: r.stderr };
}

export interface EnsureSampleOptions {
  /** 시드 대상 절대 경로 (resolveSampleProjectDir 결과). */
  dir: string;
  locale?: SampleLocale;
  git?: SampleGitRunner;
}

/**
 * 샘플 프로젝트가 `dir` 에 존재하도록 보장한다. 절대 throw 하지 않는다.
 *
 * - 이미 내용이 있는 폴더  → 손대지 않고 재사용(reused).
 * - 없거나 사실상 빈 폴더  → 파일 시드 + git init + 첫 커밋(created).
 */
export async function ensureSampleProject(
  opts: EnsureSampleOptions,
): Promise<EnsureSampleResult> {
  const dir = opts.dir;
  const git = opts.git ?? realGitRunner;
  const base: Omit<EnsureSampleResult, "ok"> = {
    path: dir,
    created: false,
    reused: false,
    gitInitialized: false,
  };

  if (!path.isAbsolute(dir)) {
    return { ...base, ok: false, error: "sample path must be absolute" };
  }

  try {
    const stat = fs.existsSync(dir) ? fs.statSync(dir) : null;
    if (stat && !stat.isDirectory()) {
      return { ...base, ok: false, error: "sample path is not a directory" };
    }
    if (stat && !isEffectivelyEmpty(fs.readdirSync(dir))) {
      // ★clobber 금지 — 사용자가 이 폴더를 실제 작업에 쓰고 있을 수 있다.
      return {
        ...base,
        ok: true,
        reused: true,
        gitInitialized: fs.existsSync(path.join(dir, ".git")),
      };
    }

    fs.mkdirSync(dir, { recursive: true });
    for (const file of sampleProjectFiles(opts.locale)) {
      const target = path.join(dir, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        // wx: 이미 있으면 쓰지 않는다(경합·부분 시드 복구 시 기존 내용 보존).
        fs.writeFileSync(target, file.content, { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: `failed to create the sample project: ${String(err)}`,
    };
  }

  const gitResult = await initGitRepo(dir, git);
  if (!gitResult.ok) {
    // fail-soft: 폴더는 연결 가능하다. 워크트리 기반 기능만 뒤에서 막히므로
    // 사실만 실어 보내고 연결 자체를 취소하지는 않는다.
    console.warn(
      "[sample-project] git init/commit failed (non-fatal):",
      gitResult.stderr.slice(-300),
    );
  }

  return {
    ...base,
    ok: true,
    created: true,
    gitInitialized: gitResult.ok,
  };
}
