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

  // ── 마케팅 수신동의(선택) — 위 텔레메트리 동의와 별개 축 ──
  "legal.consent.marketing.label":
    "마케팅 정보 수신 동의 (선택) — 제품 소식·업데이트·이벤트 안내 메일",
  "legal.consent.marketing.hint":
    "수신처: 가입 이메일. 동의하지 않아도 모든 기능을 동일하게 이용할 수 있고, 동의 후에도 메일 하단 수신거부 링크로 언제든 철회할 수 있습니다.",

  // ── 학습데이터 기여 동의 카드 (TrainingConsentCard) ──────
  // ★선택 동의다. 문구는 "무엇이 이미 켜져 있고(비식별), 이번에 무엇을 새로
  //   묻는지(원문)" 를 분리해서 말한다 — 두 축을 한 문장에 섞으면 사용자는
  //   자기가 무엇에 동의하는지 알 수 없다.
  "legal.training.heading":
    "마블로를 더 뛰어나게 — 내 작업으로 모델 개선에 기여",
  "legal.training.body":
    "마블로는 어떤 모델에 어떤 일을 맡길지 스스로 배웁니다. 원하시면 내 작업이 그 학습에 쓰이도록 도와주실 수 있습니다.",
  "legal.training.alreadyOn.label": "이미 켜짐 · 비식별 지표",
  "legal.training.alreadyOn.hint":
    "익명 설치 ID와 집계 지표(모델·소요시간·성공 여부 등 비식별 파생 특징)는 라우팅 품질 개선에 쓰입니다. 원문은 포함되지 않으며, Settings → Privacy 에서 언제든 끌 수 있습니다.",
  "legal.training.rawText.label": "선택 · 프롬프트·응답 원문 기여",
  "legal.training.rawText.hint":
    "내 에이전트 턴의 원문 텍스트(코드가 포함될 수 있습니다)를 자체 모델 학습용 별도 보안 저장소에 보관합니다. 비식별 지표와 완전히 분리된 경로이고, 제3자에게 제공되지 않으며, 언제든 철회할 수 있습니다. 동의는 즉시 기록되고 실제 수집은 순차 개방됩니다.",
  "legal.training.noPressure":
    "선택 항목입니다 — 참여하지 않아도 모든 기능이 동일하게 작동합니다.",
  "legal.training.viewDetails": "자세히 보기 (수집 항목 · 보관 · 철회)",
  "legal.training.optIn": "기여할게요",
  "legal.training.later": "나중에",
  "legal.training.saving": "저장 중...",
  "legal.training.thanks":
    "감사합니다! Settings → Privacy 에서 언제든 바꿀 수 있어요.",

  // ── 기존 사용자 재동의 배너 (MarketingReconsentBanner) ──
  "legal.reconsent.label": "마케팅 소식 받아보기",
  "legal.reconsent.basis":
    "제품 소식·업데이트·이벤트 안내를 가입 이메일로 받습니다. 선택 항목이며 메일 하단 수신거부로 언제든 철회할 수 있습니다.",
  "legal.reconsent.submit": "동의 저장",
  "legal.reconsent.saving": "저장 중...",
  "legal.reconsent.savedNotice": "동의가 저장됐습니다. 감사합니다!",
  "legal.reconsent.saveFailed": "저장 실패 — 잠시 후 다시 시도해 주세요.",
  "legal.reconsent.dismiss": "다시 안 보기",

  // ── 처리방침 1회성 명확화 고지 (PrivacyClarificationNotice) ──
  // ★동의를 받는 문구가 아니라 알리는 문구다. "동의"/"확인" 같은 승낙 어휘를
  //   쓰지 않는다 — 이 배너는 아무것도 저장하지 않는다.
  "legal.clarification.label": "개인정보 처리방침 안내",
  "legal.clarification.body":
    "제품 사용 분석에는 계정 식별자가 없습니다(익명 설치 ID만 사용). 토큰 사용량·비용 기록은 본인 사용량·요금 확인을 위해 계정에 연결됩니다.",
  "legal.clarification.viewDetails": "자세히",
  "legal.clarification.dismiss": "닫기",
};
