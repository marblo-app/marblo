/**
 * 커밋 귀속 — "누가 이 코드를 썼나" 를 그 사람에게 남기는 자리
 * (티켓 FYIyUuhJbv2cDVjgkRGf, v2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★왜 이 파일이 있는가
 * ─────────────────────────────────────────────────────────────────────────────
 * v2 는 App 토큰(`contents: write`)으로 민다. 그러면 GitHub 의 **push 이벤트와
 * PR 작성자**는 `marblo[bot]` 으로 기록된다 — 그건 되돌릴 수 없다. 되돌릴 수
 * 있는 것, 그리고 실제로 중요한 것은 **커밋 작성자**다: GitHub 은 커밋의 author
 * 이메일을 계정에 매칭해 아바타·프로필·기여 그래프를 붙인다. 그 매칭은 누가
 * 밀었는지와 무관하다.
 *
 * 그래서 이 모듈이 하는 일은 하나다 — **그 팀원의 GitHub 계정에 매칭되는
 * 이메일**을 알아내 저장소의 `user.email` 에 박는다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★조용히 깨지는 자리 (이 파일의 존재 이유)
 * ─────────────────────────────────────────────────────────────────────────────
 * 여기서 이메일을 잘못 고르면 **에러가 안 난다.** push 는 성공하고, GitHub 에
 * 커밋도 올라가고, 다만 작성자가 링크 없는 회색 이름으로 남는다. "됐다" 고
 * 보고했는데 실제로는 안 된 종류의 실패다. 틀리는 경로가 셋이다:
 *
 *  1. **마블로 계정 이메일을 쓴다.** 회사 SSO 이메일이 GitHub 에 등록돼 있을
 *     이유가 없다 → 매칭 실패. ★그래서 이 모듈은 마블로 이메일을 절대 쓰지
 *     않는다. 오직 GitHub 이 답한 값만 쓴다.
 *  2. **비공개 이메일 사용자**(GitHub 설정의 "Keep my email addresses
 *     private"). 이 사람들의 진짜 이메일은 애초에 우리가 알 수 없고, 알아내
 *     커밋해도 GitHub 이 push 를 GH007 로 거절한다("Your push would publish a
 *     private email address"). ★그래서 기본값이 **noreply 주소**다.
 *  3. **구형 noreply 형식**(`login@users.noreply.github.com`). 2017년 중반
 *     이전 계정에만 매칭된다. ★그래서 항상 **id 가 앞에 붙는** 형식
 *     (`{id}+{login}@users.noreply.github.com`)을 만든다 — 이건 모든 계정에
 *     매칭된다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★이메일을 어디서 얻나 — device OAuth 계정에서 얻는다
 * ─────────────────────────────────────────────────────────────────────────────
 * `GET /user` 하나면 된다. 응답의 `id` 와 `login` 만으로 위 noreply 주소를
 * **결정적으로** 조립할 수 있다.
 *
 *  - ★새 스코프가 필요 없다. 지금 device flow 가 받는 `repo` 스코프로 `GET
 *    /user` 가 된다. `user:email` 을 **일부러 받지 않는다** — 그걸 받으면 팀원
 *    전원의 비공개 이메일이 우리 프로세스로 들어온다. 필요 없는 PII 다.
 *  - `email` 필드는 **공개 프로필 이메일**이다(비공개 설정이면 null). 값이
 *    있다는 건 본인이 공개하기로 한 검증된 주소라는 뜻이므로 그대로 쓴다.
 *    없으면 noreply 로 간다.
 *
 * ★App 토큰으로는 이걸 못 얻는다. App 토큰은 저장소 권한이지 신원이 아니다
 * (설계 §2 — device OAuth 가 "너는 누구인가" 를 답한다). 그래서 GitHub 을 한
 * 번도 연결하지 않은 멤버는 귀속시킬 이메일이 없고, 이 모듈은 그 경우
 * **null 을 돌려준다.** 호출부는 그걸 조용히 넘기지 않고 안내로 바꾼다 —
 * 저장소 초대가 아니라 GitHub 로그인 1회이고, v1 부터 이미 있던 경로다.
 */

/** 커밋 author/committer 에 박을 값. */
export interface CommitIdentity {
  name: string;
  email: string;
  /** GitHub 로그인 — 로그·안내 문구용(이메일은 절대 로그하지 않는다). */
  login: string;
  /** noreply 로 접혔는가. 화면이 "비공개 이메일로 커밋됩니다" 를 알릴 근거. */
  usesNoreply: boolean;
}

