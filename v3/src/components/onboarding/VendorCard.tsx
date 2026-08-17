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
 * 두 화면이 이 컴포넌트를 공유한다:
 *   - 시작하기 탭의 "다른 벤더 모델 붙이기" 섹션(#632, VendorModelsSection)
 *   - ②단계의 BYOM 대안(F4, ByomStartSection)
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
}

export function VendorCard({
  card,
  onOpenKeySettings,
  onRecheckKeys,
  footNote,
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

  const isEnvSwap = card.kind === "envSwap";
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
            <p className="mt-0.5 text-xs text-[#7f849c]">
              {t("onboarding.startHere.vendors.kind.envSwap", {
                command: card.command,
              })}
            </p>
          </div>
          <span
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
        <div className="mt-3">
          {card.status === "ready" ? (
            <p className="text-xs text-[#a6e3a1]">
              ✓ {t("onboarding.startHere.vendors.key.ready")}
            </p>
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
        <p className="text-xs font-medium text-[#a6adc8]">
          {t("onboarding.startHere.vendors.dispatchLabel")}
        </p>
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
