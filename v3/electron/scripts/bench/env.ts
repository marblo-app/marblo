/**
 * Docker 없는 인스턴스 실행환경.
 *
 * 공식 SWE-bench 는 인스턴스마다 구운 Docker 이미지에서 채점한다. 이 Mac 에는
 * 컨테이너 런타임이 하나도 없어서(2026-08-10 실측: docker/podman/colima/lima
 * 전부 없음) 그 경로가 막혀 있다. 그래서 여기서는
 *
 *   bare 캐시 클론 → base_commit 워크트리 → 네이티브 venv → `pip install -e .`
 *
 * 로 환경을 세운다. **이건 공식 환경의 대체물이 아니라 다른 환경이다.**
 * 그 사실은 `EXEC_ENV_ID` 로 모든 결과 행에 박히고 리포트 첫 화면에 나온다.
 */
import fs from "fs";
import path from "path";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import type { RepoSpec } from "./types";
import { repoCloneUrl } from "./manifest";

/** 로그가 커도 잘리지 않게. 잘린 로그는 조용한 오채점으로 이어진다. */
const MAX_BUFFER = 64 * 1024 * 1024;

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function exec(
  command: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    input?: string;
  } = {},
): ExecResult {
  const r: SpawnSyncReturns<string> = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
    timeout: opts.timeoutMs,
    input: opts.input,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    // spawnSync 는 타임아웃 시 signal 을 채운다(status 는 null).
    timedOut: r.signal === "SIGTERM" && r.status === null,
  };
}

function must(label: string, r: ExecResult): void {
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout).split("\n").slice(-20).join("\n");
    throw new Error(`${label} failed (exit ${r.status})\n${tail}`);
  }
}

/**
 * 레포별 bare 캐시. `--filter=blob:none` 부분 클론이라 django 기준 69MB 로
 * 끝나고, 인스턴스마다 다시 받지 않는다.
 */
export function ensureBareRepo(repo: string, cacheDir: string): string {
  const dest = path.join(cacheDir, `${repo.replace("/", "__")}.git`);
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(cacheDir, { recursive: true });
  must(
    `clone ${repo}`,
    exec("git", [
      "clone",
      "--bare",
      "--filter=blob:none",
      repoCloneUrl(repo),
      dest,
    ]),
  );
  return dest;
}

