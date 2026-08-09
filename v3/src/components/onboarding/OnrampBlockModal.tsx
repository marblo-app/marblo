import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { onrampBlockCtaKey } from "../../lib/onrampGate";
import type { OnrampBlockPlan } from "../../lib/onrampGate";
import { cliLabel, type CliModel } from "../../stores/cliSetupStore";

/**
 * M1 — "여기까지는 무료로 볼 수 있어요" (설계 §5-A).
 *
 * ★이 모달은 **새 게이트가 아니다.** 스폰은 이미 `checkSpawnAuthGate` 가 PTY·
 * 워크트리 부수효과 **전에** 막고 있었다. 없던 것은 목소리다 — 비기너 셸은
 * `needsAuth` 봉투를 해석하는 화면 목록에 아예 없어서, L0 유저가 실행을 눌러도
 * 화면에 아무 일도 일어나지 않았다(설계 §4-G).
 *
 * 그래서 문구의 일이 둘이다:
 *  ① **안심시킨다** — "이 티켓들은 진짜입니다, 보드에 그대로 남아요." 방금 만든
 *     것이 사라지지 않는다는 사실이 먼저다(불변식 I3 를 유저 말로 옮긴 것).
 *  ② **원가 0인 칸을 먼저 가리킨다** — "추가 비용은 없어요, 이미 쓰는 구독을
 *     그대로 씁니다"(불변식 I2). 크레딧이 앞에 서면 우리는 "비싸게 파는 곳" 이
 *     된다.
 *
 * 고스트 CTA("티켓만 더 만들어 볼게요")를 **항상** 남긴다 — 세션 2회 상한과 함께
 * "조르는 모달" 로 읽히는 것을 막는 장치다(리스크 R3).
 */

export interface OnrampBlockModalProps {
  plan: OnrampBlockPlan;
  /** 주 CTA — 연결 경로를 여는 것은 셸마다 다르다(호스트가 넘긴다). */
  onConnect: () => void;
  /**
   * 부 CTA("다른 방법 보기" → BYOK). ★없으면 **그리지 않는다** — 갈 곳 없는
   * 버튼을 그리느니 안 그리는 게 낫다는 이 repo 의 기존 규율 그대로다
   * (SubscriptionNeededModal 의 구독 링크 처리와 같은 자세). 비기너 셸에는
   * BYOM 표면이 의도적으로 없으므로 거기서는 undefined 다(설계 §6-B).
   */
  onAlternatives?: () => void;
  onClose: () => void;
}

/**
 * ★`cliLabel` 은 모르는 값을 조용히 "Antigravity (agy)" 로 접는다(else 분기).
 * 차단 봉투의 `model` 은 벤더 env-swap 행에서도 오므로, 아는 이름일 때만
 * 라벨을 쓰고 나머지는 **원문 그대로** 보여준다 — 남의 CLI 이름을 붙여
 * 사용자를 엉뚱한 로그인으로 보내는 것이 이 화면의 최악 실패다(#642 의 교훈).
 */
const KNOWN_CLI: readonly string[] = ["claude", "codex", "grok", "antigravity"];

const REASON_KEY: Record<string, MessageKey> = {
  decompose_limit: "onramp.block.reason.limit",
  demo_ticket_run: "onramp.block.reason.run",
  spawn_needs_auth: "onramp.block.reason.run",
};

export function OnrampBlockModal({
  plan,
  onConnect,
  onAlternatives,
  onClose,
}: OnrampBlockModalProps) {
  const { t } = useTranslation();
  const label = KNOWN_CLI.includes(plan.model)
    ? cliLabel(plan.model as CliModel)
    : plan.model;
  const ctaKey = onrampBlockCtaKey(plan.installed) as MessageKey;
  const reasonKey = REASON_KEY[plan.trigger] ?? "onramp.block.reason.run";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        data-testid="onramp-block-modal"
        data-trigger={plan.trigger}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#313244] bg-[#181825] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-[#313244] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[#cdd6f4]">
              {t("onramp.block.title")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
              {t(reasonKey)}
            </p>
          </div>
          <button
            type="button"
            data-testid="onramp-block-close"
            onClick={onClose}
            aria-label={t("onramp.block.close")}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-[#7f849c] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <p className="text-xs leading-6 text-[#cdd6f4]">
            {t("onramp.block.body")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#313244] px-5 py-3">
          <button
            type="button"
            data-testid="onramp-block-connect"
            onClick={onConnect}
            className="inline-flex h-8 items-center rounded-md bg-[#89b4fa] px-3 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
          >
            {t(ctaKey, { cli: label })}
          </button>
          {onAlternatives && (
            <button
              type="button"
              data-testid="onramp-block-alternatives"
              onClick={onAlternatives}
              title={t("onramp.block.altHint")}
              className="inline-flex h-8 items-center rounded-md border border-[#45475a] px-3 text-xs font-medium text-[#cdd6f4] transition-colors hover:bg-[#313244]"
            >
              {t("onramp.block.alt")}
            </button>
          )}
          {/* 항상 남는 탈출구 — 이게 없으면 모달이 조르는 것으로 읽힌다(R3). */}
          <button
            type="button"
            data-testid="onramp-block-ghost"
            onClick={onClose}
            className="ml-auto text-[11px] text-[#7f849c] underline decoration-dotted transition-colors hover:text-[#cdd6f4]"
          >
            {t("onramp.block.ghost")}
          </button>
        </div>
      </div>
    </div>
  );
}
