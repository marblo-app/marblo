import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";
import { useQuickLaneModelStore } from "../../stores/quickLaneModelStore";
import {
  carryEffort,
  isVendorUsable,
  selectionFor,
  type QuickLaneSelection,
} from "../../lib/quickLaneModel";

/**
 * 계층 모델 셀렉터 — **벤더 → 구체 모델 → effort** 세 단.
 *
 * 종전 퀵레인은 하네스 3칸("Claude Code / Codex CLI / Antigravity")만 골랐고, 그
 * 목록은 이 컴포넌트가 아니라 모달 안 리터럴 배열이었다. 그래서 (a) 레지스트리에
 * grok 이 들어와도 화면에 나타날 방법이 없었고 (b) 같은 Claude 안에서 fable5 로
 * 띄울지 haiku 로 띄울지 고를 수 없었다.
 *
 * 지금 목록은 전부 `models:quickLaneCatalog` IPC 가 `electron/model-registry.ts`
 * 에서 파생해 내려준 데이터다 — 이 파일에 모델 id 는 하나도 없다.
 *
 * ★키가 없는 env-swap 벤더(GLM/MiniMax)는 **숨기지 않고 비활성으로 보여준다**.
 * 숨기면 "우리는 이 벤더를 지원하지 않는다" 로 읽히지만 사실은 "키만 넣으면
 * 켜진다" 이고, 필요한 키 이름을 화면에서 바로 알려주는 편이 훨씬 짧은 길이다.
 * (키 **이름**만 온다 — 값은 메인 프로세스 밖으로 나오지 않는다.)
 */
export function QuickLaneModelSelector({
  selection,
  onChange,
  disabled,
}: {
  selection: QuickLaneSelection | null;
  onChange: (next: QuickLaneSelection) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const groups = useQuickLaneModelStore((s) => s.groups);
  const status = useQuickLaneModelStore((s) => s.status);
  const reload = useQuickLaneModelStore((s) => s.reload);

  const activeGroup =
    groups.find((g) => g.vendor === selection?.vendor) ?? undefined;
  const activeModel = activeGroup?.models.find(
    (m) => m.modelId === selection?.modelId,
  );

  useEffect(() => {
    // 첫 렌더에서 카탈로그를 요청한다. 모달이 열릴 때마다 부르지만 store 가
    // ready/loading 을 보고 중복 왕복을 접는다.
    void useQuickLaneModelStore.getState().load();
  }, []);

  if (status === "loading" || status === "idle") {
    return (
      <p className="mb-4 text-xs text-gray-500">{t("lanes.model.loading")}</p>
    );
  }

  if (status === "error" || groups.length === 0) {
    return (
      <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        <p>{t("lanes.model.unavailable")}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-1 underline hover:text-amber-200"
        >
          {t("lanes.model.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-3">
      {/* 1단 — 벤더 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-400">
          {t("lanes.model.vendorLabel")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((group) => {
            const usable = isVendorUsable(group);
            const isActive = group.vendor === selection?.vendor;
            return (
              <button
                key={`${group.vendor}:${group.harness}`}
                type="button"
                disabled={disabled || !usable}
                title={
                  usable
                    ? group.command
                    : t("lanes.model.missingKeys", {
                        keys: group.missingEnvKeys.join(", "),
                      })
                }
                onClick={() => {
                  if (group.models.length === 0) return;
                  onChange(
                    selectionFor(
                      group,
                      group.models[0],
                      carryEffort(group.models[0], selection?.effort ?? ""),
                    ),
                  );
                }}
                className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                  isActive
                    ? "border-blue-500 bg-blue-500/15 text-gray-100"
                    : "border-gray-700 bg-gray-750 text-gray-400 hover:bg-gray-700"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {group.label}
                {!usable && (
                  <span className="ml-1 text-[10px] text-amber-400/80">
                    {t("lanes.model.keyRequiredBadge")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* 비활성 벤더를 고르려는 사용자가 "무엇을 넣어야 켜지나" 를 화면에서
            바로 읽게 한다. 키 이름만이고 값은 여기 오지 않는다. */}
        {groups.some((g) => !isVendorUsable(g)) && (
          <p className="mt-1 text-[11px] text-gray-500">
            {t("lanes.model.envHint", {
              vendors: groups
                .filter((g) => !isVendorUsable(g))
                .map((g) => `${g.label}(${g.missingEnvKeys.join(", ")})`)
                .join(" · "),
            })}
          </p>
        )}
      </div>

      {/* 2단 — 구체 모델 */}
      {activeGroup && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">
            {t("lanes.model.modelLabel")}
          </label>
          <div className="space-y-1">
            {activeGroup.models.map((model) => {
              const isActive = model.modelId === selection?.modelId;
              return (
                <button
                  key={model.modelId}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange(
                      selectionFor(
                        activeGroup,
                        model,
                        carryEffort(model, selection?.effort ?? ""),
                      ),
                    )
                  }
                  className={`flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors ${
                    isActive
                      ? "border-blue-500 bg-blue-500/15 text-gray-100"
                      : "border-gray-700 bg-gray-750 text-gray-400 hover:bg-gray-700"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span className="flex-1 text-left font-mono">
                    {model.label}
                  </span>
                  <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                    {model.capability}
                  </span>
                  {model.estimatedPricing && (
                    <span
                      className="text-[10px] text-gray-500"
                      title={t("lanes.model.estimatedTip")}
                    >
                      {t("lanes.model.estimated")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3단 — effort. effort 축이 있는 모델(codex 계열)에서만 그린다. */}
      {activeModel && activeModel.efforts.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">
            {t("lanes.model.effortLabel")}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {["", ...activeModel.efforts].map((effort) => {
              const isActive = (selection?.effort ?? "") === effort;
              return (
                <button
                  key={effort || "__default__"}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    activeGroup &&
                    onChange(selectionFor(activeGroup, activeModel, effort))
                  }
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    isActive
                      ? "border-blue-500 bg-blue-500/15 text-gray-100"
                      : "border-gray-700 bg-gray-750 text-gray-400 hover:bg-gray-700"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {effort ||
                    t("lanes.model.effortDefault", {
                      // CLI 기본 effort 를 함께 보여줘, "기본" 이 무엇으로 뜨는지
                      // 고르기 전에 알 수 있게 한다.
                      value: activeModel.defaultEffort ?? "-",
                    })}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
