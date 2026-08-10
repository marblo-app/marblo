import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type {
  FundingProbeOutcome,
  OnboardingAuthState,
} from "../../lib/fundingProbe";
import { SUBSCRIPTION_URL, cliLabel } from "../../stores/cliSetupStore";
import { BUTTON_GHOST, BUTTON_PRIMARY, emphasize } from "./beginnerUi";

/**
 * ★"로그인은 됐는데 아무 일도 안 일어나요" 를 설명해 주는 가이드 모달
 * (티켓 sVdwTsiGq6qZVAmSkwZB).
 *
 * 여기까지 온 사용자는 우리가 시킨 것을 **전부 했다**: 설치했고, 브라우저에서
 * 승인했고, "연결됐어요" 도 봤다. 그런데 오케가 안 돈다. 그 계정에 구독이나
 * 크레딧이 없어서다. 이 화면이 없으면 사용자는 자기가 뭘 잘못했는지 알 도리가
 * 없고, 그 자리가 지금까지의 조용한 이탈 지점이었다.
 *
 * ★두 얼굴을 갖는다. 벤더가 "구독/크레딧이 없다" 를 사실상 문장으로 말한 경우
 * (`authedButUnfunded`)에만 구독을 단정하고, 그 밖의 실패는 전부 **중립**
 * (`authedButBlocked`)으로 말한다 — "인증은 됐는데 실행이 안 돼요". 판정이
 * 애매할 때 구독을 단정하면 이미 돈을 낸 사용자를 문 앞에서 돌려세우게 된다.
 * 판정 규칙 자체는 `lib/fundingProbe` 가 단일소스다.
 */

export interface SubscriptionNeededModalProps {
  /** `authedButUnfunded` | `authedButBlocked` 중 하나. */
  state: Extract<OnboardingAuthState, "authedButUnfunded" | "authedButBlocked">;
  outcome: FundingProbeOutcome | null;
  /** 재프로브가 도는 중 — 버튼이 스피너가 되고 모달은 그대로 서 있는다. */
  checking: boolean;
  /** "이미 구독했어요" → 재프로브. */
  onRecheck: () => void;
  onClose: () => void;
}

/** 중립 안내에서 사유별로 한 줄만 달라진다. 결론은 셋 다 같다(단정하지 않는다). */
const BLOCKED_BODY: Record<string, MessageKey> = {
  rate_limit: "beginner.funding.blocked.rateLimit",
  auth: "beginner.funding.blocked.auth",
  unknown: "beginner.funding.blocked.unknown",
};

export function SubscriptionNeededModal({
  state,
  outcome,
  checking,
  onRecheck,
  onClose,
}: SubscriptionNeededModalProps) {
  const { t } = useTranslation();

  const unfunded = state === "authedButUnfunded";
  const model = outcome?.model ?? "claude";
  const label = cliLabel(model);
  const subscriptionUrl = SUBSCRIPTION_URL[model];
  const blockedBody =
    BLOCKED_BODY[outcome?.blockedReason ?? "unknown"] ??
    "beginner.funding.blocked.unknown";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        data-testid="beginner-funding-modal"
        data-state={state}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#313244] bg-[#181825] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-[#313244] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[#cdd6f4]">
              {t(
                unfunded
                  ? "beginner.funding.unfunded.title"
                  : "beginner.funding.blocked.title",
              )}
            </h2>
            <p
              data-testid="beginner-funding-body"
              className="mt-1 text-xs leading-5 text-[#a6adc8]"
            >
              {t(unfunded ? "beginner.funding.unfunded.body" : blockedBody, {
                cli: label,
              })}
            </p>
          </div>
          <button
            type="button"
            data-testid="beginner-funding-close"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-[#7f849c] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
            aria-label={t("beginner.funding.close")}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {/* ── 1-2-3: 무엇을 눌러야 하는지. 구독이 확실할 때만 그린다. ──── */}
          {unfunded && (
            <ol
              data-testid="beginner-funding-steps"
              className="space-y-2 text-xs leading-5 text-[#cdd6f4]"
            >
              {(
                [
                  "beginner.funding.step1",
                  "beginner.funding.step2",
                  "beginner.funding.step3",
                ] as MessageKey[]
              ).map((key, i) => (
                <li key={key} className="flex gap-2">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#89b4fa]/20 text-[10px] font-semibold text-[#89b4fa]">
                    {i + 1}
                  </span>
                  {/* step2 에 `**같은 계정**` 강조가 들어 있다 — 별표가 그대로
                      보이지 않게 <strong> 으로 쪼개 그린다. */}
                  <span className="min-w-0">
                    {emphasize(t(key, { cli: label }))}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* 벤더 구독 페이지. 링크가 없는 CLI(antigravity 등)면 이 칸은 빠진다 —
              갈 곳이 없는 버튼을 그리느니 안 그리는 게 낫다. */}
          {subscriptionUrl && (
            <a
              data-testid="beginner-funding-subscribe"
              href={subscriptionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${BUTTON_PRIMARY} mt-4 inline-block no-underline`}
            >
              {t("beginner.funding.openSubscription", { cli: label })} ↗
            </a>
          )}

          {/* ── API 요금제 간단 결제 — 자리만 잡아 둔다 ────────────────────
              결제 배선(재판매·쿠폰)은 별도 스파이크(OF2wawHo)의 결과에 달려
              있다. 그때까지 **누를 수 있는** 버튼을 두면 아무 일도 안 일어나는
              버튼이 되므로, 비활성 안내로 자리만 지킨다. */}
          <div
            data-testid="beginner-funding-api-placeholder"
            className="mt-4 rounded-md border border-dashed border-[#45475a] bg-[#11111b]/50 px-3 py-2.5"
          >
            <p className="text-xs font-medium text-[#a6adc8]">
              {t("beginner.funding.apiPlan.title")}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-[#7f849c]">
              {t("beginner.funding.apiPlan.body")}
            </p>
          </div>

          {/* 원문 꼬리 — 무슨 일이 있었는지 감추지 않는다. 중립 안내에서 특히
              중요하다(우리가 원인을 모른다고 사용자까지 몰라야 할 이유는 없다). */}
          {outcome?.detail && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-[#7f849c] hover:text-[#a6adc8]">
                {t("beginner.funding.detail")}
              </summary>
              <pre
                data-testid="beginner-funding-detail"
                className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[#11111b] p-2 font-mono text-[10px] leading-4 text-[#a6adc8]"
              >
                {outcome.detail}
              </pre>
            </details>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#313244] px-5 py-3">
          <button
            type="button"
            data-testid="beginner-funding-recheck"
            onClick={onRecheck}
            disabled={checking}
            className={`${BUTTON_PRIMARY} disabled:opacity-60`}
          >
            {t(
              checking
                ? "beginner.funding.rechecking"
                : "beginner.funding.recheck",
            )}
          </button>
          <button
            type="button"
            data-testid="beginner-funding-later"
            onClick={onClose}
            className={BUTTON_GHOST}
          >
            {t("beginner.funding.later")}
          </button>
          <span className="ml-auto text-[11px] text-[#585b70]">
            {t("beginner.funding.footerHint")}
          </span>
        </div>
      </div>
    </div>
  );
}
