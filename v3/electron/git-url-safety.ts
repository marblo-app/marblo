/**
 * git remote URL 의 크레덴셜(userinfo) 처리 — ★단일 진실원.
 *
 * 왜 있나 (티켓 d0d0JkRd1SeGTxVRx4nQ, P0 보안):
 * clone 이 `https://oauth2:<token>@github.com/...` 를 쓰면 git 이 그 URL 을
 * 그대로 `.git/config` 의 `remote.origin.url` 에 적는다. 그 값이
 * `git remote get-url origin` → IPC → 렌더러 → 화면 → **팀 전원이 읽는
 * Firestore `projects.gitRemoteUrl`** 까지 흘러간다. 한 명의 개인 토큰이
 * 팀 전체에 노출되는 경로다.
 *
 * 그래서 remote URL 이 프로세스 경계를 넘기 전에 **여기를 반드시 통과**한다.
 * 순수 함수만 두고 node/electron API 에 의존하지 않는다 — 메인 프로세스와
 * 렌더러(`src/lib/gitUrlSafety.ts` 가 이 파일을 re-export)가 같은 구현을
 * 공유해야 두 쪽의 판정이 갈라지지 않는다.
 *
 * ★값을 로그에 찍지 않는다. 이 모듈은 "지웠다/안 지웠다"만 돌려주고,
 * 호출부도 원문 대신 정화된 값만 다뤄야 한다.
 */

/** `scheme://authority/rest` 분해. authority 에 userinfo 가 들어있다. */
const SCHEMED = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/;

/** scp 축약형 `user@host:path` (스킴 없음, `:` 앞에 `//` 가 없다). */
const SCP_LIKE = /^([^/@\s]+)@([^:/\s]+):([\s\S]+)$/;

export interface GitUrlCredentialInfo {
  /** userinfo(`user@` 또는 `user:pass@`)가 있었나. */
  present: boolean;
  /**
   * ★비밀값으로 취급해야 하는가.
   *  - http(s): userinfo 가 있으면 **무조건** 비밀 취급한다. 토큰은
   *    `https://<token>@host/...` 처럼 **username 자리에만** 실리는 형태도
   *    흔해서 "password 가 있을 때만" 으로 좁히면 그대로 샌다.
   *  - ssh/scp: `git@host` 는 비밀이 아니라 필수 계정명이다. password 가
   *    붙었을 때만 비밀로 본다.
   */
  secret: boolean;
}

const NONE: GitUrlCredentialInfo = { present: false, secret: false };

/**
 * URL 의 userinfo 를 판정한다. 파싱 불가·userinfo 없음이면 present=false.
 * ★반환값에 크레덴셜 원문을 절대 담지 않는다(로그 사고 방지).
 */
export function inspectGitUrlCredentials(
  url: string | null | undefined
): GitUrlCredentialInfo {
  if (typeof url !== "string") return NONE;
  const s = url.trim();
  if (!s) return NONE;

  const schemed = s.match(SCHEMED);
  if (schemed) {
    const authority = schemed[2];
    const at = authority.lastIndexOf("@");
    if (at < 0) return NONE;
    const scheme = schemed[1].toLowerCase();
    const userinfo = authority.slice(0, at);
    const isSsh = scheme === "ssh://";
    return {
      present: true,
      secret: isSsh ? userinfo.includes(":") : true,
    };
  }

  const scp = s.match(SCP_LIKE);
  if (scp) {
    // scp 축약형은 언제나 ssh — `git@` 은 계정명이고 비밀이 아니다.
    return { present: true, secret: scp[1].includes(":") };
  }

  return NONE;
}

/** URL 에 비밀 취급할 크레덴셜이 실려 있나. */
export function hasGitUrlCredentials(url: string | null | undefined): boolean {
  return inspectGitUrlCredentials(url).secret;
}

/**
 * 저장·표시·전송용으로 크레덴셜을 벗긴 URL.
 *
 * 문자열 수술로만 처리한다 — `new URL()` 로 돌리면 경로 인코딩·끝 슬래시가
 * 조용히 바뀌어 사용자가 적어 넣은 주소와 달라진다. 여기서는 authority 의
 * userinfo 구간만 도려내고 나머지는 한 글자도 건드리지 않는다.
 *
 * ssh/scp 의 `git@` 은 유지한다(제거하면 clone 이 깨진다). password 만 뗀다.
 * 파싱 불가면 입력을 그대로 돌려준다 — 정화 실패를 조용한 통과로 바꾸지
 * 않도록 호출부는 hasGitUrlCredentials 로 함께 확인한다.
 */
export function stripGitUrlCredentials(url: string): string {
  const s = url;

  const schemed = s.match(SCHEMED);
  if (schemed) {
    const [, scheme, authority, rest] = schemed;
    const at = authority.lastIndexOf("@");
    if (at < 0) return s;
    const userinfo = authority.slice(0, at);
    const hostport = authority.slice(at + 1);
    if (scheme.toLowerCase() === "ssh://") {
      // 계정명은 살리고 password 만 제거.
      const user = userinfo.split(":")[0];
      return user
        ? `${scheme}${user}@${hostport}${rest}`
        : `${scheme}${hostport}${rest}`;
    }
    return `${scheme}${hostport}${rest}`;
  }

  const scp = s.match(SCP_LIKE);
  if (scp) {
    const user = scp[1].split(":")[0];
    return user ? `${user}@${scp[2]}:${scp[3]}` : `${scp[2]}:${scp[3]}`;
  }

  return s;
}

/**
 * 우리(또는 gh/Actions 류 자동화)가 기계적으로 박은 크레덴셜인가.
 *
 * ★로컬 `.git/config` 를 **되돌려 쓰는** 판단에만 쓴다. 사람이 손으로 넣은
 * `https://myname:<pat>@...` 까지 지우면 그 사람의 push 인증이 말없이
 * 깨지므로, username 이 기계 관용구인 경우로 좁힌다. 그 밖의 크레덴셜은
 * "내보낼 때 벗기기"만 하고 디스크는 건드리지 않는다.
 */
const APP_INJECTED_USERNAMES = new Set(["oauth2", "x-access-token"]);

export function isAppInjectedCredential(
  url: string | null | undefined
): boolean {
  if (typeof url !== "string") return false;
  const schemed = url.trim().match(SCHEMED);
  if (!schemed) return false;
  const scheme = schemed[1].toLowerCase();
  if (scheme !== "https://" && scheme !== "http://") return false;
  const at = schemed[2].lastIndexOf("@");
  if (at < 0) return false;
  const username = schemed[2].slice(0, at).split(":")[0].toLowerCase();
  return APP_INJECTED_USERNAMES.has(username);
}

/**
 * 프로세스 경계를 넘길 remote URL 의 표준 관문.
 * trim 하고 크레덴셜을 벗긴 값, 빈 값이면 null.
 */
export function sanitizeGitRemoteUrl(
  url: string | null | undefined
): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const stripped = stripGitUrlCredentials(trimmed);
  return stripped.trim() || null;
}
