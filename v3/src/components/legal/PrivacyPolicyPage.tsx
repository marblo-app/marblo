/**
 * Privacy policy page. Linked from the consent modal "자세히 보기" and
 * from Settings → Privacy. Matches PIPA 제15조 제2항 동의 항목 + the
 * §15.4 table from the v3.1 launch master plan.
 *
 * This is read-only content. Update CURRENT_POLICY_VERSION in
 * privacyConsentService.ts when this text changes — that re-prompts
 * existing users on next launch.
 */

interface PrivacyPolicyPageProps {
  /** Optional close handler — when rendered as a modal sheet. */
  onClose?: () => void;
}

const ROW: { label: string; value: string }[] = [
  {
    label: "수집 항목",
    value:
      "크래시 스택 트레이스 (파일 경로 마스킹), 에러 메시지 (PII 마스킹), OS·앱 버전, 익명 사용 패턴 (클릭/페이지 이동)",
  },
  {
    label: "미수집 항목",
    value:
      "코드 내용, BYOK 키 (Anthropic/OpenAI/Google), 사용자 작성 텍스트, 파일 내용, 비밀번호",
  },
  {
    label: "처리 위치",
    value: "Sentry / GA4 / Mixpanel 모두 미국 (별도 국외 이전 동의 필요)",
  },
  {
    label: "보유 기간",
    value: "Sentry 90일 / GA4 14개월 / Mixpanel 12개월",
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
];

export function PrivacyPolicyPage({ onClose }: PrivacyPolicyPageProps) {
  return (
    <div className="flex h-full w-full flex-col bg-[#181825] text-[#cdd6f4]">
      <div className="flex items-center justify-between border-b border-[#313244] px-6 py-4">
        <h1 className="text-base font-semibold">처리방침</h1>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
            aria-label="닫기"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 text-sm">
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#89b4fa]">
            요약
          </h2>
          <p className="text-[#bac2de] leading-relaxed">
            마블로는 모든 외부 송신 텔레메트리를 <b>명시적 옵트인</b>으로
            운영합니다. 동의하지 않아도 모든 기능은 동일하게 작동합니다. 동의
            후에도 코드/BYOK 키/사용자 입력 텍스트는 절대 외부로 전송되지
            않습니다.
          </p>
        </section>

        <section className="rounded border border-[#313244] bg-[#11111b]">
          <table className="w-full text-xs">
            <tbody>
              {ROW.map((r) => (
                <tr
                  key={r.label}
                  className="border-b border-[#313244] last:border-0"
                >
                  <th className="w-32 px-3 py-2 text-left align-top font-medium text-[#6c7086]">
                    {r.label}
                  </th>
                  <td className="px-3 py-2 text-[#cdd6f4] leading-relaxed">
                    {r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#89b4fa]">
            기술적 보호조치
          </h2>
          <ul className="list-disc pl-5 text-[#bac2de] space-y-1">
            <li>
              파일 경로 (<code>/Users/*</code>, <code>C:\Users\*</code>,{" "}
              <code>/home/*</code>) → <code>&lt;USER_HOME&gt;</code> 자동 치환
            </li>
            <li>
              환경변수 (<code>*_KEY</code>, <code>*_TOKEN</code>,{" "}
              <code>*_SECRET</code>, <code>MARBLO_*</code>,{" "}
              <code>ANTHROPIC_*</code>, <code>OPENAI_*</code>,{" "}
              <code>GOOGLE_*</code>) → <code>&lt;REDACTED&gt;</code>
            </li>
            <li>
              이메일 주소 → <code>&lt;EMAIL&gt;</code>
            </li>
            <li>
              전화번호 (한국 010-, 국제 +) → <code>&lt;PHONE&gt;</code>
            </li>
            <li>
              BYOK API 키 (sk-ant-*, sk-*, AIza*) → <code>&lt;API_KEY&gt;</code>
            </li>
            <li>오케스트레이터 prompt / 사용자 입력 텍스트 → 송신 차단</li>
          </ul>
          <p className="mt-2 text-[10px] text-[#6c7086]">
            구현: <code>v3/src/lib/telemetry/scrub.ts</code>. Sentry SDK
            beforeSend 훅과 GA4 event params 양쪽에서 적용됩니다.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#89b4fa]">
            연락처
          </h2>
          <p className="text-[#bac2de]">
            처리방침 문의 / 데이터 삭제 요청:{" "}
            <a
              href="mailto:support@marblo.app"
              className="text-[#89b4fa] hover:underline"
            >
              support@marblo.app
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
