/**
 * 벤더 선불 잔액 조회(`electron/vendor-balance.ts`) — `quotaApi` 첫 배선의 회귀 가드.
 *
 * 네 층을 본다:
 *   1. **키가 새지 않는다** — 결과 객체 어디에도 평문 키가 없고, 나가는 헤더에만 있다.
 *   2. **실패를 뭉개지 않는다** — 키 없음/401/HTTP 오류/네트워크/형식불일치가
 *      각각 다른 status 로 온다. (한 줄로 접히면 이 테스트가 깨진다)
 *   3. **호출 빈도** — 캐시가 살아 있으면 요청이 안 나가고, 새로고침 연타에도
 *      하한이 걸린다. 탭을 여닫는 것만으로 벤더 API 가 맞지 않는다는 요구의 집행.
 *   4. **숫자를 지어내지 않는다** — 무료분/충전액을 합치지 않고, 통화를 환산하지
 *      않고, 없는 칸을 0 으로 채우지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  BALANCE_CACHE_TTL_MS,
  MIN_REFRESH_INTERVAL_MS,
  balanceProbeVendors,
  getVendorBalance,
  hasBalanceProbe,
  __resetVendorBalanceCacheForTests,
} from "../../electron/vendor-balance";
import { VENDOR_BILLING } from "../../src/lib/vendorBilling";

const FAKE_KEY = "test-deepseek-key-not-a-real-secret";

/** 문서 스펙 그대로의 성공 응답(CNY 계정). */
const OK_BODY = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/**
 * ★반드시 `await fn()` 해야 한다. 종전처럼 동기 반환하면 env 복구가 첫 await 보다
 * 먼저 일어나서, 두 번째 호출이 "키 없음" 으로 떨어진다(실제로 이 테스트가 그렇게
 * 한 번 거짓 통과했다).
 */
