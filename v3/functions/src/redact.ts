// 버그리포트 자동수집 컨텍스트(recentLogs / agentSnapshot)에는 토큰·API 키·
// Authorization 헤더 등 민감정보가 섞여 들어올 수 있다. Firestore 에 저장하기
// 전에 흔한 시크릿 패턴을 마스킹하는 베스트-에포트 redaction 헬퍼.
//
// firebase 의존성이 없는 순수 모듈로 분리해 단위테스트(redact.test.ts)에서
// 부작용 없이 import 할 수 있게 한다. 완벽한 보장이 아니라 방어선이며, 새 키
// 포맷이 등장하면 패턴을 보강해야 한다.

// [정규식, 치환문자열] 목록을 순서대로 적용한다. 순서가 중요하다:
// Bearer / Authorization 를 먼저 처리해 토큰 값을 통째로 가린 뒤 일반 key=value
// 패턴을 적용한다.
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Authorization 헤더값 — 스킴(Bearer/Basic/…)과 그 뒤 자격증명까지 통째로 가린다.
  // (Bearer 패턴보다 먼저 적용해 "Basic <base64>" 의 자격증명 누락을 막는다.)
  [
    /\bAuthorization\b\s*[:=]\s*(?:(?:Bearer|Basic|Digest|Token|Negotiate)\s+)?[^\s,;"']+/gi,
    "Authorization: [REDACTED]",
  ],
  // 헤더 밖에 단독으로 등장하는 Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]"],
  // key=value / key: value — api_key, apikey, api-key, access_token, token,
  // secret, password 등. 값은 따옴표 유무 모두 처리.
  [
    /\b(api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+=]+["']?/gi,
    "$1=[REDACTED]",
  ],
  // OpenAI 등 sk- 시크릿
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]"],
  // GitHub 토큰 (PAT / OAuth / server / refresh)
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, "[REDACTED_GH_TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_GH_TOKEN]"],
  // AWS Access Key ID (AKIA + 16자)
  [/\bAKIA[0-9A-Z]{12,}/g, "[REDACTED_AWS_KEY]"],
  // Slack 토큰
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED_SLACK_TOKEN]"],
  // 홈경로의 사용자명 (/Users/<name>, /home/<name>) — 경로에 노출되는 PII 최소화
  [/(\/(?:Users|home))\/[^/\s"']+/g, "$1/[USER]"],
];

/**
 * 흔한 시크릿/토큰 패턴을 마스킹한다. 문자열이 아니면 빈 문자열을 반환한다.
 * 입력 문자열에 대해 SECRET_PATTERNS 를 순서대로 적용한 결과를 돌려준다.
 */
export function redactSecrets(input: unknown): string {
  if (typeof input !== "string") return "";
  let out = input;
  for (const [re, repl] of SECRET_PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}
