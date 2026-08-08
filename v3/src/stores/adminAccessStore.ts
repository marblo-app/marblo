import { create } from "zustand";

/**
 * "이 계정이 플랫폼 어드민인가" — **관측된 사실**만 담는 캐시.
 *
 * 어드민 판정의 단일 소스는 서버다(`functions/index.ts requireAdmin`, ADMIN_UID
 * 대조). 클라이언트엔 그 값이 없고, 있어서도 안 된다 — 렌더러에 어드민 uid 를
 * 심으면 그건 게이트가 아니라 안내판이다. 그래서 여기서 판정을 **하지 않고**,
 * 어드민 callable 이 실제로 돌려준 결과만 기록한다:
 *
 *   granted — 호출이 성공했다(서버가 어드민으로 인정).
 *   denied  — 서버가 permission-denied 를 돌려줬다(확정적으로 비어드민).
 *   unknown — 아직 한 번도 안 불러 봤다.
 *
 * ★unknown 은 "숨김" 이 아니라 "보임" 이다. 판정 전에 숨기면 진짜 어드민이
 * 탭을 영영 못 찾는 닭-달걀이 된다. 대신 한 번 denied 를 받으면 그 사실을
 * uid 별로 영속화해, 비어드민이 매 세션 "Admin only" 빨간 에러를 다시 만나는
 * 일이 없게 한다.
 *
 * 네트워크 오류·타임아웃·내부 오류는 denied 가 **아니다**. 그런 걸로 숨기면
 * 잠깐 끊긴 어드민에게서 탭이 사라진다 — 오직 명시적 permission-denied 만
 * 확정 신호로 쓴다.
 */
export type AdminAccess = "unknown" | "granted" | "denied";

const STORAGE_KEY = "marblo.adminAccess";

type StatusMap = Record<string, "granted" | "denied">;

function read(): StatusMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as StatusMap;
  } catch {
    // 프라이빗 모드 / 손상된 값 — 캐시가 없는 것과 같다(unknown 으로 degrade).
    return {};
  }
}

function write(map: StatusMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 저장 못 해도 이번 세션 인메모리로는 동작한다 */
  }
}

interface AdminAccessState {
  statusByUid: StatusMap;
  /** 이 uid 에 대해 지금까지 관측된 접근 결과. */
  accessFor: (uid: string | null | undefined) => AdminAccess;
  markGranted: (uid: string | null | undefined) => void;
  markDenied: (uid: string | null | undefined) => void;
}

export const useAdminAccessStore = create<AdminAccessState>((set, get) => ({
  statusByUid: read(),

  accessFor: (uid) => {
    if (!uid) return "unknown";
    return get().statusByUid[uid] ?? "unknown";
  },

  markGranted: (uid) => {
    if (!uid || get().statusByUid[uid] === "granted") return;
    const next = { ...get().statusByUid, [uid]: "granted" as const };
    write(next);
    set({ statusByUid: next });
  },

  markDenied: (uid) => {
    if (!uid || get().statusByUid[uid] === "denied") return;
    const next = { ...get().statusByUid, [uid]: "denied" as const };
    write(next);
    set({ statusByUid: next });
  },
}));

/**
 * Firebase callable 에러가 **확정적 비어드민** 신호인지. `permission-denied` 만
 * 참이다 — `failed-precondition`(서버에 ADMIN_UID 미설정)은 서버 설정 문제라
 * 사용자 자격과 무관하고, unavailable/internal 은 그냥 실패다.
 */
export function isAdminPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (typeof code !== "string") return false;
  return code === "permission-denied" || code === "functions/permission-denied";
}
