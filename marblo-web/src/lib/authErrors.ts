/**
 * Firebase Auth 에러 → 사용자에게 보여줄 i18n 키 매핑.
 *
 * 규약 두 가지. 둘 다 authErrors.test.ts 가 고정한다:
 *
 *  1. ★원문을 화면에 남기지 않는다. 이 모듈은 **닫힌 키 집합**만 돌려준다.
 *     문자열을 통과시키는 경로가 없으므로 `Firebase: Error (auth/…)` 가
 *     새어 나갈 구조적 여지가 없다.
 *
 *  2. ★어느 쪽이 틀렸는지 알려주지 않는다. `invalid-credential` ·
 *     `user-not-found` · `wrong-password` 를 **한 키로 접는다**. 이메일이
 *     없는 건지 비밀번호가 틀린 건지 구분해 말하면 계정 열거 공격
 *     (account enumeration) 의 입구가 된다. `user-disabled` 도 같은 이유로
 *     접는다 — "정지된 계정" 이라는 응답 자체가 계정의 존재를 확인해 준다.
 */

export type AuthErrorKey =
  | "errorInvalidCredentials"
  | "errorTooManyRequests"
  | "errorNetwork"
  | "errorGeneric";

/** 로케일 파일이 반드시 전부 가지고 있어야 하는 키. */
export const AUTH_ERROR_KEYS: readonly AuthErrorKey[] = [
  "errorInvalidCredentials",
  "errorTooManyRequests",
  "errorNetwork",
  "errorGeneric",
];

/**
 * ★계정 열거를 막기 위해 한 문구로 접는 코드들.
 * 이 집합의 어떤 코드도 서로 구분되는 안내를 받으면 안 된다.
 */
const CREDENTIAL_CODES: readonly string[] = [
  "invalid-credential",
  "invalid-login-credentials",
  "user-not-found",
  "wrong-password",
  "invalid-email",
  "missing-password",
  "user-disabled",
];

const CODE_MAP: Record<string, AuthErrorKey> = {
  ...Object.fromEntries(
    CREDENTIAL_CODES.map((c) => [c, "errorInvalidCredentials" as AuthErrorKey])
  ),
  "too-many-requests": "errorTooManyRequests",
  "network-request-failed": "errorNetwork",
};

/**
 * Firebase 에러에서 `auth/…` 코드의 뒷부분만 뽑는다.
 *
 * SDK 는 `err.code === "auth/invalid-credential"` 로 주지만, 래핑되거나
 * 직렬화를 거치면 코드가 message 안에만 남는 경우가 있다
 * (`Firebase: Error (auth/invalid-credential).`). 두 경로 다 읽는다.
 */
export function extractAuthErrorCode(err: unknown): string | null {
  if (!err) return null;

  if (typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("auth/")) {
      return code.slice("auth/".length);
    }
  }

  const message =
    typeof err === "string"
      ? err
      : typeof err === "object" &&
        typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : null;
  if (!message) return null;

  const match = message.match(/auth\/([a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 어떤 입력이 와도 닫힌 키 집합 중 하나만 돌려준다.
 * 모르는 코드는 조용히 `errorGeneric` 으로 떨어진다 — 원문을 되돌려주는
 * 폴백은 **의도적으로 없다**.
 */
export function mapAuthError(err: unknown): AuthErrorKey {
  const code = extractAuthErrorCode(err);
  if (code && code in CODE_MAP) return CODE_MAP[code];
  return "errorGeneric";
}

/** 로케일 사전에서 빠진 에러 키 목록. 비어 있어야 정상. */
export function missingAuthErrorKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [...AUTH_ERROR_KEYS];
  const dict = raw as Record<string, unknown>;
  return AUTH_ERROR_KEYS.filter(
    (k) => typeof dict[k] !== "string" || dict[k] === ""
  );
}
