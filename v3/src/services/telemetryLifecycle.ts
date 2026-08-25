/**
 * 렌더러가 사라지기 전에 텔레메트리 큐를 비울 타이밍.
 *
 * agent:stopped 는 앱 종료·창 닫힘에서 큐에 들어가고, flush 는 10초 타이머라
 * 프로세스가 먼저 죽으면 이벤트가 사라진다. pagehide / visibility hidden 에서
 * 즉시 flush 해야 그 마지막 배치가 산다.
 */
export function shouldFlushTelemetryOnLifecycle(
  type: string,
  visibilityState?: string
): boolean {
  if (type === "pagehide") return true;
  return type === "visibilitychange" && visibilityState === "hidden";
}

export function bindTelemetryLifecycleFlush(
  flush: () => void,
  target: {
    addEventListener: (type: string, listener: () => void) => void;
    document?: {
      visibilityState?: string;
      addEventListener: (type: string, listener: () => void) => void;
    };
  } | null
): void {
  if (!target) return;
  target.addEventListener("pagehide", () => {
    if (shouldFlushTelemetryOnLifecycle("pagehide")) flush();
  });
  const doc = target.document;
  if (!doc) return;
  doc.addEventListener("visibilitychange", () => {
    if (shouldFlushTelemetryOnLifecycle("visibilitychange", doc.visibilityState)) {
      flush();
    }
  });
}
