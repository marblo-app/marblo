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
  // 인증 초기화 타임아웃 — Firebase 설정 오류/네트워크 문제로 onAuthStateChanged 가
  // 발화하지 않아 무한 스피너에 갇히는 상황을 대체하는 안내 화면.
  "auth.init.timeout.title": "연결할 수 없습니다",
  "auth.init.timeout.message":
    "인증 서비스에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요. 문제가 계속되면 앱 설정에 오류가 있을 수 있으니 다시 설치하거나 지원팀에 문의해 주세요.",
  "auth.init.timeout.retry": "다시 시도",
  // 인증 초기화가 지연됐지만 로그인 자체는 가능한 경우(패키징 앱 persistence hang
  // 폴백) 로그인 화면 상단에 노출되는 얇은 안내 배너. dead-end 대신 로그인 시도를
  // 계속 진행할 수 있게 안내만 한다.
  "auth.init.degraded.banner":
    "인증 초기화가 지연되고 있습니다. 로그인은 계속 시도할 수 있습니다.",
};
