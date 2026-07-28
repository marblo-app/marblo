/**
 * **사용가능성 축** — 자동선택 후보에서 "지금 이 기기에서 못 뜨는 하네스" 를 뺀다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * 인증 게이트(`harness-manager.checkSpawnAuthGate`)는 `agent:launch` IPC 에만 걸려
 * 있다. **보드 dispatch 스폰은 그 IPC 를 지나지 않고** `agentManager.launch` 로 바로
 * 내려가므로, 인증이 깨진 하네스를 라우팅이 고르면 CLI 가 로그인 화면을 뱉은 뒤
 * (`looksLikeLoginScreen` 백스톱)에야 문제가 드러난다 — 티켓은 죽은 PTY 하나를
 * 안고 멈추고, 옆에 멀쩡히 인증된 claude/codex 가 있는데도 쓰이지 않는다(라이브에서
 * grok auth 가 깨졌을 때 관측된 모양 그대로다).
 *
 * 그래서 **선택 단계에서** 같은 프로브를 먼저 돌려 후보를 거른다. 판정 기준을 새로
 * 만들지 않는다 — `probeCliAuth` 는 그 게이트가 쓰는 바로 그 함수다. "띄워봐야
 * 로그인 화면일 후보" 만 정확히 뺀다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **게이트가 있는 하네스만 판정한다**(claude / codex(gpt) / grok —
 *    `modelToCliAuth` 가 답하는 집합). gemini/antigravity/local/custom 은 스폰
 *    게이트도 통과시키므로 여기서도 건드리지 않는다(무회귀).
 * 2. **후보를 0 으로 만들지 않는다.** 전부 미인증이면 필터를 **적용하지 않고**
 *    사유만 남긴다. 라우팅이 스폰을 대신 막아 버리면 사용자는 "왜 아무것도 안
 *    뜨지" 만 보게 되고, 진짜 이유(로그인 필요 + 실행할 명령)를 알려주는 것은
 *    스폰 게이트의 에러 메시지다.
 * 3. **프로브 결과는 캐시한다.** claude 프로브는 macOS 키체인 존재확인을 포함해
 *    수십~수백 ms 가 들 수 있는데, dispatch 는 사람이 기다리는 경로다.
 * 4. **시크릿을 읽지 않는다.** 이 모듈이 다루는 것은 boolean 과 키 **이름**뿐이다.
 */

import {
  modelToCliAuth,
  probeCliAuth,
  type CliAuthModel,
  type CliAuthResult,
} from "./harness-manager";

export interface HarnessAvailability {
  harness: string;
  /** 인증 게이트가 있는 하네스인가(없으면 항상 available). */
  gated: boolean;
  installed: boolean;
  authenticated: boolean;
  available: boolean;
  /** 사람이 읽는 제외 사유(available=true 면 없음). */
  reason?: string;
  /** 다음에 실행할 명령(`claude login` 등). */
  action?: string;
}

export type AuthProbe = (model: CliAuthModel) => Promise<CliAuthResult>;

export interface AvailabilityOptions {
  /** 테스트/주입용 프로브. 기본은 스폰 게이트와 같은 `probeCliAuth`. */
  probe?: AuthProbe;
  /** 캐시 수명(ms). 0 이면 캐시 무시. */
  ttlMs?: number;
  /** 결정적 테스트용 시각 주입. */
  nowMs?: number;
}

/**
 * 기본 캐시 수명.
 *
 * 길게 잡아도 되는 이유는 이 판정이 **선호이지 차단이 아니기** 때문이다: 틀린 쪽으로
 * 어긋나는 최악의 경우는 방금 로그인한 하네스가 몇 분간 후보에서 빠지는 것이고,
 * 그동안에도 다른 하네스로 스폰은 된다(그리고 남는 후보가 없으면 필터 자체가
 * 적용되지 않는다). 반대로 짧게 잡으면 dispatch 마다 키체인 프로브(최대 2s)를
 * 사람이 기다린다. 로그인 직후 즉시 반영이 필요하면 `clearAvailabilityCache()`.
 */
