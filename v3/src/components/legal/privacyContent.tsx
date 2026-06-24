/**
 * Privacy policy long-form content — split ko/en.
 *
 * Why a content module instead of `legal.*` keys: the policy is a multi-row
 * PIPA disclosure table plus prose paragraphs and a safeguards list with
 * inline <code> markup. Keying every cell/sentence would explode the locale
 * table and fragment legally-sensitive copy. The whole body lives here as
 * parallel ko/en blocks (the long-form pattern in ../../locales/README.md);
 * page chrome (title/close/headings/contact prefix) stays as `legal.*` keys.
 *
 * This is read-only content. Update CURRENT_POLICY_VERSION in
 * privacyConsentService.ts when this text changes — that re-prompts existing
 * users on next launch.
 */
import type { Locale } from "../../lib/i18n";

export interface PrivacyRow {
  label: string;
  value: string;
}

interface PrivacyContent {
  summary: React.ReactNode;
  rows: PrivacyRow[];
  measures: React.ReactNode[];
  measuresFootnote: React.ReactNode;
}

const KO: PrivacyContent = {
  summary: (
    <>
      마블로 데스크톱 앱은 외부 <b>제3자 서비스(Sentry, 크래시 리포트)</b>{" "}
      송신을 <b>명시적 옵트인</b>으로 운영합니다. 자체 운영 품질을 위한 1차
      지표는 <b>식별정보를 제거한 비식별 데이터</b>로만, 우리 GCP(BigQuery)에
      수집합니다 — 계정 식별자(UID) 없이 익명 설치 ID만 사용합니다. 동의하지
      않아도 모든 기능은 동일하게 작동하며, 어느 경로로도 코드·BYOK 키·사용자
      입력 텍스트는 전송되지 않습니다. (마블로 웹사이트는 앱과 별개로 GA4를
      사용하며, 웹사이트 자체 쿠키 동의의 적용을 받습니다.)
    </>
  ),
  rows: [
    {
      label: "비식별 1차 지표 (BigQuery)",
      value:
        "마블로 자체 운영 품질을 위해 식별정보를 제거한 비식별 데이터만 우리 GCP(BigQuery)에 상시 수집합니다. 수집 항목: 익명 설치 ID(계정 UID 아님), 이벤트 종류, 토큰/비용/지속시간 등 집계 지표. 계정 식별자·코드·입력 텍스트는 포함되지 않으며, 에러 메시지는 송신 전 PII 마스킹됩니다.",
    },
    {
      label: "옵트인 항목 (앱 크래시)",
      value:
        "(동의 시에만) 크래시 스택 트레이스 (파일 경로 마스킹), 에러 메시지 (PII 마스킹), OS·앱 버전 — Sentry로 전송. 앱은 GA4·Mixpanel 등 사용 분석 도구로 데이터를 보내지 않습니다.",
    },
    {
      label: "웹사이트 분석 (GA4)",
      value:
        "마블로 웹사이트(marblo.app)는 데스크톱 앱과 별개로 GA4(Google Analytics 4)를 사용해 익명 방문 통계를 수집하며, 웹사이트 자체 쿠키 동의의 적용을 받습니다. 데스크톱 앱에는 적용되지 않습니다.",
    },
    {
      label: "미수집 항목",
      value:
        "코드 내용, BYOK 키 (Anthropic/OpenAI/Google), 사용자 작성 텍스트, 파일 내용, 비밀번호",
    },
    {
      label: "처리 위치",
      value:
        "비식별 1차 지표: 우리 GCP(BigQuery) — 식별정보 없음. 옵트인 Sentry(앱 크래시): 미국 (별도 국외 이전 동의 필요). 웹사이트 GA4: 미국.",
    },
    {
      label: "보유 기간",
      value:
        "비식별 1차 지표: 집계 분석 목적 보관 (개인 식별 불가). Sentry: 90일. 웹사이트 GA4: 14개월.",
    },
    {
      label: "거부 효과",
      value: "거부해도 마블로 모든 기능 정상 사용 가능 (PIPA 제15조 제3항)",
    },
    {
      label: "변경 권리",
      value:
        "Settings → Privacy 토글에서 언제든 변경 (PIPA 제22조). 데이터 삭제는 support@marblo.app으로 요청 (30일 이내 응답 의무, PIPA 제36조)",
    },
  ],
  measures: [
    <>
      파일 경로 (<code>/Users/*</code>, <code>C:\Users\*</code>,{" "}
      <code>/home/*</code>) → <code>&lt;USER_HOME&gt;</code> 자동 치환
    </>,
    <>
      환경변수 (<code>*_KEY</code>, <code>*_TOKEN</code>, <code>*_SECRET</code>,{" "}
      <code>MARBLO_*</code>, <code>ANTHROPIC_*</code>, <code>OPENAI_*</code>,{" "}
      <code>GOOGLE_*</code>) → <code>&lt;REDACTED&gt;</code>
    </>,
    <>
      이메일 주소 → <code>&lt;EMAIL&gt;</code>
    </>,
    <>
      전화번호 (한국 010-, 국제 +) → <code>&lt;PHONE&gt;</code>
    </>,
    <>
      BYOK API 키 (sk-ant-*, sk-*, AIza*) → <code>&lt;API_KEY&gt;</code>
    </>,
    <>오케스트레이터 prompt / 사용자 입력 텍스트 → 송신 차단</>,
    <>
      계정 식별자(senderId·userId·이메일) → 1차 텔레메트리에서 제거, 익명 설치
      ID로 대체
    </>,
  ],
  measuresFootnote: (
    <>
      구현: <code>v3/src/lib/telemetry/scrub.ts</code>. Sentry SDK beforeSend
      훅과 1차 BigQuery 텔레메트리 (<code>telemetryService.ts</code>) 양쪽에서
      적용됩니다.
    </>
  ),
};

const EN: PrivacyContent = {
  summary: (
    <>
      The Marblo desktop app runs all sends to external{" "}
      <b>third-party services (Sentry, crash reports)</b> on{" "}
      <b>explicit opt-in</b>. First-party metrics for our own operational
      quality are collected only as{" "}
      <b>de-identified data with identifiers removed</b>, into our GCP
      (BigQuery) — using an anonymous install ID with no account identifier
      (UID). Every feature works identically whether or not you consent, and on
      no path is your code, BYOK keys, or user input text transmitted. (The
      Marblo website uses GA4 separately from the app and is governed by the
      website's own cookie consent.)
    </>
  ),
  rows: [
    {
      label: "De-identified first-party metrics (BigQuery)",
      value:
        "For Marblo's own operational quality, only de-identified data with identifiers removed is collected continuously into our GCP (BigQuery). Collected: anonymous install ID (not the account UID), event type, and aggregate metrics like tokens/cost/duration. Account identifiers, code, and input text are not included, and error messages are PII-masked before send.",
    },
    {
      label: "Opt-in items (app crashes)",
      value:
        "(Only with consent) crash stack traces (file paths masked), error messages (PII-masked), and OS/app version — sent to Sentry. The app does not send data to usage-analytics tools like GA4 or Mixpanel.",
    },
    {
      label: "Website analytics (GA4)",
      value:
        "The Marblo website (marblo.app) uses GA4 (Google Analytics 4) separately from the desktop app to collect anonymous visit statistics, governed by the website's own cookie consent. It does not apply to the desktop app.",
    },
    {
      label: "Not collected",
      value:
        "Code contents, BYOK keys (Anthropic/OpenAI/Google), user-written text, file contents, passwords",
    },
    {
      label: "Processing location",
      value:
        "De-identified first-party metrics: our GCP (BigQuery) — no identifiers. Opt-in Sentry (app crashes): United States (requires separate cross-border transfer consent). Website GA4: United States.",
    },
    {
      label: "Retention period",
      value:
        "De-identified first-party metrics: retained for aggregate analysis (no personal identification). Sentry: 90 days. Website GA4: 14 months.",
    },
    {
      label: "Effect of declining",
      value:
        "All Marblo features work normally even if you decline (PIPA Article 15(3))",
    },
    {
      label: "Right to change",
      value:
        "Change anytime via the Settings → Privacy toggle (PIPA Article 22). For data deletion, request to support@marblo.app (response required within 30 days, PIPA Article 36)",
    },
  ],
  measures: [
    <>
      File paths (<code>/Users/*</code>, <code>C:\Users\*</code>,{" "}
      <code>/home/*</code>) → auto-replaced with <code>&lt;USER_HOME&gt;</code>
    </>,
    <>
      Environment variables (<code>*_KEY</code>, <code>*_TOKEN</code>,{" "}
      <code>*_SECRET</code>, <code>MARBLO_*</code>, <code>ANTHROPIC_*</code>,{" "}
      <code>OPENAI_*</code>, <code>GOOGLE_*</code>) →{" "}
      <code>&lt;REDACTED&gt;</code>
    </>,
    <>
      Email addresses → <code>&lt;EMAIL&gt;</code>
    </>,
    <>
      Phone numbers (Korea 010-, international +) → <code>&lt;PHONE&gt;</code>
    </>,
    <>
      BYOK API keys (sk-ant-*, sk-*, AIza*) → <code>&lt;API_KEY&gt;</code>
    </>,
    <>Orchestrator prompt / user input text → blocked from send</>,
    <>
      Account identifiers (senderId·userId·email) → removed from first-party
      telemetry, replaced with an anonymous install ID
    </>,
  ],
  measuresFootnote: (
    <>
      Implementation: <code>v3/src/lib/telemetry/scrub.ts</code>. Applied in
      both the Sentry SDK beforeSend hook and the first-party BigQuery telemetry
      (<code>telemetryService.ts</code>).
    </>
  ),
};

export const PRIVACY_CONTENT: Record<Locale, PrivacyContent> = {
  ko: KO,
  en: EN,
};
