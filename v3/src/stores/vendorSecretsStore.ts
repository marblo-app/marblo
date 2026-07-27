import { create } from "zustand";

/**
 * 벤더 크레덴셜 스냅샷 캐시 — **값이 아니라 키 이름과 존재 여부**만 담는다.
 *
 * ── 왜 store 로 올렸나 ───────────────────────────────────────────────────
 * #632 의 시작하기 벤더 섹션이 이 스냅샷을 컴포넌트 로컬 state 로 들고 있었다.
 * 그때는 소비자가 하나였지만, ②단계의 BYOM 대안(ByomStartSection)이 같은 판정을
 * 필요로 하면서 소비자가 둘이 됐다. 로컬 state 를 복제하면 한쪽에서 "등록 상태
 * 다시 확인" 을 눌러도 다른 쪽은 옛 판정을 계속 말한다 — 같은 화면 안에서 두 칸이
 * 서로 다른 소리를 내는 그 버그를 애초에 만들 수 없게 상태를 한 곳에 둔다.
 *
 * ★판정의 출처가 이 스냅샷이어야 하는 이유: 퀵레인 카탈로그의 `available` 은
 * `process.env` 만 본다. #624 이후 키는 **OS 키체인**에도 저장되고 스폰은
 * `process.env[key] || 키체인` 순으로 읽으므로, 키체인에만 넣은 사용자는 카탈로그만
 * 보면 "미설정" 으로 보인다.
 *
 * 브리지가 없는 환경(웹 프리뷰·테스트 렌더)이나 IPC 실패는 조용히 `null` 로
 * 떨어뜨린다 — 그때는 호출자가 카탈로그 판정으로 폴백한다.
 */

export type VendorSecretsStatus = "idle" | "loading" | "ready" | "error";

interface VendorSecretsState {
  snapshot: VendorSecretsSnapshot | null;
  status: VendorSecretsStatus;
  /** 한 번만 읽는다(이미 읽었거나 읽는 중이면 no-op). */
  load: () => Promise<void>;
  /** 사용자가 "등록 상태 다시 확인" 을 눌렀을 때 — 항상 다시 읽는다. */
  reload: () => Promise<void>;
}

async function fetchSnapshot(): Promise<VendorSecretsSnapshot | null> {
  const api = window.electronAPI?.settings;
  if (!api?.getVendorSecrets) return null;
  return await api.getVendorSecrets();
}

export const useVendorSecretsStore = create<VendorSecretsState>((set, get) => ({
  snapshot: null,
  status: "idle",

  load: async () => {
    const { status } = get();
    if (status === "loading" || status === "ready") return;
    await get().reload();
  },

  reload: async () => {
    set({ status: "loading" });
    try {
      set({ snapshot: await fetchSnapshot(), status: "ready" });
    } catch {
      // 판정을 못 하는 것과 "키가 없다" 는 다르다 — 스냅샷을 비워 호출자가
      // 카탈로그 판정으로 떨어지게 한다.
      set({ snapshot: null, status: "error" });
    }
  },
}));
