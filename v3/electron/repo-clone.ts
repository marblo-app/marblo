import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gitSpawnEnv } from "./git-path";
import { stripGitUrlCredentials } from "./git-url-safety";
import { describeXcodeCltFailure } from "./xcode-clt";

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
  | "git"
  // macOS Xcode CLT 문제 (티켓 nETj7szjEtT5prbYsg1D). raw git 에러 대신
  // "터미널에 이 명령을 실행하세요" 안내로 바꾸기 위한 별도 분류.
  | "xcode-license"
  | "xcode-missing";

export interface CloneResult {
  ok: boolean;
  /** 성공 시 clone 된 절대 경로. */
  path?: string;
  errorKind?: CloneErrorKind;
  /** git stderr 요약(마지막 줄들) — 모달의 상세 표시용. */
  message?: string;
  /**
   * 사용자가 터미널에 그대로 붙여넣어야 하는 명령(있을 때만).
   * 모달이 복사 버튼과 함께 띄운다 — 현재는 Xcode CLT 안내에서만 채워진다.
   */
  fixCommand?: string;
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
  url: string | null | undefined
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
  // Xcode CLT 문제를 **가장 먼저** 본다. 라이선스 미동의 원문은 git 이
  // 실행조차 안 된 상태라서 auth/network 로 분류하면 사용자가 엉뚱한
  // (GitHub 인증·네트워크) 곳을 파게 된다.
  const xcode = describeXcodeCltFailure(stderr);
  if (xcode) {
    return xcode.issue === "license-not-agreed"
      ? "xcode-license"
      : "xcode-missing";
  }

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

/**
 * device-flow token 을 **URL 밖에서** git 에 넘기는 환경변수를 만든다
 * (티켓 d0d0JkRd1SeGTxVRx4nQ, P0 보안).
 *
 * ★왜 URL 에 박으면 안 되나 — `git clone https://oauth2:<token>@github.com/...`
 * 는 그 URL 을 새 repo 의 `.git/config` `remote.origin.url` 에 **평문으로
 * 영구 기록**한다. 사용자가 폴더를 압축해 공유하거나 백업하면 토큰이 같이
 * 가고, 우리 앱 스스로도 `git remote get-url origin` 으로 그 값을 읽어
 * Firestore 까지 실어 날랐다.
 *
 * 대신 `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (git ≥
 * 2.31) 로 `http.<url>.extraHeader` 를 **이 프로세스에만** 주입한다.
 *  - `.git/config` 에 남지 않는다(환경변수 기반 config 는 in-memory 다).
 *    `git clone -c key=val` 은 반대로 새 repo config 에 **적히므로** 쓰지 않는다.
 *  - argv 에 안 실린다 → 같은 머신의 다른 사용자가 `ps` 로 못 본다.
 *  - URL 스코프를 `https://github.com/` 로 못박아 리다이렉트로 다른 호스트에
 *    Authorization 헤더가 따라가지 않는다.
 *
 * GitHub HTTPS 가 아니면 아무것도 주입하지 않는다(SSH·타 호스트는 기존
 * gh auth / SSH 폴백 그대로).
 *
 * @param baseEnv 이미 만들어진 spawn env — 사용자가 쓰던 GIT_CONFIG_* 가
 *        있으면 덮지 않고 그 뒤 인덱스에 이어 붙인다.
 */
export function githubTokenGitConfigEnv(
  url: string,
  token: string | null | undefined,
  baseEnv: NodeJS.ProcessEnv = {}
): Record<string, string> {
  if (!token) return {};
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com"
  ) {
    return {};
  }

  const existing = Number.parseInt(baseEnv.GIT_CONFIG_COUNT ?? "", 10);
  const start = Number.isFinite(existing) && existing > 0 ? existing : 0;
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString(
    "base64"
  );
  return {
    GIT_CONFIG_COUNT: String(start + 1),
    [`GIT_CONFIG_KEY_${start}`]: "http.https://github.com/.extraHeader",
    [`GIT_CONFIG_VALUE_${start}`]: `Authorization: Basic ${basic}`,
  };
}

