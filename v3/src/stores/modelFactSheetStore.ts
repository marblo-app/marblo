import { create } from "zustand";

/**
 * 모델 정보표(단가 · 개략 SWE-bench · 컨텍스트) 캐시.
 *
 * `quickLaneModelStore` 와 같은 이유로 IPC 다 — 이 사실들의 단일소스는
 * `electron/model-registry.ts` + 두 참조표이고, `src/` 는 그 파일들을 import 할
 * 수 없다(경계 규약, `src/lib/rootPathScope.ts`). 렌더러에 미러 배열을 두지
 * 않으므로 레지스트리에 모델이 늘면 이 표도 **자동으로** 는다.
 *
 * 응답은 프로세스 수명 동안 불변(레지스트리·참조표 모두 상수)이라 한 번만 읽고
 * 캐시한다. ★기본 접힘인 표라, 사용자가 펼치기 전에는 이 왕복 자체가 일어나지
 * 않는다(컴포넌트가 열릴 때 `load()` 를 부른다).
 */

export type ModelFactSheetStatus = "idle" | "loading" | "ready" | "error";

interface ModelFactSheetState {
  rows: ModelFactRow[];
  status: ModelFactSheetStatus;
  error: string | null;
  /** 한 번 읽는다. 이미 ready/loading 이면 no-op(중복 왕복 방지). */
  load: () => Promise<void>;
  /** 실패 후 사용자가 명시적으로 다시 시도할 때. */
  reload: () => Promise<void>;
}

async function fetchFactSheet(): Promise<ModelFactRow[]> {
  // Electron 밖(웹 프리뷰·컴포넌트 테스트)에서는 브리지가 없다. 던지지 않고 빈
  // 배열로 떨어뜨려, 표가 "표시할 모델 없음" 안내를 그리게 한다.
  const api = window.electronAPI?.models;
  if (!api?.factSheet) return [];
  const rows = await api.factSheet();
  return Array.isArray(rows) ? rows : [];
}

export const useModelFactSheetStore = create<ModelFactSheetState>(
  (set, get) => ({
    rows: [],
    status: "idle",
    error: null,

    load: async () => {
      const { status } = get();
      if (status === "loading" || status === "ready") return;
      await get().reload();
    },

    reload: async () => {
      set({ status: "loading", error: null });
      try {
        const rows = await fetchFactSheet();
        set({ rows, status: "ready", error: null });
      } catch (err) {
        set({
          rows: [],
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  }),
);
