/**
 * Korean — `legal.*` namespace (Privacy policy page chrome: title, close,
 * section headings, contact prefix). The long-form policy body (summary,
 * the PIPA disclosure table, technical safeguards list) is NOT keyed here —
 * it lives in `components/legal/privacyContent.tsx` as split ko/en content
 * to avoid a key explosion. See ../README.md.
 */
export const legal = {
  "legal.privacy.title": "처리방침",
  "legal.privacy.close": "닫기",
  "legal.privacy.summaryHeading": "요약",
  "legal.privacy.measuresHeading": "기술적 보호조치",
  "legal.privacy.contactHeading": "연락처",
  "legal.privacy.contactPrefix": "처리방침 문의 / 데이터 삭제 요청: ",

  // ── Privacy consent modal (PrivacyConsentModal) ──────────
  "legal.consent.heading": "마블로를 더 안정적으로 만들도록 도와주세요",
  "legal.consent.body":
    "아래 <b>제3자 서비스(미국 호스팅)</b> 송신에 동의해 주시면 마블로가 빠르게 개선됩니다. <b>코드 내용 · BYOK 키 · 사용자 입력은 절대 보내지 않습니다.</b> 거부해도 모든 기능은 동일하게 작동합니다. (자체 운영 품질 지표는 식별정보 없는 비식별 데이터로만 수집 — 자세히 보기 참조.)",
  "legal.consent.sentry.label": "크래시 리포트 보내기 (Sentry, 미국 호스팅)",
  "legal.consent.sentry.hint":
    "스택 트레이스에서 파일 경로·환경변수·BYOK 키는 자동 마스킹.",
  "legal.consent.overseas.label": "국외 이전 별도 동의 (PIPA 제15조 제2항)",
  "legal.consent.overseas.hint":
    "Sentry는 미국 서버에서 데이터를 처리합니다. 위 항목을 켜려면 이 동의가 필수입니다.",
  "legal.consent.overseasRequired":
    "Sentry는 미국 호스팅이라 국외 이전 동의가 필수입니다.",
  "legal.consent.saveFailed": "저장 실패",
  "legal.consent.viewDetails": "자세히 보기 (수집 항목 · 기간 · 거부 효과)",
  "legal.consent.later": "나중에",
  "legal.consent.saving": "저장 중...",
  "legal.consent.allow": "허용",
};