function redactToken(value: string, token?: string | null): string {
  return token ? value.split(token).join("[redacted]") : value;
}

/**
 * 테스트 주입용 git 실행기 — 실제 구현은 spawn("git", ...).
 * `env` 는 spawn env 에 **덧붙일** 항목이다(크레덴셜 주입 전용).
 */
export type GitRunner = (
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> }
) => Promise<{ code: number; stderr: string }>;

/**
 * ★repo-push 가 **이 실행기를 그대로 재사용한다**(티켓 FYIyUuhJbv2cDVjgkRGf).
 * 여기에 모여 있는 것들 — `GIT_TERMINAL_PROMPT=0`(인증 프롬프트로 hang 하지
 * 않기), ssh BatchMode, 타임아웃 SIGKILL, "토큰은 자식 env 까지만" — 은 push
 * 에도 똑같이 필요하다. 두 벌을 만들면 한쪽만 고쳐진다.
 */
export const realGitRunner: GitRunner = (
  args,
  { cwd, timeoutMs, env: extraEnv }
) =>
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
          // 토큰은 여기(자식 프로세스 env)까지만 간다 — argv 에도,
          // clone 된 repo 의 .git/config 에도 남지 않는다.
          ...extraEnv,
        },
      });
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        stderr += "\ngit command timed out";
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
function summarizeStderr(stderr: string, token?: string | null): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return redactToken(lines.slice(-3).join(" · ").slice(0, 500), token);
}

/**
 * repoUrl 을 `parentDir/<repo이름>` 에 clone 한다. 대상이 이미 있으면
 * 실행하지 않는다(exists). 절대 throw 하지 않고 CloneResult 로 돌려준다.
 */
export async function cloneRepo(
  input: {
    repoUrl: string;
    parentDir?: string | null;
    githubToken?: string | null;
  },
  runner: GitRunner = realGitRunner
): Promise<CloneResult> {
  // ★들어온 URL 자체가 이미 오염돼 있을 수 있다 — 구버전이 Firestore 에
  // 적어둔 토큰 URL, 사용자가 수동입력에 붙여넣은 토큰 URL. 그대로 clone
  // 하면 남의 토큰을 다시 .git/config 에 새로 심는다. 검증 전에 벗긴다.
  const url = validateCloneUrl(
    typeof input.repoUrl === "string"
      ? stripGitUrlCredentials(input.repoUrl.trim())
      : input.repoUrl
  );
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

  // URL 은 크레덴셜 없는 값 그대로 넘기고, 토큰은 env 로만 준다.
  const r = await runner(["clone", "--", url, dest], {
    cwd: parent,
    timeoutMs: CLONE_TIMEOUT_MS,
    env: githubTokenGitConfigEnv(url, input.githubToken, gitSpawnEnv()),
  });
  if (r.code === 0 && fs.existsSync(dest)) {
    return { ok: true, path: dest };
  }
  const errorKind = classifyCloneError(r.stderr);
  // Xcode CLT 문제면 stderr 원문 대신 "무엇을 실행하면 되는지" 만 남긴다.
  const xcode = describeXcodeCltFailure(r.stderr);
  if (xcode) {
    return {
      ok: false,
      errorKind,
      message: xcode.message,
      fixCommand: xcode.command,
    };
  }
  return {
    ok: false,
    errorKind,
    // GitHub는 권한이 없는 private repo도 404로 숨긴다. raw git 오류는
    // 토큰을 포함할 수 있으므로 노출하지 않고 다음 행동만 안내한다.
    message:
      errorKind === "not-found" && !!input.githubToken
        ? "저장소 접근 권한이 없습니다. 오너에게 콜라보레이터 추가를 요청하세요."
        : summarizeStderr(r.stderr, input.githubToken),
  };
}