async function withKey<T>(
  value: string | undefined,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prev = process.env.DEEPSEEK_API_KEY;
  if (value === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
}

beforeEach(() => {
  __resetVendorBalanceCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetVendorBalanceCacheForTests();
});

describe("배선 — vendorBilling.quotaApi 와 프로브가 짝이다", () => {
  it("quotaApi 가 null 아닌 벤더는 전부 프로브가 있다", () => {
    for (const [vendor, fact] of Object.entries(VENDOR_BILLING)) {
      if (fact.quotaApi === null) continue;
      expect(
        hasBalanceProbe(vendor),
        `${vendor} 의 quotaApi 가 적혀 있는데 BALANCE_PROBES 에 항목이 없다`,
      ).toBe(true);
    }
  });

  it("프로브가 있는 벤더는 전부 quotaApi 가 적혀 있다(반대 방향)", () => {
    for (const vendor of balanceProbeVendors()) {
      expect(VENDOR_BILLING[vendor]?.quotaApi ?? null).not.toBeNull();
    }
  });

  it("★DeepSeek 이 첫 사례다 — 나머지 벤더는 여전히 조회 수단이 없다", () => {
    expect(balanceProbeVendors()).toEqual(["deepseek"]);
    expect(hasBalanceProbe("zai")).toBe(false);
    expect(hasBalanceProbe("anthropic")).toBe(false);
  });

  it("배선 안 된 벤더는 **요청 없이** unsupported 로 답한다", async () => {
    const fetchImpl = vi.fn();
    const r = await getVendorBalance("zai", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.status).toBe("unsupported");
    expect(r.amounts).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("성공 경로 — 숫자를 그대로, 통화를 그대로", () => {
  it("총액/무료분/충전액을 **갈라서** 돌려준다(합치지 않는다)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.status).toBe("ok");
    expect(r.isAvailable).toBe(true);
    expect(r.amounts).toEqual([
      { currency: "CNY", total: 110, granted: 10, toppedUp: 100 },
    ]);
  });

  it("★CNY 를 임의 환산하지 않는다 — 통화 코드가 원문 그대로다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.amounts[0].currency).toBe("CNY");
    // 환산했다면 USD 칸이 생기거나 숫자가 달라졌을 것이다.
    expect(r.amounts).toHaveLength(1);
    expect(r.amounts[0].total).toBe(110);
  });

  it("통화가 여러 개면 합치지 않고 나열한다", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        is_available: true,
        balance_infos: [
          {
            currency: "CNY",
            total_balance: "10",
            granted_balance: "1",
            topped_up_balance: "9",
          },
          {
            currency: "USD",
            total_balance: "2",
            granted_balance: "0",
            topped_up_balance: "2",
          },
        ],
      }),
    );
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.amounts.map((a) => a.currency)).toEqual(["CNY", "USD"]);
  });

  it("세부 칸이 없으면 0 이 아니라 null 이다(없는 값을 '소진' 으로 그리지 않는다)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "5.00" }],
      }),
    );
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.amounts[0]).toEqual({
      currency: "USD",
      total: 5,
      granted: null,
      toppedUp: null,
    });
  });

  it("★레지스트리에서 읽은 엔드포인트로 나가고, 키는 헤더에만 담긴다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/user/balance");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${FAKE_KEY}`,
    );
    // ★키가 URL 이나 결과 객체로 새지 않는다.
    expect(url).not.toContain(FAKE_KEY);
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });
});

describe("★실패를 구분한다 — 한 줄로 뭉개면 여기서 깨진다", () => {
  it("키 없음: 요청도 안 나가고, 키 **이름**만 돌아온다", async () => {
    const fetchImpl = vi.fn();
    const r = await withKey(undefined, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.status).toBe("no-key");
    expect(r.missingEnvKeys).toEqual(["DEEPSEEK_API_KEY"]);
    expect(r.amounts).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("401: unauthorized — '잔액 부족' 과 구분된다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "x" }, 401));
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.status).toBe("unauthorized");
    expect(r.httpStatus).toBe(401);
  });

  it("403 도 unauthorized 로 접힌다(둘 다 크레덴셜 축이다)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.status).toBe("unauthorized");
  });

  it("5xx: http-error 이고 상태 코드가 남는다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.status).toBe("http-error");
    expect(r.httpStatus).toBe(503);
  });

  it("네트워크 실패: network-error(키 문제와 다른 칸)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const r = await withKey(FAKE_KEY, () =>
      getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r.status).toBe("network-error");
    expect(r.amounts).toEqual([]);
  });

  it("2xx 인데 모양이 다르면 malformed — 숫자를 지어내지 않는다", async () => {
    for (const body of [
      {},
      { balance_infos: "nope" },
      { balance_infos: [] },
      null,
    ]) {
      __resetVendorBalanceCacheForTests();
      const fetchImpl = vi.fn(async () => jsonResponse(body));
      const r = await withKey(FAKE_KEY, () =>
        getVendorBalance("deepseek", {
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );
      expect(r.status, JSON.stringify(body)).toBe("malformed");
      expect(r.amounts).toEqual([]);
    }
  });

  it("다섯 사유가 서로 다른 값이다(뭉치기 금지의 직접 집행)", async () => {
    const seen = new Set<string>();
    const cases: Array<[string | undefined, () => Promise<Response>]> = [
      [undefined, async () => jsonResponse(OK_BODY)],
      [FAKE_KEY, async () => jsonResponse({}, 401)],
      [FAKE_KEY, async () => jsonResponse({}, 500)],
      [
        FAKE_KEY,
        async () => {
          throw new Error("offline");
        },
      ],
      [FAKE_KEY, async () => jsonResponse({ nope: 1 })],
    ];
    for (const [key, impl] of cases) {
      __resetVendorBalanceCacheForTests();
      const r = await withKey(key, () =>
        getVendorBalance("deepseek", {
          fetchImpl: impl as unknown as typeof fetch,
        }),
      );
      seen.add(r.status);
    }
    expect(seen.size).toBe(5);
  });
});

describe("★호출 빈도 — 탭을 여닫는 것으로 벤더를 때리지 않는다", () => {
  it("캐시가 살아 있으면 두 번째 호출은 요청을 안 낸다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    await withKey(FAKE_KEY, async () => {
      const first = await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const second = await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.amounts).toEqual(first.amounts);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("TTL 이 지나면 다시 읽는다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    let now = 1_000_000;
    await withKey(FAKE_KEY, async () => {
      await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => now,
      });
      now += BALANCE_CACHE_TTL_MS + 1;
      const again = await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => now,
      });
      expect(again.cached).toBe(false);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("새로고침(force)은 TTL 을 건너뛴다 — 단 하한을 넘긴 뒤에만", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    let now = 1_000_000;
    await withKey(FAKE_KEY, async () => {
      await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => now,
      });
      // 연타: 하한 안이라 캐시를 그대로 준다(요청 없음).
      const spam = await getVendorBalance("deepseek", {
        force: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => now,
      });
      expect(spam.cached).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // 하한을 넘기면 TTL 이 남았어도 실제로 다시 읽는다.
      now += MIN_REFRESH_INTERVAL_MS + 1;
      const real = await getVendorBalance("deepseek", {
        force: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => now,
      });
      expect(real.cached).toBe(false);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("동시 호출은 요청 하나로 접힌다", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return jsonResponse(OK_BODY);
    });
    await withKey(FAKE_KEY, async () => {
      const a = getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const b = getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      release?.();
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.status).toBe("ok");
      expect(rb.status).toBe("ok");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("실패도 캐시된다 — 깨진 상태에서 화면이 벤더를 연타하지 않는다", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    await withKey(FAKE_KEY, async () => {
      await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const second = await getVendorBalance("deepseek", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(second.status).toBe("http-error");
      expect(second.cached).toBe(true);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
