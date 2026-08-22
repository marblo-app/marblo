/**
 * repo-push — 팀원이 GitHub 개별 초대 없이 브랜치를 밀고 PR 로 보내는 경로
 * (티켓 FYIyUuhJbv2cDVjgkRGf, v2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★clone 구현을 새로 만들지 않았다
 * ─────────────────────────────────────────────────────────────────────────────
 * 자격증명 주입은 `repo-clone.githubTokenGitConfigEnv` 를 **그대로** 부른다
 * (#1097 이 만든 `GIT_CONFIG_*` → `http.<url>.extraHeader` 방식). git 실행기도
 * 같은 `GitRunner` 타입이다. 두 벌이 되면 한쪽만 고쳐지고, 그 한쪽이 토큰을
 * URL 에 박는 옛 방식으로 되돌아간다.
 *
 * 그래서 이 파일이 **새로 갖는 것은 push 고유의 것들뿐**이다: 브랜치 이름
 * 검증, refspec 조립, push 전용 에러 분류.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★토큰 경계
 * ─────────────────────────────────────────────────────────────────────────────
 * 토큰은 인자 → 자식 프로세스 env → 함수 종료. argv 에도, `.git/config` 에도,
 * 반환값에도 없다. stderr 요약은 토큰을 지우고 나간다(redactToken 재사용).
 */

import { gitSpawnEnv } from "./git-path";
import {
  classifyCloneError,
  githubTokenGitConfigEnv,
  realGitRunner,
  type GitRunner,
} from "./repo-clone";

/** push 실패의 사용자-행동 가능한 분류. */
export type PushErrorKind =
  | "invalid-branch"
  | "auth"
  /** 우리 역할 게이트가 아니라 **GitHub 이** 막았다(403 / 저장소 권한 없음). */
  | "denied"
  /** 저장소의 브랜치 보호 규칙(GH006). App 토큰에도 똑같이 적용된다. */
  | "protected-branch"
  /**
   * ★GH007 — 커밋 이메일이 그 계정의 **비공개 주소**라 GitHub 이 push 를
   * 거절했다. 귀속이 조용히 깨지는 대신 시끄럽게 깨지는 자리다.
   * github-commit-identity 가 noreply 로 접으면 애초에 안 난다.
   */
  | "private-email"
  /** 원격이 앞서 있다 — 먼저 pull/rebase 해야 한다. */
  | "rejected"
  | "no-commits"
  | "network"
  | "git";

export interface PushResult {
  ok: boolean;
  /** 성공 시 민 브랜치 이름. */
  branch?: string;
  errorKind?: PushErrorKind;
  /** git stderr 요약(토큰 제거됨) — 모달의 상세 표시용. */
  message?: string;
}

/** 대용량 push 여유 포함 상한. 인증 실패는 프롬프트 없이 즉사한다. */
const PUSH_TIMEOUT_MS = 5 * 60_000;

/**
 * 밀 수 있는 브랜치 이름인가.
 *
 * ★MIRROR — `functions/src/githubApp.normalizePushRef` 와 같은 규칙이다.
 * 서버가 최종 판정자이고(기본 브랜치 게이트) 여기는 **argv 주입 차단**이
 * 주 목적이라 규칙을 좁게 유지한다. 두 벌인 이유는 electron 이 functions
 * 패키지를 import 할 수 없기 때문이다(TEAM_COLLAB_PLANS 와 같은 규약).
 */
export function normalizeBranchName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.trim();
  if (!t || t.length > 255) return null;
  if (t.startsWith("refs/heads/")) t = t.slice("refs/heads/".length);
  if (!t || t.startsWith("-") || t.startsWith("/") || t.endsWith("/")) {
    return null;
  }
  if (t.endsWith(".lock") || t.endsWith(".")) return null;
  if (t.includes("..") || t.includes("@{")) return null;
  if (/[\s~^:?*[\\]/.test(t)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(t)) return null;
  return t;
}

/**
 * git stderr → push 전용 분류.
 *
 * ★순서가 중요하다. GitHub 은 브랜치 보호·비공개 이메일 거절을 전부 "remote:
 * ... \n ! [remote rejected]" 로 감싸 보내는데, 그 겉면만 보면 전부
 * `rejected` 로 뭉개진다. 그러면 화면이 "pull 하세요" 라는 **틀린 안내**를
 * 한다 — 브랜치 보호는 pull 로 풀리지 않는다.
 */