/** `GET /user` 응답 중 이 모듈이 보는 것만. */
export interface GitHubUserResponse {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  email?: unknown;
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/**
 * ★모든 계정에 매칭되는 noreply 주소. `{id}+{login}@users.noreply.github.com`.
 * id 를 빼면 2017년 이전 계정에만 매칭된다 — 그게 위 실패경로 3번이다.
 */
export function githubNoreplyEmail(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}

/** 이미 noreply 주소인가(공개 프로필 이메일이 noreply 인 경우도 있다). */
export function isNoreplyEmail(email: string): boolean {
  return /@users\.noreply\.github\.com$/i.test(email.trim());
}

/**
 * `GET /user` 응답 → 커밋 신원. 모양이 어긋나면 null — **추측하지 않는다.**
 *
 * 규칙:
 *  - `email` 이 있으면 그대로 쓴다(= 본인이 공개한 검증된 주소).
 *  - 없으면 noreply 로 접는다. ★이 경로가 비공개 이메일 사용자를 처리한다.
 *  - `name` 이 없으면 `login` 을 쓴다. GitHub 은 이름이 아니라 **이메일**로
 *    매칭하므로 이름은 표시용일 뿐이다.
 */
export function parseCommitIdentity(
  body: GitHubUserResponse | null | undefined,
): CommitIdentity | null {
  if (!body || typeof body !== "object") return null;

  const id = body.id;
  const login = typeof body.login === "string" ? body.login.trim() : "";
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  if (!LOGIN_RE.test(login)) return null;

  const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
  // 공개 프로필 이메일이 있어도 모양이 이상하면 믿지 않는다 — 잘못된 값으로
  // 커밋하는 것보다 noreply 로 확실히 귀속시키는 편이 낫다.
  const usable =
    rawEmail.length > 0 &&
    rawEmail.length <= 254 &&
    /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(rawEmail);

  const email = usable ? rawEmail : githubNoreplyEmail(id, login);
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim()
    : login;

  return { name, email, login, usesNoreply: isNoreplyEmail(email) };
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * device OAuth 토큰으로 `GET /user`. 실패는 전부 null — **던지지 않는다.**
 * 이 조회 실패가 clone/push 를 막으면 v1 의 fail-soft 규율(G2)이 깨진다.
 *
 * ★토큰을 로그하지 않는다. 실패 로그에는 HTTP status 만 남는다.
 */
export async function fetchCommitIdentity(
  deviceToken: string,
  fetcher: FetchLike = fetch as unknown as FetchLike,
): Promise<CommitIdentity | null> {
  if (!deviceToken) return null;
  try {
    const res = await fetcher("https://api.github.com/user", {
      method: "GET",
      headers: {
        authorization: `Bearer ${deviceToken}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "marblo-app",
      },
    });
    if (!res.ok) {
      console.info(`[githubIdentity] /user ${res.status} — 귀속 정보 없음`);
      return null;
    }
    return parseCommitIdentity((await res.json()) as GitHubUserResponse);
  } catch {
    console.info("[githubIdentity] /user 호출 실패 — 귀속 정보 없음");
    return null;
  }
}

/**
 * 저장소에 커밋 신원을 박는다 — `git config --local`.
 *
 * ★왜 env(`GIT_AUTHOR_EMAIL`)가 아니라 repo-local config 인가: 커밋을 만드는
 * 것은 우리 프로세스가 아니라 **그 저장소에서 도는 에이전트/사람**이다. env 는
 * 우리가 띄운 자식에게만 붙지만 config 는 그 폴더의 모든 커밋에 붙는다. 즉
 * 에이전트가 자기 터미널에서 `git commit` 해도 귀속이 산다.
 *
 * ★`--local` 이라 사용자의 전역 git 설정을 건드리지 않는다. 다른 프로젝트에
 * 번지지 않는다.
 *
 * 실패는 false — clone/push 를 막지 않는다. 대신 호출부가 "귀속이 안 붙었다"
 * 를 알 수 있어야 하므로 조용히 true 를 돌려주지 않는다.
 */
export async function applyCommitIdentity(
  repoPath: string,
  identity: CommitIdentity,
  runGit: (
    args: string[],
    opts: { cwd: string },
  ) => Promise<{ code: number; stderr: string }>,
): Promise<boolean> {
  try {
    const name = await runGit(["config", "--local", "user.name", identity.name], {
      cwd: repoPath,
    });
    if (name.code !== 0) return false;
    const email = await runGit(
      ["config", "--local", "user.email", identity.email],
      { cwd: repoPath },
    );
    return email.code === 0;
  } catch {
    return false;
  }
}
