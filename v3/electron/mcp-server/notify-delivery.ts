/**
 * 오케 알림 전달 결과 판정 (티켓 tHQzXPvFaR29fy0I82rM).
 *
 * `notifyOrchestrator` 는 지금까지 fire-and-forget 이었다 — 브리지가
 * `injected:false` 나 `success:false` 로 실패를 **알려줘도** `.catch(()=>{})`
 * 가 그 사실째 버렸다. 2026-09-01 REVIEW 제출 3건 유실의 은폐 지점이다.
 *
 * 이 모듈은 그 응답을 읽어 3분기로 판정한다:
 *   - delivered  — 오케 PTY 에 실제로 제출됨(브리지 injected:true)
 *   - suppressed — 브리지 게이트가 의도적으로 떨어뜨림(타임라인 전용 알림).
 *                  실패가 아니다 — 기록하면 오탐 소음이 된다
 *   - failed     — 전달 안 됨(오케 미기동/PTY 거절/브리지 불통). 호출부는
 *                  이 사실을 반드시 기록해야 한다(조용한 실패 금지)
 *
 * firebase 의존이 없어 tools.ts 밖에서 유닛 테스트할 수 있다(notify-routing
 * 테스트와 같은 규율). fetch 는 주입 가능.
 */

export interface NotifyPostResult {
  outcome: "delivered" | "suppressed" | "failed";
  reason?: string;
  /**
   * 실제로 배달된 오케 풀 (티켓 B0G7agMgarQPqIYEc3Jq). 브리지가 알려줄 때만
   * 채워진다 — 구버전 브리지 응답에는 없다.
   */
  deliveredTo?: "board" | "mission";
  /**
   * ★미션 오케가 없어 **보드 오케로 폴백**해 배달됐는가. 배달은 성공이지만
   * 사실을 조용히 감추지 않는다 — 호출부가 티켓에 기록한다.
   */
  viaFallback?: boolean;
  /** 폴백 사유(사람이 읽는 문장). viaFallback 일 때만. */
  fallbackReason?: string;
}

interface NotifyResponseBody {
  success?: boolean;
  injected?: boolean;
  reason?: string;
  error?: string;
  deliveredTo?: unknown;
  viaFallback?: unknown;
  fallbackReason?: unknown;
}

/** 브리지 `/notify-orchestrator` 응답 본문 → 3분기 판정. 순수. */
export function classifyNotifyResponse(
  httpOk: boolean,
  httpStatus: number,
  body: unknown,
): NotifyPostResult {
  if (!httpOk) {
    return { outcome: "failed", reason: `bridge HTTP ${httpStatus}` };
  }
  const b = (body ?? {}) as NotifyResponseBody;
  if (b.injected === true) {
    const deliveredTo =
      b.deliveredTo === "board" || b.deliveredTo === "mission"
        ? b.deliveredTo
        : undefined;
    return {
      outcome: "delivered",
      ...(deliveredTo ? { deliveredTo } : {}),
      ...(b.viaFallback === true
        ? {
            viaFallback: true,
            ...(typeof b.fallbackReason === "string" && b.fallbackReason
              ? { fallbackReason: b.fallbackReason }
              : {}),
          }
        : {}),
    };
  }
  // 브리지의 의도적 억제(shouldInjectOrchestratorNotification=false)는
  // success:true + injected:false + reason 으로 온다 — 실패로 세지 않는다.
  if (b.success === true && typeof b.reason === "string" && b.reason) {
    return { outcome: "suppressed", reason: b.reason };
  }
  return {
    outcome: "failed",
    reason:
      (typeof b.error === "string" && b.error) ||
      "orchestrator PTY did not accept the message",
  };
}

export interface PostOrchestratorNotificationOptions {
  bridgePort: string | undefined;
  headers: Record<string, string>;
  projectId: string;
  contextId: string;
  message: string;
  /**
   * 이 알림이 말하는 티켓 id. 브리지가 주입 성공 시 보드 재동기화 스위프의
   * seen 기록으로 흘린다(이중 검증 방지). 선택 — 없으면 관찰만 생략된다.
   */
  taskId?: string;
  /** 테스트 주입점. 기본 globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * 알림 1건을 브리지로 보내고 전달 결과를 사실대로 돌려준다. ★절대 throw 하지
 * 않는다 — 네트워크 실패도 failed 로 돌려주며, 판정 책임은 호출부에 있다.
 */
export async function postOrchestratorNotification(
  opts: PostOrchestratorNotificationOptions,
): Promise<NotifyPostResult> {
  if (!opts.bridgePort) {
    // 앱 밖에서 뜬 MCP 프로세스 — 오케 PTY 자체가 없다.
    return { outcome: "failed", reason: "no bridge port (MCP outside app)" };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `http://127.0.0.1:${opts.bridgePort}/notify-orchestrator`,
      {
        method: "POST",
        headers: opts.headers,
        body: JSON.stringify({
          message: opts.message,
          projectId: opts.projectId,
          contextId: opts.contextId,
          ...(opts.taskId ? { taskId: opts.taskId } : {}),
        }),
      },
    );
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return classifyNotifyResponse(res.ok, res.status, body);
  } catch (err) {
    return {
      outcome: "failed",
      reason: `bridge unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
