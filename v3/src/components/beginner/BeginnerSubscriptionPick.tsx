import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { CliProbeLike } from "../../lib/oneClickSetup";
import {
  SUBSCRIPTION_CHOICES,
  isSignedIn,
  needsInstall,
} from "../../lib/loginPrompt";
import { ROWS, type CliModel } from "../../stores/cliSetupStore";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "./beginnerUi";

/**
 * "어떤 구독을 가지고 계세요?" — 자동설치와 로그인 사이의 질문 하나
 * (티켓 LLHMclpKaIAJbsiHzGoG).
 *
 * ★이 화면이 없을 때 무슨 일이 벌어졌나: 설치는 끝나는데 원클릭이 오케 후보
 * **하나**(claude 우선)의 로그인 창을 자동으로 띄웠고, 그 사용자가 가진 것이
 * ChatGPT 구독이면 승인할 수 있는 게 아무것도 없었다. 화면은 "브라우저에서
 * 승인만 하시면 됩니다" 를 계속 띄우고, 사용자는 승인할 것이 없다. 콜드테스트가
 * 지목한 이탈 지점이 정확히 여기다.
 *
 * 질문은 **가진 것**을 묻는다("필요한 것" 이 아니라). 신규 유저에게 "무엇이
 * 필요한가" 는 답할 수 없는 질문이고, "무엇을 가지고 있나" 는 이미 아는 사실이다.
 *
 * ★이미 로그인된 CLI 는 체크된 채로 서고 버튼이 비활성이다. 감춰 버리면 "내
 * Claude 는 왜 여기 없지?" 가 되고, 그냥 체크 가능하게 두면 이미 끝난 로그인을
 * 다시 시키게 된다. 판정은 기존 프로브 결과 하나뿐이다(`lib/loginPrompt`).
 *
 * 결정만 받아 상위로 올린다 — 설치·스폰·저장 같은 부수효과는 하나도 들지 않는다.
 */

const CHOICE_KEYS: Record<CliModel, { name: MessageKey; desc: MessageKey }> = {
  claude: {
    name: "beginner.login.claudeName",
    desc: "beginner.login.claudeDesc",
  },
  codex: {
    name: "beginner.login.codexName",
    desc: "beginner.login.codexDesc",
  },
  grok: { name: "beginner.login.grokName", desc: "beginner.login.grokDesc" },
  antigravity: {
    // SUBSCRIPTION_CHOICES 에 없다 — 표를 전 축으로 채워 두는 것은 타입이
    // 요구해서일 뿐이다(선택지가 늘 때 문구를 빠뜨리지 않게 하는 장치이기도 하다).
    name: "beginner.login.grokName",
    desc: "beginner.login.grokDesc",
  },
};

export interface BeginnerSubscriptionPickProps {
  results: Record<string, CliProbeLike | undefined>;
  selected: readonly CliModel[];
  onToggle: (model: CliModel) => void;
  onConfirm: () => void;
  /** "아직 구독이 없어요" — 이 흐름을 벗어난다(모달의 '직접 고를게요' 와 같은 문). */
  onNone: () => void;
}

export function BeginnerSubscriptionPick({
  results,
  selected,
  onToggle,
  onConfirm,
  onNone,
}: BeginnerSubscriptionPickProps) {
  const { t } = useTranslation();
  const anyAlreadySignedIn = SUBSCRIPTION_CHOICES.some((model) =>
    isSignedIn(ROWS, results, model)
  );

  return (
    <section data-testid="beginner-subscription-pick" className="mt-4">
      <h3 className="text-sm font-semibold text-[#cdd6f4]">
        {t("beginner.login.title")}
      </h3>
      <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
        {t("beginner.login.body")}
      </p>

      <div className="mt-3 space-y-2">
        {SUBSCRIPTION_CHOICES.map((model) => {
          const signedIn = isSignedIn(ROWS, results, model);
          const checked = signedIn || selected.includes(model);
          const keys = CHOICE_KEYS[model];
          return (
            <label
              key={model}
              data-testid={`beginner-subscription-${model}`}
              data-signed-in={signedIn ? "true" : "false"}
              data-checked={checked ? "true" : "false"}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                signedIn
                  ? "cursor-default border-[#a6e3a1]/40 bg-[#a6e3a1]/5"
                  : checked
                  ? "border-[#89b4fa]/50 bg-[#89b4fa]/5"
                  : "border-[#45475a] bg-[#11111b] hover:border-[#585b70]"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                // 이미 로그인된 줄은 결정이 끝난 줄이다 — 체크를 풀어도 할 일이
                // 생기지 않으므로 잠근다.
                disabled={signedIn}
                onChange={() => onToggle(model)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#89b4fa]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[#cdd6f4]">
                  {t(keys.name)}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-[#7f849c]">
                  {t(keys.desc)}
                </span>
              </span>
              {signedIn ? (
                <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[#a6e3a1]">
                  ✓ {t("beginner.login.alreadySignedIn")}
                </span>
              ) : (
                needsInstall(ROWS, results, model) && (
                  // 그록은 자동설치 대상이 아니다 — 고르면 설치까지 이어진다는
                  // 사실을 고르기 **전에** 말한다.
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-[#f9e2af]">
                    {t("beginner.login.needsInstall")}
                  </span>
                )
              )}
            </label>
          );
        })}
      </div>

      {anyAlreadySignedIn && (
        <p
          data-testid="beginner-subscription-autoskip"
          className="mt-2 text-[11px] leading-5 text-[#a6e3a1]"
        >
          {t("beginner.login.autoSkipped")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="beginner-subscription-confirm"
          onClick={onConfirm}
          disabled={selected.length === 0}
          className={`${BUTTON_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {t("beginner.login.confirm")}
        </button>
        <button
          type="button"
          data-testid="beginner-subscription-none"
          onClick={onNone}
          className={BUTTON_GHOST}
        >
          {t("beginner.login.noSubscription")}
        </button>
        <span className="ml-auto text-[11px] text-[#7f849c]">
          {selected.length === 0
            ? t("beginner.login.confirmEmpty")
            : t("beginner.login.selected", { count: selected.length })}
        </span>
      </div>
    </section>
  );
}
