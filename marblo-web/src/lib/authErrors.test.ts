/**
 * P0 가드 — 로그인 실패 문구(티켓 8N56qvidQfcvdPPzf5wy).
 *
 * 이 파일이 지키는 두 가지:
 *   1. ★Firebase 원문이 화면에 남지 않는다 — ko·en·ja 세 벌 전부.
 *   2. ★어느 쪽이 틀렸는지 알려주지 않는다(계정 열거 방지).
 *
 * 라이브 재현 증거:
 *   docs/evidence/org-admin-look-and-feel-2026-09-06/login-error-live.png
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ko from "../../messages/ko.json";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";
import {
  AUTH_ERROR_KEYS,
  extractAuthErrorCode,
  mapAuthError,
  missingAuthErrorKeys,
  type AuthErrorKey,
} from "./authErrors";

const LOCALES: Array<{ locale: string; auth: Record<string, string> }> = [
  { locale: "ko", auth: ko.auth as Record<string, string> },
  { locale: "en", auth: en.auth as Record<string, string> },
  { locale: "ja", auth: ja.auth as Record<string, string> },
];

/** Firebase JS SDK 가 실제로 던지는 모양. code + 원문 message 둘 다 있다. */
function firebaseError(code: string): Error & { code: string } {
  const err = new Error(`Firebase: Error (${code}).`) as Error & {
    code: string;
  };
  err.code = code;
  return err;
}

// ───────────────────────── 1. 원문 노출 금지 ─────────────────────────

test("세 로케일 전부 에러 키 4종이 완결 — 폴백으로 떨어지는 키 0", () => {
  for (const { locale, auth } of LOCALES) {
    assert.deepEqual(missingAuthErrorKeys(auth), [], `${locale} 에 빠진 키`);
  }
});

test("★어떤 로케일 문구에도 Firebase·벤더명·에러코드가 없다", () => {
  // 화면에 절대 나오면 안 되는 흔적들.
  const FORBIDDEN = [/firebase/i, /auth\//i, /error \(/i, /\bSDK\b/i];
  for (const { locale, auth } of LOCALES) {
    for (const key of AUTH_ERROR_KEYS) {
      const text = auth[key];
      for (const pattern of FORBIDDEN) {
        assert.equal(
          pattern.test(text),
          false,
          `${locale}.auth.${key} 에 금지 패턴 ${pattern}: ${text}`
        );
      }
    }
  }
});

test("★mapAuthError 는 닫힌 키 집합만 돌려준다 — 원문 통과 경로 없음", () => {
  const inputs: unknown[] = [
    firebaseError("auth/invalid-credential"),
    firebaseError("auth/internal-error"),
    firebaseError("auth/popup-closed-by-user"),
    new Error("Firebase: Error (auth/invalid-credential)."),
    new Error("완전히 처음 보는 실패"),
    "auth/wrong-password",
    { code: "auth/too-many-requests" },
    { message: "Firebase: Error (auth/network-request-failed)." },
    null,
    undefined,
    42,
    {},
  ];
  for (const input of inputs) {
    const key = mapAuthError(input);
    assert.ok(
      (AUTH_ERROR_KEYS as readonly string[]).includes(key),
      `닫힌 집합 밖의 값이 나왔다: ${String(key)} (입력: ${String(input)})`
    );
  }
});

test("알 수 없는 코드는 조용히 errorGeneric 으로 접힌다", () => {
  assert.equal(
    mapAuthError(firebaseError("auth/internal-error")),
    "errorGeneric"
  );
  assert.equal(
    mapAuthError(new Error("무슨 일이 났는지 모름")),
    "errorGeneric"
  );
  assert.equal(mapAuthError(null), "errorGeneric");
});

test("코드 추출은 err.code 와 message 원문 두 경로 다 읽는다", () => {
  assert.equal(
    extractAuthErrorCode(firebaseError("auth/too-many-requests")),
    "too-many-requests"
  );
  // 래핑/직렬화로 code 가 사라지고 message 에만 남은 경우
  assert.equal(
    extractAuthErrorCode(new Error("Firebase: Error (auth/wrong-password).")),
    "wrong-password"
  );
  assert.equal(extractAuthErrorCode(new Error("plain failure")), null);
});

// ─────────────────── 2. 계정 열거(account enumeration) 방지 ───────────────────

/**
 * ★이 셋은 "이메일이 없다" vs "비밀번호가 틀렸다" 를 구분해 준다.
 * 구분해서 알려주면 공격자가 가입된 이메일 목록을 만들 수 있다.
 */
const ENUMERATION_CODES = [
  "auth/invalid-credential",
  "auth/user-not-found",
  "auth/wrong-password",
  "auth/invalid-login-credentials",
  "auth/invalid-email",
  "auth/user-disabled",
];

test("★계정 열거 방지 — 자격증명 계열은 전부 같은 키로 접힌다", () => {
  const keys = new Set<AuthErrorKey>(
    ENUMERATION_CODES.map((c) => mapAuthError(firebaseError(c)))
  );
  assert.equal(
    keys.size,
    1,
    `구분되는 키가 ${keys.size}개 나왔다: ${[...keys].join(", ")}`
  );
  assert.equal([...keys][0], "errorInvalidCredentials");
});

test("★계정 열거 방지 — 세 로케일 실제 문구도 서로 구분되지 않는다", () => {
  for (const { locale, auth } of LOCALES) {
    const texts = new Set(
      ENUMERATION_CODES.map((c) => auth[mapAuthError(firebaseError(c))])
    );
    assert.equal(
      texts.size,
      1,
      `${locale}: 자격증명 실패가 ${texts.size}가지 문구로 갈렸다 — ${[
        ...texts,
      ].join(" | ")}`
    );
  }
});

test("★문구가 이메일/비밀번호 중 한쪽만 지목하지 않는다", () => {
  // "이메일 또는 비밀번호" 처럼 둘을 함께 묶어야 한다. 한쪽만 언급하면
  // 어느 쪽이 틀렸는지 알려주는 셈이 된다.
  const PAIRS: Array<{ locale: string; email: RegExp; password: RegExp }> = [
    { locale: "ko", email: /이메일/, password: /비밀번호/ },
    { locale: "en", email: /email/i, password: /password/i },
    { locale: "ja", email: /メールアドレス/, password: /パスワード/ },
  ];
  for (const { locale, email, password } of PAIRS) {
    const auth = LOCALES.find((l) => l.locale === locale)!.auth;
    const text = auth.errorInvalidCredentials;
    const mentionsEmail = email.test(text);
    const mentionsPassword = password.test(text);
    assert.equal(
      mentionsEmail && mentionsPassword,
      true,
      `${locale}: 이메일·비밀번호를 함께 묶지 않았다 — "${text}"`
    );
  }
});

// ───────────────────────── 3. 나머지 매핑 ─────────────────────────

test("과다 시도·네트워크는 각각 자기 안내를 받는다", () => {
  assert.equal(
    mapAuthError(firebaseError("auth/too-many-requests")),
    "errorTooManyRequests"
  );
  assert.equal(
    mapAuthError(firebaseError("auth/network-request-failed")),
    "errorNetwork"
  );
});

test("네 키의 문구가 로케일마다 서로 다르다 — 한 문구로 뭉개지 않았다", () => {
  for (const { locale, auth } of LOCALES) {
    const texts = new Set(AUTH_ERROR_KEYS.map((k) => auth[k]));
    assert.equal(texts.size, AUTH_ERROR_KEYS.length, `${locale} 문구 중복`);
  }
});
