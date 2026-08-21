import { useState, type ReactNode } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { ROWS, useCliSetupStore } from "../../stores/cliSetupStore";
import { useVendorSecretsStore } from "../../stores/vendorSecretsStore";
import type { VendorSetupCard } from "../../lib/vendorOnboarding";
import { CliRowCard, CommandBox } from "./CliSetupRows";

/**
 * 벤더 한 칸의 UI — **첫 켰을 때 해야 하는 한 가지** + **띄우는 법 한 줄**.
 *
 * 세 화면이 이 컴포넌트를 공유한다:
 *   - 시작하기 탭의 "다른 벤더 모델 붙이기" 섹션(#632, VendorModelsSection)
 *   - ②단계의 BYOM 대안(F4, ByomStartSection)
 *   - 하네스 탭의 env-swap 벤더 섹션(EnvSwapVendorSection) — 여기만 `density="compact"`
 * 그래서 원래 #632 안에 있던 이 카드를 밖으로 꺼냈다 — 두 번째 소비자가 생긴 순간
 * 복제하면 같은 벤더를 두고 두 화면이 다른 말을 하기 시작한다(이 코드베이스가
 * `CliRowCard` 로 이미 해결해 둔 문제와 정확히 같은 형태다).
 *
 * 상태·분류는 전부 `lib/vendorOnboarding` 이 계산해 `card` 로 들어온다. 여기엔
 * 판정 로직이 없고, 벤더 id·모델 id 리터럴도 없다.
 */

/** 카드 상자 — `CliRowCard` 와 같은 테두리·배경이라 두 종류가 한 줄로 읽힌다. */
const VENDOR_CARD_BOX = "rounded-lg border border-[#313244] bg-[#181825] p-4";
/** CLI 벤더의 dispatch 상자(행 카드 아래에 붙는 짝) — 세로만 조금 낮다. */
const VENDOR_SUB_BOX =
  "rounded-lg border border-[#313244] bg-[#181825] px-4 py-3";

const STATUS_STYLE: Record<VendorSetupCard["status"], string> = {
  ready: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
  needsKey: "bg-[#f9e2af]/15 text-[#f9e2af]",
  needsInstall: "bg-[#f38ba8]/15 text-[#f38ba8]",
  needsLogin: "bg-[#f9e2af]/15 text-[#f9e2af]",
  unknown: "bg-[#585b70]/30 text-[#a6adc8]",
};

/**
 * 표시 밀도 — **어느 화면에서 보느냐**에 달린 값이라 카드가 스스로 정하지 않는다.
 *
 * `full`(기본, 온보딩) — 시작하기 탭·②단계 BYOM 대안. 이 두 섹션의 목록에는 자체
 *   CLI 벤더(Grok)가 섞여 있고 섹션 설명도 "①②단계가 Claude·Codex 입니다" 뿐이라,
 *   "새 CLI 없이 구독키만 얹으면 된다" 를 카드가 직접 말하지 않으면 그 사실이 화면
 *   어디에도 없다. 처음 보는 사람에게 그건 장식이 아니라 첫인상 그 자체다.
 *
 * `compact`(하네스탭) — 섹션이 env-swap 벤더만 담고, 바깥 `HarnessSetupSection` 이
 *   `harness.store.section.envSwapDesc`("claude 하네스에 API 키만 얹어 쓰는
 *   벤더입니다…")로 같은 말을 **이미 한 번** 했다. 카드가 그걸 또 하면 벤더 수만큼
 *   반복된다(곧 5장). 그래서 카드에는 카드마다 **실제로 다른 것**(=어느 바이너리로
 *   도는지)만 칩으로 남기고, 공통 문장은 hover 로 닿게 둔다 — 지우는 게 아니다.
 */
export type VendorCardDensity = "full" | "compact";

export interface VendorCardProps {
  card: VendorSetupCard;
  /** #624 벤더키 설정으로 딥링크. */
  onOpenKeySettings: () => void;
  /** 키체인 스냅샷 다시 읽기. */
  onRecheckKeys: () => void;
  /**
   * 카드 맨 아래에 붙는 한 줄(선택). ②단계의 BYOM 대안이 "이 벤더는 워커 전용" 을
   * 여기에 적는다 — 그 사실은 카드 자체의 성질이 아니라 **어느 화면에서 보느냐**에
   * 달린 값이라 바깥에서 주입한다.
   */
  footNote?: ReactNode;
  /** 표시 밀도(위 `VendorCardDensity` 주석 참고). 기본은 온보딩 밀도. */
  density?: VendorCardDensity;
}

