/**
 * 라우팅 shadow 왕복의 렌더러 절반 (티켓 6LH4Y1GC7xeWA94pW3Ar).
 *
 * ── ★★ 비목표 ────────────────────────────────────────────────────────────
 * **학습도 실반영도 아니다.** 이 파일이 도는 시점에 에이전트는 이미 로컬
 * `model-autoselect` 가 고른 칸으로 떠 있다. 여기서는 클라우드 스텁에게 "같은
 * 특징을 봤다면 어느 칸이었겠나" 를 묻고 그 답을 로컬 선택과 **나란히 기록**할
 * 뿐이다. 응답을 스폰에 되먹이는 배선은 존재하지 않는다(메인이 이 결과를 받는
 * 채널 자체가 없다).
 *
 * ── 왜 메인이 아니라 렌더러가 클라우드를 부르나 ─────────────────────────
 * 외부 송신 3종 세트가 전부 이쪽에 있기 때문이다:
 *   1. **동의 게이트** — `isTelemetryEnabled()`(사용자 opt-out + 하드 킬스위치).
 *      OFF 면 왕복 자체를 하지 않는다. 메인이 콜러블을 직접 부르면 이 게이트를
 *      우회하는 두 번째 외부 경로가 생긴다.
 *   2. **PII scrub** — 기록은 `logTelemetry` choke point 를 통과한다.
 *   3. **조인키 가명화** — 서버 `logTelemetryBatch` 가 taskId/agentId 를 HMAC
 *      가명으로 바꿔 익명 세계에 넣는다. 새 적재 경로를 만들지 않는 이유다.
 *
 * ── fail-safe ───────────────────────────────────────────────────────────
 * 콜러블 실패·미로그인·응답 이상 → **조용히 아무 일도 없다**. shadow 이벤트가
 * 한 건 덜 남을 뿐이고, 로컬 라우팅은 애초에 이 코드와 무관하게 이미 끝났다.
 */

import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { isTelemetryEnabled, logTelemetry } from "./telemetryService";

/** 메인(`electron/routing-shadow.ShadowRequest`)이 넘겨주는 그 모양. */
export interface RoutingShadowRequest {
  features: Record<string, unknown>;
  localModelKey: string;
  localMode?: string;
  localDecidedBy?: string;
  localMovedFromEntry?: boolean;
  localColdStart?: boolean;
  taskId?: string | null;
  agentId?: string | null;
}

interface RoutingShadowResponse {
  ok?: unknown;
  recommendation?: {
    modelKey?: unknown;
    heuristicVersion?: unknown;
    decidedBy?: unknown;
  };
  comparison?: {
    agree?: unknown;
    cloudModelKey?: unknown;
    localModelKey?: unknown;
    rungDelta?: unknown;
    costDelta?: unknown;
  };
}

const getRoutingRecommendation = httpsCallable<
  { features: Record<string, unknown>; localModelKey: string },
  RoutingShadowResponse
>(functions, "getRoutingRecommendation");

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * 메인이 보낸 shadow 요청 하나를 처리한다. 절대 throw 하지 않는다.
 *
 * ★모양이 이상한 요청(localModelKey 없음 등)은 조용히 버린다 — 반쪽 비교를
 * 기록하면 일치율 분모가 오염된다.
 */
export async function recordRoutingShadow(request: unknown): Promise<void> {
  try {
    if (!isTelemetryEnabled()) return;
    // anti-abuse: 콜러블이 인증을 요구한다. 미로그인은 왕복 자체를 건너뛴다
    // (다른 텔레메트리도 로그인 전에는 큐에만 쌓인다 — 같은 감각).
    if (!auth.currentUser) return;
    if (!request || typeof request !== "object") return;
    const req = request as RoutingShadowRequest;
    const localModelKey = str(req.localModelKey);
    const features = req.features;
    if (!localModelKey || !features || typeof features !== "object") return;

    const { data } = await getRoutingRecommendation({
      features,
      localModelKey,
    });
    if (data?.ok !== true) return;
    const cloudModelKey = str(data.recommendation?.modelKey);
    if (!cloudModelKey) return;

    const agree = data.comparison?.agree;
    logTelemetry({
      event: "routing:shadow",
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.agentId ? { agentId: req.agentId } : {}),
      // `success` 를 일치 여부로 쓴다 — 1급 BOOLEAN 컬럼이라 metadata JSON 을
      // 파싱하지 않고도 일치율을 GROUP BY 로 뽑을 수 있다.
      ...(typeof agree === "boolean" ? { success: agree } : {}),
      metadata: {
        // ★비교 결과
        cloudModelKey,
        localModelKey,
        rungDelta: num(data.comparison?.rungDelta) ?? null,
        costDelta: num(data.comparison?.costDelta) ?? null,
        cloudDecidedBy: str(data.recommendation?.decidedBy) ?? null,
        heuristicVersion: str(data.recommendation?.heuristicVersion) ?? null,
        // ★로컬 쪽 맥락 — 불일치가 "클라우드가 못 보는 신호"(kg/bench/usage/
        // diversity) 때문인지 여기서 바로 갈린다.
        localMode: str(req.localMode) ?? null,
        localDecidedBy: str(req.localDecidedBy) ?? null,
        localMovedFromEntry: req.localMovedFromEntry === true,
        localColdStart: req.localColdStart === true,
        tier: str((features as { tier?: unknown }).tier) ?? null,
        harness: str((features as { harness?: unknown }).harness) ?? null,
      },
    });
  } catch {
    // 조용한 실패가 맞다. shadow 는 관측이고, 관측 실패가 제품 동작을 건드리면
    // 그 순간 이 티켓의 불변식("행동 변경 0")이 깨진다.
  }
}
