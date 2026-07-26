import { create } from "zustand";

/**
 * 퀵레인 모델 카탈로그 캐시.
 *
 * ── 왜 store 이고 왜 IPC 인가 ────────────────────────────────────────────
 * 모델 목록의 단일소스는 `electron/model-registry.ts` 인데 `src/` 는 그 파일을
 * import 할 수 없다(경계 규약, `src/lib/rootPathScope.ts`). 오케 모델 셀렉터는
 * 그래서 렌더러에 **미러 배열**을 두고 대조 유닛테스트로 드리프트를 잡는다.
 *
 * 퀵레인은 미러를 두지 않는다. 이 셀렉터에는 렌더러가 원리적으로 알 수 없는 축이
 * 하나 더 있기 때문이다 — env-swap 벤더(GLM/MiniMax)의 **크레덴셜 존재 여부**는
 * 메인 프로세스의 `process.env` 에만 있다. 어차피 IPC 왕복이 필요하다면 목록까지
 * 같은 응답에 실어 내리는 편이 미러라는 개념 자체를 없앤다(드리프트 0).
 *
 * 카탈로그는 프로세스 수명 동안 변하지 않는다(레지스트리는 상수, env 는 부팅 시
 * dotenv 로 고정). 그래서 한 번만 읽고 캐시하며, 재시도는 실패했을 때만 한다.
 */

export type QuickLaneCatalogStatus = "idle" | "loading" | "ready" | "error";

interface QuickLaneModelState {
  groups: QuickLaneVendorGroup[];
  status: QuickLaneCatalogStatus;
  error: string | null;
  /** 카탈로그를 한 번 읽는다. 이미 ready/loading 이면 no-op(중복 왕복 방지). */
  load: () => Promise<void>;
  /** 실패 후 사용자가 명시적으로 다시 시도할 때. */
  reload: () => Promise<void>;
}

async function fetchCatalog(): Promise<QuickLaneVendorGroup[]> {
  // Electron 밖(웹 프리뷰·테스트 렌더)에서는 브리지가 없다. 던지지 않고 빈
  // 목록으로 떨어뜨려, 셀렉터가 "모델 없음" 안내를 그리게 한다.
  const api = window.electronAPI?.models;
  if (!api?.quickLaneCatalog) return [];
  const groups = await api.quickLaneCatalog();
  return Array.isArray(groups) ? groups : [];
}

export const useQuickLaneModelStore = create<QuickLaneModelState>(
  (set, get) => ({
    groups: [],
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
        const groups = await fetchCatalog();
        set({ groups, status: "ready", error: null });
      } catch (err) {
        set({
          groups: [],
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  }),
);
