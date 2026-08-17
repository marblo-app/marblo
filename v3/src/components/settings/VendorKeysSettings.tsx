/**
 * env-swap 벤더(GLM/MiniMax…) API 키 등록 UI.
 *
 * ── 왜 BYOK 카드와 따로인가 ───────────────────────────────────────────────
 * 아래쪽 `APIKeysSettings` 는 Flow 엔진이 SDK 로 직접 호출할 때 쓰는 프로바이더 키다.
 * 여기 키는 성격이 다르다 — 우리가 스폰하는 **`claude` 바이너리를 남의
 * Anthropic-호환 엔드포인트로 붙이는** 벤더 구독키이고, 값은 모델 레지스트리의
 * `envProfile` 이 `${ZAI_API_KEY}` 처럼 **이름으로만** 참조한다.
 *
 * 종전엔 그 값이 `v3/.env` → `process.env` 에서만 왔다. 그래서 Finder 로 띄운
 * 패키지앱에는 키를 넣을 방법이 아예 없었고 GLM/MiniMax 를 빌드앱에서 못 켰다.
 * 이 화면이 그 두 번째 소스(OS 키체인 암호화 저장소)의 창구다.
 *
 * ── 보안 ─────────────────────────────────────────────────────────────────
 * - 평문은 **입력 → IPC → 키체인** 한 방향으로만 흐른다. 이 컴포넌트는 저장된 키를
 *   되읽지 않는다(스냅샷엔 마스킹된 `preview` 뿐이다).
 * - 입력 필드는 항상 `type="password"` 이고 저장 즉시 비운다. "보기" 토글은 없다 —
 *   되읽을 값이 없으니 토글할 것도 없다.
 * - 카드 상태는 all-or-nothing 규율을 그대로 비춘다: 필요한 키가 전부 차야
 *   "활성" 이고, 부분 등록은 "미설정(부분 주입 안 함)" 으로 보인다.
 *
 * ── 목록의 출처 ──────────────────────────────────────────────────────────
 * 카드·키 칸은 main 이 **모델 레지스트리에서 파생**해 준다. 여기 하드코딩된 것은
 * 표시 이름과 콘솔 안내뿐이고, 모르는 벤더가 와도 id 그대로 렌더된다 — 새 env-swap
 * 벤더는 레지스트리 행만 늘리면 이 화면에 자동으로 나타난다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";

/** 벤더 표시용 상수. 벤더명·콘솔 경로는 식별자라 번역 대상이 아니다. */
const VENDOR_META: Record<
  string,
  { name: string; console: string; hintKey: MessageKeyLike }
> = {
  zai: {
    name: "Z.ai (GLM)",
    console: "z.ai → API Keys",
    hintKey: "settings.vendorKeys.hint.zai",
  },
  minimax: {
    name: "MiniMax",
    console: "minimax.io → API Key",
    hintKey: "settings.vendorKeys.hint.minimax",
  },
  upstage: {
    name: "Upstage Solar",
    console: "console.upstage.ai → API keys",
    hintKey: "settings.vendorKeys.hint.upstage",
  },
};

/** VENDOR_META 가 참조하는 힌트 키만 좁게 받는다(오타는 컴파일 에러). */
type MessageKeyLike =
  | "settings.vendorKeys.hint.zai"
  | "settings.vendorKeys.hint.minimax"
  | "settings.vendorKeys.hint.upstage";

const STORE_PATH = "~/.marblo/vendor-secrets.enc.json";

