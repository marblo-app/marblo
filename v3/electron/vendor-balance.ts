/**
 * 벤더 **선불 잔액** 조회 — `vendorBilling.quotaApi` 의 첫 실제 배선.
 *
 * ── 왜 이제서야 생겼나 ───────────────────────────────────────────────────
 * `src/lib/vendorBilling.ts` 상단이 적어둔 대로, 지금까지 우리가 붙인 벤더는
 * 전부 (a) 구독형이라 잔액 개념이 없거나 (b) 프리페이드여도 조회 **공개 API 가
 * 없어서** `quotaApi: null` 이었다. DeepSeek 이 처음으로 둘 다 아니다 — 선불
 * 충전식이고 `GET /user/balance` 를 공개한다(api-docs.deepseek.com, 2026-08-21).
 * 그래서 이 파일은 "DeepSeek 전용 모듈" 이 아니라 **두 번째 벤더가 생겼을 때
 * 표 한 줄만 늘리는 자리**로 만든다(`BALANCE_PROBES`).
 *
 * ── ★보안 불변식 ────────────────────────────────────────────────────────
 * 1. **키는 이 프로세스를 벗어나지 않는다.** 평문 키를 만지는 곳은 아래
 *    `readVendorKey` 하나이고, 그 값은 `Authorization` 헤더로만 쓰인다. IPC 로
 *    나가는 `VendorBalanceResult` 에는 금액·통화·상태·**키 이름**만 담긴다.
 *    (`models:quickLaneCatalog` 이 세운 "이름과 boolean 만" 규율과 같은 축이다.)
 * 2. **로그에 값이 없다.** 이 모듈은 키도, 응답 원문도 로그하지 않는다. 실패는
 *    상태 코드로만 남는다.
 * 3. 키 소스 서열은 스폰 경로(`agent-config.resolveVendorEnvProfile`)와 **같다** —
 *    `process.env` → safeStorage 벤더 시크릿 저장소. 두 경로가 갈라지면 "스폰은
 *    되는데 잔액은 키 없음" 같은 모순이 화면에 뜬다.
 *
 * ── ★실패를 뭉개지 않는다 ───────────────────────────────────────────────
 * 상태를 하나로 접으면("잔액 표시 안 됨") 사용자는 **충전이 안 된 건지 키가 틀린
 * 건지** 알 수 없다. Solar 조용한 실패로 하루를 날린 게 이 프로젝트의 학습이라,
 * `VendorBalanceStatus` 는 no-key / unauthorized / http-error / network-error /
 * malformed 를 **끝까지 구분해서** 렌더러까지 들고 간다.
 *
 * ── ★호출 빈도 ──────────────────────────────────────────────────────────
 * 폴링하지 않는다. 캐시(TTL `BALANCE_CACHE_TTL_MS`) + 사용자가 누르는 새로고침
 * 뿐이고, 새로고침에도 `MIN_REFRESH_INTERVAL_MS` 하한이 있다(연타 방지). 동시
 * 호출은 in-flight 하나로 접는다. 사용량 탭을 열고 닫는 것만으로는 벤더 API 에
 * 요청이 나가지 않는다(캐시가 살아 있는 한).
 *
 * ── ★통화를 환산하지 않는다 ─────────────────────────────────────────────
 * DeepSeek 은 계정에 따라 CNY 로 답한다. 우리가 환율을 들고 있지 않으므로 원문
 * 통화를 그대로 올린다 — 지어낸 환율로 만든 USD 는 **거짓 숫자**다. 벤더가 여러
 * 통화 칸을 주면 합치지 않고 통화별로 나열한다.
 */

import {
  getModel,
  MODEL_REGISTRY,
  vendorEnvSecretKeys,
} from "./model-registry";
import type { VendorId } from "./model-registry";
import { getVendorSecret } from "./vendor-secrets";

/** 조회 결과가 이 나이를 넘기면 다음 요청에서 다시 읽는다(10분). */
export const BALANCE_CACHE_TTL_MS = 10 * 60_000;

/** 수동 새로고침 하한 — 버튼 연타가 벤더 API 연타가 되지 않게. */
export const MIN_REFRESH_INTERVAL_MS = 15_000;

/** 요청 타임아웃. 막힌 프로브가 패널을 붙잡고 있으면 안 된다. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * 조회 결과의 성격. **하나로 접지 않는 것 자체가 요구사항**이다(파일 상단 §실패).
 */
