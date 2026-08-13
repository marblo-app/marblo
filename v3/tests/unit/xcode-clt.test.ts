import { describe, expect, it } from "vitest";
import {
  XCODE_INSTALL_COMMAND,
  XCODE_LICENSE_COMMAND,
  annotateGitFailure,
  describeXcodeCltFailure,
  detectXcodeCltIssue,
  probeXcodeClt,
  xcodeCltGuidance,
  type CommandRunner,
} from "../../electron/xcode-clt";

/**
 * macOS Xcode CLT 감지·안내 (티켓 nETj7szjEtT5prbYsg1D).
 *
 * 계약의 전부가 **에러 문자열 매칭**이므로 실제 macOS 가 뱉는 원문을 그대로
 * 넣고 검증한다. 오탐(평범한 git 실패를 Xcode 문제로 오인)이 나면 사용자가
 * 엉뚱한 sudo 명령을 실행하게 되므로 음성 케이스도 같은 무게로 본다.
 */

// 실제 macOS 출력 원문들.
const LICENSE_CLT = `You have not agreed to the Xcode license agreements, please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode license agreements.`;
const LICENSE_ADMIN = `Agreeing to the Xcode/iOS license requires admin privileges, please run "sudo xcodebuild -license" and then retry this command.`;
const LICENSE_BOTH = `You have not agreed to the Xcode license agreements. You must agree to both license agreements below in order to use Xcode.`;
const CLT_MISSING_XCRUN = `xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun`;
const CLT_MISSING_SELECT = `xcode-select: error: invalid developer directory '/Library/Developer/CommandLineTools'`;
const CLT_NOT_FOUND = `xcode-select: note: no developer tools were found, requesting install.`;

describe("detectXcodeCltIssue", () => {
  it("라이선스 미동의 원문들을 license-not-agreed 로 감지한다", () => {
    expect(detectXcodeCltIssue(LICENSE_CLT)).toBe("license-not-agreed");
    expect(detectXcodeCltIssue(LICENSE_ADMIN)).toBe("license-not-agreed");
    expect(detectXcodeCltIssue(LICENSE_BOTH)).toBe("license-not-agreed");
  });

  it("CLT 미설치 원문들을 clt-missing 으로 감지한다", () => {
    expect(detectXcodeCltIssue(CLT_MISSING_XCRUN)).toBe("clt-missing");
    expect(detectXcodeCltIssue(CLT_MISSING_SELECT)).toBe("clt-missing");
    expect(detectXcodeCltIssue(CLT_NOT_FOUND)).toBe("clt-missing");
  });

  it("라이선스 문구가 섞여 있으면 설치가 아니라 라이선스로 판정한다", () => {
    // CLT 는 깔려 있는데 '설치하세요' 로 안내하면 사용자가 헛수고를 한다.
    expect(
      detectXcodeCltIssue(
        `xcode-select: note: no developer tools were found\n${LICENSE_CLT}`,
      ),
    ).toBe("license-not-agreed");
  });

  it("대소문자·앞뒤 잡음에 흔들리지 않는다", () => {
    expect(detectXcodeCltIssue(LICENSE_CLT.toUpperCase())).toBe(
      "license-not-agreed",
    );
    expect(
      detectXcodeCltIssue(`fatal: something\n${LICENSE_CLT}\nexit 69`),
    ).toBe("license-not-agreed");
  });

  it("평범한 git 실패는 감지하지 않는다(오탐 방지)", () => {
    expect(detectXcodeCltIssue("fatal: repository not found")).toBeNull();
    expect(
      detectXcodeCltIssue("fatal: Authentication failed for 'https://…'"),
    ).toBeNull();
    expect(
      detectXcodeCltIssue("fatal: could not resolve host: github.com"),
    ).toBeNull();
    // 'license' 라는 단어만으로 걸리면 안 된다 — LICENSE 파일 경로가 흔하다.
    expect(
      detectXcodeCltIssue("error: pathspec 'LICENSE' did not match any file"),
    ).toBeNull();
    expect(detectXcodeCltIssue("")).toBeNull();
    expect(detectXcodeCltIssue(null)).toBeNull();
    expect(detectXcodeCltIssue(undefined)).toBeNull();
  });
});