export function VendorKeysSettings() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<VendorSecretsSnapshot | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<
    Record<string, { type: "success" | "error"; message: string } | null>
  >({});

  const load = useCallback(async () => {
    try {
      setSnapshot(await window.electronAPI.settings.getVendorSecrets());
    } catch (err) {
      // 값이 없는 조회라 실패해도 노출 위험은 없다 — 콘솔에만 남긴다.
      console.error("[VendorKeysSettings] snapshot fetch failed:", err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (
    envKey: string,
    type: "success" | "error",
    message: string
  ) => {
    setFeedback((prev) => ({ ...prev, [envKey]: { type, message } }));
    setTimeout(
      () => setFeedback((prev) => ({ ...prev, [envKey]: null })),
      4000
    );
  };

  const handleSave = async (envKey: string) => {
    const value = (inputs[envKey] ?? "").trim();
    if (!value) return;
    setBusy((p) => ({ ...p, [envKey]: true }));
    try {
      const res = await window.electronAPI.settings.setVendorSecret(
        envKey,
        value
      );
      // ★평문을 state 에 남기지 않는다 — 저장 즉시 입력을 비운다.
      setInputs((p) => ({ ...p, [envKey]: "" }));
      setSnapshot(res.snapshot);
      flash(envKey, "success", t("settings.vendorKeys.saved"));
    } catch (err) {
      // main 이 준 문구(키체인 미가용 안내 등)는 백엔드 소유라 그대로 띄운다.
      flash(
        envKey,
        "error",
        err instanceof Error ? err.message : t("settings.vendorKeys.saveFailed")
      );
    } finally {
      setBusy((p) => ({ ...p, [envKey]: false }));
    }
  };

  const handleDelete = async (envKey: string) => {
    setBusy((p) => ({ ...p, [envKey]: true }));
    try {
      const res = await window.electronAPI.settings.deleteVendorSecret(envKey);
      setInputs((p) => ({ ...p, [envKey]: "" }));
      setSnapshot(res.snapshot);
      flash(envKey, "success", t("settings.vendorKeys.deleted"));
    } catch (err) {
      flash(
        envKey,
        "error",
        err instanceof Error
          ? err.message
          : t("settings.vendorKeys.deleteFailed")
      );
    } finally {
      setBusy((p) => ({ ...p, [envKey]: false }));
    }
  };

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-xs text-gray-500">
        {t("settings.vendorKeys.loading")}
      </div>
    );
  }

  // 레지스트리에 env-swap 벤더 행이 없으면 섹션 자체를 그리지 않는다.
  if (snapshot.vendors.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          {t("settings.vendorKeys.heading")}
        </h3>
        <p className="text-xs leading-relaxed text-gray-500">
          {t("settings.vendorKeys.help", { path: STORE_PATH })}
        </p>
      </div>

      {!snapshot.encryptionAvailable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          {t("settings.vendorKeys.noEncryption")}
        </div>
      )}

      {snapshot.vendors.map((vendor) => {
        const meta = VENDOR_META[vendor.vendor];
        const partial =
          !vendor.ready && vendor.keys.some((k) => k.source !== "none");
        return (
          <div
            key={vendor.vendor}
            className="rounded-lg border border-gray-700 bg-gray-800 p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium text-gray-200">
                  {meta?.name ?? vendor.vendor}
                </h4>
                <p className="mt-0.5 text-xs text-gray-500">
                  {meta
                    ? t(meta.hintKey)
                    : t("settings.vendorKeys.defaultHint")}
                </p>
                <p className="mt-1 text-[11px] text-gray-600">
                  {t("settings.vendorKeys.models", {
                    models: vendor.modelIds.join(", "),
                  })}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  vendor.ready
                    ? "border-green-500/30 bg-green-500/10 text-green-400"
                    : "border-gray-600 bg-gray-700/40 text-gray-400"
                }`}
              >
                {vendor.ready
                  ? t("settings.vendorKeys.ready")
                  : t("settings.vendorKeys.notReady")}
              </span>
            </div>

            {partial && (
              <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
                {t("settings.vendorKeys.partialWarning")}
              </div>
            )}

            <div className="space-y-3">
              {vendor.keys.map((key) => {
                const isBusy = busy[key.envKey];
                const fb = feedback[key.envKey];
                return (
                  <div key={key.envKey}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <code className="rounded bg-gray-700 px-1.5 py-0.5 text-[11px] text-gray-300">
                        {key.envKey}
                      </code>
                      {key.source === "none" ? (
                        <span className="text-[11px] text-gray-500">
                          {t("settings.vendorKeys.unset")}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">
                          {/* ★마스킹된 preview 다 — 원문은 렌더러에 오지 않는다 */}
                          {key.preview}
                          <span className="ml-1.5 text-gray-600">
                            {key.source === "env"
                              ? t("settings.vendorKeys.sourceEnv")
                              : t("settings.vendorKeys.sourceStore")}
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={key.envKey}
                        value={inputs[key.envKey] ?? ""}
                        onChange={(e) =>
                          setInputs((p) => ({
                            ...p,
                            [key.envKey]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSave(key.envKey);
                        }}
                        placeholder={
                          key.storedInApp
                            ? t("settings.vendorKeys.replacePlaceholder")
                            : t("settings.vendorKeys.newPlaceholder", {
                                console:
                                  meta?.console ??
                                  t("settings.vendorKeys.consoleFallback"),
                              })
                        }
                        disabled={isBusy || !snapshot.encryptionAvailable}
                        className="flex-1 rounded border border-gray-600 bg-gray-900 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-50"
                      />
                      <button
                        onClick={() => void handleSave(key.envKey)}
                        disabled={
                          isBusy ||
                          !(inputs[key.envKey] ?? "").trim() ||
                          !snapshot.encryptionAvailable
                        }
                        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t("settings.vendorKeys.save")}
                      </button>
                      {key.storedInApp && (
                        <button
                          onClick={() => void handleDelete(key.envKey)}
                          disabled={isBusy}
                          className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-400 hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
                        >
                          {t("settings.vendorKeys.delete")}
                        </button>
                      )}
                    </div>

                    {/* 셸 env 가 이기는 상황을 숨기지 않는다 — 어느 키로 붙는지
                        모르는 채 디버깅하는 게 가장 비싼 실패다. */}
                    {key.source === "env" && key.storedInApp && (
                      <p className="mt-1 text-[11px] text-amber-400/80">
                        {t("settings.vendorKeys.envWinsNotice")}
                      </p>
                    )}

                    {fb && (
                      <p
                        className={`mt-1 text-[11px] ${
                          fb.type === "success"
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {fb.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="mt-3 border-t border-gray-700/60 pt-2 text-[11px] text-gray-600">
              {t("settings.vendorKeys.respawnNotice")}
            </p>
          </div>
        );
      })}
    </div>
  );
}