export type VendorBalanceStatus =
  /** 조회 성공. `amounts` 가 통화별로 채워져 있다. */
  | "ok"
  /** 이 벤더는 잔액 조회 API 가 없다(= `quotaApi: null`). 실패가 아니다. */
  | "unsupported"
  /** 키가 이 기기에 없다. `missingEnvKeys` 에 **이름**이 담긴다. */
  | "no-key"
  /** 키는 있는데 벤더가 거절했다(401/403) — 틀렸거나 만료·폐기된 키. */
  | "unauthorized"
  /** 그 외 non-2xx. `httpStatus` 로 구분한다(429·5xx 등). */
  | "http-error"
  /** 벤더에 닿지 못했다(DNS·오프라인·타임아웃). */
  | "network-error"
  /** 2xx 인데 우리가 아는 스키마가 아니다 — 숫자를 지어내지 않고 여기서 멈춘다. */
  | "malformed";

/** 한 통화의 잔액. **환산하지 않는다**(파일 상단 §통화). */
export interface VendorBalanceAmount {
  /** 벤더가 준 통화 코드 그대로(CNY / USD …). */
  currency: string;
  /** 총 잔액. */
  total: number;
  /**
   * 무료 제공분. **만료될 수 있고 먼저 소진된다** — 그래서 총액에 합쳐서만
   * 보여주면 "충전액이 아직 남았다" 로 오독된다.
   *
   * ★`null` 은 0 이 아니라 **벤더가 그 칸을 안 줬다**는 뜻이다. 0 으로 채우면
   * "무료분 소진" 이라는 없는 사실이 화면에 생긴다.
   */
  granted: number | null;
  /** 사용자가 충전한 금액. `null` 의 뜻은 `granted` 와 같다. */
  toppedUp: number | null;
}

export interface VendorBalanceResult {
  vendor: string;
  status: VendorBalanceStatus;
  /** 통화별 잔액. `status !== "ok"` 이면 빈 배열이다(0 이 아니라 **없음**). */
  amounts: VendorBalanceAmount[];
  /**
   * 벤더가 스스로 답한 "지금 이 계정으로 API 를 쓸 수 있나". DeepSeek 의
   * `is_available` 이고, 잔액이 남아 있어도 false 가 나올 수 있다(계정 상태).
   */
  isAvailable?: boolean;
  /** non-2xx 일 때의 상태 코드. 화면이 "401" 과 "503" 을 다르게 말하는 근거. */
  httpStatus?: number;
  /** `status === "no-key"` 일 때 비어 있는 env 키 **이름**(값 아님). */
  missingEnvKeys?: string[];
  /** 이 결과가 실제로 조회된 시각(ms epoch). 캐시 나이 표시용. */
  fetchedAt: number;
  /** 캐시에서 그대로 돌려준 값인가(= 이번 호출로 벤더를 때리지 않았다). */
  cached: boolean;
}

/** 한 벤더의 잔액 조회 방법. 벤더가 늘면 여기 한 줄이 는다. */
interface BalanceProbe {
  /**
   * 엔드포인트 **경로**. 호스트는 레지스트리의 `envProfile.OPENAI_BASE_URL` 에서
   * 읽는다 — 스폰이 붙는 곳과 잔액을 묻는 곳이 갈라지지 않게 하기 위해서다.
   */
  path: string;
  parse: (
    body: unknown
  ) => Omit<VendorBalanceResult, "vendor" | "fetchedAt" | "cached">;
}

/** DeepSeek `GET /user/balance` 응답(문서 스펙, 2026-08-21). */
interface DeepSeekBalanceBody {
  is_available?: unknown;
  balance_infos?: unknown;
}

/** 벤더가 문자열("110.00")로 주는 금액. 숫자가 아니면 **버린다**(지어내지 않는다). */
function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number.parseFloat(value.trim());
  return Number.isFinite(n) ? n : null;
}

