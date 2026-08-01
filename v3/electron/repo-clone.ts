import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gitSpawnEnv } from "./git-path";

/**
 * repo-clone — 팀 멤버의 "Clone & 연결" 원클릭 (티켓 r8VggohxLGciDVXV2rf6).
 *
 * 초대 수락한 멤버는 프로젝트 repo(project.gitRemoteUrl)를 자기 로컬에
 * clone 해야 코드 협업이 시작된다. 이 모듈이 그 clone 의 유일한 실행
 * 경로다 — ★완전 자동풀이 아니라 렌더러 모달의 명시적 버튼에서만 호출된다.
 *
 * 안전 설계:
 *  - URL 은 https/ssh(scp-like·ssh://) 형태만 허용(validateCloneUrl).
 *    `-` 로 시작하는 값·file://·ext:: 류는 전부 거부하고, spawn 인자도
 *    `clone -- <url> <dest>` 로 옵션 주입을 차단한다.
 *  - 대상 경로는 "부모 디렉터리(사용자 선택 or 기본 ~/Marblo) + repo 이름"
 *    으로만 조합한다. repo 이름은 URL 에서 파생해 새니타이즈하므로 임의
 *    경로 쓰기가 불가능하다. 이미 존재하는 대상은 clone 하지 않는다.
 *  - 인증 프롬프트로 영구 hang 하지 않게 GIT_TERMINAL_PROMPT=0 +
 *    ssh BatchMode 로 즉시 실패시키고, stderr 를 auth/network 등으로
 *    분류해 모달이 명확한 안내(기존 GitHub 연결/gh auth)를 띄우게 한다.
 */

/** clone 실패의 사용자-행동 가능한 분류. */
export type CloneErrorKind =
  | "invalid-url"
  | "exists"
  | "auth"
  | "not-found"
  | "network"
  | "git";

export interface CloneResult {
  ok: boolean;
  /** 성공 시 clone 된 절대 경로. */
  path?: string;
  errorKind?: CloneErrorKind;
  /** git stderr 요약(마지막 줄들) — 모달의 상세 표시용. */
  message?: string;
}

/** 대용량 repo 여유 포함 상한 — auth 는 TERMINAL_PROMPT=0 으로 즉사하므로
 * 이 타임아웃은 순수 네트워크/전송 지연에만 걸린다. */
const CLONE_TIMEOUT_MS = 10 * 60_000;

/** 기본 clone 부모 디렉터리 — 사용자가 위치를 고르지 않았을 때. */
export function defaultCloneParentDir(): string {
  return path.join(os.homedir(), "Marblo");
}

/**
 * clone 을 허용하는 remote URL 인지 검증하고 trim 된 정규형을 돌려준다.
 * 허용: https://host/path, http://host/path, ssh://[user@]host/path,
 * git@host:path (scp-like). 그 외(file://, ext::, 로컬 경로, `-` 시작,
 * 공백/개행 포함)는 전부 null — 옵션 주입·로컬 파일 접근을 차단한다.
 */
export function validateCloneUrl(
  url: string | null | undefined,
): string | null {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!s || s.length > 2048) return null;
  if (s.startsWith("-")) return null;
  if (/\s/.test(s)) return null;

  // scp-like: git@host:owner/repo
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^:]+$/.test(s)) return s;

  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  const proto = parsed.protocol;
  if (proto !== "https:" && proto !== "http:" && proto !== "ssh:") return null;
  if (!parsed.hostname) return null;
  if (!parsed.pathname || parsed.pathname === "/") return null;
  return s;
}

/**
 * URL 에서 clone 대상 폴더 이름을 파생한다. 경로 마지막 조각에서 `.git` 을
 * 떼고 `[A-Za-z0-9._-]` 밖의 문자를 `_` 로 바꾼다. 선행 `.`/`-` 는 제거해
 * 숨김 폴더·옵션 모양을 막는다. 아무것도 안 남으면 "repo".
 */
export function deriveRepoDirName(url: string): string {
  const last =
    url
      .replace(/[/:]+$/, "")
      .split(/[/:]/)
      .pop() ?? "";
  const cleaned = last
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[.-]+/, "");
  return cleaned || "repo";
}

/** git stderr → 행동 가능한 에러 분류. */
export function classifyCloneError(stderr: string): CloneErrorKind {
  const s = stderr.toLowerCase();
  if (
    s.includes("authentication failed") ||
    s.includes("could not read username") ||
    s.includes("could not read password") ||
    s.includes("permission denied") ||
    s.includes("terminal prompts disabled") ||
    s.includes("access denied") ||
    s.includes("publickey")
  ) {
    return "auth";
  }
  if (s.includes("repository not found") || s.includes("not found")) {
    return "not-found";
  }
  if (
    s.includes("could not resolve host") ||
    s.includes("unable to access") ||
    s.includes("connection timed out") ||
    s.includes("connection refused") ||
    s.includes("network is unreachable")
  ) {
    return "network";
  }
  return "git";
}

/** 테스트 주입용 git 실행기 — 실제 구현은 spawn("git", ...). */
export type GitRunner = (
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ code: number; stderr: string }>;

const realGitRunner: GitRunner = (args, { cwd, timeoutMs }) =>
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
          // 인증 프롬프트 대기로 hang 하지 않고 즉시 실패 → auth 로 분류.
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
        },
      });
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        stderr += "\nclone timed out";
        finish(1);
      }, timeoutMs);
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

/** stderr 꼬리(마지막 비어있지 않은 줄들)를 모달 표시용으로 요약. */
function summarizeStderr(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-3).join(" · ").slice(0, 500);
}

/**
 * repoUrl 을 `parentDir/<repo이름>` 에 clone 한다. 대상이 이미 있으면
 * 실행하지 않는다(exists). 절대 throw 하지 않고 CloneResult 로 돌려준다.
 */
export async function cloneRepo(
  input: { repoUrl: string; parentDir?: string | null },
  runner: GitRunner = realGitRunner,
): Promise<CloneResult> {
  const url = validateCloneUrl(input.repoUrl);
  if (!url) {
    return {
      ok: false,
      errorKind: "invalid-url",
      message: "지원하지 않는 저장소 URL 형식입니다.",
    };
  }

  const parent =
    typeof input.parentDir === "string" && input.parentDir.trim()
      ? input.parentDir
      : defaultCloneParentDir();
  if (!path.isAbsolute(parent)) {
    return {
      ok: false,
      errorKind: "invalid-url",
      message: "clone 위치는 절대 경로여야 합니다.",
    };
  }

  const dest = path.join(parent, deriveRepoDirName(url));
  if (fs.existsSync(dest)) {
    return { ok: false, errorKind: "exists", path: dest };
  }

  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      errorKind: "git",
      message: `clone 위치를 만들 수 없습니다: ${String(err)}`,
    };
  }

  const r = await runner(["clone", "--", url, dest], {
    cwd: parent,
    timeoutMs: CLONE_TIMEOUT_MS,
  });
  if (r.code === 0 && fs.existsSync(dest)) {
    return { ok: true, path: dest };
  }
  return {
    ok: false,
    errorKind: classifyCloneError(r.stderr),
    message: summarizeStderr(r.stderr),
  };
}
