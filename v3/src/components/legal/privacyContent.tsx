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
 *
 * ★예외 하나(ticket QFNrT4Z4dG9nGoRYmTlr): 라우팅 이용 목적 고지와 원문 기여
 * 항목을 추가하면서 버전은 올리지 않았다. 판단 근거는 "무엇을 수집하는지" 가
 * 아니라 "무엇이 바뀌었는지" 다:
 *   - 라우팅 문구는 이미 동의받아 수집 중인 비식별 지표의 **이용 목적을 더
 *     명확히 밝히는 것**이다. 수집 항목·보유기간·수령자는 그대로다. 고지를
 *     강화했다는 이유로 전 사용자에게 동의 모달을 다시 띄우는 것은
 *     (#797~#809 재프롬프트 saga) 얻는 것보다 잃는 게 크다.
 *   - 원문 기여는 **새 항목**이 맞지만, 그래서 이 모달이 아니라 별도의 명시
 *     옵트인(TrainingConsentCard, TRAINING_CONSENT_VERSION)으로 분리했다.
 *     기본 off 이고, 여기 표에는 "무엇에 동의하게 되는지" 를 적어 둔다.
 * 수집 항목 자체가 늘어나면 그때는 반드시 버전을 올린다.
 *
 * ★예외 둘(ticket woXp2c70oR0tliGB8Vs6): 익명화 강화 + 사용량 기록 고지.
 * 여기서도 버전은 올리지 않는다. 같은 기준("무엇이 바뀌었는지")으로 판정한다:
 *   - 이 문서는 이미 이벤트 텔레메트리를 "계정 UID 없이 익명 설치 ID만" 이라고
 *     고지하고 있었는데, 실제로는 서버(logTelemetryBatch)가 모든 이벤트에
 *     accountUserId=Firebase uid 를 얹고 있었다. 이번 변경은 그 부착을 **중단**
 *     한 것 — 즉 수집 항목이 늘어난 게 아니라 **줄었고**, 문구가 뒤늦게 사실이
 *     됐다. 축소 방향 변경으로 전 사용자 재프롬프트를 하는 건 (#797~#809
 *     재프롬프트 saga) 명백히 손해다.
 *   - 사용량·비용 기록(계정 연결) 행은 **새 수집이 아니라 이미 수집 중이던
 *     것의 누락된 고지**다. 이것 하나는 "몰랐던 사실을 알게 되는" 변경이라
 *     조용히 넘기지 않고, 버전 재프롬프트 대신 1회성 인앱 고지 배너로 알린다
 *     (PrivacyClarificationNotice). 배너는 동의를 새로 받지 않는다 — 받을
 *     동의가 없기 때문이다(정산 목적 필수 기록).
 * 수집 항목 자체가 늘어나면 그때는 반드시 버전을 올린다는 원칙은 그대로다.
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
      수집합니다 — 계정 식별자(UID)는 <b>보내는 쪽에서도, 받는 서버에서도</b>{" "}
      붙이지 않고 익명 설치 ID만 사용합니다. 다만 <b>토큰 사용량·비용 기록</b>은
      성격이 다릅니다: 회원님께 본인 사용량·요금을 되돌려 보여드려야 하므로 그
      기록만은 계정에 연결됩니다. 동의하지 않아도 모든 기능은 동일하게 작동하며,
      어느 경로로도 코드·BYOK 키·사용자 입력 텍스트는 전송되지 않습니다. (마블로
      웹사이트는 앱과 별개로 GA4를 사용하며, 웹사이트 자체 쿠키 동의의 적용을
      받습니다.)
    </>
  ),
  rows: [
    {
      label: "비식별 1차 지표 (BigQuery)",
      value:
        "마블로 자체 운영 품질을 위해 식별정보를 제거한 비식별 데이터만 우리 GCP(BigQuery)에 상시 수집합니다. 수집 항목: 익명 설치 ID(계정 UID 아님), 이벤트 종류, 토큰/지속시간 등 집계 지표. 계정 식별자·코드·입력 텍스트는 포함되지 않으며, 에러 메시지는 송신 전 PII 마스킹됩니다. ★계정 식별자(UID)는 클라이언트가 보내지 않을 뿐 아니라 서버도 부착하지 않습니다 — 이 이벤트 기록의 상관키는 익명 설치 ID 하나뿐이라, 우리도 이벤트를 특정 계정으로 되짚을 수 없습니다(그 대가로 계정 단위 이벤트 분석은 포기했습니다). 설치 ID 는 기기·설치별로 새로 생성되며 앱 데이터를 지우면 새 값이 됩니다. 이용 목적: 서비스 품질 분석과 함께, 이 비식별 데이터에서 파생된 특징(모델·소요시간·성공 여부 등)을 모델 라우팅(어떤 작업을 어떤 모델에 배정할지) 품질 개선에 이용합니다 — 프롬프트·응답 원문은 여기에 포함되지 않습니다.",
    },
    {
      label: "사용량·비용 기록 (계정 연결)",
      value:
        "구독·요금 정산과 회원님 본인의 사용량 확인(설정 → 사용량)을 위해, 에이전트 실행의 토큰 수·추정 비용·모델명·시각을 계정에 연결해 기록합니다. 이 기록만은 성격상 익명일 수 없습니다 — 본인 지출을 본인에게 보여드리려면 계정과 이어져 있어야 하기 때문입니다. 위 비식별 이벤트 기록과는 별도 테이블이고 그쪽에는 계정 식별자를 넣지 않습니다. 다만 두 기록에 같은 에이전트 실행 ID가 들어갈 수 있어 기술적으로 완전한 분리는 아닙니다 — '비식별'은 '이벤트 기록 자체에 계정 식별자를 넣지 않는다'는 뜻이며, 절대적 재식별 불가능성을 뜻하지는 않습니다. 이 연결은 운영자 본인 활동을 통계에서 제외하는 용도로만 쓰고, 개별 이용자를 지목하는 데 쓰지 않습니다. 코드·프롬프트·응답 원문은 여기에도 포함되지 않습니다.",
    },
    {
      label: "학습데이터 기여 (선택 · 원문)",
      value:
        "(명시적으로 동의한 경우에만) 내 에이전트 턴의 프롬프트·응답 원문 텍스트를 자체 모델 학습 목적으로 별도 보안 저장소에 보관합니다. 위 비식별 지표와는 저장소·경로가 완전히 분리되며, 제3자에게 제공·판매하지 않습니다. 기본값은 꺼짐이고, Settings → Privacy 에서 언제든 끌 수 있습니다(끄면 이후 수집이 즉시 중단되고, 기존 데이터 삭제는 support@marblo.app 요청으로 처리합니다). 동의하지 않아도 모든 기능은 동일하게 작동합니다.",
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
        "코드 내용, BYOK 키 (Anthropic/OpenAI/Google), 사용자 작성 텍스트, 파일 내용, 비밀번호 — 비식별 1차 지표와 Sentry 경로에서는 어떤 경우에도 수집하지 않습니다. (위 '학습데이터 기여' 에 명시적으로 동의한 경우에만, 그 별도 경로로 프롬프트·응답 원문이 보관됩니다. BYOK 키·비밀번호는 그 경로에서도 수집하지 않습니다.)",
    },
    {
      label: "처리 위치",
      value:
        "비식별 1차 지표: 우리 GCP(BigQuery) — 계정 식별자 없음. 사용량·비용 기록: 우리 GCP(BigQuery) 별도 테이블 — 계정에 연결됨. 학습데이터 기여(동의 시): 우리 GCP 내 별도 보안 데이터셋 — 비식별 지표와 접근 권한이 분리됩니다. 옵트인 Sentry(앱 크래시): 미국 (별도 국외 이전 동의 필요). 웹사이트 GA4: 미국.",
    },
    {
      label: "보유 기간",
      value:
        "비식별 1차 지표: 집계 분석 목적 보관 (계정 식별자 없음). 사용량·비용 기록: 구독·정산 확인 목적 보관 — 삭제 요청은 support@marblo.app(30일 이내 응답, PIPA 제36조)으로 처리하되, 정산 근거로 보존이 필요한 기간은 예외입니다. 학습데이터 기여(동의 시): 모델 학습 목적 보관 — 동의를 끄면 이후 수집이 중단되고, 기존 데이터 삭제는 support@marblo.app 요청으로 처리(30일 이내 응답, PIPA 제36조). Sentry: 90일. 웹사이트 GA4: 14개월.",
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
    <>
      ★서버 역시 이벤트에 계정 UID를 <b>다시 붙이지 않습니다</b> — 수신 함수가
      로그인 여부만 확인하고(도용 방지) uid는 저장하지 않습니다
    </>,
  ],
  measuresFootnote: (
    <>
      구현: <code>v3/src/lib/telemetry/scrub.ts</code>(클라이언트) ·{" "}
      <code>v3/functions/src/telemetryMetadata.ts</code>(서버). Sentry SDK
      beforeSend 훅과 1차 BigQuery 텔레메트리 (<code>telemetryService.ts</code>)
      양쪽에서 적용됩니다.
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
      (BigQuery) — using an anonymous install ID, with no account identifier
      (UID) attached <b>either by the app or by our server</b>. One record works
      differently: <b>token usage and cost</b> is linked to your account,
      because showing you your own usage and billing requires it. Every feature
      works identically whether or not you consent, and on no path is your code,
      BYOK keys, or user input text transmitted. (The Marblo website uses GA4
      separately from the app and is governed by the website's own cookie
      consent.)
    </>
  ),
  rows: [
    {
      label: "De-identified first-party metrics (BigQuery)",
      value:
        "For Marblo's own operational quality, only de-identified data with identifiers removed is collected continuously into our GCP (BigQuery). Collected: anonymous install ID (not the account UID), event type, and aggregate metrics like tokens/duration. Account identifiers, code, and input text are not included, and error messages are PII-masked before send. ★The account UID is not only withheld by the app — our receiving function does not attach one either. The only correlation key on these event rows is the anonymous install ID, so not even we can trace an event back to a specific account (the price we pay is giving up account-level event analysis). The install ID is generated per device/installation and becomes a new value if you clear app data. Purpose of use: service quality analysis, plus improving model routing quality (which task is assigned to which model) from features derived from this de-identified data (model, duration, success) — raw prompts and responses are never part of this.",
    },
    {
      label: "Usage & cost records (account-linked)",
      value:
        "For subscription/billing reconciliation and for showing you your own usage (Settings → Usage), we record each agent run's token counts, estimated cost, model name, and timestamp linked to your account. This record cannot be anonymous by nature — showing you your own spend requires it to be tied to your account. It lives in a separate table from the de-identified events above, and no account identifier is written to that one. It is not a perfect technical separation, though: the same agent-run ID can appear in both, so 'de-identified' means 'no account identifier is written into the event rows', not an absolute guarantee against re-identification. We use that link only to exclude our own operator activity from statistics, never to single out an individual user. Code and raw prompts/responses are not included here either.",
    },
    {
      label: "Training-data contribution (optional · raw text)",
      value:
        "(Only with your explicit consent) the raw prompt/response text of your own agent turns is stored in a separate secure store to train our own models. Its storage and pipeline are fully isolated from the de-identified metrics above, and it is never shared with or sold to third parties. Off by default, and you can turn it off any time in Settings → Privacy (collection stops immediately; deletion of already-stored data is handled by request to support@marblo.app). All features work identically if you decline.",
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
        "Code contents, BYOK keys (Anthropic/OpenAI/Google), user-written text, file contents, passwords — never collected on the de-identified first-party or Sentry paths. (Only if you explicitly opted into 'Training-data contribution' above does raw prompt/response text get stored, on that separate path. BYOK keys and passwords are not collected there either.)",
    },
    {
      label: "Processing location",
      value:
        "De-identified first-party metrics: our GCP (BigQuery) — no account identifiers. Usage & cost records: a separate table in our GCP (BigQuery) — account-linked. Training-data contribution (with consent): a separate secure dataset in our GCP, with access separated from the de-identified metrics. Opt-in Sentry (app crashes): United States (requires separate cross-border transfer consent). Website GA4: United States.",
    },
    {
      label: "Retention period",
      value:
        "De-identified first-party metrics: retained for aggregate analysis (no account identifiers). Usage & cost records: retained for subscription/billing reconciliation — deletion requests go to support@marblo.app (response within 30 days, PIPA Art. 36), except where retention is required as billing evidence. Training-data contribution (with consent): retained for model training — turning consent off stops further collection, and deletion of stored data is handled by request to support@marblo.app (response within 30 days, PIPA Art. 36). Sentry: 90 days. Website GA4: 14 months.",
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
    <>
      ★The server does not re-attach an account UID either — the receiving
      function checks only that you are signed in (abuse prevention) and never
      stores the uid
    </>,
  ],
  measuresFootnote: (
    <>
      Implementation: <code>v3/src/lib/telemetry/scrub.ts</code> (client) ·{" "}
      <code>v3/functions/src/telemetryMetadata.ts</code> (server). Applied in
      both the Sentry SDK beforeSend hook and the first-party BigQuery telemetry
      (<code>telemetryService.ts</code>).
    </>
  ),
};

export const PRIVACY_CONTENT: Record<Locale, PrivacyContent> = {
  ko: KO,
  en: EN,
};
