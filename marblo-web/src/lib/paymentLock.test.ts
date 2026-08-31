import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENT_LOCK_KEY,
  acquirePaymentLock,
  installPaymentLockPageHideRelease,
  releasePaymentLock,
  type PaymentLockPageTarget,
  type PaymentLockStorage,
} from "./paymentLock";

function memoryStorage(
  seed: Record<string, string> = {}
): PaymentLockStorage & { dump(): Record<string, string> } {
  const map = { ...seed };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
    removeItem: (k) => {
      delete map[k];
    },
    dump: () => ({ ...map }),
  };
}

/** pagehide 만 받는 가짜 window. fire() 로 실제 이탈을 흉내낸다. */
function fakePageTarget(): PaymentLockPageTarget & {
  fire(): void;
  listenerCount(): number;
} {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

// ① 정상 흐름 — 결제 시작에 락이 잡히고, 끝나면 풀린다.
test("정상 흐름: 결제 시작에 락이 잡히고 종료 시 풀린다", () => {
  const storage = memoryStorage();

  assert.equal(acquirePaymentLock(storage, 1_000), true);
  assert.equal(storage.dump()[PAYMENT_LOCK_KEY], "1000");

  releasePaymentLock(storage);
  assert.equal(PAYMENT_LOCK_KEY in storage.dump(), false);

  // 풀렸으니 같은 세션에서 다시 결제할 수 있다.
  assert.equal(acquirePaymentLock(storage, 2_000), true);
});

// ② 새로고침(페이지 이탈) 후 재진입 — 막히지 않는다. 이 티켓의 본 버그.
test("페이지 이탈(pagehide) 후 재진입하면 결제가 막히지 않는다", () => {
  const storage = memoryStorage();
  const target = fakePageTarget();

  const uninstall = installPaymentLockPageHideRelease(target, storage);

  // 결제창을 띄운 상태 = 락 보유 중.
  assert.equal(acquirePaymentLock(storage, 1_000), true);

  // 여기서 새로고침. 이탈 시점에 락이 풀려야 한다.
  target.fire();
  assert.equal(PAYMENT_LOCK_KEY in storage.dump(), false);

  // 재진입 — 15분 스테일 창 안(1초 뒤)이어도 막히면 안 된다.
  assert.equal(acquirePaymentLock(storage, 2_000), true);

  uninstall();
  assert.equal(target.listenerCount(), 0);
});

// ③ 회귀 — 같은 페이지에서 연타하면 여전히 막힌다(중복 결제 방지 유지).
test("같은 페이지에서 연속 중복 클릭은 여전히 막힌다", () => {
  const storage = memoryStorage();
  installPaymentLockPageHideRelease(fakePageTarget(), storage);

  assert.equal(acquirePaymentLock(storage, 1_000), true);
  // 이탈 없이 곧바로 두 번째 클릭 — 거부되어야 한다.
  assert.equal(acquirePaymentLock(storage, 1_050), false);
  assert.equal(acquirePaymentLock(storage, 60_000), false);

  // 스테일 한계를 넘기면 죽은 락으로 보고 다시 잡는다(최후 안전망은 유지).
  assert.equal(acquirePaymentLock(storage, 1_000 + 15 * 60 * 1000), true);
});
