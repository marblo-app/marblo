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
  /**
   * 고를 수 있는 벤치 변형. **커버리지 내림차순**이라 `[0]` 이 기본 축이다.
   * 화면이 목록을 만들지 않는 이유는 티어와 같다 — 목록을 렌더러에 적는 순간
   * 벤더가 보고 벤치를 갈아탈 때 화면만 옛 축에 남는다.
   */
  variants: ModelFactVariant[];
  /** 메인이 커버리지로 파생한 기본 축. */
  defaultBenchmark: BenchmarkVariantId | null;
  status: ModelFactSheetStatus;
  error: string | null;
  /** 한 번 읽는다. 이미 ready/loading 이면 no-op(중복 왕복 방지). */
  load: () => Promise<void>;
  /** 실패 후 사용자가 명시적으로 다시 시도할 때. */
  reload: () => Promise<void>;
}

const EMPTY: Pick<
  ModelFactSheetState,
  "rows" | "variants" | "defaultBenchmark"
> = { rows: [], variants: [], defaultBenchmark: null };

async function fetchFactSheet(): Promise<typeof EMPTY> {
  // Electron 밖(웹 프리뷰·컴포넌트 테스트)에서는 브리지가 없다. 던지지 않고 빈
  // 응답으로 떨어뜨려, 표가 "표시할 모델 없음" 안내를 그리게 한다.
  const api = window.electronAPI?.models;
  if (!api?.factSheet) return EMPTY;
  const payload = await api.factSheet();
  if (!payload || !Array.isArray(payload.rows)) return EMPTY;
  return {
    rows: payload.rows,
    variants: Array.isArray(payload.variants) ? payload.variants : [],
    defaultBenchmark: payload.defaultBenchmark ?? null,
  };
}

export const useModelFactSheetStore = create<ModelFactSheetState>(
  (set, get) => ({
    ...EMPTY,
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
        set({ ...(await fetchFactSheet()), status: "ready", error: null });
      } catch (err) {
        set({
          ...EMPTY,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  }),
);