describe("xcodeCltGuidance / describeXcodeCltFailure", () => {
  it("라이선스는 sudo xcodebuild -license accept 를 준다", () => {
    const g = xcodeCltGuidance("license-not-agreed");
    expect(g.command).toBe(XCODE_LICENSE_COMMAND);
    expect(g.command).toBe("sudo xcodebuild -license accept");
    expect(g.message).toContain(XCODE_LICENSE_COMMAND);
  });

  it("미설치는 xcode-select --install 을 준다", () => {
    const g = xcodeCltGuidance("clt-missing");
    expect(g.command).toBe(XCODE_INSTALL_COMMAND);
    expect(g.command).toBe("xcode-select --install");
    expect(g.message).toContain(XCODE_INSTALL_COMMAND);
  });

  it("감지된 원문에서 바로 안내를 뽑는다", () => {
    expect(describeXcodeCltFailure(LICENSE_CLT)?.command).toBe(
      XCODE_LICENSE_COMMAND,
    );
    expect(describeXcodeCltFailure(CLT_MISSING_XCRUN)?.command).toBe(
      XCODE_INSTALL_COMMAND,
    );
    expect(describeXcodeCltFailure("fatal: not a git repository")).toBeNull();
  });
});

describe("annotateGitFailure", () => {
  it("Xcode 원문을 실행할 명령이 담긴 안내로 **대체**한다", () => {
    const out = annotateGitFailure(LICENSE_CLT);
    expect(out).toContain(XCODE_LICENSE_COMMAND);
    // raw xcrun/xcodebuild 원문이 그대로 새어나가면 안 된다.
    expect(out).not.toContain("from within a Terminal window");
  });

  it("Xcode 와 무관한 실패는 원문 그대로 통과시킨다", () => {
    const raw = "fatal: repository 'https://github.com/x/y' not found";
    expect(annotateGitFailure(raw)).toBe(raw);
  });
});

describe("probeXcodeClt", () => {
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

  it("darwin 이 아니면 검사하지 않고 통과시킨다", async () => {
    const calls: string[] = [];
    const run: CommandRunner = async (cmd) => {
      calls.push(cmd);
      return ok();
    };
    const status = await probeXcodeClt(run, "linux");
    expect(status).toEqual({ ok: true, checked: false });
    expect(calls).toEqual([]);
  });

  it("xcode-select -p 가 실패하면 CLT 미설치로 안내한다", async () => {
    const run: CommandRunner = async (cmd) =>
      cmd === "xcode-select"
        ? { code: 2, stdout: "", stderr: CLT_MISSING_SELECT }
        : ok("git version 2.39.5");
    const status = await probeXcodeClt(run, "darwin");
    expect(status.ok).toBe(false);
    expect(status.issue).toBe("clt-missing");
    expect(status.command).toBe(XCODE_INSTALL_COMMAND);
  });

  it("git --version 이 라이선스 원문으로 죽으면 라이선스 미동의로 안내한다", async () => {
    // macOS 의 /usr/bin/git 은 xcrun shim 이라 --version 조차 실패한다.
    const run: CommandRunner = async (cmd) =>
      cmd === "xcode-select"
        ? ok("/Library/Developer/CommandLineTools")
        : { code: 69, stdout: "", stderr: LICENSE_CLT };
    const status = await probeXcodeClt(run, "darwin");
    expect(status.ok).toBe(false);
    expect(status.issue).toBe("license-not-agreed");
    expect(status.command).toBe(XCODE_LICENSE_COMMAND);
    expect(status.message).toContain(XCODE_LICENSE_COMMAND);
  });

  it("정상이면 ok:true, checked:true", async () => {
    const run: CommandRunner = async (cmd) =>
      cmd === "xcode-select"
        ? ok("/Library/Developer/CommandLineTools")
        : ok("git version 2.39.5");
    expect(await probeXcodeClt(run, "darwin")).toEqual({
      ok: true,
      checked: true,
    });
  });

  it("git 이 Xcode 와 무관한 이유로 실패하면 문제를 지어내지 않는다", async () => {
    const run: CommandRunner = async (cmd) =>
      cmd === "xcode-select"
        ? ok("/Library/Developer/CommandLineTools")
        : { code: 127, stdout: "", stderr: "command not found: git" };
    expect(await probeXcodeClt(run, "darwin")).toEqual({
      ok: true,
      checked: true,
    });
  });
});
