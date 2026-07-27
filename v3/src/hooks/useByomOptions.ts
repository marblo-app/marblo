import { useCallback, useEffect, useMemo } from "react";
import {
  ORCHESTRATOR_CLI_IDS,
  ROWS,
  useCliSetupStore,
} from "../stores/cliSetupStore";
import { useQuickLaneModelStore } from "../stores/quickLaneModelStore";
import { useVendorSecretsStore } from "../stores/vendorSecretsStore";
import { ORCHESTRATOR_MODEL_OPTIONS } from "../stores/orchestratorStore";
import { vendorSetupCards } from "../lib/vendorOnboarding";
import {
  byomGateContribution,
  byomOptions,
  type ByomGateContribution,
  type ByomOption,
} from "../lib/byomOnboarding";

/**
 * ②단계의 BYOM 대안(F4)과 그 게이트 기여값을 한 번에 내주는 훅.
 *
 * 세 온보딩 표면(레거시 모달 · 시작하기 탭 · 그 안의 벤더 섹션)이 **같은 값**을 봐야
 * 하므로 파생은 여기 한 곳에만 있다. 입력은 전부 기존 store 다:
 *   - `quickLaneModelStore`  — 모델/벤더 목록(= electron/model-registry 파생 IPC)
 *   - `cliSetupStore`        — CLI 프로브 결과(설치/로그인)
 *   - `vendorSecretsStore`   — 키체인까지 본 크레덴셜 판정(#624)
 *   - `ORCHESTRATOR_MODEL_OPTIONS` — 오케 셀렉터가 실제로 세우는 칸(레지스트리 미러)
 * 벤더 id·모델 id 리터럴은 이 파일 어디에도 없다.
 *
 * 목록 로딩은 두 store 모두 "한 번만" 이 보장돼 있어(load 가 ready/loading 이면
 * no-op) 여러 컴포넌트가 이 훅을 동시에 써도 IPC 왕복은 늘지 않는다.
 */
export interface UseByomOptionsResult {
  options: ByomOption[];
  gate: ByomGateContribution;
  /** 카탈로그 로딩 상태 — 실패 시 화면이 재시도를 제안할 수 있게 그대로 흘린다. */
  status: ReturnType<typeof useQuickLaneModelStore.getState>["status"];
  /** 카탈로그 재시도. */
  reloadCatalog: () => void;
  /** "등록 상태 다시 확인" — 키체인 스냅샷만 다시 읽는다. */
  recheckKeys: () => void;
}

export function useByomOptions(): UseByomOptionsResult {
  const groups = useQuickLaneModelStore((s) => s.groups);
  const status = useQuickLaneModelStore((s) => s.status);
  const cliStates = useCliSetupStore((s) => s.states);
  const secrets = useVendorSecretsStore((s) => s.snapshot);

  useEffect(() => {
    void useQuickLaneModelStore.getState().load();
    void useVendorSecretsStore.getState().load();
  }, []);

  const options = useMemo(
    () =>
      byomOptions(
        vendorSetupCards(groups, {
          cliRows: ROWS,
          orchestratorRowIds: ORCHESTRATOR_CLI_IDS,
          cliStates,
          vendorSecrets: secrets,
        }),
        ORCHESTRATOR_MODEL_OPTIONS.map((o) => o.value),
      ),
    [groups, cliStates, secrets],
  );

  const gate = useMemo(() => byomGateContribution(options), [options]);

  const reloadCatalog = useCallback(() => {
    void useQuickLaneModelStore.getState().reload();
  }, []);
  const recheckKeys = useCallback(() => {
    void useVendorSecretsStore.getState().reload();
  }, []);

  return { options, gate, status, reloadCatalog, recheckKeys };
}