export const AVAILABILITY_TTL_MS = 300_000;

interface CacheEntry {
  result: CliAuthResult;
  atMs: number;
}
const _cache = new Map<CliAuthModel, CacheEntry>();

/** 테스트/로그인 완료 훅 — 프로브 캐시를 비운다. */
export function clearAvailabilityCache(): void {
  _cache.clear();
}

/** 한 하네스의 설치·인증 상태(TTL 캐시). 프로브가 던지면 "알 수 없음 = 통과". */
export async function harnessAvailability(
  harness: string,
  opts: AvailabilityOptions = {},
): Promise<HarnessAvailability> {
  const cliModel = modelToCliAuth(harness);
  if (!cliModel) {
    return {
      harness,
      gated: false,
      installed: true,
      authenticated: true,
      available: true,
    };
  }

  const now = opts.nowMs ?? Date.now();
  const ttl = opts.ttlMs ?? AVAILABILITY_TTL_MS;
  const cached = _cache.get(cliModel);
  let result: CliAuthResult | undefined =
    cached && ttl > 0 && now - cached.atMs < ttl ? cached.result : undefined;

  if (!result) {
    try {
      result = await (opts.probe ?? probeCliAuth)(cliModel);
      _cache.set(cliModel, { result, atMs: now });
    } catch (err) {
      // 프로브 실패는 "미인증" 이 아니라 "모름" 이다. 모름으로 후보를 빼면
      // 일시적 파일시스템/키체인 오류가 라우팅을 통째로 흔든다.
      console.warn(
        `[model-availability] ${harness} 프로브 실패 — 가용성 미판정으로 통과: ${String(err)}`,
      );
      return {
        harness,
        gated: true,
        installed: true,
        authenticated: true,
        available: true,
      };
    }
  }

  const available = result.installed && result.authenticated;
  return {
    harness,
    gated: true,
    installed: result.installed,
    authenticated: result.authenticated,
    available,
    ...(available
      ? {}
      : {
          reason: !result.installed ? "미설치" : "미인증",
          ...(result.action ? { action: result.action } : {}),
        }),
  };
}

export interface AvailabilityFilter<T extends string = string> {
  /** 필터를 적용한 결과(applied=false 면 입력 그대로). */
  available: T[];
  /** 뺀 후보와 사유. applied 와 무관하게 **관측 자체는 항상 보고**한다. */
  excluded: { harness: T; reason: string; action?: string }[];
  /** 실제로 후보를 줄였는가(전부 미인증이면 false). */
  applied: boolean;
  /** dispatchReason 에 붙일 한 조각(제외가 없으면 빈 문자열). */
  note: string;
}

/**
 * 후보 하네스 목록에서 인증 안 된 것을 뺀다.
 *
 * 전부 빠지면 **입력을 그대로 돌려주고** `applied=false` 로 표시한다(규율 2).
 * 그때도 `excluded`/`note` 는 채워지므로 "왜 이런 선택이 됐나" 의 근거는 남는다.
 */
export async function filterAvailableHarnesses<T extends string>(
  candidates: readonly T[],
  opts: AvailabilityOptions = {},
): Promise<AvailabilityFilter<T>> {
  const results = await Promise.all(
    candidates.map((harness) => harnessAvailability(harness, opts)),
  );
  const available: T[] = [];
  const excluded: { harness: T; reason: string; action?: string }[] = [];
  results.forEach((r, i) => {
    if (r.available) available.push(candidates[i]);
    else
      excluded.push({
        harness: candidates[i],
        reason: r.reason ?? "unavailable",
        ...(r.action ? { action: r.action } : {}),
      });
  });

  const applied = available.length > 0 && excluded.length > 0;
  const note = excluded.length
    ? `avail: ${excluded
        .map((e) => `${e.harness} 제외(${e.reason})`)
        .join(", ")}${applied ? "" : " — 남는 후보가 없어 필터 미적용"}`
    : "";
  return {
    available: applied ? available : [...candidates],
    excluded,
    applied,
    note,
  };
}
