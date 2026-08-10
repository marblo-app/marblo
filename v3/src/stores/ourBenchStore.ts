import { create } from "zustand";

/**
 * **우리 자체 실측** SWE-bench(our-measured) 캐시.
 *
 * `modelFactSheetStore` 를 그대로 미러한 형제 스토어다 — 같은 이유로 IPC 이고
 * (렌더러는 `electron/` 을 import 할 수 없다), 응답이 프로세스 수명 동안 불변인
 * 상수 파생이라 한 번만 읽고 캐시한다.
 *
 * ── ★두 스토어를 합치지 않은 이유 ────────────────────────────────────────
 * 소스가 다르다. 저쪽은 **벤더가 발표한 숫자**, 이쪽은 **우리가 직접 잰 숫자**이고,
 * 실행환경이 달라 한 표에 놓을 수 없다(공식 Docker 가 아니다). 한 스토어에 담으면
 * 화면이 두 배열을 concat 하는 데 아무 마찰이 없어진다 — 스토어를 갈라 두는 것이
 * 그 마찰을 만든다.
 *
 * ── ★`load()` 를 펼칠 때가 아니라 마운트에서 부르는 이유 ─────────────────
 * factSheet 은 기본 접힘이라 펼칠 때 읽는다. 이쪽은 **접힌 상태에서도 한 줄 요약과
 * 대조행(noop 0% / gold 100%)이 보여야** 하므로(사장님 "안 보인다" 재발 방지) 화면이
 * 마운트에서 부른다. 왕복 한 번은 그 가시성의 값이다.
 */

export type OurBenchStatus = "idle" | "loading" | "ready" | "error";

interface OurBenchState {
  report: OurBenchPayload | null;
  status: OurBenchStatus;
  error: string | null;
  /** 한 번 읽는다. 이미 ready/loading 이면 no-op(중복 왕복 방지). */
  load: () => Promise<void>;
  /** 실패 후 사용자가 명시적으로 다시 시도할 때. */
  reload: () => Promise<void>;
}

async function fetchOurBench(): Promise<OurBenchPayload | null> {
  // Electron 밖(웹 프리뷰·컴포넌트 테스트)에서는 브리지가 없다. 던지지 않고
  // null 로 떨어뜨려, 화면이 "아직 실측 데이터가 없다" 안내를 그리게 한다.
  const api = window.electronAPI?.models;
  if (!api?.ourBench) return null;
  const payload = await api.ourBench();
  // ★분리 계약을 렌더러에서도 한 번 더 본다. 이 라벨이 아닌 응답은 우리 실측이
  // 아니므로 그리지 않는다 — 벤더 수치가 이 섹션에 들어오는 유일한 경로를 막는다.
  if (!payload || payload.meta?.label !== "our-measured") return null;
  return payload;
}

export const useOurBenchStore = create<OurBenchState>((set, get) => ({
  report: null,
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
      set({ report: await fetchOurBench(), status: "ready", error: null });
    } catch (err) {
      set({
        report: null,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