/** 워크트리 생성. 실패하면 던진다 — 조용히 빈 디렉터리로 진행하면 안 된다. */
export function addWorktree(bareRepo: string, sha: string, dest: string): void {
  // 존재 확인을 먼저 한다. `not our ref` 는 SHA 가 틀렸다는 뜻이고, 그 경우
  // 원인이 "네트워크"가 아니라 "잘못된 SHA"임을 분명히 말해줘야 한다.
  const probe = exec("git", ["-C", bareRepo, "cat-file", "-t", sha]);
  if (probe.status !== 0 || probe.stdout.trim() !== "commit") {
    throw new Error(
      `commit ${sha} not found in ${bareRepo}. ` +
        `데이터셋에서 읽은 SHA 가 맞는지 확인할 것(손으로 적은 값이면 그게 원인이다).`,
    );
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  must(
    "git worktree add",
    exec("git", ["-C", bareRepo, "worktree", "add", "--detach", dest, sha]),
  );
}

export function removeWorktree(bareRepo: string, dest: string): void {
  exec("git", ["-C", bareRepo, "worktree", "remove", "--force", dest]);
  exec("git", ["-C", bareRepo, "worktree", "prune"]);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
}

/**
 * 빌드 산출물을 git 이 안 보게 한다. 이게 없으면 `*.egg-info` 같은 설치
 * 부산물이 "에이전트가 만든 패치"로 잡혀서 무산출 판정이 오염된다.
 * `.git/info/exclude` 는 레포 파일이 아니라 로컬 설정이라 diff 에 안 남는다.
 */
function excludeBuildArtifacts(repoDir: string): void {
  const gitDir = exec("git", ["-C", repoDir, "rev-parse", "--git-common-dir"]);
  if (gitDir.status !== 0) return;
  let dir = gitDir.stdout.trim();
  if (!path.isAbsolute(dir)) dir = path.resolve(repoDir, dir);
  const infoDir = path.join(dir, "info");
  fs.mkdirSync(infoDir, { recursive: true });
  fs.writeFileSync(
    path.join(infoDir, "exclude"),
    [
      "*.egg-info/",
      "*.egg-info",
      "__pycache__/",
      "*.pyc",
      ".venv/",
      "venv/",
      "",
    ].join("\n"),
  );
}

/** venv 생성 + 레포 설치. venv 는 레포 **밖**에 둔다(diff 오염 방지). */
export function setupPythonEnv(
  spec: RepoSpec,
  repoDir: string,
  venvDir: string,
  timeoutMs: number,
): string {
  must(
    `${spec.python} -m venv`,
    exec(spec.python, ["-m", "venv", venvDir], { timeoutMs }),
  );
  const pip = path.join(venvDir, "bin", "pip");
  must(
    "pip install",
    exec(pip, [...spec.installArgs], { cwd: repoDir, timeoutMs }),
  );
  excludeBuildArtifacts(repoDir);
  return path.join(venvDir, "bin", "python");
}

/** `git apply` 로 패치 적용. 실패는 던진다(적용 안 된 패치를 채점하면 안 된다). */
export function applyPatch(
  repoDir: string,
  patch: string,
  label: string,
): void {
  const r = exec("git", ["-C", repoDir, "apply", "-"], { input: patch });
  if (r.status !== 0) {
    // 공백 문제로만 실패하는 경우가 흔해 한 번 완화해서 재시도한다.
    const relaxed = exec(
      "git",
      ["-C", repoDir, "apply", "--ignore-whitespace", "-"],
      { input: patch },
    );
    if (relaxed.status !== 0) {
      throw new Error(
        `${label} patch did not apply\n${(r.stderr || r.stdout).slice(-1500)}`,
      );
    }
  }
}

/**
 * 에이전트가 만든 diff 를 뜬다.
 *
 * ★`git diff` 만 쓰면 **새로 만든 파일이 빠진다**(untracked). 그러면 실제로는
 * 일을 한 런이 "무산출"로 잘못 기록된다. 그래서 `add -A` 로 스테이징한 뒤
 * `diff --cached` 를 뜨고, 곧바로 인덱스를 되돌린다.
 */
export function captureWorkingPatch(repoDir: string): string {
  must("git add -A", exec("git", ["-C", repoDir, "add", "-A"]));
  const diff = exec("git", ["-C", repoDir, "diff", "--cached", "--binary"]);
  exec("git", ["-C", repoDir, "reset"]);
  if (diff.status !== 0) return "";
  return diff.stdout;
}

/**
 * 테스트 파일을 base_commit 상태로 되돌린다.
 * ★에이전트가 테스트를 고쳐서 이기는 경로를 막는 필수 단계다.
 */
export function restoreTestFiles(
  repoDir: string,
  baseCommit: string,
  testFiles: string[],
): void {
  if (testFiles.length === 0) return;
  // 새로 생기는 테스트 파일은 base 에 없어서 checkout 이 실패할 수 있다 —
  // 파일 단위로 돌려 존재하는 것만 되돌린다.
  for (const f of testFiles) {
    exec("git", ["-C", repoDir, "checkout", baseCommit, "--", f]);
  }
}

/**
 * 워크트리를 base 커밋 상태로 되돌린다(추적 파일 되돌리기 + 미추적 파일 제거).
 *
 * ★프로바이더 실패(429) 재시도 전에만 부른다. 앞 시도가 남긴 편집이 다음 시도에
 * 섞이면 "무엇을 잰 것인가" 가 흐려진다 — 두 시도의 산출물이 합쳐진 diff 를
 * 채점하게 되기 때문이다. venv 는 건드리지 않는다(레포 밖에 있다).
 */
export function resetWorktree(repoDir: string, baseCommit: string): void {
  exec("git", ["-C", repoDir, "checkout", "-f", baseCommit, "--", "."]);
  // `-e` 없이 지우면 .gitignore 된 빌드 산출물까지 날아가 재설치가 필요해진다.
  exec("git", ["-C", repoDir, "clean", "-fd", "-e", "*.egg-info"]);
}

/** 테스트 러너 실행. 로그 전문을 돌려준다(파싱은 호출자 몫). */
export function runTests(
  spec: RepoSpec,
  repoDir: string,
  pythonBin: string,
  directives: string[],
  timeoutMs: number,
): ExecResult {
  const cwd = path.join(repoDir, spec.testCwd);
  return exec(pythonBin, spec.testArgs(directives), {
    cwd,
    timeoutMs,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}