function parseDeepSeekBalance(
  body: unknown
): Omit<VendorBalanceResult, "vendor" | "fetchedAt" | "cached"> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: "malformed", amounts: [] };
  }
  const { is_available: isAvailable, balance_infos: infos } =
    body as DeepSeekBalanceBody;
  if (!Array.isArray(infos)) return { status: "malformed", amounts: [] };

  const amounts: VendorBalanceAmount[] = [];
  for (const raw of infos) {
    if (!raw || typeof raw !== "object") continue;
    const info = raw as Record<string, unknown>;
    const currency =
      typeof info.currency === "string" ? info.currency.trim() : "";
    const total = parseAmount(info.total_balance);
    const granted = parseAmount(info.granted_balance);
    const toppedUp = parseAmount(info.topped_up_balance);
    // 통화도 총액도 없으면 그 칸은 우리가 읽을 수 있는 잔액이 아니다.
    if (!currency || total === null) continue;
    // 세부 칸이 없으면 0 으로 **채우지 않는다** — 없는 값을 0 으로 그리면
    // "무료분을 다 썼다" 는 없는 사실이 화면에 생긴다. null 은 화면에서 세부
    // 줄을 그리지 않는 것으로 번역된다.
    amounts.push({ currency, total, granted, toppedUp });
  }
  if (amounts.length === 0) return { status: "malformed", amounts: [] };
  return {
    status: "ok",
    amounts,
    ...(typeof isAvailable === "boolean" ? { isAvailable } : {}),
  };
}

/**
 * 벤더 → 조회 방법. **`src/lib/vendorBilling.ts` 의 `quotaApi` 와 짝**이다:
 * 거기 id 를 적으면 여기 항목이 있어야 하고, 그 대응은
 * `tests/unit/vendor-balance.test.ts` 가 지킨다.
 */
const BALANCE_PROBES: Readonly<Partial<Record<VendorId, BalanceProbe>>> = {
  deepseek: { path: "/user/balance", parse: parseDeepSeekBalance },
};

/** 이 벤더에 잔액 조회가 배선돼 있는가. */
export function hasBalanceProbe(vendor: string): boolean {
  return Boolean(BALANCE_PROBES[vendor.trim().toLowerCase() as VendorId]);
}

/** 배선된 벤더 목록(테스트·IPC 검증용). */
export function balanceProbeVendors(): VendorId[] {
  return Object.keys(BALANCE_PROBES).sort() as VendorId[];
}

/**
 * 이 벤더의 활성 모델 하나(엔드포인트 호스트·env 키 이름의 단일소스).
 * 레지스트리에서 읽으므로 base URL 이 이 파일에 리터럴로 박히지 않는다.
 */
function anchorModelFor(vendor: string): string | undefined {
  return MODEL_REGISTRY.find(
    (m) => m.provider === vendor && m.status === "active" && m.envProfile
  )?.id;
}

function baseUrlFor(modelId: string): string | undefined {
  const profile = getModel(modelId)?.envProfile;
  const url = profile?.OPENAI_BASE_URL ?? profile?.ANTHROPIC_BASE_URL;
  return url?.replace(/\/+$/, "");
}

/**
 * 평문 키를 읽는 **유일한 곳**. 서열은 스폰 경로와 같다(process.env → 저장소).
 * 반환값은 이 파일 안에서 Authorization 헤더로만 쓰이고 밖으로 나가지 않는다.
 */
function readVendorKey(envKey: string): string | undefined {
  return process.env[envKey]?.trim() || getVendorSecret(envKey);
}

interface CacheEntry {
  /** 마지막으로 확정된 결과. 첫 요청이 끝나기 전에는 없다. */
  result?: VendorBalanceResult;
  /** 진행 중인 요청 — 동시 호출을 하나로 접는다. */
  inflight?: Promise<VendorBalanceResult>;
}

const cache = new Map<string, CacheEntry>();

export interface VendorBalanceOptions {
  /** 사용자가 새로고침을 눌렀다 — TTL 을 무시한다(하한은 그대로 적용된다). */
  force?: boolean;
  /** 테스트 주입용. */
  fetchImpl?: typeof fetch;
  /** 테스트 주입용 시계. */
  now?: () => number;
  timeoutMs?: number;
}

/** 테스트 격리용 — 프로덕션 경로에서는 호출하지 않는다. */
export function __resetVendorBalanceCacheForTests(): void {
  cache.clear();
}

/**
 * 한 벤더의 잔액. **네트워크를 타는 유일한 진입점**이고, 캐시가 살아 있으면
 * `cached: true` 로 즉시 답한다(요청 없음).
 */