export function classifyPushError(stderr: string): PushErrorKind {
  const s = stderr.toLowerCase();

  if (s.includes("gh007") || s.includes("publish a private email address")) {
    return "private-email";
  }
  if (
    s.includes("gh006") ||
    s.includes("protected branch") ||
    s.includes("required status check") ||
    s.includes("refusing to allow") ||
    s.includes("changes must be made through a pull request")
  ) {
    return "protected-branch";
  }
  if (s.includes("src refspec") && s.includes("does not match any")) {
    return "no-commits";
  }
  if (
    s.includes("403") ||
    s.includes("write access to repository not granted") ||
    s.includes("permission to") ||
    s.includes("denied to")
  ) {
    return "denied";
  }
  if (
    s.includes("non-fast-forward") ||
    s.includes("fetch first") ||
    s.includes("behind its remote counterpart") ||
    s.includes("updates were rejected")
  ) {
    return "rejected";
  }

  // 남은 것은 clone 과 같은 분류로 접는다 — auth/network/git 는 규칙이 동일하다.
  const shared = classifyCloneError(stderr);
  if (shared === "auth") return "auth";
  if (shared === "network") return "network";
  if (shared === "not-found") return "denied"; // private repo 는 404 로 숨는다
  return "git";
}

/** 행동 가능한 안내 문구. raw stderr 대신 이걸 띄운다. */
export function pushErrorMessage(kind: PushErrorKind): string | null {
  switch (kind) {
    case "denied":
      return "이 저장소에 밀 권한이 없습니다. 프로젝트 오너에게 GitHub App 재승인을 요청하세요.";
    case "protected-branch":
      return "이 브랜치는 저장소의 보호 규칙으로 잠겨 있습니다. 다른 브랜치로 올리고 PR 로 보내세요.";
    case "private-email":
      return "커밋 이메일이 GitHub 비공개 주소로 막혀 있습니다. 저장소를 다시 연결하면 귀속용 noreply 주소로 맞춥니다.";
    case "rejected":
      return "원격이 앞서 있습니다. 먼저 받아온(pull) 뒤 다시 시도하세요.";
    case "no-commits":
      return "밀 커밋이 없습니다. 먼저 커밋하세요.";
    case "invalid-branch":
      return "브랜치 이름이 올바르지 않습니다.";
    default:
      return null;
  }
}

/**
 * `repoPath` 의 `branch` 를 origin 으로 민다.
 *
 * ★절대 throw 하지 않는다 — PushResult 로 돌려준다(clone 과 같은 규율).
 * ★force 하지 않는다. 원격이 앞서면 `rejected` 로 돌려주고 사용자가 판단한다.
 *
 * refspec 을 `refs/heads/X:refs/heads/X` 로 완전히 적는 이유: 그 값은 어떤
 * 경우에도 `-` 로 시작할 수 없어서 옵션으로 오독될 여지가 없다. `origin` 은
 * 리터럴이고, 브랜치는 위에서 검증됐다.
 */
export async function pushBranch(
  input: {
    repoPath: string;
    /** 자격증명 스코프 판정용 원격 URL(#1097 의 게이트와 같은 값). */
    remoteUrl: string;
    branch: string;
    githubToken?: string | null;
  },
  runner: GitRunner = realGitRunner,
): Promise<PushResult> {
  const branch = normalizeBranchName(input.branch);
  if (!branch) {
    return {
      ok: false,
      errorKind: "invalid-branch",
      message: pushErrorMessage("invalid-branch") ?? undefined,
    };
  }

  const refspec = `refs/heads/${branch}:refs/heads/${branch}`;
  const r = await runner(["push", "--set-upstream", "origin", refspec], {
    cwd: input.repoPath,
    timeoutMs: PUSH_TIMEOUT_MS,
    // ★#1097 의 그 함수를 그대로 부른다. GitHub HTTPS 가 아니면 아무것도
    // 주입되지 않는다(SSH·타 호스트는 기존 자격증명 그대로).
    env: githubTokenGitConfigEnv(
      input.remoteUrl,
      input.githubToken,
      gitSpawnEnv(),
    ),
  });

  if (r.code === 0) return { ok: true, branch };

  const errorKind = classifyPushError(r.stderr);
  const guided = pushErrorMessage(errorKind);
  return {
    ok: false,
    branch,
    errorKind,
    message: guided ?? summarizePushStderr(r.stderr, input.githubToken),
  };
}

/** stderr 꼬리 요약 — 토큰이 섞여 있어도 지우고 나간다. */
export function summarizePushStderr(
  stderr: string,
  token?: string | null,
): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = lines.slice(-3).join(" · ").slice(0, 500);
  return token ? tail.split(token).join("[redacted]") : tail;
}
