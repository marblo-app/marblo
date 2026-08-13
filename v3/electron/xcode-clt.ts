import { spawn } from "node:child_process";
import { gitSpawnEnv } from "./git-path";

/**
 * xcode-clt — macOS Xcode Command Line Tools 문제를 git 실패에서 감지하고
 * 사람이 따라할 수 있는 한 줄 안내로 바꾼다 (티켓 nETj7szjEtT5prbYsg1D).
 *
 * 왜 필요한가: macOS 의 `/usr/bin/git` 은 실제 git 이 아니라 xcrun shim 이다.
 * CLT 라이선스에 동의하지 않았거나 CLT 자체가 없으면 **모든** git 호출이
 * (심지어 `git --version` 조차) 아래 같은 원문 에러로 죽는다:
 *
 *   You have not agreed to the Xcode license agreements, please run
 *   'sudo xcodebuild -license' from within a Terminal window to review
 *   and agree to the Xcode license agreements.
 *
 *   xcrun: error: invalid active developer path
 *   (/Library/Developer/CommandLineTools), missing xcrun at: ...
 *
 * 콜드 테스트에서 초대 수락 → 연결 → GitHub 연결까지 온 사용자가 이 원문을
 * 그대로 맞고 막혔다. 앱이 대신 고쳐줄 수는 없다(`sudo` 가 필요해 관리자
 * 비밀번호를 물어야 한다) — 그래서 목표는 **명확한 수동 안내**다: 무엇이
 * 문제인지 + 터미널에 그대로 붙여넣을 명령 한 줄.
 *
 * 이 모듈은 electron/app 의존이 없는 순수 로직 + 얇은 probe 라서
 * tests/unit 에서 그대로 import 해 문자열 매칭을 검증한다.
 */

/** 사용자 행동이 갈리는 두 가지 상태. */
export type XcodeCltIssue = "license-not-agreed" | "clt-missing";

export interface XcodeCltGuidance {
  issue: XcodeCltIssue;
  /** 터미널에 그대로 붙여넣을 명령 — 렌더러의 복사 버튼이 이 값을 쓴다. */
  command: string;
  /** 한 줄 요약(배지/제목용). */
  title: string;
  /** 메인 프로세스 표면(연결 점검 detail, git 에러 대체문)용 한국어 안내. */
  message: string;
}

/** 라이선스 미동의는 `sudo` 가 필요해 앱이 대신 실행할 수 없다. */
export const XCODE_LICENSE_COMMAND = "sudo xcodebuild -license accept";
/** CLT 미설치는 GUI 설치 프롬프트를 띄우는 이 명령이 정답이다. */
export const XCODE_INSTALL_COMMAND = "xcode-select --install";

const GUIDANCE: Record<XcodeCltIssue, XcodeCltGuidance> = {
  "license-not-agreed": {
    issue: "license-not-agreed",
    command: XCODE_LICENSE_COMMAND,
    title: "Xcode Command Line Tools 라이선스 동의 필요",
    message:
      "macOS 의 Xcode Command Line Tools 라이선스에 아직 동의하지 않아 git 이 실행되지 않습니다. " +
      `터미널을 열어 \`${XCODE_LICENSE_COMMAND}\` 를 실행해 동의한 뒤 다시 시도하세요. ` +
      "관리자 비밀번호가 필요하므로 마블로가 대신 실행할 수 없습니다.",
  },
  "clt-missing": {
    issue: "clt-missing",
    command: XCODE_INSTALL_COMMAND,
    title: "Xcode Command Line Tools 설치 필요",
    message:
      "macOS 의 Xcode Command Line Tools(git 포함)가 설치되어 있지 않습니다. " +
      `터미널을 열어 \`${XCODE_INSTALL_COMMAND}\` 를 실행해 설치를 마친 뒤 다시 시도하세요.`,
  },
};

/** 해당 상태의 안내(명령 + 문구). */
export function xcodeCltGuidance(issue: XcodeCltIssue): XcodeCltGuidance {
  return GUIDANCE[issue];
}

/**
 * git/shell 출력에서 Xcode CLT 문제를 감지한다. 못 찾으면 null.
 *
 * 오탐 방지를 위해 **먼저 xcode/xcrun/developer-tools 앵커**를 요구한다 —
 * 그래야 경로에 `LICENSE` 가 들어간 평범한 git 실패를 라이선스 문제로
 * 오인하지 않는다. 앵커가 있을 때만 세부 문구로 두 상태를 가른다.
 */
