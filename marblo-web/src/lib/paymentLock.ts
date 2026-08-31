// 결제 중복 클릭 락 — checkout 페이지에서 "결제하기"를 연타했을 때 결제 요청이
// 두 번 나가는 것을 막는다.
//
// ★이 락의 범위는 "같은 탭 / 같은 페이지 생명주기"다.
//   저장소가 sessionStorage 라 **탭 단위**다 — 다른 탭에는 애초에 보이지 않으므로
//   '두 탭 동시 결제'는 이 락이 막을 수 있는 대상이 아니다. 실제로 막는 것은
//   같은 화면에서의 연타뿐이다.
//
// ★그래서 페이지를 벗어나면(pagehide — 새로고침·뒤로가기·bfcache 진입 포함)
//   락을 푼다. 안 풀면 결제창을 띄운 채 새로고침한 사용자가 최대 15분 동안
//   "결제가 이미 진행 중입니다"로 막힌다. 창을 X 로 닫으면 풀리는데 새로고침만
//   막히는 비대칭이 있었다(ticket YgA5uusdM8tAjQtvS0yL, 실측 PR #1349).
//   pagehide 로 푸는 것이 '중복 결제 방지'를 버리지 않으면서 이 비대칭만
//   없애는 최소 변경이다 — 연타 방지(같은 페이지 생명주기)는 그대로 남는다.

export const PAYMENT_LOCK_KEY = "payment_in_progress";

/**
 * 락이 이 시간보다 오래되면 죽은 락으로 보고 무시한다.
 * pagehide 해제가 못 도는 경우(브라우저 강제 종료 등)의 최후 안전망.
 */
export const PAYMENT_LOCK_STALE_MS = 15 * 60 * 1000;

/** sessionStorage 중 이 락이 쓰는 부분만. 테스트에서 메모리 구현으로 대체한다. */
export interface PaymentLockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** pagehide 를 붙일 수 있는 대상(브라우저에서는 window). */
export interface PaymentLockPageTarget {
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

/**
 * 브라우저 sessionStorage 핸들. SSR 이거나 스토리지 접근 자체가 막힌 환경
 * (사파리 프라이빗 등)에서는 null 을 준다 — 그때는 락 없이 진행한다
 * (loading 상태 + 버튼 disabled 가 1차 방어다).
 */
export function sessionPaymentLockStorage(): PaymentLockStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 락을 잡는다. 이미 유효한 락이 있으면 false — 호출부는 결제를 시작하지 않는다.
 * 스토리지를 못 쓰면 true(fail-open) — 기존 동작 그대로다.
 */
export function acquirePaymentLock(
  storage: PaymentLockStorage | null,
  now: number = Date.now()
): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(PAYMENT_LOCK_KEY);
    if (raw) {
      const started = Number(raw);
      if (Number.isFinite(started) && now - started < PAYMENT_LOCK_STALE_MS) {
        return false;
      }
    }
    storage.setItem(PAYMENT_LOCK_KEY, String(now));
    return true;
  } catch {
    // sessionStorage 불가 환경 — 탭 단위 loading 만 의존
    return true;
  }
}

/** 락을 푼다. 실패해도 조용히 넘어간다(락 해제 실패로 결제를 막지 않는다). */
export function releasePaymentLock(storage: PaymentLockStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PAYMENT_LOCK_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 페이지 이탈 시 락을 푸는 핸들러를 건다. 해제 함수를 돌려준다.
 *
 * pagehide 를 쓰는 이유: unload 와 달리 bfcache 진입 때도 발화하므로,
 * 결제창 → 뒤로가기로 돌아온 경우에도 락이 남지 않는다.
 */
export function installPaymentLockPageHideRelease(
  target: PaymentLockPageTarget,
  storage: PaymentLockStorage | null
): () => void {
  const onPageHide = () => releasePaymentLock(storage);
  target.addEventListener("pagehide", onPageHide);
  return () => target.removeEventListener("pagehide", onPageHide);
}