export function VendorCard({
  card,
  onOpenKeySettings,
  onRecheckKeys,
  footNote,
  density = "full",
}: VendorCardProps) {
  const { t } = useTranslation();
  // dispatch 예시에 넣을 모델. 기본값은 최상위 등급 모델이고, 아래 칩으로 이 벤더의
  // 다른 모델 id 를 눌러 예시를 바꿀 수 있다(= 어떤 id 가 유효한지 보여준다).
  const [model, setModel] = useState(card.exampleModelId);
  const row = ROWS.find((r) => r.id === card.cliRowId);
  const state = useCliSetupStore((s) =>
    card.cliRowId ? s.states[card.cliRowId] : undefined
  );
  const saveSecret = useVendorSecretsStore((s) => s.saveSecret);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [keyFeedback, setKeyFeedback] = useState<
    Record<string, "saved" | "error" | undefined>
  >({});
  /**
   * 이 카드에서 **방금** 키를 저장했나. 저장이 성공하면 상태가 ready 로 뒤집히면서
   * 입력 UI(그리고 그 아래 "안전 저장했습니다" 피드백)가 통째로 언마운트된다 —
   * 즉 확인 문구가 뜨자마자 사라진다. 그래서 그 순간에만 `key.ready` 를 띄운다:
   * "키 등록 뒤 **새로 스폰하는** 에이전트부터 적용된다" 는 정확히 이때 필요한
   * 정보고(이미 떠 있는 에이전트는 안 바뀐다), 그 외 평상시엔 `Ready` 배지가
   * 같은 말을 하므로 카드마다 반복시키지 않는다(배지 hover 로 남는다).
   */
  const [justSaved, setJustSaved] = useState(false);

  const isEnvSwap = card.kind === "envSwap";
  const isCompact = density === "compact";
  /** 카드마다 문장으로 반복되던 "이 벤더는 {command} 로 돈다" 원문. */
  const kindLine = t("onboarding.startHere.vendors.kind.envSwap", {
    command: card.command,
  });
  const readyLine = t("onboarding.startHere.vendors.key.ready");
  const keysToEnter =
    card.missingEnvKeys.length > 0 ? card.missingEnvKeys : card.requiredEnvKeys;

  const saveInlineKey = async (envKey: string) => {
    const value = (keyInputs[envKey] ?? "").trim();
    if (!value || savingKey) return;
    setSavingKey(envKey);
    setKeyFeedback((prev) => ({ ...prev, [envKey]: undefined }));
    try {
      await saveSecret(envKey, value);
      // 평문은 저장 직후 제거한다. 저장소 snapshot 에도 값은 오지 않는다.
      setKeyInputs((prev) => ({ ...prev, [envKey]: "" }));
      setKeyFeedback((prev) => ({ ...prev, [envKey]: "saved" }));
      setJustSaved(true);
    } catch {
      setKeyFeedback((prev) => ({ ...prev, [envKey]: "error" }));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    // CLI 벤더는 `CliRowCard` 가 이미 자기 카드(테두리·이름·상태·액션)를 그린다 —
    // 바깥에 또 카드를 두르면 이름과 상태가 2cm 안에서 두 번 반복된다. 그래서
    // env-swap 벤더에만 카드를 두르고, CLI 벤더는 행 카드 자체를 머리로 쓴다.
    <div className={isEnvSwap ? VENDOR_CARD_BOX : "space-y-2"}>
      {isEnvSwap && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm font-medium text-[#cdd6f4]">
              {card.label}
            </span>
            {isCompact ? (
              // 카드마다 **실제로 다른 것**은 어느 바이너리로 도느냐뿐이다. 그것만
              // 이름 옆 칩으로 남긴다 — 줄을 하나도 더 쓰지 않고, 문장 전체는
              // hover 로 그대로 닿는다(섹션 설명이 이미 같은 말을 했다).
              <span
                title={kindLine}
                className="ml-2 inline-block rounded border border-[#45475a] px-1.5 py-0.5 align-middle font-mono text-[10px] text-[#a6adc8]"
              >
                {card.command}
              </span>
            ) : (
              <p className="mt-0.5 text-xs text-[#7f849c]">{kindLine}</p>
            )}
          </div>
          <span
            // ready 일 때 배지 hover 에 `key.ready` 원문을 남긴다. 카드마다 한 줄씩
            // 서던 그 문장은 배지와 같은 말이라 평상시엔 숨기지만, 괄호 안의
            // "새로 스폰하는 에이전트부터 적용" 은 버릴 정보가 아니다.
            title={card.status === "ready" ? readyLine : undefined}
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
              STATUS_STYLE[card.status]
            }`}
          >
            {t(
              `onboarding.startHere.vendors.status.${card.status}` as MessageKey
            )}
          </span>
        </div>
      )}

      {/* ── 첫 켰을 때 해야 하는 한 가지 ──────────────────────────────── */}
      {isEnvSwap ? (
        // ready 카드는 평상시 여기에 아무 줄도 세우지 않는다 — 배지가 상태를 말하고,
        // 아래 칩+스니펫이 다음 행동을 말한다. 방금 저장한 그 순간에만 확인 줄이 뜬다.
        <div className={card.status === "ready" && !justSaved ? "" : "mt-3"}>
          {card.status === "ready" ? (
            justSaved ? (
              <p className="text-xs text-[#a6e3a1]">✓ {readyLine}</p>
            ) : null
          ) : (
            <>
              <p className="text-xs text-[#a6adc8]">
                {t("onboarding.startHere.vendors.key.hint", {
                  keys: keysToEnter.join(", "),
                })}
              </p>
              <div className="mt-2 space-y-2">
                {keysToEnter.map((envKey) => {
                  const value = keyInputs[envKey] ?? "";
                  const busy = savingKey === envKey;
                  const feedback = keyFeedback[envKey];
                  return (
                    <div key={envKey}>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          aria-label={envKey}
                          value={value}
                          onChange={(e) =>
                            setKeyInputs((prev) => ({
                              ...prev,
                              [envKey]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveInlineKey(envKey);
                          }}
                          placeholder={t(
                            "onboarding.startHere.vendors.key.placeholder",
                            { key: envKey }
                          )}
                          className="min-w-0 flex-1 rounded-md border border-[#45475a] bg-[#11111b] px-3 py-1.5 text-xs text-[#cdd6f4] placeholder-[#585b70] focus:border-[#89b4fa] focus:outline-none focus:ring-1 focus:ring-[#89b4fa]/40 disabled:opacity-50"
                          disabled={!!savingKey}
                        />
                        <button
                          type="button"
                          onClick={() => void saveInlineKey(envKey)}
                          disabled={!!savingKey || !value.trim()}
                          className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy
                            ? t("onboarding.startHere.vendors.key.saving")
                            : t("onboarding.startHere.vendors.key.save")}
                        </button>
                      </div>
                      {feedback && (
                        <p
                          className={`mt-1 text-[11px] ${
                            feedback === "saved"
                              ? "text-[#a6e3a1]"
                              : "text-[#f38ba8]"
                          }`}
                        >
                          {t(
                            `onboarding.startHere.vendors.key.${feedback}` as MessageKey
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onRecheckKeys}
                    className="rounded-md border border-[#45475a] px-2.5 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
                  >
                    {t("onboarding.startHere.vendors.key.recheck")}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenKeySettings}
                    className="text-xs text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
                  >
                    {t("onboarding.startHere.vendors.key.settings")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : row ? (
        // ①②단계와 **같은** 행 UI(재구현 0) — 설치 전이면 설치 버튼, 설치됐으면
        // 브라우저 로그인 버튼. 상태 배지도 저쪽과 같은 프로브에서 나온다.
        <CliRowCard row={row} phase={state?.installed ? "auth" : "install"} />
      ) : null}

      {/* ── 띄우는 법 한 줄(dispatch 지정 예시) ───────────────────────── */}
      <div className={isEnvSwap ? "mt-3" : VENDOR_SUB_BOX}>
        {/* compact 에서는 이 라벨을 섹션이 한 번만 말한다(EnvSwapVendorSection).
            카드마다 들고 있으면 벤더 수만큼 같은 문장이 선다. 칩·스니펫·Copy 는
            어느 밀도에서도 그대로 — 그게 이 카드의 실제 기능이다. */}
        {!isCompact && (
          <p className="text-xs font-medium text-[#a6adc8]">
            {t("onboarding.startHere.vendors.dispatchLabel")}
          </p>
        )}
        {card.modelIds.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {card.modelIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setModel(id)}
                className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                  id === model
                    ? "border-[#89b4fa] bg-[#89b4fa]/15 text-[#cdd6f4]"
                    : "border-[#45475a] text-[#a6adc8] hover:bg-[#313244]"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
        <CommandBox
          cmd={t("onboarding.startHere.vendors.dispatchSnippet", { model })}
        />
      </div>

      {footNote}
    </div>
  );
}