export function detectXcodeCltIssue(
  text: string | null | undefined,
): XcodeCltIssue | null {
  if (typeof text !== "string" || !text) return null;
  const s = text.toLowerCase();

  const anchored =
    s.includes("xcode") ||
    s.includes("xcrun") ||
    s.includes("commandlinetools") ||
    s.includes("command line tools") ||
    s.includes("developer tools");
  if (!anchored) return null;

  // 라이선스 미동의가 먼저다 — CLT 는 깔려 있는데 동의만 안 된 상태이므로
  // '설치하세요' 로 안내하면 사용자가 헛수고를 한다.
  if (
    s.includes("not agreed") ||
    s.includes("not been agreed") ||
    s.includes("license agreement") ||
    s.includes("xcodebuild -license") ||
    s.includes("-license accept") ||
    s.includes("agreeing to the xcode")
  ) {
    return "license-not-agreed";
  }

  if (
    s.includes("invalid active developer path") ||
    s.includes("invalid developer directory") ||
    s.includes("no developer tools were found") ||
    s.includes("missing xcrun") ||
    s.includes("unable to find utility")
  ) {
    return "clt-missing";
  }

  return null;
}

/** 감지되면 안내, 아니면 null. */
export function describeXcodeCltFailure(
  text: string | null | undefined,
): XcodeCltGuidance | null {
  const issue = detectXcodeCltIssue(text);
  return issue ? GUIDANCE[issue] : null;
}

/**
 * git 실패 문자열을 사용자에게 보여주기 직전에 통과시키는 필터.
 * Xcode CLT 문제면 **원문 대신** 안내 + 명령으로 바꾸고, 아니면 원문 유지.
 * (원문은 사용자가 할 수 있는 일을 하나도 알려주지 않는다.)
 */
export function annotateGitFailure(raw: string): string {
  const guidance = describeXcodeCltFailure(raw);
  if (!guidance) return raw;
  return `${guidance.message} (실행할 명령: ${guidance.command})`;
}

// ─── 사전 감지(연결 전 probe) ────────────────────────────────────────────

/** 연결 전 사전 감지 결과. `checked=false` 면 이 OS 에선 해당 없음. */
export interface XcodeCltStatus {
  ok: boolean;
  /** darwin 에서만 실제 검사한다. 다른 OS 는 false + ok:true. */
  checked: boolean;
  issue?: XcodeCltIssue;
  command?: string;
  message?: string;
  title?: string;
}

/** 테스트 주입용 실행기. 절대 throw 하지 않는 계약. */
export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

const PROBE_TIMEOUT_MS = 5_000;

const realRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    try {
      // git 실제 spawn 과 **같은 PATH** 로 돌려야 판정이 일치한다. 예컨대
      // Homebrew git 이 PATH 앞에 있으면 CLT 라이선스와 무관하게 git 이
      // 동작하는데, 그때 probe 가 /usr/bin/git 로 실패를 만들어내면
      // 있지도 않은 문제를 안내하게 된다.
      const proc = spawn(command, args, {
        env: gitSpawnEnv(),
        shell: false,
      });
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish(124);
      }, PROBE_TIMEOUT_MS);
      timer.unref?.();
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => finish(code ?? 1));
      proc.on("error", (err) => {
        stderr += String(err);
        finish(-1);
      });
    } catch (err) {
      stderr += String(err);
      finish(-1);
    }
  });

function statusFor(issue: XcodeCltIssue): XcodeCltStatus {
  const g = GUIDANCE[issue];
  return {
    ok: false,
    checked: true,
    issue,
    command: g.command,
    title: g.title,
    message: g.message,
  };
}

/**
 * 연결/클론/워크트리 **전에** CLT 상태를 확인한다. 절대 throw 하지 않는다.
 *
 * 1) `xcode-select -p` — 활성 developer 디렉터리가 없으면 CLT 미설치.
 * 2) `git --version` — macOS 의 git 은 xcrun shim 이라 라이선스 미동의면
 *    이 무해한 호출조차 라이선스 원문과 함께 실패한다. 그래서 이게 실제로
 *    쓰이는 git 바이너리 기준의 가장 정확한 라이선스 probe 다.
 *    (`xcodebuild -license status` 같은 조회 전용 서브커맨드는 없고,
 *     `xcodebuild -license` 는 sudo + 대화형 pager 라 앱에서 못 돌린다.)
 */
export async function probeXcodeClt(
  run: CommandRunner = realRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<XcodeCltStatus> {
  if (platform !== "darwin") return { ok: true, checked: false };

  const selected = await run("xcode-select", ["-p"]);
  if (selected.code !== 0 || !selected.stdout.trim()) {
    return statusFor(detectXcodeCltIssue(selected.stderr) ?? "clt-missing");
  }

  const git = await run("git", ["--version"]);
  if (git.code !== 0) {
    const issue = detectXcodeCltIssue(`${git.stderr}\n${git.stdout}`);
    if (issue) return statusFor(issue);
  }

  return { ok: true, checked: true };
}
