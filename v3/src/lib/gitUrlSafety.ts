/**
 * 렌더러/서비스용 re-export — 구현은 메인 프로세스와 **같은 파일**을 쓴다.
 *
 * 크레덴셜 판정이 두 프로세스에서 갈라지면 한쪽이 "안전하다"고 통과시킨
 * URL 을 다른 쪽이 Firestore 에 적는다. 그래서 복사본을 두지 않고
 * `electron/git-url-safety.ts` 하나만 본다 (modelTier.ts 와 같은 방식).
 */
export {
  hasGitUrlCredentials,
  inspectGitUrlCredentials,
  sanitizeGitRemoteUrl,
  stripGitUrlCredentials,
  type GitUrlCredentialInfo,
} from "../../electron/git-url-safety";
