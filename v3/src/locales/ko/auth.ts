/**
 * Korean — `auth.*` namespace (auth/AuthProvider login error fallbacks).
 *
 * These are the human-readable fallbacks shown when Firebase Auth throws a
 * non-Error value. Reached via the pure t() (AuthProvider is React, but the
 * strings are assigned in async catch blocks), so they live in the table.
 */
export const auth = {
  "auth.error.google": "구글 로그인에 실패했습니다.",
  "auth.error.github": "GitHub 로그인에 실패했습니다.",
  "auth.error.email": "이메일 로그인에 실패했습니다.",
  "auth.error.signup": "회원가입에 실패했습니다.",
  "auth.error.logout": "로그아웃에 실패했습니다.",
};