export async function getVendorBalance(
  vendorRaw: string,
  opts: VendorBalanceOptions = {}
): Promise<VendorBalanceResult> {
  const vendor = vendorRaw.trim().toLowerCase();
  const now = opts.now ?? Date.now;
  const probe = BALANCE_PROBES[vendor as VendorId];
  if (!probe) {
    return {
      vendor,
      status: "unsupported",
      amounts: [],
      fetchedAt: now(),
      cached: false,
    };
  }

  const entry = cache.get(vendor);
  // 같은 벤더에 대한 동시 호출은 요청 하나로 접는다(패널 두 곳이 동시에 뜨는 경우).
  if (entry?.inflight) return entry.inflight;
  if (entry?.result) {
    const age = now() - entry.result.fetchedAt;
    // ★새로고침 하한: force 여도 너무 이르면 캐시를 그대로 준다. 버튼 연타가
    //   벤더 API 연타로 번역되지 않게 하는 유일한 장치다.
    const tooSoon = age < MIN_REFRESH_INTERVAL_MS;
    const fresh = age < BALANCE_CACHE_TTL_MS;
    if (opts.force ? tooSoon : fresh) {
      return { ...entry.result, cached: true };
    }
  }

  const inflight = probeVendorBalance(vendor, probe, opts);
  cache.set(vendor, {
    ...(entry?.result ? { result: entry.result } : {}),
    inflight,
  });
  try {
    const result = await inflight;
    cache.set(vendor, { result });
    return result;
  } catch (err) {
    // 프로브는 스스로 던지지 않는다(모든 실패를 status 로 접는다). 그래도 던진다면
    // 그건 버그이므로 실패를 캐시에 굳히지 않고 다음 호출이 다시 시도하게 둔다.
    cache.delete(vendor);
    throw err;
  }
}

async function probeVendorBalance(
  vendor: string,
  probe: BalanceProbe,
  opts: VendorBalanceOptions
): Promise<VendorBalanceResult> {
  const now = opts.now ?? Date.now;
  const stamp = <
    T extends Omit<VendorBalanceResult, "vendor" | "fetchedAt" | "cached">
  >(
    partial: T
  ): VendorBalanceResult => ({
    vendor,
    ...partial,
    fetchedAt: now(),
    cached: false,
  });

  const anchor = anchorModelFor(vendor);
  const base = anchor ? baseUrlFor(anchor) : undefined;
  const envKeys = anchor ? vendorEnvSecretKeys(anchor) : [];
  if (!anchor || !base || envKeys.length === 0) {
    // 레지스트리에서 호스트·키 이름을 못 읽는다 = 배선이 끊겼다. 조용히
    // "잔액 없음" 으로 그리지 않고 미상으로 남긴다.
    return stamp({ status: "unsupported", amounts: [] });
  }

  const missing = envKeys.filter((k) => !readVendorKey(k));
  if (missing.length > 0) {
    return stamp({ status: "no-key", amounts: [], missingEnvKeys: missing });
  }
  // DeepSeek 프로파일의 시크릿 키는 하나다. 여러 개인 벤더가 생기면 그 벤더의
  // 프로브가 어느 키로 인증할지 스스로 정해야 한다(오늘은 첫 키 = 유일한 키).
  const key = readVendorKey(envKeys[0]);
  if (!key)
    return stamp({ status: "no-key", amounts: [], missingEnvKeys: envKeys });

  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? REQUEST_TIMEOUT_MS
  );
  try {
    const res = await fetchImpl(`${base}${probe.path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        // ★평문 키가 이 프로세스를 벗어나는 유일한 방향 — 벤더로 나가는 헤더다.
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (res.status === 401 || res.status === 403) {
      return stamp({
        status: "unauthorized",
        amounts: [],
        httpStatus: res.status,
      });
    }
    if (!res.ok) {
      return stamp({
        status: "http-error",
        amounts: [],
        httpStatus: res.status,
      });
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return stamp({ status: "malformed", amounts: [] });
    }
    return stamp(probe.parse(body));
  } catch (err) {
    // ★원인을 로그에 남기되 **키도 응답 원문도 남기지 않는다**.
    console.warn("[vendor-balance] 잔액 조회 실패", {
      vendor,
      reason: err instanceof Error ? err.name : "unknown",
    });
    return stamp({ status: "network-error", amounts: [] });
  } finally {
    clearTimeout(timer);
  }
}
